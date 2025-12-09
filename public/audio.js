/*
 * This file is part of a project licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * See the LICENSE file in the project root or visit https://www.gnu.org/licenses/agpl-3.0.html
 */

// audio.js - Handles sound buffer creation and exposes buffers for positional audio
import * as THREE from 'three';

export function createShootBuffer(audioContext) {
  const sampleRate = audioContext.sampleRate;
  const duration = 0.2;
  const length = sampleRate * duration;
  const buffer = audioContext.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const frequency = 800 - (t * 3000);
    const decay = Math.exp(-t * 15);
    data[i] = Math.sin(2 * Math.PI * frequency * t) * decay * 0.3;
  }
  return buffer;
}

export function createExplosionBuffer(audioContext) {
  const sampleRate = audioContext.sampleRate;
  const duration = 0.5;
  const length = sampleRate * duration;
  const buffer = audioContext.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const frequency = 100 - (t * 80);
    const decay = Math.exp(-t * 5);
    const noise = (Math.random() * 2 - 1) * 0.3;
    const tone = Math.sin(2 * Math.PI * frequency * t) * 0.7;
    data[i] = (tone + noise) * decay * 0.4;
  }
  return buffer;
}

export function createJumpBuffer(audioContext) {
  const sampleRate = audioContext.sampleRate;
  const duration = 0.15;
  const length = sampleRate * duration;
  const buffer = audioContext.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const frequency = 200 + (t * 400);
    const envelope = Math.sin((t / duration) * Math.PI);
    data[i] = Math.sin(2 * Math.PI * frequency * t) * envelope * 0.2;
  }
  return buffer;
}

export function createLandBuffer(audioContext) {
  const sampleRate = audioContext.sampleRate;
  const duration = 0.1;
  const length = sampleRate * duration;
  const buffer = audioContext.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const frequency = 80 - (t * 60);
    const decay = Math.exp(-t * 30);
    const noise = (Math.random() * 2 - 1) * 0.2;
    const tone = Math.sin(2 * Math.PI * frequency * t) * 0.8;
    data[i] = (tone + noise) * decay * 0.3;
  }
  return buffer;
}
