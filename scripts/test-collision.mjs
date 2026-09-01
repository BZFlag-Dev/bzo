#!/usr/bin/env node
/*
 * Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/timriker/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */

// public/collision.mjs and server/collision.cjs are a
// hand-maintained pair, so compare them directly. The client resolves moves and
// the server rejects them, but both must agree about which volume is solid --
// a disagreement is either an honest player wrongly rejected or a cheater
// wrongly allowed.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as client from '../public/collision.mjs';

const require = createRequire(import.meta.url);
const server = require('../server/collision.cjs');

assert.deepEqual(
  Object.keys(server).sort(),
  Object.keys(client).filter((key) => key !== 'default').sort(),
  'client and server collision geometry export different names'
);

assert.equal(server.ZERO_TOLERANCE, client.ZERO_TOLERANCE);

// Deterministic PRNG so a failure is reproducible from the printed seed.
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function makePyramid(rand) {
  const height = 1 + rand() * 12;
  return {
    type: 'pyramid',
    name: 'fuzz',
    x: (rand() - 0.5) * 40,
    z: (rand() - 0.5) * 40,
    w: 2 + rand() * 20,
    d: 2 + rand() * 20,
    h: height,
    baseY: rand() < 0.3 ? rand() * 6 : 0,
    rotation: rand() < 0.5 ? 0 : rand() * Math.PI * 2,
    inverted: rand() < 0.5
  };
}

const SEED = Number(process.env.BZO_FUZZ_SEED || 20260830);
const rand = makeRandom(SEED);
const TANK_RADIUS = 2;
const TANK_HEIGHT = 2;

let checked = 0;
let solidSamples = 0;

for (let obstacleIndex = 0; obstacleIndex < 400; obstacleIndex += 1) {
  const obs = makePyramid(rand);
  const reach = Math.max(obs.w, obs.d) / 2 + TANK_RADIUS + 2;

  for (let sample = 0; sample < 250; sample += 1) {
    const x = obs.x + (rand() - 0.5) * 2 * reach;
    const z = obs.z + (rand() - 0.5) * 2 * reach;
    const y = obs.baseY - 2 + rand() * (obs.h + 4);

    const clientSolid = client.pyramidIntersectsCylinder(obs, x, y, z, TANK_RADIUS, TANK_HEIGHT);
    const serverSolid = server.pyramidIntersectsCylinder(obs, x, y, z, TANK_RADIUS, TANK_HEIGHT);

    // The client resolves movement and the server rejects it. The server must
    // never call solid what the client considers open, or it rejects a move an
    // unmodified client legitimately made.
    assert.equal(
      serverSolid,
      clientSolid,
      `solidity diverged (seed ${SEED}) at (${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)}) ` +
      `for ${JSON.stringify(obs)}`
    );

    assert.equal(
      server.pyramidShrinkFactor(obs, y, TANK_HEIGHT),
      client.pyramidShrinkFactor(obs, y, TANK_HEIGHT),
      `shrink factor diverged (seed ${SEED}) at y=${y.toFixed(3)} for ${JSON.stringify(obs)}`
    );

    const clientNormal = client.getPyramidFaceLocalNormal(obs, x, y, z, TANK_HEIGHT);
    const serverNormal = server.getPyramidFaceLocalNormal(obs, x, y, z, TANK_HEIGHT);
    assert.deepEqual(
      serverNormal,
      clientNormal,
      `face normal diverged (seed ${SEED}) at (${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)})`
    );

    // A pyramid must always offer a surface to slide on. When it does not, the
    // slide resolver has nothing to work with and the tank freezes in place --
    // in mid-air, if it was falling. Upstream getNormalRect always yields one.
    const normalLength = Math.hypot(clientNormal.x, clientNormal.y, clientNormal.z);
    assert.ok(
      Number.isFinite(normalLength) && normalLength > 1e-9,
      `face normal undefined (seed ${SEED}) at (${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)}) ` +
      `for ${JSON.stringify(obs)}`
    );

    assert.equal(
      server.isWithinPyramidFootprint(obs, x, z),
      client.isWithinPyramidFootprint(obs, x, z),
      `footprint containment diverged (seed ${SEED}) at (${x.toFixed(3)}, ${z.toFixed(3)})`
    );

    // Anything solid must be over the footprint or within a tank radius of it,
    // which is what keeps support and collision talking about the same object.
    if (clientSolid && !client.isWithinPyramidFootprint(obs, x, z)) {
      const local = client.getColliderLocalPoint(x, z, obs);
      const outside = Math.hypot(
        Math.max(0, Math.abs(local.x) - obs.w / 2),
        Math.max(0, Math.abs(local.z) - obs.d / 2)
      );
      assert.ok(
        outside <= TANK_RADIUS + 1e-9,
        `solid but ${outside.toFixed(3)} outside footprint (seed ${SEED})`
      );
    }

    // The server tests a slightly smaller radius than the client so that wire
    // quantization (positions are sent as toFixed(2)) cannot make it reject a
    // move the client legitimately made. Slack must only ever remove
    // collisions, never add them.
    const slackSolid = client.pyramidIntersectsCylinder(obs, x, y, z, TANK_RADIUS - 0.05, TANK_HEIGHT);
    assert.ok(
      !slackSolid || clientSolid,
      `slack created a collision (seed ${SEED}) at (${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)})`
    );

    checked += 1;
    if (clientSolid) solidSamples += 1;
  }
}

