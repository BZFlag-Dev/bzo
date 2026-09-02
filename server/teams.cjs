/*
 * Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/timriker/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */

const PLAYER_TEAM = Object.freeze({
  AUTOMATIC: 'automatic',
  ROGUE: 'rogue',
  OBSERVER: 'observer',
  RED: 'red',
  BLUE: 'blue',
  GREEN: 'green',
  PURPLE: 'purple',
});

const PLAYER_TEAMS = Object.freeze([
  PLAYER_TEAM.ROGUE,
  PLAYER_TEAM.OBSERVER,
  PLAYER_TEAM.RED,
  PLAYER_TEAM.BLUE,
  PLAYER_TEAM.GREEN,
  PLAYER_TEAM.PURPLE,
]);
const NON_TEAM_MODE_TEAMS = Object.freeze([PLAYER_TEAM.ROGUE, PLAYER_TEAM.OBSERVER]);
// BZFlag's TeamColor numbering (global.h:59). A BZW `base` object names one of
// these in its `color` line, a team flag carries one as its team, and `-mp`
// lists its player counts in this order. bzo's own team order differs, so the
// two are mapped rather than assumed to agree.
const BZFLAG_TEAM_ORDER = Object.freeze([
  PLAYER_TEAM.ROGUE,
  PLAYER_TEAM.RED,
  PLAYER_TEAM.GREEN,
  PLAYER_TEAM.BLUE,
  PLAYER_TEAM.PURPLE,
  PLAYER_TEAM.OBSERVER,
]);
const PLAYER_TEAM_COLORS = Object.freeze({
  [PLAYER_TEAM.ROGUE]: 0xffff00,
  [PLAYER_TEAM.OBSERVER]: 0xffffff,
  [PLAYER_TEAM.RED]: 0xff0000,
  [PLAYER_TEAM.BLUE]: 0x1a33ff,
  [PLAYER_TEAM.GREEN]: 0x00ff00,
  [PLAYER_TEAM.PURPLE]: 0xff00ff,
});

// Team::radarColor (Team.cxx:30). Deliberately not the tank colours: red, green
// and purple are lifted so a team reads against a dark radar, where the tank
// colours sink into it. Upstream uses these for everything it draws on the
// radar, so bzo does too.
const PLAYER_TEAM_RADAR_COLORS = Object.freeze({
  [PLAYER_TEAM.ROGUE]: 0xffff00,
  [PLAYER_TEAM.OBSERVER]: 0xffffff,
  [PLAYER_TEAM.RED]: 0xff2626,
  [PLAYER_TEAM.BLUE]: 0x1440ff,
  [PLAYER_TEAM.GREEN]: 0x33e633,
  [PLAYER_TEAM.PURPLE]: 0xff66ff,
});

function normalizePlayerTeam(team) {
  const normalized = typeof team === 'string' ? team.trim().toLowerCase() : '';
  return PLAYER_TEAMS.includes(normalized) ? normalized : PLAYER_TEAM.ROGUE;
}

function normalizePlayerTeamSelection(team) {
  const normalized = typeof team === 'string' ? team.trim().toLowerCase() : '';
  return normalized === PLAYER_TEAM.AUTOMATIC ? PLAYER_TEAM.AUTOMATIC : normalizePlayerTeam(normalized);
}

function normalizeTeamList(teams, fallback = PLAYER_TEAMS) {
  if (!Array.isArray(teams)) return [...fallback];
  const requested = new Set(teams
    .map((team) => typeof team === 'string' ? team.trim().toLowerCase() : '')
    .filter((team) => PLAYER_TEAMS.includes(team)));
  const normalized = PLAYER_TEAMS.filter((team) => requested.has(team));
  return normalized.length > 0 ? normalized : [...fallback];
}

function normalizeTeamLimits(limits, teams, defaultLimit) {
  return Object.fromEntries(teams.map((team) => {
    const configured = Number(limits?.[team]);
    return [team, Number.isInteger(configured) && configured >= 0 ? configured : defaultLimit];
  }));
}

function normalizeServerTeamMode(value, defaultLimit = Number.MAX_SAFE_INTEGER) {
  if (typeof value === 'boolean') {
    const teams = value ? [...PLAYER_TEAMS] : [...NON_TEAM_MODE_TEAMS];
    return {
      enabled: value,
      autoTeam: false,
      teams,
      limits: normalizeTeamLimits(null, teams, defaultLimit),
    };
  }

  const enabled = value?.enabled === true;
  const teams = enabled
    ? normalizeTeamList(value?.teams)
    : [...NON_TEAM_MODE_TEAMS];
  return {
    enabled,
    autoTeam: enabled && value?.autoTeam === true,
    teams,
    limits: normalizeTeamLimits(value?.limits, teams, defaultLimit),
  };
}

