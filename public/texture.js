/*
 * This file is part of a project licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * See the LICENSE file in the project root or visit https://www.gnu.org/licenses/agpl-3.0.html
 */

// Blue marble texture for BZFlag-style pyramid sides
export function createPyramidTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  // Base blue fill
  ctx.fillStyle = '#2a3a6e';
  ctx.fillRect(0, 0, 256, 256);

  // Marble veins: white and light blue squiggles
  for (let i = 0; i < 18; i++) {
    ctx.save();
    ctx.globalAlpha = 0.18 + Math.random() * 0.12;
    ctx.strokeStyle = Math.random() < 0.5 ? '#b8d0ff' : '#e0e8ff';
    ctx.lineWidth = 2 + Math.random() * 2;
    ctx.beginPath();
    let x = Math.random() * 256;
    let y = Math.random() * 256;
    ctx.moveTo(x, y);
    for (let j = 0; j < 7 + Math.random() * 6; j++) {
      x += (Math.random() - 0.5) * 32;
      y += (Math.random() - 0.5) * 32;
      ctx.lineTo(Math.max(0, Math.min(255, x)), Math.max(0, Math.min(255, y)));
    }
    ctx.stroke();
    ctx.restore();
  }

  // Subtle blue/white cloudy blobs
  for (let i = 0; i < 30; i++) {
    const cx = Math.random() * 256;
    const cy = Math.random() * 256;
    const r = 18 + Math.random() * 28;
    const grad = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
    grad.addColorStop(0, 'rgba(180,200,255,0.18)');
    grad.addColorStop(1, 'rgba(42,58,110,0)');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}
/*
 * This file is part of a project licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * See the LICENSE file in the project root or visit https://www.gnu.org/licenses/agpl-3.0.html
 */

import * as THREE from 'three';

export function createCobblestoneTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#333';
  ctx.fillRect(0, 0, 256, 256);

  const rows = 8;
  const cols = 8;
  const stoneW = 28;
  const stoneH = 28;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const offsetX = (y % 2) * (stoneW / 2);
      const cx = x * stoneW + offsetX + stoneW / 2 + 4 * Math.random();
      const cy = y * stoneH + stoneH / 2 + 4 * Math.random();
      ctx.beginPath();
      ctx.ellipse(cx, cy, stoneW * 0.45, stoneH * 0.4, 0, 0, Math.PI * 2);
      const shade = Math.floor(40 + Math.random() * 40);
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx - 4, cy - 4, stoneW * 0.12, stoneH * 0.10, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(200,200,200,0.08)';
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + 4, cy + 4, stoneW * 0.12, stoneH * 0.10, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fill();
    }
  }

  ctx.strokeStyle = 'rgba(80,80,80,0.5)';
  ctx.lineWidth = 2;
  for (let y = 0; y <= rows; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * stoneH);
    ctx.lineTo(256, y * stoneH);
    ctx.stroke();
  }
  for (let x = 0; x <= cols; x++) {
    ctx.beginPath();
    ctx.moveTo(x * stoneW, 0);
    ctx.lineTo(x * stoneW, 256);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export function createGroundTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#3a8c3a';
  ctx.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 5000; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const shade = Math.random() * 0.2 - 0.1;
    ctx.fillStyle = `rgb(${Math.floor(58 + shade * 58)}, ${Math.floor(140 + shade * 140)}, ${Math.floor(58 + shade * 58)})`;
    ctx.fillRect(x, y, 2, 2);
  }

  ctx.strokeStyle = 'rgba(0, 0, 0, 0.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 256; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 256);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(256, i);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export function createWallTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#8B4513';
  ctx.fillRect(0, 0, 256, 256);

  const brickWidth = 64;
  const brickHeight = 32;
  const mortarSize = 2;

  ctx.strokeStyle = '#654321';
  ctx.lineWidth = mortarSize;

  for (let y = 0; y < 256; y += brickHeight) {
    for (let x = 0; x < 256; x += brickWidth) {
      const offsetX = (y / brickHeight) % 2 === 0 ? 0 : brickWidth / 2;
      const variation = Math.random() * 30 - 15;
      ctx.fillStyle = `rgb(${139 + variation}, ${69 + variation * 0.5}, ${19 + variation * 0.3})`;
      ctx.fillRect(x + offsetX, y, brickWidth - mortarSize, brickHeight - mortarSize);
      ctx.strokeRect(x + offsetX, y, brickWidth - mortarSize, brickHeight - mortarSize);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export function createObstacleTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#666666';
  ctx.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 8000; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const shade = Math.random() * 0.3 - 0.15;
    const brightness = Math.floor(102 + shade * 102);
    ctx.fillStyle = `rgb(${brightness}, ${brightness}, ${brightness})`;
    const size = Math.random() * 2;
    ctx.fillRect(x, y, size, size);
  }

  ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 10; i++) {
    ctx.beginPath();
    let x = Math.random() * 256;
    let y = Math.random() * 256;
    ctx.moveTo(x, y);
    for (let j = 0; j < 5; j++) {
      x += (Math.random() - 0.5) * 50;
      y += (Math.random() - 0.5) * 50;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}
