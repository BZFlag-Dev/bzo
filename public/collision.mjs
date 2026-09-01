/*
 * Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/timriker/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */

// Obstacle geometry shared by the client and the server.
//
// These predicates mirror upstream BZFlag so that both sides of bzo agree with
// each other by agreeing with the same reference implementation:
//   - testOrigRectCircle    -> src/game/Intersect.cxx testOrigRectCircle
//   - pyramidShrinkFactor   -> src/obstacle/PyramidBuilding.cxx shrinkFactor
//   - pyramidIntersects     -> src/obstacle/PyramidBuilding.cxx inBox
//   - isPyramidFlatTop      -> src/obstacle/PyramidBuilding.cxx isFlatTop
//
// bzo stores pyramid height as a positive `h` plus an `inverted` flag, which is
// what upstream calls ZFlip. bzo models tanks and shots as cylinders, so where
// upstream tests a rotated rectangle (testRectRect) bzo tests a circle
// (testRectCircle) against the same shrunk cross-section.
//
// Keep this file byte-identical in behavior with server/collision.cjs.
// scripts/test-collision.mjs enforces that.

export const ZERO_TOLERANCE = 1.0e-6;

// Rotate a world point into an obstacle's local, axis-aligned frame.
//
// Upstream testRectCircle rotates by -angle; bzo rotates by +rotation. The
// difference is a coordinate-layout artifact, not a different world.
//
// bzo is BZFlag's world relabeled for Three.js: bzo(x, y, z) = bzf(x, z, -y),
// a proper rotation, not a mirror. But the ordered pair (x, z) viewed from +Y
// has the opposite orientation to (x, y) viewed from +Z, so a Three.js rotation
// about +Y is a negative 2D rotation in (x, z), and its inverse is +rotation.
// render.js draws obstacles with `mesh.rotation.y = obs.rotation`, so the form
// below is exactly the inverse of how the mesh is drawn. Do not "fix" the sign.
export function getColliderLocalPoint(x, z, obs) {
  const rotation = obs.rotation || 0;
  const dx = x - obs.x;
  const dz = z - obs.z;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: dx * cos - dz * sin,
    z: dx * sin + dz * cos
  };
}

// Squared distance from a local point to the nearest point of an axis-aligned
// rectangle centered at the origin.
export function origRectPointDistanceSquared(halfW, halfD, localX, localZ) {
  const closestX = Math.max(-halfW, Math.min(localX, halfW));
  const closestZ = Math.max(-halfD, Math.min(localZ, halfD));
  const distX = localX - closestX;
  const distZ = localZ - closestZ;
  return distX * distX + distZ * distZ;
}

// True when an axis-aligned rectangle centered at the origin intersects a
// circle of radius r centered at the local point.
export function testOrigRectCircle(halfW, halfD, localX, localZ, radius) {
  return origRectPointDistanceSquared(halfW, halfD, localX, localZ) < radius * radius;
}

// Tank collision box, matching BZFlag's _tankWidth (2.8) and _tankLength (6.0).
// Player.cxx:120 sets dimensions[0] = 0.5 * tankLength (forward half-extent) and
// dimensions[1] = 0.5 * tankWidth (lateral). Every tank shares this box whatever
// model is selected, so the model is cosmetic and never changes gameplay.
export const TANK_HALF_LENGTH = 3.0;
export const TANK_HALF_WIDTH = 1.4;

// A rectangle centred at (localX, localZ), rotated so its lateral axis points
// along (cos a, sin a), against the axis-aligned rectangle at the origin.
// Ported from Intersect.cxx testOrigRectRect: dx1/dy1 are the rotated rect's
// half-extents, dx2/dy2 the origin rect's.
export function testOrigRectRect(px, pz, angle, dx1, dy1, dx2, dy2) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);

  // The origin rect's centre inside the rotated rect.
  const sx = c * px + s * pz;
  const sy = c * pz - s * px;
  if (Math.abs(sx) < dx1 && Math.abs(sy) < dy1) return true;

  // Corners of the rotated rect, classified against the origin rect.
  const box = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  const corner = [];
  const region = [];
  for (let i = 0; i < 4; i++) {
    const cx = px + c * dx1 * box[i][0] - s * dy1 * box[i][1];
    const cz = pz + s * dx1 * box[i][0] + c * dy1 * box[i][1];
    corner.push([cx, cz]);
    const rx = cx < -dx2 ? -1 : (cx > dx2 ? 1 : 0);
    const rz = cz < -dy2 ? -1 : (cz > dy2 ? 1 : 0);
    region.push([rx, rz]);
    if (!rx && !rz) return true;
  }

  // Each edge of the rotated rect against the origin rect.
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    if (region[i][0] === region[j][0]) {
      if (region[i][0] === 0 && region[i][1] !== region[j][1]) return true;
      continue;
    } else if (region[i][1] === region[j][1]) {
      if (region[i][1] === 0) return true;
      continue;
    }

    let c2x;
    let c2z;
    if (region[i][0] === 0) {
      c2x = region[j][0] * dx2;
      c2z = region[i][1] * dy2;
    } else if (region[j][0] === 0) {
      c2x = region[i][0] * dx2;
      c2z = region[j][1] * dy2;
    } else if (region[i][1] === 0) {
      c2x = region[i][0] * dx2;
      c2z = region[j][1] * dy2;
    } else {
      c2x = region[j][0] * dx2;
      c2z = region[i][1] * dy2;
    }

    const ex = corner[j][0] - corner[i][0];
    const ez = corner[j][1] - corner[i][1];
    const a = ez * (c2x - corner[i][0]) - ex * (c2z - corner[i][1]);
    const b = ez * (c2x + corner[i][0]) - ex * (c2z + corner[i][1]);
    if (a * b > 0.0) return true;
  }
  return false;
}