function parseBZWTeamMode(lines) {
  let inOptions = false;
  let touched = false;
  let hasExplicitMode = false;
  const override = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (!inOptions && line === 'options') {
      inOptions = true;
      continue;
    }
    if (!inOptions) continue;
    if (line === 'end') {
      inOptions = false;
      continue;
    }

    const [option, value] = line.split(/\s+/, 2);
    if (option === '-c') {
      override.enabled = true;
      hasExplicitMode = true;
      touched = true;
    } else if (option === '-offa') {
      override.enabled = false;
      hasExplicitMode = true;
      touched = true;
    } else if (option === '-autoTeam') {
      override.autoTeam = true;
      touched = true;
    } else if (option === '-mp' && value?.includes(',')) {
      const counts = value.split(',').map((count) => Number.parseInt(count, 10));
      const enabledSet = new Set(BZFLAG_TEAM_ORDER.filter((team, index) => counts[index] > 0));
      override.teams = PLAYER_TEAMS.filter((team) => enabledSet.has(team));
      override.limits = Object.fromEntries(BZFLAG_TEAM_ORDER.map((team, index) => [
        team,
        Number.isInteger(counts[index]) && counts[index] >= 0 ? counts[index] : 0,
      ]));
      touched = true;
    }
  }

  if (!hasExplicitMode && override.teams?.some((team) => (
    team !== PLAYER_TEAM.ROGUE && team !== PLAYER_TEAM.OBSERVER
  ))) {
    override.enabled = true;
  }

  return touched ? override : null;
}

function resolveTeamMode(serverValue, mapOverride = null, defaultLimit = Number.MAX_SAFE_INTEGER) {
  const serverMode = normalizeServerTeamMode(serverValue, defaultLimit);
  const enabled = typeof mapOverride?.enabled === 'boolean'
    ? mapOverride.enabled
    : serverMode.enabled;
  if (!enabled) {
    const teams = [...NON_TEAM_MODE_TEAMS];
    return {
      enabled: false,
      autoTeam: false,
      teams,
      limits: normalizeTeamLimits(serverMode.limits, teams, defaultLimit),
    };
  }

  const teams = mapOverride?.teams
    ? normalizeTeamList(mapOverride.teams, serverMode.teams)
    : serverMode.teams;
  return {
    enabled: true,
    autoTeam: mapOverride?.autoTeam ?? serverMode.autoTeam,
    teams,
    limits: normalizeTeamLimits(mapOverride?.limits ?? serverMode.limits, teams, defaultLimit),
  };
}

function selectPlayerTeam(requestedTeam, teamMode, teamCounts = {}, teamScores = {}, random = Math.random) {
  const requested = normalizePlayerTeamSelection(requestedTeam);
  const automatic = requested === PLAYER_TEAM.AUTOMATIC;
  if (!automatic && !teamMode.teams.includes(requested)) return null;
  const hasRoom = (team) => (teamCounts[team] || 0) < teamMode.limits[team];

  if (!automatic && (requested === PLAYER_TEAM.OBSERVER || requested === PLAYER_TEAM.ROGUE || !teamMode.autoTeam)) {
    return hasRoom(requested) ? requested : null;
  }

  let candidates = BZFLAG_TEAM_ORDER.slice(1, 5)
    .filter((team) => teamMode.teams.includes(team))
    .sort((left, right) => (teamCounts[right] || 0) - (teamCounts[left] || 0));
  if (candidates.length === 0) return hasRoom(PLAYER_TEAM.ROGUE) ? PLAYER_TEAM.ROGUE : null;

  const largestCount = teamCounts[candidates[0]] || 0;
  if (largestCount > 0) {
    candidates = candidates.filter(hasRoom);
    if (candidates.length === 0) return hasRoom(PLAYER_TEAM.ROGUE) ? PLAYER_TEAM.ROGUE : null;

    const smallestCount = teamCounts[candidates[candidates.length - 1]] || 0;
    if (smallestCount < largestCount) {
      if (largestCount === 1 && candidates.length >= 2 && (teamCounts[candidates[1]] || 0) === 1) {
        candidates = candidates.filter((team) => (teamCounts[team] || 0) > 0);
      } else {
        candidates = candidates.filter((team) => (teamCounts[team] || 0) !== largestCount);
        if ((teamCounts[candidates[0]] || 0) > 0) {
          candidates = candidates.filter((team) => (teamCounts[team] || 0) > 0);
          const smallestExistingCount = teamCounts[candidates[candidates.length - 1]] || 0;
          candidates = candidates.filter((team) => (teamCounts[team] || 0) === smallestExistingCount);
        }
      }
    }
  }

  if (candidates.includes(requested)) return requested;
  const lowestScore = Math.min(...candidates.map((team) => teamScores[team] || 0));
  candidates = candidates.filter((team) => (teamScores[team] || 0) === lowestScore);
  return candidates[Math.floor(random() * candidates.length)];
}

