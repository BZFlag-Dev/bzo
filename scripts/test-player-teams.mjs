/*
 * Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/timriker/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */

import assert from 'node:assert/strict';
import {
  PLAYER_TEAM,
  PLAYER_TEAMS,
  PLAYER_TEAM_LABELS,
  getPlayerTeamSelections,
  isObserverTeam,
  normalizePlayerTeam,
  normalizePlayerTeamSelection,
} from '../public/player-teams.mjs';

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

console.log('player team tests passed');
