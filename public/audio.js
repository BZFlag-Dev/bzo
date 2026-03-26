/*
 * Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/BZFlag-Dev/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */

// audio.js - Handles sound buffer creation and exposes buffers for positional audio

// Pop/Mini-explosion for projectile removal
export function createProjectilePopBuffer(audioContext) {
  const sampleRate = audioContext.sampleRate;
  const duration = 0.11; // still very brief, but a bit longer for impact
  const length = Math.floor(sampleRate * duration);
  const buffer = audioContext.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Impact: burst of white noise with a sharp, fast decay
    const decay = Math.exp(-t * 32);
    const noise = (Math.random() * 2 - 1) * decay * 0.85;
    // Add a low, quick thump for body
    const thump = Math.sin(2 * Math.PI * 90 * t) * Math.exp(-t * 22) * 0.4;
    // Add a little high-frequency crack for sharpness
    const crack = Math.sin(2 * Math.PI * 1800 * t) * Math.exp(-t * 40) * 0.18;
    data[i] = noise + thump + crack;
  }
  return buffer;
}

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
  const duration = 0.16;
  const length = Math.floor(sampleRate * duration);
  const buffer = audioContext.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const body = Math.sin(2 * Math.PI * (118 - t * 120) * t) * Math.exp(-t * 18) * 0.58;
    const thump = Math.sin(2 * Math.PI * (72 - t * 48) * t) * Math.exp(-t * 24) * 0.45;
    const smack = (Math.random() * 2 - 1) * Math.exp(-t * 34) * 0.22;
    const click = Math.sin(2 * Math.PI * 700 * t) * Math.exp(-t * 42) * 0.05;
    data[i] = (body + thump + smack + click) * 0.92;
  }
  return buffer;
}
