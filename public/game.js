/*
 * This file is part of a project licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * See the LICENSE file in the project root or visit https://www.gnu.org/licenses/agpl-3.0.html
 */
let chatMessages = [];
const CHAT_MAX_MESSAGES = 6;
let chatInput = null;
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
  hideHelpPanel,
  isMobile,
  updateVirtualInputFromXR,
  updateVirtualInputFromGamepad,
  isGamepadConnected,
  getGamepadInfo
} from './input.js';
import {
  updateDebugDisplay,
  updateHudButtons,
  toggleDebugHud,
  toggleDebugLabels,
  updateScoreboard,
  updateAltimeter,
  updateDegreeBar
} from './hud.js';
import { renderManager } from './render.js';
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { initXR, toggleXRSession, updateXRControllerInput, setNormalAnimationLoop, isXREnabled } from './webxr.js';

// FPS
let fps = 0;
let frameCount = 0;
let lastFpsUpdate = performance.now();

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
let ws = null;
let gameConfig = null;
let radarCanvas, radarCtx;
const pendingDebugPackets = [];

function isDebugHudVisible() {
  const debugHud = document.getElementById('debugHud');
  if (!debugHud) return false;
  if (debugHud.style.display === 'none') return false;
  const computed = window.getComputedStyle(debugHud);
  return computed.display !== 'none' && computed.visibility !== 'hidden';
}

