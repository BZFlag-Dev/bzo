/*
 * Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/timriker/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */
const CHAT_VISIBLE_MESSAGES = 6;
const CHAT_SCROLLBACK_LIMIT = 600;
const CHAT_SCROLL_STEP = 3;
const CHAT_MIN_WIDTH_WITH_DEBUG = 560;
const CHAT_DEBUG_PANEL_RESERVE = 352;
const CHAT_TARGET_ALL = 0;
const CHAT_TARGET_SERVER = -1;
const CHAT_KIND_CHAT = 'chat';
const CHAT_KIND_ACTION = 'action';
const CHAT_KIND_SERVER = 'server';
const CHAT_KIND_MISC = 'misc';
const CHAT_KIND_DEBUG = 'debug';
const CHAT_KIND_DIRECT_IN = 'direct-in';
const CHAT_KIND_DIRECT_OUT = 'direct-out';
const CLIENT_COPYRIGHT = 'Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>';
const CLIENT_LICENSE = 'AGPL-3.0-only';
const CLIENT_LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';
const CHAT_TABS = [
  { id: 'all', label: 'All' },
  { id: 'chat', label: 'Chat' },
  { id: 'server', label: 'Server' },
  { id: 'misc', label: 'Misc' },
  { id: 'debug', label: 'Debug' },
];
const chatState = {
  activeTab: 'all',
  messages: {
    all: [],
    chat: [],
    server: [],
    misc: [],
    debug: [],
  },
  scrollOffsets: {
    all: 0,
    chat: 0,
    server: 0,
    misc: 0,
    debug: 0,
  },
  unread: {
    all: false,
    chat: false,
    server: false,
    misc: false,
    debug: false,
  }
};
let lastDirectSenderId = null;
let nemesisPlayerId = null;
let chatInput = null;
let sendBtn = null;
let chatActive = false;
let virtualControlsEnabled = false;
let latency = 0;
let sentBps = 0;
let sentBytes = 0;
let lastSentBytesUpdate = performance.now();
let receivedBps = 0;
let receivedBytes = 0;
let lastReceivedBytesUpdate = performance.now();

import {
  setupInputHandlers,
  virtualInput,
  keys,
  initHudControls,
  latestOrientation,
  toggleMouseMode,
  isMobile,
  updateVirtualInputFromXR,
  updateVirtualInputFromGamepad,
  isGamepadConnected,
  getGamepadInfo,
  isGameplayInputActive,
  activateXRSettingsMenuItem,
  closeSettingsDialog,
  getXRSettingsMenuItems,
  dismissDialogFromOutsideClick,
  refreshSettingsMenu,
  registerGameplayInputReset,
  setGameplayKeyState,
  setInputContext,
  syncInputContextFromUi
} from './input.js';
import { XRMenuRenderer } from './xr-menu.js';
import {
  colorToCSS,
  formatTeamScore,
  getTeamScoreRows,
  updateDebugDisplay,
  updateHudButtons,
  toggleDebugHud,
  toggleDebugLabels,
  updateScoreboard,
  updateAltimeter,
  updateDegreeBar,
  updateShotStatus,
  roundedRect,
  readStoredFlag,
  bindToggleButton
} from './hud.js';
import { renderManager } from './render.js';
import { describeMeasurements, describeRenderCapabilities } from './capabilities.mjs';
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import {
  initXR,
  isHeadsetAppLaunch,
  isHeadsetDevice,
  isSystemKeyboardSupported,
  XR_LAUNCH_SESSION_EVENT,
  toggleXRSession,
  updateXRControllerInput,
  getXRControllerInput,
  setNormalAnimationLoop,
  isXREnabled,
} from './webxr.js';
import { INPUT_CONTEXT } from './input-context.mjs';
import {
  PLAYER_TEAM,
  PLAYER_TEAMS,
  PLAYER_TEAM_LABELS,
  getPlayerTeamColor,
  getPlayerTeamSelections,
  isObserverTeam,
  normalizePlayerTeam,
  normalizePlayerTeamSelection,
} from './teams.mjs';
import { createVoiceManager } from './voice.js';
import { normalizeShotSlotCount } from './shots.mjs';
import { CLIENT_VERSION } from './version.mjs';
import { getSoundPaths } from './audio.js';
import { readAudioVolumeState, writeAudioVolumeState } from './audio-volume.mjs';
import { setupInstallPrompt } from './install.js';
import {
  getColliderLocalPoint,
  getOrigRectNormal,
  getPyramidHeight,
  getTankLocalAngle,
  pyramidShrinkFactor,
  getPyramidFaceLocalNormal,
  getPyramidSurfaceLocalHeight,
  isWithinPyramidFootprint,
  pyramidIntersectsTank,
  testOrigRectTank,
} from './collision.mjs';
import { resolveTankMotion } from './motion.mjs';

function readPersistedGameAudioState() {
  try {
    return readAudioVolumeState(window.localStorage);
  } catch {
    return readAudioVolumeState(null);
  }
}

function persistGameAudioState(state) {
  try {
    writeAudioVolumeState(window.localStorage, state);
  } catch {
    // A blocked storage area must not stop the audio controls from working.
  }
}

function setGameAudioVolume(value) {
  const state = renderManager.setGameAudioVolume(value);
  persistGameAudioState(state);
  return state;
}

function toggleGameAudioMute() {
  const state = renderManager.toggleGameAudioMute();
  persistGameAudioState(state);
  return state;
}

// Hydrate the renderer before the HUD binds, so the first visible state and the
// AudioListener gain agree even while the initial scene is still loading.
renderManager.setGameAudioState(readPersistedGameAudioState());

// Register the service worker that makes the game installable and serves its
// assets from disk. The version rides in the script URL, so a release changes
// the worker's identity and forces a fresh install of its cache.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`/sw.js?v=${CLIENT_VERSION}`).catch(() => {});
  });
}

// FPS
let fps = 0;
let frameCount = 0;
let lastFpsUpdate = performance.now();
// How long after a map is built the one automatic renderer.stats line waits.
const RENDER_STATS_SAMPLE_DELAY_MS = 10000;

// Where the frame's time goes, in milliseconds per frame averaged over a second.
// One saturated core is the budget on the machines that matter, so the split
// between world simulation, HUD painting and draw submission is what decides
// which cost is worth attacking -- a figure no frame rate can give on its own.
// Sampled with performance.now() on purpose: this measures work done, not the
// display cadence the frame timestamp carries.
const FRAME_PHASE_WINDOW_MS = 1000;
const FRAME_PHASES = Object.freeze(['xr', 'hud', 'input', 'shadows', 'sim', 'radar', 'render']);
const framePhaseTotals = new Map();
let framePhaseMark = 0;
let framePhaseWindowStart = performance.now();
let framePhaseFrames = 0;
let framePhaseReport = null;

function markFramePhase(name) {
  const mark = performance.now();
  framePhaseTotals.set(name, (framePhaseTotals.get(name) || 0) + (mark - framePhaseMark));
  framePhaseMark = mark;
}

function rollFramePhases() {
  framePhaseFrames += 1;
  if ((performance.now() - framePhaseWindowStart) < FRAME_PHASE_WINDOW_MS) return;

  const report = {};
  for (const name of FRAME_PHASES) {
    report[name] = Number(((framePhaseTotals.get(name) || 0) / framePhaseFrames).toFixed(2));
  }
  framePhaseReport = report;
  framePhaseTotals.clear();
  framePhaseFrames = 0;
  framePhaseWindowStart = performance.now();
}

function updateFps() {
  frameCount++;
  const now = performance.now();
  if (now - lastFpsUpdate >= 500) { // update every 0.5s
    fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
    frameCount = 0;
    lastFpsUpdate = now;
  }
  // Update sentBps every second
  if (now - lastSentBytesUpdate >= 1000) {
    sentBps = Math.round(sentBytes / ((now - lastSentBytesUpdate) / 1000));
    sentBytes = 0;
    lastSentBytesUpdate = now;
  }
  // Update receivedBps every second
  if (now - lastReceivedBytesUpdate >= 1000) {
    receivedBps = Math.round(receivedBytes / ((now - lastReceivedBytesUpdate) / 1000));
    receivedBytes = 0;
    lastReceivedBytesUpdate = now;
  }
}

// Game state
let scene;
let camera;
let myPlayerId = null;
let myPlayerName = '';
let myTank = null;
let tanks = new Map();
let projectiles = new Map();
let pendingLocalProjectiles = [];
let localProjectileCounter = 0;
const SHOT_SIM_STEP_SECONDS = 1 / 60;
const SHOT_SIM_MAX_STEPS_PER_FRAME = 8;
let projectileSimAccumulator = 0;
let ws = null;
let gameConfig = null;
let serverDescriptionText = '';
let serverMotdText = '';
let startupBuildInfoAnnounced = false;
let lastAnnouncedServerDescription = null;
let lastAnnouncedServerMotd = null;
let radarCanvas, radarCtx;
// One record per XR HUD overlay: the canvas it paints, the texture wrapping it,
// and the camera-parented plane it draws on. ensureXRHudPanel fills them in.
// `planeWidth`/`planeHeight` are the size the plane was last built at, so a
// frame that asks for the size it already has does not rebuild the geometry.
const xrRadarPanel = { canvas: null, texture: null, mesh: null, planeWidth: 0, planeHeight: 0 };
const xrChatPanel = { canvas: null, texture: null, mesh: null, planeWidth: 0, planeHeight: 0 };
const xrShotStatusPanel = { canvas: null, texture: null, mesh: null, planeWidth: 0, planeHeight: 0 };
const xrScoreboardPanel = { canvas: null, texture: null, mesh: null, planeWidth: 0, planeHeight: 0 };
const XR_HUD_PANELS = [xrRadarPanel, xrChatPanel, xrShotStatusPanel, xrScoreboardPanel];
const XR_HUD_PLANE_Z = -0.85;
const XR_RADAR_PLANE_SIZE = 0.45;
const XR_CHAT_PLANE_WIDTH = 0.9;
// BZFlag fires with Enter or the left mouse button and keeps the space bar for
// dropping a flag (ActionBinding.cxx:92-95).
const FIRE_KEY = 'Enter';
const RADAR_ZOOM_LEVELS = [0.25, 0.5, 1.0];
const RADAR_ZOOM_LABELS = ['Short', 'Medium', 'Long'];
// BZFlag's displayRadarRange default (defaultBZDB.cxx). The level is deliberately
// not persisted: a headset has no key or button to zoom with, so every session
// starts at a range that reads well on every device.
const RADAR_ZOOM_DEFAULT = 0.5;
const RADAR_ZOOM_MIN = 0.005;
const RADAR_ZOOM_MAX = 2.0;
const RADAR_ZOOM_STEP = 1.05;
let radarZoomLevel = RADAR_ZOOM_DEFAULT;
const pendingDebugPackets = [];
let pendingJoinRequest = null;
let renderReadyForJoin = false;
let gameplayJoinConfirmed = false;
let initSequence = 0;
let activeInitSequence = 0;
let xrSettingsShortcutLatched = false;
let xrSettingsShortcutInFlight = false;
let xrSettingsMenuOpen = false;
let xrHudOverlaysActive = false;
let xrSettingsMenuScreen = 'settings';
let xrSettingsMenuRenderer = null;
let xrSettingsMenuSelectedIndex = 0;
let xrSettingsMenuNavigationDirection = 0;
let xrSettingsMenuNextRepeatAt = 0;
let xrSettingsMenuActivateLatched = false;
let xrSettingsMenuBackLatched = false;
let nextAllowedShotAt = 0;
let playerTeam = PLAYER_TEAM.ROGUE;
// One entry per colour team the server offers: { team, size, wins, losses }.
// Empty until a team-mode server sends its first update.
let teamScores = [];
let selectedPlayerTeam = PLAYER_TEAM.AUTOMATIC;
let availablePlayerTeams = [PLAYER_TEAM.ROGUE, PLAYER_TEAM.OBSERVER];
let selectedVoiceInputDeviceId = '';
let voiceRtcConfig = { iceServers: [] };
let voiceManager = null;
let voiceManagerState = {
  channel: 'nearby',
  team: PLAYER_TEAM.ROGUE,
  microphonePermission: 'prompt',
  microphoneEnabled: false,
  transmitting: false,
  hasLocalStream: false,
  canTransmit: true,
  lastError: null,
};

const VOICE_CHANNEL = 'nearby';
function getSelectedPlayerTeam() {
  const teamSelector = document.getElementById('entryTeamSelector');
  return teamSelector ? normalizePlayerTeamSelection(teamSelector.dataset.team) : selectedPlayerTeam;
}

function syncPlayerTeamSelector() {
  const teamSelector = document.getElementById('entryTeamSelector');
  const teamValue = document.getElementById('entryTeamValue');
  const label = PLAYER_TEAM_LABELS[selectedPlayerTeam];
  if (teamSelector) {
    teamSelector.dataset.team = selectedPlayerTeam;
    teamSelector.setAttribute('aria-label', `Team: ${label}`);
  }
  if (teamValue) teamValue.textContent = label;
}

function updatePlayerTeamSelectorAvailability() {
  const teamSelector = document.getElementById('entryTeamSelector');
  if (teamSelector) teamSelector.disabled = gameplayJoinConfirmed;
}

function setAvailablePlayerTeams(teams) {
  availablePlayerTeams = PLAYER_TEAMS.filter((team) => teams.includes(team));
  if (selectedPlayerTeam !== PLAYER_TEAM.AUTOMATIC && !availablePlayerTeams.includes(selectedPlayerTeam)) {
    selectedPlayerTeam = PLAYER_TEAM.AUTOMATIC;
  }
  syncPlayerTeamSelector();
}

function selectRelativePlayerTeam(direction, { allowJoined = false } = {}) {
  if (gameplayJoinConfirmed && !allowJoined) {
    syncPlayerTeamSelector();
    return;
  }
  const teamSelections = getPlayerTeamSelections(availablePlayerTeams);
  const currentIndex = teamSelections.indexOf(selectedPlayerTeam);
  const nextIndex = (currentIndex + direction + teamSelections.length) % teamSelections.length;
  selectedPlayerTeam = teamSelections[nextIndex];
  syncPlayerTeamSelector();
}

function isObserver() {
  return isObserverTeam(playerTeam);
}

function normalizeRadarZoomLevel(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return RADAR_ZOOM_DEFAULT;
  return Math.max(RADAR_ZOOM_MIN, Math.min(RADAR_ZOOM_MAX, numeric));
}

function getRadarZoomLabel(level = radarZoomLevel) {
  const index = RADAR_ZOOM_LEVELS.findIndex((preset) => Math.abs(level - preset) < 1e-4);
  if (index >= 0) return RADAR_ZOOM_LABELS[index];
  const rounded = Math.round(level * 1000) / 1000;
  return `${rounded}x`;
}

function updateRadarZoomButton() {
  const radarZoomBtn = document.getElementById('radarZoomBtn');
  if (!radarZoomBtn) return;
  const label = getRadarZoomLabel();
  radarZoomBtn.textContent = `Radar: ${label}`;
  radarZoomBtn.title = `Radar range preset: ${label}`;
}

function setRadarZoomLevel(level, { announce = true } = {}) {
  const normalized = normalizeRadarZoomLevel(level);
  if (normalized === radarZoomLevel) return false;
  radarZoomLevel = normalized;
  updateRadarZoomButton();
  if (announce) {
    showMessage(`Radar range: ${getRadarZoomLabel(radarZoomLevel)}`);
  }
  return true;
}

function cycleRadarZoomLevel() {
  let nearestIndex = 0;
  let nearestDelta = Math.abs(radarZoomLevel - RADAR_ZOOM_LEVELS[0]);
  for (let i = 1; i < RADAR_ZOOM_LEVELS.length; i++) {
    const delta = Math.abs(radarZoomLevel - RADAR_ZOOM_LEVELS[i]);
    if (delta < nearestDelta) {
      nearestDelta = delta;
      nearestIndex = i;
    }
  }
  const nextIndex = (nearestIndex + 1) % RADAR_ZOOM_LEVELS.length;
  setRadarZoomLevel(RADAR_ZOOM_LEVELS[nextIndex]);
}

function adjustRadarZoom(direction) {
  if (direction > 0) {
    setRadarZoomLevel(radarZoomLevel * RADAR_ZOOM_STEP);
  } else if (direction < 0) {
    setRadarZoomLevel(radarZoomLevel / RADAR_ZOOM_STEP);
  }
}

function callVoiceManager(method, ...args) {
  if (!voiceManager || typeof voiceManager[method] !== 'function') {
    return { called: false, value: undefined };
  }
  try {
    return { called: true, value: voiceManager[method](...args) };
  } catch (error) {
    console.error(`[Voice] ${method} failed:`, error);
    showMessage(`Voice error: ${error.message || 'operation failed'}`);
    return { called: true, value: undefined };
  }
}

function getShotReloadTimeMs() {
  const configuredReload = Number(gameConfig?.SHOT_RELOAD_TIME);
  if (Number.isFinite(configuredReload) && configuredReload > 0) {
    return configuredReload;
  }
  return 1000;
}

function getVoiceAudioSettings() {
  return {
    echoCancellation: document.getElementById('voiceEchoCancellation')?.checked !== false,
    noiseSuppression: document.getElementById('voiceNoiseSuppression')?.checked !== false,
    autoGainControl: document.getElementById('voiceAutoGainControl')?.checked !== false,
  };
}

function getVoiceState() {
  if (voiceManager && typeof voiceManager.getState === 'function') {
    try {
      return { ...voiceManagerState, ...voiceManager.getState() };
    } catch (error) {
      console.error('[Voice] Could not read manager state:', error);
    }
  }
  return { ...voiceManagerState };
}

function updateVoiceInputDevices(devices = []) {
  const input = document.getElementById('voiceInputDevice');
  if (!input) return;

  const previousValue = selectedVoiceInputDeviceId || input.value || '';
  input.replaceChildren();

  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = 'Default microphone';
  input.appendChild(defaultOption);

  if (Array.isArray(devices)) {
    devices.forEach((device) => {
      if (!device || typeof device.deviceId !== 'string') return;
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || 'Microphone';
      input.appendChild(option);
    });
  }

  selectedVoiceInputDeviceId = previousValue;
  input.value = previousValue;
  if (input.value !== previousValue) {
    selectedVoiceInputDeviceId = '';
    input.value = '';
  }
}

function updateVoiceHud(nextState = null) {
  const state = nextState && typeof nextState === 'object'
    ? { ...voiceManagerState, ...nextState }
    : getVoiceState();
  voiceManagerState = state;

  const hud = document.getElementById('voiceChannelHud');
  const label = hud?.querySelector('.voiceChannelHudLabel');
  const statusElement = document.getElementById('voiceChannelHudStatus');
  const permissionStatus = document.getElementById('voicePermissionStatus');
  const permissionButton = document.getElementById('voiceRequestPermissionBtn');
  const microphoneButton = document.getElementById('voiceMicToggle');
  const inputDevice = document.getElementById('voiceInputDevice');
  const channelSelect = document.getElementById('voiceChannelSelect');

  const team = normalizePlayerTeam(state.team || playerTeam);
  const transmitting = Boolean(state.transmitting);
  const permission = state.microphonePermission || 'prompt';
  let status = 'Microphone off';
  if (isObserverTeam(team)) {
    status = 'Receive only';
  } else if (transmitting) {
    status = 'Microphone on';
  } else if (permission === 'denied') {
    status = 'Permission denied';
  } else if (permission === 'unavailable') {
    status = 'Microphone unavailable';
  } else if (state.lastError && state.lastError.message) {
    status = 'Microphone unavailable';
  }

  if (hud) {
    hud.classList.toggle('voiceChannelHud--active', transmitting);
    hud.classList.toggle('voiceChannelHud--muted', !transmitting);
    hud.setAttribute('aria-label', `Nearby voice channel, ${status.toLowerCase()}`);
  }
  if (label) label.textContent = 'Nearby';
  if (statusElement) statusElement.textContent = status;
  if (channelSelect) {
    channelSelect.value = VOICE_CHANNEL;
    channelSelect.disabled = true;
  }
  if (permissionButton) {
    permissionButton.disabled = isObserverTeam(team);
    permissionButton.textContent = permission === 'granted' ? 'Microphone permission granted' : 'Enable microphone';
  }
  if (microphoneButton) {
    const permissionGranted = permission === 'granted';
    microphoneButton.disabled = isObserverTeam(team) || (!permissionGranted && !state.hasLocalStream);
    microphoneButton.textContent = transmitting ? 'Microphone on' : 'Microphone off';
    microphoneButton.setAttribute('aria-pressed', transmitting ? 'true' : 'false');
  }
  if (inputDevice) inputDevice.disabled = isObserverTeam(team);
  if (permissionStatus) {
    if (isObserverTeam(team)) {
      permissionStatus.textContent = 'Observers can listen but cannot use a microphone.';
    } else if (permission === 'granted') {
      permissionStatus.textContent = transmitting ? 'Microphone is transmitting on the Nearby channel.' : 'Microphone permission granted; transmission is off.';
    } else if (permission === 'denied') {
      permissionStatus.textContent = 'Microphone permission was denied by the browser.';
    } else if (permission === 'unavailable') {
      permissionStatus.textContent = 'Microphone capture is unavailable in this browser or context.';
    } else {
      permissionStatus.textContent = 'Microphone permission has not been requested.';
    }
  }
}

function handleVoiceError(error) {
  if (!error) return;
  const message = error.message || 'Voice operation failed.';
  updateVoiceHud(getVoiceState());
  showMessage(message);
}

function initializeVoiceManager() {
  if (voiceManager) return voiceManager;

  voiceManager = createVoiceManager({
    sendToServer,
    localPlayerId: myPlayerId,
    team: playerTeam,
    inputDeviceId: selectedVoiceInputDeviceId,
    rtcConfig: voiceRtcConfig,
    audioConstraints: getVoiceAudioSettings(),
    startMuted: true,
    callbacks: {
      onStateChange: updateVoiceHud,
      onError: handleVoiceError,
      onInputDevices: updateVoiceInputDevices,
    },
  });
  updateVoiceHud();
  return voiceManager;
}

function updateVoiceIdentity() {
  if (!voiceManager) return;
  callVoiceManager('updateLocalIdentity', {
    localPlayerId: myPlayerId,
    team: playerTeam,
  });
  updateVoiceHud();
}

async function resetVoiceManagerForReconnect() {
  if (!voiceManager || typeof voiceManager.reset !== 'function') return;
  try {
    await voiceManager.reset();
  } catch (error) {
    console.error('[Voice] Could not reset voice state before reconnect:', error);
  }
  updateVoiceHud();
}

function requestVoicePermission() {
  if (isObserver()) {
    updateVoiceHud({ team: playerTeam });
    return;
  }
  const result = callVoiceManager('requestMicrophone', { enable: false });
  if (result.value && typeof result.value.catch === 'function') {
    result.value.catch(handleVoiceError);
  }
}

function toggleVoiceMicrophone() {
  if (isObserver()) {
    updateVoiceHud({ team: playerTeam });
    return;
  }
  const result = callVoiceManager('toggleMicrophone');
  if (result.value && typeof result.value.catch === 'function') {
    result.value.catch(handleVoiceError);
  }
}

function bindVoiceControls() {
  const teamSelector = document.getElementById('entryTeamSelector');
  if (teamSelector) {
    teamSelector.addEventListener('click', () => selectRelativePlayerTeam(1));
    teamSelector.addEventListener('menuadjust', (event) => {
      const direction = Number(event.detail?.direction) < 0 ? -1 : 1;
      selectRelativePlayerTeam(direction);
    });
  }
  syncPlayerTeamSelector();
  updatePlayerTeamSelectorAvailability();

  const inputDevice = document.getElementById('voiceInputDevice');
  if (inputDevice) {
    selectedVoiceInputDeviceId = inputDevice.value || '';
    inputDevice.addEventListener('change', () => {
      selectedVoiceInputDeviceId = inputDevice.value || '';
      const result = callVoiceManager('setInputDevice', selectedVoiceInputDeviceId);
      if (result.value && typeof result.value.catch === 'function') {
        result.value.catch(handleVoiceError);
      }
    });
  }

  const processingInputs = [
    'voiceEchoCancellation',
    'voiceNoiseSuppression',
    'voiceAutoGainControl',
  ]
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  processingInputs.forEach((input) => {
    input.addEventListener('change', () => {
      const result = callVoiceManager('setAudioConstraints', getVoiceAudioSettings());
      if (result.value && typeof result.value.catch === 'function') {
        result.value.catch(handleVoiceError);
      }
    });
  });
}

function waitForAnimationFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function setLoadingOverlayState({ visible = true, progress = 0, status = '', detail = '' } = {}) {
  const overlay = document.getElementById('loadingOverlay');
  const statusEl = document.getElementById('loadingStatus');
  const detailEl = document.getElementById('loadingDetail');
  const fillEl = document.getElementById('loadingBarFill');
  if (overlay) {
    overlay.style.display = visible ? 'flex' : 'none';
  }
  if (statusEl && typeof status === 'string') {
    statusEl.textContent = status;
  }
  if (detailEl) {
    detailEl.textContent = detail || '';
  }
  if (fillEl) {
    const clamped = Math.max(0, Math.min(1, progress));
    fillEl.style.width = `${Math.round(clamped * 100)}%`;
  }
}

function hideLoadingOverlay() {
  setLoadingOverlayState({ visible: false });
}

function setPendingJoinRequest(name) {
  pendingJoinRequest = {
    name,
    isMobile,
    tankModel: selectedTankModelId,
    team: getSelectedPlayerTeam(),
  };
}

function maybeSendPendingJoinRequest() {
  if (!renderReadyForJoin || gameplayJoinConfirmed || !pendingJoinRequest) return;
  pendingJoinRequest.team = getSelectedPlayerTeam();
  sendToServer({
    type: 'joinGame',
    name: pendingJoinRequest.name,
    isMobile: pendingJoinRequest.isMobile,
    tankModel: pendingJoinRequest.tankModel,
    team: pendingJoinRequest.team,
  });
}

async function prepareInitialRender(message, sequenceId) {
  const localModelPath = getTankModelPathById(selectedTankModelId);
  const playerModelPaths = (message.players || []).map((player) => getTankModelPathById(getTankModelIdFromPlayer(player)));
  const modelPaths = Array.from(new Set([localModelPath, ...playerModelPaths].filter(Boolean)));
  const texturePaths = [
    '/textures/std_ground.png',
    '/textures/wall.png',
    '/textures/boxwall.png',
    '/textures/roof.png',
    '/textures/pyrwall.png',
    '/textures/green_tank.png',
    '/textures/green_bolt.png',
    '/textures/shot_tail.png',
    '/textures/explode1.png',
    '/textures/explode2.png',
    '/textures/treads.png',
    '/textures/mountain1.png',
    '/textures/mountain2.png',
    '/textures/mountain3.png',
    '/textures/mountain4.png',
    '/textures/mountain5.png',
    '/textures/blend_flash.png',
    '/textures/dusty_flare.png',
    '/textures/jumpjets.png',
  ];
  const audioPaths = getSoundPaths();

  setLoadingOverlayState({
    visible: true,
    progress: 0.05,
    status: 'Preparing battlefield...',
    detail: 'Building world geometry',
  });

  renderManager.buildGround(gameConfig.MAP_SIZE);
  renderManager.setGroundGridEnabled(showDebugGeometry, gameConfig.MAP_SIZE);
  renderManager.createMapBoundaries(gameConfig.MAP_SIZE);
  await waitForAnimationFrame();
  if (sequenceId !== activeInitSequence) return false;

  setLoadingOverlayState({
    visible: true,
    progress: 0.3,
    status: 'Placing obstacles...',
    detail: 'Synchronizing world objects',
  });

  if (message.obstacles) {
    OBSTACLES = message.obstacles;
    refreshCollisionColliders();
    renderManager.setObstacles(OBSTACLES);
  } else {
    OBSTACLES = [];
    refreshCollisionColliders();
    renderManager.setObstacles([]);
  }

  if (message.teleporterGraph && typeof message.teleporterGraph === 'object') {
    TELEPORTER_GRAPH = message.teleporterGraph;
  } else {
    TELEPORTER_GRAPH = { teleporters: [], links: [] };
  }
  rebuildTeleporterRuntimeState();
  debugLog(`world.teleporters count=${TELEPORTER_GRAPH.teleporters.length} links=${TELEPORTER_GRAPH.links.length}`);

  renderManager.createMountains(gameConfig.MAP_SIZE);
  if (renderManager.dynamicLightingEnabled) {
    renderManager.setWorldTime(message.worldTime || 0);
  } else {
    renderManager.clearCelestialBodies();
  }
  if (message.clouds) {
    renderManager.createClouds(message.clouds);
  } else {
    renderManager.clearClouds();
  }

  setLoadingOverlayState({
    visible: true,
    progress: 0.55,
    status: 'Loading vehicle systems...',
    detail: 'Preparing tank models, textures, and audio',
  });

  try {
    await Promise.all([
      ...modelPaths.map((path) => renderManager.whenTankModelReady(path)),
      ...texturePaths.map((path) => renderManager.preloadImage(path).catch(() => null)),
      renderManager.preloadGameplayAudio(),
    ]);
  } catch (error) {
    console.warn('Render asset preload failed:', error, audioPaths);
  }
  if (sequenceId !== activeInitSequence) return false;

  setLoadingOverlayState({
    visible: true,
    progress: 0.82,
    status: 'Assembling tanks...',
    detail: 'Creating player vehicles',
  });

  message.players.forEach((player) => {
    addPlayer(player);
  });
  myTank = tanks.get(myPlayerId);
  callUpdateScoreboard();
  await waitForAnimationFrame();
  if (sequenceId !== activeInitSequence) return false;

  renderReadyForJoin = true;
  setLoadingOverlayState({
    visible: true,
    progress: 1,
    status: pendingJoinRequest ? 'Entering battle...' : 'Render ready',
    detail: pendingJoinRequest ? 'Joining game' : 'Waiting for player name',
  });
  maybeSendPendingJoinRequest();
  window.setTimeout(() => {
    if (sequenceId === activeInitSequence && renderReadyForJoin) {
      hideLoadingOverlay();
    }
  }, 180);
  // Late enough to land on a settled frame rather than the first one after the
  // world was built, and dropped if the map changed in the meantime.
  window.setTimeout(() => {
    if (sequenceId === activeInitSequence) logRenderStats('mapEntry');
  }, RENDER_STATS_SAMPLE_DELAY_MS);
  return true;
}

function isDebugHudVisible() {
  const debugHud = document.getElementById('debugHud');
  if (!debugHud) return false;
  if (debugHud.style.display === 'none') return false;
  const computed = window.getComputedStyle(debugHud);
  return computed.display !== 'none' && computed.visibility !== 'hidden';
}

function updateChatLayoutForDebugOverlap() {
  const body = document.body;
  if (!body) return;
  const desktopLike = window.innerWidth > 900 && !window.matchMedia('(orientation: portrait)').matches;
  const debugVisible = isDebugHudVisible();
  const availableChatWidth = window.innerWidth - CHAT_DEBUG_PANEL_RESERVE;
  const shouldAvoidOverlap = desktopLike && debugVisible && availableChatWidth >= CHAT_MIN_WIDTH_WITH_DEBUG;
  body.classList.toggle('chat-avoid-debug', shouldAvoidOverlap);
}

function getVisibleChatTabs() {
  if (isDebugHudVisible()) {
    return CHAT_TABS;
  }
  return CHAT_TABS.filter((tab) => tab.id !== 'debug');
}

function normalizeActiveChatTab() {
  if (chatState.activeTab === 'debug' && !isDebugHudVisible()) {
    chatState.activeTab = 'all';
  }
}

function setActiveChatTab(tabId) {
  const visibleTabs = getVisibleChatTabs();
  if (!visibleTabs.some((tab) => tab.id === tabId)) {
    return false;
  }
  chatState.activeTab = tabId;
  chatState.unread[tabId] = false;
  chatState.scrollOffsets[tabId] = 0;
  chatWindowDirty = true;
  updateChatWindow();
  return true;
}

function cycleChatTab(direction) {
  const visibleTabs = getVisibleChatTabs();
  if (visibleTabs.length === 0) return;
  const currentIndex = visibleTabs.findIndex((tab) => tab.id === chatState.activeTab);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (safeIndex + direction + visibleTabs.length) % visibleTabs.length;
  setActiveChatTab(visibleTabs[nextIndex].id);
}

function addChatEntry(tabIds, text, kind = CHAT_KIND_MISC) {
  const entry = {
    text: String(text),
    kind,
    ts: Date.now(),
  };
  const uniqueTabIds = Array.from(new Set(tabIds));
  uniqueTabIds.forEach((tabId) => {
    const tabMessages = chatState.messages[tabId];
    if (!Array.isArray(tabMessages)) return;
    tabMessages.push(entry);
    while (tabMessages.length > CHAT_SCROLLBACK_LIMIT) {
      tabMessages.shift();
    }
    if (tabId !== chatState.activeTab) {
      chatState.unread[tabId] = true;
    } else if (chatState.scrollOffsets[tabId] > 0) {
      chatState.scrollOffsets[tabId] = Math.min(chatState.scrollOffsets[tabId] + 1, Math.max(0, tabMessages.length - 1));
    }
  });
  chatWindowDirty = true;
}

function setChatScrollOffset(tabId, nextOffset) {
  const tabMessages = chatState.messages[tabId] || [];
  const maxOffset = Math.max(0, tabMessages.length - CHAT_VISIBLE_MESSAGES);
  chatState.scrollOffsets[tabId] = Math.max(0, Math.min(maxOffset, nextOffset));
  chatWindowDirty = true;
  updateChatWindow();
}

function adjustChatScroll(delta) {
  const tabId = chatState.activeTab;
  const current = chatState.scrollOffsets[tabId] || 0;
  setChatScrollOffset(tabId, current + delta);
}

function scrollChatPage(direction) {
  adjustChatScroll(direction * CHAT_VISIBLE_MESSAGES);
}

function scrollChatToNewest() {
  setChatScrollOffset(chatState.activeTab, 0);
}

function routeLocalHudMessage(text) {
  addChatEntry(['misc', 'all'], `local: ${text}`, CHAT_KIND_MISC);
  updateChatWindow();
}

function announceBuildInfoOnce() {
  if (startupBuildInfoAnnounced) return;
  startupBuildInfoAnnounced = true;
  addChatEntry(['misc', 'all'], `client version: ${CLIENT_VERSION}`, CHAT_KIND_MISC);
  addChatEntry(['misc', 'all'], `copyright: ${CLIENT_COPYRIGHT}`, CHAT_KIND_MISC);
  addChatEntry(['misc', 'all'], `license: ${CLIENT_LICENSE} (${CLIENT_LICENSE_URL})`, CHAT_KIND_MISC);
  updateChatWindow();
}

function announceServerTextIfChanged() {
  let announced = false;

  if (typeof serverDescriptionText === 'string') {
    const nextDescription = serverDescriptionText.trim();
    if (nextDescription.length > 0 && nextDescription !== lastAnnouncedServerDescription) {
      addChatEntry(['server', 'all'], `[SERVER] Description: ${nextDescription}`, CHAT_KIND_SERVER);
      lastAnnouncedServerDescription = nextDescription;
      announced = true;
    }
  }

  if (typeof serverMotdText === 'string') {
    const nextMotd = serverMotdText.trim();
    if (nextMotd.length > 0 && nextMotd !== lastAnnouncedServerMotd) {
      addChatEntry(['server', 'all'], `[SERVER] MOTD: ${nextMotd}`, CHAT_KIND_SERVER);
      lastAnnouncedServerMotd = nextMotd;
      announced = true;
    }
  }

  if (announced) {
    updateChatWindow();
  }
}

