/*
 * Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/timriker/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */

// The gameplay audio control is one gain applied to Three.js's AudioListener.
// Keeping the state pure makes the mute/restore rules deterministic in the HUD,
// the renderer, and the persistence tests.

export const DEFAULT_AUDIO_VOLUME = 100;
export const AUDIO_VOLUME_STORAGE_KEY = 'bzo.gameAudio';

function normalizePercent(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.round(Math.max(0, Math.min(100, numeric)));
}

export function createAudioVolumeState(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const volume = normalizePercent(source.volume, DEFAULT_AUDIO_VOLUME);
  const restoreVolume = normalizePercent(
    source.restoreVolume,
    volume > 0 ? volume : DEFAULT_AUDIO_VOLUME,
  );
  const muted = source.muted === true || volume === 0;

  return {
    volume: muted ? 0 : volume,
    muted,
    restoreVolume: restoreVolume > 0 ? restoreVolume : DEFAULT_AUDIO_VOLUME,
  };
}

export function setAudioVolume(state, value) {
  const current = createAudioVolumeState(state);
  const volume = normalizePercent(value, current.volume);
  if (volume === 0) {
    return {
      volume: 0,
      muted: true,
      restoreVolume: current.restoreVolume > 0 ? current.restoreVolume : DEFAULT_AUDIO_VOLUME,
    };
  }
  return {
    volume,
    muted: false,
    restoreVolume: volume,
  };
}

export function toggleAudioMute(state) {
  const current = createAudioVolumeState(state);
  if (current.muted) {
    return setAudioVolume(current, current.restoreVolume);
  }
  return {
    volume: 0,
    muted: true,
    restoreVolume: current.volume > 0 ? current.volume : current.restoreVolume,
  };
}

export function readAudioVolumeState(storage) {
  if (!storage || typeof storage.getItem !== 'function') {
    return createAudioVolumeState();
  }

  try {
    const raw = storage.getItem(AUDIO_VOLUME_STORAGE_KEY);
    if (!raw) return createAudioVolumeState();
    return createAudioVolumeState(JSON.parse(raw));
  } catch {
    return createAudioVolumeState();
  }
}

export function writeAudioVolumeState(storage, state) {
  const normalized = createAudioVolumeState(state);
  if (storage && typeof storage.setItem === 'function') {
    try {
      storage.setItem(AUDIO_VOLUME_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // A blocked or full storage area must not stop the game audio control.
    }
  }
  return normalized;
}