function queueDebugPacket(payload) {
  pendingDebugPackets.push(payload);
  if (pendingDebugPackets.length > 120) {
    pendingDebugPackets.shift();
  }
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
  if (!isDebugHudVisible()) {
    return;
  }
  const text = source ? `[${source}] ${String(message)}` : String(message);
  const chatText = `[DBG] ${text}`;
  chatMessages.push(chatText);
  if (chatMessages.length > CHAT_MAX_MESSAGES * 3) {
    chatMessages.shift();
  }
  chatWindowDirty = true;
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
let lastShotTime = 0;

// Entry Dialog
function toggleEntryDialog(name = '') {
  const entryDialog = document.getElementById('entryDialog');
  const entryInput = document.getElementById('entryInput');
  if (!entryDialog || !entryInput) return;
  const entryDialogWillOpen = entryDialog.style.display !== 'block';
  entryDialog.style.display = entryDialogWillOpen ? 'block' : 'none';
  if (entryDialogWillOpen) {
    startTankPreviewAnimation();
  } else {
    stopTankPreviewAnimation();
  }
  isPaused = entryDialogWillOpen;
  if (entryDialogWillOpen) {
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

// Camera mode
let cameraMode = 'first-person'; // 'first-person', 'third-person', or 'overview'
let lastCameraMode = 'first-person';
let entryDialogReturnCameraMode = 'first-person';

// Pause state
let isPaused = false;
let pauseCountdownStart = 0;
let playerShields = new Map(); // Map of playerId to shield mesh
let deathFollowTarget = null;

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

let TANK_MODELS = [
  { id: 'default', path: '/obj/default.obj' },
  { id: 'simple', path: '/obj/simple.obj' },
  { id: 'bzflag-tank', path: '/obj/bzflag-tank.obj', label: 'Bzflag Tank' },
];
let selectedTankModelId = localStorage.getItem('tankModelId') || 'default';
let tankPreviewCard = null;
const tankPreviewModelCache = new Map();
let tankPreviewLoader = null;
let tankPreviewAnimating = false;
let tankPreviewRafId = null;

function getDefaultTankModel() {
  if (!Array.isArray(TANK_MODELS) || TANK_MODELS.length === 0) {
    return { id: 'default', path: '/obj/default.obj', label: 'Default' };
  }
  return TANK_MODELS.find((model) => model.id === 'default') || TANK_MODELS[0];
}

function getTankModelById(modelId) {
  const normalized = typeof modelId === 'string' ? modelId.trim().toLowerCase() : '';
  return TANK_MODELS.find((model) => model.id === normalized) || null;
}

function normalizeTankModelId(modelId) {
  let normalized = typeof modelId === 'string' ? modelId.trim().toLowerCase() : '';
  if (normalized === 'bzflag') normalized = 'bzflag-tank';
  const selected = getTankModelById(normalized);
  return selected ? selected.id : getDefaultTankModel().id;
}

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
      .sort((left, right) => left.id.localeCompare(right.id));

    if (models.length > 0) {
      TANK_MODELS = models;
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
const BOX_SLIDE_EPSILON = 0.01;
const BOX_SLIDE_AXIS_EPSILON = 1e-5;
const BOX_SLIDE_TIE_EPSILON = 1e-4;
const BOX_SLIDE_MAX_CHAIN_DEPTH = 1;
const BOX_SLIDE_MIN_RATIO = 0.15;
const CLIMBABLE_SURFACE_NORMAL_Y = 0.7;
const MAX_BUMP_HEIGHT = 0.165;
const ONTOP_TOLERANCE = 0.1;
const SUPPORT_SNAP_DOWN = 0.2;
const SUPPORT_ACQUIRE_MARGIN = 0.05;
const SUPPORT_RETAIN_MARGIN = 2;
const CORNER_STICK_MIN_INTENT = 0.2;
const CORNER_STICK_MAX_PROGRESS = 0.08;
const CORNER_STICK_FRAMES = 3;
const CORNER_ESCAPE_DISTANCE = 0.2;
const JUMP_PATH_MAX_TIME = 4.0;
const JUMP_PATH_STEP_TIME = 0.12;
const JUMP_PATH_POINT_COUNT = 24;

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
let showDebugGeometry = (() => {
  const saved = localStorage.getItem('showDebugGeometry');
  if (saved !== null) return saved === 'true';
  return localStorage.getItem('showGhosts') === 'true';
})(); // Toggle for ghost meshes and debug geometry

// Debug tracking
let debugEnabled = false;
let debugLabelsEnabled = false;
// Restore debugLabelsEnabled from localStorage if present
const savedDebugLabels = localStorage.getItem('debugLabelsEnabled');
if (savedDebugLabels !== null) {
  debugLabelsEnabled = savedDebugLabels === 'true';
}
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
  const gravity = gameConfig.GRAVITY || 30;
  let landed = false;
  let landingPoint = null;

  for (let step = 0; step <= maxSteps && points.length < JUMP_PATH_POINT_COUNT; step += 1) {
    const t = step * stepTime;
    const pos = extrapolatePosition(state, t);
    const vvAtT = (state.verticalVelocity || 0) - gravity * t;
    let pointY = pos.y;
    let landedType = null;

    if (pos.y <= 0) {
      pointY = 0;
      landed = true;
      landedType = 'ground';
    } else if (vvAtT <= 0) {
      const support = findSupportSurface(pos.x, pos.y, pos.z);
      if (support && pos.y <= support.surfaceY + ONTOP_TOLERANCE) {
        pointY = support.surfaceY;
        landed = true;
        landedType = 'support';
      }
    }

    points.push(new THREE.Vector3(pos.x, pointY, pos.z));
    if (landed) {
      landingPoint = { x: pos.x, y: pointY, z: pos.z, type: landedType };
      break;
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
    gamepadInfo: getGamepadInfo()
  };
}

initHudControls({
  showMessage,
  updateHudButtons,
  toggleDebugHud,
  toggleDebugLabels,
  updateDebugDisplay,
  getDebugEnabled: () => debugEnabled,
  setDebugEnabled: (value) => {
    debugEnabled = value;
    // Only toggles debug HUD, not debug labels
  },
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
    chatMessages.push(msg);
    if (chatMessages.length > CHAT_MAX_MESSAGES * 3) {
      chatMessages.shift();
    }
    chatWindowDirty = true;
  },
  updateChatWindow: () => updateChatWindow(),
  sendToServer: (payload) => sendToServer(payload),
  getScene: () => scene,
  getChatInput: () => chatInput,
  toggleEntryDialog,
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
        // Dynamic Lighting toggle button
        const dynamicLightingBtn = document.getElementById('dynamicLightingBtn');
        // Default: enabled
        let dynamicLightingEnabled = true;
        const savedDynamicLighting = localStorage.getItem('dynamicLightingEnabled');
        if (savedDynamicLighting !== null) {
          dynamicLightingEnabled = savedDynamicLighting === 'true';
        }
        renderManager.dynamicLightingEnabled = dynamicLightingEnabled;
        if (dynamicLightingBtn) {
          const updateBtn = () => {
            dynamicLightingBtn.classList.toggle('active', renderManager.dynamicLightingEnabled);
            dynamicLightingBtn.title = renderManager.dynamicLightingEnabled ? 'Disable Dynamic Lighting' : 'Enable Dynamic Lighting';
          };
          dynamicLightingBtn.addEventListener('click', () => {
            renderManager.dynamicLightingEnabled = !renderManager.dynamicLightingEnabled;
            localStorage.setItem('dynamicLightingEnabled', renderManager.dynamicLightingEnabled.toString());
            updateBtn();
          });
          updateBtn();
        }
      // Anaglyph 3D toggle button
      const anaglyphBtn = document.getElementById('anaglyphBtn');
      if (anaglyphBtn) {
        anaglyphBtn.addEventListener('click', () => {
          const enabled = !renderManager.getAnaglyphEnabled();
          renderManager.setAnaglyphEnabled(enabled);
          anaglyphBtn.classList.toggle('active', enabled);
          anaglyphBtn.title = enabled ? 'Disable Anaglyph 3D' : 'Enable Anaglyph 3D';
        });
        // Set initial state
        anaglyphBtn.classList.toggle('active', renderManager.getAnaglyphEnabled());
        anaglyphBtn.title = renderManager.getAnaglyphEnabled() ? 'Disable Anaglyph 3D' : 'Enable Anaglyph 3D';
      }

      // Debug geometry toggle button
      const debugGeometryBtn = document.getElementById('debugGeometryBtn');
      if (debugGeometryBtn) {
        const updateBtn = () => {
          debugGeometryBtn.classList.toggle('active', showDebugGeometry);
          debugGeometryBtn.title = showDebugGeometry ? 'Hide Debug Geometry' : 'Show Debug Geometry';
        };
        debugGeometryBtn.addEventListener('click', () => {
          showDebugGeometry = !showDebugGeometry;
          localStorage.setItem('showDebugGeometry', showDebugGeometry.toString());
          updateDebugGeometryVisibility();
          updateBtn();
        });
        updateBtn();
      }
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
  initXR().then(mode => {
    showMessage(`WebXR: ${mode}`, 'info');
    const xrBtn = document.getElementById('xrBtn');
    if (xrBtn) {
      if (mode === 'none') {
        xrBtn.disabled = true;
        xrBtn.title = 'WebXR not supported on this device';
        xrBtn.classList.add('disabled');
      } else {
        xrBtn.addEventListener('click', async () => {
          showMessage('Requesting VR...');
          const renderer = renderManager.getRenderer();
          if (!renderer) {
            showMessage('Error: Renderer not available');
            return;
          }

          const result = await toggleXRSession(renderer, animate);
          if (result) {
            xrBtn.classList.add('active');
            xrBtn.title = 'Exit WebXR VR Mode';
            // Force first-person camera when entering VR
            cameraMode = 'first-person';
            showMessage('✓ WebXR VR Mode: ON');
          } else {
            showMessage('✗ VR request failed - check server.log');
            xrBtn.classList.remove('active');
            xrBtn.title = 'Enter WebXR VR Mode';
            showMessage('WebXR VR Mode: OFF');
          }
        });
      }
    }
  });
});

// Initialize Three.js
function init() {
  // Prevent iOS scrolling/bounce on fullscreen (web app mode)
  document.addEventListener('touchmove', (e) => {
    // Allow touch on specific elements (chat, controls overlay, etc.)
    const allowedSelectors = ['#chatInput', '#chatWindow', '#controlsOverlay', '#settingsHud', '#helpPanel', '#entryDialog', '#operatorOverlay'];
    const isAllowed = allowedSelectors.some(sel => {
      const el = document.querySelector(sel);
      return el && (e.target === el || (e.target && el.contains(e.target)));
    });

    if (!isAllowed) {
      e.preventDefault();
    }
  }, { passive: false });

  setupInputHandlers();
  collectClientCapabilities();

  // Chat UI
  const chatWindow = document.getElementById('chatWindow');
  chatInput = document.getElementById('chatInput');
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

  chatInput.addEventListener('keydown', (e) => {
    // Prevent all game events while typing
    e.stopPropagation();
    if (e.key === 'Enter') {
      const text = chatInput.value.trim();
      if (text.length > 0) {
        const to = parseInt(chatTarget.value, 10);
        sendToServer({ type: 'chat', to, text });
        chatInput.value = '';
      }
      chatInput.blur();
      // Re-enable movement keys
      Object.keys(keys).forEach(k => keys[k] = false);
    } else if (e.key === 'Escape') {
      chatInput.blur();
      Object.keys(keys).forEach(k => keys[k] = false);
    }
  });

  // Prevent mouse/game events when chat input is focused or clicked
  chatInput.addEventListener('focus', () => {
    chatActive = true;
  });
  chatInput.addEventListener('blur', () => {
    chatActive = false;
  });
  chatInput.addEventListener('mousedown', (e) => {
    chatActive = true;
    // Only prevent propagation for the input itself
    e.stopPropagation();
  });

  // Prevent chatActive from blocking mouse motion for clicks on chatWindow background
  chatWindow.addEventListener('mousedown', (e) => {
    // If the click is NOT on the input, allow mouse motion activation
    if (e.target !== chatInput) {
      chatInput.blur();
      chatActive = false;
    }
  });
  updateChatWindow();

  // Restore debug state from localStorage
  const savedDebugState = localStorage.getItem('debugEnabled');
  if (savedDebugState === 'true') {
    const mouseBtn = document.getElementById('mouseBtn');
    const debugBtn = document.getElementById('debugBtn');
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const cameraBtn = document.getElementById('cameraBtn');
    toggleDebugHud({
      debugEnabled,
      setDebugEnabled: v => { debugEnabled = v; },
      updateHudButtons: () => updateHudButtons({ mouseBtn, mouseControlEnabled, debugBtn, debugEnabled, fullscreenBtn, cameraBtn, cameraMode }),
      showMessage,
      updateDebugDisplay,
      getDebugState: () => ({ fps, latency, packetsSent, packetsReceived, sentBps, receivedBps, playerX, playerY, playerZ, playerRotation, myTank, cameraMode, OBSTACLES, clouds: renderManager.getClouds(), latestOrientation, worldTime, gamepadConnected: isGamepadConnected(), gamepadInfo: getGamepadInfo() })
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

  // Event listeners
  window.addEventListener('resize', onWindowResize);
  document.addEventListener('keydown', (e) => {
    // Check if name dialog is open (declare once at top)
    const entryDialog = document.getElementById('entryDialog');
    const helpPanel = document.getElementById('helpPanel');
    const isentryDialogOpen = entryDialog && entryDialog.style.display === 'block';

    // Allow pause/unpause with P key even when paused
    if (e.code === 'KeyP') {
      sendToServer({ type: 'pause' });
      // Don't block other UI, but don't process further game input
      e.preventDefault();
      return;
    }

    // Activate chat with n, but NOT if name dialog is open
    if (!chatActive && !isentryDialogOpen && (e.key === 'n' || e.key === 'N')) {
      chatInput.value = '';
      chatInput.focus();
      e.preventDefault();
      return;
    }
    if (chatActive || document.activeElement === chatInput) {
      // Disable all movement/game keys while chat is active
      e.preventDefault();
      return;
    }

    if (!isentryDialogOpen && e.code === 'KeyQ' && ws && ws.readyState === WebSocket.OPEN) {
      sendToServer({ type: 'selfDestruct' });
      e.preventDefault();
      return;
    }

    // Don't register game keys if dialog is open (except allow Escape to close things)
    if (!isentryDialogOpen || e.code === 'Escape') {
      keys[e.code] = true;
    }

    // If name dialog is open, only allow Escape and don't process other game controls
    if (isentryDialogOpen && e.code !== 'Escape') {
      return;
    }
    // Prevent tab key default behavior
    if (e.key === 'Tab') {
      e.preventDefault();
      return;
    }

    // Switch to keyboard controls with Escape key (also closes dialogs)
    if (e.code === 'Escape') {
      // Close name dialog if open
      if (isentryDialogOpen) {
        entryDialog.style.display = 'none';
        stopTankPreviewAnimation();
        return;
      }
      // Close help dialog if open
      if (helpPanel.style.display === 'block') {
        hideHelpPanel();
        return;
      }

      mouseControlEnabled = false;
      showMessage(`Controls: Keyboard`);
    }
  });
  document.addEventListener('keyup', (e) => {
    // Check if name dialog is open
    const entryDialog = document.getElementById('entryDialog');
    const isentryDialogOpen = entryDialog && entryDialog.style.display === 'block';

    // Only clear keys if dialog is not open
    if (!isentryDialogOpen) {
      keys[e.code] = false;
    }
  });

  // Mouse movement for analog control
  // Mouse analog control using position relative to center (cursor always visible)
  document.addEventListener('mousemove', (e) => {
    if (!mouseControlEnabled) return;
    // Allow mouse movement even if chat is active or chatInput is focused
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    mouseX = (e.clientX - centerX) / (window.innerWidth * 0.35); // 70% width
    mouseY = (e.clientY - centerY) / (window.innerHeight * 0.33); // 33% height
    // Clamp to -1..1
    mouseX = Math.max(-1, Math.min(1, mouseX));
    mouseY = Math.max(-1, Math.min(1, mouseY));
  });

  // Mouse click to shoot (or enable mouse controls on first click)
  let justActivatedMouseControl = false;
  document.addEventListener('mousedown', (e) => {
    // Only block mouse actions if the click is on the chat input itself
    if (e.target === chatInput) return;

    // Prevent firing if clicking on HUD elements and not in mouse mode
    const hudSelectors = ['#playerName', '#mouseBtn', '#fullscreenBtn', '#debugBtn', '#cameraBtn', '#helpBtn'];
    for (const sel of hudSelectors) {
      const el = document.querySelector(sel);
      if (el && (e.target === el || el.contains(e.target))) {
        if (!mouseControlEnabled) return;
      }
    }

    // If the click is inside the chat window but not on the input, blur input and exit chat
    if (e.target.closest && e.target.closest('#chatWindow') && e.target !== chatInput) {
      chatInput.blur();
      chatActive = false;
    }
    if (chatActive || document.activeElement === chatInput) return;
    if (e.button === 0) { // Left click
      if (justActivatedMouseControl) {
        justActivatedMouseControl = false;
        return;
      }
      keys['Space'] = true;
    }
  });

  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) {
      keys['Space'] = false;
    }
  });

  // Exit mouse mode on Escape
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && mouseControlEnabled) {
      mouseControlEnabled = false;
      showMessage('Controls: Keyboard');
      if (typeof updateHudButtons === 'function') updateHudButtons();
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
      const newName = entryInput.value.trim().substring(0, 20);
      localStorage.setItem('playerName', newName);
      myPlayerName = newName;
      sendToServer({
        type: 'joinGame',
        name: myPlayerName,
        isMobile,
        tankModel: selectedTankModelId,
      });
      toggleEntryDialog();
    });

    entryDefaultButton.addEventListener('click', () => {
      // Send blank name to server to request default Player n assignment
      localStorage.setItem('playerName', '');
      myPlayerName = '';
      sendToServer({
        type: 'joinGame',
        name: myPlayerName,
        isMobile,
        tankModel: selectedTankModelId,
      });
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

  // Set up XR animation loop restoration capability
  setNormalAnimationLoop(renderManager.getRenderer(), animate);

  // Start game loop
  animate();
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
    showMessage('Connected to server!');
    debugLog(`ws.open host=${window.location.host} protocol=${window.location.protocol}`);
    flushDebugPacketQueue();
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
    let kills = 0;
    let deaths = 0;
    if (myTank && myTank.userData && myTank.userData.playerState) {
      kills = myTank.userData.playerState.kills || 0;
      deaths = myTank.userData.playerState.deaths || 0;
    }
    console.log(`Disconnected from server (code: ${event.code}, reason: ${event.reason}) | Kills: ${kills} | Deaths: ${deaths}`);
    // Ignore 503 (Service Unavailable) and silently retry
    if (event.code === 1008 || event.reason === '503') {
      console.log('Server temporarily unavailable (503), retrying...');
      setTimeout(connectToServer, 2000);
      return;
    }
    showMessage(`Disconnected from server | Kills: ${kills} | Deaths: ${deaths}`, 'death');
    setTimeout(connectToServer, 3000);
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    const details = error && error.message ? error.message : 'WebSocket error event';
    debugLog(`ws.error ${details}`);
  };
}

function handleServerMessage(message) {
  switch (message.type) {
    case 'init': {
      // Show server info in entryDialog
      const serverNameEl = document.getElementById('serverName');
      const serverDescriptionEl = document.getElementById('serverDescription');
      const serverMotdEl = document.getElementById('serverMotd');
      if (serverNameEl) serverNameEl.textContent = 'Server: ' + (message.serverName || '');
      if (serverDescriptionEl) serverDescriptionEl.textContent = message.description || '';
      if (serverMotdEl) serverMotdEl.textContent = message.motd || '';
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
        renderManager.getWorldGroup().remove(projectile.mesh);
      });
      projectiles.clear();

      // Clear any existing shields
      playerShields.forEach((shield) => {
        renderManager.removeShield(shield);
      });
      playerShields.clear();

      // Clear any existing clouds
      renderManager.clearClouds();

      myPlayerId = message.player.id;
      gameConfig = message.config;
      refreshCollisionColliders();
      playerX = message.player.x;
      playerZ = message.player.z;
      playerRotation = message.player.rotation;

      // Only send join if there is a saved name that is not 'Player' or 'Player n'
      const savedName = localStorage.getItem('playerName');
      if (savedName && savedName.trim().length > 0) {
        const trimmed = savedName.trim();
        // Check for 'Player' or 'Player n' (where n is a number)
        if (
          trimmed !== 'Player' &&
          !/^Player \d+$/.test(trimmed)
        ) {
          myPlayerName = trimmed;
        }
      }
      if (myPlayerName !== 'Player' && !/^Player \d+$/.test(myPlayerName)) {
        sendToServer({
          type: 'joinGame',
          name: myPlayerName,
          isMobile,
          tankModel: selectedTankModelId,
        });
      } else {
        // Show name entry dialog
        myPlayerName = message.player.name;
        toggleEntryDialog(myPlayerName);
      }
      // Only set up world, not join yet
      // Build world geometry
      renderManager.buildGround(gameConfig.MAP_SIZE);
      renderManager.createMapBoundaries(gameConfig.MAP_SIZE);

      // Initialize dead reckoning state (velocity-based)
      lastSentForwardSpeed = 0;
      lastSentRotationSpeed = 0;
      lastSentVerticalVelocity = 0;
      lastSentTime = performance.now();

      // Update obstacles from server
      if (message.obstacles) {
        OBSTACLES = message.obstacles;
        refreshCollisionColliders();
        renderManager.setObstacles(OBSTACLES);
      } else {
        OBSTACLES = [];
        refreshCollisionColliders();
        renderManager.setObstacles([]);
      }

      // Create environmental features
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
      message.players.forEach(player => {
        addPlayer(player);
      });
      // Ensure myTank is set for the local player after all tanks are created
      myTank = tanks.get(myPlayerId);
      callUpdateScoreboard();
      break;
    }

    case 'playerJoined':
      if (message.player.id === myPlayerId) {
        addPlayer(message.player);

        // This is our join confirmation, update our tank and finish join
        myPlayerName = message.player.name;
        playerX = message.player.x;
        playerY = message.player.y;
        playerZ = message.player.z;
        playerRotation = message.player.rotation;

        // Save the name to localStorage (server may have kept our requested name or assigned default)
        localStorage.setItem('playerName', myPlayerName);

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
        }
        callUpdateScoreboard();
      } else {
        // Another player joined: update their info and create their tank if needed
        addPlayer(message.player);
        callUpdateScoreboard();
        showMessage(`${message.player.name} joined the game`);
      }
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

    case 'pm': {
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

        // Detect jump start (record jump direction)
        if (oldVerticalVel <= 0 && message.vv > 10) {
          tank.userData.jumpDirection = message.r;
          renderManager.playLocalJumpSound(tank.position);
        }

        // Detect fall start (drove off edge - record direction for air physics)
        if (oldJumpDirection === null && message.vv < 0 && message.vv > -1) {
          tank.userData.jumpDirection = message.r;
        }

        // Detect landing (clear jump direction)
        // Don't check oldVerticalVel < 0 because extrapolation doesn't update tank.userData.verticalVelocity
        if (oldJumpDirection !== null && message.vv === 0) {
          tank.userData.jumpDirection = null;
          if (Math.abs(oldVerticalVel) >= MIN_LANDING_FEEDBACK_SPEED) {
            triggerLandingFeedback(tank, Math.abs(oldVerticalVel), { local: message.id === myPlayerId });
          }
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
          }, 'received', tank.userData.playerState?.name || '');
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
        clearJumpPredictionDebug(myTank);
        deathFollowTarget = null;
        renderManager.deathFollowTarget = null;
        renderManager.deathFollowAnchor = null;
        updateDeathCameraHudVisibility();
      }
      break;

    case 'projectileCreated':
      createProjectile(message);
      break;

    case 'projectileRemoved':
      removeProjectile(message.id);
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

    case 'chat': {
      // Format: { type: 'chat', from, to, text, id }
      // Lookup names for from/to
      function getPlayerName(id) {
        if (id === 0) return 'ALL';
        if (id === -1) return 'SERVER';
        const tank = tanks.get(id);
        return tank && tank.userData && tank.userData.playerState && tank.userData.playerState.name ? tank.userData.playerState.name : `Player ${id}`;
    }
      const fromName = getPlayerName(message.from);
      const toName = getPlayerName(message.to);
      let prefix = `${fromName} -> ${toName} `;
      chatMessages.push(prefix + message.text);
      if (chatMessages.length > CHAT_MAX_MESSAGES * 3) chatMessages.shift();
      chatWindowDirty = true;
      updateChatWindow();
      break;
    }

    case 'mapList':
      handleMapsList(message);
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

  if (tank && tank.userData && tank.userData.tankModel !== playerTankModelId) {
    if (tank.userData.ghostMesh) {
      renderManager.getWorldGroup().remove(tank.userData.ghostMesh);
      tank.userData.ghostMesh = null;
    }
    renderManager.getWorldGroup().remove(tank);
    tanks.delete(player.id);
    tank = null;
  }

  if (!tank) {
    // Use player.color if present, else fallback to green
    const tankColor = (typeof player.color === 'number') ? player.color : 0x4caf50;
    tank = renderManager.createTank(tankColor, player.name, playerTankModelPath);
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
    }, 'received', player.name || '');
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
  const shotColor = getPlayerShotColor(data.playerId);
  const projectile = renderManager.createProjectile({
    ...data,
    color: shotColor.getHex(),
  });
  if (!projectile) return;
  projectile.userData.playerId = data.playerId;
  projectile.userData.radarColor = `#${shotColor.getHexString()}`;
  projectiles.set(data.id, projectile);
}

