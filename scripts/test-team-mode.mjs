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
let randomColorCalls = 0;
const pickRandomColor = () => {
  randomColorCalls += 1;
  return 0xabcdef;
};
assert.equal(getInitialPlayerColor({ enabled: true }, 'blue', pickRandomColor), 0x1a33ff);
assert.equal(randomColorCalls, 0);
assert.equal(getInitialPlayerColor({ enabled: false }, 'rogue', pickRandomColor), 0xabcdef);
assert.equal(randomColorCalls, 1);

console.log('team mode tests passed');
