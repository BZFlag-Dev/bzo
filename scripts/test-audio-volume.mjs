/*
 * Copyright (C) 2025-2026 Tim Riker <tim.riker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/timriker/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */

import assert from 'node:assert/strict';
import {
  AUDIO_VOLUME_STORAGE_KEY,
  DEFAULT_AUDIO_VOLUME,
  VOICE_VOLUME_STORAGE_KEY,
  createAudioVolumeState,
  readAudioVolumeState,
  setAudioVolume,
  toggleAudioMute,
  writeAudioVolumeState,
} from '../public/audio-volume.mjs';

const defaultState = createAudioVolumeState();
assert.deepEqual(defaultState, {
  volume: DEFAULT_AUDIO_VOLUME,
  muted: false,
  restoreVolume: DEFAULT_AUDIO_VOLUME,
});

assert.deepEqual(createAudioVolumeState({ volume: 150 }), {
  volume: 100,
  muted: false,
  restoreVolume: 100,
});
assert.deepEqual(createAudioVolumeState({ volume: -20 }), {
  volume: 0,
  muted: true,
  restoreVolume: 100,
});
assert.deepEqual(createAudioVolumeState({ volume: 48.6 }), {
  volume: 49,
  muted: false,
  restoreVolume: 49,
});

const lowered = setAudioVolume(defaultState, 42);
assert.deepEqual(lowered, { volume: 42, muted: false, restoreVolume: 42 });

const muted = setAudioVolume(lowered, 0);
assert.deepEqual(muted, { volume: 0, muted: true, restoreVolume: 42 });
assert.deepEqual(toggleAudioMute(muted), lowered);
assert.deepEqual(toggleAudioMute(lowered), muted);
assert.deepEqual(setAudioVolume(muted, 17), {
  volume: 17,
  muted: false,
  restoreVolume: 17,
});

const storage = new Map();
const fakeStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
};
writeAudioVolumeState(fakeStorage, muted);
assert.equal(storage.has(AUDIO_VOLUME_STORAGE_KEY), true);
assert.deepEqual(readAudioVolumeState(fakeStorage), muted);

const voiceState = setAudioVolume(defaultState, 63);
writeAudioVolumeState(fakeStorage, voiceState, VOICE_VOLUME_STORAGE_KEY);
assert.equal(storage.has(VOICE_VOLUME_STORAGE_KEY), true);
assert.deepEqual(readAudioVolumeState(fakeStorage, VOICE_VOLUME_STORAGE_KEY), voiceState);

storage.set(AUDIO_VOLUME_STORAGE_KEY, '{not-json');
assert.deepEqual(readAudioVolumeState(fakeStorage), defaultState);
assert.deepEqual(readAudioVolumeState(null), defaultState);

console.log('audio volume tests passed');