function removeProjectile(id) {
  const projectile = projectiles.get(id);
  if (projectile) {
    renderManager.removeProjectile(projectile);
    projectiles.delete(id);
  }
}

function handlePlayerHit(message) {
  const shooterTank = tanks.get(message.shooterId);
  const victimTank = tanks.get(message.victimId);
  const shooterName = shooterTank && shooterTank.userData && shooterTank.userData.playerState && shooterTank.userData.playerState.name ? shooterTank.userData.playerState.name : 'Someone';
  const victimName = victimTank && victimTank.userData && victimTank.userData.playerState && victimTank.userData.playerState.name ? victimTank.userData.playerState.name : 'Someone';
  const isSelfDestruct = Boolean(message.suicide) || (message.victimId === message.shooterId);

  if (message.victimId === myPlayerId) {
    // Local player was killed
    showMessage(isSelfDestruct ? 'You self-destructed!' : `${shooterName} killed you!`, 'death');
    // Switch to overview mode and hide crosshair
    lastCameraMode = cameraMode;
    cameraMode = 'overview';
    // Set camera to initial overview position (not attached to tank)
    camera.position.set(0, 15, 20);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
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
  removeProjectile(message.projectileId);

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
      renderManager.deathFollowAnchor = deathFollowTarget
        ? deathFollowTarget.position.clone()
        : victimTank.position.clone();
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
  updateScoreboard({ myPlayerId, myPlayerName, myTank, tanks });
}

function handleMapsList(message) {
  const mapList = document.getElementById('mapList');
  if (!mapList) return;
  console.log(message)

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
}

function showMessage(text) {
  // Show a message in the chat window as if from SERVER
  const prefix = 'local: ';
  chatMessages.push(prefix + text);
  if (chatMessages.length > CHAT_MAX_MESSAGES * 3) chatMessages.shift();
  chatWindowDirty = true;
  updateChatWindow();
}

function getColliderLocalPoint(x, z, obs) {
  const rotation = obs.rotation || 0;
  const dx = x - obs.x;
  const dz = z - obs.z;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: dx * cos - dz * sin,
    z: dx * sin + dz * cos
  };
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
    { type: 'box', name: 'boundary_north', collisionKind: 'boundary', infiniteHeight: true, x: 0, z: -halfMap - thickness / 2, w: span, d: thickness, h: 0, baseY: 0, rotation: 0 },
    { type: 'box', name: 'boundary_south', collisionKind: 'boundary', infiniteHeight: true, x: 0, z: halfMap + thickness / 2, w: span, d: thickness, h: 0, baseY: 0, rotation: 0 },
    { type: 'box', name: 'boundary_east', collisionKind: 'boundary', infiniteHeight: true, x: halfMap + thickness / 2, z: 0, w: thickness, d: span, h: 0, baseY: 0, rotation: 0 },
    { type: 'box', name: 'boundary_west', collisionKind: 'boundary', infiniteHeight: true, x: -halfMap - thickness / 2, z: 0, w: thickness, d: span, h: 0, baseY: 0, rotation: 0 }
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

// Returns: null, { type: 'collision', obstacle }, or { type: 'ontop', obstacle }
function checkCollision(x, y, z, tankRadius = 2, ignoredObstacles = null) {
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
    const { distSquared } = getBoxCollisionDistanceSquared(localX, localZ, halfW, halfD);

    const pyramidSurface = obs.type === 'pyramid' ? getPyramidSurfaceContact(obs, x, y, z) : null;

    // Check if we're "on top" of this obstacle (at its top height or a climbable slope)
    if (!obs.infiniteHeight) {
      if (obs.type === 'pyramid') {
        if (pyramidSurface && pyramidSurface.supportable && Math.abs(y - pyramidSurface.supportSurfaceY) < ONTOP_TOLERANCE) {
          return { type: 'ontop', obstacle: obs, obstacleTop: pyramidSurface.supportSurfaceY, surfaceNormal: pyramidSurface.normal };
        }
      } else if (Math.abs(y - obstacleTop) < ONTOP_TOLERANCE && distSquared < tankRadius * tankRadius) {
        return { type: 'ontop', obstacle: obs, obstacleTop };
      }
    }

    // Only check collision if tank top is below obstacle top and tank base is above obstacle base
    const tankTop = y + tankHeight;
    if (!obs.infiniteHeight) {
      if (tankTop <= obstacleBase + epsilon) continue;
      if (y >= obstacleTop - epsilon) continue;
    }

    if (obs.type === 'box' || !obs.type) {
      if (distSquared < tankRadius * tankRadius) {
        return { type: 'collision', obstacle: obs };
      }
    } else if (obs.type === 'pyramid') {
      if (!pyramidSurface) continue;
      const tankTop = y + tankHeight;
      const localYBase = y - obstacleBase;
      const localYTop = tankTop - obstacleBase;
      if (!obs.inverted) {
        if (tankTop < obstacleBase + epsilon) continue;
        if (y >= pyramidSurface.surfaceY - epsilon) continue;
      } else {
        if (tankTop <= pyramidSurface.surfaceY + epsilon) continue;
        if (y >= obstacleTop - epsilon) continue;
      }
      if (hasPyramidSurfacePenetration(obs, localX, localZ, tankRadius, localYBase, localYTop, epsilon)) {
        return { type: 'collision', obstacle: obs };
      }
    }
  }
  return false;
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
    if (!collisionInfo || collisionInfo.type !== 'collision' || !collisionInfo.obstacle || collisionInfo.obstacle.infiniteHeight) {
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
    const steppedCollision = checkCollision(newX, surfaceY, newZ, tankRadius);
    if (!steppedCollision) {
      return { x: newX, y: surfaceY, z: newZ, collision: null };
    }
    if (steppedCollision.type === 'ontop') {
      return { x: newX, y: steppedCollision.obstacleTop ?? surfaceY, z: newZ, collision: steppedCollision };
    }
    return null;
  };
  const tryTopSurfaceTransition = (collisionInfo) => {
    if (!collisionInfo || collisionInfo.type !== 'collision' || !collisionInfo.obstacle || collisionInfo.obstacle.infiniteHeight) {
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

    if (isWithinSupportFootprint(obs, newX, topY, newZ, SUPPORT_ACQUIRE_MARGIN)) {
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

    const collisionWithoutBox = checkCollision(newX, candidateY, newZ, tankRadius, new Set([obs]));
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
    const escapeCollision = checkCollision(escapeX, candidateY, escapeZ, tankRadius);
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
  let collisionObj = checkCollision(newX, candidateY, newZ, tankRadius);

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
      tankRadius,
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
    const horizontalOnlyCollision = checkCollision(newX, y, newZ, tankRadius);
    const verticalOnlyCollision = checkCollision(x, candidateY, z, tankRadius);

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
  const surfaceSlideResult = resolveSurfaceSlide(
    collisionObj.obstacle,
    surfaceContact,
    x,
    y,
    z,
    intendedDeltaX,
    intendedDeltaY,
    intendedDeltaZ,
    candidateY,
    tankRadius
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

function resolveBoxSlide(obs, x, z, deltaX, deltaZ, candidateY, tankRadius = 2, visitedObstacles = new Set(), depth = 0) {
  const rotation = obs.rotation || 0;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const halfW = obs.w / 2 + tankRadius;
  const halfD = obs.d / 2 + tankRadius;
  const visualHalfW = obs.w / 2;
  const visualHalfD = obs.d / 2;
  const nextVisited = new Set(visitedObstacles);
  nextVisited.add(obs);
  const intendedMagnitude = Math.hypot(deltaX, deltaZ);
  const getCompositeCenter = (targetObs) => {
    let sumX = 0;
    let sumZ = 0;
    let count = 0;
    for (const candidate of OBSTACLES) {
      if ((candidate.type || 'box') !== 'box') continue;
      if (Math.abs((candidate.baseY || 0) - (targetObs.baseY || 0)) > 0.01) continue;
      if (Math.abs((candidate.h || 4) - (targetObs.h || 4)) > 0.01) continue;
      if (Math.abs(candidate.x - targetObs.x) > 0.5) continue;
      if (Math.abs(candidate.z - targetObs.z) > 0.5) continue;
      sumX += candidate.x;
      sumZ += candidate.z;
      count += 1;
    }
    if (count === 0) {
      return { x: targetObs.x, z: targetObs.z };
    }
    return { x: sumX / count, z: sumZ / count };
  };
  const compositeCenter = getCompositeCenter(obs);

  const worldToLocalPoint = (px, pz) => {
    const dx = px - obs.x;
    const dz = pz - obs.z;
    return {
      x: dx * cos - dz * sin,
      z: dx * sin + dz * cos
    };
  };
  const worldToLocalVector = (vx, vz) => ({
    x: vx * cos - vz * sin,
    z: vx * sin + vz * cos
  });
  const localToWorldPoint = (lx, lz) => ({
    x: obs.x + lx * cos + lz * sin,
    z: obs.z - lx * sin + lz * cos
  });
  const localToWorldVector = (lx, lz) => ({
    x: lx * cos + lz * sin,
    z: -lx * sin + lz * cos
  });

  const from = worldToLocalPoint(x, z);
  const delta = worldToLocalVector(deltaX, deltaZ);

  const sweepAxis = (fromCoord, deltaCoord, min, max) => {
    if (Math.abs(deltaCoord) < 1e-8) {
      return {
        ok: fromCoord >= min && fromCoord <= max,
        enter: -Infinity,
        exit: Infinity
      };
    }
    const invDelta = 1 / deltaCoord;
    let t1 = (min - fromCoord) * invDelta;
    let t2 = (max - fromCoord) * invDelta;
    if (t1 > t2) [t1, t2] = [t2, t1];
    return { ok: true, enter: t1, exit: t2 };
  };

  const xSweep = sweepAxis(from.x, delta.x, -halfW, halfW);
  const zSweep = sweepAxis(from.z, delta.z, -halfD, halfD);
  if (!xSweep.ok || !zSweep.ok) {
    return null;
  }

  const tMin = Math.max(0, xSweep.enter, zSweep.enter);
  const tMax = Math.min(1, xSweep.exit, zSweep.exit);
  if (tMin > tMax) {
    return null;
  }

  const candidateAxes = [];
  if (Math.abs(xSweep.enter - tMin) < BOX_SLIDE_AXIS_EPSILON) candidateAxes.push('x');
  if (Math.abs(zSweep.enter - tMin) < BOX_SLIDE_AXIS_EPSILON) candidateAxes.push('z');
  if (candidateAxes.length === 0) {
    candidateAxes.push(Math.abs(delta.x) >= Math.abs(delta.z) ? 'x' : 'z');
  }

  const hitT = Math.max(0, Math.min(1, tMin));
  const getCornerEscapeSquared = (localPoint) => {
    const corners = [
      { x: -halfW, z: -halfD },
      { x: -halfW, z: halfD },
      { x: halfW, z: -halfD },
      { x: halfW, z: halfD }
    ];
    let best = Infinity;
    for (const corner of corners) {
      const dx = localPoint.x - corner.x;
      const dz = localPoint.z - corner.z;
      const distSquared = dx * dx + dz * dz;
      if (distSquared < best) best = distSquared;
    }
    return best;
  };
  const buildAxisResult = (axis) => {
    const hitPoint = {
      x: from.x + delta.x * hitT,
      z: from.z + delta.z * hitT
    };
    const normalLocal = { x: 0, z: 0 };
    const slideLocal = { x: 0, z: 0 };

    if (axis === 'x') {
      normalLocal.x = delta.x > 0 ? -1 : 1;
      slideLocal.z = delta.z * (1 - hitT);
      hitPoint.x = normalLocal.x > 0 ? halfW + BOX_SLIDE_EPSILON : -halfW - BOX_SLIDE_EPSILON;
    } else {
      normalLocal.z = delta.z > 0 ? -1 : 1;
      slideLocal.x = delta.x * (1 - hitT);
      hitPoint.z = normalLocal.z > 0 ? halfD + BOX_SLIDE_EPSILON : -halfD - BOX_SLIDE_EPSILON;
    }

    const hitWorld = localToWorldPoint(hitPoint.x, hitPoint.z);
    const faceCenterLocal = axis === 'x'
      ? { x: normalLocal.x > 0 ? visualHalfW : -visualHalfW, z: 0 }
      : { x: 0, z: normalLocal.z > 0 ? visualHalfD : -visualHalfD };
    const faceCenterWorld = localToWorldPoint(faceCenterLocal.x, faceCenterLocal.z);
    const finalLocal = {
      x: hitPoint.x + slideLocal.x,
      z: hitPoint.z + slideLocal.z
    };
    const finalWorld = localToWorldPoint(finalLocal.x, finalLocal.z);
    const finalCollision = checkCollision(finalWorld.x, candidateY, finalWorld.z, tankRadius, nextVisited);
    if (finalCollision && finalCollision.type !== 'ontop') {
      const slideWorld = localToWorldVector(slideLocal.x, slideLocal.z);
      if (
        depth < BOX_SLIDE_MAX_CHAIN_DEPTH &&
        finalCollision.obstacle &&
        finalCollision.obstacle.type === 'box' &&
        !nextVisited.has(finalCollision.obstacle) &&
        (slideWorld.x * slideWorld.x + slideWorld.z * slideWorld.z) > BOX_SLIDE_AXIS_EPSILON
      ) {
        const chainedResult = resolveBoxSlide(
          finalCollision.obstacle,
          hitWorld.x,
          hitWorld.z,
          slideWorld.x,
          slideWorld.z,
          candidateY,
          tankRadius,
          nextVisited,
          depth + 1
        );
        if (chainedResult) {
          return {
            x: chainedResult.x,
            z: chainedResult.z,
            normal: chainedResult.normal,
            slideX: chainedResult.x - hitWorld.x,
            slideZ: chainedResult.z - hitWorld.z,
            collisionOnTop: chainedResult.collisionOnTop,
            slideMagnitude: (chainedResult.x - x) * (chainedResult.x - x) + (chainedResult.z - z) * (chainedResult.z - z),
            cornerEscapeSquared: getCornerEscapeSquared(hitPoint),
            outwardScore: chainedResult.outwardScore,
            faceCenter: chainedResult.faceCenter
          };
        }
      }
      const hitCollision = checkCollision(hitWorld.x, candidateY, hitWorld.z, tankRadius, nextVisited);
      if (hitCollision && hitCollision.type !== 'ontop') {
        return null;
      }
      const normalWorld = localToWorldVector(normalLocal.x, normalLocal.z);
      return {
        x: hitWorld.x,
        z: hitWorld.z,
        normal: normalWorld,
      slideX: 0,
        slideZ: 0,
        collisionOnTop: hitCollision && hitCollision.type === 'ontop',
        slideMagnitude: 0,
        cornerEscapeSquared: getCornerEscapeSquared(hitPoint),
        outwardScore: 0,
        faceCenter: { x: faceCenterWorld.x, y: candidateY, z: faceCenterWorld.z, normal: normalWorld, name: obs.name }
      };
    }

    const slideWorld = localToWorldVector(slideLocal.x, slideLocal.z);
    const slideMagnitude = Math.hypot(slideWorld.x, slideWorld.z);
    // Ignore "slides" that are just tiny face-hugging creep; they tend to
    // trap the player visually and create drift against server prediction.
    if (intendedMagnitude > BOX_SLIDE_AXIS_EPSILON && slideMagnitude < intendedMagnitude * BOX_SLIDE_MIN_RATIO) {
      return null;
    }
    const normalWorld = localToWorldVector(normalLocal.x, normalLocal.z);
    const outwardVectorX = finalWorld.x - compositeCenter.x;
    const outwardVectorZ = finalWorld.z - compositeCenter.z;
    const outwardScore = normalWorld.x * outwardVectorX + normalWorld.z * outwardVectorZ;
    return {
      x: finalWorld.x,
      z: finalWorld.z,
      normal: normalWorld,
      slideX: slideWorld.x,
      slideZ: slideWorld.z,
      collisionOnTop: finalCollision && finalCollision.type === 'ontop',
      slideMagnitude: slideWorld.x * slideWorld.x + slideWorld.z * slideWorld.z,
      cornerEscapeSquared: getCornerEscapeSquared(finalLocal),
      outwardScore,
      faceCenter: { x: faceCenterWorld.x, y: candidateY, z: faceCenterWorld.z, normal: normalWorld, name: obs.name }
    };
  };

  let bestResult = null;
  for (const axis of candidateAxes) {
    const candidate = buildAxisResult(axis);
    if (!candidate) continue;
    if (
      !bestResult ||
      candidate.slideMagnitude > bestResult.slideMagnitude + BOX_SLIDE_TIE_EPSILON ||
      (
        Math.abs(candidate.slideMagnitude - bestResult.slideMagnitude) <= BOX_SLIDE_TIE_EPSILON &&
        candidate.outwardScore > bestResult.outwardScore + BOX_SLIDE_TIE_EPSILON
      ) ||
      (
        Math.abs(candidate.slideMagnitude - bestResult.slideMagnitude) <= BOX_SLIDE_TIE_EPSILON &&
        Math.abs(candidate.outwardScore - bestResult.outwardScore) <= BOX_SLIDE_TIE_EPSILON &&
        candidate.cornerEscapeSquared > bestResult.cornerEscapeSquared + BOX_SLIDE_TIE_EPSILON
      )
    ) {
      bestResult = candidate;
    }
  }
  return bestResult;
}

function resolveSurfaceSlide(obs, contact, x, y, z, deltaX, deltaY, deltaZ, candidateY, tankRadius = 2) {
  if (obs && (obs.type === 'box' || !obs.type)) {
    const boxSlideResult = resolveBoxSlide(obs, x, z, deltaX, deltaZ, candidateY, tankRadius);
    if (boxSlideResult) {
      return {
        x: boxSlideResult.x,
        y: candidateY,
        z: boxSlideResult.z,
        collisionOnTop: boxSlideResult.collisionOnTop,
        normal: boxSlideResult.normal,
        slideX: boxSlideResult.slideX,
        slideZ: boxSlideResult.slideZ,
        faceCenter: boxSlideResult.faceCenter,
        traceStage: 'box-slide'
      };
    }

    const verticalOnlyCollisionObj = checkCollision(x, candidateY, z, tankRadius);
    const boxContact = getBoxSurfaceContact(obs, x + deltaX, z + deltaZ, tankRadius);
    if (!verticalOnlyCollisionObj || verticalOnlyCollisionObj.type === 'ontop') {
      return {
        x,
        y: verticalOnlyCollisionObj && verticalOnlyCollisionObj.type === 'ontop'
          ? verticalOnlyCollisionObj.obstacleTop
          : candidateY,
        z,
        collisionOnTop: Boolean(verticalOnlyCollisionObj && verticalOnlyCollisionObj.type === 'ontop'),
        normal: null,
        slideX: 0,
        slideZ: 0,
        faceCenter: boxContact ? boxContact.faceCenter : null,
        traceStage: 'box-vertical-only'
      };
    }
    return null;
  }

  if (!contact || !contact.normal) return null;

  if (obs && obs.type === 'pyramid' && contact.climbable) {
    const targetX = x + deltaX;
    const targetZ = z + deltaZ;
    const targetContact = getPyramidSurfaceContact(obs, targetX, y, targetZ);
    if (targetContact && targetContact.climbable) {
      const targetY = Math.max(0, targetContact.surfaceY);
      const collisionWithoutPyramid = checkCollision(targetX, targetY, targetZ, tankRadius, new Set([obs]));
      if (!collisionWithoutPyramid || collisionWithoutPyramid.type === 'ontop') {
        return {
          x: targetX,
          y: collisionWithoutPyramid && collisionWithoutPyramid.type === 'ontop'
            ? collisionWithoutPyramid.obstacleTop
            : targetY,
          z: targetZ,
          collisionOnTop: true,
          normal: { x: targetContact.normal.x, z: targetContact.normal.z },
          slideX: deltaX,
          slideZ: deltaZ,
          faceCenter: targetContact.faceCenter || contact.faceCenter || null,
          traceStage: 'surface-slide'
        };
      }
    }
  }

  const normal = contact.normal;
  const dot = deltaX * normal.x + deltaY * normal.y + deltaZ * normal.z;
  const inwardDot = Math.min(dot, 0);
  const slide = {
    x: deltaX - normal.x * inwardDot,
    y: deltaY - normal.y * inwardDot,
    z: deltaZ - normal.z * inwardDot
  };
  const normalYAbs = Math.max(0.2, Math.abs(normal.y));
  const penetrationOffset = contact.penetrationDepth
    ? Math.min(4, (contact.penetrationDepth / normalYAbs) + 0.12)
    : 0;

  const tryMove = (offset = 0) => {
    const targetX = x + slide.x + normal.x * offset;
    const targetY = Math.max(0, y + slide.y + normal.y * offset);
    const targetZ = z + slide.z + normal.z * offset;
    const slideCollision = checkCollision(targetX, targetY, targetZ, tankRadius);
    if (slideCollision && slideCollision.type !== 'ontop') {
      return null;
    }
    return {
      x: targetX,
      y: slideCollision && slideCollision.type === 'ontop' ? slideCollision.obstacleTop : targetY,
      z: targetZ,
      collisionOnTop: slideCollision && slideCollision.type === 'ontop',
      normal: { x: normal.x, z: normal.z },
      slideX: slide.x,
      slideZ: slide.z,
      faceCenter: contact.faceCenter || null,
      traceStage: 'surface-slide'
    };
  };

  return tryMove(penetrationOffset) || tryMove(Math.max(0.08, penetrationOffset * 0.5)) || tryMove(0.08);
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

function getPyramidHeight(obs) {
  return Math.abs(obs.h || 0);
}

function getPyramidSurfaceLocalHeight(obs, localX, localZ) {
  const halfW = obs.w / 2;
  const halfD = obs.d / 2;
  if (Math.abs(localX) > halfW || Math.abs(localZ) > halfD) return null;
  const nx = Math.abs(localX) / halfW;
  const nz = Math.abs(localZ) / halfD;
  const height = getPyramidHeight(obs);
  const edgeFactor = Math.max(nx, nz);
  return obs.inverted ? height * edgeFactor : height * (1 - edgeFactor);
}

function hasPyramidSurfacePenetration(obs, localX, localZ, tankRadius, localYBase, localYTop, epsilon) {
  const sampleCount = 8;
  const height = getPyramidHeight(obs);
  for (let i = 0; i < sampleCount; i++) {
    const angle = (Math.PI * 2 * i) / sampleCount;
    const sx = localX + Math.cos(angle) * tankRadius;
    const sz = localZ + Math.sin(angle) * tankRadius;
    const surfaceLocalY = getPyramidSurfaceLocalHeight(obs, sx, sz);
    if (surfaceLocalY === null) continue;
    if (
      (!obs.inverted && localYTop > epsilon && localYBase < surfaceLocalY - epsilon) ||
      (obs.inverted && localYTop > surfaceLocalY + epsilon && localYBase < height - epsilon)
    ) {
      return true;
    }
  }
  const centerSurfaceLocalY = getPyramidSurfaceLocalHeight(obs, localX, localZ);
  if (
    centerSurfaceLocalY !== null &&
    (
      (!obs.inverted && localYTop > epsilon && localYBase < centerSurfaceLocalY - epsilon) ||
      (obs.inverted && localYTop > centerSurfaceLocalY + epsilon && localYBase < height - epsilon)
    )
  ) {
    return true;
  }
  return false;
}

function getPyramidSurfaceContact(obs, worldX, worldY, worldZ) {
  const halfW = obs.w / 2;
  const halfD = obs.d / 2;
  const obstacleBase = obs.baseY || 0;
  const height = getPyramidHeight(obs);
  const tankHeight = 2;
  const { x: localX, z: localZ } = getColliderLocalPoint(worldX, worldZ, obs);
  if (Math.abs(localX) > halfW || Math.abs(localZ) > halfD) return null;

  const nx = Math.abs(localX) / halfW;
  const nz = Math.abs(localZ) / halfD;
  const dominantAxis = nx >= nz ? 'x' : 'z';
  const surfaceLocalHeight = getPyramidSurfaceLocalHeight(obs, localX, localZ);
  if (surfaceLocalHeight === null) return null;
  const collisionSurfaceY = obstacleBase + surfaceLocalHeight;
  const supportSurfaceY = obs.inverted ? obstacleBase + height : collisionSurfaceY;

  let localNormal;
  let faceCenterLocal;
  if (dominantAxis === 'x') {
    const signX = localX >= 0 ? 1 : -1;
    localNormal = { x: (height / halfW) * signX, y: obs.inverted ? -1 : 1, z: 0 };
    faceCenterLocal = { x: signX * halfW * 0.5, z: 0 };
  } else {
    const signZ = localZ >= 0 ? 1 : -1;
    localNormal = { x: 0, y: obs.inverted ? -1 : 1, z: (height / halfD) * signZ };
    faceCenterLocal = { x: 0, z: signZ * halfD * 0.5 };
  }

  const worldNormal = toWorldNormal(obs, localNormal);
  const cosRot = Math.cos(obs.rotation || 0);
  const sinRot = Math.sin(obs.rotation || 0);
  const faceCenterWorld = {
    x: obs.x + faceCenterLocal.x * cosRot + faceCenterLocal.z * sinRot,
    y: obstacleBase + height * 0.5,
    z: obs.z - faceCenterLocal.x * sinRot + faceCenterLocal.z * cosRot
  };
  const climbable = !obs.inverted && worldNormal.y >= CLIMBABLE_SURFACE_NORMAL_Y;
  const supportable = climbable || obs.inverted;
  const penetrationDepth = obs.inverted
    ? Math.max(0, worldY + tankHeight - collisionSurfaceY)
    : Math.max(0, collisionSurfaceY - worldY);
  return {
    obstacle: obs,
    normal: worldNormal,
    climbable,
    supportable,
    faceAxis: dominantAxis,
    faceSign: dominantAxis === 'x' ? (localX >= 0 ? 1 : -1) : (localZ >= 0 ? 1 : -1),
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

function getSupportMargin(obs, preferredObstacle) {
  return obs === preferredObstacle ? SUPPORT_RETAIN_MARGIN : SUPPORT_ACQUIRE_MARGIN;
}

function findSupportSurface(worldX, worldY, worldZ, preferredObstacle = null) {
  let bestSupport = null;
  for (const obs of getCollisionColliders()) {
    if (obs.infiniteHeight) continue;
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

    const margin = getSupportMargin(obs, preferredObstacle);
    const halfW = obs.w / 2 + margin;
    const halfD = obs.d / 2 + margin;
    const { x: localX, z: localZ } = getColliderLocalPoint(worldX, worldZ, obs);
    if (Math.abs(localX) > halfW || Math.abs(localZ) > halfD) continue;
    const surfaceY = (obs.baseY || 0) + (obs.h || 4);
    const deltaY = surfaceY - worldY;
    if (deltaY > MAX_BUMP_HEIGHT || deltaY < -SUPPORT_SNAP_DOWN) continue;
    if (!bestSupport || surfaceY > bestSupport.surfaceY) {
      bestSupport = { obstacle: obs, surfaceY, contact: null };
    }
  }
  return bestSupport;
}

function isWithinSupportFootprint(obs, worldX, worldY, worldZ, margin = SUPPORT_RETAIN_MARGIN) {
  if (!obs || obs.infiniteHeight) return false;

  if (obs.type === 'pyramid') {
    const contact = getPyramidSurfaceContact(obs, worldX, worldY, worldZ);
    return Boolean(contact && contact.supportable);
  }

  const halfW = obs.w / 2 + margin;
  const halfD = obs.d / 2 + margin;
  const { x: localX, z: localZ } = getColliderLocalPoint(worldX, worldZ, obs);
  return Math.abs(localX) <= halfW && Math.abs(localZ) <= halfD;
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
const MIN_LANDING_FEEDBACK_SPEED = 0.35;

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

function triggerLandingFeedback(tank, impactSpeed = 0, { local = false } = {}) {
  if (!tank?.position) return;
  const clampedImpact = Math.max(0, impactSpeed || 0);
  const intensity = Math.max(0.5, Math.min(1.5, 0.55 + clampedImpact / 8));
  renderManager.createLandingEffect(tank.position, intensity, { local });
}

function handleInputEvents() {
  // Reset intended input each frame
  intendedForward = 0;
  intendedRotation = 0;
  intendedY = 0;
  jumpTriggered = false;

  if (!myTank || !gameConfig) return;

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

  // Update virtual input from XR controller if available
  updateVirtualInputFromXR();

  // Update virtual input from gamepad/joystick if available
  updateVirtualInputFromGamepad();

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
  intendedForward = Math.max(-1, Math.min(1, intendedForward));
  intendedRotation = Math.max(-1, Math.min(1, intendedRotation));
  intendedY = Math.max(-1, Math.min(1, intendedY));
}

function handleMotion(deltaTime) {
  if (!myTank || !gameConfig) return;
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
    if (landingImpactSpeed >= MIN_LANDING_FEEDBACK_SPEED) {
      triggerLandingFeedback(myTank, landingImpactSpeed, { local: true });
    }
  }

  const oldX = playerX;
  const oldZ = playerZ;
  const oldRotation = playerRotation;


  // Step 3: Convert intended speed/rotation to deltas
  const speed = gameConfig.TANK_SPEED * deltaTime;
  const rotSpeed = gameConfig.TANK_ROTATION_SPEED * deltaTime;
  let moveRotation = playerRotation;
  let intendedDeltaX, intendedDeltaY = 0, intendedDeltaZ;
  const priorAirVelocityX = myTank.userData.airVelocityX || 0;
  const priorAirVelocityZ = myTank.userData.airVelocityZ || 0;

  // Determine forward speed for movement calculation
  let movementForwardSpeed = intendedForward;
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
    myTank.userData.jumpForwardSpeed = intendedForward;
    myTank.userData.fallForwardSpeed = intendedForward;
    myTank.userData.slideDirection = undefined;
    forceMoveSend = true; // Force send on jump
    if (myTank) renderManager.playLocalJumpSound(myTank.position);
  }

  const result = validateMove(playerX, playerY, playerZ, intendedDeltaX, intendedDeltaY, intendedDeltaZ, 2);

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
    playerRotation = intendedRotation * rotSpeed + oldRotation;
    myTank.position.set(playerX, playerY, playerZ);
    myTank.rotation.y = playerRotation;

    // Store jumpDirection AFTER rotation update so it matches packet r value
    if (jumpStarted) {
      jumpDirection = playerRotation;
      myJumpDirection = jumpDirection;
      const jumpVelocity = deriveAirVelocityFromState(jumpDirection, intendedForward);
      setAirVelocity(myTank, jumpVelocity.x, jumpVelocity.z);
    }
  } else if (fallStarted) {
    // Fall started - apply rotation but position was already updated by fallResult
    playerRotation = intendedRotation * rotSpeed + oldRotation;
    myTank.position.set(playerX, playerY, playerZ);
    myTank.rotation.y = playerRotation;
  }

  // Calculate actual movement direction for slide detection (BEFORE using it in forwardSpeed calc)
  let slideDirection = null;
  if (result.moved && result.altered) {
    // Slide occurred - calculate actual movement direction
    const actualDeltaX = playerX - oldX;
    const actualDeltaZ = playerZ - oldZ;
    const actualDistance = Math.sqrt(actualDeltaX * actualDeltaX + actualDeltaZ * actualDeltaZ);

    if (actualDistance > 0.001) {
      // Calculate direction from movement vector
      const actualDirection = Math.atan2(-actualDeltaX, -actualDeltaZ);

      // Determine expected direction (r on ground, jumpDirection in air)
      const expectedDirection = isInAir && jumpDirection !== null ? jumpDirection : playerRotation;

      // Normalize angle difference to -PI to PI
      const angleDiff = Math.abs(((actualDirection - expectedDirection + Math.PI) % (Math.PI * 2)) - Math.PI);

      // If actual direction differs from expected by more than 0.01 radians, include it
      if (angleDiff > 0.01) {
        slideDirection = actualDirection;
      }
    }
  }

  if ((isInAir || jumpStarted || fallStarted) && deltaTime > 0) {
    if (result.moved && result.altered) {
      const newAirVelocityX = (playerX - oldX) / deltaTime;
      const newAirVelocityZ = (playerZ - oldZ) / deltaTime;
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

  const reasons = [];
  if (forceMoveSend) reasons.push('force');
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
    //if (debugEnabled) console.log(`[CLIENT] Sending dw: ${reasons.join(', ')}`);

    // Round velocities to the precision we send to match server expectations
    // For jump packets, send the intendedForward value used for movement, not calculated forwardSpeed
    const sentFS = jumpStarted ? Number((myTank.userData.jumpForwardSpeed || 0).toFixed(2)) : Number(forwardSpeed.toFixed(2));
    const sentRS = Number(rotationSpeed.toFixed(2));
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
      }, 'sent', 'me');
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
  // Fire button: keyboard Space, mobile/XR/gamepad virtualInput.fire
  if ((!isMobile && keys['Space']) || ((isMobile || isXREnabled() || isGamepadConnected()) && virtualInput.fire)) {
    const now = Date.now();
    if (now - lastShotTime > gameConfig.SHOT_COOLDOWN) {
      shoot();
      lastShotTime = now;
    }
  }
}

function shoot() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const dirX = -Math.sin(playerRotation);
  const dirZ = -Math.cos(playerRotation);

  // Calculate shot origin at end of barrel (3 units forward from tank center)
  const barrelLength = 3.0;
  const barrelHeight = 1.7; // Height of barrel relative to tank base
  const shotX = playerX + dirX * barrelLength;
  const shotY = (myTank ? myTank.position.y : 0) + barrelHeight;
  const shotZ = playerZ + dirZ * barrelLength;

  sendToServer({
    type: 'shoot',
    x: shotX,
    y: shotY,
    z: shotZ,
    dirX,
    dirZ,
  });
}

function updateProjectiles(deltaTime) {
  const projectileSpeed = 18; // units per second (adjust as needed)
  projectiles.forEach((projectile) => {
    projectile.position.x += projectile.userData.dirX * projectileSpeed * deltaTime;
    projectile.position.z += projectile.userData.dirZ * projectileSpeed * deltaTime;
  });
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
  const size = smallerDimension * 0.25;
  radarCanvas.width = size;
  radarCanvas.height = size;
  radarCanvas.style.width = size + 'px';
  radarCanvas.style.height = size + 'px';
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
function world2Radar(worldX, worldZ, px, pz, playerHeading, center, radius, shotDistance, worldRotation = 0) {
  const dx = worldX - px;
  const dz = worldZ - pz;
  const distance = Math.sqrt(dx * dx + dz * dz);

  // Rotate to player-relative coordinates (forward = up on radar)
  const rotX = dx * Math.cos(playerHeading) - dz * Math.sin(playerHeading);
  const rotY = dx * Math.sin(playerHeading) + dz * Math.cos(playerHeading);

  // Scale to radar size
  const x = center + (rotX / shotDistance) * (radius - 16);
  const y = center + (rotY / shotDistance) * (radius - 16);

  // Rotation transform:
  // - Negate worldRotation to account for Z-axis direction difference (Three.js vs canvas)
  // - Add playerHeading so objects stay fixed in world space as radar rotates
  const rotation = -worldRotation + playerHeading;

  return { x, y, distance, rotation };
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

function updateRadar() {
  if (!radarCtx || !myTank || !gameConfig) return;
  // Declare radar variables only once
  const size = radarCanvas.width;
  const center = size / 2;
  const radius = center * 0.95;
  const SHOT_DISTANCE = gameConfig.SHOT_DISTANCE || 50;
  const mapSize = gameConfig.MAP_SIZE || 100;
  // Player world position and heading
  const px = myTank.position.x;
  const py = myTank.position.y;
  const pz = myTank.position.z;
  const playerHeading = myTank.rotation ? myTank.rotation.y : 0;
  // No radarRotation; use playerHeading directly
  // Clear radar
  radarCtx.clearRect(0, 0, size, size);

  // Draw world border (clip to SHOT_DISTANCE area, rotated to player forward)
  if (gameConfig && gameConfig.MAP_SIZE) {
    radarCtx.save();
    radarCtx.globalAlpha = 0.7;
    // Calculate visible world border segment within SHOT_DISTANCE
    const border = mapSize / 2;
    const left = Math.max(px - SHOT_DISTANCE, -border);
    const right = Math.min(px + SHOT_DISTANCE, border);
    const top = Math.max(pz - SHOT_DISTANCE, -border);
    const bottom = Math.min(pz + SHOT_DISTANCE, border);

    // Top edge (North, Z = -border)
    if (top === -border) {
      const p1 = world2Radar(left, -border, px, pz, playerHeading, center, radius, SHOT_DISTANCE);
      const p2 = world2Radar(right, -border, px, pz, playerHeading, center, radius, SHOT_DISTANCE);
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
      const p1 = world2Radar(left, border, px, pz, playerHeading, center, radius, SHOT_DISTANCE);
      const p2 = world2Radar(right, border, px, pz, playerHeading, center, radius, SHOT_DISTANCE);
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
      const p1 = world2Radar(-border, top, px, pz, playerHeading, center, radius, SHOT_DISTANCE);
      const p2 = world2Radar(-border, bottom, px, pz, playerHeading, center, radius, SHOT_DISTANCE);
      radarCtx.save();
      radarCtx.strokeStyle = '#FBC02D'; // West - yellow
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
      const p1 = world2Radar(border, top, px, pz, playerHeading, center, radius, SHOT_DISTANCE);
      const p2 = world2Radar(border, bottom, px, pz, playerHeading, center, radius, SHOT_DISTANCE);
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

  // Draw projectiles (shots) within SHOT_DISTANCE
  if (typeof projectiles !== 'undefined' && projectiles.forEach) {
    projectiles.forEach((proj) => {
      const pos = world2Radar(proj.position.x, proj.position.z, px, pz, playerHeading, center, radius, SHOT_DISTANCE);
      if (pos.distance > SHOT_DISTANCE) return;
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

  // Draw radar background (keep as is)
  radarCtx.save();
  radarCtx.globalAlpha = 0.95;
  radarCtx.beginPath();
  radarCtx.arc(center, center, radius, 0, Math.PI * 2);
  radarCtx.fillStyle = 'rgba(0,0,0,0.5)';
  radarCtx.fill();
  radarCtx.restore();

  // Draw cardinal direction letters (N/E/S/W) at border, facing outward, rotating with the map
  const borderWidth = 3;
  const cardinalLabels = [
    { angle: Math.PI / 2, label: 'N', color: '#B20000' },
    { angle: Math.PI, label: 'E', color: '#388E3C' },
    { angle: -Math.PI / 2, label: 'S', color: '#1976D2' },
    { angle: 0, label: 'W', color: '#FBC02D' },
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
    // Place letter just inside the border
    const labelRadius = radius - borderWidth - 8;
    radarCtx.save();
    radarCtx.translate(0, -labelRadius);
    // Keep letters upright (vertical) at top
    radarCtx.rotate(-playerHeading + Math.PI / 2 - dir.angle);
    radarCtx.strokeText(dir.label, 0, 0);
    radarCtx.fillText(dir.label, 0, 0);
    radarCtx.restore();
    radarCtx.restore();
  });

  // Draw obstacles within SHOT_DISTANCE, rotated to match map orientation
  if (typeof OBSTACLES !== 'undefined' && Array.isArray(OBSTACLES)) {
    OBSTACLES.forEach(obs => {
      const obsWidth = obs.w || 8;
      const obsDepth = obs.d || 8;

      // Transform obstacle to radar coordinates (includes rotation)
      const result = world2Radar(obs.x, obs.z, px, pz, playerHeading, center, radius, SHOT_DISTANCE, obs.rotation || 0);

      // For large objects, check if ANY part is within view, not just the center
      // Calculate the maximum extent from center (half-diagonal of bounding box)
      const maxExtent = Math.sqrt(obsWidth * obsWidth + obsDepth * obsDepth) / 2;

      // Cull only if the closest point on the object is outside SHOT_DISTANCE
      if (result.distance - maxExtent > SHOT_DISTANCE) return;

      // Calculate opacity based on player's vertical position relative to obstacle
      const baseY = obs.baseY || 0;
      const height = obs.h || 4;
      const opacity = getRadarOpacity(py, baseY, height);

      // Obstacle size scaling
      const scale = (radius - 16) / SHOT_DISTANCE;
      const w = obsWidth * scale;
      const d = obsDepth * scale;

      radarCtx.save();
      radarCtx.translate(result.x, result.y);
      radarCtx.rotate(result.rotation);
      radarCtx.globalAlpha = opacity;
      radarCtx.fillStyle = 'rgba(180,180,180,0.8)';
      // Map Three.js dimensions: w (X-axis) → canvas width, d (Z-axis) → canvas height
      radarCtx.fillRect(-w/2, -d/2, w, d);
      radarCtx.restore();
    });
  }

  // Draw tanks within SHOT_DISTANCE, or as edge dots if beyond
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

    const pos = world2Radar(tank.position.x, tank.position.z, px, pz, playerHeading, center, radius, SHOT_DISTANCE);

    if (pos.distance > SHOT_DISTANCE) {
      // Tank is outside radar range - draw as small dot at edge
      // Calculate angle in radar space (same rotation as world2Radar)
      const dx = tank.position.x - px;
      const dz = tank.position.z - pz;
      const rotX = dx * Math.cos(playerHeading) - dz * Math.sin(playerHeading);
      const rotY = dx * Math.sin(playerHeading) + dz * Math.cos(playerHeading);
      const angle = Math.atan2(rotY, rotX);

      // Position dot at edge of radar circle
      const edgeX = center + Math.cos(angle) * (radius - 8);
      const edgeY = center + Math.sin(angle) * (radius - 8);

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

function updateChatWindow() {
  if (!chatWindowDirty) return;
  const chatMessagesDiv = document.getElementById('chatMessages');
  if (!chatMessagesDiv) return;
  // Remove all previous messages
  chatMessagesDiv.innerHTML = '';
  // Add messages
  for (let i = Math.max(0, chatMessages.length - CHAT_MAX_MESSAGES); i < chatMessages.length; i++) {
    const msg = chatMessages[i];
    const div = document.createElement('div');
    div.textContent = msg;
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

function animate() {
  selectedFaceDebugTouchedThisFrame = false;
  supportSurfaceDebugTouchedThisFrame = false;
  supportFootprintDebugTouchedThisFrame = false;
  const now = performance.now();
  const deltaTime = (now - lastTime) / 1000;
  lastTime = now;

  // Advance worldTime so 24000 ticks = 20 minutes (1200 seconds)
  // 24000 / 1200 = 20 ticks per second
  worldTime = (worldTime + 20 * deltaTime) % 24000;
  renderManager.setWorldTime(worldTime);

  // Debug: log game state in XR once on entry
  if (isXREnabled() && !window.xrDebugLogged) {
    window.xrDebugLogged = true;
    debugLog(`[Game] XR entered, myTank: ${myTank ? `(${myTank.position.x.toFixed(1)}, ${myTank.position.y.toFixed(1)}, ${myTank.position.z.toFixed(1)})` : 'NULL'}, tanks: ${tanks.size}`);
  }
  if (!isXREnabled()) {
    window.xrDebugLogged = false;
  }

  updateFps();
  updateChatWindow();
  updateAltimeter({ myTank });
  updateDegreeBar({ myTank, playerRotation });

  // Only schedule next frame if not in XR mode (XR loop handles scheduling)
  if (!isXREnabled()) {
    requestAnimationFrame(animate);
  }

  updateXRControllerInput();
  handleInputEvents();
  handleMotion(deltaTime);
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

      // Extrapolate position from last server-confirmed state
      const extrapolated = extrapolatePosition({
        x: tank.userData.serverPosition.x,
        y: tank.userData.serverPosition.y,
        z: tank.userData.serverPosition.z,
        r: tank.userData.serverPosition.r,
        forwardSpeed: tank.userData.forwardSpeed || 0,
        rotationSpeed: tank.userData.rotationSpeed || 0,
        verticalVelocity: tank.userData.verticalVelocity || 0,
        jumpDirection: tank.userData.jumpDirection,
        slideDirection: tank.userData.slideDirection,
        airVelocityX: tank.userData.airVelocityX || 0,
        airVelocityZ: tank.userData.airVelocityZ || 0
      }, timeSinceUpdate);

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
  renderManager.updateExplosions(deltaTime);
  updateShields();
  renderManager.updateTreads(tanks, deltaTime, gameConfig);
  if (gameConfig) {
    renderManager.updateClouds(deltaTime, gameConfig.MAP_SIZE || 100);
  }
  if (deathFollowTarget && !deathFollowTarget.parent) {
    deathFollowTarget = null;
    renderManager.deathFollowTarget = null;
  }
  updateDeathCameraHudVisibility();
  renderManager.updateCamera({ cameraMode, myTank, playerRotation, deathFollowTarget });
  updateRadar();

  renderManager.renderFrame();
}

// Start the game
init();
