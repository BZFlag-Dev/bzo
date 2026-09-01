/*
 * Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/timriker/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */

// Holds the flag flight math against BZFlag's own numbers, and holds the two
// copies of the pair against each other. The server computes a flight once and
// the client integrates it every frame, so a divergence here is a flag that
// lands somewhere other than where it is drawn.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  BASE_TOP_TOLERANCE,
  getBaseTeamAtPoint,
  getBaseTopY,
  isOnBaseTop,
  isOverFlatTop,
} from '../public/collision.mjs';
import {
  getTeamColorIndex,
  getTeamFromColorIndex,
  isColorTeamIndex,
} from '../public/teams.mjs';
import {
  BZFLAG_TANK_RADIUS,
  FLAG_ALTITUDE,
  FLAG_CLEARANCE,
  FLAG_GRAB_RADIUS,
  FLAG_POLE_SIZE,
  FLAG_RADIUS,
  FLAG_STATUS,
  FLAG_TYPES,
  MAX_FLAG_GRABS,
  SUPER_FLAG_COLOR,
  computeFlagFlight,
  getFlagFlightHeight,
  getFlagFlightState,
  getFlagHoverHeight,
  getFlagTeamIndex,
  getFlagType,
  getTeamFlagAbbreviation,
  isTeamFlag,
} from '../public/flags.mjs';

const require = createRequire(import.meta.url);
const serverFlags = require('../server/flags.cjs');

const GRAVITY = 9.8;
const EPSILON = 1e-9;
const close = (actual, expected, message) => assert.ok(
  Math.abs(actual - expected) < 1e-6,
  `${message}: expected ${expected}, got ${actual}`
);

// global.cxx defaults.
assert.equal(FLAG_ALTITUDE, 11.0);
assert.equal(FLAG_RADIUS, 2.5);
assert.equal(FLAG_POLE_SIZE, 0.8);
assert.equal(FLAG_CLEARANCE, 10.0);
assert.equal(MAX_FLAG_GRABS, 4);
assert.equal(BZFLAG_TANK_RADIUS, 4.32);
close(FLAG_GRAB_RADIUS, 6.82, 'grab radius is BZFlag tank radius plus flag radius');

// Flag.cxx:139 -- Useless is an unstable good superflag with no team.
const useless = getFlagType('US');
assert.equal(useless, FLAG_TYPES.US);
assert.equal(useless.name, 'Useless');
assert.equal(useless.endurance, 1);
assert.equal(useless.quality, 0);
assert.equal(isTeamFlag('US'), false);
assert.equal(getFlagTeamIndex('US'), null, 'a superflag has no team');
assert.equal(SUPER_FLAG_COLOR, 0xffffff, 'every superflag is white');
assert.equal(getFlagType('ZZ'), null);
assert.equal(getFlagTeamIndex(null), null, 'a hidden flag has no team either');

// Flag.cxx:89 -- the four team flags, in BZFlag's TeamColor order, all normal
// endurance so they can always be dropped and never vanish on their own.
const TEAM_FLAGS = [['R*', 'red', 1], ['G*', 'green', 2], ['B*', 'blue', 3], ['P*', 'purple', 4]];
for (const [abbreviation, team, colorIndex] of TEAM_FLAGS) {
  const type = getFlagType(abbreviation);
  assert.ok(type, `${abbreviation} is a known flag`);
  assert.equal(type.endurance, 0, `${abbreviation} is FlagNormal`);
  assert.equal(type.team, colorIndex);
  assert.equal(isTeamFlag(abbreviation), true);
  assert.equal(getFlagTeamIndex(abbreviation), colorIndex);
  assert.equal(getTeamFlagAbbreviation(colorIndex), abbreviation);
  // The colour index a base carries and the one a team flag carries must resolve
  // to the same bzo team, or a map's bases and its flags disagree.
  assert.equal(getTeamFromColorIndex(colorIndex), team);
  assert.equal(getTeamColorIndex(team), colorIndex);
  assert.equal(isColorTeamIndex(colorIndex), true);
}
assert.equal(getTeamFlagAbbreviation(0), null, 'rogue has no team flag');
assert.equal(getTeamFlagAbbreviation(5), null, 'observers have no team flag');
assert.equal(getTeamColorIndex('bogus'), null, 'an unknown name is not team zero');
assert.equal(isColorTeamIndex(0), false);
assert.equal(isColorTeamIndex(5), false);
assert.equal(isColorTeamIndex(null), false);

// World::whoseBase -- a base is captured from its top surface. hix.bzw puts its
// bases at z 26 with height 4, rotated 45 degrees, 70 units across.
const redBase = { kind: 'base', team: 1, x: 0, z: -340, baseY: 26, h: 4, w: 70, d: 70, rotation: Math.PI / 4 };
const blueBase = { kind: 'base', team: 3, x: 0, z: 340, baseY: 26, h: 4, w: 70, d: 70, rotation: 0 };
const bases = [redBase, blueBase];