function focusChatWithTarget(targetId, { clearInput = true } = {}) {
  const chatTarget = document.getElementById('chatTarget');
  const nextTarget = normalizeMessageEndpoint(targetId, CHAT_TARGET_ALL);
  if (chatTarget) {
    const value = nextTarget === CHAT_TARGET_ALL || nextTarget === CHAT_TARGET_SERVER
      ? String(nextTarget)
      : nextTarget;
    const optionExists = Array.from(chatTarget.options).some((opt) => opt.value === value);
    chatTarget.value = optionExists ? value : String(CHAT_TARGET_ALL);
  }
  if (chatInput) {
    if (clearInput) {
      chatInput.value = '';
    }
    chatInput.focus();
  }
}

// Chat entry owns the keyboard while it is active, and ends only on Enter,
// Escape, or the Send button. Focus is the single source of that state, so
// everything routes through focus/blur rather than tracking a flag of its own.
function setChatEntryActive(active) {
  chatActive = active;
  document.body.classList.toggle('chat-active', active);
  if (sendBtn) {
    sendBtn.classList.toggle('active', active);
    sendBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

function sendChatInputText() {
  const chatTarget = document.getElementById('chatTarget');
  const text = chatInput.value.trim();
  if (text.length === 0) return;
  const dst = normalizeMessageEndpoint(chatTarget.value, CHAT_TARGET_ALL);
  sendToServer({ type: 'message', dst, msgType: CHAT_KIND_CHAT, text });
  chatInput.value = '';
}

function toggleChatEntry() {
  if (chatActive) {
    sendChatInputText();
    chatInput.blur();
    return;
  }
  chatInput.focus();
}

function handleReplyToLastSender() {
  if (typeof lastDirectSenderId !== 'string' || lastDirectSenderId.length === 0) {
    showMessage('No recent direct sender to reply to');
    return;
  }
  focusChatWithTarget(lastDirectSenderId);
}

function handleMessageNemesisTarget() {
  if (typeof nemesisPlayerId !== 'string' || nemesisPlayerId.length === 0) {
    showMessage('No nemesis target available');
    return;
  }
  focusChatWithTarget(nemesisPlayerId);
}

function normalizeMessageEndpoint(value, fallback = CHAT_TARGET_ALL) {
  if (value === CHAT_TARGET_ALL || value === String(CHAT_TARGET_ALL)) return CHAT_TARGET_ALL;
  if (value === CHAT_TARGET_SERVER || value === String(CHAT_TARGET_SERVER)) return CHAT_TARGET_SERVER;
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

function getPlayerName(id) {
  const normalizedId = normalizeMessageEndpoint(id, CHAT_TARGET_SERVER);
  if (normalizedId === CHAT_TARGET_ALL) return 'ALL';
  if (normalizedId === CHAT_TARGET_SERVER) return 'SERVER';
  if (normalizedId === myPlayerId && typeof myPlayerName === 'string' && myPlayerName.trim().length > 0) {
    return myPlayerName.trim();
  }
  const tank = tanks.get(normalizedId);
  return tank && tank.userData && tank.userData.playerState && tank.userData.playerState.name
    ? tank.userData.playerState.name
    : `Player ${normalizedId}`;
}

function formatNetworkMessage(message) {
  const text = typeof message.text === 'string' ? message.text : '';
  const src = normalizeMessageEndpoint(message.src ?? message.from, CHAT_TARGET_SERVER);
  const dst = normalizeMessageEndpoint(message.dst ?? message.to, CHAT_TARGET_ALL);
  const msgType = message.msgType === CHAT_KIND_ACTION
    ? CHAT_KIND_ACTION
    : (message.msgType === CHAT_KIND_SERVER ? CHAT_KIND_SERVER : CHAT_KIND_CHAT);
  const fromName = getPlayerName(src);
  const toName = getPlayerName(dst);

  if (msgType === CHAT_KIND_SERVER || src === CHAT_TARGET_SERVER) {
    return { text: `[SERVER] ${text}`, tabs: ['server', 'all'], kind: CHAT_KIND_SERVER };
  }
  if (msgType === CHAT_KIND_ACTION) {
    if (typeof dst === 'string') {
      if (src === myPlayerId) {
        return { text: `[->${toName}] ${text}`, tabs: ['chat', 'all'], kind: CHAT_KIND_DIRECT_OUT };
      }
      return { text: `[${fromName}->] ${text}`, tabs: ['chat', 'all'], kind: CHAT_KIND_DIRECT_IN };
    }
    return { text: `${fromName} ${text}`, tabs: ['chat', 'all'], kind: CHAT_KIND_ACTION };
  }
  if (typeof dst === 'string') {
    if (src === myPlayerId) {
      return { text: `[->${toName}] ${text}`, tabs: ['chat', 'all'], kind: CHAT_KIND_DIRECT_OUT };
    }
    return { text: `[${fromName}->] ${text}`, tabs: ['chat', 'all'], kind: CHAT_KIND_DIRECT_IN };
  }
  return { text: `${fromName}: ${text}`, tabs: ['chat', 'all'], kind: CHAT_KIND_CHAT };
}

function syncDebugTabVisibility() {
  normalizeActiveChatTab();
  updateChatLayoutForDebugOverlap();
  chatWindowDirty = true;
  updateChatWindow();
}

function queueDebugPacket(payload) {
  pendingDebugPackets.push(payload);
  if (pendingDebugPackets.length > 120) {
    pendingDebugPackets.shift();
  }
}

// A server-assigned 'Player' or 'Player n' is a placeholder, not a name the
// player chose, so it does not count as one to join under.
function isDefaultPlayerName(name) {
  return name === 'Player' || /^Player \d+$/.test(name);
}

function savePlayerName(name) {
  const trimmed = String(name).trim().substring(0, 20);
  localStorage.setItem('playerName', trimmed);
  myPlayerName = trimmed;
  const entryInput = document.getElementById('entryInput');
  if (entryInput) entryInput.value = trimmed;
  return trimmed;
}

function getSavedJoinableName() {
  const savedName = localStorage.getItem('playerName');
  if (typeof savedName !== 'string') return '';
  const trimmed = savedName.trim();
  if (!trimmed || isDefaultPlayerName(trimmed)) return '';
  return trimmed;
}

function getDebugSenderName() {
  if (typeof myPlayerName === 'string' && myPlayerName.trim().length > 0) {
    return myPlayerName.trim();
  }
  const savedName = localStorage.getItem('playerName');
  if (typeof savedName === 'string' && savedName.trim().length > 0) {
    return savedName.trim();
  }
  return '';
}

function debugLog(message, source = '') {
  const text = source ? `[${source}] ${String(message)}` : String(message);
  addChatEntry(['debug'], `[DBG] ${text}`, CHAT_KIND_DEBUG);
  updateChatWindow();
  console.log(text);
  const payload = {
    type: 'debug',
    message: text,
    name: getDebugSenderName() || undefined,
  };
  if (ws && ws.readyState === WebSocket.OPEN) {
    sendToServer(payload);
    return;
  }
  queueDebugPacket(payload);
}

function flushDebugPacketQueue() {
  if (!ws || ws.readyState !== WebSocket.OPEN || pendingDebugPackets.length === 0) {
    return;
  }
  while (pendingDebugPackets.length > 0) {
    const payload = pendingDebugPackets.shift();
    sendToServer(payload);
  }
}

function collectClientCapabilities() {
  const probeCanvas = document.createElement('canvas');
  const gl2 = !!probeCanvas.getContext('webgl2');
  const gl = !!probeCanvas.getContext('webgl');
  const experimental = !!probeCanvas.getContext('experimental-webgl');
  debugLog(
    `capabilities ua="${navigator.userAgent}" webgl2=${gl2} webgl=${gl} experimentalWebgl=${experimental} secure=${window.isSecureContext}`,
  );
}

window.addEventListener('error', (event) => {
  const message = event && event.message ? event.message : 'Unknown error event';
  const source = event && event.filename ? event.filename : 'unknown-source';
  const line = event && event.lineno ? event.lineno : 0;
  const col = event && event.colno ? event.colno : 0;
  debugLog(`window.error message="${message}" at ${source}:${line}:${col}`);
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event && event.reason ? event.reason : 'Unknown rejection reason';
  const serialized = typeof reason === 'string' ? reason : (reason && reason.message ? reason.message : JSON.stringify(reason));
  debugLog(`window.unhandledrejection reason="${serialized}"`);
});

window.gameDebugLog = debugLog;

function lightenHexColor(colorValue, mix = 0.45) {
  const color = new THREE.Color(typeof colorValue === 'number' ? colorValue : (colorValue || 0x4caf50));
  color.lerp(new THREE.Color(0xffffff), Math.max(0, Math.min(1, mix)));
  return color;
}

function getPlayerShotColor(playerId) {
  const tank = tanks.get(playerId);
  const playerColor = tank?.userData?.playerState?.color;
  return lightenHexColor(typeof playerColor === 'number' ? playerColor : 0x4caf50, 0.45);
}

// Input state

// Entry Dialog
function isEntryDialogOpen() {
  return document.getElementById('entryDialog')?.style.display === 'block';
}

function toggleEntryDialog(name = '') {
  const entryDialog = document.getElementById('entryDialog');
  const entryInput = document.getElementById('entryInput');
  if (!entryDialog || !entryInput) return;
  const entryDialogWillOpen = entryDialog.style.display !== 'block';
  if (entryDialogWillOpen) {
    setInputContext(INPUT_CONTEXT.ENTRY);
  }
  entryDialog.style.display = entryDialogWillOpen ? 'block' : 'none';
  if (!entryDialogWillOpen) {
    syncInputContextFromUi();
  }
  if (entryDialogWillOpen) {
    startTankPreviewAnimation();
  } else {
    stopTankPreviewAnimation();
  }
  isPaused = entryDialogWillOpen;
  if (entryDialogWillOpen) {
    gameplayJoinConfirmed = false;
    updatePlayerTeamSelectorAvailability();
    if (name === '') name = myPlayerName;
    entryDialogReturnCameraMode = cameraMode;
    cameraMode = 'overview';
    entryInput.value = name;
    entryInput.focus();
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'leaveGame' }));
    }
    // Hide tank from scene if present
    if (myTank && scene) {
      const tank = tanks.get(myPlayerId);
      if (tank) {
        tank.visible = false;
      }
    }
  } else {
    cameraMode = entryDialogReturnCameraMode === 'overview' ? 'first-person' : entryDialogReturnCameraMode;
  }
}


// Obstacle definitions (received from server)
let OBSTACLES = [];
let TELEPORTER_GRAPH = { teleporters: [], links: [] };
let TELEPORTER_OBSTACLES_BY_INDEX = new Map();
let TELEPORTER_LINKS_BY_SOURCE_FACE = new Map();

// Camera mode
let cameraMode = 'first-person'; // 'first-person', 'third-person', or 'overview'
let lastCameraMode = 'first-person';
let entryDialogReturnCameraMode = 'first-person';

// Pause state
let isPaused = false;
let pauseCountdownStart = 0;
let playerShields = new Map(); // Map of playerId to shield mesh
let deathFollowTarget = null;

// Computed width resolves the viewport units even while the box is hidden for
// the death camera, which a layout rect would report as zero.
function readBoxHalfExtent(elementId) {
  const element = document.getElementById(elementId);
  if (!element) return 0;
  const width = parseFloat(window.getComputedStyle(element).width);
  return Number.isFinite(width) ? width / 2 : 0;
}

function updateMotionBoxMetrics() {
  motionBoxHalfExtent = readBoxHalfExtent('controlBox');
  motionBoxDeadZone = readBoxHalfExtent('noMotionBox');
}

// One axis of the mapping, matching upstream's per-axis clamp: past the box the
// axis is pinned at full deflection, so pulling the cursor further out steers
// only through whatever the other axis is doing.
function motionBoxAxisInput(offsetPx) {
  const span = motionBoxHalfExtent - motionBoxDeadZone;
  if (!(span > 0)) return 0;
  const beyondDeadZone = Math.abs(offsetPx) - motionBoxDeadZone;
  if (beyondDeadZone <= 0) return 0;
  return Math.sign(offsetPx) * Math.min(1, beyondDeadZone / span);
}

function updateDeathCameraHudVisibility() {
  const controlBox = document.getElementById('controlBox');
  if (!controlBox) return;
  const inDeathCamera = cameraMode === 'overview' && !!deathFollowTarget;
  controlBox.style.display = inDeathCamera ? 'none' : '';
}

// Mouse control
let mouseControlEnabled = false;
let mouseX = 0; // Percentage from center (-1 to 1)
let mouseY = 0; // Percentage from center (-1 to 1)
// BZFlag's targeting box is the mouse mapping, not decoration: inside the inner
// box the tank does nothing, and the outer box edge is full deflection
// (playing.cxx:1088-1131). The boxes are sized in CSS, so their geometry is read
// back off them rather than kept a second time here.
let motionBoxHalfExtent = 0;
let motionBoxDeadZone = 0;
registerGameplayInputReset(() => {
  mouseX = 0;
  mouseY = 0;
});

const DEFAULT_TANK_MODEL_ID = 'bzflag';

let TANK_MODELS = [
  { id: 'bzflag', path: '/obj/bzflag.obj', label: 'BZFlag' },
  { id: 'modern', path: '/obj/modern.obj', label: 'Modern' },
  { id: 'simple', path: '/obj/simple.obj', label: 'Simple' },
  { id: 'wheeled6', path: '/obj/wheeled6.obj', label: 'Wheeled 6' },
];
let selectedTankModelId = localStorage.getItem('tankModelId') || DEFAULT_TANK_MODEL_ID;
let tankPreviewCard = null;
const tankPreviewModelCache = new Map();
let tankPreviewLoader = null;
let tankPreviewAnimating = false;
let tankPreviewRafId = null;

function getDefaultTankModel() {
  if (!Array.isArray(TANK_MODELS) || TANK_MODELS.length === 0) {
    return { id: DEFAULT_TANK_MODEL_ID, path: '/obj/bzflag.obj', label: 'BZFlag' };
  }
  return TANK_MODELS.find((model) => model.id === DEFAULT_TANK_MODEL_ID) || TANK_MODELS[0];
}

function getTankModelById(modelId) {
  const normalized = typeof modelId === 'string' ? modelId.trim().toLowerCase() : '';
  return TANK_MODELS.find((model) => model.id === normalized) || null;
}

function normalizeTankModelId(modelId) {
  let normalized = typeof modelId === 'string' ? modelId.trim().toLowerCase() : '';
  if (normalized === 'default') normalized = DEFAULT_TANK_MODEL_ID;
  if (normalized === 'bzflag-tank') normalized = 'bzflag';
  if (normalized === 'tank') normalized = DEFAULT_TANK_MODEL_ID;
  const selected = getTankModelById(normalized);
  return selected ? selected.id : getDefaultTankModel().id;
}

selectedTankModelId = normalizeTankModelId(selectedTankModelId);

function getTankModelPathById(modelId) {
  const normalizedId = normalizeTankModelId(modelId);
  const selected = getTankModelById(normalizedId);
  return selected ? selected.path : getDefaultTankModel().path;
}

function getTankModelIdFromPlayer(player) {
  return normalizeTankModelId(player && player.tankModel);
}

function updateSelectedTankOptionUI() {
  const currentModel = getTankModelById(selectedTankModelId) || getDefaultTankModel();
  const optionLabel = document.getElementById('tankOptionLabel');
  if (optionLabel) {
    optionLabel.textContent = currentModel.label || currentModel.id;
  }

  const currentOption = document.getElementById('tankCurrentOption');
  if (currentOption) {
    currentOption.classList.add('selected');
    currentOption.dataset.modelId = currentModel.id;
  }

  const disableArrows = TANK_MODELS.length <= 1;
  const prevBtn = document.getElementById('tankPrevBtn');
  const nextBtn = document.getElementById('tankNextBtn');
  if (prevBtn) prevBtn.disabled = disableArrows;
  if (nextBtn) nextBtn.disabled = disableArrows;
}

function setSelectedTankModel(modelId, { persist = true, applyToRender = true } = {}) {
  const selectedId = normalizeTankModelId(modelId);
  const selected = getTankModelById(selectedId);
  if (!selected) return;
  selectedTankModelId = selected.id;
  if (persist) {
    localStorage.setItem('tankModelId', selectedTankModelId);
  }
  if (applyToRender) {
    renderManager.setTankModel(selected.path);
  }
  if (tankPreviewCard) {
    loadTankPreviewModel(selected.path);
  }

  if (pendingJoinRequest) {
    pendingJoinRequest.tankModel = selectedTankModelId;
  }

  if (gameplayJoinConfirmed && myPlayerId) {
    const currentTank = tanks.get(myPlayerId);
    const currentPlayerState = currentTank?.userData?.playerState;
    if (currentPlayerState) {
      addPlayer({
        ...currentPlayerState,
        tankModel: selectedTankModelId,
      });
      myTank = tanks.get(myPlayerId);
    }
    sendToServer({
      type: 'setTankModel',
      tankModel: selectedTankModelId,
    });
  }

  updateSelectedTankOptionUI();
}

function cycleTankModel(step) {
  if (!Array.isArray(TANK_MODELS) || TANK_MODELS.length === 0) return;
  const currentIndex = TANK_MODELS.findIndex((model) => model.id === selectedTankModelId);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (safeIndex + step + TANK_MODELS.length) % TANK_MODELS.length;
  setSelectedTankModel(TANK_MODELS[nextIndex].id);
}

function loadTankPreviewModel(modelPath) {
  if (!tankPreviewCard || !modelPath) return;

  const { scene } = tankPreviewCard;
  tankPreviewCard.requestedModelPath = modelPath;

  const applyLoadedModel = (baseObject) => {
    if (!tankPreviewCard || tankPreviewCard.requestedModelPath !== modelPath) return;

    if (tankPreviewCard.modelRoot) {
      scene.remove(tankPreviewCard.modelRoot);
      tankPreviewCard.modelRoot = null;
    }

    const source = baseObject.clone(true);
    const root = new THREE.Group();
    root.add(source);

    const bounds = new THREE.Box3().setFromObject(root);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const maxAxis = Math.max(size.x, size.y, size.z) || 1;
    const scale = 2.7 / maxAxis;
    root.scale.setScalar(scale);
    root.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);

    scene.add(root);
    tankPreviewCard.modelRoot = root;
  };

  const cached = tankPreviewModelCache.get(modelPath);
  if (cached) {
    applyLoadedModel(cached);
    return;
  }

  if (!tankPreviewLoader) {
    tankPreviewLoader = new OBJLoader();
  }

  tankPreviewLoader.load(modelPath, (obj) => {
    tankPreviewModelCache.set(modelPath, obj);
    applyLoadedModel(obj);
  });
}

async function fetchTankModels() {
  try {
    const response = await fetch('/api/tank-models', { cache: 'no-store' });
    if (!response.ok) return;
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.models)) return;

    const models = payload.models
      .filter((model) => model && typeof model.id === 'string' && typeof model.path === 'string')
      .map((model) => ({
        id: model.id.trim().toLowerCase(),
        path: model.path,
        label: model.label || model.id,
      }))
      .sort((left, right) => {
        if (left.id === DEFAULT_TANK_MODEL_ID) return -1;
        if (right.id === DEFAULT_TANK_MODEL_ID) return 1;
        return left.id.localeCompare(right.id);
      });

    if (models.length > 0) {
      TANK_MODELS = models;
      const normalizedSelectedTankModelId = normalizeTankModelId(selectedTankModelId);
      if (normalizedSelectedTankModelId !== selectedTankModelId) {
        localStorage.setItem('tankModelId', normalizedSelectedTankModelId);
      }
      selectedTankModelId = normalizedSelectedTankModelId;
      if (renderManager && typeof renderManager.preloadTankModel === 'function') {
        TANK_MODELS.forEach((model) => {
          if (model && model.path) {
            renderManager.preloadTankModel(model.path);
          }
        });
      }
    }
  } catch (error) {
    console.warn('Failed to fetch tank model list:', error);
  }
}

function animateTankPreviews() {
  if (!tankPreviewAnimating) return;
  if (tankPreviewCard) {
    if (tankPreviewCard.modelRoot) {
      tankPreviewCard.modelRoot.rotation.y += 0.015;
    }
    tankPreviewCard.renderer.render(tankPreviewCard.scene, tankPreviewCard.camera);
  }
  tankPreviewRafId = requestAnimationFrame(animateTankPreviews);
}

function startTankPreviewAnimation() {
  if (tankPreviewAnimating) return;
  tankPreviewAnimating = true;
  animateTankPreviews();
}

function stopTankPreviewAnimation() {
  tankPreviewAnimating = false;
  if (tankPreviewRafId !== null) {
    cancelAnimationFrame(tankPreviewRafId);
    tankPreviewRafId = null;
  }
}

async function initTankSelector() {
  const canvas = document.getElementById('tankPreviewCanvas');
  if (!canvas) return;

  const width = Math.max(120, Math.floor(canvas.clientWidth || 120));
  const height = Math.max(80, Math.floor(canvas.clientHeight || 80));

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(width, height, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
  camera.position.set(0, 2.4, 7.2);
  camera.lookAt(0, 0.8, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.8);
  scene.add(ambient);
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.7);
  keyLight.position.set(3, 5, 4);
  scene.add(keyLight);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(2.3, 20),
    new THREE.MeshBasicMaterial({ color: 0x123018, transparent: true, opacity: 0.35 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.05;
  scene.add(floor);

  tankPreviewCard = { renderer, scene, camera, modelRoot: null, requestedModelPath: null };

  const prevBtn = document.getElementById('tankPrevBtn');
  const nextBtn = document.getElementById('tankNextBtn');
  if (prevBtn) prevBtn.addEventListener('click', () => cycleTankModel(-1));
  if (nextBtn) nextBtn.addEventListener('click', () => cycleTankModel(1));

  await fetchTankModels();
  selectedTankModelId = normalizeTankModelId(selectedTankModelId);
  setSelectedTankModel(selectedTankModelId, { persist: true, applyToRender: true });
}

// Watch for mouseControlEnabled toggle to reset orientation center
Object.defineProperty(window, 'mouseControlEnabled', {
  get() { return mouseControlEnabled; },
  set(val) {
    mouseControlEnabled = val;
  }
});

// Orientation analog control state
let orientationMode = null; // 'portrait' or 'landscape'

function detectOrientationMode() {
  if (window.matchMedia('(orientation: landscape)').matches) {
    orientationMode = 'landscape';
  } else {
    orientationMode = 'portrait';
  }
}
detectOrientationMode();
window.addEventListener('orientationchange', () => {
  detectOrientationMode();
  if (isMobile && mouseControlEnabled) {
    if (latestOrientation) latestOrientation.status = 'Orientation changed, recentered';
  }
});
// Fallback for browsers that don't fire orientationchange
window.addEventListener('resize', () => {
  const prev = orientationMode;
  detectOrientationMode();
  if (orientationMode !== prev && isMobile && mouseControlEnabled) {
    if (latestOrientation) latestOrientation.status = 'Orientation changed (resize), recentered';
  }
});

// Player tank position (for movement prediction)
let playerX = 0;
let playerY = 0; // Y is vertical position
let playerZ = 0;
let playerRotation = 0;

// Dead reckoning state - track last sent velocities (not positions, since positions are extrapolated)
let lastSentForwardSpeed = 0;
let lastSentRotationSpeed = 0;
let lastSentVerticalVelocity = 0;
let lastSentAirVelocityX = 0;
let lastSentAirVelocityZ = 0;
let lastSentTime = 0;
let worldTime = 0;
let chatWindowDirty = true;
let cachedWorldBorderColliders = [];
let cachedCollisionColliders = [];
// Velocity-based thresholds: only send when velocity changes significantly
// Thresholds must be large enough to avoid noise from frame-to-frame velocity calculation variations
const VELOCITY_THRESHOLD = 0.15; // Send if forward/rotation speed changes by 15%
const VERTICAL_VELOCITY_THRESHOLD = 1.0; // Send if vertical velocity changes significantly
const AIR_VELOCITY_THRESHOLD = 0.35; // Send if airborne horizontal velocity changes significantly
const MAX_UPDATE_INTERVAL = 5000; // Force update every 5 seconds
const DEAD_STICK_STOP_THRESHOLD = 0.03; // Force an update when ground motion settles to near-zero
const MAX_REMOTE_EXTRAPOLATION_STOP_SECONDS = 0.3; // Short horizon only when replicated state is fully stopped
const CLIMBABLE_SURFACE_NORMAL_Y = 0.7;
const MAX_BUMP_HEIGHT = 0.165;
const ONTOP_TOLERANCE = 0.1;
const SUPPORT_SNAP_DOWN = 0.2;
const CORNER_STICK_MIN_INTENT = 0.2;
const CORNER_STICK_MAX_PROGRESS = 0.08;
const CORNER_STICK_FRAMES = 3;
const CORNER_ESCAPE_DISTANCE = 0.2;
const JUMP_PATH_MAX_TIME = 4.0;
const JUMP_PATH_STEP_TIME = 0.12;

// Extrapolation state
let myJumpDirection = null; // null when on ground, rotation when in air
// Tracks repeated low-progress face contacts so we can nudge out of corner pockets.
let cornerStickState = { obstacleName: null, frames: 0 };
let selectedFaceDebugMarker = null;
let selectedFaceDebugTouchedThisFrame = false;
let supportSurfaceDebugMarker = null;
let supportSurfaceDebugTouchedThisFrame = false;
let supportFootprintDebugMarker = null;
let supportFootprintDebugTouchedThisFrame = false;
// Toggle for ghost meshes and debug geometry
let showDebugGeometry = readStoredFlag('showDebugGeometry', readStoredFlag('showGhosts'));

// Debug tracking
let debugEnabled = false;
let debugLabelsEnabled = readStoredFlag('debugLabelsEnabled');
renderManager.setDebugLabelsEnabled(debugLabelsEnabled);
const packetsSent = new Map();
const packetsReceived = new Map();

function ensureSelectedFaceDebugMarker() {
  if (!showDebugGeometry) return null;
  if (selectedFaceDebugMarker || !scene) return selectedFaceDebugMarker;
  const markerGroup = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 6, 10),
    new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.85 })
  );
  pole.position.y = 3;
  const cap = new THREE.Mesh(
    new THREE.ConeGeometry(0.35, 0.9, 12),
    new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.9 })
  );
  cap.position.y = 6.25;
  cap.userData.baseDirection = new THREE.Vector3(0, 1, 0);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false }));
  label.position.set(0, 7.35, 0);
  label.scale.set(3.4, 0.85, 1);
  markerGroup.userData.nameLabel = label;
  markerGroup.add(pole);
  markerGroup.add(cap);
  markerGroup.add(label);
  markerGroup.visible = false;
  renderManager.getWorldGroup().add(markerGroup);
  selectedFaceDebugMarker = markerGroup;
  return selectedFaceDebugMarker;
}

function ensureSupportSurfaceDebugMarker() {
  if (!showDebugGeometry) return null;
  if (supportSurfaceDebugMarker || !scene) return supportSurfaceDebugMarker;
  const markerGroup = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.1, 4.5, 10),
    new THREE.MeshBasicMaterial({ color: 0xff4d9d, transparent: true, opacity: 0.85 })
  );
  pole.position.y = 2.25;
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.55, 0.18, 16),
    new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.95 })
  );
  cap.position.y = 4.6;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false }));
  label.position.set(0, 5.7, 0);
  label.scale.set(3.4, 0.85, 1);
  markerGroup.userData.nameLabel = label;
  markerGroup.add(pole);
  markerGroup.add(cap);
  markerGroup.add(label);
  markerGroup.visible = false;
  renderManager.getWorldGroup().add(markerGroup);
  supportSurfaceDebugMarker = markerGroup;
  return supportSurfaceDebugMarker;
}

function ensureSupportFootprintDebugMarker() {
  if (!showDebugGeometry) return null;
  if (supportFootprintDebugMarker || !scene) return supportFootprintDebugMarker;
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.LineBasicMaterial({
    color: 0xffb347,
    transparent: true,
    opacity: 0.95,
    depthWrite: false
  });
  supportFootprintDebugMarker = new THREE.LineLoop(geometry, material);
  supportFootprintDebugMarker.visible = false;
  renderManager.getWorldGroup().add(supportFootprintDebugMarker);
  return supportFootprintDebugMarker;
}

function clearJumpPredictionDebug(tank) {
  if (!tank?.userData?.jumpPredictionDebug) return;
  const debugGroup = tank.userData.jumpPredictionDebug;
  renderManager.getWorldGroup().remove(debugGroup);
  debugGroup.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose());
      } else {
        child.material.dispose();
      }
    }
  });
  tank.userData.jumpPredictionDebug = null;
}

function ensureJumpPredictionDebug(tank, mode = 'received') {
  if (!tank) return null;
  if (tank.userData.jumpPredictionDebug) return tank.userData.jumpPredictionDebug;

  const playerColor = tank.userData?.playerState?.color;
  const baseColor = lightenHexColor(
    typeof playerColor === 'number' ? playerColor : (mode === 'sent' ? 0x7cf29a : 0x7cd6ff),
    mode === 'sent' ? 0.25 : 0.35
  );
  const landingColor = baseColor.clone().lerp(new THREE.Color(0xffffff), 0.25);

  const group = new THREE.Group();
  const lineGeometry = new THREE.BufferGeometry();
  const lineMaterial = new THREE.LineBasicMaterial({
    color: baseColor.getHex(),
    transparent: true,
    opacity: 0.8,
    depthWrite: false
  });
  const line = new THREE.Line(lineGeometry, lineMaterial);

  const landingRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.9, 0.08, 8, 24),
    new THREE.MeshBasicMaterial({
      color: landingColor.getHex(),
      transparent: true,
      opacity: 0.9,
      depthWrite: false
    })
  );
  landingRing.rotation.x = Math.PI / 2;

  const landingPillar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 1.2, 10),
    new THREE.MeshBasicMaterial({
      color: landingColor.getHex(),
      transparent: true,
      opacity: 0.55,
      depthWrite: false
    })
  );
  landingPillar.position.y = 0.6;

  group.add(line);
  group.add(landingRing);
  group.add(landingPillar);
  group.userData = { line, landingRing, landingPillar, mode };
  group.visible = false;
  renderManager.getWorldGroup().add(group);
  tank.userData.jumpPredictionDebug = group;
  return group;
}

function samplePredictedAirPath(state) {
  if (!state || !gameConfig) return null;
  const points = [];
  const stepTime = JUMP_PATH_STEP_TIME;
  const maxSteps = Math.max(4, Math.floor(JUMP_PATH_MAX_TIME / stepTime));
  const gravity = gameConfig.GRAVITY || 9.8;
  let landed = false;
  let landingPoint = null;

  for (let step = 0; step <= maxSteps; step += 1) {
    const t = step * stepTime;
    const pos = extrapolatePosition(state, t);
    let pointY = pos.y;
    let landedType = null;

    if (pos.y <= 0) {
      pointY = 0;
      landed = true;
      landedType = 'ground';
    }

    points.push(new THREE.Vector3(pos.x, pointY, pos.z));
    if (landed) {
      landingPoint = { x: pos.x, y: pointY, z: pos.z, type: landedType };
      break;
    }
  }

  if (!landed) {
    const initialY = Number.isFinite(state.y) ? state.y : 0;
    const initialVV = Number.isFinite(state.verticalVelocity) ? state.verticalVelocity : 0;
    const discriminant = (initialVV * initialVV) + (2 * gravity * initialY);
    if (gravity > 0 && discriminant >= 0) {
      const landingTime = (initialVV + Math.sqrt(discriminant)) / gravity;
      if (Number.isFinite(landingTime) && landingTime > 0) {
        const landingPos = extrapolatePosition(state, landingTime);
        points.push(new THREE.Vector3(landingPos.x, 0, landingPos.z));
        landingPoint = { x: landingPos.x, y: 0, z: landingPos.z, type: 'ground' };
      }
    }
  }

  if (points.length < 2) {
    const pos = extrapolatePosition(state, 0);
    points.push(new THREE.Vector3(pos.x, pos.y, pos.z));
    points.push(new THREE.Vector3(pos.x, Math.max(0, pos.y - 0.01), pos.z));
  }

  return {
    points,
    landingPoint: landingPoint || {
      x: points[points.length - 1].x,
      y: points[points.length - 1].y,
      z: points[points.length - 1].z,
      type: 'projected'
    }
  };
}

function updateJumpPredictionDebug(tank, state, mode = 'received') {
  if (!tank) return;
  const airborne = state && state.jumpDirection !== null && state.jumpDirection !== undefined;
  if (!airborne) {
    if (tank.userData.jumpPredictionDebug) {
      tank.userData.jumpPredictionDebug.visible = false;
    }
    return;
  }

  const prediction = samplePredictedAirPath(state);
  if (!prediction) return;

  const debugGroup = ensureJumpPredictionDebug(tank, mode);
  if (!debugGroup) return;
  const { line, landingRing, landingPillar } = debugGroup.userData;
  if (!line) return;

  if (line.geometry) {
    line.geometry.dispose();
  }
  line.geometry = new THREE.BufferGeometry().setFromPoints(prediction.points);
  line.geometry.computeBoundingSphere();

  const landing = prediction.landingPoint;
  if (landingRing) {
    landingRing.position.set(landing.x, landing.y + 0.05, landing.z);
  }
  if (landingPillar) {
    landingPillar.position.set(landing.x, landing.y + 0.6, landing.z);
  }
  debugGroup.visible = showDebugGeometry;
}

function ensurePacketMotionDebug(targetObject, mode = 'received') {
  if (!showDebugGeometry || !targetObject) return null;
  if (targetObject.userData.packetMotionDebug) return targetObject.userData.packetMotionDebug;

  const motionGroup = new THREE.Group();
  motionGroup.position.set(0, 3.1, 0);

  const linearGroup = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 1.4, 10),
    new THREE.MeshBasicMaterial({ color: mode === 'sent' ? 0x7cf29a : 0x7cd6ff, transparent: true, opacity: 0.9 })
  );
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = -0.7;
  shaft.userData.baseLength = 1.4;
  const head = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.55, 12),
    new THREE.MeshBasicMaterial({ color: mode === 'sent' ? 0xc9ff6a : 0xfff36a, transparent: true, opacity: 0.95 })
  );
  head.rotation.x = -Math.PI / 2;
  head.position.z = -1.55;
  head.userData.baseOffset = 1.55;
  linearGroup.add(shaft);
  linearGroup.add(head);

  const verticalGroup = new THREE.Group();
  const verticalShaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 1.2, 10),
    new THREE.MeshBasicMaterial({ color: 0xff9f43, transparent: true, opacity: 0.9 })
  );
  verticalShaft.userData.baseLength = 1.2;
  verticalShaft.position.y = 0.6;
  const verticalHead = new THREE.Mesh(
    new THREE.ConeGeometry(0.2, 0.45, 12),
    new THREE.MeshBasicMaterial({ color: 0xff6b6b, transparent: true, opacity: 0.95 })
  );
  verticalHead.userData.baseOffset = 1.35;
  verticalHead.position.y = 1.35;
  verticalGroup.add(verticalShaft);
  verticalGroup.add(verticalHead);

  const turnRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.0, 0.04, 8, 24),
    new THREE.MeshBasicMaterial({ color: 0xff7ad9, transparent: true, opacity: 0.35 })
  );
  turnRing.rotation.x = Math.PI / 2;
  turnRing.position.y = 0.15;

  const turnIndicator = new THREE.Mesh(
    new THREE.ConeGeometry(0.18, 0.5, 12),
    new THREE.MeshBasicMaterial({ color: 0xff7ad9, transparent: true, opacity: 0.95 })
  );
  turnIndicator.rotation.z = -Math.PI / 2;
  turnIndicator.position.set(1.0, 0.15, 0);
  turnIndicator.userData.baseOffset = 1.0;

  const label = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false }));
  label.position.set(0, 1.7, 0);
  label.scale.set(4.2, 0.95, 1);

  motionGroup.userData = { linearGroup, verticalGroup, turnRing, turnIndicator, nameLabel: label, mode };
  motionGroup.add(linearGroup);
  motionGroup.add(verticalGroup);
  motionGroup.add(turnRing);
  motionGroup.add(turnIndicator);
  motionGroup.add(label);
  motionGroup.visible = false;
  targetObject.add(motionGroup);
  targetObject.userData.packetMotionDebug = motionGroup;
  return motionGroup;
}