// A fuzz run that never lands inside an obstacle proves nothing.
assert.ok(solidSamples > checked * 0.05, `fuzz coverage too low: ${solidSamples}/${checked} solid`);

// Anchored cases pinning the BZFlag semantics the fuzz run cannot express.
const upright = { type: 'pyramid', x: 0, z: 0, w: 10, d: 10, h: 8, baseY: 0, rotation: 0, inverted: false };
const inverted = { ...upright, inverted: true };

// shrinkFactor: upright is widest at the base, inverted at the top.
assert.equal(client.pyramidShrinkFactor(upright, 0, 0), 1);
assert.equal(client.pyramidShrinkFactor(upright, 8, 0), 0);
assert.equal(client.pyramidShrinkFactor(inverted, 8, 0), 1);
assert.equal(client.pyramidShrinkFactor(inverted, 0, 0), 0);

// An occupant's own height reaches the wider cross-section of an inverted pyramid.
assert.equal(client.pyramidShrinkFactor(inverted, 0, 2), 0.25);

// Upright: solid near the base at the center, open high up near the apex edge.
assert.equal(client.pyramidIntersectsCylinder(upright, 0, 0, 0, 2, 2), true);
assert.equal(client.pyramidIntersectsCylinder(upright, 4.5, 7, 4.5, 2, 2), false);

// Inverted: open low at the edge, solid high where it is full width.
assert.equal(client.pyramidIntersectsCylinder(inverted, 4.9, 0, 4.9, 2, 2), false);
assert.equal(client.pyramidIntersectsCylinder(inverted, 4.5, 6, 4.5, 2, 2), true);

// Entirely above or below never collides.
assert.equal(client.pyramidIntersectsCylinder(upright, 0, 9, 0, 2, 2), false);
assert.equal(client.pyramidIntersectsCylinder(upright, 0, -5, 0, 2, 2), false);

// Inverted pyramids present a flat, drivable top; upright ones do not.
assert.equal(client.isPyramidFlatTop(inverted), true);
assert.equal(client.isPyramidFlatTop(upright), false);

// getPyramidSurfaceLocalHeight is the inverse of pyramidShrinkFactor.
for (const obs of [upright, inverted]) {
  for (const edge of [0, 0.25, 0.5, 0.75, 1]) {
    const localX = edge * (obs.w / 2);
    const surfaceY = client.getPyramidSurfaceLocalHeight(obs, localX, 0);
    const shrink = client.pyramidShrinkFactor(obs, obs.baseY + surfaceY, 0);
    // Both orientations reduce to the same identity: the shrink factor at the
    // surface height equals the normalized distance from the pyramid's axis.
    assert.ok(
      Math.abs(shrink - edge) < 1e-9,
      `surface height and shrink factor disagree at edge ${edge} (inverted=${obs.inverted})`
    );
  }
}