// The tank box against an obstacle, both expressed in the obstacle's local
// frame. `rotation` is the tank's heading in bzo terms, where forward is
// (-sin r, -cos r); the lateral axis leads by a quarter turn.
export function testOrigRectTank(halfW, halfD, localX, localZ, tankAngle, slack = 0) {
  // Slack shrinks the tank, never the obstacle, mirroring how the circle path
  // reduces the tested radius.
  const trim = Math.max(0, Math.min(slack, TANK_HALF_WIDTH));
  return testOrigRectRect(
    localX, localZ, tankAngle,
    TANK_HALF_WIDTH - trim, TANK_HALF_LENGTH - trim,
    halfW, halfD
  );
}

// The tank's lateral axis angle inside an obstacle's local frame.
export function getTankLocalAngle(rotation, obsRotation = 0) {
  return Math.PI - rotation + (obsRotation || 0);
}

// Height of the pyramid's sloped surface above its base, at a local point.
// Returns null outside the base footprint. This is the inverse of
// pyramidShrinkFactor: the surface sits where the shrunk rectangle's edge
// passes through the point.
export function getPyramidSurfaceLocalHeight(obs, localX, localZ) {
  const halfW = obs.w / 2;
  const halfD = obs.d / 2;
  if (Math.abs(localX) > halfW || Math.abs(localZ) > halfD) return null;
  const height = getPyramidHeight(obs);
  const edgeFactor = Math.max(Math.abs(localX) / halfW, Math.abs(localZ) / halfD);
  return obs.inverted ? height * edgeFactor : height * (1 - edgeFactor);
}

export function getPyramidHeight(obs) {
  return Math.abs(obs.h || 0);
}

// Inverted pyramids present a flat top that can be driven on; upright ones come
// to a point. Upstream: isFlatTop() { return getZFlip(); }
export function isPyramidFlatTop(obs) {
  return obs.inverted === true;
}

// Fraction the pyramid's cross-section is scaled to at world height y, for an
// occupant of the given height. Upstream PyramidBuilding::shrinkFactor.
export function pyramidShrinkFactor(obs, y, height = 0) {
  const oHeight = getPyramidHeight(obs);
  const flip = isPyramidFlatTop(obs);
  if (oHeight <= ZERO_TOLERANCE) return 1;

  // Height relative to the pyramid base, normalized.
  let z = (y - (obs.baseY || 0)) / oHeight;

  // When flipped, the widest intersection is at the top of the object, so the
  // occupant's own height is what reaches it.
  if (flip) z += height / oHeight;

  const shrink = flip ? z : 1 - z;
  if (shrink < 0) return 0;
  if (shrink > 1) return 1;
  return shrink;
}

// Local-space outward horizontal normal of an axis-aligned rectangle centered
// at the origin, for a point inside OR outside it. Mirrors
// src/game/Intersect.cxx getNormalOrigRect -- note that upstream always yields a
// normal, which is why a pyramid can never report "no surface" to slide on.
export function getOrigRectNormal(halfW, halfD, localX, localZ) {
  const normalize = (x, z) => {
    const length = Math.hypot(x, z);
    return length > 0 ? { x: x / length, z: z / length } : { x: 1, z: 0 };
  };

  if (localX > halfW) {
    if (localZ > halfD) return normalize(localX - halfW, localZ - halfD);
    if (localZ < -halfD) return normalize(localX - halfW, localZ + halfD);
    return { x: 1, z: 0 };
  }
  if (localX < -halfW) {
    if (localZ > halfD) return normalize(localX + halfW, localZ - halfD);
    if (localZ < -halfD) return normalize(localX + halfW, localZ + halfD);
    return { x: -1, z: 0 };
  }
  if (localZ > halfD) return { x: 0, z: 1 };
  if (localZ < -halfD) return { x: 0, z: -1 };

  // Inside: pick the nearer wall, weighted by the rectangle's aspect so a long
  // thin rib resolves to its long face rather than its end cap.
  if (halfD * Math.abs(localX) >= halfW * Math.abs(localZ)) {
    return { x: localX >= 0 ? 1 : -1, z: 0 };
  }
  return { x: 0, z: localZ >= 0 ? 1 : -1 };
}