function updatePacketMotionDebug(targetObject, packetState, mode = 'received') {
  if (!targetObject) return;
  const gizmo = ensurePacketMotionDebug(targetObject, mode);
  if (!gizmo) return;
  targetObject.userData.hasPacketState = true;

  const linearGroup = gizmo.userData.linearGroup;
  const verticalGroup = gizmo.userData.verticalGroup;
  const turnRing = gizmo.userData.turnRing;
  const turnIndicator = gizmo.userData.turnIndicator;
  const label = gizmo.userData.nameLabel;

  const fs = Number.isFinite(packetState?.fs) ? packetState.fs : 0;
  const rs = Number.isFinite(packetState?.rs) ? packetState.rs : 0;
  const vx = Number.isFinite(packetState?.vx) ? packetState.vx : 0;
  const vz = Number.isFinite(packetState?.vz) ? packetState.vz : 0;
  const vv = Number.isFinite(packetState?.vv) ? packetState.vv : 0;
  const r = Number.isFinite(packetState?.r) ? packetState.r : (targetObject.rotation?.y || 0);
  const moveDirection = packetState?.d ?? packetState?.jumpDirection ?? r;
  const tankSpeed = gameConfig?.TANK_SPEED || 12.5;

  const airSpeed = Math.hypot(vx, vz);
  const hasAirVector = airSpeed > 0.01;
  let displayDirection = moveDirection;
  let speedMagnitude = Math.abs(fs);
  if (hasAirVector) {
    displayDirection = Math.atan2(-vx, -vz);
    speedMagnitude = airSpeed / tankSpeed;
  } else if (fs < 0) {
    displayDirection += Math.PI;
  }
  speedMagnitude = Math.max(0, Math.min(1.5, speedMagnitude));

  if (linearGroup) {
    const arrowScale = Math.max(0.18, speedMagnitude);
    const shaft = linearGroup.children[0];
    const head = linearGroup.children[1];
    linearGroup.visible = speedMagnitude > 0.01;
    linearGroup.rotation.y = displayDirection - r;
    if (shaft) {
      shaft.scale.set(1, 1, arrowScale);
      shaft.position.z = -(shaft.userData.baseLength || 1.4) * arrowScale * 0.5;
    }
    if (head) {
      head.position.z = -(head.userData.baseOffset || 1.55) * arrowScale;
    }
  }

  if (verticalGroup) {
    const jumpVelocity = gameConfig?.JUMP_VELOCITY || 22;
    const verticalMagnitude = Math.min(1.5, Math.abs(vv) / jumpVelocity);
    const activeVertical = verticalMagnitude > 0.01;
    const verticalShaft = verticalGroup.children[0];
    const verticalHead = verticalGroup.children[1];
    verticalGroup.visible = activeVertical;
    if (activeVertical) {
      const arrowScale = Math.max(0.2, verticalMagnitude);
      if (verticalShaft) {
        verticalShaft.scale.set(1, arrowScale, 1);
        verticalShaft.position.y = (verticalShaft.userData.baseLength || 1.2) * arrowScale * 0.5;
      }
      if (verticalHead) {
        verticalHead.scale.set(1, arrowScale, 1);
        verticalHead.position.y = (verticalHead.userData.baseOffset || 1.35) * arrowScale;
        verticalHead.rotation.z = vv >= 0 ? 0 : Math.PI;
      }
    }
  }

  if (turnRing && turnIndicator) {
    const turnMagnitude = Math.min(1.5, Math.abs(rs));
    const activeTurn = turnMagnitude > 0.01;
    turnRing.visible = activeTurn;
    turnIndicator.visible = activeTurn;
    if (activeTurn) {
      const turnScale = Math.max(0.2, turnMagnitude);
      const turnOffset = (turnIndicator.userData.baseOffset || 1.0) * turnScale;
      turnIndicator.position.x = rs >= 0 ? -turnOffset : turnOffset;
      turnIndicator.rotation.z = rs >= 0 ? Math.PI / 2 : -Math.PI / 2;
      turnIndicator.scale.set(1, 1, turnScale);
      turnRing.material.opacity = 0.2 + Math.min(0.5, turnMagnitude * 0.35);
    }
  }

  if (label) {
    renderManager.updateSpriteLabel(
      label,
      `f:${fs.toFixed(2)} r:${rs.toFixed(2)}`,
      mode === 'sent' ? '#7cf29a' : '#7cd6ff'
    );
    label.visible = true;
  }

  gizmo.visible = showDebugGeometry;
}

function showSelectedFaceDebug(faceCenter, obstacleName = null, mode = 'slide') {
  if (!showDebugGeometry) return;
  const marker = ensureSelectedFaceDebugMarker();
  if (!marker || !faceCenter) return;
  marker.position.set(faceCenter.x, faceCenter.y || 0, faceCenter.z);
  const pole = marker.children[0];
  const cap = marker.children[1];
  const isBlocked = mode === 'blocked';
  if (pole && pole.material) {
    pole.material.color.setHex(isBlocked ? 0xff5a5a : 0x00ffff);
  }
  if (cap) {
    if (cap.material) {
      cap.material.color.setHex(isBlocked ? 0xffd166 : 0xffff00);
    }
    const baseDirection = cap.userData.baseDirection || new THREE.Vector3(0, 1, 0);
    const normalX = faceCenter.normal?.x || 0;
    const normalZ = faceCenter.normal?.z || 0;
    const normalLength = Math.hypot(normalX, normalZ);
    if (normalLength > 1e-6) {
      const targetDirection = new THREE.Vector3(normalX / normalLength, 0, normalZ / normalLength);
      cap.quaternion.setFromUnitVectors(baseDirection, targetDirection);
    } else {
      cap.quaternion.identity();
    }
  }
  if (marker.userData.nameLabel) {
    renderManager.updateSpriteLabel(
      marker.userData.nameLabel,
      obstacleName || faceCenter.name || 'face',
      isBlocked ? '#ff8c69' : '#00ffff'
    );
    marker.userData.nameLabel.visible = true;
  }
  marker.visible = true;
  selectedFaceDebugTouchedThisFrame = true;
}

function hideSelectedFaceDebug() {
  if (selectedFaceDebugMarker) selectedFaceDebugMarker.visible = false;
}

function showSupportSurfaceDebug(obstacle, surfaceY) {
  if (!showDebugGeometry || !obstacle || typeof surfaceY !== 'number') return;
  const marker = ensureSupportSurfaceDebugMarker();
  if (!marker) return;
  marker.position.set(obstacle.x, surfaceY, obstacle.z);
  if (marker.userData.nameLabel) {
    renderManager.updateSpriteLabel(marker.userData.nameLabel, obstacle.name || 'support', '#ffb347');
    marker.userData.nameLabel.visible = true;
  }
  marker.visible = true;
  supportSurfaceDebugTouchedThisFrame = true;
}

function hideSupportSurfaceDebug() {
  if (supportSurfaceDebugMarker) supportSurfaceDebugMarker.visible = false;
}

function hideSupportFootprintDebug() {
  if (supportFootprintDebugMarker) supportFootprintDebugMarker.visible = false;
}

function getSupportOutlinePoints(obstacle, supportSurface) {
  if (!obstacle || !supportSurface) return null;
  const epsilon = 0.06;
  const rotation = obstacle.rotation || 0;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const toWorldPoint = (lx, ly, lz) => new THREE.Vector3(
    obstacle.x + lx * cos + lz * sin,
    ly,
    obstacle.z - lx * sin + lz * cos
  );

  if (obstacle.type === 'pyramid' && supportSurface.contact?.climbable && !obstacle.inverted) {
    const halfW = obstacle.w / 2;
    const halfD = obstacle.d / 2;
    const height = getPyramidHeight(obstacle);
    const axis = supportSurface.contact.faceAxis;
    const sign = supportSurface.contact.faceSign || 1;
    const normal = supportSurface.contact.normal || { x: 0, y: 1, z: 0 };
    const normalOffset = new THREE.Vector3(normal.x, normal.y, normal.z).multiplyScalar(epsilon);
    let localPoints;
    if (axis === 'x') {
      localPoints = [
        { x: 0, y: obstacle.baseY + height, z: 0 },
        { x: sign * halfW, y: obstacle.baseY, z: -halfD },
        { x: sign * halfW, y: obstacle.baseY, z: halfD }
      ];
    } else {
      localPoints = [
        { x: 0, y: obstacle.baseY + height, z: 0 },
        { x: -halfW, y: obstacle.baseY, z: sign * halfD },
        { x: halfW, y: obstacle.baseY, z: sign * halfD }
      ];
    }
    return localPoints.map((point) =>
      toWorldPoint(point.x, point.y, point.z).add(normalOffset)
    );
  }

  const halfW = obstacle.w / 2;
  const halfD = obstacle.d / 2;
  const y = supportSurface.surfaceY + epsilon;
  return [
    toWorldPoint(-halfW, y, -halfD),
    toWorldPoint(-halfW, y, halfD),
    toWorldPoint(halfW, y, halfD),
    toWorldPoint(halfW, y, -halfD)
  ];
}

function showSupportFootprintDebug(obstacle, supportSurface) {
  if (!showDebugGeometry || !obstacle || !supportSurface) return;
  const marker = ensureSupportFootprintDebugMarker();
  if (!marker) return;
  const points = getSupportOutlinePoints(obstacle, supportSurface);
  if (!points || points.length < 3) return;
  if (marker.geometry) marker.geometry.dispose();
  marker.geometry = new THREE.BufferGeometry().setFromPoints(points);
  marker.visible = true;
  supportFootprintDebugTouchedThisFrame = true;
}

function updateDebugGeometryVisibility() {
  renderManager.setGroundGridEnabled(showDebugGeometry, gameConfig?.MAP_SIZE);
  if (!showDebugGeometry) {
    hideSelectedFaceDebug();
    hideSupportSurfaceDebug();
    hideSupportFootprintDebug();
  }
  tanks.forEach((tank) => {
    if (tank.userData.ghostMesh) {
      const isLocalTank = tank.userData && tank.userData.playerState && tank.userData.playerState.id === myPlayerId;
      const shouldShowGhost = showDebugGeometry && (!isLocalTank || Boolean(tank.userData.ghostMesh.userData.hasPacketState));
      tank.userData.ghostMesh.visible = shouldShowGhost;
      if (tank.userData.ghostMesh.userData.packetMotionDebug) {
        tank.userData.ghostMesh.userData.packetMotionDebug.visible = shouldShowGhost;
      }
    }
    if (tank.userData.jumpPredictionDebug) {
      tank.userData.jumpPredictionDebug.visible = showDebugGeometry;
    }
  });
}

// The counters mean nothing apart from the machine that produced them, and the
// machines a render level would be for -- a headset, a phone -- are the ones
// nobody opens the debug HUD on. So one line lands when the HUD closes, and one
// a while into every map, which is the only sample those devices ever send.
function logRenderStats(reason) {
  const stats = renderManager.getRenderStats();
  if (!stats) return;
  const phases = framePhaseReport ? ` ${describeMeasurements(framePhaseReport)}` : '';
  debugLog(`renderer.stats reason=${reason} fps=${fps} ${describeMeasurements(stats)}${phases}`);
}

function setDebugEnabledState(value) {
  if (debugEnabled && !value) logRenderStats('debugHudClosed');
  debugEnabled = value;
  // Only toggles debug HUD, not debug labels
  syncDebugTabVisibility();
}

function getDebugState() {
  return {
    fps,
    latency,
    packetsSent,
    packetsReceived,
    sentBps,
    receivedBps,
    playerX,
    playerY,
    playerZ,
    playerRotation,
    myTank,
    cameraMode,
    OBSTACLES,
    clouds: renderManager.getClouds(),
    latestOrientation,
    worldTime,
    gamepadConnected: isGamepadConnected(),
    gamepadInfo: getGamepadInfo(),
    renderStats: renderManager.getRenderStats(),
    framePhases: framePhaseReport
  };
}

// Keys the game acts on. Holding the browser off them is the keydown
// listener's job in input.js, which claims the whole set before this runs.
function handleGameplayKeydown(event) {
  if (event.code === 'KeyP') {
    sendToServer({ type: 'pause' });
    return true;
  }

  if (event.key === 'n' || event.key === 'N') {
    focusChatWithTarget(CHAT_TARGET_ALL);
    return true;
  }

  if (event.code === 'Period' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
    handleReplyToLastSender();
    return true;
  }

  if (event.code === 'Comma' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
    handleMessageNemesisTarget();
    return true;
  }

  const chatTabsByCode = {
    Digit1: 'all',
    Digit2: 'chat',
    Digit3: 'server',
    Digit4: 'misc',
    Digit5: 'debug',
  };
  const tabId = chatTabsByCode[event.code];
  if (tabId) {
    setActiveChatTab(tabId);
    return true;
  }

  if (event.code === 'BracketLeft' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
    cycleChatTab(-1);
    return true;
  }
  if (event.code === 'BracketRight' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
    cycleChatTab(1);
    return true;
  }
  if (event.code === 'PageUp' || event.key === 'PageUp') {
    scrollChatPage(1);
    return true;
  }
  if (event.code === 'PageDown' || event.key === 'PageDown') {
    scrollChatPage(-1);
    return true;
  }
  if (event.code === 'End' || event.key === 'End') {
    scrollChatToNewest();
    return true;
  }
  // Shift is ignored: + and = are one key, and demanding the shift made zooming
  // out a two-handed job while zooming in needed none.
  if (event.code === 'Equal' || event.code === 'NumpadAdd') {
    adjustRadarZoom(1);
    return true;
  }
  if (event.code === 'Minus' || event.code === 'NumpadSubtract') {
    adjustRadarZoom(-1);
    return true;
  }
  if (event.code === 'Backslash') {
    setRadarZoomLevel(RADAR_ZOOM_DEFAULT);
    return true;
  }
  if (event.code === 'KeyQ' && ws && ws.readyState === WebSocket.OPEN) {
    sendToServer({ type: 'selfDestruct' });
    return true;
  }
  if (event.code === 'Escape') {
    mouseControlEnabled = false;
    showMessage('Controls: Keyboard');
    return true;
  }
  return false;
}

initHudControls({
  showMessage,
  updateHudButtons,
  toggleDebugHud,
  toggleDebugLabels,
  updateDebugDisplay,
  getDebugEnabled: () => debugEnabled,
  setDebugEnabled: setDebugEnabledState,
  getDebugLabelsEnabled: () => debugLabelsEnabled,
  setDebugLabelsEnabled: (value) => {
    debugLabelsEnabled = value;
    renderManager.setDebugLabelsEnabled(debugLabelsEnabled);
    localStorage.setItem('debugLabelsEnabled', debugLabelsEnabled.toString());
    updateDebugLabelsButton();
  },
  getDebugState,
  getCameraMode: () => cameraMode,
  setCameraMode: (mode) => { cameraMode = mode; },
  getMouseControlEnabled: () => mouseControlEnabled,
  setMouseControlEnabled: (value) => { mouseControlEnabled = value; },
  getVirtualControlsEnabled: () => virtualControlsEnabled,
  setVirtualControlsEnabled: (value) => { virtualControlsEnabled = value; },
  pushChatMessage: (msg) => {
    addChatEntry(['misc', 'all'], msg, CHAT_KIND_MISC);
  },
  updateChatWindow: () => updateChatWindow(),
  sendToServer: (payload) => sendToServer(payload),
  requestVoicePermission,
  toggleVoiceMicrophone,
  getGameAudioState: () => renderManager.getGameAudioState(),
  setGameAudioVolume,
  toggleGameAudioMute,
  getScene: () => scene,
  getChatInput: () => chatInput,
  toggleEntryDialog,
  handleGameplayKeydown,
});

// --- Debug Labels Button Wiring ---
function updateDebugLabelsButton() {
  const btn = document.getElementById('debugLabelsBtn');
  if (!btn) return;
  if (debugLabelsEnabled) {
    btn.classList.add('active');
    btn.title = 'Hide Debug Labels';
  } else {
    btn.classList.remove('active');
    btn.title = 'Show Debug Labels';
  }
}

window.addEventListener('DOMContentLoaded', () => {
  updateRadarZoomButton();

  document.getElementById('radarZoomBtn')?.addEventListener('click', cycleRadarZoomLevel);

  // A context that cannot light the scene overrides the saved preference: the
  // row goes dead rather than promising something it cannot draw.
  const canLight = renderManager.canUseDynamicLighting();
  renderManager.dynamicLightingEnabled = readStoredFlag('dynamicLightingEnabled', true) && canLight;
  bindToggleButton(document.getElementById('dynamicLightingBtn'), {
    get: () => renderManager.dynamicLightingEnabled,
    set: (value) => { renderManager.dynamicLightingEnabled = value; },
    storageKey: 'dynamicLightingEnabled',
    onTitle: 'Disable Dynamic Lighting',
    offTitle: 'Enable Dynamic Lighting',
    available: () => canLight,
    unavailableTitle: 'Dynamic Lighting needs more shader uniforms than this browser reports',
  });

  const refreshAnaglyphBtn = bindToggleButton(document.getElementById('anaglyphBtn'), {
    get: () => renderManager.getAnaglyphEnabled(),
    set: (value) => renderManager.setAnaglyphEnabled(value),
    onTitle: 'Disable Anaglyph 3D',
    offTitle: 'Enable Anaglyph 3D',
    // The headset draws its own stereo pair, so anaglyph has nothing to add.
    available: () => !isXREnabled(),
    unavailableTitle: 'Anaglyph 3D is unavailable in VR mode',
    forceOffWhenUnavailable: true,
  });
  window.addEventListener('webxrsessionchange', refreshAnaglyphBtn);

  bindToggleButton(document.getElementById('debugGeometryBtn'), {
    get: () => showDebugGeometry,
    set: (value) => { showDebugGeometry = value; },
    storageKey: 'showDebugGeometry',
    onTitle: 'Hide Debug Geometry',
    offTitle: 'Show Debug Geometry',
    onChange: updateDebugGeometryVisibility,
  });

  // Add handler for Upload Map button
  const uploadBtn = document.getElementById('uploadBtn');
  const uploadMap = document.getElementById('uploadMap');
  if (uploadBtn && uploadMap) {
    uploadBtn.addEventListener('click', () => {
      const file = uploadMap.files && uploadMap.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(e) {
        const content = e.target.result;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'uploadMap',
            mapName: file.name,
            mapContent: content
          }));
        }
      };
      reader.readAsText(file);
    });
  }

  const setMotdBtn = document.getElementById('setMotdBtn');
  const motdInput = document.getElementById('motdInput');
  if (setMotdBtn && motdInput) {
    setMotdBtn.addEventListener('click', () => {
      const motd = motdInput.value.trim();
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      sendToServer({
        type: 'setOperatorConfig',
        motd,
      });
    });
  }

  const setShotMaxActiveBtn = document.getElementById('setShotMaxActiveBtn');
  const shotMaxActiveInput = document.getElementById('shotMaxActiveInput');
  if (setShotMaxActiveBtn && shotMaxActiveInput) {
    setShotMaxActiveBtn.addEventListener('click', () => {
      const parsed = Number(shotMaxActiveInput.value);
      if (!Number.isFinite(parsed)) {
        showMessage('Shot max active must be a number.');
        return;
      }
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      sendToServer({
        type: 'setOperatorConfig',
        shotMaxActive: Math.round(parsed),
      });
    });
  }
  const btn = document.getElementById('debugLabelsBtn');
  if (btn) {
    btn.addEventListener('click', () => {
      toggleDebugLabels({
        debugLabelsEnabled,
        setDebugLabelsEnabled: (v) => {
          debugLabelsEnabled = v;
          renderManager.setDebugLabelsEnabled(debugLabelsEnabled);
          localStorage.setItem('debugLabelsEnabled', debugLabelsEnabled.toString());
          updateDebugLabelsButton();
        },
        updateHudButtons: () => updateHudButtons({
          mouseBtn: document.getElementById('mouseBtn'),
          mouseControlEnabled,
          debugBtn: document.getElementById('debugBtn'),
          debugEnabled,
          fullscreenBtn: document.getElementById('fullscreenBtn'),
          cameraBtn: document.getElementById('cameraBtn'),
          cameraMode
        }),
        showMessage
      });
    });
    updateDebugLabelsButton();
  }

  // Add handler for Restart with Map button
  const restartBtn = document.getElementById('restartBtn');
  const mapList = document.getElementById('mapList');
  if (restartBtn && mapList) {
    restartBtn.addEventListener('click', () => {
      const selectedMap = mapList.value;
      if (ws && ws.readyState === WebSocket.OPEN && selectedMap) {
        ws.send(JSON.stringify({ type: 'setMap', mapFile: selectedMap }));
      }
    });
  }

  // Initialize WebXR support
  window.addEventListener('webxrsessionchange', event => {
    if (event.detail?.enabled) return;
    closeXRSettingsMenu();
    document.getElementById('xrTextInput')?.blur();
    xrSettingsShortcutLatched = false;
    setXRButtonState(false);
    // A player who left XR before joining needs the dialog they never saw.
    if (!gameplayJoinConfirmed && isDefaultPlayerName(myPlayerName) && !isEntryDialogOpen()) {
      toggleEntryDialog(myPlayerName);
    }
  });

  initXR().then(mode => {
    showMessage(`WebXR: ${mode}`, 'info');
    const xrBtn = document.getElementById('xrBtn');
    const xrQuickBtn = document.getElementById('xrQuickBtn');
    if (mode === 'none') {
      if (xrBtn) {
        xrBtn.disabled = true;
        xrBtn.title = 'WebXR not supported on this device';
        xrBtn.classList.add('disabled');
      }
    } else {
      const toggleXRFromUi = async ({ announceFailure = true } = {}) => {
        showMessage('Requesting VR...');
        const renderer = renderManager.getRenderer();
        if (!renderer) {
          showMessage('Error: Renderer not available');
          return false;
        }

        const wasEnabled = isXREnabled();
        const result = await toggleXRSession(renderer, animate);
        if (result || isXREnabled()) {
          setXRButtonState(true);
          closeSettingsDialog();
          // Force first-person camera when entering VR
          cameraMode = 'first-person';
          // Whatever the 2D dialog was asking for, ask for it on the XR panel.
          if (isEntryDialogOpen()) openXRJoinMenu();
          showMessage('✓ WebXR VR Mode: ON');
          return true;
        }

        setXRButtonState(false);
        if (!wasEnabled && announceFailure) {
          showMessage('✗ VR request failed - check server.log');
        }
        showMessage('WebXR VR Mode: OFF');
        return false;
      };
      const xrClickHandler = () => {
        void toggleXRFromUi();
      };
      if (xrBtn) xrBtn.addEventListener('click', xrClickHandler);
      if (xrQuickBtn) {
        xrQuickBtn.addEventListener('click', xrClickHandler);
        if (isHeadsetDevice()) xrQuickBtn.classList.add('xrAvailable');
      }
      // A headset launched from its own icon has nothing to show in 2D: a saved
      // name joins with no dialog at all, and without one the XR menu asks.
      if (isHeadsetAppLaunch()) {
        debugLog(
          `autolaunch mode=${mode} display=${getDisplayMode()}`
          + ` digitalGoods=${typeof window.getDigitalGoodsService}`
          + ` activation=${navigator.userActivation?.isActive}/${navigator.userActivation?.hasBeenActive}`
          + ` t=${Math.round(performance.now())}ms`,
          'WebXR',
        );
        // The launch keeps asking for a session in the background, on every
        // signal that could carry the activation it needs, so enter VR whenever
        // one lands rather than only on this first attempt.
        window.addEventListener(XR_LAUNCH_SESSION_EVENT, () => {
          void toggleXRFromUi({ announceFailure: false });
        });
        void toggleXRFromUi({ announceFailure: false });
      }
    }
  });
});

// Initialize Three.js
function init() {
  // Prevent iOS scrolling/bounce on fullscreen (web app mode)
  document.addEventListener('touchmove', (e) => {
    // Allow touch on specific elements (chat, controls overlay, etc.)
    const allowedSelectors = ['#chatInput', '#chatWindow', '#controlsOverlay', '#settingsHud', '#voiceOverlay', '#helpPanel', '#entryDialog', '#operatorOverlay'];
    const isAllowed = allowedSelectors.some(sel => {
      const el = document.querySelector(sel);
      return el && (e.target === el || (e.target && el.contains(e.target)));
    });

    if (!isAllowed) {
      e.preventDefault();
    }
  }, { passive: false });

  setupInputHandlers();
  bindVoiceControls();
  initializeVoiceManager();
  collectClientCapabilities();

  // Chat UI
  const chatTabs = document.getElementById('chatTabs');
  chatInput = document.getElementById('chatInput');
  sendBtn = document.getElementById('sendBtn');
  const chatTarget = document.getElementById('chatTarget');

  // Helper to update chatTarget dropdown with player names
  function updateChatTargetOptions() {
    if (!chatTarget) return;
    // Save current selection
    const prevValue = chatTarget.value;
    // Remove all except ALL and SERVER
    for (let i = chatTarget.options.length - 1; i >= 0; i--) {
      if (chatTarget.options[i].value !== '0' && chatTarget.options[i].value !== '-1') {
        chatTarget.remove(i);
      }
    }
    // Add each player by name
    tanks.forEach((tank, id) => {
      if (id === myPlayerId) return; // Don't add self
      const name = tank.userData && tank.userData.playerState && tank.userData.playerState.name ? tank.userData.playerState.name : `Player ${id}`;
      let opt = document.createElement('option');
      opt.value = id;
      opt.textContent = name;
      chatTarget.appendChild(opt);
    });
    // Restore previous selection if possible
    chatTarget.value = prevValue;
  }

  // Update dropdown whenever tanks change
  setInterval(updateChatTargetOptions, 1000);
  updateChatTargetOptions();

  if (chatTabs) {
    chatTabs.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const target = e.target.closest('button[data-chat-tab]');
      if (!target) return;
      const tabId = target.getAttribute('data-chat-tab');
      if (tabId) {
        setActiveChatTab(tabId);
      }
    });
  }

  const chatMessagesDiv = document.getElementById('chatMessages');
  const onChatWheel = (e) => {
    if (e.deltaY < 0) {
      adjustChatScroll(CHAT_SCROLL_STEP);
    } else if (e.deltaY > 0) {
      adjustChatScroll(-CHAT_SCROLL_STEP);
    }
    e.preventDefault();
  };
  if (chatMessagesDiv) {
    chatMessagesDiv.addEventListener('wheel', onChatWheel, { passive: false });
    // The transcript only takes the pointer while chat entry is active, for
    // selecting text out of it. A drag there is a copy and keeps its selection;
    // a plain click is not, so the keyboard goes back to the input.
    let chatEntryWasActive = false;
    chatMessagesDiv.addEventListener('mousedown', () => {
      chatEntryWasActive = chatActive;
    });
    chatMessagesDiv.addEventListener('mouseup', () => {
      if (!chatEntryWasActive) return;
      chatEntryWasActive = false;
      const selection = window.getSelection();
      if (selection && selection.toString().length > 0) return;
      chatInput.focus();
    });
  }
  if (chatTabs) {
    chatTabs.addEventListener('wheel', onChatWheel, { passive: false });
  }

  chatInput.addEventListener('keydown', (e) => {
    // Prevent all game events while typing
    e.stopPropagation();
    if (e.code === 'PageUp' || e.key === 'PageUp') {
      scrollChatPage(1);
      e.preventDefault();
      return;
    }
    if (e.code === 'PageDown' || e.key === 'PageDown') {
      scrollChatPage(-1);
      e.preventDefault();
      return;
    }
    if (e.code === 'End' || e.key === 'End') {
      scrollChatToNewest();
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter') {
      sendChatInputText();
      chatInput.blur();
    } else if (e.key === 'Escape') {
      chatInput.blur();
    }
  });

  // Focus is what makes chat entry active, and the game gives up the keyboard
  // with it.
  chatInput.addEventListener('focus', () => {
    setChatEntryActive(true);
    setInputContext(INPUT_CONTEXT.CHAT);
  });
  chatInput.addEventListener('blur', () => {
    setChatEntryActive(false);
    syncInputContextFromUi();
  });
  // Picking a recipient is a step on the way to typing, so the keyboard follows
  // the choice into the input rather than being left with nothing focused.
  chatTarget.addEventListener('change', () => {
    chatInput.focus();
  });

  // Acting on mousedown, with the default prevented, keeps the button from
  // blurring the input first: by the time a click event arrived chat would
  // already have ended, and the button would reopen it instead of sending.
  let sendToggledByPointer = false;
  sendBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    sendToggledByPointer = true;
    toggleChatEntry();
  });
  sendBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (sendToggledByPointer) {
      sendToggledByPointer = false;
      return;
    }
    toggleChatEntry();
  });
  syncDebugTabVisibility();
  updateChatWindow();
  announceBuildInfoOnce();

  // Restore debug state from localStorage
  if (readStoredFlag('debugEnabled')) {
    const mouseBtn = document.getElementById('mouseBtn');
    const debugBtn = document.getElementById('debugBtn');
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const cameraBtn = document.getElementById('cameraBtn');
    toggleDebugHud({
      debugEnabled,
      setDebugEnabled: setDebugEnabledState,
      updateHudButtons: () => updateHudButtons({ mouseBtn, mouseControlEnabled, debugBtn, debugEnabled, fullscreenBtn, cameraBtn, cameraMode }),
      showMessage,
      updateDebugDisplay,
      getDebugState
    });
  }

  let renderContext;
  try {
    renderContext = renderManager.init({});
    scene = renderContext.scene;
    camera = renderContext.camera;
    const renderer = renderManager.getRenderer();
    if (renderer) {
      const rendererSize = renderer.getSize(new THREE.Vector2());
      const drawingBufferSize = renderer.getDrawingBufferSize(new THREE.Vector2());
      debugLog(
        `renderer.init.ok viewport=${window.innerWidth}x${window.innerHeight} canvas=${renderer.domElement.width}x${renderer.domElement.height} css=${rendererSize.x}x${rendererSize.y} drawbuf=${drawingBufferSize.x}x${drawingBufferSize.y}`,
      );
      const capabilities = renderManager.getRenderCapabilities();
      if (capabilities) debugLog(`renderer.capabilities ${describeRenderCapabilities(capabilities)}`);
    }
  } catch (error) {
    console.error('Failed to initialize 3D renderer:', error);
    const reason = error && error.message ? error.message : 'Unknown renderer initialization error';
    showMessage(`3D renderer unavailable: ${reason}`);
    debugLog(`renderer.init.failed reason="${reason}"`);
    scene = renderManager.getScene();
    camera = renderManager.getCamera();
    const debugContent = document.getElementById('debugContent');
    if (debugContent) {
      debugContent.innerHTML = `<p>3D renderer failed to initialize.</p><p>${reason}</p><p>Open the game in an external browser window for full WebGL support.</p>`;
      const debugHud = document.getElementById('debugHud');
      if (debugHud) debugHud.style.display = 'block';
    }
  }

  if (renderManager.getRenderer()) {
    initTankSelector();
    renderManager.setTankModel(getTankModelPathById(selectedTankModelId));
  }

  // Radar map
  radarCanvas = document.getElementById('radar');
  radarCtx = radarCanvas.getContext('2d');
  resizeRadar();
  updateRadar();
  updateChatLayoutForDebugOverlap();
  updateMotionBoxMetrics();

  // Event listeners
  window.addEventListener('resize', () => {
    onWindowResize();
    updateChatLayoutForDebugOverlap();
    updateMotionBoxMetrics();
  });

  // Mouse movement for analog control
  // Mouse analog control using position relative to center (cursor always visible)
  document.addEventListener('mousemove', (e) => {
    if (!isGameplayInputActive() || !mouseControlEnabled) return;
    mouseX = motionBoxAxisInput(e.clientX - window.innerWidth / 2);
    mouseY = motionBoxAxisInput(e.clientY - window.innerHeight / 2);
  });

  // Mouse click to shoot (or enable mouse controls on first click)
  let justActivatedMouseControl = false;
  document.addEventListener('mousedown', (e) => {
    // A click outside an open dialog closes it and is consumed here, so it never
    // reaches the tank. The click after that one is an ordinary gameplay click.
    if (dismissDialogFromOutsideClick(e.target)) return;

    // Chat entry ends on Enter, Escape, or the Chat button, never on a stray
    // click. Preventing the default keeps focus in the input, which is what
    // holds the keyboard.
    if (chatActive) {
      if (!(e.target.closest && e.target.closest('#chatWindow'))) {
        e.preventDefault();
      }
      return;
    }

    if (!isGameplayInputActive()) return;

    // The chat panel is click-through while chat is idle, so a click that does
    // land in it is on one of its controls and belongs to chat, not the tank.
    if (e.target.closest && e.target.closest('#chatWindow')) return;

    // Anything clickable in the HUD is chrome, not the battlefield. Matching on
    // the control itself rather than a list of ids means a button added later is
    // covered without touching this, and it holds in mouse mode too: pressing
    // Settings should never also fire the tank.
    if (e.target.closest && e.target.closest('button, a, input, select, textarea, #playerName')) {
      return;
    }

    if (e.button === 0) { // Left click
      if (justActivatedMouseControl) {
        justActivatedMouseControl = false;
        return;
      }
      setGameplayKeyState(FIRE_KEY, true);
    }
  });

  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) {
      setGameplayKeyState(FIRE_KEY, false);
    }
  });

  // Load saved player name from localStorage
  const savedName = localStorage.getItem('playerName');
  const entryDialog = document.getElementById('entryDialog');
  const entryInput = document.getElementById('entryInput');
  if (savedName && savedName.trim().length > 0) {
    const trimmed = savedName.trim();
    myPlayerName = trimmed;
    entryInput.value = trimmed;
  }

  // Add click handler for name change
  const playerNameEl = document.getElementById('playerName');
  const entryOkButton = document.getElementById('entryOkButton');
  const entryDefaultButton = document.getElementById('entryDefaultButton');

  if (playerNameEl && entryDialog) {
    entryOkButton.addEventListener('click', () => {
      savePlayerName(entryInput.value);
      setPendingJoinRequest(myPlayerName);
      maybeSendPendingJoinRequest();
      toggleEntryDialog();
    });

    entryDefaultButton.addEventListener('click', () => {
      // Send blank name to server to request default Player n assignment
      localStorage.setItem('playerName', '');
      myPlayerName = '';
      setPendingJoinRequest(myPlayerName);
      maybeSendPendingJoinRequest();
      toggleEntryDialog();
    });

    entryInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        entryOkButton.click();
      } else if (e.key === 'Escape') {
        entryDefaultButton.click();
      }
    });
  }

  setupInstallPrompt(document.getElementById('installBtn'), refreshSettingsMenu);

  // Connect to server
  connectToServer();

  // Update control box border color based on mode
  const controlBox = document.getElementById('controlBox');
  setInterval(() => {
    if (controlBox) {
      if (mouseControlEnabled) {
        controlBox.classList.remove('keyboard-mode');
      } else {
        controlBox.classList.add('keyboard-mode');
      }
    }
  }, 100);

  // Let Three.js own frame scheduling in both normal and XR modes.
  const renderer = renderManager.getRenderer();
  setNormalAnimationLoop(renderer, animate);
  if (!renderManager.setAnimationLoop(animate)) {
    // Keep the update loop alive when renderer initialization failed.
    runFallbackAnimationLoop();
  }
}

function sendToServer(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    // Track sent packets
    if (debugEnabled) {
      const type = message.type || 'unknown';
      packetsSent.set(type, (packetsSent.get(type) || 0) + 1);
    }
    const data = JSON.stringify(message);
    ws.send(data);
    sentBytes += data.length;
  }
}


