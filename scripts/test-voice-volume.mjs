#!/usr/bin/env node
/*
 * Copyright (C) 2025-2026 Tim Riker <tim.riker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/timriker/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */

import assert from 'node:assert/strict';
import { createVoiceManager } from '../public/voice.js';

const audios = [];
const body = {
  appendChild(audio) {
    audio.parentNode = body;
    audios.push(audio);
  },
  removeChild(audio) {
    const index = audios.indexOf(audio);
    if (index >= 0) audios.splice(index, 1);
    audio.parentNode = null;
  },
};

globalThis.document = {
  body,
  createElement(tagName) {
    assert.equal(tagName, 'audio');
    return {
      autoplay: false,
      playsInline: false,
      volume: 1,
      dataset: {},
      style: {},
      parentNode: null,
      srcObject: null,
      setAttribute() {},
      pause() {},
      play: () => Promise.resolve(),
    };
  },
};

class FakePeerConnection {
  connectionState = 'new';
  iceConnectionState = 'new';

  addTransceiver() {
    return {
      sender: { replaceTrack: async () => {} },
      setCodecPreferences() {},
    };
  }

  close() {}
}

const manager = createVoiceManager({
  autoStart: false,
  localPlayerId: '1',
  team: 'observer',
  voiceVolume: 35,
  RTCPeerConnection: FakePeerConnection,
});

assert.equal(manager.getState().voiceVolume, 35);
assert.equal(manager.handleServerMessage({
  type: 'voiceRoster',
  peers: [{ id: '2', team: 'rogue' }],
}), true);
assert.equal(audios.length, 1);
assert.equal(audios[0].volume, 0.35);

assert.equal(manager.setVoiceVolume(72).voiceVolume, 72);
assert.equal(audios[0].volume, 0.72);

assert.equal(manager.setVoiceVolume(200).voiceVolume, 100);
assert.equal(audios[0].volume, 1);
assert.equal(manager.setVoiceVolume(-1).voiceVolume, 0);
assert.equal(audios[0].volume, 0);

await manager.shutdown();
assert.equal(audios.length, 0);

console.log('voice volume tests passed');
