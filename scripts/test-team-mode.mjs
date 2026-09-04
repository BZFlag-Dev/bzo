/*
 * Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/timriker/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  normalizeServerTeamMode,
  parseBZWTeamMode,
  resolveTeamMode,
  selectPlayerTeam,
  getPlayerTeamColor,
  getInitialPlayerColor,
  PLAYER_TEAM_COLORS,
  TEAM_SHADE_HUE_SPREAD,
} = require('../server/teams.cjs');

assert.deepEqual(normalizeServerTeamMode(false), {
  enabled: false,
  autoTeam: false,
  teams: ['rogue', 'observer'],
  limits: {
    rogue: Number.MAX_SAFE_INTEGER,
    observer: Number.MAX_SAFE_INTEGER,
  },
});
assert.deepEqual(normalizeServerTeamMode({ enabled: true, teams: ['blue', 'red'] }), {
  enabled: true,
  autoTeam: false,
  teams: ['red', 'blue'],
  limits: {
    red: Number.MAX_SAFE_INTEGER,
    blue: Number.MAX_SAFE_INTEGER,
  },
});
assert.deepEqual(normalizeServerTeamMode({ enabled: true, teams: ['invalid', 'blue'] }), {
  enabled: true,
  autoTeam: false,
  teams: ['blue'],
  limits: {
    blue: Number.MAX_SAFE_INTEGER,
  },
});

const mapOverride = parseBZWTeamMode([
  'options',
  '  -c',
  '  -mp 10,0,4,0,2,8',
  'end',
]);
assert.deepEqual(mapOverride, {
  enabled: true,
  teams: ['rogue', 'observer', 'green', 'purple'],
  limits: {
    rogue: 10,
    red: 0,
    green: 4,
    blue: 0,
    purple: 2,
    observer: 8,
  },
});
assert.deepEqual(parseBZWTeamMode([
  'options',
  '  -mp 10,2,2,0,0,8',
  'end',
]), {
  enabled: true,
  teams: ['rogue', 'observer', 'red', 'green'],
  limits: {
    rogue: 10,
    red: 2,
    green: 2,
    blue: 0,
    purple: 0,
    observer: 8,
  },
});
assert.deepEqual(parseBZWTeamMode([
  'options',
  '  -c',
  '  -autoTeam',
  '  -mp 10,10,10,10,10,10',
  'end',
]), {
  enabled: true,
  autoTeam: true,
  teams: ['rogue', 'observer', 'red', 'blue', 'green', 'purple'],
  limits: {
    rogue: 10,
    red: 10,
    green: 10,
    blue: 10,
    purple: 10,
    observer: 10,
  },
});
assert.deepEqual(parseBZWTeamMode(readFileSync(new URL('../maps/hix.bzw', import.meta.url), 'utf8').split(/\r?\n/)), {
  enabled: true,
  teams: ['rogue', 'observer', 'red', 'blue', 'green', 'purple'],
  limits: {
    rogue: 10,
    red: 10,
    green: 10,
    blue: 10,
    purple: 10,
    observer: 10,
  },
});
assert.deepEqual(resolveTeamMode({ enabled: false }, mapOverride), {
  enabled: true,
  autoTeam: false,
  teams: ['rogue', 'observer', 'green', 'purple'],
  limits: {
    rogue: 10,
    observer: 8,
    green: 4,
    purple: 2,
  },
});
assert.deepEqual(resolveTeamMode({ enabled: true, teams: ['red', 'blue'] }, { enabled: false }), {
  enabled: false,
  autoTeam: false,
  teams: ['rogue', 'observer'],
  limits: {
    rogue: Number.MAX_SAFE_INTEGER,
    observer: Number.MAX_SAFE_INTEGER,
  },
});

const manualTeams = resolveTeamMode({
  enabled: true,
  teams: ['red', 'green', 'blue', 'purple', 'observer'],
  limits: { red: 10, green: 10, blue: 10, purple: 10, observer: 10 },
});
const teamCounts = { red: 5, green: 5, blue: 0, purple: 5, observer: 0 };
assert.equal(selectPlayerTeam('red', manualTeams, teamCounts), 'red');
assert.equal(selectPlayerTeam('automatic', manualTeams, teamCounts), 'blue');
assert.equal(selectPlayerTeam('red', { ...manualTeams, autoTeam: true }, teamCounts), 'blue');
assert.equal(selectPlayerTeam('red', { ...manualTeams, autoTeam: true }, {
  red: 5,
  green: 4,
  blue: 0,
  purple: 5,
}), 'green');
assert.equal(selectPlayerTeam('red', manualTeams, { ...teamCounts, red: 10 }), null);
assert.equal(getPlayerTeamColor('rogue'), 0xffff00);
assert.equal(getPlayerTeamColor('observer'), 0xffffff);
assert.equal(getPlayerTeamColor('blue'), 0x1a33ff);
// Both modes go through the picker; what differs is the argument. In team mode
// it is the team, so the picker can shade inside that team's band. Outside it is
// null, so the picker has the whole wheel to work with.
const pickedTeams = [];
const pickDistinctColor = (team) => {
  pickedTeams.push(team);
  return team ? 0x111111 : 0xabcdef;
};
assert.equal(getInitialPlayerColor({ enabled: true }, 'blue', pickDistinctColor), 0x111111);
assert.deepEqual(pickedTeams, ['blue']);
assert.equal(getInitialPlayerColor({ enabled: false }, 'rogue', pickDistinctColor), 0xabcdef);
assert.deepEqual(pickedTeams, ['blue', null]);

// The shade bands must never let one team's colour reach another's. This is the
// property the band width is chosen for, so it is asserted against the colour
// table rather than left to the comment beside the constant.
const hueOf = (color) => {
  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const span = max - min;
  if (span === 0) return null; // observer's white has no hue to shade
  let hue;
  if (max === r) hue = ((g - b) / span) % 6;
  else if (max === g) hue = ((b - r) / span) + 2;
  else hue = ((r - g) / span) + 4;
  hue *= 60;
  return (hue + 360) % 360;
};
const hueGap = (left, right) => {
  const gap = Math.abs(left - right) % 360;
  return gap > 180 ? 360 - gap : gap;
};
const shadedHues = Object.values(PLAYER_TEAM_COLORS).map(hueOf).filter((hue) => hue !== null);
for (const left of shadedHues) {
  for (const right of shadedHues) {
    if (left === right) continue;
    assert.ok(
      hueGap(left, right) > 2 * TEAM_SHADE_HUE_SPREAD,
      `team hues ${left} and ${right} are ${hueGap(left, right)} apart, which two `
      + `${TEAM_SHADE_HUE_SPREAD} degree bands would overlap`
    );
  }
}

console.log('team mode tests passed');