function connectToServer() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.onopen = () => {
    callVoiceManager('start');
    showMessage('Connected to server!');
    debugLog(`ws.open host=${window.location.host} protocol=${window.location.protocol}`);
    flushDebugPacketQueue();
    setLoadingOverlayState({
      visible: true,
      progress: 0.02,
      status: 'Connected to server',
      detail: 'Waiting for world state',
    });
  };

  ws.onmessage = (event) => {
    receivedBytes += event.data.length;
    const message = JSON.parse(event.data);

    // Track received packets
    if (debugEnabled) {
      const type = message.type || 'unknown';
      packetsReceived.set(type, (packetsReceived.get(type) || 0) + 1);
    }

    handleServerMessage(message);
  };

  ws.onclose = (event) => {
    renderReadyForJoin = false;
    gameplayJoinConfirmed = false;
    updatePlayerTeamSelectorAvailability();
    activeInitSequence = 0;
    hideLoadingOverlay();
    let kills = 0;
    let deaths = 0;
    if (myTank && myTank.userData && myTank.userData.playerState) {
      kills = myTank.userData.playerState.kills || 0;
      deaths = myTank.userData.playerState.deaths || 0;
    }
    console.log(`Disconnected from server (code: ${event.code}, reason: ${event.reason}) | Kills: ${kills} | Deaths: ${deaths}`);
    const scheduleReconnect = (delay) => {
      void resetVoiceManagerForReconnect().finally(() => {
        setTimeout(connectToServer, delay);
      });
    };
    // Ignore 503 (Service Unavailable) and silently retry
    if (event.code === 1008 || event.reason === '503') {
      console.log('Server temporarily unavailable (503), retrying...');
      scheduleReconnect(2000);
      return;
    }
    showMessage(`Disconnected from server | Kills: ${kills} | Deaths: ${deaths}`, 'death');
    scheduleReconnect(3000);
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    const details = error && error.message ? error.message : 'WebSocket error event';
    debugLog(`ws.error ${details}`);
  };
}

function handleServerMessage(message) {
  // Let the voice manager consume signaling and nearby voice state while the
  // regular game switch continues to own player, render, and chat messages.
  if (voiceManager) {
    const voiceHandled = callVoiceManager('handleServerMessage', message);
    if (typeof message.type === 'string' && message.type.startsWith('voice')) {
      if (!voiceHandled.called || voiceHandled.value !== false) return;
    }
  }

  // Some admin/operator responses are sent without a message type.
  if (typeof message?.error === 'string' && message.error.length > 0) {
    console.error('Server error response:', message.error, message);
    showMessage(`Server error: ${message.error}`);
    return;
  }

  if (message?.success === true && typeof message.type !== 'string') {
    showMessage('Server: action completed successfully');
    return;
  }

  switch (message.type) {
    case 'init': {
      const sequenceId = ++initSequence;
      activeInitSequence = sequenceId;
      renderReadyForJoin = false;
      gameplayJoinConfirmed = false;
      updatePlayerTeamSelectorAvailability();
      pendingJoinRequest = null;

      // Show server info in entryDialog
      const serverNameEl = document.getElementById('serverName');
      const serverDescriptionEl = document.getElementById('serverDescription');
      const serverMotdEl = document.getElementById('serverMotd');
      serverDescriptionText = message.description || '';
      serverMotdText = message.motd || '';
      if (serverNameEl) serverNameEl.textContent = 'Server: ' + (message.serverName || '');
      if (serverDescriptionEl) serverDescriptionEl.textContent = serverDescriptionText;
      if (serverMotdEl) serverMotdEl.textContent = serverMotdText;
      announceServerTextIfChanged();
      worldTime = message.worldTime;
      // Clear any existing tanks from previous connections
      tanks.forEach((tank) => {
        // Remove ghost mesh if it exists
        if (tank.userData.ghostMesh) {
          renderManager.getWorldGroup().remove(tank.userData.ghostMesh);
          tank.userData.ghostMesh = null;
        }
        renderManager.getWorldGroup().remove(tank);
      });
      tanks.clear();

      // Clear any existing projectiles
      projectiles.forEach((projectile) => {
        renderManager.removeProjectile(projectile);
      });
      projectiles.clear();
      pendingLocalProjectiles = [];

      // Clear any existing shields
      playerShields.forEach((shield) => {
        renderManager.removeShield(shield);
      });
      playerShields.clear();

      // Clear any existing clouds
      renderManager.clearClouds();

      myPlayerId = message.player.id;
      gameConfig = message.config;
      setAvailablePlayerTeams(message.teamMode.teams);
      teamScores = message.teamScores || [];
      if (message.voiceRtcConfig && typeof message.voiceRtcConfig === 'object') {
        voiceRtcConfig = message.voiceRtcConfig;
        callVoiceManager('setRtcConfig', voiceRtcConfig);
      }
      // Keep the requested team until the server confirms the joined player.
      // The initial handshake describes the temporary connection player.
      updateVoiceIdentity();
      renderManager._applyFogConfig(gameConfig);
      refreshCollisionColliders();
      playerX = message.player.x;
      playerZ = message.player.z;
      playerRotation = message.player.rotation;

      // Only send join if there is a saved name of the player's own choosing
      const savedName = getSavedJoinableName();
      if (savedName) {
        myPlayerName = savedName;
      }
      if (!isDefaultPlayerName(myPlayerName)) {
        setPendingJoinRequest(myPlayerName);
      } else {
        // Ask for a name: in XR on the menu panel, otherwise in the 2D dialog
        myPlayerName = message.player.name;
        if (isXREnabled()) openXRJoinMenu();
        else toggleEntryDialog(myPlayerName);
      }

      // Initialize dead reckoning state (velocity-based)
      lastSentForwardSpeed = 0;
      lastSentRotationSpeed = 0;
      lastSentVerticalVelocity = 0;
      lastSentTime = performance.now();
      void prepareInitialRender(message, sequenceId);
      break;
    }

    case 'playerJoined':
      if (message.player.id === myPlayerId) {
        gameplayJoinConfirmed = true;
        updatePlayerTeamSelectorAvailability();
        playerTeam = normalizePlayerTeam(message.player.team);
        syncPlayerTeamSelector();
        updateVoiceIdentity();
        const wasAliveBefore = !!(myTank && myTank.userData?.playerState?.health > 0);
        addPlayer(message.player);

        // This is our join confirmation, update our tank and finish join
        myPlayerName = message.player.name;
        playerX = message.player.x;
        playerY = message.player.y;
        playerZ = message.player.z;
        playerRotation = message.player.rotation;

        // Save the name to localStorage (server may have kept our requested name or assigned default)
        localStorage.setItem('playerName', myPlayerName);
        pendingJoinRequest = null;

        // Update player name display
        document.getElementById('playerName').textContent = myPlayerName;

        // Reuse and update my tank
        myTank = tanks.get(myPlayerId);
        if (myTank) {
          myTank.position.set(playerX, playerY, playerZ);
          myTank.rotation.y = playerRotation;
          myTank.userData.verticalVelocity = message.player.verticalVelocity || 0;
          myTank.userData.playerState = message.player;

          // Update name label with confirmed name from server
          if (myTank.userData.nameLabel && myTank.userData.nameLabel.material) {
            renderManager.updateSpriteLabel(myTank.userData.nameLabel, message.player.name, message.player.color);
          }

          // Create ghost mesh for local player to visualize what others see
          if (!myTank.userData.ghostMesh) {
            const ghostTank = renderManager.createGhostMesh(myTank);
            // Reset rotation to 0 to ensure we're setting absolute values
            ghostTank.rotation.set(0, 0, 0);
            ghostTank.position.set(playerX, playerY, playerZ);
            ghostTank.rotation.y = playerRotation;
            ghostTank.visible = showDebugGeometry;
            renderManager.getWorldGroup().add(ghostTank);
            myTank.userData.ghostMesh = ghostTank;
          }

          // Update ghost mesh name label too
          if (myTank.userData.ghostMesh && myTank.userData.ghostMesh.userData.nameLabel &&
              myTank.userData.ghostMesh.userData.nameLabel.material) {
            renderManager.updateSpriteLabel(myTank.userData.ghostMesh.userData.nameLabel, message.player.name, message.player.color);
          }

          myTank.userData.forwardSpeed = message.player.forwardSpeed || 0;
          myTank.userData.rotationSpeed = message.player.rotationSpeed || 0;
          myTank.userData.jumpDirection = message.player.jumpDirection ?? null;
          myTank.userData.slideDirection = message.player.slideDirection;
          myTank.userData.airVelocityX = message.player.airVelocityX || 0;
          myTank.userData.airVelocityZ = message.player.airVelocityZ || 0;
          myTank.visible = true;
          localTeleportReentryBlockTeleporterIndex = null;
          localTeleportReentryBlockDistance = 0;
          localTeleportReentryBlockUntil = 0;
          localTeleportCooldownUntil = 0;
          suppressLocalTeleportFxUntil = 0;

          if (!wasAliveBefore && message.player.health > 0) {
            triggerSpawnEffectForTank(myTank, message.player.color);
          }
        }
        callUpdateScoreboard();
      } else {
        // Another player joined: update their info and create their tank if needed
        const existingTank = tanks.get(message.player.id);
        const wasAliveBefore = !!(existingTank && existingTank.userData?.playerState?.health > 0);
        addPlayer(message.player);
        const joinedTank = tanks.get(message.player.id);
        if (!wasAliveBefore && message.player.health > 0 && joinedTank) {
          triggerSpawnEffectForTank(joinedTank, message.player.color);
        }
        callUpdateScoreboard();
        showMessage(`${message.player.name} joined the game`);
      }
      break;

    case 'teamUpdate':
      teamScores = message.teams || [];
      updateScoreboard({ myPlayerId, myPlayerName, myTank, tanks, teamScores });
      break;

    case 'playerLeft': {
      // Show the player's name before removing
      let leftName = 'Player';
      const leftTank = tanks.get(message.id);
      if (leftTank && leftTank.userData && leftTank.userData.playerState && leftTank.userData.playerState.name) {
        leftName = leftTank.userData.playerState.name;
      }
      showMessage(`${leftName} left the game`);
      removePlayer(message.id);
      break;
    }

    case 'playerUpdated':
      if (message.player) {
        addPlayer(message.player);
        if (message.player.id === myPlayerId) {
          myTank = tanks.get(myPlayerId);
          if (message.player.team !== undefined) {
            playerTeam = normalizePlayerTeam(message.player.team);
            syncPlayerTeamSelector();
            updateVoiceIdentity();
          }
        }
        callUpdateScoreboard();
      }
      break;

    case 'pm':
    case 'pt': {
      const isTeleportPacket = message.type === 'pt';
      // Compact playerMoved message
      const tank = tanks.get(message.id);
      if (tank) {
        const oldVerticalVel = tank.userData.verticalVelocity || 0;
        const oldJumpDirection = tank.userData.jumpDirection;

        // Store server-confirmed position for ghost rendering
        tank.userData.serverPosition = {
          x: message.x,
          y: message.y,
          z: message.z,
          r: message.r
        };
        tank.userData.lastUpdateTime = performance.now();

        // Update position (will be overridden by extrapolation in animation loop)
        tank.position.set(message.x, message.y, message.z);
        tank.rotation.y = message.r;
        tank.userData.forwardSpeed = message.fs;
        tank.userData.rotationSpeed = message.rs;
        tank.userData.verticalVelocity = message.vv;
        tank.userData.slideDirection = message.d; // Optional slide direction (undefined if not sliding)
        tank.userData.airVelocityX = Number.isFinite(message.vx)
          ? message.vx
          : tank.userData.airVelocityX || 0;
        tank.userData.airVelocityZ = Number.isFinite(message.vz)
          ? message.vz
          : tank.userData.airVelocityZ || 0;

        if (isTeleportPacket && message.jd !== undefined) {
          tank.userData.jumpDirection = message.jd;
        }

        // Detect jump start (record jump direction)
        if (oldVerticalVel <= 0 && message.vv > 10) {
          tank.userData.jumpDirection = message.r;
          renderManager.playSound('jump', tank.position);
          renderManager.fireTankJumpJets(tank);
        }

        // Detect fall start (drove off edge - record direction for air physics)
        if (oldJumpDirection === null && message.vv < 0 && message.vv > -1) {
          tank.userData.jumpDirection = message.r;
        }

        // Detect landing (clear jump direction)
        // Don't check oldVerticalVel < 0 because extrapolation doesn't update tank.userData.verticalVelocity
        if (oldJumpDirection !== null && message.vv === 0) {
          tank.userData.jumpDirection = null;
          triggerLandingFeedback(tank, Math.abs(oldVerticalVel), { local: message.id === myPlayerId });
        }

        // Update ghost mesh position to server-confirmed position
        if (tank.userData.ghostMesh) {
          tank.userData.ghostMesh.position.set(message.x, message.y, message.z);
          tank.userData.ghostMesh.rotation.y = message.r;
          updatePacketMotionDebug(tank.userData.ghostMesh, {
            fs: message.fs,
            rs: message.rs,
            vv: message.vv,
            vx: message.vx,
            vz: message.vz,
            r: message.r,
            d: message.d,
            jumpDirection: tank.userData.jumpDirection
          }, 'received');
        }

        if (tank.userData.jumpDirection !== null && tank.userData.jumpDirection !== undefined) {
          updateJumpPredictionDebug(tank, {
            x: message.x,
            y: message.y,
            z: message.z,
            r: message.r,
            forwardSpeed: message.fs,
            rotationSpeed: message.rs,
            verticalVelocity: message.vv,
            jumpDirection: tank.userData.jumpDirection,
            slideDirection: message.d,
            airVelocityX: Number.isFinite(message.vx) ? message.vx : tank.userData.airVelocityX || 0,
            airVelocityZ: Number.isFinite(message.vz) ? message.vz : tank.userData.airVelocityZ || 0
          }, 'received');
        } else {
          clearJumpPredictionDebug(tank);
        }

        if (isTeleportPacket) {
          const suppressLocalFx = message.id === myPlayerId && performance.now() < suppressLocalTeleportFxUntil;
          if (!suppressLocalFx) {
            renderManager.playSound('teleport', tank.position);
            triggerSpawnEffectForTank(tank);
          }

          if (message.id === myPlayerId) {
            playerX = message.x;
            playerY = message.y;
            playerZ = message.z;
            playerRotation = message.r;
            jumpDirection = tank.userData.jumpDirection ?? null;
            myJumpDirection = jumpDirection;
            localTeleportCooldownUntil = Date.now() + PLAYER_TELEPORT_COOLDOWN_MS;
            lastSentForwardSpeed = Number.isFinite(message.fs) ? message.fs : lastSentForwardSpeed;
            lastSentRotationSpeed = Number.isFinite(message.rs) ? message.rs : lastSentRotationSpeed;
            lastSentVerticalVelocity = Number.isFinite(message.vv) ? message.vv : lastSentVerticalVelocity;
            lastSentAirVelocityX = Number.isFinite(message.vx) ? message.vx : lastSentAirVelocityX;
            lastSentAirVelocityZ = Number.isFinite(message.vz) ? message.vz : lastSentAirVelocityZ;
            lastSentTime = performance.now();
          }
        }
      }
      break;
    }

    case 'positionCorrection':
      // Server corrected our position - update dead reckoning state
      playerX = message.x;
      playerY = message.y;
      playerZ = message.z;
      playerRotation = message.r;
      // Don't reset velocity tracking - the correction is only for position/rotation drift
      // Resetting velocities to 0 would trigger immediate resend of current velocities
      // Only update lastSentTime to prevent immediate heartbeat trigger
      lastSentTime = performance.now();
      if (myTank) {
        myTank.position.set(playerX, playerY, playerZ);
        myTank.rotation.y = playerRotation;
        myTank.userData.verticalVelocity = message.vv || 0;
        myTank.userData.airVelocityX = 0;
        myTank.userData.airVelocityZ = 0;
        myTank.userData.jumpDirection = null;
        myTank.userData.slideDirection = undefined;
        localTeleportReentryBlockTeleporterIndex = null;
        localTeleportReentryBlockDistance = 0;
        localTeleportReentryBlockUntil = 0;
        localTeleportCooldownUntil = 0;
        suppressLocalTeleportFxUntil = 0;
        clearJumpPredictionDebug(myTank);
        deathFollowTarget = null;
        renderManager.deathFollowTarget = null;
        renderManager.deathFollowAnchor = null;
        updateDeathCameraHudVisibility();
      }
      break;

    case 'shotBegin':
      createProjectile(message);
      break;

    case 'shotEnd':
      removeProjectile(message.id, message.reason, message.x, message.y, message.z);
      break;

    case 'playerHit':
      handlePlayerHit(message);
      break;

    case 'playerRespawned':
      handlePlayerRespawn(message);
      break;

    case 'pauseCountdown':
      if (message.playerId === myPlayerId) {
        pauseCountdownStart = Date.now();
        showMessage('Pausing in 2 seconds...');
      }
      break;

    case 'playerPaused':
      if (message.playerId === myPlayerId) {
        isPaused = true;
        pauseCountdownStart = 0;
        showMessage('PAUSED - Press P to unpause', 'death');
      }
      createShield(message.playerId, message.x, message.y, message.z);
      break;

    case 'playerUnpaused':
      if (message.playerId === myPlayerId) {
        isPaused = false;
        pauseCountdownStart = 0;
        showMessage('Unpaused');
      }
      removeShield(message.playerId);
      break;

    case 'message': {
      const srcId = normalizeMessageEndpoint(message.src ?? message.from, CHAT_TARGET_SERVER);
      const dstId = normalizeMessageEndpoint(message.dst ?? message.to, CHAT_TARGET_ALL);
      if (typeof srcId === 'string' && dstId === myPlayerId && srcId !== myPlayerId) {
        lastDirectSenderId = srcId;
      }
      const formatted = formatNetworkMessage(message);
      addChatEntry(formatted.tabs, formatted.text, formatted.kind);
      updateChatWindow();
      break;
    }

    case 'mapList':
      handleMapsList(message);
      break;

    case 'serverConfigUpdate':
      handleServerConfigUpdate(message);
      break;

    case 'reload':
      showMessage('Server updated - reloading...', 'death');
      setTimeout(() => {
        window.location.reload();
      }, 1000);
      break;

    default:
      console.warn('Unknown message type from server:', message);
      break;
  }
}

function addPlayer(player) {
  const playerTankModelId = getTankModelIdFromPlayer(player);
  const playerTankModelPath = getTankModelPathById(playerTankModelId);
  let tank = tanks.get(player.id);

  const tankColorChanged = tank?.userData?.playerState?.color !== player.color;
  if (tank && tank.userData && (tank.userData.tankModel !== playerTankModelId || tankColorChanged)) {
    if (tank.userData.ghostMesh) {
      renderManager.getWorldGroup().remove(tank.userData.ghostMesh);
      tank.userData.ghostMesh = null;
    }
    renderManager.getWorldGroup().remove(tank);
    tanks.delete(player.id);
    tank = null;
  }

  if (!tank) {
    tank = renderManager.createTank(player.color, player.name, playerTankModelPath);
    renderManager.getWorldGroup().add(tank);
    tanks.set(player.id, tank);

    // Create ghost mesh for this tank. Remote ghosts show last received server
    // state; the local ghost shows the last sent movement packet.
    const ghostTank = renderManager.createGhostMesh(tank);
    ghostTank.visible = false;
    renderManager.getWorldGroup().add(ghostTank);
    tank.userData.ghostMesh = ghostTank;
    ensurePacketMotionDebug(ghostTank, player.id === myPlayerId ? 'sent' : 'received');

    if (player.id !== myPlayerId) {
      tank.userData.serverPosition = { x: player.x, y: player.y, z: player.z, r: player.rotation };
      ghostTank.visible = showDebugGeometry;
      ghostTank.userData.hasPacketState = true;
    } else {
      ghostTank.userData.hasPacketState = false;
    }
  }
  // Always update tank state
  tank.position.set(player.x, player.y, player.z);
  tank.rotation.y = player.rotation;
  tank.userData.tankModel = playerTankModelId;
  tank.userData.playerState = player; // Store player state for scoreboard
  tank.userData.verticalVelocity = player.verticalVelocity;
  tank.userData.forwardSpeed = player.forwardSpeed || 0;
  tank.userData.rotationSpeed = player.rotationSpeed || 0;
  tank.userData.jumpDirection = player.jumpDirection ?? null;
  tank.userData.slideDirection = player.slideDirection;
  tank.userData.airVelocityX = player.airVelocityX || 0;
  tank.userData.airVelocityZ = player.airVelocityZ || 0;
  tank.visible = player.health > 0;

  // Update name label if it exists and has a material
  if (tank.userData.nameLabel && tank.userData.nameLabel.material && player.name) {
    renderManager.updateSpriteLabel(tank.userData.nameLabel, player.name, player.color);
  }

  // Update ghost mesh name label if it exists and has a material
  if (tank.userData.ghostMesh && tank.userData.ghostMesh.userData.nameLabel &&
      tank.userData.ghostMesh.userData.nameLabel.material && player.name) {
    renderManager.updateSpriteLabel(tank.userData.ghostMesh.userData.nameLabel, player.name, player.color);
  }

  if (player.id !== myPlayerId && tank.userData.ghostMesh) {
    updatePacketMotionDebug(tank.userData.ghostMesh, {
      fs: player.forwardSpeed || 0,
      rs: player.rotationSpeed || 0,
      vv: player.verticalVelocity || 0,
      vx: player.airVelocityX || 0,
      vz: player.airVelocityZ || 0,
      r: player.rotation,
      d: player.slideDirection,
      jumpDirection: player.jumpDirection ?? null
    }, 'received');
  }

  if (player.jumpDirection !== null && player.jumpDirection !== undefined) {
    updateJumpPredictionDebug(tank, {
      x: player.x,
      y: player.y,
      z: player.z,
      r: player.rotation,
      forwardSpeed: player.forwardSpeed || 0,
      rotationSpeed: player.rotationSpeed || 0,
      verticalVelocity: player.verticalVelocity || 0,
      jumpDirection: player.jumpDirection,
      slideDirection: player.slideDirection,
      airVelocityX: player.airVelocityX || 0,
      airVelocityZ: player.airVelocityZ || 0
    }, player.id === myPlayerId ? 'sent' : 'received');
  } else {
    clearJumpPredictionDebug(tank);
  }

  callUpdateScoreboard();
}

function removePlayer(playerId) {
  const tank = tanks.get(playerId);
  if (tank) {
    clearJumpPredictionDebug(tank);
    // Remove ghost mesh if it exists
    if (tank.userData.ghostMesh) {
      renderManager.getWorldGroup().remove(tank.userData.ghostMesh);
      tank.userData.ghostMesh = null;
    }
    renderManager.getWorldGroup().remove(tank);
    tanks.delete(playerId);
    callUpdateScoreboard();
  }
  removeShield(playerId);
}

function createShield(playerId, x, y, z) {
  // Remove existing shield if any
  removeShield(playerId);

  const shield = renderManager.createShield({ x, y, z });
  if (!shield) return;
  playerShields.set(playerId, shield);

  // Animate shield
  shield.userData.rotation = 0;
}

function removeShield(playerId) {
  const shield = playerShields.get(playerId);
  if (shield) {
    renderManager.removeShield(shield);
    playerShields.delete(playerId);
  }
}

function createProjectile(data) {
  if (data.playerId === myPlayerId) {
    while (pendingLocalProjectiles.length > 0) {
      const pending = pendingLocalProjectiles.shift();
      const localProjectile = projectiles.get(pending.id);
      if (!localProjectile) continue;

      projectiles.delete(pending.id);
      // Re-anchor to authoritative spawn so replayed local shots follow
      // exactly the same path regardless of transient local frame timing.
      localProjectile.position.set(data.x, data.y, data.z);
      localProjectile.userData.dirX = data.dirX;
      localProjectile.userData.dirY = Number.isFinite(data.dirY) ? data.dirY : 0;
      localProjectile.userData.dirZ = data.dirZ;
      localProjectile.userData.createdAt = data.createdAt;
      localProjectile.userData.shotSlot = Number.isInteger(data.shotSlot) ? data.shotSlot : 0;
      localProjectile.userData.pendingServerAck = false;
      localProjectile.userData.teleportReentryBlockTeleporterIndex = null;
      localProjectile.userData.teleportReentryBlockDistance = 0;
      projectiles.set(data.id, localProjectile);
      return;
    }
  }

  const shotColor = getPlayerShotColor(data.playerId);
  // Keep remote shot starts authoritative to avoid cross-machine clock skew.
  // BZFlag does not rely on sender wall-clock deltas to place remote shots.
  const projectile = renderManager.createProjectile({
    ...data,
    x: data.x,
    z: data.z,
    color: shotColor.getHex(),
  });
  if (!projectile) return;
  projectile.userData.playerId = data.playerId;
  projectile.userData.createdAt = data.createdAt;
  projectile.userData.dirY = Number.isFinite(data.dirY) ? data.dirY : 0;
  projectile.userData.shotSlot = Number.isInteger(data.shotSlot) ? data.shotSlot : 0;
  projectile.userData.radarColor = `#${shotColor.getHexString()}`;
  projectile.userData.teleportReentryBlockTeleporterIndex = null;
  projectile.userData.teleportReentryBlockDistance = 0;
  projectiles.set(data.id, projectile);
}

function createLocalProjectile({ x, y, z, dirX, dirZ, dirY = 0 }) {
  if (myPlayerId === null || myPlayerId === undefined) return;

  const shotColor = getPlayerShotColor(myPlayerId);
  const localId = `local-${myPlayerId}-${Date.now()}-${localProjectileCounter++}`;
  const projectile = renderManager.createProjectile({
    id: localId,
    playerId: myPlayerId,
    x,
    y,
    z,
    dirX,
    dirY,
    dirZ,
    color: shotColor.getHex(),
  });
  if (!projectile) return;

  projectile.userData.playerId = myPlayerId;
  projectile.userData.createdAt = Date.now();
  projectile.userData.dirY = Number.isFinite(dirY) ? dirY : 0;
  projectile.userData.shotSlot = null;
  projectile.userData.radarColor = `#${shotColor.getHexString()}`;
  projectile.userData.pendingServerAck = true;
  projectile.userData.teleportReentryBlockTeleporterIndex = null;
  projectile.userData.teleportReentryBlockDistance = 0;
  projectiles.set(localId, projectile);
  pendingLocalProjectiles.push({ id: localId, sentAt: Date.now() });
}

function removeProjectile(id, reason = 1, x = null, y = null, z = null) {
  const numericReason = Number(reason);
  const hasServerImpactPosition = Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
  const projectile = projectiles.get(id);
  if (projectile) {
    // Use authoritative server coordinates for end-of-shot effects.
    if (hasServerImpactPosition) {
      projectile.position.set(x, y, z);
    }
    renderManager.removeProjectile(projectile, numericReason);
    projectiles.delete(id);
    return;
  }

  // If we don't have the projectile object (rare race/id mismatch), still
  // render the authoritative impact effect so players always see shot ends.
  if (numericReason === 0 && hasServerImpactPosition) {
    renderManager.createShotImpact(new THREE.Vector3(x, y, z));
  }
}

function getActiveProjectileCountForPlayer(playerId) {
  let count = 0;
  projectiles.forEach((projectile) => {
    if (projectile?.userData?.playerId === playerId) count++;
  });
  return count;
}

function handlePlayerHit(message) {
  const shooterTank = tanks.get(message.shooterId);
  const victimTank = tanks.get(message.victimId);
  const shooterName = shooterTank && shooterTank.userData && shooterTank.userData.playerState && shooterTank.userData.playerState.name ? shooterTank.userData.playerState.name : 'Someone';
  const victimName = victimTank && victimTank.userData && victimTank.userData.playerState && victimTank.userData.playerState.name ? victimTank.userData.playerState.name : 'Someone';
  const isSelfDestruct = Boolean(message.suicide) || (message.victimId === message.shooterId);
  const shooterId = normalizeMessageEndpoint(message.shooterId, CHAT_TARGET_SERVER);
  const victimId = normalizeMessageEndpoint(message.victimId, CHAT_TARGET_SERVER);

  if (!isSelfDestruct) {
    if (victimId === myPlayerId && typeof shooterId === 'string' && shooterId !== myPlayerId) {
      nemesisPlayerId = shooterId;
    } else if (shooterId === myPlayerId && typeof victimId === 'string' && victimId !== myPlayerId) {
      nemesisPlayerId = victimId;
    }
  }

  if (message.victimId === myPlayerId) {
    // Local player was killed
    showMessage(isSelfDestruct ? 'You self-destructed!' : `${shooterName} killed you!`, 'death');
    // Switch to overview mode and hide crosshair
    lastCameraMode = cameraMode;
    cameraMode = 'overview';
    // Set camera to initial overview position above/behind victim tank
    if (victimTank) {
      const vp = victimTank.position;
      camera.position.set(vp.x, vp.y + 10, vp.z + 22);
      camera.up.set(0, 1, 0);
      camera.lookAt(vp.x, vp.y, vp.z);
    } else {
      camera.position.set(0, 15, 20);
      camera.up.set(0, 1, 0);
      camera.lookAt(0, 0, 0);
    }
    const crosshair = document.getElementById('crosshair');
    if (crosshair) crosshair.style.display = 'none';
  } else if (message.shooterId === myPlayerId) {
    // Local player got a kill
    if (!isSelfDestruct) {
      showMessage(`You killed ${victimName}!`, 'kill');
    }
  } else {
    // Show to all other players
    showMessage(isSelfDestruct ? `${victimName} self-destructed!` : `${shooterName} killed ${victimName}!`, 'info');
  }
  // Update other players' stats

  if (shooterTank && shooterTank.userData.playerState) {
    shooterTank.userData.playerState.kills = (shooterTank.userData.playerState.kills || 0) + 1;
  }
  if (victimTank && victimTank.userData.playerState) {
    victimTank.userData.playerState.deaths = (victimTank.userData.playerState.deaths || 0) + 1;
  }
  callUpdateScoreboard();

  // Remove the projectile
  removeProjectile(message.projectileId, 0);

  // Get victim tank and create explosion effect
  if (victimTank) {
    clearJumpPredictionDebug(victimTank);
    // Immediately hide the tank from the scene
    victimTank.visible = false;
    // Create explosion with tank parts
    const explosionResult = renderManager.createExplosion(victimTank.position, victimTank);
    if (message.victimId === myPlayerId) {
      deathFollowTarget = explosionResult?.followTarget || null;
      renderManager.deathFollowTarget = deathFollowTarget;
      renderManager.deathFollowAnchor = victimTank.position.clone();
      const vp = victimTank.position;
      debugLog(`deathCam playerPos=${vp.x.toFixed(1)},${vp.y.toFixed(1)},${vp.z.toFixed(1)} hasDebris=${!!deathFollowTarget}`, 'death');
      updateDeathCameraHudVisibility();
    }
  }
}

function handlePlayerRespawn(message) {
  const tank = tanks.get(message.player.id);
  if (tank) {
    clearJumpPredictionDebug(tank);
    if (message.player.id === myPlayerId) {
      deathFollowTarget = null;
      renderManager.deathFollowTarget = null;
      renderManager.deathFollowAnchor = null;
      updateDeathCameraHudVisibility();
    }
    tank.position.set(message.player.x, message.player.y, message.player.z);
    tank.rotation.y = message.player.rotation;
    tank.userData.verticalVelocity = message.player.verticalVelocity;
    tank.userData.forwardSpeed = message.player.forwardSpeed || 0;
    tank.userData.rotationSpeed = message.player.rotationSpeed || 0;
    tank.userData.jumpDirection = message.player.jumpDirection ?? null;
    tank.userData.slideDirection = message.player.slideDirection;
    tank.userData.airVelocityX = message.player.airVelocityX || 0;
    tank.userData.airVelocityZ = message.player.airVelocityZ || 0;

    // Update player state with full respawn data (including health = 100)
    tank.userData.playerState = message.player;

    // Update ghost mesh position BEFORE making it visible
    if (tank.userData.ghostMesh) {
      tank.userData.ghostMesh.position.set(message.player.x, message.player.y, message.player.z);
      tank.userData.ghostMesh.rotation.y = message.player.rotation;
      tank.userData.ghostMesh.visible = showDebugGeometry;
    }

    // Update server position for extrapolation
    tank.userData.serverPosition = {
      x: message.player.x,
      y: message.player.y,
      z: message.player.z,
      r: message.player.rotation
    };

    tank.visible = true;

    if (message.player.health > 0) {
      triggerSpawnEffectForTank(tank, message.player.color);
    }
  }

  callUpdateScoreboard();

  if (message.player.id === myPlayerId) {
    playerX = message.player.x;
    playerY = message.player.y;
    playerZ = message.player.z;
    playerRotation = message.player.rotation;
    showMessage('You respawned!');
    // Restore normal view and crosshair
    cameraMode = lastCameraMode === 'overview' ? 'first-person' : lastCameraMode;
    const crosshair = document.getElementById('crosshair');
    if (crosshair) crosshair.style.display = '';
  }
}
// Helper to call updateScoreboard with all required parameters
function callUpdateScoreboard() {
  updateScoreboard({ myPlayerId, myPlayerName, myTank, tanks, teamScores });
}

function handleMapsList(message) {
  const mapList = document.getElementById('mapList');
  if (!mapList) return;

  // Clear existing options
  mapList.innerHTML = '';

  message.maps.forEach((mapName) => {
    const option = document.createElement('option');
    option.value = mapName;
    option.textContent = mapName;
    mapList.appendChild(option);
  });

  if (message.currentMap) {
    mapList.value = message.currentMap;
  }

  const motdEl = document.getElementById('motd');
  const motdInput = document.getElementById('motdInput');
  if (motdEl) motdEl.textContent = `MOTD: ${serverMotdText}`;
  if (motdInput) motdInput.value = serverMotdText;

  if (Number.isFinite(message.shotMaxActive)) {
    const shotMaxActiveInput = document.getElementById('shotMaxActiveInput');
    if (shotMaxActiveInput) {
      shotMaxActiveInput.value = String(message.shotMaxActive);
    }
  }
}

function handleServerConfigUpdate(message) {
  if (typeof message.description === 'string') {
    serverDescriptionText = message.description;
    const serverDescriptionEl = document.getElementById('serverDescription');
    if (serverDescriptionEl) serverDescriptionEl.textContent = serverDescriptionText;
  }

  if (typeof message.motd === 'string') {
    serverMotdText = message.motd;
    const serverMotdEl = document.getElementById('serverMotd');
    const motdEl = document.getElementById('motd');
    const motdInput = document.getElementById('motdInput');
    if (serverMotdEl) serverMotdEl.textContent = serverMotdText;
    if (motdEl) motdEl.textContent = `MOTD: ${serverMotdText}`;
    if (motdInput) motdInput.value = serverMotdText;
  }

  announceServerTextIfChanged();

  if (Number.isFinite(message.shotMaxActive)) {
    if (gameConfig) {
      gameConfig.SHOT_MAX_ACTIVE = message.shotMaxActive;
    }
    const shotMaxActiveInput = document.getElementById('shotMaxActiveInput');
    if (shotMaxActiveInput) {
      shotMaxActiveInput.value = String(message.shotMaxActive);
    }
  }
}

function showMessage(text) {
  routeLocalHudMessage(text);
}

function getBoxCollisionDistanceSquared(localX, localZ, halfW, halfD) {
  const closestX = Math.max(-halfW, Math.min(localX, halfW));
  const closestZ = Math.max(-halfD, Math.min(localZ, halfD));
  const distX = localX - closestX;
  const distZ = localZ - closestZ;
  return {
    closestX,
    closestZ,
    distSquared: distX * distX + distZ * distZ
  };
}

function getWorldBorderColliders() {
  if (cachedWorldBorderColliders.length > 0) return cachedWorldBorderColliders;
  const mapSize = gameConfig?.MAP_SIZE || gameConfig?.mapSize || 100;
  const halfMap = mapSize / 2;
  const thickness = 4;
  const span = mapSize + thickness * 2;
  cachedWorldBorderColliders = [
    { type: 'box', name: 'boundary_north', collisionKind: 'boundary', x: 0, z: -halfMap - thickness / 2, w: span, d: thickness, h: 1000, baseY: 0, rotation: 0 },
    { type: 'box', name: 'boundary_south', collisionKind: 'boundary', x: 0, z: halfMap + thickness / 2, w: span, d: thickness, h: 1000, baseY: 0, rotation: 0 },
    { type: 'box', name: 'boundary_east', collisionKind: 'boundary', x: halfMap + thickness / 2, z: 0, w: thickness, d: span, h: 1000, baseY: 0, rotation: 0 },
    { type: 'box', name: 'boundary_west', collisionKind: 'boundary', x: -halfMap - thickness / 2, z: 0, w: thickness, d: span, h: 1000, baseY: 0, rotation: 0 }
  ];
  return cachedWorldBorderColliders;
}