function isObserverTeam(team) {
  return normalizePlayerTeam(team) === PLAYER_TEAM.OBSERVER;
}

// Team::isColorTeam upstream. Rogues and observers carry no team score: a
// rogue kill feeds nobody's tally, and neither does dying as one.
function isColorTeam(team) {
  const normalized = normalizePlayerTeam(team);
  return normalized !== PLAYER_TEAM.ROGUE && normalized !== PLAYER_TEAM.OBSERVER;
}

// bzfs.cxx:3540. A kill across teams wins one for the killer's team and loses
// one for the victim's. A kill inside a team only loses: two for killing a team
// mate, one for killing yourself. Rogues and observers score for nobody, so a
// rogue's kill feeds no tally and a rogue's death costs none.
//
// Returned rather than applied so the rule can be tested against upstream's
// without a server around it.
function getTeamScoreDeltasForKill(killerTeam, victimTeam, selfKill = false) {
  const deltas = [];
  if (killerTeam && killerTeam === victimTeam) {
    if (isColorTeam(victimTeam)) deltas.push({ team: victimTeam, wins: 0, losses: selfKill ? 1 : 2 });
    return deltas;
  }
  if (isColorTeam(killerTeam)) deltas.push({ team: killerTeam, wins: 1, losses: 0 });
  if (isColorTeam(victimTeam)) deltas.push({ team: victimTeam, wins: 0, losses: 1 });
  return deltas;
}

// null rather than rogue for anything that is not a team, so a caller cannot
// mistake an unknown name for team zero.
function getTeamColorIndex(team) {
  const normalized = typeof team === 'string' ? team.trim().toLowerCase() : '';
  const index = BZFLAG_TEAM_ORDER.indexOf(normalized);
  return index >= 0 ? index : null;
}

function getTeamFromColorIndex(colorIndex) {
  return BZFLAG_TEAM_ORDER[colorIndex] || null;
}

// Team::isColorTeam by index: red, green, blue and purple are the teams that
// hold bases and flags.
function isColorTeamIndex(colorIndex) {
  return Number.isInteger(colorIndex) && colorIndex >= 1 && colorIndex <= 4;
}

// bzfs.cxx:4010. A capture wins one for the capping team and loses one for the
// team whose flag it was. Carrying your own flag onto an enemy base wins nobody
// anything -- the capper is on the team that just lost it -- so `cappingTeam` is
// null for that case.
//
// Returned rather than applied so the rule can be tested against upstream's
// without a server around it, as the kill rule above is.
function getTeamScoreDeltasForCapture(cappingTeam, cappedTeam) {
  const deltas = [];
  if (cappingTeam && cappingTeam !== cappedTeam && isColorTeam(cappingTeam)) {
    deltas.push({ team: cappingTeam, wins: 1, losses: 0 });
  }
  if (isColorTeam(cappedTeam)) deltas.push({ team: cappedTeam, wins: 0, losses: 1 });
  return deltas;
}

function getPlayerTeamRadarColor(team) {
  return PLAYER_TEAM_RADAR_COLORS[normalizePlayerTeam(team)];
}

function getPlayerTeamColor(team) {
  return PLAYER_TEAM_COLORS[normalizePlayerTeam(team)];
}

function getInitialPlayerColor(teamMode, team, pickRandomColor) {
  return teamMode.enabled ? getPlayerTeamColor(team) : pickRandomColor();
}

module.exports = {
  PLAYER_TEAM,
  PLAYER_TEAMS,
  BZFLAG_TEAM_ORDER,
  getTeamColorIndex,
  getTeamFromColorIndex,
  isColorTeamIndex,
  NON_TEAM_MODE_TEAMS,
  normalizePlayerTeam,
  normalizePlayerTeamSelection,
  normalizeServerTeamMode,
  parseBZWTeamMode,
  resolveTeamMode,
  selectPlayerTeam,
  getPlayerTeamColor,
  getPlayerTeamRadarColor,
  getInitialPlayerColor,
  isColorTeam,
  isObserverTeam,
  getTeamScoreDeltasForKill,
  getTeamScoreDeltasForCapture,
};