// Regression: a tank whose centre sits outside the base footprint still needs a
// normal, because its radius can reach the slope. Returning none here froze
// tanks against steep pyramids, including in mid-air while falling.
const e_pyr1 = { type: 'pyramid', x: 340, z: 45, baseY: 0, rotation: Math.PI, w: 15, d: 15, h: 26, inverted: false };
const outsideFootprint = client.getPyramidFaceLocalNormal(e_pyr1, 341.95, 6.94, 52.54, 2);
assert.ok(Math.hypot(outsideFootprint.x, outsideFootprint.y, outsideFootprint.z) > 1e-9);

// Steep faces are not climbable, so the tank slides off rather than driving up.
const steepNormalY = outsideFootprint.y / Math.hypot(outsideFootprint.x, outsideFootprint.y, outsideFootprint.z);
assert.ok(steepNormalY < 0.7, `expected e_pyr1 face to be unclimbable, got normal.y=${steepNormalY}`);

// A shallow rib is climbable, matching the drive-up-a-pyramid behaviour.
const rib = { type: 'pyramid', x: 140, z: 140, baseY: 0, rotation: Math.PI, w: 16, d: 2, h: 5, inverted: false };
const ribNormal = client.getPyramidFaceLocalNormal(rib, 130.3, 0, 140.54, 2);
assert.ok(ribNormal.y / Math.hypot(ribNormal.x, ribNormal.y, ribNormal.z) >= 0.7);

// Regression: a normal exists everywhere, but support must be contained.
// hix.bzw's inverted "cap" pyramids sit at baseY=12 h=2, so their flat top is at
// exactly y=14. When support stopped checking containment, one of them held a
// tank at y=14 from 224 units away, and the tank could not fall anywhere on the
// map.
const cap = { type: 'pyramid', x: 140, z: -140, baseY: 12, rotation: Math.PI, w: 16, d: 1, h: 2, inverted: true };
assert.equal(client.isWithinPyramidFootprint(cap, 237.41, 61.57), false, 'distant point must not be over the cap');
assert.equal(client.isWithinPyramidFootprint(cap, 140, -140), true, 'centre must be over the cap');
// Still yields a normal there, which is what the slide resolver needs.
const distantNormal = client.getPyramidFaceLocalNormal(cap, 237.41, 14, 61.57, 2);
assert.ok(Math.hypot(distantNormal.x, distantNormal.y, distantNormal.z) > 1e-9);

// Footprint containment respects rotation.
const rotated = { type: 'pyramid', x: 0, z: 0, baseY: 0, rotation: Math.PI / 2, w: 16, d: 2, h: 5, inverted: false };
assert.equal(client.isWithinPyramidFootprint(rotated, 0, 7), true, 'long axis runs along z when rotated 90 degrees');
assert.equal(client.isWithinPyramidFootprint(rotated, 7, 0), false, 'short axis runs along x when rotated 90 degrees');

// Rectangle normals: sides, corners, and interior all resolve.
assert.deepEqual(client.getOrigRectNormal(5, 5, 9, 0), { x: 1, z: 0 });
assert.deepEqual(client.getOrigRectNormal(5, 5, -9, 0), { x: -1, z: 0 });
assert.deepEqual(client.getOrigRectNormal(5, 5, 0, 9), { x: 0, z: 1 });
assert.deepEqual(client.getOrigRectNormal(5, 5, 0, -9), { x: 0, z: -1 });
const corner = client.getOrigRectNormal(5, 5, 8, 9);
assert.ok(corner.x > 0 && corner.z > 0 && Math.abs(Math.hypot(corner.x, corner.z) - 1) < 1e-9);
// Inside a long thin rib, resolve to the long face rather than the end cap.
assert.deepEqual(client.getOrigRectNormal(8, 1, 1, 0.5), { x: 0, z: 1 });

console.log(`collision geometry tests passed (${checked} fuzz samples, ${solidSamples} solid, seed ${SEED})`);