function getCollisionColliders() {
  if (cachedCollisionColliders.length === 0) {
    cachedCollisionColliders = [...OBSTACLES, ...getWorldBorderColliders()];
  }
  return cachedCollisionColliders;
}

function refreshCollisionColliders() {
  cachedWorldBorderColliders = [];
  cachedCollisionColliders = [];
}

function rebuildTeleporterRuntimeState() {
  TELEPORTER_OBSTACLES_BY_INDEX = new Map();
  TELEPORTER_LINKS_BY_SOURCE_FACE = new Map();

  for (const obs of OBSTACLES) {
    if (obs?.kind !== 'teleporter') continue;
    if (!Number.isInteger(obs.teleporterIndex)) continue;
    TELEPORTER_OBSTACLES_BY_INDEX.set(obs.teleporterIndex, obs);
  }

  const links = Array.isArray(TELEPORTER_GRAPH?.links) ? TELEPORTER_GRAPH.links : [];
  for (const link of links) {
    if (!Number.isInteger(link?.sourceFaceId) || !Number.isInteger(link?.destFaceId)) continue;
    if (!TELEPORTER_LINKS_BY_SOURCE_FACE.has(link.sourceFaceId)) {
      TELEPORTER_LINKS_BY_SOURCE_FACE.set(link.sourceFaceId, []);
    }
    TELEPORTER_LINKS_BY_SOURCE_FACE.get(link.sourceFaceId).push(link.destFaceId);
  }

  for (const [sourceFaceId, destinations] of TELEPORTER_LINKS_BY_SOURCE_FACE.entries()) {
    const unique = Array.from(new Set(destinations));
    unique.sort((a, b) => a - b);
    TELEPORTER_LINKS_BY_SOURCE_FACE.set(sourceFaceId, unique);
  }
}

// Returns: null, { type: 'collision', obstacle }, or { type: 'ontop', obstacle }
// The occupant is BZFlag's oriented 2.8 x 6.0 tank box (Obstacle::inBox). Every
// call here is for the local player, so the heading defaults to theirs: a call
// site that silently fell back to a circle would disagree with the server.
function checkCollision(x, y, z, ignoredObstacles = null, rotation = playerRotation) {
  let ontopCollision = null;
  for (const obs of getCollisionColliders()) {
    if (ignoredObstacles && ignoredObstacles.has(obs)) continue;
    const obstacleHeight = obs.h || 4;
    const obstacleBase = obs.baseY || 0;
    const obstacleTop = obstacleBase + obstacleHeight;
    const epsilon = 0.15;
    const tankHeight = 2;
    const halfW = obs.w / 2;
    const halfD = obs.d / 2;
    const { x: localX, z: localZ } = getColliderLocalPoint(x, z, obs);
    const tankAngle = getTankLocalAngle(rotation, obs.rotation);
    const hitsRect = (rectHalfW, rectHalfD) =>
      testOrigRectTank(rectHalfW, rectHalfD, localX, localZ, tankAngle);
    const overlapsFootprint = hitsRect(halfW, halfD);

    const pyramidSurface = obs.type === 'pyramid' ? getPyramidSurfaceContact(obs, x, y, z) : null;

    // Check if we're "on top" of this obstacle (at its top height or a climbable slope)
    if (obs.type === 'pyramid') {
      if (pyramidSurface && pyramidSurface.supportable && Math.abs(y - pyramidSurface.supportSurfaceY) < ONTOP_TOLERANCE) {
        ontopCollision = { type: 'ontop', obstacle: obs, obstacleTop: pyramidSurface.supportSurfaceY, surfaceNormal: pyramidSurface.normal };
      }
    } else if (Math.abs(y - obstacleTop) < ONTOP_TOLERANCE && overlapsFootprint) {
      ontopCollision = { type: 'ontop', obstacle: obs, obstacleTop };
    }

    // Only check collision if tank top is below obstacle top and tank base is above obstacle base
    const tankTop = y + tankHeight;
    if (tankTop <= obstacleBase + epsilon) continue;
    if (y >= obstacleTop - epsilon) continue;

    if (obs.type === 'box' || !obs.type) {
      // Teleporters only collide on their frame; the active inner slab must
      // be pass-through so client movement does not slide before teleport.
      if (obs?.kind === 'teleporter') {
        const dims = getShotTeleporterDims(obs);
        if (hitsRect(dims.halfW, dims.halfD)) {
          const activeBaseY = obstacleBase;
          const activeTopY = obstacleBase + dims.activeH;
          const overlapsActiveVertical = tankTop > (activeBaseY + epsilon) && y < (activeTopY - epsilon);
          const inPortalInterior = overlapsActiveVertical
            && hitsRect(dims.halfW, dims.activeHalfD);
          if (!inPortalInterior) {
            return { type: 'collision', obstacle: obs };
          }
        }
      } else if (overlapsFootprint) {
        return { type: 'collision', obstacle: obs };
      }
    } else if (obs.type === 'pyramid') {
      // Mirrors BZFlag PyramidBuilding::inBox via the shared geometry module,
      // so the server evaluates the same solid volume the client moves through.
      if (pyramidIntersectsTank(obs, x, y, z, rotation, tankHeight)) {
        return { type: 'collision', obstacle: obs };
      }
    }
  }
  return ontopCollision || false;
}

function validateMove(x, y, z, intendedDeltaX, intendedDeltaY, intendedDeltaZ, tankRadius = 2) {

  // Pure function: no references to global state
  const newX = x + intendedDeltaX;
  const newY = y + intendedDeltaY;
  const newZ = z + intendedDeltaZ;
  const candidateY = Math.max(0, newY);
  let landedOn = null;
  let landedType = null; // 'ground' or 'obstacle'
  let startedFalling = false;
  let fallingFromObstacle = null; // Obstacle we're falling from (to skip collision)
  let altered = false;
  const resolveY = (collisionInfo, fallbackY) => {
    if (collisionInfo && collisionInfo.type === 'ontop' && typeof collisionInfo.obstacleTop === 'number') {
      return collisionInfo.obstacleTop;
    }
    return fallbackY;
  };
  const tryStepUp = (collisionInfo) => {
    if (!collisionInfo || collisionInfo.type !== 'collision' || !collisionInfo.obstacle) {
      return null;
    }
    const obs = collisionInfo.obstacle;
    let surfaceY = null;
    if (obs.type === 'pyramid') {
      const pyramidSurface = getPyramidSurfaceContact(obs, newX, y, newZ);
      if (!pyramidSurface || !pyramidSurface.climbable) return null;
      surfaceY = pyramidSurface.surfaceY;
    } else {
      surfaceY = (obs.baseY || 0) + (obs.h || 4);
    }
    const rise = surfaceY - y;
    if (rise <= 0 || rise > MAX_BUMP_HEIGHT) return null;
    const steppedCollision = checkCollision(newX, surfaceY, newZ);
    if (!steppedCollision) {
      return { x: newX, y: surfaceY, z: newZ, collision: null };
    }
    if (steppedCollision.type === 'ontop') {
      return { x: newX, y: steppedCollision.obstacleTop ?? surfaceY, z: newZ, collision: steppedCollision };
    }
    return null;
  };
  const tryTopSurfaceTransition = (collisionInfo) => {
    if (!collisionInfo || collisionInfo.type !== 'collision' || !collisionInfo.obstacle) {
      return null;
    }
    const obs = collisionInfo.obstacle;
    let topY = null;
    let canSupport = true;
    if (obs.type === 'pyramid') {
      const contact = getPyramidSurfaceContact(obs, newX, y, newZ);
      if (!contact || !contact.supportable) return null;
      topY = contact.supportSurfaceY;
      canSupport = contact.supportable;
    } else if (obs.type === 'box' || !obs.type) {
      topY = (obs.baseY || 0) + (obs.h || 4);
    } else {
      return null;
    }

    if (!canSupport || topY === null) return null;
    const nearTopBand = y >= topY - MAX_BUMP_HEIGHT && y <= topY + 1;
    if (!nearTopBand || intendedDeltaY > 0) return null;

    if (isWithinSupportFootprint(obs, newX, topY, newZ)) {
      return {
        x: newX,
        y: topY,
        z: newZ,
        landedOn: obs,
        landedType: 'obstacle',
        startedFalling: false,
        fallingFromObstacle: null
      };
    }

    const collisionWithoutBox = checkCollision(newX, candidateY, newZ, new Set([obs]));
    if (!collisionWithoutBox) {
      return {
        x: newX,
        y: candidateY,
        z: newZ,
        landedOn: null,
        landedType: null,
        startedFalling: true,
        fallingFromObstacle: obs
      };
    }
    return null;
  };
  const resetCornerStickState = () => {
    cornerStickState.obstacleName = null;
    cornerStickState.frames = 0;
  };
  const tryCornerEscape = (obs, resultX, resultZ) => {
    const halfW = obs.w / 2 + tankRadius;
    const halfD = obs.d / 2 + tankRadius;
    const localPoint = getColliderLocalPoint(resultX, resultZ, obs);
    const corners = [
      { x: -halfW, z: -halfD },
      { x: -halfW, z: halfD },
      { x: halfW, z: -halfD },
      { x: halfW, z: halfD }
    ];
    let nearestCorner = corners[0];
    let nearestDistSquared = Infinity;
    for (const corner of corners) {
      const dx = localPoint.x - corner.x;
      const dz = localPoint.z - corner.z;
      const distSquared = dx * dx + dz * dz;
      if (distSquared < nearestDistSquared) {
        nearestDistSquared = distSquared;
        nearestCorner = corner;
      }
    }
    let escapeLocalX = localPoint.x - nearestCorner.x;
    let escapeLocalZ = localPoint.z - nearestCorner.z;
    const escapeLength = Math.hypot(escapeLocalX, escapeLocalZ);
    if (escapeLength < 1e-5) return null;
    escapeLocalX = (escapeLocalX / escapeLength) * CORNER_ESCAPE_DISTANCE;
    escapeLocalZ = (escapeLocalZ / escapeLength) * CORNER_ESCAPE_DISTANCE;
    const rotation = obs.rotation || 0;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const escapeWorldX = escapeLocalX * cos + escapeLocalZ * sin;
    const escapeWorldZ = -escapeLocalX * sin + escapeLocalZ * cos;
    const escapeX = resultX + escapeWorldX;
    const escapeZ = resultZ + escapeWorldZ;
    const escapeCollision = checkCollision(escapeX, candidateY, escapeZ);
    if (escapeCollision && escapeCollision.type !== 'ontop') return null;
    return { x: escapeX, z: escapeZ };
  };
  const logSlideTrace = (stage, details = {}) => {
    const obstacleName = collisionObj && collisionObj.obstacle && collisionObj.obstacle.name;
    const parts = [
      `[SLIDE_TRACE] ${stage}`,
      `obs=${obstacleName || 'unknown'}`,
      `pos=(${formatDebugNumber(x)},${formatDebugNumber(y)},${formatDebugNumber(z)})`,
      `intent=(${formatDebugNumber(intendedDeltaX)},${formatDebugNumber(intendedDeltaY)},${formatDebugNumber(intendedDeltaZ)})`
    ];
    if (details.normal) {
      parts.push(`normal=(${formatDebugNumber(details.normal.x)},${formatDebugNumber(details.normal.z)})`);
    }
    if (details.slide) {
      parts.push(`slide=(${formatDebugNumber(details.slide.x)},${formatDebugNumber(details.slide.z)})`);
    }
    if (details.result) {
      parts.push(`result=(${formatDebugNumber(details.result.x)},${formatDebugNumber(details.result.y)},${formatDebugNumber(details.result.z)})`);
    }
    if (details.note) {
      parts.push(`note=${details.note}`);
    }
    sendMovementDebug(parts.join(' '));
  };

  // Try full movement first
  const currentSupport = y > 0 ? findSupportSurface(x, y, z) : null;
  let collisionObj = checkCollision(newX, candidateY, newZ);


  if (
    currentSupport &&
    collisionObj &&
    collisionObj.type === 'collision' &&
    collisionObj.obstacle === currentSupport.obstacle &&
    intendedDeltaY <= 0
  ) {
    const collisionWithoutSupport = checkCollision(
      newX,
      candidateY,
      newZ,
      new Set([currentSupport.obstacle])
    );

    if (!collisionWithoutSupport || collisionWithoutSupport.type === 'ontop') {
      if (!isWithinSupportFootprint(currentSupport.obstacle, newX, y, newZ)) {
        hideSelectedFaceDebug();
        resetCornerStickState();
        return {
          x: newX,
          y: y - 0.1,
          z: newZ,
          moved: true,
          altered: true,
          landedOn: null,
          landedType: null,
          startedFalling: true,
          fallingFromObstacle: currentSupport.obstacle
        };
      }

      collisionObj = collisionWithoutSupport;
    }
  }

  // When driving off the edge of a supported surface, don't reinterpret the
  // same obstacle as a side wall once the tank center leaves its top footprint.
  if (
    currentSupport &&
    collisionObj &&
    collisionObj.type === 'collision' &&
    collisionObj.obstacle === currentSupport.obstacle &&
    intendedDeltaY <= 0 &&
    !isWithinSupportFootprint(currentSupport.obstacle, newX, y, newZ)
  ) {
    hideSelectedFaceDebug();
    resetCornerStickState();
    return {
      x: newX,
      y: y - 0.1,
      z: newZ,
      moved: true,
      altered: true,
      landedOn: null,
      landedType: null,
      startedFalling: true,
      fallingFromObstacle: currentSupport.obstacle
    };
  }

  if (collisionObj && collisionObj.type === 'collision' && intendedDeltaY <= 0) {
    const topSurfaceResult = tryTopSurfaceTransition(collisionObj);
    if (topSurfaceResult) {
      hideSelectedFaceDebug();
      resetCornerStickState();
      if (topSurfaceResult.startedFalling) {
        return {
          x: topSurfaceResult.x,
          y: topSurfaceResult.y,
          z: topSurfaceResult.z,
          moved: true,
          altered: true,
          landedOn: null,
          landedType: null,
          startedFalling: true,
          fallingFromObstacle: topSurfaceResult.fallingFromObstacle
        };
      }
      return {
        x: topSurfaceResult.x,
        y: topSurfaceResult.y,
        z: topSurfaceResult.z,
        moved: true,
        altered: true,
        landedOn: topSurfaceResult.landedOn,
        landedType: topSurfaceResult.landedType,
        startedFalling: false,
        fallingFromObstacle: null
      };
    }

    const stepUpResult = tryStepUp(collisionObj);
    if (stepUpResult) {
      hideSelectedFaceDebug();
      resetCornerStickState();
      if (stepUpResult.collision && stepUpResult.collision.type === 'ontop') {
        landedOn = stepUpResult.collision.obstacle;
        landedType = 'obstacle';
      } else {
        landedOn = collisionObj.obstacle;
        landedType = 'obstacle';
      }
      logSlideTrace('step-up', {
        result: { x: stepUpResult.x, y: stepUpResult.y, z: stepUpResult.z },
        note: `obs=${collisionObj.obstacle?.name || 'unknown'}`
      });
      return {
        x: stepUpResult.x,
        y: stepUpResult.y,
        z: stepUpResult.z,
        moved: true,
        altered: true,
        landedOn,
        landedType,
        startedFalling: false,
        fallingFromObstacle: null
      };
    }
  }

  // If we hit a collision while moving upward (jumping into obstacle bottom), start falling
  if (collisionObj && collisionObj.type === 'collision' && intendedDeltaY > 0) {
    const horizontalOnlyCollision = checkCollision(newX, y, newZ);
    const verticalOnlyCollision = checkCollision(x, candidateY, z);

    if (verticalOnlyCollision && (!horizontalOnlyCollision || horizontalOnlyCollision.type === 'ontop')) {
      // Hit obstacle bottom while jumping - immediately start falling
      // Keep horizontal position at current location, start falling from current height
      return {
        x: x,
        y: y,
        z: z,
        moved: false,
        altered: false,
        landedOn: null,
        landedType: null,
        startedFalling: false,
        fallingFromObstacle: null,
        hitObstacleBottom: true  // Signal to reverse vertical velocity
      };
    }
  }

  if (!collisionObj || collisionObj.type === 'ontop') {
    hideSelectedFaceDebug();
    resetCornerStickState();
    // If we're on top of an obstacle, that's the landing
    if (collisionObj && collisionObj.type === 'ontop') {
      landedOn = collisionObj.obstacle;
      landedType = 'obstacle';
    } else if (newY < 0) {
      landedType = 'ground';
    }

    // Only detect fall start if not already in air (myJumpDirection === null)
    // This prevents re-triggering fall detection every frame after falling starts
    if (!collisionObj && intendedDeltaY == 0 && y > 0 && myJumpDirection === null) {
      // Find which obstacle we're falling from (if any) at our current height
      for (const obs of OBSTACLES) {
        const obstacleBase = obs.baseY || 0;
        const obstacleHeight = obs.h || 4;
        const obstacleTop = obstacleBase + obstacleHeight;

        // Check if this obstacle is at our height level (we might be leaving it)
        if (Math.abs(y - obstacleTop) < 1.0) {
          fallingFromObstacle = obs;
          break;
        }
      }

      // Start falling - we'll skip collision with fallingFromObstacle
      startedFalling = true;
      return { x: newX, y: newY - 0.1, z: newZ, moved: true, altered, landedOn, landedType, startedFalling, fallingFromObstacle };
    }
    const actualDX = newX - x;
    const actualDZ = newZ - z;
    altered = Math.abs(actualDX - intendedDeltaX) > 1e-6 || Math.abs(actualDZ - intendedDeltaZ) > 1e-6;
    return { x: newX, y: resolveY(collisionObj, candidateY), z: newZ, moved: true, altered, landedOn, landedType, startedFalling, fallingFromObstacle };
  }

  const surfaceContact = getSurfaceContact(collisionObj.obstacle, newX, newY, newZ, tankRadius);
  const surfaceSlideResult = resolveMotionSlide(
    collisionObj.obstacle, x, y, z, intendedDeltaX, intendedDeltaZ, candidateY
  );
  if (surfaceSlideResult) {
    if (surfaceSlideResult.faceCenter) {
      const debugMode = surfaceSlideResult.traceStage === 'box-vertical-only' ? 'blocked' : 'slide';
      showSelectedFaceDebug(
        surfaceSlideResult.faceCenter,
        collisionObj.obstacle?.name || surfaceSlideResult.faceCenter?.name || null,
        debugMode
      );
    } else {
      hideSelectedFaceDebug();
    }
    const actualMoveDistance = Math.hypot(surfaceSlideResult.x - x, surfaceSlideResult.z - z);
    const intendedMoveDistance = Math.hypot(intendedDeltaX, intendedDeltaZ);
    const obstacleName = collisionObj.obstacle?.name || null;
    if (
      collisionObj.obstacle &&
      collisionObj.obstacle.type === 'box' &&
      obstacleName &&
      intendedMoveDistance > CORNER_STICK_MIN_INTENT &&
      actualMoveDistance < CORNER_STICK_MAX_PROGRESS
    ) {
      if (cornerStickState.obstacleName === obstacleName) {
        cornerStickState.frames += 1;
      } else {
        cornerStickState.obstacleName = obstacleName;
        cornerStickState.frames = 1;
      }
      if (cornerStickState.frames >= CORNER_STICK_FRAMES) {
        const escapeResult = tryCornerEscape(collisionObj.obstacle, surfaceSlideResult.x, surfaceSlideResult.z);
        if (escapeResult) {
          surfaceSlideResult.x = escapeResult.x;
          surfaceSlideResult.z = escapeResult.z;
          cornerStickState.frames = 0;
          logSlideTrace('box-corner-escape', {
            result: { x: surfaceSlideResult.x, y: surfaceSlideResult.y, z: surfaceSlideResult.z },
            note: `obs=${obstacleName || 'unknown'}`
          });
        }
      }
    } else {
      resetCornerStickState();
    }
    if (surfaceSlideResult.collisionOnTop) {
      landedOn = collisionObj.obstacle;
      landedType = 'obstacle';
    } else if (newY < 0) {
      landedType = 'ground';
    }
    logSlideTrace(surfaceSlideResult.traceStage || 'surface-slide', {
      normal: surfaceSlideResult.normal,
      slide: { x: surfaceSlideResult.slideX, z: surfaceSlideResult.slideZ },
      result: { x: surfaceSlideResult.x, y: surfaceSlideResult.y, z: surfaceSlideResult.z }
    });
    return {
      x: surfaceSlideResult.x,
      y: surfaceSlideResult.y,
      z: surfaceSlideResult.z,
      trajectoryDeltaX: surfaceSlideResult.slideX,
      trajectoryDeltaZ: surfaceSlideResult.slideZ,
      moved: true,
      altered: true,
      landedOn,
      landedType,
      startedFalling: false,
      fallingFromObstacle: null
    };
  }

  logSlideTrace('surface-blocked', {
    normal: surfaceContact ? { x: surfaceContact.normal.x, z: surfaceContact.normal.z } : null,
    note: 'no surface resolution path'
  });
  if (surfaceContact && surfaceContact.faceCenter) {
    showSelectedFaceDebug(surfaceContact.faceCenter, collisionObj.obstacle?.name || surfaceContact.faceCenter?.name || null, 'blocked');
  } else {
    hideSelectedFaceDebug();
  }
  if (Math.hypot(intendedDeltaX, intendedDeltaY, intendedDeltaZ) > 1e-4) {
    sendMovementDebug(
      `[MOVE_STUCK] pos=(${formatDebugNumber(x)},${formatDebugNumber(y)},${formatDebugNumber(z)}) ` +
      `intent=(${formatDebugNumber(intendedDeltaX)},${formatDebugNumber(intendedDeltaY)},${formatDebugNumber(intendedDeltaZ)}) ` +
      `obs=${collisionObj?.obstacle?.name || 'unknown'}`
    );
  }
  resetCornerStickState();
  return { x, y, z, moved: false, altered: false, landedOn: null, landedType: null };
}


// Box sliding, using BZFlag's motion resolution: advance, binary-search the
// timestep for the last clear moment, cancel the velocity component along the
// hit normal, slide with what is left. This asks only "is the tank clear here",
// so it works with the oriented tank box, which no obstacle expansion can.
function resolveMotionSlide(obs, x, y, z, deltaX, deltaZ, candidateY) {
  // BZFlag does not branch on obstacle type when resolving motion; it asks the
  // obstacle for its normal. PyramidBuilding::getNormal is the same rect normal
  // as a box, taken against the cross-section at the tank's height, so a pyramid
  // slides by the same code -- the sloped face just contributes a Y component,
  // which resolveTankMotion already handles.
  const worldNormal = (obstacle, px, py, pz) => {
    const c = Math.cos(obstacle.rotation || 0);
    const sn = Math.sin(obstacle.rotation || 0);
    const toWorld = (nx, nz) => ({ x: nx * c + nz * sn, z: -nx * sn + nz * c });

    if (obstacle.type === 'pyramid') {
      const n = getPyramidFaceLocalNormal(obstacle, px, py, pz, 2);
      if (n) {
        const w = toWorld(n.x, n.z);
        return { x: w.x, y: n.y || 0, z: w.z };
      }
    }
    const local = getColliderLocalPoint(px, pz, obstacle);
    const shrink = obstacle.type === 'pyramid' ? pyramidShrinkFactor(obstacle, py, 2) : 1;
    const n = getOrigRectNormal(
      (obstacle.w / 2) * shrink, (obstacle.d / 2) * shrink, local.x, local.z
    );
    const w = toWorld(n.x, n.z);
    return { x: w.x, y: 0, z: w.z };
  };

  const result = resolveTankMotion({
    x, y: candidateY, z, azimuth: playerRotation,
    velocityX: deltaX, velocityY: 0, velocityZ: deltaZ,
    angularVelocity: 0,
    timeStep: 1,
    groundLimit: 0,
    onGround: y <= 0,
    hitTest: (fx, fy, fz, fa, tx, ty, tz) => {
      const hit = checkCollision(tx, ty, tz);
      return hit && hit.type === 'collision' ? hit.obstacle : null;
    },
    getNormal: (obstacle, px, py, pz) => worldNormal(obstacle, px, py, pz),
  });

  const finalCollision = checkCollision(result.x, candidateY, result.z);
  const normal = worldNormal(result.obstacle || obs, result.x, candidateY, result.z);
  return {
    x: result.x,
    y: candidateY,
    z: result.z,
    normal,
    slideX: result.x - x,
    slideZ: result.z - z,
    collisionOnTop: !!(finalCollision && finalCollision.type === 'ontop'),
    traceStage: 'motion-slide',
    faceCenter: null,
  };
}


function toWorldNormal(obs, localNormal) {
  const cosRot = Math.cos(obs.rotation || 0);
  const sinRot = Math.sin(obs.rotation || 0);
  const worldX = localNormal.x * cosRot + localNormal.z * sinRot;
  const worldY = localNormal.y;
  const worldZ = -localNormal.x * sinRot + localNormal.z * cosRot;
  const length = Math.hypot(worldX, worldY, worldZ) || 1;
  return {
    x: worldX / length,
    y: worldY / length,
    z: worldZ / length
  };
}

function getBoxSurfaceContact(obs, worldX, worldZ, tankRadius = 2) {
  const halfW = obs.w / 2;
  const halfD = obs.d / 2;
  const visualHalfW = obs.w / 2;
  const visualHalfD = obs.d / 2;
  const { x: localX, z: localZ } = getColliderLocalPoint(worldX, worldZ, obs);
  const { closestX, closestZ, distSquared } = getBoxCollisionDistanceSquared(localX, localZ, halfW, halfD);
  if (distSquared >= tankRadius * tankRadius) return null;

  let normalLocalX = 0;
  let normalLocalZ = 0;
  if (distSquared > 0.0001) {
    const dist = Math.sqrt(distSquared);
    normalLocalX = (localX - closestX) / dist;
    normalLocalZ = (localZ - closestZ) / dist;
  } else {
    const distToLeft = localX + halfW;
    const distToRight = halfW - localX;
    const distToFront = localZ + halfD;
    const distToBack = halfD - localZ;
    const minDist = Math.min(distToLeft, distToRight, distToFront, distToBack);
    if (minDist === distToLeft) normalLocalX = -1;
    else if (minDist === distToRight) normalLocalX = 1;
    else if (minDist === distToFront) normalLocalZ = -1;
    else normalLocalZ = 1;
  }

  const cosRot = Math.cos(obs.rotation || 0);
  const sinRot = Math.sin(obs.rotation || 0);
  const faceCenterLocal = Math.abs(normalLocalX) > Math.abs(normalLocalZ)
    ? { x: normalLocalX > 0 ? visualHalfW : -visualHalfW, z: 0 }
    : { x: 0, z: normalLocalZ > 0 ? visualHalfD : -visualHalfD };
  const worldNormal = toWorldNormal(obs, { x: normalLocalX, y: 0, z: normalLocalZ });
  const faceCenterWorld = {
    x: obs.x + faceCenterLocal.x * cosRot + faceCenterLocal.z * sinRot,
    y: (obs.baseY || 0) + ((obs.h || 4) * 0.5),
    z: obs.z - faceCenterLocal.x * sinRot + faceCenterLocal.z * cosRot
  };

  return {
    obstacle: obs,
    normal: worldNormal,
    climbable: false,
    faceCenter: {
      x: faceCenterWorld.x,
      y: faceCenterWorld.y,
      z: faceCenterWorld.z,
      normal: { x: worldNormal.x, z: worldNormal.z },
      name: obs.name
    }
  };
}

function getPyramidSurfaceContact(obs, worldX, worldY, worldZ) {
  const halfW = obs.w / 2;
  const halfD = obs.d / 2;
  const obstacleBase = obs.baseY || 0;
  const height = getPyramidHeight(obs);
  const tankHeight = 2;
  const { x: localX, z: localZ } = getColliderLocalPoint(worldX, worldZ, obs);

  // Take the normal from the cross-section at the tank's height, the way
  // BZFlag's PyramidBuilding::getNormal does. There is deliberately no
  // "outside the base footprint" gate: a tank whose centre sits beyond the
  // footprint can still have its radius inside the slope, and refusing to
  // describe a surface there leaves the slide resolver with nothing to work
  // with and freezes the tank -- in mid-air, if it was falling.
  const localNormal = getPyramidFaceLocalNormal(obs, worldX, worldY, worldZ, tankHeight);
  const dominantAxis = Math.abs(localNormal.x) >= Math.abs(localNormal.z) ? 'x' : 'z';

  // Outside the footprint there is no sloped surface overhead, so the contact
  // sits at the base (upright) or the flat top (inverted). Colliding and
  // standing are different questions: a normal exists everywhere, so the slide
  // resolver always has something to work with, but only a tank actually over
  // the pyramid can be held up by it.
  const withinFootprint = isWithinPyramidFootprint(obs, worldX, worldZ);
  const surfaceLocalHeight = getPyramidSurfaceLocalHeight(obs, localX, localZ)
    ?? (obs.inverted ? height : 0);
  const collisionSurfaceY = obstacleBase + surfaceLocalHeight;
  const supportSurfaceY = obs.inverted ? obstacleBase + height : collisionSurfaceY;

  const faceCenterLocal = dominantAxis === 'x'
    ? { x: (localNormal.x >= 0 ? 1 : -1) * halfW * 0.5, z: 0 }
    : { x: 0, z: (localNormal.z >= 0 ? 1 : -1) * halfD * 0.5 };

  const worldNormal = toWorldNormal(obs, localNormal);
  const cosRot = Math.cos(obs.rotation || 0);
  const sinRot = Math.sin(obs.rotation || 0);
  const faceCenterWorld = {
    x: obs.x + faceCenterLocal.x * cosRot + faceCenterLocal.z * sinRot,
    y: obstacleBase + height * 0.5,
    z: obs.z - faceCenterLocal.x * sinRot + faceCenterLocal.z * cosRot
  };
  const climbable = !obs.inverted && worldNormal.y >= CLIMBABLE_SURFACE_NORMAL_Y;
  const supportable = withinFootprint && (climbable || obs.inverted);
  const penetrationDepth = obs.inverted
    ? Math.max(0, worldY + tankHeight - collisionSurfaceY)
    : Math.max(0, collisionSurfaceY - worldY);
  return {
    obstacle: obs,
    normal: worldNormal,
    climbable,
    supportable,
    withinFootprint,
    faceAxis: dominantAxis,
    faceSign: dominantAxis === 'x' ? (localNormal.x >= 0 ? 1 : -1) : (localNormal.z >= 0 ? 1 : -1),
    surfaceY: collisionSurfaceY,
    supportSurfaceY,
    penetrationDepth,
    faceCenter: {
      x: faceCenterWorld.x,
      y: faceCenterWorld.y,
      z: faceCenterWorld.z,
      normal: { x: worldNormal.x, z: worldNormal.z },
      name: obs.name
    }
  };
}

function getSurfaceContact(obs, worldX, worldY, worldZ, tankRadius = 2) {
  if (!obs) return null;
  if (obs.type === 'pyramid') {
    return getPyramidSurfaceContact(obs, worldX, worldY, worldZ);
  }
  return getBoxSurfaceContact(obs, worldX, worldZ, tankRadius);
}

function findSupportSurface(worldX, worldY, worldZ) {
  let bestSupport = null;
  for (const obs of getCollisionColliders()) {
    if (obs.type === 'pyramid') {
      const contact = getPyramidSurfaceContact(obs, worldX, worldY, worldZ);
      if (!contact || !contact.supportable) continue;
      const deltaY = contact.supportSurfaceY - worldY;
      if (deltaY > MAX_BUMP_HEIGHT || deltaY < -SUPPORT_SNAP_DOWN) continue;
      if (!bestSupport || contact.supportSurfaceY > bestSupport.surfaceY) {
        bestSupport = { obstacle: obs, surfaceY: contact.supportSurfaceY, normal: contact.normal, contact };
      }
      continue;
    }

    // Supported for exactly as long as the tank box still rests on the top, the
    // same test that reports being on top. A centre-plus-margin test was tuned
    // for the old radius-2 circle; with a 6-unit-long box it ends a unit before
    // the tank actually leaves the edge, and the tank hangs in that gap.
    const { x: localX, z: localZ } = getColliderLocalPoint(worldX, worldZ, obs);
    if (!testOrigRectTank(
      obs.w / 2, obs.d / 2, localX, localZ,
      getTankLocalAngle(playerRotation, obs.rotation)
    )) continue;
    const surfaceY = (obs.baseY || 0) + (obs.h || 4);
    const deltaY = surfaceY - worldY;
    if (deltaY > MAX_BUMP_HEIGHT || deltaY < -SUPPORT_SNAP_DOWN) continue;
    if (!bestSupport || surfaceY > bestSupport.surfaceY) {
      bestSupport = { obstacle: obs, surfaceY, contact: null };
    }
  }
  return bestSupport;
}

function isWithinSupportFootprint(obs, worldX, worldY, worldZ) {
  if (!obs) return false;

  if (obs.type === 'pyramid') {
    const contact = getPyramidSurfaceContact(obs, worldX, worldY, worldZ);
    return Boolean(contact && contact.supportable);
  }

  const { x: localX, z: localZ } = getColliderLocalPoint(worldX, worldZ, obs);
  return testOrigRectTank(
    obs.w / 2, obs.d / 2, localX, localZ,
    getTankLocalAngle(playerRotation, obs.rotation)
  );
}

// Intended input state
let intendedForward = 0; // -1..1
let intendedRotation = 0; // -1..1
let intendedY = 0; // -1..1 (for jump/momentum)
let jumpTriggered = false;
let isInAir = false;
let onGround = false;
let onObstacle = false;
let jumpDirection = null; // Stores the direction at jump start
let currentSupportObstacle = null;
let smoothedForwardInput = 0;
let smoothedRotationInput = 0;
let localTeleportReentryBlockTeleporterIndex = null;
let localTeleportReentryBlockDistance = 0;
let localTeleportReentryBlockUntil = 0;
let localTeleportCooldownUntil = 0;
let suppressLocalTeleportFxUntil = 0;
const LANDING_SQUISH_FACTOR = 1.0;
const LANDING_SQUISH_TIME = 1.0;
// BZFlag Player::spawnEffect(): a spawning tank starts at 1% on every axis and
// grows to full size over _flagEffectTime. It shares dimensionsScale with the
// landing squish, so both converge through the same loop (Player.cxx:520).
const SPAWN_GROW_TIME = 0.64;
const SPAWN_START_SCALE = 0.01;
const PLAYER_TELEPORT_REENTRY_BLOCK_DISTANCE = 5.0;
const PLAYER_TELEPORT_REENTRY_BLOCK_MIN_MS = 250;
const PLAYER_TELEPORT_EXIT_EPSILON = 0.08;
const PLAYER_TELEPORT_COOLDOWN_MS = 1000;

function ensureTankDimensionState(tank) {
  if (!tank?.userData) return;
  if (!Number.isFinite(tank.userData.baseScaleX)) tank.userData.baseScaleX = tank.scale.x;
  if (!Number.isFinite(tank.userData.baseScaleY)) tank.userData.baseScaleY = tank.scale.y;
  if (!Number.isFinite(tank.userData.baseScaleZ)) tank.userData.baseScaleZ = tank.scale.z;
  if (!Number.isFinite(tank.userData.landingSquishScaleY)) tank.userData.landingSquishScaleY = 1;
  if (!Number.isFinite(tank.userData.landingSquishRecoverRate)) tank.userData.landingSquishRecoverRate = 1 / LANDING_SQUISH_TIME;
  if (!Number.isFinite(tank.userData.spawnScale)) tank.userData.spawnScale = 1;
}

