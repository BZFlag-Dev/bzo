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
// Keep this file byte-identical in behavior with server/collision-geometry.cjs.
// scripts/test-collision-geometry.mjs enforces that.

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
