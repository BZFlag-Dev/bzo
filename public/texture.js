/*
 * Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/timriker/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */

import * as THREE from 'three';

const textureLoader = new THREE.TextureLoader();

const BASE_TEAM_TINTS = {
  1: [1.0, 0.4, 0.4],
  2: [0.4, 1.0, 0.4],
  3: [0.4, 0.4, 1.0],
  4: [1.0, 0.4, 1.0],
};

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

export function createTeleporterBorderTexture() {
  return loadTexture('/textures/caution.png');
}

export function createTeleporterPortalTexture() {
  return loadTexture('/textures/telelink.png');
}

function createTintedTexture(path, tint = [1, 1, 1]) {
  const texture = new THREE.Texture();
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;

  textureLoader.load(path, (loadedTexture) => {
    const image = loadedTexture?.image;
    if (!image) {
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) {
      texture.image = image;
      texture.needsUpdate = true;
      return;
    }

    context.drawImage(image, 0, 0);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    const tr = Math.max(0, tint[0] ?? 1);
    const tg = Math.max(0, tint[1] ?? 1);
    const tb = Math.max(0, tint[2] ?? 1);

    for (let i = 0; i < pixels.length; i += 4) {
      const sr = pixels[i];
      const sg = pixels[i + 1];
      const sb = pixels[i + 2];
      const luminance = (0.2126 * sr) + (0.7152 * sg) + (0.0722 * sb);

      pixels[i] = Math.max(0, Math.min(255, Math.round(luminance * tr)));
      pixels[i + 1] = Math.max(0, Math.min(255, Math.round(luminance * tg)));
      pixels[i + 2] = Math.max(0, Math.min(255, Math.round(luminance * tb)));
    }

    context.putImageData(imageData, 0, 0);
    texture.image = canvas;
    texture.needsUpdate = true;
  });

  return texture;
}

function getBaseTint(team = 1) {
  const normalizedTeam = Number.isInteger(team) ? Math.max(1, Math.min(4, team)) : 1;
  return BASE_TEAM_TINTS[normalizedTeam] || BASE_TEAM_TINTS[1];
}

export function createBaseTopTexture(team = 1) {
  return createTintedTexture('/textures/base_top.png', getBaseTint(team));
}

export function createBaseWallTexture(team = 1) {
  return createTintedTexture('/textures/base_wall.png', getBaseTint(team));
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