function applySpawnGrow(tank) {
  if (!tank?.userData) return;
  ensureTankDimensionState(tank);
  tank.userData.spawnScale = SPAWN_START_SCALE;
}

function applyLandingSquish(tank, impactSpeed = 0) {
  if (!tank?.userData || !gameConfig) return;

  ensureTankDimensionState(tank);

  const gravity = Number.isFinite(gameConfig.GRAVITY) && gameConfig.GRAVITY > 0
    ? gameConfig.GRAVITY
    : 9.8;
  const velocity = Math.max(0, impactSpeed || 0);
  let k = 0.1 / (2 * gravity * gravity);
  k *= LANDING_SQUISH_FACTOR;

  const targetScaleY = 1 / (1 + (k * velocity * velocity));
  if (targetScaleY < tank.userData.landingSquishScaleY) {
    tank.userData.landingSquishScaleY = targetScaleY;
  }
  tank.userData.landingSquishRecoverRate = 1 / LANDING_SQUISH_TIME;
}

function updateTankDimensions(deltaTime) {
  tanks.forEach((tank) => {
    if (!tank?.userData) return;
    ensureTankDimensionState(tank);

    const baseScaleX = tank.userData.baseScaleX;
    const baseScaleY = tank.userData.baseScaleY;
    const baseScaleZ = tank.userData.baseScaleZ;

    let squishScaleY = tank.userData.landingSquishScaleY;
    if (!Number.isFinite(squishScaleY)) squishScaleY = 1;

    if (squishScaleY < 1) {
      const recoverRate = Number.isFinite(tank.userData.landingSquishRecoverRate)
        ? tank.userData.landingSquishRecoverRate
        : (1 / LANDING_SQUISH_TIME);
      squishScaleY = Math.min(1, squishScaleY + recoverRate * deltaTime);
      tank.userData.landingSquishScaleY = squishScaleY;
    }

    let spawnScale = tank.userData.spawnScale;
    if (!Number.isFinite(spawnScale)) spawnScale = 1;
    if (spawnScale < 1) {
      spawnScale = Math.min(1, spawnScale + (deltaTime / SPAWN_GROW_TIME));
      tank.userData.spawnScale = spawnScale;
    }

    tank.scale.set(
      baseScaleX * spawnScale,
      baseScaleY * squishScaleY * spawnScale,
      baseScaleZ * spawnScale
    );
  });
}

function triggerSpawnEffectForTank(tank, colorOverride = null) {
  if (!tank || !renderManager || !tank.position) return;

  const defaultColor = 0x4caf50;
  const tankColor = tank.userData?.playerState?.color;
  const effectColor = colorOverride ?? tankColor ?? defaultColor;
  renderManager.createSpawnEffect(tank.position, effectColor);
  applySpawnGrow(tank);
}

function approachValue(currentValue, targetValue, maxStep) {
  if (!Number.isFinite(currentValue)) return targetValue;
  if (!Number.isFinite(targetValue)) return currentValue;
  if (!Number.isFinite(maxStep) || maxStep <= 0) return currentValue;
  const delta = targetValue - currentValue;
  if (Math.abs(delta) <= maxStep) return targetValue;
  return currentValue + Math.sign(delta) * maxStep;
}

function setAirVelocity(tank, vx, vz) {
  if (!tank || !tank.userData) return;
  tank.userData.airVelocityX = vx;
  tank.userData.airVelocityZ = vz;

  const horizontalSpeed = Math.hypot(vx, vz);
  if (horizontalSpeed > 0.001 && gameConfig && gameConfig.TANK_SPEED) {
    tank.userData.jumpForwardSpeed = horizontalSpeed / gameConfig.TANK_SPEED;
    tank.userData.fallForwardSpeed = tank.userData.jumpForwardSpeed;
    tank.userData.slideDirection = Math.atan2(-vx, -vz);
  } else {
    tank.userData.jumpForwardSpeed = 0;
    tank.userData.fallForwardSpeed = 0;
    tank.userData.slideDirection = undefined;
  }
}

function deriveAirVelocityFromState(rotation, normalizedSpeed) {
  const speed = gameConfig?.TANK_SPEED || 15;
  return {
    x: -Math.sin(rotation) * normalizedSpeed * speed,
    z: -Math.cos(rotation) * normalizedSpeed * speed
  };
}

function sendMovementDebug(message) {
  debugLog(message);
}

function formatDebugNumber(value) {
  return Number.isFinite(value) ? value.toFixed(2) : 'NaN';
}

function normalizeAngle(angle) {
  let normalized = Number(angle) || 0;
  while (normalized > Math.PI) normalized -= Math.PI * 2;
  while (normalized < -Math.PI) normalized += Math.PI * 2;
  return normalized;
}

function triggerLandingFeedback(tank, impactSpeed = 0, { local = false } = {}) {
  if (!tank?.position) return;
  const clampedImpact = Math.max(0, impactSpeed || 0);
  const intensity = 1.0;
  applyLandingSquish(tank, clampedImpact);
  renderManager.createLandingEffect(tank.position, intensity, { local });
}

function decayLocalTeleportReentryBlock(distanceMoved, nowMs) {
  const moved = Math.max(0, Number(distanceMoved) || 0);
  localTeleportReentryBlockDistance = Math.max(0, localTeleportReentryBlockDistance - moved);
  if (localTeleportReentryBlockDistance <= 1e-6 && nowMs >= localTeleportReentryBlockUntil) {
    localTeleportReentryBlockTeleporterIndex = null;
    localTeleportReentryBlockDistance = 0;
    localTeleportReentryBlockUntil = 0;
  }
}

function isLocalTeleportReentryBlocked(teleporterIndex, nowMs) {
  if (!Number.isInteger(teleporterIndex)) return false;
  if (localTeleportReentryBlockTeleporterIndex !== teleporterIndex) return false;
  return localTeleportReentryBlockDistance > 1e-6 || nowMs < localTeleportReentryBlockUntil;
}

function predictLocalPlayerTeleport(startState, endState, nowMs) {
  if (nowMs < localTeleportCooldownUntil) {
    return {
      applied: false,
      state: endState,
      rotateDelta: 0,
      destinationObstacle: null,
      destinationTeleporterIndex: null,
      fromFaceId: null,
      toFaceId: null,
    };
  }

  const deltaX = endState.x - startState.x;
  const deltaY = endState.y - startState.y;
  const deltaZ = endState.z - startState.z;
  const segmentLength = Math.hypot(deltaX, deltaY, deltaZ);
  const planarDistance = Math.hypot(deltaX, deltaZ);
  if (segmentLength <= 1e-6) {
    return {
      applied: false,
      state: endState,
      rotateDelta: 0,
      destinationObstacle: null,
      destinationTeleporterIndex: null,
      fromFaceId: null,
      toFaceId: null,
    };
  }

  const start = { x: startState.x, y: startState.y, z: startState.z };
  const end = { x: endState.x, y: endState.y, z: endState.z };

  let earliest = null;
  for (const obs of TELEPORTER_OBSTACLES_BY_INDEX.values()) {
    if (isLocalTeleportReentryBlocked(obs.teleporterIndex, nowMs)) continue;
    const crossing = getShotTeleporterCrossing(start, end, obs);
    if (!crossing) continue;
    if (!earliest || crossing.t < earliest.crossing.t) {
      earliest = { obs, crossing };
    }
  }

  if (!earliest) {
    decayLocalTeleportReentryBlock(planarDistance, nowMs);
    return {
      applied: false,
      state: endState,
      rotateDelta: 0,
      destinationObstacle: null,
      destinationTeleporterIndex: null,
      fromFaceId: null,
      toFaceId: null,
    };
  }

  const sourceFaceId = earliest.crossing.sourceFaceId;
  const sourceFace = sourceFaceId % 2;
  const destinations = TELEPORTER_LINKS_BY_SOURCE_FACE.get(sourceFaceId) || [];
  const destFaceId = destinations.length > 0
    ? destinations[0]
    : ((Math.floor(sourceFaceId / 2) * 2) + (1 - (sourceFaceId % 2)));
  const destTeleporterIndex = Math.floor(destFaceId / 2);
  const destFace = destFaceId % 2;
  const destObs = TELEPORTER_OBSTACLES_BY_INDEX.get(destTeleporterIndex);
  if (!destObs) {
    decayLocalTeleportReentryBlock(planarDistance, nowMs);
    return {
      applied: false,
      state: endState,
      rotateDelta: 0,
      destinationObstacle: null,
      destinationTeleporterIndex: null,
      fromFaceId: null,
      toFaceId: null,
    };
  }

  const dirIn = {
    x: deltaX / segmentLength,
    y: deltaY / segmentLength,
    z: deltaZ / segmentLength,
  };
  const transformed = transformShotThroughTeleporter(
    earliest.crossing.point,
    dirIn,
    earliest.obs,
    sourceFace,
    destObs,
    destFace,
  );

  const exitAdvance = PLAYER_TELEPORT_EXIT_EPSILON;
  const outState = {
    ...endState,
    x: transformed.pointOut.x + transformed.dirOut.x * exitAdvance,
    y: Math.max(0, transformed.pointOut.y + transformed.dirOut.y * exitAdvance),
    z: transformed.pointOut.z + transformed.dirOut.z * exitAdvance,
  };

  const radians1 = (earliest.obs.rotation || 0) + (sourceFace === 0 ? 0 : Math.PI);
  const radians2 = (destObs.rotation || 0) + (destFace === 1 ? 0 : Math.PI);
  const rotateDelta = radians2 - radians1;

  localTeleportReentryBlockTeleporterIndex = destTeleporterIndex;
  localTeleportReentryBlockDistance = Math.max(
    PLAYER_TELEPORT_REENTRY_BLOCK_DISTANCE,
    (getShotTeleporterDims(destObs).halfW * 2) + 0.25,
  );
  localTeleportReentryBlockUntil = nowMs + PLAYER_TELEPORT_REENTRY_BLOCK_MIN_MS;
  localTeleportCooldownUntil = nowMs + PLAYER_TELEPORT_COOLDOWN_MS;

  return {
    applied: true,
    state: outState,
    rotateDelta,
    destinationObstacle: destObs,
    destinationTeleporterIndex: destTeleporterIndex,
    fromFaceId: sourceFaceId,
    toFaceId: destFaceId,
  };
}

function handleInputEvents() {
  // Reset intended input each frame
  intendedForward = 0;
  intendedRotation = 0;
  intendedY = 0;
  jumpTriggered = false;

  updateVirtualInputFromXR();
  updateVirtualInputFromGamepad();

  if (!myTank || !gameConfig) return;
  if (isObserver()) return;
  if (!isGameplayInputActive()) return;

  // Keep the tank snapped to a valid support surface under its center. This
  // stabilizes step/pyramid support without loosening side-contact ontop tests.
  const supportSurface = findSupportSurface(
    myTank.position.x,
    myTank.position.y,
    myTank.position.z,
    currentSupportObstacle
  );
  onGround = false;
  onObstacle = false;
  if (supportSurface) {
    onObstacle = true;
    currentSupportObstacle = supportSurface.obstacle;
    playerY = supportSurface.surfaceY;
    myTank.position.y = supportSurface.surfaceY;
    showSupportSurfaceDebug(supportSurface.obstacle, supportSurface.surfaceY);
    showSupportFootprintDebug(supportSurface.obstacle, supportSurface);
  } else if (myTank.position.y < 0.1) {
    onGround = true;
    currentSupportObstacle = null;
    playerY = 0;
    myTank.position.y = 0;
    hideSupportSurfaceDebug();
    hideSupportFootprintDebug();
  } else {
    currentSupportObstacle = null;
    hideSupportSurfaceDebug();
    hideSupportFootprintDebug();
  }
  isInAir = !onGround && !onObstacle;

  if (isPaused || pauseCountdownStart > 0) return;

  // Gather intended input from controls
  if (isInAir) {
    // In air: use stored jump values to match what we send in packets
    intendedForward = myTank.userData.jumpForwardSpeed || 0;
    intendedRotation = myTank.userData.rotationSpeed || 0;
  } else {
    // Use virtual input if gamepad connected, XR enabled, or virtual controls enabled
    if (isGamepadConnected() || virtualControlsEnabled || isXREnabled()) {
      intendedForward = virtualInput.forward;
      intendedRotation = virtualInput.turn;
      if (jumpDirection === null && virtualInput.jump) {
        intendedY = 1;
        jumpTriggered = true;
      }
    }
    const wasdKeys = ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'];
    let wasdPressed = false;
    for (const code of wasdKeys) {
      if (keys[code]) {
        intendedForward += (code === 'KeyW' || code === 'ArrowUp') ? 1 : (code === 'KeyS' || code === 'ArrowDown') ? -1 : 0;
        intendedRotation += (code === 'KeyA' || code === 'ArrowLeft') ? 1 : (code === 'KeyD' || code === 'ArrowRight') ? -1 : 0;
        wasdPressed = true;
      }
    }
    if (wasdPressed && mouseControlEnabled) {
      toggleMouseMode();
    }
    if ((keys['Tab']) && jumpDirection === null) {
      intendedY = 1;
      jumpTriggered = true;
    }
    if (mouseControlEnabled) {
      if (typeof mouseY !== 'undefined') intendedForward = -mouseY;
      if (typeof mouseX !== 'undefined') intendedRotation = -mouseX;
    }
  }
  const reverseSpeedRatio = Number.isFinite(gameConfig?.REVERSE_SPEED_RATIO)
    ? gameConfig.REVERSE_SPEED_RATIO
    : 0.5;
  intendedForward = Math.max(-reverseSpeedRatio, Math.min(1, intendedForward));
  intendedRotation = Math.max(-1, Math.min(1, intendedRotation));
  intendedY = Math.max(-1, Math.min(1, intendedY));
}

function handleMotion(deltaTime) {
  if (!myTank || !gameConfig) return;
  if (isObserver()) return;
  if (isPaused || pauseCountdownStart > 0) return;

  let forceMoveSend = false;

  // Detect landing immediately based on ground state from handleInputEvents
  // This must happen before any position/velocity modifications
  // Only clear jumpDirection if we're actually ON something (ground or obstacle), not just isInAir=false
  if (jumpDirection !== null && (onGround || onObstacle)) {
    const landingImpactSpeed = Math.abs(myTank.userData.verticalVelocity || 0);
    // We were in air, now we're on ground/obstacle - send landing packet
    forceMoveSend = true;
    jumpDirection = null;
    myJumpDirection = null;
    myTank.userData.jumpForwardSpeed = 0;
    myTank.userData.fallForwardSpeed = 0;
    myTank.userData.slideDirection = undefined;
    myTank.userData.verticalVelocity = 0;
    setAirVelocity(myTank, 0, 0);
    clearJumpPredictionDebug(myTank);
    triggerLandingFeedback(myTank, landingImpactSpeed, { local: true });
  }

  const oldX = playerX;
  const oldY = playerY;
  const oldZ = playerZ;
  const oldRotation = playerRotation;


  // Step 3: Convert intended speed/rotation to deltas
  const speed = gameConfig.TANK_SPEED * deltaTime;
  const rotSpeed = gameConfig.TANK_ROTATION_SPEED * deltaTime;
  let moveRotation = playerRotation;
  let intendedDeltaX, intendedDeltaY = 0, intendedDeltaZ;
  const priorAirVelocityX = myTank.userData.airVelocityX || 0;
  const priorAirVelocityZ = myTank.userData.airVelocityZ || 0;

  let movementForwardInput = intendedForward;
  let movementRotationInput = intendedRotation;
  if (!isInAir) {
    const forwardAccel = Number.isFinite(gameConfig.FORWARD_ACCEL) ? gameConfig.FORWARD_ACCEL : 1.8;
    const reverseAccel = Number.isFinite(gameConfig.REVERSE_ACCEL) ? gameConfig.REVERSE_ACCEL : 1.2;
    const forwardDecel = Number.isFinite(gameConfig.FORWARD_DECEL) ? gameConfig.FORWARD_DECEL : 2.5;
    const turnAccel = Number.isFinite(gameConfig.TURN_ACCEL) ? gameConfig.TURN_ACCEL : 3.0;
    const turnDecel = Number.isFinite(gameConfig.TURN_DECEL) ? gameConfig.TURN_DECEL : 4.0;

    const desiredForward = intendedForward;
    const desiredRotation = intendedRotation;

    const forwardRate = Math.abs(desiredForward) < 0.001
      ? forwardDecel
      : (desiredForward >= 0 ? forwardAccel : reverseAccel);
    const rotationRate = Math.abs(desiredRotation) < 0.001 ? turnDecel : turnAccel;

    smoothedForwardInput = approachValue(smoothedForwardInput, desiredForward, forwardRate * deltaTime);
    smoothedRotationInput = approachValue(smoothedRotationInput, desiredRotation, rotationRate * deltaTime);

    movementForwardInput = smoothedForwardInput;
    movementRotationInput = smoothedRotationInput;
  } else {
    smoothedForwardInput = intendedForward;
    smoothedRotationInput = intendedRotation;
  }

  // Determine forward speed for movement calculation
  let movementForwardSpeed = movementForwardInput;
  if (isInAir && jumpDirection !== null) {
    intendedDeltaX = priorAirVelocityX * deltaTime;
    intendedDeltaZ = priorAirVelocityZ * deltaTime;
  }

  if (!(isInAir && jumpDirection !== null)) {
    intendedDeltaX = -Math.sin(moveRotation) * movementForwardSpeed * speed;
    intendedDeltaZ = -Math.cos(moveRotation) * movementForwardSpeed * speed;
  }
  if (myTank.userData.verticalVelocity !== 0) {
    intendedDeltaY = myTank.userData.verticalVelocity * deltaTime;
  }

  if (!jumpTriggered && myTank.position.y <= 0) {
    myTank.userData.verticalVelocity = 0;
    myTank.position.y = 0;
  }

  if (isInAir) {
    myTank.userData.verticalVelocity -= (gameConfig.GRAVITY || 9.8) * deltaTime;
  }

  let jumpStarted = false; // Track if jump was just triggered this frame
  let fallStarted = false; // Track if fall was just triggered this frame

  // Only allow jump if not currently in a jump (jumpDirection is null)
  if (jumpTriggered && jumpDirection === null) {
    myTank.userData.verticalVelocity = gameConfig.JUMP_VELOCITY || 30;
    intendedDeltaY = myTank.userData.verticalVelocity * deltaTime;
    jumpStarted = true; // Mark that jump started this frame
    myTank.userData.jumpForwardSpeed = movementForwardInput;
    myTank.userData.fallForwardSpeed = movementForwardInput;
    myTank.userData.slideDirection = undefined;
    forceMoveSend = true; // Force send on jump
    if (myTank) {
      renderManager.playSound('jump', myTank.position);
      renderManager.fireTankJumpJets(myTank);
    }
  }

  let result = validateMove(playerX, playerY, playerZ, intendedDeltaX, intendedDeltaY, intendedDeltaZ, 2);
  const localNowMs = Date.now();
  let teleportedThisFrame = false;
  let predictedTeleportRotateDelta = 0;
  let predictedTeleportPacket = null;
  const sourceRotationBeforeTeleport = normalizeAngle(movementRotationInput * rotSpeed + oldRotation);
  if (result.moved && !result.startedFalling && !result.hitObstacleBottom) {
    const predictedTeleport = predictLocalPlayerTeleport(
      { x: oldX, y: oldY, z: oldZ },
      { x: result.x, y: result.y, z: result.z },
      localNowMs,
    );
    if (predictedTeleport.applied) {
      const sourceState = {
        x: result.x,
        y: result.y,
        z: result.z,
      };
      teleportedThisFrame = true;
      predictedTeleportRotateDelta = predictedTeleport.rotateDelta;
      result = {
        ...result,
        x: predictedTeleport.state.x,
        y: predictedTeleport.state.y,
        z: predictedTeleport.state.z,
        moved: true,
        altered: true,
      };
      predictedTeleportPacket = {
        type: 'tp',
        fromFaceId: predictedTeleport.fromFaceId,
        toFaceId: predictedTeleport.toFaceId,
        x: Number(sourceState.x.toFixed(2)),
        y: Number(sourceState.y.toFixed(2)),
        z: Number(sourceState.z.toFixed(2)),
        r: Number(sourceRotationBeforeTeleport.toFixed(2)),
        vv: Number((myTank.userData.verticalVelocity || 0).toFixed(2)),
        vx: Number((myTank.userData.airVelocityX || 0).toFixed(2)),
        vz: Number((myTank.userData.airVelocityZ || 0).toFixed(2)),
        jd: jumpDirection !== null && jumpDirection !== undefined
          ? Number(jumpDirection.toFixed(2))
          : null,
      };
      forceMoveSend = true;
    }
  }

  if (result.hitObstacleBottom) {
    // Hit obstacle bottom while jumping upward - reverse to falling
    myTank.userData.verticalVelocity = -Math.abs(myTank.userData.verticalVelocity) * 0.5; // Bounce with 50% energy loss
    // Keep jumpDirection frozen (still in air), but now falling
    // Don't change position this frame - just reverse velocity
  } else if (result.startedFalling) {
    // Set small negative velocity so server knows we're falling (not on ground with vv=0)
    myTank.userData.verticalVelocity = -0.1;
    forceMoveSend = true; // Immediately notify server we're falling
    // Set jumpDirection to current rotation to trigger air physics
    jumpDirection = playerRotation;
    myJumpDirection = jumpDirection;
    fallStarted = true;

    // Freeze forward speed at fall start (same as jump)
    const frozenForwardSpeed = myTank.userData.forwardSpeed || 0;
    myTank.userData.fallForwardSpeed = frozenForwardSpeed;
    myTank.userData.slideDirection = undefined;
    const fallVelocity = deriveAirVelocityFromState(jumpDirection, frozenForwardSpeed);
    setAirVelocity(myTank, fallVelocity.x, fallVelocity.z);

    // Immediately re-validate with air physics since this frame's movement was calculated wrong
    // Recalculate movement using the stored dead-stick horizontal velocity.
    const fallDeltaX = myTank.userData.airVelocityX * deltaTime;
    const fallDeltaZ = myTank.userData.airVelocityZ * deltaTime;
    const fallDeltaY = myTank.userData.verticalVelocity * deltaTime;

    // Re-validate with correct air physics
    const fallResult = validateMove(playerX, playerY, playerZ, fallDeltaX, fallDeltaY, fallDeltaZ, 2);
    if (fallResult.moved) {
      playerX = fallResult.x;
      playerY = fallResult.y;
      playerZ = fallResult.z;
    }
  } else if (result.landedOn) {
    myTank.userData.verticalVelocity = 0;
  }

  let forwardSpeed = 0;
  let rotationSpeed = myTank.userData.rotationSpeed || 0;

  if (result.moved && !fallStarted) {
    // Don't use result if we just started falling - we already applied fallResult above
    playerX = result.x;
    playerY = result.y;
    playerZ = result.z;
    // Always update playerRotation for visual tank rotation
    playerRotation = movementRotationInput * rotSpeed + oldRotation;
    if (teleportedThisFrame) {
      playerRotation = normalizeAngle(playerRotation + predictedTeleportRotateDelta);
      if (jumpDirection !== null && jumpDirection !== undefined) {
        jumpDirection = normalizeAngle(jumpDirection + predictedTeleportRotateDelta);
        myJumpDirection = jumpDirection;
      }

      const rotatedAirVelocity = rotateXZ(
        myTank.userData.airVelocityX || 0,
        myTank.userData.airVelocityZ || 0,
        predictedTeleportRotateDelta,
      );
      setAirVelocity(myTank, rotatedAirVelocity.x, rotatedAirVelocity.z);
      myTank.userData.slideDirection = undefined;
    }
    myTank.position.set(playerX, playerY, playerZ);
    myTank.rotation.y = playerRotation;

    if (teleportedThisFrame) {
      renderManager.playSound('teleport', myTank.position);
      triggerSpawnEffectForTank(myTank);
      suppressLocalTeleportFxUntil = performance.now() + 250;

      // Match BZFlag semantics: explicit teleport event is sent before
      // any subsequent movement packet generated this frame.
      if (predictedTeleportPacket && ws && ws.readyState === WebSocket.OPEN) {
        sendToServer(predictedTeleportPacket);
      }
    }

    // Store jumpDirection AFTER rotation update so it matches packet r value
    if (jumpStarted) {
      jumpDirection = playerRotation;
      myJumpDirection = jumpDirection;
      const jumpVelocity = deriveAirVelocityFromState(jumpDirection, movementForwardInput);
      setAirVelocity(myTank, jumpVelocity.x, jumpVelocity.z);
    }
  } else if (fallStarted) {
    // Fall started - apply rotation but position was already updated by fallResult
    playerRotation = movementRotationInput * rotSpeed + oldRotation;
    myTank.position.set(playerX, playerY, playerZ);
    myTank.rotation.y = playerRotation;
  }

  const actualDeltaX = playerX - oldX;
  const actualDeltaZ = playerZ - oldZ;
  const trajectoryDeltaX = Number.isFinite(result.trajectoryDeltaX)
    ? result.trajectoryDeltaX
    : actualDeltaX;
  const trajectoryDeltaZ = Number.isFinite(result.trajectoryDeltaZ)
    ? result.trajectoryDeltaZ
    : actualDeltaZ;

  // Calculate actual movement direction for slide detection before using it
  // in the forward speed calculation.
  let slideDirection = null;
  if (result.moved && result.altered) {
    // Slide occurred - calculate actual movement direction
    const actualDistance = Math.hypot(trajectoryDeltaX, trajectoryDeltaZ);

    if (actualDistance > 0.001) {
      // Calculate direction from movement vector
      const actualDirection = Math.atan2(-trajectoryDeltaX, -trajectoryDeltaZ);

      // Determine expected direction (r on ground, jumpDirection in air)
      const expectedDirection = isInAir && jumpDirection !== null ? jumpDirection : playerRotation;

      // Normalize angle difference to -PI to PI
      const angleDiff = Math.abs(((actualDirection - expectedDirection + Math.PI) % (Math.PI * 2)) - Math.PI);

      // If actual direction differs from expected by more than 0.01 radians, include it
      if (!teleportedThisFrame && angleDiff > 0.01) {
        slideDirection = actualDirection;
      }
    }
  }

  if (!teleportedThisFrame) {
    decayLocalTeleportReentryBlock(Math.hypot(actualDeltaX, actualDeltaZ), localNowMs);
  }

  if ((isInAir || jumpStarted || fallStarted) && deltaTime > 0) {
    if (teleportedThisFrame) {
      // Preserve the rotated airborne velocity through teleports. The portal
      // displacement is not physical travel and would wildly overstate speed.
    } else if (result.moved && result.altered) {
      const newAirVelocityX = trajectoryDeltaX / deltaTime;
      const newAirVelocityZ = trajectoryDeltaZ / deltaTime;
      const airVelocityDelta = Math.hypot(newAirVelocityX - priorAirVelocityX, newAirVelocityZ - priorAirVelocityZ);
      setAirVelocity(myTank, newAirVelocityX, newAirVelocityZ);
      if (airVelocityDelta > AIR_VELOCITY_THRESHOLD) {
        forceMoveSend = true;
      }
    } else if (jumpStarted && !result.altered) {
      const jumpVelocity = deriveAirVelocityFromState(jumpDirection, intendedForward);
      setAirVelocity(myTank, jumpVelocity.x, jumpVelocity.z);
    }
  }

  if (deltaTime > 0) {
    // Only recalculate forwardSpeed when on ground
    // In air, keep using the last calculated value (from userData)
    if (!isInAir) {
      const actualDeltaX = playerX - oldX;
      const actualDeltaZ = playerZ - oldZ;
      const actualDistance = Math.sqrt(actualDeltaX * actualDeltaX + actualDeltaZ * actualDeltaZ);

      if (actualDistance > 0.001) {
        const actualSpeed = actualDistance / deltaTime;
        const tankSpeed = gameConfig.TANK_SPEED;

        // When sliding (slideDirection set), use actual speed in that direction
        // Otherwise, use dot product with rotation direction
        if (slideDirection !== null) {
          // Sliding: use actual speed magnitude (already moving in slideDirection)
          forwardSpeed = actualSpeed / tankSpeed;
        } else {
          // Normal: project onto rotation direction
          const forwardX = -Math.sin(playerRotation);
          const forwardZ = -Math.cos(playerRotation);
          const dot = (actualDeltaX * forwardX + actualDeltaZ * forwardZ) / actualDistance;
          forwardSpeed = (dot * actualSpeed) / tankSpeed;
        }
        forwardSpeed = Math.max(-1, Math.min(1, forwardSpeed));
      }
    } else {
      const airSpeed = Math.hypot(myTank.userData.airVelocityX || 0, myTank.userData.airVelocityZ || 0);
      forwardSpeed = gameConfig.TANK_SPEED > 0 ? airSpeed / gameConfig.TANK_SPEED : 0;
    }
    // Calculate rotation speed when not in air (on ground or obstacle)
    if (!isInAir) {
      const actualDeltaRot = playerRotation - oldRotation;
      const actualRotSpeed = actualDeltaRot / deltaTime;
      const tankRotSpeed = gameConfig.TANK_ROTATION_SPEED;
      rotationSpeed = actualRotSpeed / tankRotSpeed;
      rotationSpeed = Math.max(-1, Math.min(1, rotationSpeed));
    }
  }
  myTank.userData.forwardSpeed = forwardSpeed;
  myTank.userData.rotationSpeed = rotationSpeed;

  const now = performance.now();
  const timeSinceLastSend = now - lastSentTime;
  const verticalVelocity = myTank ? (myTank.userData.verticalVelocity || 0) : 0;
  const airborneState = jumpDirection !== null;
  const airVelocityX = airborneState ? (myTank.userData.airVelocityX || 0) : 0;
  const airVelocityZ = airborneState ? (myTank.userData.airVelocityZ || 0) : 0;

  // Velocity-based dead reckoning: only send when velocities change (positions are extrapolated)
  const forwardSpeedDelta = Math.abs(forwardSpeed - lastSentForwardSpeed);
  const rotationSpeedDelta = Math.abs(rotationSpeed - lastSentRotationSpeed);
  // Don't check vertical velocity changes while in air - gravity is extrapolated
  // Only jump/land transitions matter (handled by forceMoveSend)
  const verticalVelocityDelta = airborneState ? 0 : Math.abs(verticalVelocity - lastSentVerticalVelocity);
  const airVelocityDelta = airborneState
    ? Math.hypot(airVelocityX - lastSentAirVelocityX, airVelocityZ - lastSentAirVelocityZ)
    : 0;

  const deadStickStopUpdate =
    !airborneState &&
    Math.abs(forwardSpeed) <= DEAD_STICK_STOP_THRESHOLD &&
    Math.abs(rotationSpeed) <= DEAD_STICK_STOP_THRESHOLD &&
    (Math.abs(lastSentForwardSpeed) > DEAD_STICK_STOP_THRESHOLD ||
      Math.abs(lastSentRotationSpeed) > DEAD_STICK_STOP_THRESHOLD);

  if (deadStickStopUpdate) {
    forceMoveSend = true;
  }

  const reasons = [];
  if (forceMoveSend) reasons.push('force');
  if (deadStickStopUpdate) reasons.push('dead-stick-stop');
  if (forwardSpeedDelta > VELOCITY_THRESHOLD) reasons.push(`fs:${forwardSpeedDelta.toFixed(3)}`);
  if (rotationSpeedDelta > VELOCITY_THRESHOLD) reasons.push(`rs:${rotationSpeedDelta.toFixed(3)}`);
  if (verticalVelocityDelta > VERTICAL_VELOCITY_THRESHOLD) reasons.push(`vv:${verticalVelocityDelta.toFixed(3)}`);
  if (airVelocityDelta > AIR_VELOCITY_THRESHOLD) reasons.push(`av:${airVelocityDelta.toFixed(3)}`);
  if (!airborneState && timeSinceLastSend > MAX_UPDATE_INTERVAL) reasons.push(`time:${(timeSinceLastSend/1000).toFixed(1)}s`);

  // Minimum 100ms between non-forced updates to prevent rapid-fire from calculation noise
  const minTimeBetweenUpdates = 100; // ms
  const canSendVelocityUpdate = forceMoveSend || timeSinceLastSend > minTimeBetweenUpdates;

  const shouldSendUpdate =
    forceMoveSend || // Force send on jump/land transitions
    (!airborneState && timeSinceLastSend > MAX_UPDATE_INTERVAL) || // Heartbeat on ground only
    (canSendVelocityUpdate && (
      forwardSpeedDelta > VELOCITY_THRESHOLD ||
      rotationSpeedDelta > VELOCITY_THRESHOLD ||
      verticalVelocityDelta > VERTICAL_VELOCITY_THRESHOLD ||
      airVelocityDelta > AIR_VELOCITY_THRESHOLD
    ));

  if (shouldSendUpdate && ws && ws.readyState === WebSocket.OPEN) {

    // Round velocities to the precision we send to match server expectations
    // For jump packets, send the intendedForward value used for movement, not calculated forwardSpeed
    const sentFS = deadStickStopUpdate
      ? 0
      : (jumpStarted ? Number((myTank.userData.jumpForwardSpeed || 0).toFixed(2)) : Number(forwardSpeed.toFixed(2)));
    const sentRS = deadStickStopUpdate ? 0 : Number(rotationSpeed.toFixed(2));
    const sentVV = Number(verticalVelocity.toFixed(2));

    const movePacket = {
      type: 'm',
      id: myPlayerId,
      x: Number(playerX.toFixed(2)),
      y: Number(playerY.toFixed(2)),
      z: Number(playerZ.toFixed(2)),
      r: Number(playerRotation.toFixed(2)),
      fs: sentFS,
      rs: sentRS,
      vv: sentVV,
      vx: Number(airVelocityX.toFixed(2)),
      vz: Number(airVelocityZ.toFixed(2)),
      dt: Number(deltaTime.toFixed(3)),
    };

    // Add optional direction field if sliding
    const packetSlideDirection = airborneState
      ? myTank.userData.slideDirection
      : slideDirection;
    if (packetSlideDirection !== null && packetSlideDirection !== undefined) {
      movePacket.d = Number(packetSlideDirection.toFixed(2));
    }

    if (myTank && myTank.userData.ghostMesh) {
      const ghostX = Number(playerX.toFixed(2));
      const ghostY = Number(playerY.toFixed(2));
      const ghostZ = Number(playerZ.toFixed(2));
      const ghostR = Number(playerRotation.toFixed(2));

      myTank.userData.ghostMesh.position.set(ghostX, ghostY, ghostZ);
      myTank.userData.ghostMesh.rotation.y = ghostR;
      myTank.userData.ghostMesh.userData.hasPacketState = true;
      myTank.userData.ghostMesh.visible = showDebugGeometry;
      updatePacketMotionDebug(myTank.userData.ghostMesh, {
      fs: sentFS,
      rs: sentRS,
      vv: sentVV,
      vx: movePacket.vx,
      vz: movePacket.vz,
      r: movePacket.r,
      d: movePacket.d,
      jumpDirection
      }, 'sent');
    }

    if (jumpDirection !== null && jumpDirection !== undefined) {
      updateJumpPredictionDebug(myTank, {
        x: movePacket.x,
        y: movePacket.y,
        z: movePacket.z,
        r: movePacket.r,
        forwardSpeed: sentFS,
        rotationSpeed: sentRS,
        verticalVelocity: sentVV,
        jumpDirection,
        slideDirection: movePacket.d,
        airVelocityX: movePacket.vx,
        airVelocityZ: movePacket.vz
      }, 'sent');
    } else {
      clearJumpPredictionDebug(myTank);
    }

    sendToServer(movePacket);
    // Store the ROUNDED values we actually sent to prevent rounding-induced deltas
    lastSentForwardSpeed = sentFS;
    lastSentRotationSpeed = sentRS;
    lastSentVerticalVelocity = sentVV;
    lastSentAirVelocityX = movePacket.vx;
    lastSentAirVelocityZ = movePacket.vz;
    lastSentTime = now;

  }
  // Fire: the keyboard fire key or the left mouse button, and on mobile, XR or
  // a gamepad, virtualInput.fire.
  const firePressed = (!isMobile && keys[FIRE_KEY]) || ((isMobile || isXREnabled() || isGamepadConnected()) && virtualInput.fire);
  const fireNow = performance.now();
  if (firePressed && fireNow >= nextAllowedShotAt) {
    const maxActiveShots = normalizeShotSlotCount(gameConfig?.SHOT_MAX_ACTIVE);
    if (getActiveProjectileCountForPlayer(myPlayerId) < maxActiveShots) {
      if (shoot()) {
        nextAllowedShotAt = fireNow + getShotReloadTimeMs();
      }
    }
  }
}

