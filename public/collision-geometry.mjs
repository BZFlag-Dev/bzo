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
