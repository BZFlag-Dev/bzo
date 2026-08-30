/*
 * Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/timriker/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */

// audio.js - Gameplay sound manifest and loading.
//
// Samples come from upstream BZFlag (bzflag/data/*.wav) so bzo sounds like the
// game it mirrors. The `sfx` column below is BZFlag's sound code from
// src/bzflag/sound.h, resolved through the soundFiles[] table in
// src/bzflag/sound.cxx.
//
// Both the server and the client ship from this repo, so these files are always
// present. Do not add fallbacks for missing audio -- a failed load is a broken
// build and should surface as an error.

export const AUDIO_BASE_PATH = '/audio';

// BZFlag's attenuation, from getWorldStuff()/recalcEventDistance() in
// src/bzflag/sound.cxx:
//
//   minEventDist = 20.0f * 4.32f            // 20 tank radii = 86.4
//   amplitude = (d < minEventDist) ? 1.0f : minEventDist / d
//
// That is inverse-distance rolloff with a rolloff factor of 1, clamped to full
// volume inside the reference distance -- exactly the Web Audio "inverse"
// distance model. bzo's world is 1:1 with BZFlag's (both 800 units across), so
// the constant transfers unchanged. Note it is deliberately BZFlag's tank
// radius of 4.32 and not bzo's 2: the figure scales with the world, not with
// the vehicle, so a shot 200 units away sounds the same in both games.
export const SOUND_REF_DISTANCE = 20 * 4.32;
export const SOUND_ROLLOFF_FACTOR = 1;
export const SOUND_DISTANCE_MODEL = 'inverse';

// BZFlag has no per-sound volume. Every sample plays at its recorded level,
// scaled only by the global setting (volumeAtten in sound.cxx) and by distance.
// The samples are pre-mixed relative to each other, so adding per-sound gain
// here would undo that balance. Adjust this one number, not the table below.
export const MASTER_VOLUME = 1;

export const GAME_SOUNDS = Object.freeze({
  // A shot is fired.
  fire: { file: 'fire.wav', sfx: 'SFX_FIRE' },
  // A shot expires or hits an obstacle.
  shotBoom: { file: 'boom.wav', sfx: 'SFX_SHOT_BOOM' },
  // A tank is destroyed.
  explosion: { file: 'explosion.wav', sfx: 'SFX_EXPLOSION' },
  // A tank jumps.
  jump: { file: 'jump.wav', sfx: 'SFX_JUMP' },
  // A tank lands.
  land: { file: 'land.wav', sfx: 'SFX_LAND' },
  // A tank passes through a teleporter.
  teleport: { file: 'teleport.wav', sfx: 'SFX_TELEPORT' },
  // A tank appears. BZFlag's SFX_POP is the tank-appeared sound.
  pop: { file: 'pop.wav', sfx: 'SFX_POP' },
});

export const GAME_SOUND_NAMES = Object.freeze(Object.keys(GAME_SOUNDS));

export function getSoundPath(name) {
  const sound = GAME_SOUNDS[name];
  if (!sound) throw new Error(`Unknown sound "${name}"`);
  return `${AUDIO_BASE_PATH}/${sound.file}`;
}

export function getSoundPaths() {
  return GAME_SOUND_NAMES.map(getSoundPath);
}

export async function loadAudioBuffer(audioContext, url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load audio buffer from ${url}: ${response.status}`);
  }
  const audioData = await response.arrayBuffer();
  return await audioContext.decodeAudioData(audioData);
}