function shoot() {
  if (isObserver()) return false;
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;

  const dirX = -Math.sin(playerRotation);
  const dirZ = -Math.cos(playerRotation);

  // Calculate shot origin from model-derived muzzle offsets when available
  const muzzleForward = Number.isFinite(myTank?.userData?.muzzleForward)
    ? myTank.userData.muzzleForward
    : 3.0;
  const muzzleHeight = Number.isFinite(myTank?.userData?.muzzleHeight)
    ? myTank.userData.muzzleHeight
    : 1.57;
  const shotX = playerX + dirX * muzzleForward;
  const shotY = (myTank ? myTank.position.y : 0) + muzzleHeight;
  const shotZ = playerZ + dirZ * muzzleForward;

  sendToServer({
    type: 'shoot',
    x: shotX,
    y: shotY,
    z: shotZ,
    dirX,
    dirY: 0,
    dirZ,
  });
  createLocalProjectile({ x: shotX, y: shotY, z: shotZ, dirX, dirY: 0, dirZ });
  return true;
}

function getShotTeleporterDims(obs) {
  const halfW = Math.max(0.25, Number(obs.w) / 2 || 0.56);
  const sourceHalfBreadth = Math.max(0.25, Number(obs.d) / 2 || 2.24);
  const sourceHeight = Math.max(1.0, Number(obs.h) || 10.0);
  const border = Math.max(0.12, Number(obs.border) || 1.12);

  // Match render teleporter geometry so visual frame and shot frame tests align.
  const halfD = sourceHalfBreadth + (border * 2.0);
  const h = sourceHeight + border;
  const activeHalfD = Math.max(0.1, halfD - border);
  const activeH = Math.max(0.2, h - border);
  return { halfW, halfD, h, border, activeHalfD, activeH };
}

const BZFLAG_TELEPORT_TOLERANCE = 1e-6;

function getSegmentBoxEntryTime(localStart, localEnd, bounds) {
  const delta = {
    x: localEnd.x - localStart.x,
    y: localEnd.y - localStart.y,
    z: localEnd.z - localStart.z,
  };

  let tMin = 0;
  let tMax = 1;
  const axes = ['x', 'y', 'z'];

  for (const axis of axes) {
    const start = localStart[axis];
    const d = delta[axis];
    const min = bounds.min[axis];
    const max = bounds.max[axis];

    if (Math.abs(d) < 1e-9) {
      if (start < min || start > max) return null;
      continue;
    }

    let t1 = (min - start) / d;
    let t2 = (max - start) / d;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }

    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }

  if (tMax < 0 || tMin > 1) return null;
  return Math.max(0, tMin);
}

function getShotTeleporterCrossing(start, end, obs) {
  const dims = getShotTeleporterDims(obs);
  const startLocalXZ = getColliderLocalPoint(start.x, start.z, obs);
  const endLocalXZ = getColliderLocalPoint(end.x, end.z, obs);

  const localStart = {
    x: startLocalXZ.x,
    y: start.y - (obs.baseY || 0),
    z: startLocalXZ.z,
  };
  const localEnd = {
    x: endLocalXZ.x,
    y: end.y - (obs.baseY || 0),
    z: endLocalXZ.z,
  };

  const outerBounds = {
    min: { x: -dims.halfW, y: 0, z: -dims.halfD },
    max: { x: dims.halfW, y: dims.h, z: dims.halfD },
  };
  const innerBounds = {
    min: { x: -dims.halfW, y: 0, z: -dims.activeHalfD },
    max: { x: dims.halfW, y: dims.activeH, z: dims.activeHalfD },
  };

  const tOuter = getSegmentBoxEntryTime(localStart, localEnd, outerBounds);
  const tInner = getSegmentBoxEntryTime(localStart, localEnd, innerBounds);
  if (tInner === null || tInner < 0 || tInner > 1) return null;
  if (tOuter !== null && (tInner - tOuter) > BZFLAG_TELEPORT_TOLERANCE) return null;

  const hitLocalX = localStart.x + (localEnd.x - localStart.x) * tInner;
  const face = hitLocalX > 0 ? 0 : 1;
  const sourceFaceId = obs.teleporterIndex * 2 + face;

  return {
    t: tInner,
    sourceFaceId,
    face,
    point: {
      x: start.x + (end.x - start.x) * tInner,
      y: start.y + (end.y - start.y) * tInner,
      z: start.z + (end.z - start.z) * tInner,
    },
  };
}

function rotateXZ(x, z, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: cos * x - sin * z,
    z: sin * x + cos * z,
  };
}

function transformShotThroughTeleporter(pointIn, dirIn, sourceObs, sourceFace, destObs, destFace) {
  const srcDims = getShotTeleporterDims(sourceObs);
  const dstDims = getShotTeleporterDims(destObs);

  const radians1 = (sourceObs.rotation || 0) + (sourceFace === 0 ? 0 : Math.PI);
  const radians2 = (destObs.rotation || 0) + (destFace === 1 ? 0 : Math.PI);

  const relativeX = pointIn.x - sourceObs.x;
  const relativeZ = pointIn.z - sourceObs.z;
  const relativeY = pointIn.y - (sourceObs.baseY || 0);
  const local = rotateXZ(relativeX, relativeZ, -radians1);

  const breadthScale = srcDims.activeHalfD > 1e-6 ? (dstDims.activeHalfD / srcDims.activeHalfD) : 1;
  const heightScale = srcDims.activeH > 1e-6 ? (dstDims.activeH / srcDims.activeH) : 1;

  const localOut = {
    x: -dstDims.halfW,
    z: local.z * breadthScale,
    y: relativeY * heightScale,
  };

  const rotatedOut = rotateXZ(localOut.x, localOut.z, radians2);
  const pointOut = {
    x: destObs.x + rotatedOut.x,
    y: (destObs.baseY || 0) + localOut.y,
    z: destObs.z + rotatedOut.z,
  };

  const rotateDelta = radians2 - radians1;
  const dirRotated = rotateXZ(dirIn.x, dirIn.z, rotateDelta);
  const dirOut = {
    x: dirRotated.x,
    y: dirIn.y,
    z: dirRotated.z,
  };

  return { pointOut, dirOut };
}

const SHOT_TELEPORT_REENTRY_BLOCK_DISTANCE = 0.5;

function traceShotThroughTeleporters(start, dir, travelDistance, reentryBlockTeleporterIndex = null, reentryBlockDistance = 0) {
  let point = { ...start };
  let direction = { ...dir };
  let remaining = travelDistance;
  let teleports = 0;
  let blockedTeleporterIndex = Number.isInteger(reentryBlockTeleporterIndex) ? reentryBlockTeleporterIndex : null;
  let blockedDistance = Math.max(0, Number(reentryBlockDistance) || 0);
  const maxTeleportsPerTick = 8;

  while (remaining > 1e-6 && teleports < maxTeleportsPerTick) {
    const end = {
      x: point.x + direction.x * remaining,
      y: point.y + direction.y * remaining,
      z: point.z + direction.z * remaining,
    };

    let earliest = null;
    for (const obs of TELEPORTER_OBSTACLES_BY_INDEX.values()) {
      const crossing = getShotTeleporterCrossing(point, end, obs);
      if (!crossing) continue;
      if (blockedTeleporterIndex !== null && blockedDistance > 1e-6 && obs.teleporterIndex === blockedTeleporterIndex) {
        continue;
      }
      if (!earliest || crossing.t < earliest.crossing.t) {
        earliest = { obs, crossing };
      }
    }

    if (!earliest) {
      blockedDistance = Math.max(0, blockedDistance - remaining);
      if (blockedDistance <= 1e-6) blockedTeleporterIndex = null;
      point = end;
      break;
    }

    const sourceFaceId = earliest.crossing.sourceFaceId;
    const sourceObs = earliest.obs;
    const sourceFace = sourceFaceId % 2;
    const destinations = TELEPORTER_LINKS_BY_SOURCE_FACE.get(sourceFaceId) || [];
    const destFaceId = destinations.length > 0
      ? destinations[0]
      : ((Math.floor(sourceFaceId / 2) * 2) + (1 - (sourceFaceId % 2)));
    const destTeleporterIndex = Math.floor(destFaceId / 2);
    const destFace = destFaceId % 2;
    const destObs = TELEPORTER_OBSTACLES_BY_INDEX.get(destTeleporterIndex);
    if (!destObs) break;

    const transformed = transformShotThroughTeleporter(
      earliest.crossing.point,
      direction,
      sourceObs,
      sourceFace,
      destObs,
      destFace,
    );

    const consumedDistance = remaining * earliest.crossing.t;
    blockedDistance = Math.max(0, blockedDistance - consumedDistance);
    if (blockedDistance <= 1e-6) blockedTeleporterIndex = null;
    remaining = Math.max(0, remaining - consumedDistance);
    point = {
      x: transformed.pointOut.x + transformed.dirOut.x * 0.02,
      y: transformed.pointOut.y + transformed.dirOut.y * 0.02,
      z: transformed.pointOut.z + transformed.dirOut.z * 0.02,
    };
    direction = transformed.dirOut;
    blockedTeleporterIndex = destTeleporterIndex;
    blockedDistance = Math.max(
      SHOT_TELEPORT_REENTRY_BLOCK_DISTANCE,
      (getShotTeleporterDims(destObs).activeHalfD * 2) + 0.05,
    );
    teleports++;
  }

  return {
    point,
    direction,
    teleports,
    reentryBlockTeleporterIndex: blockedTeleporterIndex,
    reentryBlockDistance: blockedDistance,
  };
}

function isShotTeleportDebugEnabled() {
  try {
    return localStorage.getItem('debugShotTeleports') === '1';
  } catch {
    return false;
  }
}

function updateProjectiles(deltaTime) {
  const projectileSpeed = Number.isFinite(gameConfig?.SHOT_SPEED) ? gameConfig.SHOT_SPEED : 100;
  const clampedDelta = Math.min(0.1, Math.max(0, Number.isFinite(deltaTime) ? deltaTime : 0));
  projectileSimAccumulator += clampedDelta;
  const maxAccumulated = SHOT_SIM_STEP_SECONDS * SHOT_SIM_MAX_STEPS_PER_FRAME;
  if (projectileSimAccumulator > maxAccumulated) {
    projectileSimAccumulator = maxAccumulated;
  }

  while (projectileSimAccumulator >= SHOT_SIM_STEP_SECONDS) {
    projectiles.forEach((projectile) => {
      const traced = traceShotThroughTeleporters(
        {
          x: projectile.position.x,
          y: projectile.position.y,
          z: projectile.position.z,
        },
        {
          x: Number.isFinite(projectile.userData.dirX) ? projectile.userData.dirX : 0,
          y: Number.isFinite(projectile.userData.dirY) ? projectile.userData.dirY : 0,
          z: Number.isFinite(projectile.userData.dirZ) ? projectile.userData.dirZ : 0,
        },
        projectileSpeed * SHOT_SIM_STEP_SECONDS,
        projectile.userData.teleportReentryBlockTeleporterIndex,
        projectile.userData.teleportReentryBlockDistance,
      );

      projectile.position.x = traced.point.x;
      projectile.position.y = traced.point.y;
      projectile.position.z = traced.point.z;
      if (traced.teleports > 0) {
        renderManager.createShotTeleportEffect(projectile);
      }
      projectile.userData.dirX = traced.direction.x;
      projectile.userData.dirY = traced.direction.y;
      projectile.userData.dirZ = traced.direction.z;
      projectile.userData.teleportReentryBlockTeleporterIndex = traced.reentryBlockTeleporterIndex;
      projectile.userData.teleportReentryBlockDistance = traced.reentryBlockDistance;

      if (traced.teleports > 0 && projectile?.userData?.playerId === myPlayerId && isShotTeleportDebugEnabled()) {
        sendToServer({
          type: 'debug',
          message: `[SHOT_TP_CLIENT] id=${String(projectile?.userData?.pendingServerAck ? 'pending' : 'ack')} teleports=${traced.teleports} pos=(${projectile.position.x.toFixed(2)},${projectile.position.y.toFixed(2)},${projectile.position.z.toFixed(2)})`,
        });
      }
    });
    projectileSimAccumulator -= SHOT_SIM_STEP_SECONDS;
  }

  if (pendingLocalProjectiles.length > 0) {
    const now = Date.now();
    const timeoutMs = 2000;
    pendingLocalProjectiles = pendingLocalProjectiles.filter((pending) => {
      if (now - pending.sentAt <= timeoutMs) return true;
      const projectile = projectiles.get(pending.id);
      if (projectile?.userData?.pendingServerAck) {
        renderManager.removeProjectile(projectile);
        projectiles.delete(pending.id);
      }
      return false;
    });
  }
}

function updateShields() {
  playerShields.forEach((shield, playerId) => {
    // Rotate shield
    shield.userData.rotation += 0.02;
    shield.rotation.y = shield.userData.rotation;

    // Update position to follow player
    const tank = tanks.get(playerId);
    if (tank) {
      shield.position.copy(tank.position);
      shield.position.y = tank.position.y + 2;
    }
  });
}

function onWindowResize() {
  renderManager.handleResize();
  camera = renderManager.getCamera();
  resizeRadar();
}

function resizeRadar() {
  if (!radarCanvas) return;
  const smallerDimension = Math.min(window.innerWidth, window.innerHeight);
  const size = Math.max(120, Math.min(390, Math.round(smallerDimension * 0.375)));
  radarCanvas.width = size;
  radarCanvas.height = size;
  radarCanvas.style.width = size + 'px';
  radarCanvas.style.height = size + 'px';
}

// Every XR HUD overlay is the same object: a 2D canvas wrapped in a
// CanvasTexture on a plane parented to the camera, so it rides the head. Only
// the canvas size, the plane size and placement, and the painting differ.
function ensureXRHudPanel(panel, { canvas = null, canvasWidth = 0, canvasHeight = 0 }) {
  const baseCamera = renderManager?.getCamera();
  if (!baseCamera) return null;

  if (canvas) {
    panel.canvas = canvas;
  } else if (!panel.canvas) {
    panel.canvas = document.createElement('canvas');
    panel.canvas.width = canvasWidth;
    panel.canvas.height = canvasHeight;
  }

  if (!panel.texture) {
    panel.texture = new THREE.CanvasTexture(panel.canvas);
    panel.texture.colorSpace = THREE.SRGBColorSpace;
  }

  if (!panel.mesh) {
    panel.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: panel.texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        opacity: 1,
      }),
    );
    panel.mesh.renderOrder = Number.MAX_SAFE_INTEGER;
    panel.mesh.visible = false;
  }

  if (panel.mesh.parent !== baseCamera) {
    panel.mesh.parent?.remove(panel.mesh);
    baseCamera.add(panel.mesh);
  }

  return panel.mesh;
}

// Resize the plane to the panel's current size and place it on the HUD plane.
// The settings menu covers the view, so nothing else shows while it is open.
function placeXRHudPanel(panel, { width, height, x, y }) {
  if (panel.planeWidth !== width || panel.planeHeight !== height) {
    panel.mesh.geometry.dispose();
    panel.mesh.geometry = new THREE.PlaneGeometry(width, height);
    panel.planeWidth = width;
    panel.planeHeight = height;
  }
  panel.mesh.scale.set(1, 1, 1);
  panel.mesh.position.set(x, y, XR_HUD_PLANE_Z);
  panel.mesh.rotation.set(0, 0, 0);
  panel.mesh.visible = isXREnabled() && !xrSettingsMenuOpen;
}

// Every overlay repaints its canvas and re-uploads it as a texture, and none of
// them are drawn outside an XR session. So paint none of them there: hide the
// panels once on the way out of a session, and skip the whole set until the
// next one. The desktop HUD these mirror is DOM and canvas that draws itself.
function updateXRHudOverlays() {
  if (!isXREnabled()) {
    if (!xrHudOverlaysActive) return;
    xrHudOverlaysActive = false;
    XR_HUD_PANELS.forEach((panel) => {
      if (panel.mesh) panel.mesh.visible = false;
    });
    xrSettingsMenuRenderer?.hide();
    return;
  }

  xrHudOverlaysActive = true;
  ensureXRRadarTexture();
  ensureXRShotStatusOverlay();
  ensureXRChatOverlay();
  ensureXRScoreboardOverlay();
  ensureXRSettingsMenu();
}

function ensureXRRadarTexture() {
  if (!radarCanvas) return;
  if (!ensureXRHudPanel(xrRadarPanel, { canvas: radarCanvas })) return;

  const size = XR_RADAR_PLANE_SIZE * 0.75;
  const centerShift = 0.25 * size;
  placeXRHudPanel(xrRadarPanel, {
    width: size,
    height: size,
    x: 0.42 - centerShift,
    y: 0.38 - centerShift,
  });

  if (isXREnabled()) xrRadarPanel.texture.needsUpdate = true;
}

function ensureXRChatOverlay() {
  if (!ensureXRHudPanel(xrChatPanel, { canvasWidth: 1024, canvasHeight: 220 })) return;

  const canvas = xrChatPanel.canvas;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    xrChatPanel.mesh.visible = false;
    return;
  }

  const w = canvas.width;
  const h = canvas.height;
  const panelX = 14;
  const panelY = 14;
  const panelW = w - 28;
  const panelH = h - 26;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(13, 16, 22, 0.78)';
  roundedRect(ctx, panelX, panelY, panelW, panelH, 12);
  ctx.fill();

  const activeMessages = chatState.messages[chatState.activeTab] || [];
  const visibleMessages = activeMessages.slice(-3);
  ctx.fillStyle = '#dfe7f3';
  ctx.font = 'bold 17px monospace';
  const messageAreaTop = 26;
  const messageLineHeight = 18;
  visibleMessages.forEach((msg, index) => {
    const text = msg.text || '';
    const y = messageAreaTop + index * messageLineHeight;
    const trimmed = text.length > 42 ? `${text.slice(0, 39)}...` : text;
    ctx.fillText(trimmed, 24, y + 14);
  });

  const tabs = getVisibleChatTabs();
  const tabStripY = h - 32;
  const tabStripHeight = 18;
  const tabGap = 6;
  const tabWidth = (panelW - (tabs.length + 1) * tabGap) / Math.max(1, tabs.length);

  tabs.forEach((tab, index) => {
    const x = panelX + tabGap + index * (tabWidth + tabGap);
    const isActive = tab.id === chatState.activeTab;
    ctx.fillStyle = isActive ? '#f5f7ff' : 'rgba(90, 100, 115, 0.88)';
    ctx.fillRect(x, tabStripY, tabWidth, tabStripHeight);
    ctx.strokeStyle = isActive ? '#a9c8ff' : '#d7dce6';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, tabStripY, tabWidth, tabStripHeight);
    ctx.fillStyle = isActive ? '#1c2430' : '#f1f5f9';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(tab.label, x + 6, tabStripY + 13);
  });

  xrChatPanel.texture.needsUpdate = true;
  placeXRHudPanel(xrChatPanel, { width: XR_CHAT_PLANE_WIDTH, height: 0.18, x: 0, y: -0.48 });
}

function ensureXRShotStatusOverlay() {
  if (!ensureXRHudPanel(xrShotStatusPanel, { canvasWidth: 220, canvasHeight: 200 })) return;

  const canvas = xrShotStatusPanel.canvas;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    xrShotStatusPanel.mesh.visible = false;
    return;
  }

  const maxSlots = gameConfig && Number.isFinite(gameConfig.SHOT_MAX_ACTIVE)
    ? normalizeShotSlotCount(gameConfig.SHOT_MAX_ACTIVE)
    : 5;
  const shotSpeed = Number.isFinite(gameConfig?.SHOT_SPEED) ? gameConfig.SHOT_SPEED : 100;
  const shotRange = Number.isFinite(gameConfig?.SHOT_RANGE)
    ? gameConfig.SHOT_RANGE
    : (Number.isFinite(gameConfig?.SHOT_DISTANCE) ? gameConfig.SHOT_DISTANCE : 350);
  const slotLifetimeMs = shotSpeed > 0 ? (shotRange / shotSpeed) * 1000 : 0;
  const slotProgress = new Array(maxSlots).fill(1);

  projectiles.forEach((projectile) => {
    if (projectile?.userData?.playerId !== myPlayerId) return;
    const slotIndex = Number.isInteger(projectile?.userData?.shotSlot) ? projectile.userData.shotSlot : -1;
    if (slotIndex < 0 || slotIndex >= maxSlots) return;
    const createdAt = Number.isFinite(projectile?.userData?.createdAt) ? projectile.userData.createdAt : Date.now();
    const ageMs = Math.max(0, Date.now() - createdAt);
    slotProgress[slotIndex] = slotLifetimeMs > 0 ? Math.max(0, Math.min(1, ageMs / slotLifetimeMs)) : 0;
  });

  const barGap = 2;
  const barHeight = 7;
  const barWidth = 32;
  const totalHeight = maxSlots * barHeight + Math.max(0, maxSlots - 1) * barGap;
  canvas.width = barWidth;
  canvas.height = Math.max(32, totalHeight);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  slotProgress.forEach((progress, index) => {
    const y = index * (barHeight + barGap);
    if (progress >= 1) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.fillRect(0, y, barWidth, barHeight);
      return;
    }
    ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
    ctx.fillRect(0, y, barWidth, barHeight);
    ctx.fillStyle = 'rgba(0, 255, 0, 0.5)';
    ctx.fillRect(0, y, barWidth * Math.max(0, Math.min(1, progress)), barHeight);
  });

  xrShotStatusPanel.texture.needsUpdate = true;

  const shotWidth = 0.08;
  const radarMesh = xrRadarPanel.mesh;
  const radarPlaneWidth = radarMesh?.geometry ? radarMesh.geometry.parameters.width : XR_RADAR_PLANE_SIZE * 0.75;
  const radarRightEdge = radarMesh
    ? radarMesh.position.x + (radarPlaneWidth / 2)
    : 0.42 - (0.25 * radarPlaneWidth) + (radarPlaneWidth / 2);
  placeXRHudPanel(xrShotStatusPanel, {
    width: shotWidth,
    height: Math.min(0.18, 0.02 + maxSlots * 0.015),
    x: radarRightEdge - (shotWidth / 2),
    y: 0.02,
  });
}

function ensureXRScoreboardOverlay() {
  if (!ensureXRHudPanel(xrScoreboardPanel, { canvasWidth: 720, canvasHeight: 340 })) return;

  const canvas = xrScoreboardPanel.canvas;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    xrScoreboardPanel.mesh.visible = false;
    return;
  }

  const playerData = [];
  if (myPlayerId && myTank && myTank.userData.playerState) {
    playerData.push({
      id: myPlayerId,
      name: myPlayerName,
      kills: myTank.userData.playerState.kills || 0,
      deaths: myTank.userData.playerState.deaths || 0,
      isCurrent: true,
    });
  }

  tanks.forEach((tank, id) => {
    if (id !== myPlayerId && tank.userData.playerState) {
      playerData.push({
        id,
        name: tank.userData.playerState.name || 'Player',
        kills: tank.userData.playerState.kills || 0,
        deaths: tank.userData.playerState.deaths || 0,
        isCurrent: false,
      });
    }
  });

  playerData.sort((a, b) => {
    const aScore = (a.kills || 0) - (a.deaths || 0);
    const bScore = (b.kills || 0) - (b.deaths || 0);
    if (bScore !== aScore) return bScore - aScore;
    if ((b.kills || 0) !== (a.kills || 0)) return b.kills - a.kills;
    if ((a.deaths || 0) !== (b.deaths || 0)) return (a.deaths || 0) - (b.deaths || 0);
    return String(a.name).localeCompare(String(b.name));
  });

  const teamRows = getTeamScoreRows(teamScores);
  const margin = 12;
  const rowHeight = 18;
  const headerHeight = 20;
  const maxRows = 8;
  const visiblePlayers = playerData.slice(0, maxRows);
  const teamBlockHeight = teamRows.length ? headerHeight + teamRows.length * rowHeight + 8 : 0;
  const panelW = 320;
  const panelH = Math.max(120, teamBlockHeight + headerHeight + 10 + visiblePlayers.length * rowHeight + 12);
  canvas.width = panelW;
  canvas.height = panelH;

  ctx.clearRect(0, 0, panelW, panelH);
  ctx.fillStyle = 'rgba(7, 10, 14, 0.78)';
  ctx.fillRect(0, 0, panelW, panelH);

  ctx.strokeStyle = 'rgba(130, 150, 170, 0.6)';
  ctx.lineWidth = 2;
  ctx.strokeRect(6, 6, panelW - 12, panelH - 12);

  ctx.fillStyle = '#4CAF50';
  ctx.font = 'bold 14px monospace';
  if (teamRows.length) {
    ctx.fillText('Team Score', margin, 16);
    ctx.font = '13px monospace';
    teamRows.forEach((row, index) => {
      const y = 38 + index * rowHeight;
      ctx.fillStyle = colorToCSS(getPlayerTeamColor(row.team));
      ctx.fillText(row.label, margin, y);
      ctx.fillText(formatTeamScore(row), panelW - 110, y);
    });
    ctx.fillStyle = '#4CAF50';
    ctx.font = 'bold 14px monospace';
  }

  const playerHeaderY = 16 + teamBlockHeight;
  ctx.fillText('Player', margin, playerHeaderY);
  ctx.fillText('K/D', panelW - 42, playerHeaderY);

  ctx.font = '13px monospace';
  visiblePlayers.forEach((player, index) => {
    const y = playerHeaderY + 22 + index * rowHeight;
    const name = String(player.name || 'Player');
    ctx.fillStyle = player.isCurrent ? '#8BE28C' : '#E6F1FF';
    ctx.fillText(name.length > 14 ? `${name.slice(0, 11)}...` : name, margin, y);
    ctx.fillStyle = '#F2F5F8';
    ctx.fillText(`${player.kills} / ${player.deaths}`, panelW - 46, y);
  });

  xrScoreboardPanel.texture.needsUpdate = true;

  const baseWidth = 0.36;
  const baseHeight = Math.min(0.36, 0.06 + (visiblePlayers.length + teamRows.length) * 0.025);
  placeXRHudPanel(xrScoreboardPanel, {
    width: baseWidth,
    height: baseHeight,
    // Left-aligned with the chat panel below it.
    x: -(XR_CHAT_PLANE_WIDTH / 2) + (baseWidth / 2),
    y: 0.42 - (baseHeight / 2),
  });
}

const RADAR_WORLD_INSET_PX = 10;
const RADAR_EDGE_DOT_INSET_PX = 4;
const RADAR_TANK_ARROW_EXTENT_PX = 10;

function getRadarWorldHalfExtent(radius) {
  return Math.max(1, radius - RADAR_WORLD_INSET_PX);
}

function radarPixelsToWorldDistance(pixelDistance, radarDistance, radarWorldHalfExtent) {
  if (pixelDistance <= 0) return 0;
  const pixelsPerWorldUnit = radarWorldHalfExtent / Math.max(radarDistance, 1e-6);
  return pixelDistance / Math.max(pixelsPerWorldUnit, 1e-6);
}

function clipPolygonAxisAligned(points, axis, boundary, keepLessEqual) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const output = [];

  const isInside = (point) => (
    keepLessEqual ? point[axis] <= boundary : point[axis] >= boundary
  );

  const intersect = (a, b) => {
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < 1e-9) {
      return { x: a.x, y: a.y };
    }
    const t = (boundary - a[axis]) / delta;
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    };
  };

  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const previous = points[(i + points.length - 1) % points.length];
    const currentInside = isInside(current);
    const previousInside = isInside(previous);

    if (currentInside) {
      if (!previousInside) {
        output.push(intersect(previous, current));
      }
      output.push(current);
    } else if (previousInside) {
      output.push(intersect(previous, current));
    }
  }

  return output;
}

function clipPolygonToRadarSquare(points, halfExtent) {
  let clipped = points;
  clipped = clipPolygonAxisAligned(clipped, 'x', halfExtent, true);
  clipped = clipPolygonAxisAligned(clipped, 'x', -halfExtent, false);
  clipped = clipPolygonAxisAligned(clipped, 'y', halfExtent, true);
  clipped = clipPolygonAxisAligned(clipped, 'y', -halfExtent, false);
  return clipped;
}

/**
 * Convert 3D world coordinates to 2D radar coordinates
 * @param {number} worldX - World X position
 * @param {number} worldZ - World Z position
 * @param {number} px - Player X position
 * @param {number} pz - Player Z position
 * @param {number} playerHeading - Player heading in radians
 * @param {number} center - Radar canvas center
 * @param {number} radius - Radar effective radius
 * @param {number} shotDistance - Visible radar distance
 * @param {number} worldRotation - Optional world rotation (default 0)
 * @returns {{x: number, y: number, distance: number, rotation: number}} Radar coordinates, distance, and transformed rotation
 */
function worldToRadarRelative(worldX, worldZ, px, pz, playerHeading) {
  const dx = worldX - px;
  const dz = worldZ - pz;
  const distance = Math.sqrt(dx * dx + dz * dz);

  // Rotate to player-relative coordinates (forward = up on radar)
  const rotX = dx * Math.cos(playerHeading) - dz * Math.sin(playerHeading);
  const rotY = dx * Math.sin(playerHeading) + dz * Math.cos(playerHeading);

  return { x: rotX, y: rotY, distance };
}

function radarRelativeToCanvas(radarX, radarY, center, radarWorldHalfExtent, radarDistance) {
  return {
    x: center + (radarX / radarDistance) * radarWorldHalfExtent,
    y: center + (radarY / radarDistance) * radarWorldHalfExtent,
  };
}

function world2Radar(worldX, worldZ, px, pz, playerHeading, center, radius, shotDistance, worldRotation = 0) {
  const rel = worldToRadarRelative(worldX, worldZ, px, pz, playerHeading);
  const worldHalfExtent = getRadarWorldHalfExtent(radius);
  const panel = radarRelativeToCanvas(rel.x, rel.y, center, worldHalfExtent, shotDistance);

  // Scale to radar size
  const x = panel.x;
  const y = panel.y;

  // Rotation transform:
  // - Negate worldRotation to account for Z-axis direction difference (Three.js vs canvas)
  // - Add playerHeading so objects stay fixed in world space as radar rotates
  const rotation = -worldRotation + playerHeading;

  return { x, y, distance: rel.distance, rotation };
}

/**
 * Calculate opacity for radar objects based on player's Y position relative to object
 * @param {number} playerY - Player's Y position
 * @param {number} baseY - Object's base Y position
 * @param {number} height - Object's height
 * @returns {number} Opacity value between 0.2 and 0.8
 */
function getRadarOpacity(playerY, baseY = 0, height = 0) {
  const topY = baseY + height;

  // Player is within the object's vertical bounds - most opaque
  if (playerY >= baseY && playerY <= topY) {
    return 0.8;
  }

  // Player is above or below - more translucent
  const distanceAbove = playerY > topY ? (playerY - topY) : 0;
  const distanceBelow = playerY < baseY ? (baseY - playerY) : 0;
  const verticalDistance = Math.max(distanceAbove, distanceBelow);

  // Fade from 0.8 to 0.2 based on vertical distance (fade over 20 units)
  const opacity = Math.max(0.2, 0.8 - (verticalDistance / 20) * 0.6);
  return opacity;
}

function getObstacleRadarFillStyle(obs) {
  const neutral = [180, 180, 180];
  if (!obs || obs.kind !== 'base') {
    return `rgb(${neutral[0]},${neutral[1]},${neutral[2]})`;
  }

  const teamValue = Number(obs.team);
  const team = Number.isFinite(teamValue)
    ? Math.max(1, Math.min(4, Math.round(teamValue)))
    : 1;
  const teamColors = {
    1: [178, 64, 64],
    2: [64, 153, 64],
    3: [64, 96, 192],
    4: [144, 64, 176],
  };
  const [tr, tg, tb] = teamColors[team] || teamColors[1];
  const tintStrength = 0.65;

  const r = Math.round(neutral[0] * (1 - tintStrength) + tr * tintStrength);
  const g = Math.round(neutral[1] * (1 - tintStrength) + tg * tintStrength);
  const b = Math.round(neutral[2] * (1 - tintStrength) + tb * tintStrength);
  return `rgb(${r},${g},${b})`;
}