close(getBaseTopY(redBase), 30, 'base top is its floor plus its height');
assert.equal(isOnBaseTop(redBase, 0, 30, -340), true, 'dead centre on the top counts');
assert.equal(isOnBaseTop(redBase, 0, 26, -340), false, 'standing at its foot does not');
assert.equal(isOnBaseTop(redBase, 0, 30 + (BASE_TOP_TOLERANCE / 2), -340), true, 'within the epsilon counts');
assert.equal(isOnBaseTop(redBase, 0, 31, -340), false, 'hovering above it does not');
assert.equal(isOnBaseTop(blueBase, 34, 30, 340), true, 'inside the footprint counts');
assert.equal(isOnBaseTop(blueBase, 36, 30, 340), false, 'outside the footprint does not');
assert.equal(getBaseTeamAtPoint(bases, 0, 30, -340), 1, 'the red base answers red');
assert.equal(getBaseTeamAtPoint(bases, 0, 30, 340), 3, 'the blue base answers blue');
assert.equal(getBaseTeamAtPoint(bases, 0, 30, 0), null, 'open ground answers nobody');
assert.equal(getBaseTeamAtPoint([{ ...redBase, kind: 'box' }], 0, 30, -340), null, 'a box is not a base');

// A drop looks for a flat top under the point, with no radius at all.
assert.equal(isOverFlatTop(blueBase, 0, 340), true);
assert.equal(isOverFlatTop(blueBase, 40, 340), false);
assert.equal(
  isOverFlatTop({ type: 'pyramid', x: 0, z: 0, baseY: 0, h: 10, w: 10, d: 10, rotation: 0 }, 0, 0),
  false,
  'a pointed pyramid is no place to land'
);

// FlagInfo::addFlag -- flightTime is 2 * sqrt(-2 * flagAltitude / gravity).
const flight = computeFlagFlight(FLAG_ALTITUDE, GRAVITY);
close(flight.flightEnd, 2 * Math.sqrt(2 * FLAG_ALTITUDE / GRAVITY), 'flight duration');
close(flight.flightEnd, 2.996597, 'flight duration at bzo gravity');
close(flight.initialVelocity, GRAVITY * Math.sqrt(2 * FLAG_ALTITUDE / GRAVITY), 'launch velocity');

// The parabola leaves the ground, reaches exactly the thrown altitude at the
// halfway point, and comes back to zero at the end.
close(getFlagFlightHeight(0, flight.initialVelocity, GRAVITY), 0, 'height at launch');
close(
  getFlagFlightHeight(flight.flightEnd / 2, flight.initialVelocity, GRAVITY),
  FLAG_ALTITUDE,
  'apex height'
);
close(getFlagFlightHeight(flight.flightEnd, flight.initialVelocity, GRAVITY), 0, 'height at landing');
// The hover height is that same apex, which is what keeps a Coming flag's fall
// continuous with the hover it falls out of.
close(
  getFlagHoverHeight(flight.flightEnd, flight.initialVelocity, GRAVITY),
  FLAG_ALTITUDE,
  'hover height equals apex'
);

// A dropped flag: launched from a tank on a building, landing on the ground
// well to one side.
const thrown = {
  status: FLAG_STATUS.IN_AIR,
  position: { x: 0, y: 0, z: 0 },
  launchPosition: { x: 10, y: 30, z: -5 },
  landingPosition: { x: 10, y: 0, z: -5 },
  flightEnd: flight.flightEnd,
  initialVelocity: flight.initialVelocity,
};

const atLaunch = getFlagFlightState(thrown, 0, GRAVITY);
close(atLaunch.x, 10, 'launch x');
close(atLaunch.y, 30, 'launch altitude');
close(atLaunch.z, -5, 'launch z');
assert.equal(atLaunch.landed, false);

const atApex = getFlagFlightState(thrown, flight.flightEnd / 2, GRAVITY);
close(atApex.y, 15 + FLAG_ALTITUDE, 'apex is halfway down the lerp plus the throw');

const atLanding = getFlagFlightState(thrown, flight.flightEnd, GRAVITY);
close(atLanding.x, 10, 'landing x');
close(atLanding.y, 0, 'landing altitude');
close(atLanding.z, -5, 'landing z');
assert.equal(atLanding.landed, true, 'the flight ends exactly at flightEnd');