// True when a point lies over the pyramid's base footprint.
//
// Colliding with a pyramid and being held up by one are different questions.
// getPyramidFaceLocalNormal deliberately answers everywhere, so the slide
// resolver always has a surface to work with. Support must additionally be
// contained, or a tank can be "held up" by a pyramid it is nowhere near.
export function isWithinPyramidFootprint(obs, x, z) {
  const local = getColliderLocalPoint(x, z, obs);
  return Math.abs(local.x) <= obs.w / 2 && Math.abs(local.z) <= obs.d / 2;
}

// Outward normal of a pyramid face at a point, in the obstacle's local frame,
// including the tilt from the slope. Mirrors PyramidBuilding::getNormal and
// getHitNormal: take the normal of the cross-section rectangle at the
// occupant's height, then angle it by the slope of the wall.
export function getPyramidFaceLocalNormal(obs, x, y, z, height = 0) {
  const shrink = pyramidShrinkFactor(obs, y, height);
  const local = getColliderLocalPoint(x, z, obs);
  const flat = getOrigRectNormal((obs.w / 2) * shrink, (obs.d / 2) * shrink, local.x, local.z);

  // Upstream notes this assumes a square base.
  const pyramidHeight = getPyramidHeight(obs);
  const baseHalfWidth = obs.w / 2;
  const scale = 1 / (Math.hypot(pyramidHeight, baseHalfWidth) || 1);
  return {
    x: flat.x * scale * pyramidHeight,
    y: (isPyramidFlatTop(obs) ? -1 : 1) * scale * baseHalfWidth,
    z: flat.z * scale * pyramidHeight
  };
}

// True when a cylinder of the given radius and height, whose base sits at y,
// intersects the solid volume of a pyramid. Upstream PyramidBuilding::inBox,
// with a circle footprint instead of a rotated rectangle.
export function pyramidIntersectsCylinder(obs, x, y, z, radius, height) {
  const baseY = obs.baseY || 0;
  // Occupant is entirely below the pyramid.
  if (y + height < baseY) return false;
  // Occupant is entirely above the pyramid.
  if (y >= baseY + getPyramidHeight(obs)) return false;

  const shrink = pyramidShrinkFactor(obs, y, height);
  if (shrink <= 0) return false;

  const local = getColliderLocalPoint(x, z, obs);
  return testOrigRectCircle((obs.w / 2) * shrink, (obs.d / 2) * shrink, local.x, local.z, radius);
}

// The tank box against a pyramid. The pyramid's cross-section shrinks with
// height exactly as it does for the cylinder test, so only the shape tested
// against it differs.
export function pyramidIntersectsTank(obs, x, y, z, rotation, height, slack = 0) {
  const baseY = obs.baseY || 0;
  if (y + height < baseY) return false;
  if (y >= baseY + getPyramidHeight(obs)) return false;

  const shrink = pyramidShrinkFactor(obs, y, height);
  if (shrink <= 0) return false;

  const local = getColliderLocalPoint(x, z, obs);
  return testOrigRectTank(
    (obs.w / 2) * shrink, (obs.d / 2) * shrink,
    local.x, local.z,
    getTankLocalAngle(rotation, obs.rotation),
    slack
  );
}

// BaseBuilding, as World::whoseBase reads it (World.cxx:181). A base's top
// surface is what counts: a tank captures by standing on it, not by driving
// past its side.
export function getBaseTopY(obs) {
  return (obs.baseY || 0) + (obs.h || 0);
}

// True when (x, y, z) is on this base's top face. Upstream tests the rotated
// rectangle and then the altitude against a 0.1 epsilon kludge -- its comment,
// and it is what lets a tank sitting on the surface count as on it.
export const BASE_TOP_TOLERANCE = 0.1;

export function isOnBaseTop(obs, x, y, z) {
  const { x: localX, z: localZ } = getColliderLocalPoint(x, z, obs);
  if (Math.abs(localX) >= obs.w / 2) return false;
  if (Math.abs(localZ) >= obs.d / 2) return false;
  return Math.abs(y - getBaseTopY(obs)) < BASE_TOP_TOLERANCE;
}

// Which team's base a point is standing on, as its BZFlag colour index, or null
// for none. Bases are the obstacles carrying kind 'base'.
export function getBaseTeamAtPoint(obstacles, x, y, z) {
  for (const obs of obstacles) {
    if (obs.kind !== 'base') continue;
    if (isOnBaseTop(obs, x, y, z)) return obs.team;
  }
  return null;
}

// The footprint test a flag drop uses, with no radius: DropGeometry gives a team
// flag a radius of 0, so only the point itself has to be over the surface.
export function isOverFlatTop(obs, x, z) {
  if (obs.type === 'pyramid') {
    if (!isPyramidFlatTop(obs)) return false;
    return isWithinPyramidFootprint(obs, x, z);
  }
  const { x: localX, z: localZ } = getColliderLocalPoint(x, z, obs);
  return Math.abs(localX) < obs.w / 2 && Math.abs(localZ) < obs.d / 2;
}
