/*
 * Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/timriker/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */

export const PLAYER_TEAM = Object.freeze({
  AUTOMATIC: 'automatic',
  ROGUE: 'rogue',
  OBSERVER: 'observer',
  RED: 'red',
  BLUE: 'blue',
  GREEN: 'green',
  PURPLE: 'purple',
});

export const PLAYER_TEAMS = Object.freeze([
  PLAYER_TEAM.ROGUE,
  PLAYER_TEAM.OBSERVER,
  PLAYER_TEAM.RED,
  PLAYER_TEAM.BLUE,
  PLAYER_TEAM.GREEN,
  PLAYER_TEAM.PURPLE,
]);

export const PLAYER_TEAM_LABELS = Object.freeze({
  [PLAYER_TEAM.AUTOMATIC]: 'Automatic',
  [PLAYER_TEAM.ROGUE]: 'Rogue',
  [PLAYER_TEAM.OBSERVER]: 'Observer',
  [PLAYER_TEAM.RED]: 'Red Team',
  [PLAYER_TEAM.BLUE]: 'Blue Team',
  [PLAYER_TEAM.GREEN]: 'Green Team',
  [PLAYER_TEAM.PURPLE]: 'Purple Team',
});

export function normalizePlayerTeam(team) {
  const normalized = typeof team === 'string' ? team.trim().toLowerCase() : '';
  return PLAYER_TEAMS.includes(normalized) ? normalized : PLAYER_TEAM.ROGUE;
}

export function normalizePlayerTeamSelection(team) {
  const normalized = typeof team === 'string' ? team.trim().toLowerCase() : '';
  return normalized === PLAYER_TEAM.AUTOMATIC ? PLAYER_TEAM.AUTOMATIC : normalizePlayerTeam(normalized);
}

export function getPlayerTeamSelections(availableTeams) {
  return [PLAYER_TEAM.AUTOMATIC, ...PLAYER_TEAMS.filter((team) => availableTeams.includes(team))];
}

export function isObserverTeam(team) {
  return normalizePlayerTeam(team) === PLAYER_TEAM.OBSERVER;
}