function updateRadar() {
  if (!radarCtx || !myTank || !gameConfig) return;
  // Declare radar variables only once
  const size = radarCanvas.width;
  const center = size / 2;
  const radius = center * 0.95;
  const radarWorldHalfExtent = getRadarWorldHalfExtent(radius);
  const baseRadarDistance = gameConfig.SHOT_DISTANCE || 50;
  const radarDistance = baseRadarDistance * radarZoomLevel;
  const tankArrowWorldMargin = radarPixelsToWorldDistance(
    RADAR_TANK_ARROW_EXTENT_PX,
    radarDistance,
    radarWorldHalfExtent
  );
  const mapSize = gameConfig.MAP_SIZE || 100;
  // Player world position and heading
  const px = myTank.position.x;
  const py = myTank.position.y;
  const pz = myTank.position.z;
  const playerHeading = myTank.rotation ? myTank.rotation.y : 0;
  const toRadarRelative = (worldX, worldZ) => worldToRadarRelative(worldX, worldZ, px, pz, playerHeading);
  const radarToCanvas = (radarX, radarY) => radarRelativeToCanvas(
    radarX,
    radarY,
    center,
    radarWorldHalfExtent,
    radarDistance,
  );
  const getRadarObjectRotation = (worldRotation) => (-worldRotation) + playerHeading;
  const isOutsideRadarSquare = (radarX, radarY, margin = 0) => (
    Math.abs(radarX) > radarDistance + margin || Math.abs(radarY) > radarDistance + margin
  );
  // No radarRotation; use playerHeading directly
  // Clear radar
  radarCtx.clearRect(0, 0, size, size);

  // Draw world border (clip to radar distance area, rotated to player forward)
  if (gameConfig && gameConfig.MAP_SIZE) {
    radarCtx.save();
    radarCtx.globalAlpha = 0.7;
    // Calculate visible world border segment within radar distance
    const border = mapSize / 2;
    const left = Math.max(px - radarDistance, -border);
    const right = Math.min(px + radarDistance, border);
    const top = Math.max(pz - radarDistance, -border);
    const bottom = Math.min(pz + radarDistance, border);

    // Top edge (North, Z = -border)
    if (top === -border) {
      const p1 = world2Radar(left, -border, px, pz, playerHeading, center, radius, radarDistance);
      const p2 = world2Radar(right, -border, px, pz, playerHeading, center, radius, radarDistance);
      radarCtx.save();
      radarCtx.strokeStyle = '#B20000'; // North - red
      radarCtx.lineWidth = 2.5;
      radarCtx.setLineDash([6, 6]);
      radarCtx.lineDashOffset = left * 2; // Anchor dashes to world coordinates
      radarCtx.beginPath();
      radarCtx.moveTo(p1.x, p1.y);
      radarCtx.lineTo(p2.x, p2.y);
      radarCtx.stroke();
      radarCtx.restore();
    }
    // Bottom edge (South, Z = +border)
    if (bottom === border) {
      const p1 = world2Radar(left, border, px, pz, playerHeading, center, radius, radarDistance);
      const p2 = world2Radar(right, border, px, pz, playerHeading, center, radius, radarDistance);
      radarCtx.save();
      radarCtx.strokeStyle = '#1976D2'; // South - blue
      radarCtx.lineWidth = 2.5;
      radarCtx.setLineDash([6, 6]);
      radarCtx.lineDashOffset = left * 2; // Anchor dashes to world coordinates
      radarCtx.beginPath();
      radarCtx.moveTo(p1.x, p1.y);
      radarCtx.lineTo(p2.x, p2.y);
      radarCtx.stroke();
      radarCtx.restore();
    }
    // Left edge (West, X = -border)
    if (left === -border) {
      const p1 = world2Radar(-border, top, px, pz, playerHeading, center, radius, radarDistance);
      const p2 = world2Radar(-border, bottom, px, pz, playerHeading, center, radius, radarDistance);
      radarCtx.save();
      radarCtx.strokeStyle = '#9C27B0'; // West - purple
      radarCtx.lineWidth = 2.5;
      radarCtx.setLineDash([6, 6]);
      radarCtx.lineDashOffset = top * 2; // Anchor dashes to world coordinates
      radarCtx.beginPath();
      radarCtx.moveTo(p1.x, p1.y);
      radarCtx.lineTo(p2.x, p2.y);
      radarCtx.stroke();
      radarCtx.restore();
    }
    // Right edge (East, X = +border)
    if (right === border) {
      const p1 = world2Radar(border, top, px, pz, playerHeading, center, radius, radarDistance);
      const p2 = world2Radar(border, bottom, px, pz, playerHeading, center, radius, radarDistance);
      radarCtx.save();
      radarCtx.strokeStyle = '#388E3C'; // East - green
      radarCtx.lineWidth = 2.5;
      radarCtx.setLineDash([6, 6]);
      radarCtx.lineDashOffset = top * 2; // Anchor dashes to world coordinates
      radarCtx.beginPath();
      radarCtx.moveTo(p1.x, p1.y);
      radarCtx.lineTo(p2.x, p2.y);
      radarCtx.stroke();
      radarCtx.restore();
    }
    radarCtx.restore();
  }

  // Draw projectiles (shots) within radar distance
  if (typeof projectiles !== 'undefined' && projectiles.forEach) {
    projectiles.forEach((proj) => {
      const rel = toRadarRelative(proj.position.x, proj.position.z);
      if (isOutsideRadarSquare(rel.x, rel.y)) return;
      const pos = radarToCanvas(rel.x, rel.y);
      const shotRadarColor = proj.userData?.radarColor || '#FFD700';

      radarCtx.save();
      radarCtx.beginPath();
      radarCtx.arc(pos.x, pos.y, 4, 0, Math.PI * 2);
      radarCtx.fillStyle = shotRadarColor;
      radarCtx.globalAlpha = 0.85;
      radarCtx.shadowColor = shotRadarColor;
      radarCtx.shadowBlur = 6;
      radarCtx.fill();
      radarCtx.restore();
    });
  }

  // Draw radar background as a square, similar to BZFlag's panel-style radar.
  radarCtx.save();
  radarCtx.globalAlpha = 0.95;
  radarCtx.fillStyle = 'rgba(0,0,0,0.5)';
  radarCtx.fillRect(0, 0, size, size);
  radarCtx.strokeStyle = 'rgba(76, 175, 80, 0.65)';
  radarCtx.lineWidth = Math.max(2, Math.round(size * 0.01));
  radarCtx.strokeRect(0, 0, size, size);
  radarCtx.restore();

  // Draw cardinal direction letters (N/E/S/W) at border, facing outward, rotating with the map
  const cardinalLabels = [
    { angle: Math.PI / 2, label: 'N', color: '#B20000' },
    { angle: Math.PI, label: 'E', color: '#388E3C' },
    { angle: -Math.PI / 2, label: 'S', color: '#1976D2' },
    { angle: 0, label: 'W', color: '#9C27B0' },
  ];
  cardinalLabels.forEach(dir => {
    radarCtx.save();
    radarCtx.translate(center, center);
    // Rotate with the map/radar, so compass turns as player turns
    radarCtx.rotate(playerHeading - Math.PI / 2 + dir.angle);
    radarCtx.textAlign = 'center';
    radarCtx.textBaseline = 'middle';
    radarCtx.font = `bold ${Math.round(radius * 0.22)}px sans-serif`;
    radarCtx.fillStyle = dir.color;
    radarCtx.strokeStyle = '#222';
    radarCtx.lineWidth = 3;
    // Place letter on a slightly larger circle so cardinal letters clip at square edges.
    const labelRadius = radius + Math.max(2, Math.round(size * 0.015));
    radarCtx.save();
    radarCtx.translate(0, -labelRadius);
    // Keep letters upright (vertical) at top
    radarCtx.rotate(-playerHeading + Math.PI / 2 - dir.angle);
    radarCtx.strokeText(dir.label, 0, 0);
    radarCtx.fillText(dir.label, 0, 0);
    radarCtx.restore();
    radarCtx.restore();
  });

  // Draw obstacles within radar distance, rotated to match map orientation
  if (typeof OBSTACLES !== 'undefined' && Array.isArray(OBSTACLES)) {
    OBSTACLES.forEach(obs => {
      const obsWidth = obs.w || 8;
      const obsDepth = obs.d || 8;

      const halfW = obsWidth / 2;
      const halfD = obsDepth / 2;
      const centerRel = toRadarRelative(obs.x, obs.z);
      const obstacleRadarRotation = getRadarObjectRotation(obs.rotation || 0);
      const cosR = Math.cos(obstacleRadarRotation);
      const sinR = Math.sin(obstacleRadarRotation);
      const corners = [
        { x: -halfW, z: -halfD },
        { x: halfW, z: -halfD },
        { x: halfW, z: halfD },
        { x: -halfW, z: halfD },
      ];

      const radarPolygon = corners.map((corner) => {
        const rotatedX = corner.x * cosR - corner.z * sinR;
        const rotatedY = corner.x * sinR + corner.z * cosR;
        return {
          x: centerRel.x + rotatedX,
          y: centerRel.y + rotatedY,
        };
      });

      const clippedPolygon = clipPolygonToRadarSquare(radarPolygon, radarDistance);
      if (clippedPolygon.length < 3) return;

      // Calculate opacity based on player's vertical position relative to obstacle
      const baseY = obs.baseY || 0;
      const height = obs.h || 4;
      const opacity = getRadarOpacity(py, baseY, height);

      radarCtx.save();
      radarCtx.globalAlpha = opacity;
      radarCtx.fillStyle = getObstacleRadarFillStyle(obs);
      radarCtx.beginPath();
      clippedPolygon.forEach((point, index) => {
        const panel = radarToCanvas(point.x, point.y);
        const drawX = panel.x;
        const drawY = panel.y;
        if (index === 0) {
          radarCtx.moveTo(drawX, drawY);
        } else {
          radarCtx.lineTo(drawX, drawY);
        }
      });
      radarCtx.closePath();
      radarCtx.fill();
      radarCtx.restore();
    });
  }

  // Draw tanks within radar distance, or as edge dots if beyond
  tanks.forEach((tank, playerId) => {
    if (!tank.position) return;
    // Only show on radar if alive and visible
    const state = tank.userData && tank.userData.playerState;
    if ((state && state.health <= 0) || tank.visible === false) return;

    // Get player color (convert from hex number to CSS string)
    let playerColor = '#4CAF50'; // Default green
    if (state && typeof state.color === 'number') {
      playerColor = '#' + state.color.toString(16).padStart(6, '0');
    }

    const rel = toRadarRelative(tank.position.x, tank.position.z);
    const rotX = rel.x;
    const rotY = rel.y;
    const tankOutsideRadarSquare = isOutsideRadarSquare(rotX, rotY, tankArrowWorldMargin);
    const pos = radarToCanvas(rel.x, rel.y);

    if (tankOutsideRadarSquare) {
      // Tank is outside radar range - draw as small dot against square edge.
      // Calculate direction in radar space (same rotation as world2Radar).
      // Project onto the radar square border (preserve direction and avoid mirroring).
      const len = Math.hypot(rotX, rotY);
      if (len < 1e-6) return;
      const nx = rotX / len;
      const ny = rotY / len;
      const halfExtent = Math.max(1, (size / 2) - RADAR_EDGE_DOT_INSET_PX);
      const denom = Math.max(Math.abs(nx), Math.abs(ny), 1e-6);
      const edgeX = center + (nx / denom) * halfExtent;
      const edgeY = center + (ny / denom) * halfExtent;

      radarCtx.save();
      radarCtx.beginPath();
      radarCtx.arc(edgeX, edgeY, 3, 0, Math.PI * 2);
      radarCtx.fillStyle = playerColor;
      radarCtx.globalAlpha = 0.8;
      radarCtx.fill();
      radarCtx.restore();
      return;
    }

    radarCtx.save();
    radarCtx.translate(pos.x, pos.y);
    if (playerId === myPlayerId) {
      // Player tank: always point up (no rotation needed)
      radarCtx.beginPath();
      radarCtx.moveTo(0, -10);
      radarCtx.lineTo(-6, 8);
      radarCtx.lineTo(6, 8);
      radarCtx.closePath();
      radarCtx.fillStyle = playerColor;
      radarCtx.globalAlpha = 1;
      radarCtx.fill();
    } else {
      // Other tanks: mirror rotation so heading 0 (north) points up, π/2 (west) points left
      radarCtx.rotate(-(tank.rotation ? tank.rotation.y : 0) + playerHeading);
      radarCtx.beginPath();
      radarCtx.moveTo(0, -10);
      radarCtx.lineTo(-6, 8);
      radarCtx.lineTo(6, 8);
      radarCtx.closePath();
      radarCtx.fillStyle = playerColor;
      radarCtx.globalAlpha = 0.95;
      radarCtx.fill();
    }
    radarCtx.restore();
  });
}

let lastTime = performance.now();
const MAX_FRAME_DELTA_SECONDS = 0.1;

function setXRButtonState(enabled) {
  const xrBtn = document.getElementById('xrBtn');
  const xrQuickBtn = document.getElementById('xrQuickBtn');
  if (enabled) {
    if (xrBtn) { xrBtn.classList.add('active'); xrBtn.title = 'Exit WebXR VR Mode'; }
    if (xrQuickBtn) { xrQuickBtn.classList.add('active'); xrQuickBtn.title = 'Exit WebXR VR Mode'; }
  } else {
    if (xrBtn) { xrBtn.classList.remove('active'); xrBtn.title = 'Enter WebXR VR Mode'; }
    if (xrQuickBtn) { xrQuickBtn.classList.remove('active'); xrQuickBtn.title = 'Enter WebXR VR Mode'; }
  }
}

function closeXRSettingsMenu() {
  if (!xrSettingsMenuOpen) return;
  xrSettingsMenuOpen = false;
  xrSettingsMenuRenderer?.hide();
  syncInputContextFromUi();
}

function setXRSettingsMenuScreen(screen) {
  xrSettingsMenuScreen = screen;
  xrSettingsMenuSelectedIndex = 0;
  xrSettingsMenuNavigationDirection = 0;
  xrSettingsMenuNextRepeatAt = 0;
  if (screen === 'operator') {
    sendToServer({ type: 'getMaps', requestId: Math.floor(Math.random() * 1e9) });
  }
}

function toggleXRSettingsMenu() {
  if (xrSettingsMenuOpen) {
    closeXRSettingsMenu();
    return;
  }
  xrSettingsMenuOpen = true;
  setXRSettingsMenuScreen('settings');
  xrSettingsMenuActivateLatched = true;
  xrSettingsMenuBackLatched = true;
  setInputContext(INPUT_CONTEXT.DIALOG);
}

const XR_HELP_ITEMS = Object.freeze([
  { id: 'helpMove', label: 'Move', value: 'Either stick Up / Down', disabled: true },
  { id: 'helpTurn', label: 'Turn', value: 'Either stick Left / Right', disabled: true },
  { id: 'helpFire', label: 'Fire', value: 'Either trigger / primary', disabled: true },
  { id: 'helpJump', label: 'Jump', value: 'Either grip / secondary', disabled: true },
  { id: 'helpMenu', label: 'Open Menu', value: 'Press either stick', disabled: true },
  { id: 'helpNavigate', label: 'Navigate', value: 'Either stick', disabled: true },
  { id: 'helpActivate', label: 'Activate', value: 'Trigger / primary', disabled: true },
  { id: 'helpBack', label: 'Back', value: 'Grip / secondary', disabled: true },
  { id: 'backXR', label: 'Back', value: '' },
]);

// Name, team, and tank are what the 2D entry dialog asks for, so before the
// player has joined this screen stands in for it and the menu opens here.
function getXRPlayerOptionsMenuItems() {
  const tankModel = getTankModelById(selectedTankModelId) || getDefaultTankModel();
  const keyboard = isSystemKeyboardSupported();
  return [
    {
      id: 'nameXR',
      label: 'Name',
      value: keyboard ? myPlayerName : 'Desktop only',
      disabled: !keyboard,
    },
    { id: 'teamXR', label: 'Team', value: PLAYER_TEAM_LABELS[selectedPlayerTeam], adjustable: true },
    { id: 'tankXR', label: 'Tank', value: tankModel.label || tankModel.id, adjustable: true },
    { id: 'rejoinXR', label: gameplayJoinConfirmed ? 'Apply & Rejoin' : 'Join', value: '' },
    { id: 'backXR', label: 'Back', value: '' },
  ];
}

// The headset keyboard opens a fresh editing session every time, so the first
// key replaces the whole field: the current value is a prompt to retype, not
// something the player can edit in place. Text comes back through the field's
// value, since the keyboard sends no key events of its own.
function beginXRTextEntry(value, commit) {
  const input = document.getElementById('xrTextInput');
  if (!input || !isSystemKeyboardSupported()) return;
  input.value = value;
  input.addEventListener('blur', () => {
    const typed = input.value.trim();
    input.value = '';
    if (typed) commit(typed);
  }, { once: true });
  input.focus();
}

function getXRVoiceMenuItems() {
  const state = getVoiceState();
  const observer = isObserverTeam(playerTeam);
  const input = document.getElementById('voiceInputDevice');
  const selectedInput = input?.selectedOptions?.[0]?.textContent || 'Default microphone';
  return [
    {
      id: 'voicePermissionXR',
      label: 'Permission',
      value: state.microphonePermission || 'Prompt',
      disabled: observer || state.microphonePermission === 'granted',
    },
    {
      id: 'voiceMicrophoneXR',
      label: 'Microphone',
      value: state.transmitting ? 'On' : 'Off',
      disabled: observer || (state.microphonePermission !== 'granted' && !state.hasLocalStream),
    },
    { id: 'voiceInputXR', label: 'Input', value: selectedInput, adjustable: true, disabled: observer },
    { id: 'voiceEchoXR', label: 'Echo Cancellation', value: getVoiceAudioSettings().echoCancellation ? 'On' : 'Off' },
    { id: 'voiceNoiseXR', label: 'Noise Suppression', value: getVoiceAudioSettings().noiseSuppression ? 'On' : 'Off' },
    { id: 'voiceGainXR', label: 'Auto Gain', value: getVoiceAudioSettings().autoGainControl ? 'On' : 'Off' },
    { id: 'backXR', label: 'Back', value: '' },
  ];
}

function getXROperatorMenuItems() {
  const mapList = document.getElementById('mapList');
  const shotInput = document.getElementById('shotMaxActiveInput');
  const currentMap = mapList?.selectedOptions?.[0]?.textContent || 'Loading...';
  const keyboard = isSystemKeyboardSupported();
  return [
    {
      id: 'operatorMotdXR',
      label: 'MOTD',
      value: keyboard ? (serverMotdText || '(empty)') : 'Desktop only',
      disabled: !keyboard,
    },
    { id: 'operatorMapXR', label: 'Map', value: currentMap, adjustable: true, disabled: !mapList?.options?.length },
    { id: 'operatorRestartXR', label: 'Restart with Map', value: '', disabled: !mapList?.value },
    { id: 'operatorShotsXR', label: 'Shot Limit', value: shotInput?.value || String(gameConfig?.SHOT_MAX_ACTIVE || 5), adjustable: true },
    { id: 'operatorApplyShotsXR', label: 'Apply Shot Limit', value: '' },
    { id: 'operatorRefreshXR', label: 'Refresh Server Data', value: '' },
    { id: 'operatorDesktopXR', label: 'Upload Map', value: 'Desktop only', disabled: true },
    { id: 'backXR', label: 'Back', value: '' },
  ];
}

function getXRSettingsMenuDefinition() {
  if (xrSettingsMenuScreen === 'player') {
    return {
      title: gameplayJoinConfirmed ? 'Player Options' : 'Join Game',
      items: getXRPlayerOptionsMenuItems(),
    };
  }
  if (xrSettingsMenuScreen === 'help') return { title: 'Help', items: XR_HELP_ITEMS };
  if (xrSettingsMenuScreen === 'voice') return { title: 'Voice', items: getXRVoiceMenuItems() };
  if (xrSettingsMenuScreen === 'operator') return { title: 'Operator', items: getXROperatorMenuItems() };
  return { title: 'Settings', items: getXRSettingsMenuItems() };
}

function cycleSelectElement(select, direction) {
  if (!select || select.options.length < 1) return false;
  const nextIndex = (select.selectedIndex + direction + select.options.length) % select.options.length;
  select.selectedIndex = nextIndex;
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  return true;
}

function adjustXRSettingsMenuItem(item, direction) {
  if (!item || item.disabled) return false;
  if (item.id === 'teamXR') {
    selectRelativePlayerTeam(direction, { allowJoined: true });
    return true;
  }
  if (item.id === 'tankXR') {
    cycleTankModel(direction);
    return true;
  }
  if (item.id === 'voiceInputXR') {
    return cycleSelectElement(document.getElementById('voiceInputDevice'), direction);
  }
  if (item.id === 'operatorMapXR') {
    return cycleSelectElement(document.getElementById('mapList'), direction);
  }
  if (item.id === 'operatorShotsXR') {
    const input = document.getElementById('shotMaxActiveInput');
    if (!input) return false;
    input.value = String(Math.max(1, Math.min(10, Number(input.value || 5) + direction)));
    return true;
  }
  return false;
}

function getDisplayMode() {
  const modes = ['fullscreen', 'standalone', 'minimal-ui', 'browser'];
  return modes.find((mode) => window.matchMedia(`(display-mode: ${mode})`).matches) || 'unknown';
}

// Opened in place of the 2D entry dialog, which a headset player cannot see.
function openXRJoinMenu() {
  if (!xrSettingsMenuOpen) toggleXRSettingsMenu();
  setXRSettingsMenuScreen('player');
}

function applyXRJoinSelection() {
  // The 2D dialog is open if the player entered XR from it, and it holds the
  // game paused until it closes.
  if (isEntryDialogOpen()) toggleEntryDialog();
  gameplayJoinConfirmed = false;
  updatePlayerTeamSelectorAvailability();
  sendToServer({
    type: 'joinGame',
    name: myPlayerName,
    isMobile,
    tankModel: selectedTankModelId,
    team: getSelectedPlayerTeam(),
  });
  closeXRSettingsMenu();
}

function activateXRSettingsMenuSelection(item) {
  if (!item || item.disabled) return;
  if (item.adjustable) {
    adjustXRSettingsMenuItem(item, 1);
    return;
  }
  if (item.id === 'exitXR') void exitXRFromMenu();
  else if (item.id === 'closeXRMenu') closeXRSettingsMenu();
  else if (item.id === 'backXR') setXRSettingsMenuScreen('settings');
  else if (item.id === 'playerOptionsBtn') setXRSettingsMenuScreen('player');
  else if (item.id === 'helpBtn') setXRSettingsMenuScreen('help');
  else if (item.id === 'voiceBtn') setXRSettingsMenuScreen('voice');
  else if (item.id === 'operatorBtn') setXRSettingsMenuScreen('operator');
  else if (item.id === 'rejoinXR') applyXRJoinSelection();
  else if (item.id === 'nameXR') beginXRTextEntry(myPlayerName, savePlayerName);
  else if (item.id === 'voicePermissionXR') requestVoicePermission();
  else if (item.id === 'voiceMicrophoneXR') toggleVoiceMicrophone();
  else if (item.id === 'voiceEchoXR') document.getElementById('voiceEchoCancellation')?.click();
  else if (item.id === 'voiceNoiseXR') document.getElementById('voiceNoiseSuppression')?.click();
  else if (item.id === 'voiceGainXR') document.getElementById('voiceAutoGainControl')?.click();
  else if (item.id === 'operatorMotdXR') {
    beginXRTextEntry(serverMotdText, (typed) => {
      const motdInput = document.getElementById('motdInput');
      if (!motdInput) return;
      motdInput.value = typed;
      document.getElementById('setMotdBtn')?.click();
    });
  }
  else if (item.id === 'operatorRestartXR') document.getElementById('restartBtn')?.click();
  else if (item.id === 'operatorApplyShotsXR') document.getElementById('setShotMaxActiveBtn')?.click();
  else if (item.id === 'operatorRefreshXR') setXRSettingsMenuScreen('operator');
  else activateXRSettingsMenuItem(item.id);
}

async function exitXRFromMenu() {
  if (xrSettingsShortcutInFlight) return;
  xrSettingsShortcutInFlight = true;
  try {
    const renderer = renderManager.getRenderer();
    if (!renderer) return;

    closeXRSettingsMenu();
    await toggleXRSession(renderer, animate);
    setXRButtonState(false);
    showMessage('WebXR VR Mode: OFF');
  } finally {
    xrSettingsShortcutInFlight = false;
  }
}

function handleXRSettingsMenuInput(now = performance.now()) {
  if (!isXREnabled()) {
    closeXRSettingsMenu();
    xrSettingsShortcutLatched = false;
    return;
  }

  const xrInput = getXRControllerInput();
  const pressed = Boolean(xrInput.leftThumbstickPressed || xrInput.rightThumbstickPressed);
  if (pressed && !xrSettingsShortcutLatched) {
    xrSettingsShortcutLatched = true;
    toggleXRSettingsMenu();
  } else if (!pressed) {
    xrSettingsShortcutLatched = false;
  }

  if (!xrSettingsMenuOpen) return;

  const { items } = getXRSettingsMenuDefinition();
  xrSettingsMenuSelectedIndex = Math.min(xrSettingsMenuSelectedIndex, Math.max(0, items.length - 1));
  const leftX = xrInput.leftThumbstick?.x || 0;
  const leftY = xrInput.leftThumbstick?.y || 0;
  const rightX = xrInput.rightThumbstick?.x || 0;
  const rightY = xrInput.rightThumbstick?.y || 0;
  const navigationX = Math.abs(rightX) >= Math.abs(leftX) ? rightX : leftX;
  const navigationY = Math.abs(rightY) >= Math.abs(leftY) ? rightY : leftY;
  const useHorizontal = Math.abs(navigationX) > Math.abs(navigationY);
  const dominantAxis = useHorizontal ? navigationX : navigationY;
  const direction = dominantAxis > 0.6 ? 1 : dominantAxis < -0.6 ? -1 : 0;
  const navigationToken = direction === 0 ? '' : `${useHorizontal ? 'horizontal' : 'vertical'}:${direction}`;

  if (direction === 0) {
    xrSettingsMenuNavigationDirection = 0;
    xrSettingsMenuNextRepeatAt = 0;
  } else if (navigationToken !== xrSettingsMenuNavigationDirection || now >= xrSettingsMenuNextRepeatAt) {
    const selectedItem = items[xrSettingsMenuSelectedIndex];
    if (!useHorizontal || !adjustXRSettingsMenuItem(selectedItem, direction)) {
      xrSettingsMenuSelectedIndex = (
        xrSettingsMenuSelectedIndex + direction + items.length
      ) % items.length;
    }
    xrSettingsMenuNavigationDirection = navigationToken;
    xrSettingsMenuNextRepeatAt = now + 250;
  }

  const activatePressed = xrInput.leftTrigger > 0.5 || xrInput.rightTrigger > 0.5 || xrInput.buttonA;
  if (activatePressed && !xrSettingsMenuActivateLatched) {
    const selectedItem = items[xrSettingsMenuSelectedIndex];
    activateXRSettingsMenuSelection(selectedItem);
  }
  xrSettingsMenuActivateLatched = activatePressed;

  const backPressed = xrInput.buttonB || xrInput.buttonGrip;
  if (backPressed && !xrSettingsMenuBackLatched) {
    if (xrSettingsMenuScreen === 'settings') closeXRSettingsMenu();
    else setXRSettingsMenuScreen('settings');
  }
  xrSettingsMenuBackLatched = backPressed;
}

function ensureXRSettingsMenu() {
  if (!xrSettingsMenuRenderer) {
    xrSettingsMenuRenderer = new XRMenuRenderer();
  }
  const definition = getXRSettingsMenuDefinition();
  xrSettingsMenuRenderer.update(renderManager.getCamera(), {
    visible: isXREnabled() && xrSettingsMenuOpen,
    title: definition.title,
    items: definition.items,
    selectedIndex: xrSettingsMenuSelectedIndex,
  });
}

function updateChatWindow() {
  if (!chatWindowDirty) return;
  normalizeActiveChatTab();
  const chatTabsDiv = document.getElementById('chatTabs');
  const chatMessagesDiv = document.getElementById('chatMessages');
  if (!chatMessagesDiv) return;

  if (chatTabsDiv) {
    chatTabsDiv.innerHTML = '';
    const visibleTabs = getVisibleChatTabs();
    visibleTabs.forEach((tab) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chat-tab';
      if (tab.id === chatState.activeTab) {
        btn.classList.add('active');
      } else if (chatState.unread[tab.id]) {
        btn.classList.add('unread');
      }
      btn.setAttribute('data-chat-tab', tab.id);
      btn.textContent = tab.label;
      chatTabsDiv.appendChild(btn);
    });
  }

  chatMessagesDiv.innerHTML = '';

  const activeMessages = chatState.messages[chatState.activeTab] || [];
  const offset = chatState.scrollOffsets[chatState.activeTab] || 0;
  const end = Math.max(0, activeMessages.length - offset);
  const start = Math.max(0, end - CHAT_VISIBLE_MESSAGES);
  for (let i = start; i < end; i++) {
    const msg = activeMessages[i];
    const div = document.createElement('div');
    div.className = `chat-line chat-kind-${msg.kind || CHAT_KIND_CHAT}`;
    div.textContent = msg.text;
    chatMessagesDiv.appendChild(div);
  }

  chatWindowDirty = false;
}

/**
 * Extrapolate a player's position based on their last known state and elapsed time.
 * @param {Object} player - Player object with position, rotation, and movement state
 * @param {number} dt - Time elapsed since last server update (seconds)
 * @returns {{x: number, y: number, z: number, r: number}} Extrapolated position and rotation
 */
function extrapolatePosition(player, dt) {
  if (!player || !gameConfig) return player;

  const {
    x, y, z, r, forwardSpeed, rotationSpeed, verticalVelocity,
    jumpDirection, slideDirection, airVelocityX, airVelocityZ
  } = player;

  // Apply rotation
  const rotSpeed = gameConfig.TANK_ROTATION_SPEED || 1.5;
  const newR = r + (rotationSpeed || 0) * rotSpeed * dt;

  // Determine if player is in air based on jumpDirection
  const isInAir = jumpDirection !== null && jumpDirection !== undefined;

  if (isInAir) {
    const hasAirVelocity = Number.isFinite(airVelocityX) && Number.isFinite(airVelocityZ);
    const speed = gameConfig.TANK_SPEED || 15;
    const moveDirection = slideDirection !== undefined ? slideDirection : jumpDirection;
    const dx = hasAirVelocity ? airVelocityX * dt : -Math.sin(moveDirection) * (forwardSpeed || 0) * speed * dt;
    const dz = hasAirVelocity ? airVelocityZ * dt : -Math.cos(moveDirection) * (forwardSpeed || 0) * speed * dt;

    // Apply gravity to vertical velocity
    const gravity = gameConfig.GRAVITY || 9.8;
    const vv = (verticalVelocity || 0) - gravity * dt;
    const dy = ((verticalVelocity || 0) + vv) / 2 * dt; // Average velocity over dt

    return {
      x: x + dx,
      y: Math.max(0, y + dy), // Don't go below ground
      z: z + dz,
      r: newR
    };
  } else {
    // On ground: circular arc or straight line
    const speed = gameConfig.TANK_SPEED || 15;
    const rs = rotationSpeed || 0;
    const fs = forwardSpeed || 0;

    // Use slide direction if present, otherwise use rotation
    const moveDirection = slideDirection !== undefined ? slideDirection : r;

    if (Math.abs(rs) < 0.001) {
      // Straight line motion (or sliding)
      const dx = -Math.sin(moveDirection) * fs * speed * dt;
      const dz = -Math.cos(moveDirection) * fs * speed * dt;
      return { x: x + dx, y: y, z: z + dz, r: newR };
    } else {
      // Circular arc motion
      // Radius of curvature: R = |linear_velocity / angular_velocity|
      // linear_velocity = fs * speed
      // angular_velocity = rs * rotSpeed
      const R = Math.abs((fs * speed) / (rs * rotSpeed));

      // Arc angle traveled - this is also the rotation change!
      const theta = rs * rotSpeed * dt;

      // Center of circle in world space
      // Forward is (-sin(r), -cos(r)), perpendicular at r - π/2
      const perpAngle = r - Math.PI / 2;
      const centerSign = -(rs * fs); // Negated to match correct circular motion
      const cx = x + Math.sign(centerSign) * R * (-Math.sin(perpAngle));
      const cz = z + Math.sign(centerSign) * R * (-Math.cos(perpAngle));

      // New position rotated around center
      // Negate theta for clockwise rotation (rs > 0 means turn right = clockwise)
      const dx = x - cx;
      const dz = z - cz;
      const cosTheta = Math.cos(-theta);
      const sinTheta = Math.sin(-theta);
      const newDx = dx * cosTheta - dz * sinTheta;
      const newDz = dx * sinTheta + dz * cosTheta;

      return {
        x: cx + newDx,
        y: y,
        z: cz + newDz,
        r: r + theta  // Use theta directly - tank rotation matches arc traveled
      };
    }
  }
}

function runFallbackAnimationLoop(frameTime) {
  animate(frameTime);
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(runFallbackAnimationLoop);
  }
}

// The frame's own timestamp, not the clock reading from whenever this callback
// got scheduled. Three passes the animation frame's timestamp straight through
// -- rAF's, and in an XR session the frame's predicted display time -- and those
// land on the display's cadence, while `performance.now()` here also carries
// however long the main thread took to reach this call. Measured on this client,
// frame timestamps sit 0.05ms off the vsync grid and a `performance.now()`
// reading sits 3.8ms off it. Spending that noise as movement makes every step
// slightly too long or too short, which reads as the ground jittering -- worst
// at low speed, where the eye tracks the motion and expects it to be even.
function animate(frameTime) {
  framePhaseMark = performance.now();
  selectedFaceDebugTouchedThisFrame = false;
  supportSurfaceDebugTouchedThisFrame = false;
  supportFootprintDebugTouchedThisFrame = false;
  const now = Number.isFinite(frameTime) ? frameTime : performance.now();
  // A hidden tab stops delivering frames, so the first one back would otherwise
  // spend the whole gap at once and throw the tank across the map.
  const deltaTime = Math.max(0, Math.min((now - lastTime) / 1000, MAX_FRAME_DELTA_SECONDS));
  lastTime = now;

  // Advance worldTime so 24000 ticks = 20 minutes (1200 seconds)
  // 24000 / 1200 = 20 ticks per second
  worldTime = (worldTime + 20 * deltaTime) % 24000;
  renderManager.setWorldTime(worldTime);

  updateXRControllerInput();
  handleXRSettingsMenuInput(now);
  updateXRHudOverlays();

  // Debug: log game state in XR once on entry
  if (isXREnabled() && !window.xrDebugLogged) {
    window.xrDebugLogged = true;
    debugLog(`[Game] XR entered, myTank: ${myTank ? `(${myTank.position.x.toFixed(1)}, ${myTank.position.y.toFixed(1)}, ${myTank.position.z.toFixed(1)})` : 'NULL'}, tanks: ${tanks.size}`);
  }
  if (!isXREnabled()) {
    window.xrDebugLogged = false;
  }
  markFramePhase('xr');

  updateFps();
  updateChatWindow();
  updateAltimeter({ myTank });
  updateDegreeBar({ myTank, playerRotation });
  updateShotStatus({ myPlayerId, myTank, projectiles, gameConfig, now: Date.now() });
  markFramePhase('hud');

  handleInputEvents();
  handleMotion(deltaTime);
  markFramePhase('input');

  const visibleTanks = [];
  tanks.forEach((tank) => {
    if (tank && tank.visible !== false) {
      visibleTanks.push(tank);
    }
  });
  renderManager.updateProjectedShadows(visibleTanks);
  markFramePhase('shadows');

  if (!selectedFaceDebugTouchedThisFrame) {
    hideSelectedFaceDebug();
  }
  if (!supportSurfaceDebugTouchedThisFrame) {
    hideSupportSurfaceDebug();
  }
  if (!supportFootprintDebugTouchedThisFrame) {
    hideSupportFootprintDebug();
  }

  // Extrapolate other players' positions
  if (gameConfig) {
    tanks.forEach((tank, playerId) => {
      if (playerId === myPlayerId) return; // Skip local player
      if (!tank.userData || !tank.userData.serverPosition) return;

      const lastUpdate = tank.userData.lastUpdateTime || now;
      const timeSinceUpdate = (now - lastUpdate) / 1000; // Convert to seconds
      const remoteFS = tank.userData.forwardSpeed;
      const remoteRS = tank.userData.rotationSpeed;
      const remoteVV = tank.userData.verticalVelocity;
      const remoteJumpDirection = tank.userData.jumpDirection;
      const remoteAirVx = tank.userData.airVelocityX;
      const remoteAirVz = tank.userData.airVelocityZ;
      const remoteAirborne = remoteJumpDirection !== null && remoteJumpDirection !== undefined;
      const remoteStopped =
        !remoteAirborne &&
        remoteFS === 0 &&
        remoteRS === 0 &&
        remoteVV === 0 &&
        remoteAirVx === 0 &&
        remoteAirVz === 0;
      const clampedTimeSinceUpdate = remoteStopped
        ? Math.max(0, Math.min(timeSinceUpdate, MAX_REMOTE_EXTRAPOLATION_STOP_SECONDS))
        : Math.max(0, timeSinceUpdate);

      // Extrapolate position from last server-confirmed state
      const extrapolated = extrapolatePosition({
        x: tank.userData.serverPosition.x,
        y: tank.userData.serverPosition.y,
        z: tank.userData.serverPosition.z,
        r: tank.userData.serverPosition.r,
        forwardSpeed: remoteFS,
        rotationSpeed: remoteRS,
        verticalVelocity: remoteVV,
        jumpDirection: remoteJumpDirection,
        slideDirection: tank.userData.slideDirection,
        airVelocityX: remoteAirVx,
        airVelocityZ: remoteAirVz
      }, clampedTimeSinceUpdate);

      // Update tank's rendered position smoothly
      if (extrapolated) {
        tank.position.x = extrapolated.x;
        tank.position.y = extrapolated.y;
        tank.position.z = extrapolated.z;
        tank.rotation.y = extrapolated.r;
      }
    });
  }

  updateProjectiles(deltaTime);
  updateTankDimensions(deltaTime);
  renderManager.updateExplosions(deltaTime);
  updateShields();
  renderManager.updateTreads(tanks, deltaTime, gameConfig);
  renderManager.updateMuzzleFlashes(deltaTime);
  renderManager.updateShotTeleportEffects(deltaTime);
  renderManager.updateJumpJets(tanks, deltaTime, gameConfig);
  if (gameConfig) {
    renderManager.updateClouds(deltaTime, gameConfig.MAP_SIZE || 100);
  }
  if (deathFollowTarget && !deathFollowTarget.parent) {
    deathFollowTarget = null;
    renderManager.deathFollowTarget = null;
  }
  updateDeathCameraHudVisibility();
  renderManager.updateCamera({ cameraMode, myTank, playerRotation, deathFollowTarget });
  markFramePhase('sim');
  updateRadar();
  markFramePhase('radar');

  renderManager.renderFrame();
  markFramePhase('render');
  rollFramePhases();
}

// Start the game
init();
