/*
 * Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/timriker/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  PLAYER_TEAM,
  PLAYER_TEAMS,
  PLAYER_TEAM_LABELS,
  getPlayerTeamSelections,
  isObserverTeam,
  normalizePlayerTeam,
  normalizePlayerTeamSelection,
} from '../public/player-teams.mjs';

const require = createRequire(import.meta.url);
const serverTeams = require('../server/player-teams.cjs');

assert.deepEqual(PLAYER_TEAMS, [
  PLAYER_TEAM.ROGUE,
  PLAYER_TEAM.OBSERVER,
  PLAYER_TEAM.RED,
  PLAYER_TEAM.BLUE,
  PLAYER_TEAM.GREEN,
  PLAYER_TEAM.PURPLE,
]);
assert.equal(PLAYER_TEAM_LABELS[PLAYER_TEAM.ROGUE], 'Rogue');
assert.equal(PLAYER_TEAM_LABELS[PLAYER_TEAM.AUTOMATIC], 'Automatic');
assert.equal(PLAYER_TEAM_LABELS[PLAYER_TEAM.OBSERVER], 'Observer');
assert.equal(PLAYER_TEAM_LABELS[PLAYER_TEAM.RED], 'Red Team');
assert.equal(normalizePlayerTeam('BLUE'), PLAYER_TEAM.BLUE);
assert.equal(normalizePlayerTeam('unknown'), PLAYER_TEAM.ROGUE);
assert.equal(normalizePlayerTeamSelection('AUTOMATIC'), PLAYER_TEAM.AUTOMATIC);
assert.deepEqual(getPlayerTeamSelections([PLAYER_TEAM.BLUE, PLAYER_TEAM.OBSERVER]), [
  PLAYER_TEAM.AUTOMATIC,
  PLAYER_TEAM.OBSERVER,
  PLAYER_TEAM.BLUE,
]);
assert.equal(isObserverTeam(PLAYER_TEAM.OBSERVER), true);
assert.equal(isObserverTeam(PLAYER_TEAM.ROGUE), false);

// public/player-teams.mjs and server/player-teams.cjs are hand-maintained copies
// of the same normalization rules. Compare the shared surface directly so the
// two cannot drift the way they did before (the client used to skip trimming).
assert.deepEqual(serverTeams.PLAYER_TEAM, PLAYER_TEAM);
assert.deepEqual(serverTeams.PLAYER_TEAMS, PLAYER_TEAMS);

const normalizationCases = [
  'rogue',
  'BLUE',
  ' red ',
  'Red\n',
  '\tgreen\t',
  'automatic',
  ' AUTOMATIC ',
  'observer',
  'unknown',
  '',
  '   ',
  42,
  null,
  undefined,
  true,
  ['red'],
  { toString: () => 'blue' },
];

for (const value of normalizationCases) {
  const label = typeof value === 'object' && value !== null ? Object.prototype.toString.call(value) : String(value);
  assert.equal(
    serverTeams.normalizePlayerTeam(value),
    normalizePlayerTeam(value),
    `client/server normalizePlayerTeam diverged for ${JSON.stringify(label)}`
  );
  assert.equal(
    serverTeams.normalizePlayerTeamSelection(value),
    normalizePlayerTeamSelection(value),
    `client/server normalizePlayerTeamSelection diverged for ${JSON.stringify(label)}`
  );
}

// Whitespace-padded input must resolve to the real team, not fall back to rogue.
assert.equal(normalizePlayerTeam(' red '), PLAYER_TEAM.RED);
assert.equal(normalizePlayerTeamSelection(' AUTOMATIC '), PLAYER_TEAM.AUTOMATIC);
// Non-strings are rejected rather than coerced.
assert.equal(normalizePlayerTeam({ toString: () => 'blue' }), PLAYER_TEAM.ROGUE);

console.log('player team tests passed');
