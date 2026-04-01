/*
 * Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/BZFlag-Dev/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */

import * as THREE from 'three';

const textureLoader = new THREE.TextureLoader();

function loadTexture(path) {
  const texture = textureLoader.load(path);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export function createBoundaryTexture() {
  return loadTexture('/textures/wall.png');
}

export function createBoxWallTexture() {
  return loadTexture('/textures/boxwall.png');
}

export function createRoofTexture() {
  return loadTexture('/textures/roof.png');
}

export function createPyramidTexture() {
  return loadTexture('/textures/pyrwall.png');
}

export function createGroundTexture() {
  return loadTexture('/textures/std_ground.png');
}

export function createWallTexture() {
  return createBoundaryTexture();
}

export function createObstacleTexture() {
  return createRoofTexture();
}