// Altitude never dips below the lerp between the two ends: the flag is thrown
// up, not down.
for (let step = 0; step <= 60; step += 1) {
  const elapsed = (step / 60) * flight.flightEnd;
  const state = getFlagFlightState(thrown, elapsed, GRAVITY);
  const t = elapsed / flight.flightEnd;
  const lerped = ((1 - t) * 30) + (t * 0);
  assert.ok(state.y >= lerped - EPSILON, `altitude dipped below the lerp at t=${t}`);
}

// A spawning flag: hovers at the apex over its landing spot for the first half,
// fading in over the first quarter, then falls.
const coming = {
  status: FLAG_STATUS.COMING,
  position: { x: -20, y: 0, z: 40 },
  launchPosition: { x: -20, y: 0, z: 40 },
  landingPosition: { x: -20, y: 0, z: 40 },
  flightEnd: flight.flightEnd,
  initialVelocity: flight.initialVelocity,
};
const quarter = flight.flightEnd / 4;

close(getFlagFlightState(coming, 0, GRAVITY).alpha, 0, 'a spawning flag starts invisible');
close(getFlagFlightState(coming, 0, GRAVITY).y, FLAG_ALTITUDE, 'a spawning flag starts at the apex');
close(getFlagFlightState(coming, quarter / 2, GRAVITY).alpha, 0.5, 'fades in over the first quarter');
close(getFlagFlightState(coming, quarter, GRAVITY).warp, 1, 'the warp peaks a quarter in');
close(getFlagFlightState(coming, 2 * quarter, GRAVITY).warp, 0, 'the warp is gone by the halfway point');
close(getFlagFlightState(coming, 2 * quarter, GRAVITY).y, FLAG_ALTITUDE, 'the fall starts from the apex');
assert.ok(
  getFlagFlightState(coming, 3 * quarter, GRAVITY).y < FLAG_ALTITUDE,
  'a spawning flag is falling in the second half'
);
const landedComing = getFlagFlightState(coming, flight.flightEnd, GRAVITY);
close(landedComing.y, 0, 'a spawning flag settles at its landing altitude');
assert.equal(landedComing.landed, true);
close(landedComing.alpha, 1, 'a landed flag is opaque');

// A vanishing flag is the reverse: it rises, the warp grows, then both fade.
const going = { ...coming, status: FLAG_STATUS.GOING };
close(getFlagFlightState(going, 0, GRAVITY).y, 0, 'a vanishing flag starts on the ground');
close(getFlagFlightState(going, 0, GRAVITY).alpha, 1, 'a vanishing flag starts opaque');
close(getFlagFlightState(going, 2 * quarter, GRAVITY).y, FLAG_ALTITUDE, 'it rises to the apex');
close(getFlagFlightState(going, 3 * quarter, GRAVITY).warp, 1, 'the warp peaks three quarters in');
close(getFlagFlightState(going, 3.5 * quarter, GRAVITY).alpha, 0.5, 'it fades over the last quarter');
const goneFlag = getFlagFlightState(going, flight.flightEnd, GRAVITY);
close(goneFlag.alpha, 0, 'a vanished flag is invisible');
assert.equal(goneFlag.landed, true);

// A flag on the ground or on a tank does not move.
for (const status of [FLAG_STATUS.ON_GROUND, FLAG_STATUS.ON_TANK, FLAG_STATUS.NO_EXIST]) {
  const still = getFlagFlightState({ ...coming, status }, 99, GRAVITY);
  close(still.x, -20, 'a resting flag keeps its x');
  close(still.y, 0, 'a resting flag keeps its altitude');
  close(still.z, 40, 'a resting flag keeps its z');
  assert.equal(still.landed, false, 'a resting flag is not landing');
}

// Client/server parity across the whole table of inputs.
for (const [name, value] of Object.entries(serverFlags)) {
  if (typeof value === 'number') {
    const clientValue = (await import('../public/flags.mjs'))[name];
    assert.equal(value, clientValue, `${name} diverged between the copies`);
  }
}

const parityFlags = [thrown, coming, going];
for (const flag of parityFlags) {
  for (let step = 0; step <= 40; step += 1) {
    const elapsed = (step / 30) * flight.flightEnd;
    const clientState = getFlagFlightState(flag, elapsed, GRAVITY);
    const serverState = serverFlags.getFlagFlightState(flag, elapsed, GRAVITY);
    assert.deepEqual(
      serverState,
      clientState,
      `client/server flight diverged for status ${flag.status} at ${elapsed}s`
    );
  }
}

for (const altitude of [1, 5, FLAG_ALTITUDE, 40]) {
  for (const gravity of [4.9, GRAVITY, 19.6]) {
    assert.deepEqual(
      serverFlags.computeFlagFlight(altitude, gravity),
      computeFlagFlight(altitude, gravity),
      `client/server flight computation diverged for ${altitude}/${gravity}`
    );
  }
}

console.log('Flag flight and type tests passed');
