// --- Mobile Device Orientation Debugging ---
let latestOrientation = { alpha: null, beta: null, gamma: null, status: '' };
function setupMobileOrientationDebug() {
  function handleOrientation(event) {
    const { alpha, beta, gamma } = event;
    latestOrientation.alpha = alpha;
    latestOrientation.beta = beta;
    latestOrientation.gamma = gamma;
    latestOrientation.status = 'OK';

    // No analog tank controls from orientation; only update latestOrientation for debug HUD
  }

  // iOS 13+ requires permission for device orientation
  function requestOrientationPermission() {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().then(permissionState => {
        if (permissionState === 'granted') {
          window.addEventListener('deviceorientation', handleOrientation);
          latestOrientation.status = 'Permission granted';
        } else {
          latestOrientation.status = 'Permission denied';
        }
      }).catch(err => {
        latestOrientation.status = 'Permission error: ' + err;
      });
    } else {
      // Android Chrome and others
      window.addEventListener('deviceorientation', handleOrientation);
      latestOrientation.status = 'Listener attached';
    }
  }

  // Only activate on mobile devices
  const isMobile = /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent);
  if (isMobile) {
    latestOrientation.status = 'Mobile device detected';
    requestOrientationPermission();
  }
}
window.addEventListener('DOMContentLoaded', () => {
  setupMobileOrientationDebug();
});
// Cobblestone texture for boundary walls
function createCobblestoneTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  // Fill with dark grey
  ctx.fillStyle = '#333';
  ctx.fillRect(0, 0, 256, 256);

  // Draw cobblestones
  const rows = 8;
  const cols = 8;
  const stoneW = 28;
  const stoneH = 28;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      // Offset every other row
      const offsetX = (y % 2) * (stoneW / 2);
      const cx = x * stoneW + offsetX + stoneW / 2 + 4 * Math.random();
      const cy = y * stoneH + stoneH / 2 + 4 * Math.random();
      ctx.beginPath();
      ctx.ellipse(cx, cy, stoneW * 0.45, stoneH * 0.4, 0, 0, Math.PI * 2);
      // Vary color for realism
      const shade = Math.floor(40 + Math.random() * 40);
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx.fill();
      // Draw highlight
      ctx.beginPath();
      ctx.ellipse(cx - 4, cy - 4, stoneW * 0.12, stoneH * 0.10, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200,200,200,0.08)`;
      ctx.fill();
      // Draw shadow
      ctx.beginPath();
      ctx.ellipse(cx + 4, cy + 4, stoneW * 0.12, stoneH * 0.10, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,0,0,0.12)`;
      ctx.fill();
    }
  }
  // Draw mortar lines
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

import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// Game state
// Chat state
let chatMessages = [];
let chatActive = false;
let chatInput = null;
const CHAT_MAX_MESSAGES = 6;

let scene, camera, renderer, labelRenderer;
let myPlayerId = null;
let myPlayerName = '';
let myTank = null;
let tanks = new Map();
let projectiles = new Map();
let clouds = [];
let ws = null;
let gameConfig = null;
let audioListener, shootSound, jumpSound, landSound;
let radarCanvas, radarCtx;

// Input state
const keys = {};
let lastShotTime = 0;

// Mouse movement toggle button
window.addEventListener('DOMContentLoaded', () => {
    // Pause mouse control when window loses focus
    window.addEventListener('blur', () => {
      if (mouseControlEnabled) {
        mouseControlEnabled = false;
        if (typeof updateHudButtons === 'function') updateHudButtons();
      }
    });
  const mouseBtn = document.getElementById('mouseBtn');
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const debugBtn = document.getElementById('debugBtn');
  const cameraBtn = document.getElementById('cameraBtn');
  const helpBtn = document.getElementById('helpBtn');
  if (helpBtn) {
    const helpPanel = document.getElementById('helpPanel');
    function updateHelpBtn() {
      if (!helpPanel) return;
      if (helpPanel.style.display === 'block') {
        helpBtn.classList.add('active');
        helpBtn.title = 'Hide Help (?)';
      } else {
        helpBtn.classList.remove('active');
        helpBtn.title = 'Show Help (?)';
      }
    }
    helpBtn.addEventListener('click', () => {
      if (!helpPanel) return;
      helpPanel.style.display = (helpPanel.style.display === 'none' || !helpPanel.style.display) ? 'block' : 'none';
      updateHelpBtn();
    });
    // Also update on load in case help is open by default
    updateHelpBtn();
  }

  function setActive(btn, active, activeTitle, inactiveTitle) {
    if (!btn) return;
    if (active) {
      btn.classList.add('active');
      if (activeTitle) btn.title = activeTitle;
    } else {
      btn.classList.remove('active');
      if (inactiveTitle) btn.title = inactiveTitle;
    }
  }

  function updateHudButtons() {
    setActive(mouseBtn, mouseControlEnabled, 'Disable Mouse Movement (M)', 'Enable Mouse Movement (M)');
    setActive(debugBtn, debugEnabled, 'Hide Debug HUD (I)', 'Show Debug HUD (I)');
    setActive(fullscreenBtn, document.fullscreenElement, 'Exit Fullscreen (F)', 'Toggle Fullscreen (F)');
    if (cameraBtn) {
      let camTitle = 'Toggle Camera View (C)';
      if (typeof cameraMode !== 'undefined') {
        camTitle = `Camera: ${cameraMode === 'first-person' ? 'First Person' : cameraMode === 'third-person' ? 'Third Person' : 'Overview'} (C)`;
      }
      cameraBtn.title = camTitle;
    }
  }
  // Restore camera mode from localStorage
  const savedCameraMode = localStorage.getItem('cameraMode');
  if (savedCameraMode === 'first-person' || savedCameraMode === 'third-person' || savedCameraMode === 'overview') {
    cameraMode = savedCameraMode;
  }
  // --- HUD/Key Handler Functions ---

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
    // Log screen resolution to chat
    setTimeout(() => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const msg = `Screen resolution: ${w}x${h}`;
      chatMessages.push(msg);
      updateChatWindow();
    }, 200);
    setTimeout(updateHudButtons, 100);
  }

  function toggleDebugHud() {
    debugEnabled = !debugEnabled;
    localStorage.setItem('debugEnabled', debugEnabled.toString());
    const debugHud = document.getElementById('debugHud');
    if (debugHud) debugHud.style.display = debugEnabled ? 'block' : 'none';
    if (debugEnabled && !debugUpdateInterval) {
      debugUpdateInterval = setInterval(updateDebugDisplay, 500);
    } else if (!debugEnabled && debugUpdateInterval) {
      clearInterval(debugUpdateInterval);
      debugUpdateInterval = null;
    }
    updateHudButtons();
    showMessage(`Debug Mode: ${debugEnabled ? 'ON' : 'OFF'}`);
  }

  function toggleCameraMode() {
    if (cameraMode === 'first-person') {
      cameraMode = 'third-person';
    } else if (cameraMode === 'third-person') {
      cameraMode = 'overview';
    } else {
      cameraMode = 'first-person';
    }
    localStorage.setItem('cameraMode', cameraMode);
    showMessage(`Camera: ${cameraMode === 'first-person' ? 'First Person' : cameraMode === 'third-person' ? 'Third Person' : 'Overview'}`);
    if (typeof updateHudButtons === 'function') updateHudButtons();
  }

  function toggleHelpPanel() {
    if (!helpPanel) return;
    helpPanel.style.display = (helpPanel.style.display === 'none' || !helpPanel.style.display) ? 'block' : 'none';
    updateHelpBtn();
  }

  // Restore states from localStorage
  // (savedCameraMode already declared above)
  const savedMouseMode = localStorage.getItem('mouseControlEnabled');
  if (savedMouseMode === 'true') mouseControlEnabled = true;

  // --- Attach HUD Button Handlers ---
  if (mouseBtn) mouseBtn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); toggleMouseMode(); });
  if (fullscreenBtn) fullscreenBtn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); toggleFullscreen(); });
  if (debugBtn) debugBtn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); toggleDebugHud(); });
  if (cameraBtn) cameraBtn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); toggleCameraMode(); });
  if (helpBtn) helpBtn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); toggleHelpPanel(); });

  // --- Attach Key Handlers ---
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'm' || e.key === 'M') toggleMouseMode();
    else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    else if (e.key === 'i' || e.key === 'I') toggleDebugHud();
    else if (e.key === 'c' || e.key === 'C') toggleCameraMode();
    else if (e.key === '?' || e.key === '/') toggleHelpPanel();
  });
  updateHudButtons();
});

// Obstacle definitions (received from server)
let OBSTACLES = [];

// Camera mode
let cameraMode = 'first-person'; // 'first-person', 'third-person', or 'overview'
let lastCameraMode = 'first-person';

// Pause state
let isPaused = false;
let pauseCountdownStart = 0;
let playerShields = new Map(); // Map of playerId to shield mesh

// Mouse control
let mouseControlEnabled = false;
let hasInteracted = false;
let mouseX = 0; // Percentage from center (-1 to 1)
let mouseY = 0; // Percentage from center (-1 to 1)

// Watch for mouseControlEnabled toggle to reset orientation center
Object.defineProperty(window, 'mouseControlEnabled', {
  get() { return mouseControlEnabled; },
  set(val) {
    if (val && isMobile) {
      orientationCenter = null; // recenter on enable
    }
    mouseControlEnabled = val;
  }
});

// Orientation analog control state
let orientationCenter = null;
let isMobile = /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent);
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
    orientationCenter = null; // recenter analog controls
    if (latestOrientation) latestOrientation.status = 'Orientation changed, recentered';
  }
});
// Fallback for browsers that don't fire orientationchange
window.addEventListener('resize', () => {
  const prev = orientationMode;
  detectOrientationMode();
  if (orientationMode !== prev && isMobile && mouseControlEnabled) {
    orientationCenter = null;
    if (latestOrientation) latestOrientation.status = 'Orientation changed (resize), recentered';
  }
});

// Player tank position (for movement prediction)
let playerX = 0;
let playerY = 0; // Y is vertical position
let playerZ = 0;
let playerRotation = 0;

// Jump momentum - preserve velocity when jumping
let jumpMomentumForward = 0;
let jumpMomentumRotation = 0;

// Dead reckoning state - track last sent position
let lastSentX = 0;
let lastSentZ = 0;
let lastSentRotation = 0;
let lastSentTime = 0;
const POSITION_THRESHOLD = 0.5; // Send update if position differs by more than 0.5 units
const ROTATION_THRESHOLD = 0.1; // Send update if rotation differs by more than 0.1 radians (~6 degrees)
const MAX_UPDATE_INTERVAL = 200; // Force send update at least every 200ms

// Debug tracking
let debugEnabled = false;
const packetsSent = new Map();
const packetsReceived = new Map();
let debugUpdateInterval = null;

// Texture creation functions
function createGroundTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  // Base grass color
  ctx.fillStyle = '#3a8c3a';
  ctx.fillRect(0, 0, 256, 256);

  // Add some noise for grass texture
  for (let i = 0; i < 5000; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const shade = Math.random() * 0.2 - 0.1; // -0.1 to 0.1
    const brightness = Math.floor((58 + shade * 58)); // Vary the green component
    ctx.fillStyle = `rgb(${Math.floor(58 + shade * 58)}, ${Math.floor(140 + shade * 140)}, ${Math.floor(58 + shade * 58)})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // Add subtle grid pattern
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

function createWallTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  // Base brick color
  ctx.fillStyle = '#8B4513';
  ctx.fillRect(0, 0, 256, 256);

  // Draw brick pattern
  const brickWidth = 64;
  const brickHeight = 32;
  const mortarSize = 2;

  ctx.strokeStyle = '#654321';
  ctx.lineWidth = mortarSize;

  for (let y = 0; y < 256; y += brickHeight) {
    for (let x = 0; x < 256; x += brickWidth) {
      // Offset every other row
      const offsetX = (y / brickHeight) % 2 === 0 ? 0 : brickWidth / 2;

      // Add variation to brick color
      const variation = Math.random() * 30 - 15;
      ctx.fillStyle = `rgb(${139 + variation}, ${69 + variation * 0.5}, ${19 + variation * 0.3})`;
      ctx.fillRect(x + offsetX, y, brickWidth - mortarSize, brickHeight - mortarSize);

      // Draw mortar lines
      ctx.strokeRect(x + offsetX, y, brickWidth - mortarSize, brickHeight - mortarSize);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function createObstacleTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  // Base concrete color
  ctx.fillStyle = '#666666';
  ctx.fillRect(0, 0, 256, 256);

  // Add concrete texture with random speckles
  for (let i = 0; i < 8000; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const shade = Math.random() * 0.3 - 0.15; // -0.15 to 0.15
    const brightness = Math.floor(102 + shade * 102);
    ctx.fillStyle = `rgb(${brightness}, ${brightness}, ${brightness})`;
    const size = Math.random() * 2;
    ctx.fillRect(x, y, size, size);
  }

  // Add some cracks/lines for concrete appearance
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 10; i++) {
    ctx.beginPath();
    const startX = Math.random() * 256;
    const startY = Math.random() * 256;
    ctx.moveTo(startX, startY);
    let x = startX;
    let y = startY;
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

// Initialize Three.js
function init() {
    // HUD Buttons
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const debugBtn = document.getElementById('debugBtn');
    if (fullscreenBtn) {
      fullscreenBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen();
        } else {
          document.exitFullscreen();
        }
      });
    }
    if (debugBtn) {
      debugBtn.title = 'Toggle Debug HUD (I)';
      debugBtn.addEventListener('click', () => {
        toggleDebugHud();
      });
    }

    // Hotkeys for F (fullscreen) and I (debug info)
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'f' || e.key === 'F') {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen();
        } else {
          document.exitFullscreen();
        }
      } else if (e.key === 'i' || e.key === 'I') {
        toggleDebugHud();
      }
    });
  // Chat UI
  const chatWindow = document.getElementById('chatWindow');
  chatInput = document.getElementById('chatInput');

  chatInput.addEventListener('keydown', (e) => {
    // Prevent all game events while typing
    e.stopPropagation();
    if (e.key === 'Enter') {
      const text = chatInput.value.trim();
      if (text.length > 0) {
        sendToServer({ type: 'chat', text });
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
    debugEnabled = true;
    const debugHud = document.getElementById('debugHud');
    if (debugHud) {
      debugHud.style.display = 'block';
    }
    // Start updating debug display
    if (!debugUpdateInterval) {
      debugUpdateInterval = setInterval(updateDebugDisplay, 500);
    }
  }

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB);
  scene.fog = new THREE.Fog(0x87CEEB, 50, 200);

  // Camera
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 15, 20);
  camera.lookAt(0, 0, 0);

  // Audio
  audioListener = new THREE.AudioListener();
  camera.add(audioListener);

  // Create shoot sound
  shootSound = new THREE.Audio(audioListener);
  const audioLoader = new THREE.AudioLoader();

  // Create synthetic shoot sound using Web Audio API
  const audioContext = audioListener.context;
  const sampleRate = audioContext.sampleRate;
  const duration = 0.2;
  const length = sampleRate * duration;
  const buffer = audioContext.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  // Generate laser/shoot sound
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const frequency = 800 - (t * 3000); // Descending pitch
    const decay = Math.exp(-t * 15); // Quick decay
    data[i] = Math.sin(2 * Math.PI * frequency * t) * decay * 0.3;
  }

  shootSound.setBuffer(buffer);
  shootSound.setVolume(0.5);

  // Create explosion sound
  const explosionSound = new THREE.Audio(audioListener);
  const explosionDuration = 0.5;
  const explosionLength = sampleRate * explosionDuration;
  const explosionBuffer = audioContext.createBuffer(1, explosionLength, sampleRate);
  const explosionData = explosionBuffer.getChannelData(0);

  // Generate explosion sound (rumble with descending pitch)
  for (let i = 0; i < explosionLength; i++) {
    const t = i / sampleRate;
    const frequency = 100 - (t * 80); // Deep rumble descending
    const decay = Math.exp(-t * 5); // Slower decay
    const noise = (Math.random() * 2 - 1) * 0.3; // Add noise for texture
    const tone = Math.sin(2 * Math.PI * frequency * t) * 0.7;
    explosionData[i] = (tone + noise) * decay * 0.4;
  }

  explosionSound.setBuffer(explosionBuffer);
  explosionSound.setVolume(0.7);
  window.explosionSound = explosionSound; // Make it globally accessible

  // Create jump sound (upward swoosh)
  jumpSound = new THREE.Audio(audioListener);
  const jumpDuration = 0.15;
  const jumpLength = sampleRate * jumpDuration;
  const jumpBuffer = audioContext.createBuffer(1, jumpLength, sampleRate);
  const jumpData = jumpBuffer.getChannelData(0);

  for (let i = 0; i < jumpLength; i++) {
    const t = i / sampleRate;
    const frequency = 200 + (t * 400); // Ascending pitch
    const envelope = Math.sin((t / jumpDuration) * Math.PI); // Bell curve
    jumpData[i] = Math.sin(2 * Math.PI * frequency * t) * envelope * 0.2;
  }

  jumpSound.setBuffer(jumpBuffer);
  jumpSound.setVolume(0.4);

  // Create land sound (thump)
  landSound = new THREE.Audio(audioListener);
  const landDuration = 0.1;
  const landLength = sampleRate * landDuration;
  const landBuffer = audioContext.createBuffer(1, landLength, sampleRate);
  const landData = landBuffer.getChannelData(0);

  for (let i = 0; i < landLength; i++) {
    const t = i / sampleRate;
    const frequency = 80 - (t * 60); // Descending thump
    const decay = Math.exp(-t * 30); // Quick decay
    const noise = (Math.random() * 2 - 1) * 0.2; // Add impact noise
    const tone = Math.sin(2 * Math.PI * frequency * t) * 0.8;
    landData[i] = (tone + noise) * decay * 0.3;
  }

  landSound.setBuffer(landBuffer);
  landSound.setVolume(0.5);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  // Label renderer for floating names
  labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  document.body.appendChild(labelRenderer.domElement);

  // Radar map
  radarCanvas = document.getElementById('radar');
  radarCtx = radarCanvas.getContext('2d');
  resizeRadar();
  updateRadar();

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(50, 50, 50);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.camera.left = -60;
  dirLight.shadow.camera.right = 60;
  dirLight.shadow.camera.top = 60;
  dirLight.shadow.camera.bottom = -60;
  scene.add(dirLight);

  // Event listeners
  window.addEventListener('resize', onWindowResize);
  document.addEventListener('keydown', (e) => {
    // Check if name dialog is open (declare once at top)
    const nameDialog = document.getElementById('nameDialog');
    const isNameDialogOpen = nameDialog && nameDialog.style.display === 'block';

    // Activate chat with / or t, but NOT if name dialog is open
    if (!chatActive && !isNameDialogOpen && (e.key === '/' || e.key === 't' || e.key === 'T')) {
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

    // Don't register game keys if dialog is open (except allow Escape to close things)
    if (!isNameDialogOpen || e.code === 'Escape') {
      keys[e.code] = true;
    }

    // If name dialog is open, only allow Escape and don't process other game controls
    if (isNameDialogOpen && e.code !== 'Escape') {
      return;
    }

    // Toggle help panel with ? key (Shift+/)
    if (e.key === '?') {
      const helpPanel = document.getElementById('helpPanel');
      if (helpPanel.style.display === 'none') {
        helpPanel.style.display = 'block';
      } else {
        helpPanel.style.display = 'none';
      }
      e.preventDefault();
      return;
    }

    // Toggle camera view with C key
    if (e.code === 'KeyC') {
      toggleCameraMode();
    }

    // Toggle debug HUD with backtick key
    if (e.code === 'Backquote') {
      debugEnabled = !debugEnabled;
      const debugHud = document.getElementById('debugHud');
      debugHud.style.display = debugEnabled ? 'block' : 'none';

      // Save state to localStorage
      localStorage.setItem('debugEnabled', debugEnabled.toString());

      if (debugEnabled) {
        // Start updating debug display
        if (!debugUpdateInterval) {
          debugUpdateInterval = setInterval(updateDebugDisplay, 500);
        }
        updateDebugDisplay();
      } else {
        // Stop updating
        if (debugUpdateInterval) {
          clearInterval(debugUpdateInterval);
          debugUpdateInterval = null;
        }
      }
      showMessage(`Debug Mode: ${debugEnabled ? 'ON' : 'OFF'}`);
    }

    // Pause with P key
    if (e.code === 'KeyP') {
      sendToServer({ type: 'pause' });
    }

    // Jump with Tab key
    if (e.code === 'Tab') {
      e.preventDefault(); // Prevent defwwwwb behavior
      if (myTank && gameConfig) {
        const currentVelocity = myTank.userData.verticalVelocity || 0;
        // Only jump if not already jumping (vertical velocity near zero) AND on ground or obstacle
        if (Math.abs(currentVelocity) < 1) {
          // Use validateMove to check if on ground or obstacle
          const moveResult = validateMove(myTank.position.x, myTank.position.y, myTank.position.z, 0, 0, 0, 2);
          if (moveResult.landedType === 'ground' || moveResult.landedType === 'obstacle') {
            myTank.userData.verticalVelocity = gameConfig.JUMP_VELOCITY || 30;
            myTank.userData.hasLanded = false; // Reset landing flag when jumping

            // Play jump sound
            if (jumpSound && jumpSound.isPlaying) {
              jumpSound.stop();
            }
            if (jumpSound) {
              jumpSound.play();
            }

            // Capture current momentum for the jump from input state
            if (mouseControlEnabled) {
              jumpMomentumForward = -mouseY; // Negative because screen Y is inverted
              jumpMomentumRotation = -mouseX; // Match the rotation logic below
            } else {
              // Keyboard control
              jumpMomentumForward = 0;
              jumpMomentumRotation = 0;
              if (keys['KeyW']) jumpMomentumForward = 1.0;
              else if (keys['KeyS']) jumpMomentumForward = -1.0;
              if (keys['KeyA']) jumpMomentumRotation = 1.0; // A = turn left = positive rotation
              else if (keys['KeyD']) jumpMomentumRotation = -1.0; // D = turn right = negative rotation
            }
          }
        }
      }
    }

    // Switch to keyboard controls with Escape key (also closes dialogs)
    if (e.code === 'Escape') {
      // Close name dialog if open
      if (isNameDialogOpen) {
        nameDialog.style.display = 'none';
        return;
      }

      mouseControlEnabled = false;
      showMessage(`Controls: Keyboard`);
    }
  });
  document.addEventListener('keyup', (e) => {
    // Check if name dialog is open
    const nameDialog = document.getElementById('nameDialog');
    const isNameDialogOpen = nameDialog && nameDialog.style.display === 'block';

    // Only clear keys if dialog is not open
    if (!isNameDialogOpen) {
      keys[e.code] = false;
    }
  });

  // Mouse movement for analog control
  // Mouse analog control using position relative to center (cursor always visible)
  document.addEventListener('mousemove', (e) => {
    if (!mouseControlEnabled || chatActive || document.activeElement === chatInput) return;
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
      // ...existing code...
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
  const nameDialog = document.getElementById('nameDialog');
  const nameInput = document.getElementById('nameInput');
  let isNameDialogOpen = false;
  if (savedName && savedName.trim().length > 0) {
    const trimmed = savedName.trim();
    // Show dialog if name is 'Player' or 'Player n'
    if (trimmed === 'Player' || /^Player \d+$/.test(trimmed)) {
      if (nameDialog) {
        nameDialog.style.display = 'block';
        isPaused = true;
        isNameDialogOpen = true;
        if (nameInput) {
          nameInput.value = '';
          nameInput.focus();
        }
      }
    } else {
      myPlayerName = savedName;
      // Join game directly
      if (nameDialog) nameDialog.style.display = 'none';
      isNameDialogOpen = false;
    }
  } else {
    // Pause and show name dialog
    if (nameDialog) {
      nameDialog.style.display = 'block';
      isPaused = true;
      isNameDialogOpen = true;
      if (nameInput) {
        nameInput.value = '';
        nameInput.focus();
      }
    }
  }

  // Add click handler for name change
  const playerNameEl = document.getElementById('playerName');
  const nameOkButton = document.getElementById('nameOkButton');
  const nameDefaultButton = document.getElementById('nameDefaultButton');
  const nameCancelButton = document.getElementById('nameCancelButton');

  if (playerNameEl && nameDialog) {
    playerNameEl.addEventListener('click', () => {
      nameInput.value = myPlayerName;
      nameDialog.style.display = 'block';
      isPaused = true;
      isNameDialogOpen = true;
      nameInput.focus();
      nameInput.select();
    });

    // Stop clicks from propagating to the game
    nameDialog.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    nameOkButton.addEventListener('click', () => {
      const newName = nameInput.value.trim().substring(0, 20);
      if (newName.length > 0) {
        localStorage.setItem('playerName', newName);
        myPlayerName = newName;
        // If not joined yet, send joinGame, else send changeName
        if (!window.hasJoinedGame) {
          sendToServer({
            type: 'joinGame',
            name: newName,
          });
          window.hasJoinedGame = true;
        } else {
          sendToServer({
            type: 'changeName',
            name: newName,
          });
        }
        nameDialog.style.display = 'none';
        isPaused = false;
        isNameDialogOpen = false;
      }
    });

    nameDefaultButton.addEventListener('click', () => {
      // Send blank name to server to request default Player n assignment
      localStorage.setItem('playerName', '');
      myPlayerName = '';
      if (!window.hasJoinedGame) {
        sendToServer({
          type: 'joinGame',
          name: "",
        });
        window.hasJoinedGame = true;
      } else {
        sendToServer({
          type: 'changeName',
          name: "",
        });
      }
      nameDialog.style.display = 'none';
      isPaused = false;
      isNameDialogOpen = false;
    });

    nameCancelButton.addEventListener('click', () => {
      // Don't allow cancel if no name is set
      if (!localStorage.getItem('playerName')) {
        nameInput.focus();
        return;
      }
      nameDialog.style.display = 'none';
      isPaused = false;
      isNameDialogOpen = false;
    });

    nameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        nameOkButton.click();
      } else if (e.key === 'Escape') {
        nameCancelButton.click();
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

  // Start game loop
  animate();
}

function createMapBoundaries(mapSize = 100) {
  const wallHeight = 5;
  const wallThickness = 1;

  // Create materials for each wall with proper texture scaling
  // Scale texture to show 1 brick repeat per 2 units for consistent brick size


  // North/South walls: mapSize × wallHeight × wallThickness (100 × 5 × 1)
  const nsWallTexture = createCobblestoneTexture();
  nsWallTexture.wrapS = THREE.RepeatWrapping;
  nsWallTexture.wrapT = THREE.RepeatWrapping;

  const nsWallMaterials = [
    new THREE.MeshLambertMaterial({ map: nsWallTexture.clone() }), // right
    new THREE.MeshLambertMaterial({ map: nsWallTexture.clone() }), // left
    new THREE.MeshLambertMaterial({ map: nsWallTexture.clone() }), // top
    new THREE.MeshLambertMaterial({ map: nsWallTexture.clone() }), // bottom
    new THREE.MeshLambertMaterial({ map: nsWallTexture.clone() }), // front
    new THREE.MeshLambertMaterial({ map: nsWallTexture.clone() })  // back
  ];

  // Set repeats for each face
  nsWallMaterials[0].map.repeat.set(wallThickness / 2, wallHeight / 2); // right: 1×5
  nsWallMaterials[1].map.repeat.set(wallThickness / 2, wallHeight / 2); // left: 1×5
  nsWallMaterials[2].map.repeat.set(mapSize / 2, wallThickness / 2);    // top: 100×1
  nsWallMaterials[3].map.repeat.set(mapSize / 2, wallThickness / 2);    // bottom: 100×1
  nsWallMaterials[4].map.repeat.set(mapSize / 2, wallHeight / 2);       // front: 100×5
  nsWallMaterials[5].map.repeat.set(mapSize / 2, wallHeight / 2);       // back: 100×5

  // East/West walls: wallThickness × wallHeight × mapSize (1 × 5 × 100)
  const ewWallTexture = createCobblestoneTexture();
  ewWallTexture.wrapS = THREE.RepeatWrapping;
  ewWallTexture.wrapT = THREE.RepeatWrapping;

  const ewWallMaterials = [
    new THREE.MeshLambertMaterial({ map: ewWallTexture.clone() }), // right
    new THREE.MeshLambertMaterial({ map: ewWallTexture.clone() }), // left
    new THREE.MeshLambertMaterial({ map: ewWallTexture.clone() }), // top
    new THREE.MeshLambertMaterial({ map: ewWallTexture.clone() }), // bottom
    new THREE.MeshLambertMaterial({ map: ewWallTexture.clone() }), // front
    new THREE.MeshLambertMaterial({ map: ewWallTexture.clone() })  // back
  ];

  // Set repeats for each face
  ewWallMaterials[0].map.repeat.set(mapSize / 2, wallHeight / 2);       // right: 100×5
  ewWallMaterials[1].map.repeat.set(mapSize / 2, wallHeight / 2);       // left: 100×5
  ewWallMaterials[2].map.repeat.set(mapSize / 2, wallThickness / 2);    // top: 100×1 (swapped for rotation)
  ewWallMaterials[2].map.rotation = Math.PI / 2;                        // rotate top 90°
  ewWallMaterials[2].map.center.set(0.5, 0.5);                          // rotate around center
  ewWallMaterials[3].map.repeat.set(mapSize / 2, wallThickness / 2);    // bottom: 100×1 (swapped for rotation)
  ewWallMaterials[3].map.rotation = Math.PI / 2;                        // rotate bottom 90°
  ewWallMaterials[3].map.center.set(0.5, 0.5);                          // rotate around center
  ewWallMaterials[4].map.repeat.set(wallThickness / 2, wallHeight / 2); // front: 1×5
  ewWallMaterials[5].map.repeat.set(wallThickness / 2, wallHeight / 2); // back: 1×5

  // North wall
  const northWall = new THREE.Mesh(
    new THREE.BoxGeometry(mapSize, wallHeight, wallThickness),
    nsWallMaterials
  );
  northWall.position.set(0, wallHeight / 2, -mapSize / 2);
  northWall.castShadow = true;
  northWall.receiveShadow = true;
  scene.add(northWall);

  // South wall
  const southWall = new THREE.Mesh(
    new THREE.BoxGeometry(mapSize, wallHeight, wallThickness),
    nsWallMaterials.map(m => m.clone())
  );
  southWall.position.set(0, wallHeight / 2, mapSize / 2);
  southWall.castShadow = true;
  southWall.receiveShadow = true;
  scene.add(southWall);

  // East wall
  const eastWall = new THREE.Mesh(
    new THREE.BoxGeometry(wallThickness, wallHeight, mapSize),
    ewWallMaterials
  );
  eastWall.position.set(mapSize / 2, wallHeight / 2, 0);
  eastWall.castShadow = true;
  eastWall.receiveShadow = true;
  scene.add(eastWall);

  // West wall
  const westWall = new THREE.Mesh(
    new THREE.BoxGeometry(wallThickness, wallHeight, mapSize),
    ewWallMaterials.map(m => m.clone())
  );
  westWall.position.set(-mapSize / 2, wallHeight / 2, 0);
  westWall.castShadow = true;
  westWall.receiveShadow = true;
  scene.add(westWall);

  // Add some obstacles
  addObstacles();
}

function createMountains() {
  const mountainDistance = 1.8 * gameConfig.MAP_SIZE; // 1.8 times the map size
  const mountainCount = 8;

  for (let i = 0; i < mountainCount; i++) {
    const angle = (i / mountainCount) * Math.PI * 2;
    const x = Math.cos(angle) * mountainDistance;
    const z = Math.sin(angle) * mountainDistance;

    // Vary mountain size
    const width = 30 + Math.random() * 40;
    const height = 40 + Math.random() * 60;
    const depth = 30 + Math.random() * 40;

    // Create cone for mountain
    const geometry = new THREE.ConeGeometry(width / 2, height, 4);
    const color = new THREE.Color().setHSL(0.3, 0.3, 0.3 + Math.random() * 0.2);
    const material = new THREE.MeshStandardMaterial({
      color,
      flatShading: true,
      roughness: 0.9,
      metalness: 0.1
    });
    const mountain = new THREE.Mesh(geometry, material);

    mountain.position.set(x, height / 2, z);
    mountain.rotation.y = Math.random() * Math.PI * 2;
    mountain.receiveShadow = true;
    scene.add(mountain);

    // Add snow cap
    const snowCapHeight = height * 0.3;
    const snowCapGeometry = new THREE.ConeGeometry(width / 4, snowCapHeight, 4);
    const snowMaterial = new THREE.MeshStandardMaterial({
      color: 0xFFFFFF,
      flatShading: true,
      roughness: 0.7,
      metalness: 0.0
    });
    const snowCap = new THREE.Mesh(snowCapGeometry, snowMaterial);
    snowCap.position.set(x, height - snowCapHeight / 2, z);
    snowCap.rotation.y = mountain.rotation.y;
    scene.add(snowCap);
  }
}

function createClouds(cloudsData) {
  cloudsData.forEach(cloudData => {
    const cloudGroup = new THREE.Group();

    // Create puffs for each cloud
    cloudData.puffs.forEach(puff => {
      const geometry = new THREE.SphereGeometry(puff.radius, 8, 8);
      const material = new THREE.MeshLambertMaterial({
        color: 0xFFFFFF,
        transparent: true,
        opacity: 0.7
      });
      const sphere = new THREE.Mesh(geometry, material);
      sphere.position.set(puff.offsetX, puff.offsetY, puff.offsetZ);
      cloudGroup.add(sphere);
    });

    cloudGroup.position.set(cloudData.x, cloudData.y, cloudData.z);

    // Store velocity for animation (vary speeds between clouds)
    cloudGroup.userData.velocity = 0.5 + Math.random() * 1.0; // Speed between 0.5 and 1.5
    cloudGroup.userData.startX = cloudData.x; // Store starting position for wrapping

    scene.add(cloudGroup);
    clouds.push(cloudGroup);
  });
}

function createCelestialBodies(celestialData) {
  // Create sun
  if (celestialData.sun.visible) {
    const sunGeometry = new THREE.SphereGeometry(8, 32, 32);
    const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xFFFF00 });
    const sun = new THREE.Mesh(sunGeometry, sunMaterial);
    sun.position.set(celestialData.sun.x, celestialData.sun.y, celestialData.sun.z);
    scene.add(sun);

    // Add sun glow
    const glowGeometry = new THREE.SphereGeometry(12, 32, 32);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xFFFF88,
      transparent: true,
      opacity: 0.3
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    glow.position.copy(sun.position);
    scene.add(glow);
  }

  // Create moon
  if (celestialData.moon.visible) {
    const moonGeometry = new THREE.SphereGeometry(6, 32, 32);
    const moonMaterial = new THREE.MeshLambertMaterial({ color: 0xCCCCCC });
    const moon = new THREE.Mesh(moonGeometry, moonMaterial);
    moon.position.set(celestialData.moon.x, celestialData.moon.y, celestialData.moon.z);
    scene.add(moon);
  }
}

// Track obstacle meshes so we can remove them
let obstacleMeshes = [];

function recreateObstacles() {
  // Remove existing obstacles
  obstacleMeshes.forEach(mesh => {
    scene.remove(mesh);
  });
  obstacleMeshes = [];

  // Create new obstacles from server data
  OBSTACLES.forEach(obs => {
    // Use obstacle height and base elevation from server
    const h = obs.h || 4;
    const baseY = obs.baseY || 0;

    // Create textures
    const concreteTexture = createObstacleTexture();
    concreteTexture.wrapS = THREE.RepeatWrapping;
    concreteTexture.wrapT = THREE.RepeatWrapping;
    concreteTexture.repeat.set(obs.w / 2, h / 2);

    const wallTexture = createWallTexture();
    wallTexture.wrapS = THREE.RepeatWrapping;
    wallTexture.wrapT = THREE.RepeatWrapping;
    wallTexture.repeat.set(obs.d / 2, h / 2); // Default repeat, will adjust per face

    // Materials: [right, left, top, bottom, front, back]
    const materials = [
      new THREE.MeshLambertMaterial({ map: wallTexture.clone() }), // right
      new THREE.MeshLambertMaterial({ map: wallTexture.clone() }), // left
      new THREE.MeshLambertMaterial({ map: concreteTexture.clone() }), // top
      new THREE.MeshLambertMaterial({ map: concreteTexture.clone() }), // bottom
      new THREE.MeshLambertMaterial({ map: wallTexture.clone() }), // front
      new THREE.MeshLambertMaterial({ map: wallTexture.clone() })  // back
    ];

    // Set repeat for each face
    // Sides (right/left/front/back): repeat by obstacle size
    materials[0].map.repeat.set(obs.d / 2, h / 2); // right
    materials[1].map.repeat.set(obs.d / 2, h / 2); // left
    materials[4].map.repeat.set(obs.w / 2, h / 2); // front
    materials[5].map.repeat.set(obs.w / 2, h / 2); // back
    // Top/bottom: repeat by obstacle width/depth
    materials[2].map.repeat.set(obs.w / 2, obs.d / 2); // top
    materials[3].map.repeat.set(obs.w / 2, obs.d / 2); // bottom
    materials.forEach(m => { m.map.needsUpdate = true; });

    const obstacle = new THREE.Mesh(
      new THREE.BoxGeometry(obs.w, h, obs.d),
      materials
    );
    // Position at baseY + half height
    obstacle.position.set(obs.x, baseY + h / 2, obs.z);
    obstacle.rotation.y = obs.rotation || 0;
    obstacle.castShadow = true;
    obstacle.receiveShadow = true;
    scene.add(obstacle);
    obstacleMeshes.push(obstacle);
  });
}

function addObstacles() {
  recreateObstacles();
}

function createTankTexture(baseColor) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  // Base color
  const baseHex = baseColor.toString(16).padStart(6, '0');
  const r = parseInt(baseHex.substr(0, 2), 16);
  const g = parseInt(baseHex.substr(2, 2), 16);
  const b = parseInt(baseHex.substr(4, 2), 16);

  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.fillRect(0, 0, 128, 128);

  // Create camouflage pattern with organic blobs
  const numBlobs = 25;

  for (let i = 0; i < numBlobs; i++) {
    const x = Math.random() * 128;
    const y = Math.random() * 128;
    const radius = Math.random() * 20 + 10;

    // Vary the color - darker or lighter than base
    const variation = (Math.random() - 0.5) * 0.4;
    const newR = Math.max(0, Math.min(255, r + r * variation));
    const newG = Math.max(0, Math.min(255, g + g * variation));
    const newB = Math.max(0, Math.min(255, b + b * variation));

    ctx.fillStyle = `rgba(${Math.floor(newR)}, ${Math.floor(newG)}, ${Math.floor(newB)}, 0.6)`;

    // Draw irregular blob shape
    ctx.beginPath();
    const points = 8;
    for (let j = 0; j <= points; j++) {
      const angle = (j / points) * Math.PI * 2;
      const radiusVariation = radius * (0.7 + Math.random() * 0.6);
      const px = x + Math.cos(angle) * radiusVariation;
      const py = y + Math.sin(angle) * radiusVariation;
      if (j === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
    ctx.fill();
  }

  // Add some darker spots for depth
  for (let i = 0; i < 15; i++) {
    const x = Math.random() * 128;
    const y = Math.random() * 128;
    const radius = Math.random() * 8 + 4;

    ctx.fillStyle = `rgba(0, 0, 0, ${0.1 + Math.random() * 0.2})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function createTreadTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  // Dark base
  ctx.fillStyle = '#333333';
  ctx.fillRect(0, 0, 128, 64);

  // Tread pattern
  ctx.fillStyle = '#222222';
  for (let x = 0; x < 128; x += 16) {
    ctx.fillRect(x, 0, 10, 64);
  }

  // Highlight grooves
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = 2;
  for (let x = 10; x < 128; x += 16) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 64);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

function createTreadCapTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  // Grey base color
  const r = 100;
  const g = 100;
  const b = 100;

  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.fillRect(0, 0, 128, 128);

  // Create camouflage pattern with organic blobs (same as body but grey)
  const numBlobs = 25;

  for (let i = 0; i < numBlobs; i++) {
    const x = Math.random() * 128;
    const y = Math.random() * 128;
    const radius = Math.random() * 20 + 10;

    // Vary the grey color - darker or lighter
    const variation = (Math.random() - 0.5) * 0.4;
    const newR = Math.max(0, Math.min(255, r + r * variation));
    const newG = Math.max(0, Math.min(255, g + g * variation));
    const newB = Math.max(0, Math.min(255, b + b * variation));

    ctx.fillStyle = `rgba(${Math.floor(newR)}, ${Math.floor(newG)}, ${Math.floor(newB)}, 0.6)`;

    // Draw irregular blob shape
    ctx.beginPath();
    const points = 8;
    for (let j = 0; j <= points; j++) {
      const angle = (j / points) * Math.PI * 2;
      const radiusVariation = radius * (0.7 + Math.random() * 0.6);
      const px = x + Math.cos(angle) * radiusVariation;
      const py = y + Math.sin(angle) * radiusVariation;
      if (j === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
    ctx.fill();
  }

  // Add some darker spots for depth
  for (let i = 0; i < 15; i++) {
    const x = Math.random() * 128;
    const y = Math.random() * 128;
    const radius = Math.random() * 8 + 4;

    ctx.fillStyle = `rgba(0, 0, 0, ${0.1 + Math.random() * 0.2})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function updateSpriteLabel(sprite, name) {
  // Create canvas for text
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.width = 256;
  canvas.height = 64;

  // Draw text
  context.fillStyle = 'rgba(0, 0, 0, 0.7)';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.font = 'bold 36px Arial';
  context.fillStyle = '#4CAF50';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(name, canvas.width / 2, canvas.height / 2);

  // Update sprite texture
  const texture = new THREE.CanvasTexture(canvas);
  sprite.material.map = texture;
  sprite.material.needsUpdate = true;
}

function createTank(color = 0x4CAF50, name = '') {
  const tankGroup = new THREE.Group();

  // Create name label as a sprite (will be occluded by 3D objects)
  if (name) {
    const spriteMaterial = new THREE.SpriteMaterial({
      depthTest: true,
      depthWrite: false
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.position.set(0, 3, 0);
    sprite.scale.set(2, 0.5, 1);
    tankGroup.add(sprite);
    tankGroup.userData.nameLabel = sprite;
    updateSpriteLabel(sprite, name);
  }

  // Create textures
  const bodyTexture = createTankTexture(color);
  const treadTexture = createTreadTexture();
  const treadTextureRotated = treadTexture.clone();
  treadTextureRotated.rotation = Math.PI / 2;
  treadTextureRotated.center.set(0.5, 0.5);
  treadTextureRotated.needsUpdate = true;
  const treadCapTexture = createTreadCapTexture();

  // Create separate textures for each face dimension
  const treadCapTextureSide = treadCapTexture.clone(); // For 1.0 x 3.0 faces (right, left, front, back)
  treadCapTextureSide.repeat.set(3.0, 1.0); // 3.0 horizontally, 1.0 vertically
  treadCapTextureSide.wrapS = THREE.RepeatWrapping;
  treadCapTextureSide.wrapT = THREE.RepeatWrapping;
  treadCapTextureSide.needsUpdate = true;

  // Tank body with texture (raised)
  const bodyGeometry = new THREE.BoxGeometry(3, 1, 4);
  const bodyMaterial = new THREE.MeshLambertMaterial({ map: bodyTexture });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = 0.8;
  body.castShadow = true;
  body.receiveShadow = true;
  tankGroup.add(body);
  tankGroup.userData.body = body; // Store reference for hiding in first-person

  // Left tread (realistic shape with half-cylinders at front/rear)
  const treadMat = new THREE.MeshLambertMaterial({ map: treadTexture.clone() });
  const treadCapMat = new THREE.MeshLambertMaterial({ map: treadCapTexture });

  // Create a group for each tread
  const leftTreadGroup = new THREE.Group();
  leftTreadGroup.position.set(-1.75, 0.5, 0);

  // Store tread textures for animation - separate left and right for independent speed
  tankGroup.userData.leftTreadTextures = [];
  tankGroup.userData.rightTreadTextures = [];

  // Flat middle section - length matches distance between cylinder centers
  const treadHeight = 1.0;
  const treadWidth = 1.0;
  const treadCapRadius = treadHeight / 2;
  const treadMiddleLength = 3.0;
  const treadMiddleGeom = new THREE.BoxGeometry(treadWidth, treadHeight, treadMiddleLength);
  const leftTreadRotatedTex = treadTextureRotated.clone();
  leftTreadRotatedTex.wrapS = THREE.RepeatWrapping;
  leftTreadRotatedTex.wrapT = THREE.RepeatWrapping;
  const leftTreadRotatedMat = new THREE.MeshLambertMaterial({ map: leftTreadRotatedTex });
  const treadCapMatSide = new THREE.MeshLambertMaterial({ map: treadCapTextureSide });
  // Multi-material: right, left, top, bottom, front, back
  const leftTreadMiddle = new THREE.Mesh(treadMiddleGeom, [treadCapMatSide, treadCapMatSide, leftTreadRotatedMat, leftTreadRotatedMat, treadCapMatSide, treadCapMatSide]);
  leftTreadMiddle.castShadow = true;
  leftTreadGroup.add(leftTreadMiddle);

  // Store texture references for animation
  tankGroup.userData.leftTreadTextures.push(leftTreadRotatedTex);

  // Front half-cylinder (curved end at front of tank) - use multi-material for curved and flat sides
  const treadCapGeom = new THREE.CylinderGeometry(treadCapRadius, treadCapRadius, treadWidth, 16, 1, false, 0, Math.PI);
  // Rear half-cylinder geometry (flipped to face outward at rear)
  const treadCapGeomRear = new THREE.CylinderGeometry(treadCapRadius, treadCapRadius, treadWidth, 16, 1, false, Math.PI, Math.PI);
  const leftTreadFrontTex = treadTexture.clone();
  leftTreadFrontTex.wrapS = THREE.RepeatWrapping;
  leftTreadFrontTex.wrapT = THREE.RepeatWrapping;
  const leftTreadFrontMat = new THREE.MeshLambertMaterial({ map: leftTreadFrontTex });
  const leftTreadFront = new THREE.Mesh(treadCapGeom, [leftTreadFrontMat, treadCapMat, treadCapMat]);
  leftTreadFront.rotation.x = Math.PI / 2;
  leftTreadFront.rotation.z = Math.PI / 2;
  leftTreadFront.position.z = treadMiddleLength / 2;
  leftTreadFront.castShadow = true;
  leftTreadGroup.add(leftTreadFront);
  tankGroup.userData.leftTreadTextures.push(leftTreadFrontTex);

  // Rear half-cylinder (curved end at rear of tank)
  const leftTreadRearTex = treadTexture.clone();
  leftTreadRearTex.wrapS = THREE.RepeatWrapping;
  leftTreadRearTex.wrapT = THREE.RepeatWrapping;
  const leftTreadRearMat = new THREE.MeshLambertMaterial({ map: leftTreadRearTex });
  const leftTreadRear = new THREE.Mesh(treadCapGeomRear, [leftTreadRearMat, treadCapMat, treadCapMat]);
  leftTreadRear.rotation.x = Math.PI / 2;
  leftTreadRear.rotation.z = Math.PI / 2;
  leftTreadRear.position.z = -treadMiddleLength / 2;
  leftTreadRear.castShadow = true;
  leftTreadGroup.add(leftTreadRear);
  tankGroup.userData.leftTreadTextures.push(leftTreadRearTex);

  tankGroup.add(leftTreadGroup);

  // Right tread
  const rightTreadGroup = new THREE.Group();
  rightTreadGroup.position.set(1.75, 0.5, 0);

  const rightTreadRotatedTex = treadTextureRotated.clone();
  rightTreadRotatedTex.wrapS = THREE.RepeatWrapping;
  rightTreadRotatedTex.wrapT = THREE.RepeatWrapping;
  const rightTreadRotatedMat = new THREE.MeshLambertMaterial({ map: rightTreadRotatedTex });
  const rightTreadMiddle = new THREE.Mesh(treadMiddleGeom, [treadCapMatSide, treadCapMatSide, rightTreadRotatedMat, rightTreadRotatedMat, treadCapMatSide, treadCapMatSide]);
  rightTreadMiddle.castShadow = true;
  rightTreadGroup.add(rightTreadMiddle);
  tankGroup.userData.rightTreadTextures.push(rightTreadRotatedTex);

  const rightTreadFrontTex = treadTexture.clone();
  rightTreadFrontTex.wrapS = THREE.RepeatWrapping;
  rightTreadFrontTex.wrapT = THREE.RepeatWrapping;
  const rightTreadFrontMat = new THREE.MeshLambertMaterial({ map: rightTreadFrontTex });
  const rightTreadFront = new THREE.Mesh(treadCapGeom, [rightTreadFrontMat, treadCapMat, treadCapMat]);
  rightTreadFront.rotation.x = Math.PI / 2;
  rightTreadFront.rotation.z = Math.PI / 2;
  rightTreadFront.position.z = treadMiddleLength / 2;
  rightTreadFront.castShadow = true;
  rightTreadGroup.add(rightTreadFront);
  tankGroup.userData.rightTreadTextures.push(rightTreadFrontTex);

  const rightTreadRearTex = treadTexture.clone();
  rightTreadRearTex.wrapS = THREE.RepeatWrapping;
  rightTreadRearTex.wrapT = THREE.RepeatWrapping;
  const rightTreadRearMat = new THREE.MeshLambertMaterial({ map: rightTreadRearTex });
  const rightTreadRear = new THREE.Mesh(treadCapGeomRear, [rightTreadRearMat, treadCapMat, treadCapMat]);
  rightTreadRear.rotation.x = Math.PI / 2;
  rightTreadRear.rotation.z = Math.PI / 2;
  rightTreadRear.position.z = -treadMiddleLength / 2;
  rightTreadRear.castShadow = true;
  rightTreadGroup.add(rightTreadRear);
  tankGroup.userData.rightTreadTextures.push(rightTreadRearTex);

  tankGroup.add(rightTreadGroup);

  // Tank turret with texture - round cylinder
  const turretGeometry = new THREE.CylinderGeometry(1, 1, 0.8, 32);
  const turretTexture = bodyTexture.clone();
  turretTexture.wrapS = THREE.RepeatWrapping;
  turretTexture.wrapT = THREE.RepeatWrapping;
  // Scale texture to match world coordinates - circumference is 2πr ≈ 6.28 for radius 1
  turretTexture.repeat.set(6.28 / 4, 0.8 / 4); // Adjust to match body texture scale
  turretTexture.needsUpdate = true;
  const turretMaterial = new THREE.MeshLambertMaterial({ map: turretTexture });
  const turret = new THREE.Mesh(turretGeometry, turretMaterial);
  turret.position.y = 1.7;
  turret.castShadow = true;
  tankGroup.add(turret);
  tankGroup.userData.turret = turret; // Store reference for hiding in first-person

  // Tank barrel
  const barrelGeometry = new THREE.CylinderGeometry(0.2, 0.2, 3, 8);
  const barrelMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 });
  const barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 1.7, 1.5);
  barrel.castShadow = true;
  tankGroup.add(barrel);
  tankGroup.userData.barrel = barrel; // Store reference

  return tankGroup;
}

function sendToServer(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    // Track sent packets
    if (debugEnabled) {
      const type = message.type || 'unknown';
      packetsSent.set(type, (packetsSent.get(type) || 0) + 1);
    }
    ws.send(JSON.stringify(message));
  }
}

function updateDebugDisplay() {

  const debugContent = document.getElementById('debugContent');
  if (!debugContent) return;

  let html = '<div style="margin-bottom: 10px; font-weight: bold;">PLAYER STATUS:</div>';

  // Mobile orientation status
  if (typeof latestOrientation !== 'undefined' && latestOrientation.status) {
    html += `<div><span class="label">Orientation Status:</span><span class="value">${latestOrientation.status}</span></div>`;
    if (latestOrientation.alpha !== null && latestOrientation.beta !== null && latestOrientation.gamma !== null) {
      html += `<div><span class="label">Orientation α:</span><span class="value">${latestOrientation.alpha.toFixed(1)}</span></div>`;
      html += `<div><span class="label">Orientation β:</span><span class="value">${latestOrientation.beta.toFixed(1)}</span></div>`;
      html += `<div><span class="label">Orientation γ:</span><span class="value">${latestOrientation.gamma.toFixed(1)}</span></div>`;
    }
    html += `<div><span class="label">Device Mode:</span><span class="value">${orientationMode}</span></div>`;
  } else {
    // Calculate current speed from input
    let forwardSpeed = 0;
    let rotationSpeed = 0;

    if (mouseControlEnabled) {
      // Mouse control - proportional to distance from center, no dead zone
      forwardSpeed = -mouseY; // Negative because screen Y is inverted
      rotationSpeed = -mouseX; // Negative because positive mouseX means turn right
    } else {
      // Keyboard control - digital on/off
      if (keys['KeyW']) {
        forwardSpeed = 1.0;
      } else if (keys['KeyS']) {
        forwardSpeed = -1.0;
      }

      if (keys['KeyA']) {
        rotationSpeed = 1.0;
      } else if (keys['KeyD']) {
        rotationSpeed = -1.0;
      }
    }

    const tankSpeed = gameConfig ? gameConfig.TANK_SPEED : 5;
    const tankRotSpeed = gameConfig ? gameConfig.TANK_ROTATION_SPEED : 2;
    const linearSpeed = forwardSpeed * tankSpeed;
    const angularSpeed = rotationSpeed * tankRotSpeed;
    const verticalSpeed = myTank ? (myTank.userData.verticalVelocity || 0) : 0;

    html += `<div><span class="label">Linear Speed:</span><span class="value">${linearSpeed.toFixed(2)} u/s</span></div>`;
    html += `<div><span class="label">Angular Speed:</span><span class="value">${angularSpeed.toFixed(2)} rad/s</span></div>`;
    html += `<div><span class="label">Vertical Speed:</span><span class="value">${verticalSpeed.toFixed(2)} u/s</span></div>`;
    html += `<div><span class="label">Position:</span><span class="value">(${playerX.toFixed(1)}, ${myTank ? myTank.position.y.toFixed(1) : '0.0'}, ${playerZ.toFixed(1)})</span></div>`;
    html += `<div><span class="label">Rotation:</span><span class="value">${playerRotation.toFixed(2)} rad</span></div>`;

    html += '<div style="margin: 10px 0; border-top: 1px solid #444; padding-top: 10px; font-weight: bold;">SCENE OBJECTS:</div>';

    // Count scene objects
    let totalObjects = 0;
    scene.traverse(() => totalObjects++);
    html += `<div><span class="label">Total Objects:</span><span class="value">${totalObjects}</span></div>`;
    html += `<div><span class="label">Tanks:</span><span class="value">${tanks.size}</span></div>`;
    html += `<div><span class="label">Projectiles:</span><span class="value">${projectiles.size}</span></div>`;
    html += `<div><span class="label">Shields:</span><span class="value">${playerShields.size}</span></div>`;

    html += '<div style="margin: 10px 0; border-top: 1px solid #444; padding-top: 10px; font-weight: bold;">PACKETS SENT:</div>';

    const sentTypes = Array.from(packetsSent.entries()).sort((a, b) => b[1] - a[1]);
    sentTypes.forEach(([type, count]) => {
      html += `<div><span class="label">${type}:</span><span class="value">${count}</span></div>`;
    });

    html += '<div style="margin: 10px 0; border-top: 1px solid #444; padding-top: 10px; font-weight: bold;">PACKETS RECEIVED:</div>';

    const receivedTypes = Array.from(packetsReceived.entries()).sort((a, b) => b[1] - a[1]);
    receivedTypes.forEach(([type, count]) => {
      html += `<div><span class="label">${type}:</span><span class="value">${count}</span></div>`;
    });
  }
  debugContent.innerHTML = html;
}

function connectToServer() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  // Detect mobile browser
  function isMobileBrowser() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }
  const isMobile = isMobileBrowser();

  ws.onopen = () => {
    showMessage('Connected to server!');

    // Only send join if there is a saved name that is not 'Player' or 'Player n'
    const savedName = localStorage.getItem('playerName');
    if (savedName && savedName.trim().length > 0) {
      const trimmed = savedName.trim();
      // Check for 'Player' or 'Player n' (where n is a number)
      if (
        trimmed !== 'Player' &&
        !/^Player \d+$/.test(trimmed)
      ) {
        sendToServer({
          type: 'joinGame',
          name: trimmed,
          isMobile,
        });
      }
    } else {
      // Always send isMobile on first join
      sendToServer({
        type: 'joinGame',
        isMobile,
      });
    }
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);

    // Track received packets
    if (debugEnabled) {
      const type = message.type || 'unknown';
      packetsReceived.set(type, (packetsReceived.get(type) || 0) + 1);
    }

    handleServerMessage(message);
  };

  ws.onclose = (event) => {
    console.log('Disconnected from server', event.code, event.reason);

    // Ignore 503 (Service Unavailable) and silently retry
    if (event.code === 1008 || event.reason === '503') {
      console.log('Server temporarily unavailable (503), retrying...');
      setTimeout(connectToServer, 2000);
      return;
    }

    showMessage('Disconnected from server', 'death');
    setTimeout(connectToServer, 3000);
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
}

function handleServerMessage(message) {
  if (message.type === 'chat') {
    // Format: { type: 'chat', from, text, id }
    let prefix = message.from ? `<${message.from}> ` : '';
    chatMessages.push(prefix + message.text);
    if (chatMessages.length > CHAT_MAX_MESSAGES * 3) chatMessages.shift();
    updateChatWindow();
    return;
  }
  switch (message.type) {
    case 'init':
      // Update player name at the top of the scoreboard and set myPlayerName to the name field
      if (message.player && message.player.name) {
        myPlayerName = message.player.name;
        const playerNameEl = document.getElementById('playerName');
        if (playerNameEl) playerNameEl.textContent = myPlayerName;
        // Gather screen info
        const w = window.innerWidth;
        const h = window.innerHeight;
        // Use isMobile from isMobileBrowser() defined in connectToServer scope
        const mobileText = (typeof isMobile !== 'undefined' && isMobile) ? 'Mobile' : 'Desktop';
        // Show in chat window
        const msg = `Connected as \"${myPlayerName}\"! (${w}x${h}, ${mobileText})`;
        chatMessages.push(msg);
        updateChatWindow();
        showMessage(msg);
      }
      // Clear any existing tanks from previous connections
      tanks.forEach((tank, id) => {
        scene.remove(tank);
      });
      tanks.clear();

      // Clear any existing projectiles
      projectiles.forEach((projectile) => {
        scene.remove(projectile.mesh);
      });
      projectiles.clear();

      // Clear any existing shields
      playerShields.forEach((shield, id) => {
        scene.remove(shield);
      });
      playerShields.clear();

      // Clear any existing clouds
      clouds.forEach((cloud) => {
        scene.remove(cloud);
      });
      clouds.length = 0;

      myPlayerId = message.player.id;
      gameConfig = message.config;
      playerX = message.player.x;
      playerZ = message.player.z;
      playerRotation = message.player.rotation;

      // If a default name is provided, use it for the join dialog
      if (message.player && message.player.defaultName) {
        const nameInput = document.getElementById('nameInput');
        const nameDialog = document.getElementById('nameDialog');
        if (nameInput && nameDialog) {
          nameInput.value = message.player.defaultName;
          nameDialog.style.display = 'block';
          isPaused = true;
          nameInput.focus();
          nameInput.select();
        }
      }
      // Only set up world, not join yet
      // Ground with texture
      const groundGeometry = new THREE.PlaneGeometry(gameConfig.MAP_SIZE * 3, gameConfig.MAP_SIZE * 3);
      const groundTexture = createGroundTexture();
      groundTexture.wrapS = THREE.RepeatWrapping;
      groundTexture.wrapT = THREE.RepeatWrapping;
      groundTexture.repeat.set(20, 20);
      const groundMaterial = new THREE.MeshLambertMaterial({
        map: groundTexture,
        side: THREE.DoubleSide
      });
      const ground = new THREE.Mesh(groundGeometry, groundMaterial);
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      scene.add(ground);

      // Ground grid
      const gridHelper = new THREE.GridHelper(gameConfig.MAP_SIZE * 3, gameConfig.MAP_SIZE, 0x000000, 0x555555);
      scene.add(gridHelper);

      // Map boundaries (walls)
      createMapBoundaries(gameConfig.MAP_SIZE);

      // Initialize dead reckoning state
      lastSentX = playerX;
      lastSentZ = playerZ;
      lastSentRotation = playerRotation;
      lastSentTime = performance.now();

      // Update obstacles from server
      if (message.obstacles) {
        OBSTACLES = message.obstacles;
        // Recreate obstacles in scene
        recreateObstacles();
      }

      // Create environmental features
      createMountains();
      if (message.celestial) {
        createCelestialBodies(message.celestial);
      }
      if (message.clouds) {
        createClouds(message.clouds);
      }
      message.players.forEach(player => {
        if (player.health > 0) {
          addPlayer(player);
        }
      });
      updateScoreboard();
      break;

    case 'playerJoined':
      if (message.player.id === myPlayerId) {
        // This is our join confirmation, now create our tank and finish join
        myPlayerName = message.player.name;
        playerX = message.player.x;
        playerY = message.player.y;
        playerZ = message.player.z;
        playerRotation = message.player.rotation;

        // Save the name to localStorage (server may have kept our requested name or assigned default)
        localStorage.setItem('playerName', myPlayerName);

        // Update player name display
        document.getElementById('playerName').textContent = myPlayerName;

        // Create my tank
        myTank = createTank(0x2196F3, myPlayerName);
        myTank.position.set(playerX, playerY, playerZ);
        myTank.rotation.y = playerRotation;
        myTank.userData.verticalVelocity = message.player.verticalVelocity || 0;
        myTank.userData.playerState = message.player;
        scene.add(myTank);
        tanks.set(myPlayerId, myTank);

        updateStats(message.player);
        updatePlayerCount();
        updateScoreboard();
      } else {
        addPlayer(message.player);
        updatePlayerCount();
        showMessage(`${message.player.name} joined the game`);
      }
      break;

    case 'playerLeft':
      // Show the player's name before removing
      let leftName = 'Player';
      const leftTank = tanks.get(message.id);
      if (leftTank && leftTank.userData && leftTank.userData.playerState && leftTank.userData.playerState.name) {
        leftName = leftTank.userData.playerState.name;
      }
      showMessage(`${leftName} left the game`);
      removePlayer(message.id);
      updatePlayerCount();
      break;

    case 'playerMoved':
      const tank = tanks.get(message.id);
      if (tank && message.id !== myPlayerId) {
        const y = message.y !== undefined ? message.y : 0;
        const oldY = tank.position.y;
        const oldVerticalVel = tank.userData.verticalVelocity || 0;
        const newVerticalVel = message.verticalVelocity || 0;

        tank.position.set(message.x, y, message.z);
        tank.rotation.y = message.rotation;
        // Store velocity for tread animation
        tank.userData.forwardSpeed = message.forwardSpeed || 0;
        tank.userData.rotationSpeed = message.rotationSpeed || 0;
        tank.userData.verticalVelocity = newVerticalVel;

        // Detect jump (vertical velocity suddenly became positive and large)
        if (oldVerticalVel < 10 && newVerticalVel >= 20) {
          // Play jump sound at tank's position
          if (jumpSound && jumpSound.context) {
            const jumpSoundClone = jumpSound.clone();
            tank.add(jumpSoundClone);
            jumpSoundClone.setVolume(0.4);
            jumpSoundClone.play();
            // Remove sound after playing
            setTimeout(() => tank.remove(jumpSoundClone), 200);
          }
        }

        // Detect landing (was in air, now at ground/obstacle with zero velocity)
        if (oldY > 0.5 && y <= oldY - 0.5 && Math.abs(newVerticalVel) < 1) {
          // Play land sound at tank's position
          if (landSound && landSound.context) {
            const landSoundClone = landSound.clone();
            tank.add(landSoundClone);
            landSoundClone.setVolume(0.5);
            landSoundClone.play();
            // Remove sound after playing
            setTimeout(() => tank.remove(landSoundClone), 150);
          }
        }
      }
      break;

    case 'positionCorrection':
      // Server corrected our position - update dead reckoning state
      playerX = message.x;
      playerZ = message.z;
      playerRotation = message.rotation;
      lastSentX = playerX;
      lastSentZ = playerZ;
      lastSentRotation = playerRotation;
      lastSentTime = performance.now();
      if (myTank) {
        const y = message.y !== undefined ? message.y : 0;
        myTank.position.set(playerX, y, playerZ);
        myTank.rotation.y = playerRotation;
        myTank.userData.verticalVelocity = message.verticalVelocity || 0;
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
      createShield(message.playerId, message.x, message.z);
      break;

    case 'playerUnpaused':
      if (message.playerId === myPlayerId) {
        isPaused = false;
        pauseCountdownStart = 0;
        showMessage('Unpaused');
      }
      removeShield(message.playerId);
      break;

    case 'nameChanged':
      if (message.playerId === myPlayerId) {
        myPlayerName = message.name;
        document.getElementById('playerName').textContent = myPlayerName;

        // Save to localStorage
        localStorage.setItem('playerName', message.name);

        // Update tank name label
        if (myTank && myTank.userData.nameLabel) {
          updateSpriteLabel(myTank.userData.nameLabel, message.name);
        }

        showMessage(`Name changed to: ${message.name}`);
      } else {
        // Update other player's name label and state
        const tank = tanks.get(message.playerId);
        if (tank) {
          if (tank.userData.nameLabel) {
            updateSpriteLabel(tank.userData.nameLabel, message.name);
          }
          if (tank.userData.playerState) {
            tank.userData.playerState.name = message.name;
          }
        }
        showMessage(`${message.name} joined`);
      }
      updateScoreboard();
      break;

    case 'nameError':
      showMessage(`Error: ${message.message}`, 'death');
      break;

    case 'reload':
      console.log('Server requested reload');
      showMessage('Server updated - reloading...', 'death');
      setTimeout(() => {
        window.location.reload();
      }, 1000);
      break;
  }
}

function addPlayer(player) {
  if (tanks.has(player.id)) return;

  const tank = createTank(0xFF5722, player.name || 'Player');
  tank.position.set(player.x, player.y, player.z);
  tank.rotation.y = player.rotation;
  tank.userData.playerState = player; // Store player state for scoreboard
  tank.userData.verticalVelocity = player.verticalVelocity || 0;
  scene.add(tank);
  tanks.set(player.id, tank);
  updateScoreboard();
}

function removePlayer(playerId) {
  const tank = tanks.get(playerId);
  if (tank) {
    scene.remove(tank);
    tanks.delete(playerId);
    updateScoreboard();
  }
  removeShield(playerId);
}

function createShield(playerId, x, z) {
  // Remove existing shield if any
  removeShield(playerId);

  const shieldGeometry = new THREE.SphereGeometry(3, 16, 16);
  const shieldMaterial = new THREE.MeshBasicMaterial({
    color: 0x00FFFF,
    transparent: true,
    opacity: 0.3,
    wireframe: true,
  });
  const shield = new THREE.Mesh(shieldGeometry, shieldMaterial);
  shield.position.set(x, 2, z);
  scene.add(shield);
  playerShields.set(playerId, shield);

  // Animate shield
  shield.userData.rotation = 0;
}

function removeShield(playerId) {
  const shield = playerShields.get(playerId);
  if (shield) {
    scene.remove(shield);
    playerShields.delete(playerId);
  }
}

function createProjectile(data) {
  const geometry = new THREE.SphereGeometry(0.3, 8, 8);
  const material = new THREE.MeshBasicMaterial({ color: 0xFFFF00 });
  const projectile = new THREE.Mesh(geometry, material);
  projectile.position.set(data.x, data.y, data.z);
  projectile.userData = {
    dirX: data.dirX,
    dirZ: data.dirZ,
  };
  scene.add(projectile);
  projectiles.set(data.id, projectile);

  // Play shoot sound
  if (shootSound && shootSound.buffer) {
    if (shootSound.isPlaying) {
      shootSound.stop();
    }
    shootSound.play();
  }
}

function removeProjectile(id) {
  const projectile = projectiles.get(id);
  if (projectile) {
    scene.remove(projectile);
    projectiles.delete(id);
  }
}

function handlePlayerHit(message) {
  const shooterTank = tanks.get(message.shooterId);
  const victimTank = tanks.get(message.victimId);
  const shooterName = shooterTank && shooterTank.userData && shooterTank.userData.playerState && shooterTank.userData.playerState.name ? shooterTank.userData.playerState.name : 'Someone';
  const victimName = victimTank && victimTank.userData && victimTank.userData.playerState && victimTank.userData.playerState.name ? victimTank.userData.playerState.name : 'Someone';

  if (message.victimId === myPlayerId) {
    // Local player was killed
    showMessage(`${shooterName} killed you!`, 'death');
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
    showMessage(`You killed ${victimName}!`, 'kill');
  } else {
    // Show to all other players
    showMessage(`${shooterName} killed ${victimName}!`, 'info');
  }
  // Update other players' stats

  if (shooterTank && shooterTank.userData.playerState) {
    shooterTank.userData.playerState.kills = (shooterTank.userData.playerState.kills || 0) + 1;
  }
  if (victimTank && victimTank.userData.playerState) {
    victimTank.userData.playerState.deaths = (victimTank.userData.playerState.deaths || 0) + 1;
  }
  updateScoreboard();

  // Remove the projectile
  removeProjectile(message.projectileId);

  // Get victim tank and create explosion effect
  if (victimTank) {
    // Immediately hide the tank from the scene
    victimTank.visible = false;
    // Create explosion with tank parts
    createExplosion(victimTank.position, victimTank);
  }
}

function handlePlayerRespawn(message) {
  const tank = tanks.get(message.player.id);
  if (tank) {
    tank.position.set(message.player.x, message.player.y, message.player.z);
    tank.rotation.y = message.player.rotation;
    tank.userData.verticalVelocity = message.player.verticalVelocity || 0;
    tank.visible = true; // Make tank visible again after respawn
  }

  if (message.player.id === myPlayerId) {
    playerX = message.player.x;
    playerZ = message.player.z;
    playerRotation = message.player.rotation;
    showMessage('You respawned!');
    // Restore normal view and crosshair
    cameraMode = lastCameraMode === 'overview' ? 'first-person' : lastCameraMode;
    const crosshair = document.getElementById('crosshair');
    if (crosshair) crosshair.style.display = '';
  }
}

function launchTankPart(part, centerPos, debrisPieces, speedMultiplier = 1.0) {
  scene.add(part);

  // Mark as tank part so we don't dispose shared materials/geometries
  part.userData.isTankPart = true;

  // Random velocity outward from explosion center
  const angle = Math.random() * Math.PI * 2;
  const elevation = (Math.random() - 0.3) * Math.PI / 3;
  const speed = (Math.random() * 10 + 8) * speedMultiplier;

  part.velocity = new THREE.Vector3(
    Math.cos(angle) * Math.cos(elevation) * speed,
    Math.sin(elevation) * speed + 8,
    Math.sin(angle) * Math.cos(elevation) * speed
  );

  // Random rotation velocity
  part.rotationVelocity = new THREE.Vector3(
    (Math.random() - 0.5) * 8,
    (Math.random() - 0.5) * 8,
    (Math.random() - 0.5) * 8
  );

  debrisPieces.push({
    mesh: part,
    lifetime: 0,
    maxLifetime: 2.0
  });
}

function createExplosion(position, tank) {
  if (!position) return;

  // Play explosion sound
  if (window.explosionSound && window.explosionSound.buffer) {
    if (window.explosionSound.isPlaying) {
      window.explosionSound.stop();
    }
    window.explosionSound.play();
  }

  // Create central explosion sphere
  const geometry = new THREE.SphereGeometry(2, 16, 16);
  const material = new THREE.MeshBasicMaterial({
    color: 0xFF4500,
    transparent: true,
    opacity: 0.8
  });
  const explosion = new THREE.Mesh(geometry, material);
  explosion.position.copy(position);
  scene.add(explosion);

  // Animate explosion sphere
  let scale = 1;
  const animateExplosion = () => {
    scale += 0.1;
    explosion.scale.set(scale, scale, scale);
    material.opacity -= 0.05;

    if (material.opacity > 0) {
      requestAnimationFrame(animateExplosion);
    } else {
      scene.remove(explosion);
      // Dispose of resources
      geometry.dispose();
      material.dispose();
    }
  };
  animateExplosion();

  // Create flying debris pieces
  const debrisPieces = [];

  // If we have the tank, launch its actual parts
  if (tank && tank.userData) {
    const tankWorldPos = new THREE.Vector3();
    tank.getWorldPosition(tankWorldPos);
    const tankRotation = tank.rotation.y;

    // Launch tank body
    if (tank.userData.body) {
      const part = tank.userData.body.clone();
      part.position.copy(tankWorldPos);
      part.position.y = tank.userData.body.position.y;
      part.rotation.y = tankRotation;
      launchTankPart(part, tankWorldPos, debrisPieces, 1.0);
    }

    // Launch turret
    if (tank.userData.turret) {
      const part = tank.userData.turret.clone();
      part.position.copy(tankWorldPos);
      part.position.y = tank.userData.turret.position.y;
      part.rotation.y = tankRotation;
      launchTankPart(part, tankWorldPos, debrisPieces, 0.8);
    }

    // Launch barrel
    if (tank.userData.barrel) {
      const part = tank.userData.barrel.clone();
      part.position.copy(tankWorldPos);
      part.position.y = tank.userData.barrel.position.y;
      part.position.z += 1.5 * Math.cos(tankRotation);
      part.position.x += 1.5 * Math.sin(tankRotation);
      part.rotation.copy(tank.userData.barrel.rotation);
      part.rotation.y += tankRotation;
      launchTankPart(part, tankWorldPos, debrisPieces, 0.6);
    }

    // Launch tread groups (left and right)
    tank.children.forEach(child => {
      if (child instanceof THREE.Group && child.children.length > 0) {
        const treadGroup = child.clone();
        treadGroup.position.copy(tankWorldPos);
        treadGroup.position.x += child.position.x * Math.cos(tankRotation);
        treadGroup.position.z += child.position.x * Math.sin(tankRotation);
        treadGroup.position.y = child.position.y;
        treadGroup.rotation.y = tankRotation;
        launchTankPart(treadGroup, tankWorldPos, debrisPieces, 0.9);
      }
    });
  }

  const debrisCount = 15;

  for (let i = 0; i < debrisCount; i++) {
    // Create random box geometry for debris
    const size = Math.random() * 0.5 + 0.3;
    const debrisGeom = new THREE.BoxGeometry(size, size, size);
    const debrisMat = new THREE.MeshLambertMaterial({
      color: i % 3 === 0 ? 0x4CAF50 : (i % 3 === 1 ? 0x666666 : 0xFF5722)
    });
    const debris = new THREE.Mesh(debrisGeom, debrisMat);

    // Position at explosion center
    debris.position.copy(position);

    // Random velocity in all directions
    const angle = Math.random() * Math.PI * 2;
    const elevation = (Math.random() - 0.3) * Math.PI / 3;
    const speed = Math.random() * 15 + 10;

    debris.velocity = new THREE.Vector3(
      Math.cos(angle) * Math.cos(elevation) * speed,
      Math.sin(elevation) * speed + 5,
      Math.sin(angle) * Math.cos(elevation) * speed
    );

    // Random rotation
    debris.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI
    );

    debris.rotationVelocity = new THREE.Vector3(
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 10
    );

    // Mark as disposable debris (not a tank part)
    debris.userData.isTankPart = false;

    scene.add(debris);
    debrisPieces.push({
      mesh: debris,
      lifetime: 0,
      maxLifetime: 1.5
    });
  }

  // Animate debris
  const animateDebris = () => {
    let anyAlive = false;
    const dt = 0.016; // ~60fps

    debrisPieces.forEach(piece => {
      if (piece.lifetime < piece.maxLifetime) {
        anyAlive = true;
        piece.lifetime += dt;

        // Apply gravity
        piece.mesh.velocity.y -= 20 * dt;

        // Update position
        piece.mesh.position.x += piece.mesh.velocity.x * dt;
        piece.mesh.position.y += piece.mesh.velocity.y * dt;
        piece.mesh.position.z += piece.mesh.velocity.z * dt;

        // Update rotation
        piece.mesh.rotation.x += piece.mesh.rotationVelocity.x * dt;
        piece.mesh.rotation.y += piece.mesh.rotationVelocity.y * dt;
        piece.mesh.rotation.z += piece.mesh.rotationVelocity.z * dt;

        // Fade out near end of lifetime
        const fadeStart = piece.maxLifetime * 0.7;
        if (piece.lifetime > fadeStart) {
          const fadeProgress = (piece.lifetime - fadeStart) / (piece.maxLifetime - fadeStart);

          // Handle both single material and material arrays
          if (piece.mesh.material) {
            if (Array.isArray(piece.mesh.material)) {
              piece.mesh.material.forEach(mat => {
                if (mat) {
                  mat.opacity = 1 - fadeProgress;
                  mat.transparent = true;
                }
              });
            } else {
              piece.mesh.material.opacity = 1 - fadeProgress;
              piece.mesh.material.transparent = true;
            }
          }

          // Also fade children (for tank parts with sub-meshes)
          piece.mesh.traverse((child) => {
            if (child.material) {
              if (Array.isArray(child.material)) {
                child.material.forEach(mat => {
                  if (mat) {
                    mat.opacity = 1 - fadeProgress;
                    mat.transparent = true;
                  }
                });
              } else {
                child.material.opacity = 1 - fadeProgress;
                child.material.transparent = true;
              }
            }
          });
        }

        // Remove if hit ground
        if (piece.mesh.position.y < 0) {
          piece.lifetime = piece.maxLifetime;
        }
      } else {
        // Remove from scene
        scene.remove(piece.mesh);

        // For cloned tank parts, don't dispose shared materials/geometries
        // Only dispose if this is a unique debris piece (not a tank part)
        if (piece.mesh.userData && !piece.mesh.userData.isTankPart) {
          if (piece.mesh.geometry) {
            piece.mesh.geometry.dispose();
          }
          if (piece.mesh.material) {
            if (Array.isArray(piece.mesh.material)) {
              piece.mesh.material.forEach(mat => mat.dispose());
            } else {
              piece.mesh.material.dispose();
            }
          }
        }

        // Recursively remove children from scene
        if (piece.mesh.children) {
          piece.mesh.children.forEach(child => {
            scene.remove(child);
          });
        }
      }
    });

    if (anyAlive) {
      requestAnimationFrame(animateDebris);
    }
  };
  animateDebris();
}

function updateStats(player) {
  updateScoreboard();
}

function updatePlayerCount() {
  // Player count tracking removed
}

function updateScoreboard() {
  const scoreboardList = document.getElementById('scoreboardList');
  scoreboardList.innerHTML = '';

  // Collect all player data
  const playerData = [];

  // Add current player
  if (myPlayerId && myTank && myTank.userData.playerState) {
    playerData.push({
      id: myPlayerId,
      name: myPlayerName,
      kills: myTank.userData.playerState.kills || 0,
      deaths: myTank.userData.playerState.deaths || 0,
      connectDate: myTank.userData.playerState.connectDate ? new Date(myTank.userData.playerState.connectDate) : new Date(0),
      isCurrent: true
    });
  }

  // Add other players from server state
  tanks.forEach((tank, id) => {
    if (id !== myPlayerId && tank.userData.playerState) {
      playerData.push({
        id: id,
        name: tank.userData.playerState.name || 'Player',
        kills: tank.userData.playerState.kills || 0,
        deaths: tank.userData.playerState.deaths || 0,
        connectDate: tank.userData.playerState.connectDate ? new Date(tank.userData.playerState.connectDate) : new Date(0),
        isCurrent: false
      });
    }
  });

  // Sort by (kills - deaths) descending, then kills descending, then deaths ascending, then connectDate ascending (oldest first)
  playerData.sort((a, b) => {
    const aScore = (a.kills || 0) - (a.deaths || 0);
    const bScore = (b.kills || 0) - (b.deaths || 0);
    if (bScore !== aScore) return bScore - aScore;
    if ((b.kills || 0) !== (a.kills || 0)) return b.kills - a.kills;
    if ((a.deaths || 0) !== (b.deaths || 0)) return (a.deaths || 0) - (b.deaths || 0);
    return a.connectDate - b.connectDate;
  });

  // Create scoreboard entries
  playerData.forEach(player => {
    const entry = document.createElement('div');
    entry.className = 'scoreboardEntry' + (player.isCurrent ? ' current' : '');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'scoreboardName';
    nameSpan.textContent = player.name;

    const statsSpan = document.createElement('span');
    statsSpan.className = 'scoreboardStats';
    statsSpan.textContent = `${player.kills} / ${player.deaths}`;

    entry.appendChild(nameSpan);
    entry.appendChild(statsSpan);
    scoreboardList.appendChild(entry);
  });
}

function showMessage(text, type = '') {
  // Show a message in the chat window as if from SERVER
  const prefix = '<SERVER> ';
  chatMessages.push(prefix + text);
  if (chatMessages.length > CHAT_MAX_MESSAGES * 3) chatMessages.shift();
  updateChatWindow();
}

function checkIfOnObstacle(x, z, tankRadius = 2, y = null) {
  // Check if tank is positioned on top of an obstacle
  // Returns the obstacle if found, null otherwise
  for (const obs of OBSTACLES) {
    const halfW = obs.w / 2;
    const halfD = obs.d / 2;
    const rotation = obs.rotation || 0;
    const obstacleBase = obs.baseY || 0;
    const obstacleHeight = obs.h || 4;
    const obstacleTop = obstacleBase + obstacleHeight;

    // If Y provided, only check obstacles near that height
    if (y !== null && (y < obstacleTop - 1 || y > obstacleTop + 1)) {
      continue;
    }

    // Transform tank position to obstacle's local space
    const dx = x - obs.x;
    const dz = z - obs.z;

    // Rotate point to align with obstacle's axes
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;

    // Check if tank center is above obstacle (with some margin for edges)
    const margin = tankRadius * 0.7; // Allow tank to be partially over edge
    if (Math.abs(localX) <= halfW + margin && Math.abs(localZ) <= halfD + margin) {
      return obs;
    }
  }
  return null;
}

function checkCollision(x, z, tankRadius = 2, y = null) {
  const mapSize = gameConfig.MAP_SIZE || gameConfig.mapSize || 100;
  const halfMap = mapSize / 2;

  // Check map boundaries (always apply regardless of height)
  if (x - tankRadius < -halfMap || x + tankRadius > halfMap ||
      z - tankRadius < -halfMap || z + tankRadius > halfMap) {
    return true;
  }

  // Check obstacles - check vertical range
  for (const obs of OBSTACLES) {
    const obstacleHeight = obs.h || 4;
    const obstacleBase = obs.baseY || 0;
    const obstacleTop = obstacleBase + obstacleHeight;

    const halfW = obs.w / 2;
    const halfD = obs.d / 2;
    const rotation = obs.rotation || 0;

    // Transform tank position to obstacle's local space
    const dx = x - obs.x;
    const dz = z - obs.z;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;

    // Check if tank circle intersects with axis-aligned obstacle rectangle
    const closestX = Math.max(-halfW, Math.min(localX, halfW));
    const closestZ = Math.max(-halfD, Math.min(localZ, halfD));
    const distX = localX - closestX;
    const distZ = localZ - closestZ;
    const distSquared = distX * distX + distZ * distZ;

    if (distSquared < tankRadius * tankRadius) {
      if (y !== null) {
        const tankHeight = 2; // Default tank height
        const margin = 0.1;
        // Allow passing under if tank top is below obstacle base
        if (y + tankHeight <= obstacleBase + margin) {
          continue;
        }
        // Allow passing over if tank bottom is at or above obstacle top (with margin)
        if (y >= obstacleTop - margin) {
          continue;
        }
        // Block if any part of tank is inside the vertical range of the obstacle
        if (y > 0 && y < obstacleTop - margin && y + tankHeight > obstacleBase + margin) {
          const msg = `[COLLISION] Tank at (${x.toFixed(2)}, ${z.toFixed(2)}, y=${y !== null ? y.toFixed(2) : 'null'}) collided with obstacle at (${obs.x}, ${obs.z}), obstacleTop=${obstacleTop}, obstacleBase=${obstacleBase}`;
          sendToServer({ type: 'chat', text: msg });
          return true;
        }
      } else {
        return true;
      }
    }
  }

  return false;
}

function validateMove(x, y, z, intendedDeltaX, intendedDeltaY, intendedDeltaZ, tankRadius = 2) {

  // Pure function: no references to global state

  const newX = x + intendedDeltaX;
  const newZ = z + intendedDeltaZ;
  let landedOn = null;
  let landedType = null; // 'ground' or 'obstacle'
  // startedFalling is now just a flag for the caller to use if needed
  let startedFalling = false;

  // Try full movement first
  if (!checkCollision(newX, newZ, tankRadius, y)) {
    // Check for landing on obstacle
    let obstacle = null;
    for (const obs of OBSTACLES) {
      const halfW = obs.w / 2;
      const halfD = obs.d / 2;
      const rotation = obs.rotation || 0;
      const obstacleBase = obs.baseY || 0;
      const obstacleHeight = obs.h || 4;
      const obstacleTop = obstacleBase + obstacleHeight;
      const tankHeight = 2;
      const margin = 0.1;
      const dx = newX - obs.x;
      const dz = newZ - obs.z;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const localX = dx * cos - dz * sin;
      const localZ = dx * sin + dz * cos;
      const xyInBounds = Math.abs(localX) <= halfW + tankRadius * 0.7 && Math.abs(localZ) <= halfD + tankRadius * 0.7;
      // Only consider landing if tank is above obstacle base and below obstacle top
      if (xyInBounds && y !== null && y + tankHeight > obstacleBase + margin && y < obstacleTop - margin) {
        obstacle = obs;
        break;
      }
    }
    if (obstacle) {
      landedOn = obstacle;
      landedType = 'obstacle';
    } else if (y !== null && Math.abs(y) < 0.5) {
      landedType = 'ground';
    }
    // If not on obstacle or ground and y > 0.5, we are driving off an edge and should start falling
    if (!obstacle && (!y || y > 0.5)) {
      startedFalling = true;
    }
    const actualDX = newX - x;
    const actualDZ = newZ - z;
    const altered = Math.abs(actualDX - intendedDeltaX) > 1e-6 || Math.abs(actualDZ - intendedDeltaZ) > 1e-6;
    return { x: newX, z: newZ, moved: true, altered, landedOn, landedType, startedFalling };
  }

  // Find the collision normal
  const normal = getCollisionNormal(x, z, newX, newZ, tankRadius, y);

  if (normal) {
    // Project movement vector onto the surface (perpendicular to normal)
    const dot = intendedDeltaX * normal.x + intendedDeltaZ * normal.z;
    const slideX = intendedDeltaX - normal.x * dot;
    const slideZ = intendedDeltaZ - normal.z * dot;

    // Try sliding along the surface
    const slideNewX = x + slideX;
    const slideNewZ = z + slideZ;

    if (!checkCollision(slideNewX, slideNewZ, tankRadius, y)) {
      // Check for landing on obstacle
      let obstacle = null;
      for (const obs of OBSTACLES) {
        const halfW = obs.w / 2;
        const halfD = obs.d / 2;
        const rotation = obs.rotation || 0;
        const obstacleBase = obs.baseY || 0;
        const obstacleHeight = obs.h || 4;
        const obstacleTop = obstacleBase + obstacleHeight;
        if (y !== null && (y < obstacleTop - 1 || y > obstacleTop + 1)) {
          continue;
        }
        const dx = slideNewX - obs.x;
        const dz = slideNewZ - obs.z;
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        const localX = dx * cos - dz * sin;
        const localZ = dx * sin + dz * cos;
        const margin = tankRadius * 0.7;
        if (Math.abs(localX) <= halfW + margin && Math.abs(localZ) <= halfD + margin) {
          obstacle = obs;
          break;
        }
      }
      if (obstacle) {
        landedOn = obstacle;
        landedType = 'obstacle';
      } else if (y !== null && Math.abs(y) < 0.5) {
        landedType = 'ground';
      }
      const altered = Math.abs(slideX - intendedDeltaX) > 1e-6 || Math.abs(slideZ - intendedDeltaZ) > 1e-6;
      return { x: slideNewX, z: slideNewZ, moved: true, altered, landedOn, landedType };
    }
  }

  // Fallback: try axis-aligned sliding
  // Try sliding along X axis only
  if (!checkCollision(newX, z, tankRadius, y)) {
    let obstacle = null;
    for (const obs of OBSTACLES) {
      const halfW = obs.w / 2;
      const halfD = obs.d / 2;
      const rotation = obs.rotation || 0;
      const obstacleBase = obs.baseY || 0;
      const obstacleHeight = obs.h || 4;
      const obstacleTop = obstacleBase + obstacleHeight;
      if (y !== null && (y < obstacleTop - 1 || y > obstacleTop + 1)) {
        continue;
      }
      const dx = newX - obs.x;
      const dz = z - obs.z;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const localX = dx * cos - dz * sin;
      const localZ = dx * sin + dz * cos;
      const margin = tankRadius * 0.7;
      if (Math.abs(localX) <= halfW + margin && Math.abs(localZ) <= halfD + margin) {
        obstacle = obs;
        break;
      }
    }
    if (obstacle) {
      landedOn = obstacle;
      landedType = 'obstacle';
    } else if (y !== null && Math.abs(y) < 0.5) {
      landedType = 'ground';
    }
    const actualDX = newX - x;
    const actualDZ = 0;
    const altered = Math.abs(actualDX - intendedDeltaX) > 1e-6 || Math.abs(actualDZ - intendedDeltaZ) > 1e-6;
    return { x: newX, z: z, moved: true, altered, landedOn, landedType };
  }

  // Try sliding along Z axis only
  if (!checkCollision(x, newZ, tankRadius, y)) {
    let obstacle = null;
    for (const obs of OBSTACLES) {
      const halfW = obs.w / 2;
      const halfD = obs.d / 2;
      const rotation = obs.rotation || 0;
      const obstacleBase = obs.baseY || 0;
      const obstacleHeight = obs.h || 4;
      const obstacleTop = obstacleBase + obstacleHeight;
      if (y !== null && (y < obstacleTop - 1 || y > obstacleTop + 1)) {
        continue;
      }
      const dx = x - obs.x;
      const dz = newZ - obs.z;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const localX = dx * cos - dz * sin;
      const localZ = dx * sin + dz * cos;
      const margin = tankRadius * 0.7;
      if (Math.abs(localX) <= halfW + margin && Math.abs(localZ) <= halfD + margin) {
        obstacle = obs;
        break;
      }
    }
    if (obstacle) {
      landedOn = obstacle;
      landedType = 'obstacle';
    } else if (y !== null && Math.abs(y) < 0.5) {
      landedType = 'ground';
    }
    const actualDX = 0;
    const actualDZ = newZ - z;
    const altered = Math.abs(actualDX - intendedDeltaX) > 1e-6 || Math.abs(actualDZ - intendedDeltaZ) > 1e-6;
    return { x: x, z: newZ, moved: true, altered, landedOn, landedType };
  }

  // No movement possible
  return { x: x, z: z, moved: false, altered: false, landedOn: null, landedType: null };
}

function getCollisionNormal(fromX, fromZ, toX, toZ, tankRadius = 2, y = null) {
  const mapSize = gameConfig.mapSize;
  const halfMap = mapSize / 2;

  // Check map boundaries
  if (toX - tankRadius < -halfMap) return { x: 1, z: 0 };
  if (toX + tankRadius > halfMap) return { x: -1, z: 0 };
  if (toZ - tankRadius < -halfMap) return { x: 0, z: 1 };
  if (toZ + tankRadius > halfMap) return { x: 0, z: -1 };

  // Check obstacles
  for (const obs of OBSTACLES) {
    const obstacleHeight = obs.h || 4;
    const obstacleBase = obs.baseY || 0;
    const obstacleTop = obstacleBase + obstacleHeight;

    // If tank can pass under or over, skip its normal
    if (y !== null && (y < obstacleBase || y >= obstacleTop * 0.75)) {
      continue;
    }
    const halfW = obs.w / 2;
    const halfD = obs.d / 2;
    const rotation = obs.rotation || 0;

    // Transform target position to obstacle's local space
    const dx = toX - obs.x;
    const dz = toZ - obs.z;

    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;

    // Check if there's a collision
    const closestX = Math.max(-halfW, Math.min(localX, halfW));
    const closestZ = Math.max(-halfD, Math.min(localZ, halfD));

    const distX = localX - closestX;
    const distZ = localZ - closestZ;
    const distSquared = distX * distX + distZ * distZ;

    if (distSquared < tankRadius * tankRadius) {
      // Calculate normal in local space
      let normalLocalX = 0;
      let normalLocalZ = 0;

      if (distSquared > 0.0001) {
        // Normal points from closest point to tank center
        const dist = Math.sqrt(distSquared);
        normalLocalX = distX / dist;
        normalLocalZ = distZ / dist;
      } else {
        // Tank center is inside obstacle, determine which edge is closest
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

      // Transform normal back to world space
      const cosRot = Math.cos(rotation);
      const sinRot = Math.sin(rotation);
      const normalX = normalLocalX * cosRot - normalLocalZ * sinRot;
      const normalZ = normalLocalX * sinRot + normalLocalZ * cosRot;

      // Normalize
      const length = Math.sqrt(normalX * normalX + normalZ * normalZ);
      return { x: normalX / length, z: normalZ / length };
    }
  }

  return null;
}
function toggleMouseMode() {
  mouseControlEnabled = !mouseControlEnabled;
  localStorage.setItem('mouseControlEnabled', mouseControlEnabled);
  showMessage(`Controls: ${mouseControlEnabled ? 'Mouse' : 'Keyboard'}`);
  if (typeof updateHudButtons === 'function') updateHudButtons();
}

function handleInput(deltaTime) {
  if (!myTank || !gameConfig) return;

  // Block all movement when paused or during countdown
  if (isPaused || pauseCountdownStart > 0) return;

  // Check if tank is in the air (not on ground or obstacle)
  const verticalVel = myTank ? (myTank.userData.verticalVelocity || 0) : 0;
  const onGround = myTank && Math.abs(myTank.position.y) < 0.5;
  // Check if on any obstacle by looking for obstacles at current position
  let onObstacle = false;
  if (myTank) {
    for (const obs of OBSTACLES) {
      const obstacleHeight = obs.h || 4;
      const obstacleBase = obs.baseY || 0;
      const obstacleTop = obstacleBase + obstacleHeight;
      if (Math.abs(myTank.position.y - obstacleTop) < 0.5) {
        const dx = myTank.position.x - obs.x;
        const dz = myTank.position.z - obs.z;
        const cos = Math.cos(obs.rotation || 0);
        const sin = Math.sin(obs.rotation || 0);
        const localX = dx * cos - dz * sin;
        const localZ = dx * sin + dz * cos;
        const margin = 2 * 0.7;
        if (Math.abs(localX) <= obs.w / 2 + margin && Math.abs(localZ) <= obs.d / 2 + margin) {
          onObstacle = true;
          break;
        }
      }
    }
  }
  // Tank is in air if not on ground AND not on obstacle (velocity doesn't matter)
  const isInAir = myTank && !onGround && !onObstacle;

  // If just started jumping and momentum not yet captured, capture it now
  if (isInAir && verticalVel > 5 && jumpMomentumForward === 0 && jumpMomentumRotation === 0) {
    if (mouseControlEnabled) {
      jumpMomentumForward = -mouseY;
      jumpMomentumRotation = -mouseX;
    } else {
      if (keys['KeyW']) jumpMomentumForward = 1.0;
      else if (keys['KeyS']) jumpMomentumForward = -1.0;
      if (keys['KeyA']) jumpMomentumRotation = 1.0;
      else if (keys['KeyD']) jumpMomentumRotation = -1.0;
    }
  }

  // --- Step 1: Gather intended speed and angular motion from all sources ---
  let intendedForward = 0; // -1..1
  let intendedRotation = 0; // -1..1

    // WASD keys: pressing any disables mouse move mode
    const wasdKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
    let wasdPressed = false;
    for (const code of wasdKeys) {
      if (keys[code]) {
        intendedForward += (code === 'KeyW') ? 1 : (code === 'KeyS') ? -1 : 0;
        intendedRotation += (code === 'KeyA') ? 1 : (code === 'KeyD') ? -1 : 0;
        wasdPressed = true;
      }
    }
    if (wasdPressed && mouseControlEnabled) {
      toggleMouseMode();
    }

  // Mouse analog (if enabled)
  if (mouseControlEnabled) {
    if (typeof mouseY !== 'undefined') intendedForward += -mouseY;
    if (typeof mouseX !== 'undefined') intendedRotation += -mouseX;
  }

  // Jump/momentum (if in air)
  if (isInAir) {
    if (jumpMomentumForward !== 0) intendedForward += jumpMomentumForward;
    if (jumpMomentumRotation !== 0) intendedRotation += jumpMomentumRotation;
  }

  // --- Step 2: Clamp intended values to -1..1 (if needed) ---
  intendedForward = Math.max(-1, Math.min(1, intendedForward));
  intendedRotation = Math.max(-1, Math.min(1, intendedRotation));

  // --- Step 3: Convert intended speed/rotation to deltas ---
  const speed = gameConfig.TANK_SPEED * deltaTime;
  const rotSpeed = gameConfig.TANK_ROTATION_SPEED * deltaTime;
  let intendedDeltaX = Math.sin(playerRotation) * intendedForward * speed;
  let intendedDeltaZ = Math.cos(playerRotation) * intendedForward * speed;
  let intendedDeltaRot = intendedRotation * rotSpeed;

  // Track old position to calculate actual movement
  let moved = false;
  const oldX = playerX;
  const oldZ = playerZ;
  const oldRotation = playerRotation;

  // --- Step 4: Apply rotation ---
  playerRotation += intendedDeltaRot;

  // --- Step 5: Apply collision/slide logic to the intended move ---
  const tankY = myTank ? myTank.position.y : 0;
  const result = validateMove(playerX, playerY, playerZ, intendedDeltaX, 0, intendedDeltaZ, 2);
  if (result.altered) {
    //showMessage(`slideMove: from (${playerX.toFixed(2)}, ${playerZ.toFixed(2)}) by (Δx=${intendedDeltaX.toFixed(2)}, Δz=${intendedDeltaZ.toFixed(2)}) → (${result.x.toFixed(2)}, ${result.z.toFixed(2)}) moved=${result.moved} altered=${result.altered}`);
  }
  if (result.moved) {
    playerX = result.x;
    playerZ = result.z;
    moved = true;
    // Only log if altered
  } else {
    // If blocked, the caller should handle input state cleanup if needed
  }

  // When on ground and not jumping, maintain proper height (ground or obstacle)
  let currentlyOnObstacle = false;
  if (myTank && Math.abs(myTank.userData.verticalVelocity || 0) < 1) {
    // Use validateMove to determine landing and falling
    const moveResult = validateMove(playerX, myTank.position.y, playerZ, 0, 0, 0, 2);
    if (moveResult.landedType === 'obstacle' && moveResult.landedOn) {
      // On top of obstacle - maintain height
      const obstacleBase = moveResult.landedOn.baseY || 0;
      const obstacleHeight = moveResult.landedOn.h || 4;
      const obstacleTop = obstacleBase + obstacleHeight;
      myTank.position.y = obstacleTop;
      currentlyOnObstacle = true;
    } else if (moveResult.startedFalling) {
      // Not on obstacle or ground and elevated - start falling (drove off edge)
      if (!myTank.userData.verticalVelocity || myTank.userData.verticalVelocity === 0) {
        myTank.userData.verticalVelocity = -1; // Start falling
      }
    } else {
      // On ground
      myTank.position.y = 0;
    }
  }

  // Reset jump momentum only when actually on stable ground or obstacle (after movement)
  const currentlyOnGround = myTank && Math.abs(myTank.position.y) < 0.5;
  if (currentlyOnGround || currentlyOnObstacle) {
    jumpMomentumForward = 0;
    jumpMomentumRotation = 0;
  }

  // Calculate velocity based on actual movement that occurred
  let forwardSpeed = 0;
  let rotationSpeed = 0;

  if (deltaTime > 0) {
    // Calculate actual position change
    const actualDeltaX = playerX - oldX;
    const actualDeltaZ = playerZ - oldZ;

    // Project actual movement onto tank's forward direction
    const forwardX = Math.sin(playerRotation);
    const forwardZ = Math.cos(playerRotation);
    const actualDistance = Math.sqrt(actualDeltaX * actualDeltaX + actualDeltaZ * actualDeltaZ);

    if (actualDistance > 0.001) {
      // Calculate dot product to determine forward/backward speed
      const dot = (actualDeltaX * forwardX + actualDeltaZ * forwardZ) / actualDistance;
      const actualSpeed = actualDistance / deltaTime;
      const tankSpeed = gameConfig.TANK_SPEED;

      // Normalize to -1 to 1 range
      forwardSpeed = (dot * actualSpeed) / tankSpeed;
      forwardSpeed = Math.max(-1, Math.min(1, forwardSpeed));
    }

    // Calculate actual rotation change
    const actualRotationDelta = playerRotation - oldRotation;
    const tankRotSpeed = gameConfig.TANK_ROTATION_SPEED;
    rotationSpeed = actualRotationDelta / deltaTime / tankRotSpeed;
    rotationSpeed = Math.max(-1, Math.min(1, rotationSpeed));
  }

  // Store last speeds for jump momentum
  if (myTank) {
    myTank.userData.lastForwardSpeed = forwardSpeed;
    myTank.userData.lastRotationSpeed = rotationSpeed;
  }

  // Update local position
  if (moved) {
    myTank.position.set(playerX, myTank.position.y, playerZ);
    myTank.rotation.y = playerRotation;
  }

  // Dead reckoning: only send updates if significantly different from last sent state
  const now = performance.now();
  const timeSinceLastSend = now - lastSentTime;

  const positionDelta = Math.sqrt(
    Math.pow(playerX - lastSentX, 2) +
    Math.pow(playerZ - lastSentZ, 2)
  );
  const rotationDelta = Math.abs(playerRotation - lastSentRotation);

  const shouldSendUpdate =
    positionDelta > POSITION_THRESHOLD ||
    rotationDelta > ROTATION_THRESHOLD ||
    timeSinceLastSend > MAX_UPDATE_INTERVAL;

  if (shouldSendUpdate && ws && ws.readyState === WebSocket.OPEN) {
    const verticalVelocity = myTank ? (myTank.userData.verticalVelocity || 0) : 0;
    const y = myTank ? myTank.position.y : 1;

    sendToServer({
      type: 'move',
      x: playerX,
      y: y,
      z: playerZ,
      rotation: playerRotation,
      deltaTime: deltaTime,
      forwardSpeed: forwardSpeed,
      rotationSpeed: rotationSpeed,
      verticalVelocity: verticalVelocity,
    });

    // Update last sent state
    lastSentX = playerX;
    lastSentZ = playerZ;
    lastSentRotation = playerRotation;
    lastSentTime = now;
  }

  // Shooting
  if (keys['Space']) {
    const now = Date.now();
    if (now - lastShotTime > gameConfig.SHOT_COOLDOWN) {
      shoot();
      lastShotTime = now;
    }
  }
}

function shoot() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const dirX = Math.sin(playerRotation);
  const dirZ = Math.cos(playerRotation);

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

function updateProjectiles() {
  projectiles.forEach((projectile, id) => {
    projectile.position.x += projectile.userData.dirX * 0.3;
    projectile.position.z += projectile.userData.dirZ * 0.3;
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
      shield.position.y = 2;
    }
  });
}

function updateCamera() {
  if (cameraMode === 'overview' || !myTank) {
    // Overview camera (used at name dialog and after death)
    camera.position.set(0, 15, 20);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    return;
  }

  if (cameraMode === 'first-person') {
    // Hide tank body and turret in first-person view
    if (myTank.userData.body) {
      myTank.userData.body.visible = false;
    }
    if (myTank.userData.turret) {
      myTank.userData.turret.visible = false;
    }

    // First-person view - inside the tank turret
    const fpOffset = new THREE.Vector3(
      Math.sin(playerRotation) * 0.5,
      2.2, // Eye level inside turret
      Math.cos(playerRotation) * 0.5
    );
    camera.position.copy(myTank.position).add(fpOffset);

    // Look forward in the direction the tank is facing
    const lookTarget = new THREE.Vector3(
      myTank.position.x + Math.sin(playerRotation) * 10,
      myTank.position.y + 2,
      myTank.position.z + Math.cos(playerRotation) * 10
    );
    camera.lookAt(lookTarget);
  } else {
    // Show tank body and turret in third-person view
    if (myTank.userData.body) {
      myTank.userData.body.visible = true;
    }
    if (myTank.userData.turret) {
      myTank.userData.turret.visible = true;
    }

    // Third-person view - lower and flatter for better forward visibility
    const cameraOffset = new THREE.Vector3(
      -Math.sin(playerRotation) * 12,
      4,
      -Math.cos(playerRotation) * 12
    );
    camera.position.copy(myTank.position).add(cameraOffset);
    camera.lookAt(myTank.position);
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
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

function updateCompass() {
  if (!myTank) return;

  const needle = document.querySelector('.compass-needle');
  if (!needle) return;

  // Convert tank rotation to degrees (Three.js uses radians, Y-axis rotation)
  // Negate because Three.js Y rotation is counterclockwise when viewed from above
  const degrees = -(myTank.rotation.y * 180 / Math.PI);

  // Rotate the needle
  needle.style.transform = `translate(-50%, -50%) rotate(${degrees}deg)`;
}

function updateRadar() {
  if (!radarCtx) return;

  const size = radarCanvas.width;
  const mapSize = gameConfig ? gameConfig.MAP_SIZE : 100; // Game map is 100x100
  const scale = size / mapSize;

  // Clear radar
  radarCtx.fillStyle = 'rgba(0, 0, 0, 0.8)';
  radarCtx.fillRect(0, 0, size, size);

  // Draw border
  radarCtx.strokeStyle = 'rgba(76, 175, 80, 0.8)';
  radarCtx.lineWidth = 2;
  radarCtx.strokeRect(0, 0, size, size);

  // Draw boundary walls (brown)
  radarCtx.fillStyle = 'rgba(139, 69, 19, 0.6)';
  const wallThickness = 1 * scale;
  // North wall
  radarCtx.fillRect(0, 0, size, wallThickness);
  // South wall
  radarCtx.fillRect(0, size - wallThickness, size, wallThickness);
  // West wall
  radarCtx.fillRect(0, 0, wallThickness, size);
  // East wall
  radarCtx.fillRect(size - wallThickness, 0, wallThickness, size);

  // Draw obstacles (gray boxes)
  radarCtx.fillStyle = 'rgba(102, 102, 102, 0.8)';

  OBSTACLES.forEach(obs => {
    const centerX = (obs.x + mapSize / 2) * scale;
    const centerZ = (obs.z + mapSize / 2) * scale;

    radarCtx.save();
    radarCtx.translate(centerX, centerZ);
    radarCtx.rotate(obs.rotation || 0);

    const rw = obs.w * scale;
    const rd = obs.d * scale;
    radarCtx.fillRect(-rw / 2, -rd / 2, rw, rd);

    radarCtx.restore();
  });

  // Draw projectiles
  projectiles.forEach((projectile) => {
    const x = (projectile.position.x + mapSize / 2) * scale;
    const z = (projectile.position.z + mapSize / 2) * scale;

    radarCtx.fillStyle = 'rgba(255, 255, 0, 0.8)';
    radarCtx.beginPath();
    radarCtx.arc(x, z, 2, 0, Math.PI * 2);
    radarCtx.fill();
  });

  // Draw tanks as triangles
  tanks.forEach((tank, playerId) => {
    const x = (tank.position.x + mapSize / 2) * scale;
    const z = (tank.position.z + mapSize / 2) * scale;

    // Get tank rotation and adjust for radar coordinate system
    // Negate rotation for canvas Y-down coordinate system
    // Add PI to flip triangle 180° so it points forward
    const rotation = -tank.rotation.y + Math.PI;
    const triangleHeight = playerId === myPlayerId ? 12 : 10;
    const triangleBase = playerId === myPlayerId ? 8 : 6;

    // Set color based on player
    if (playerId === myPlayerId) {
      radarCtx.fillStyle = 'rgba(33, 150, 243, 1)'; // Blue
    } else {
      radarCtx.fillStyle = 'rgba(255, 87, 34, 1)'; // Orange
    }

    radarCtx.save();
    radarCtx.translate(x, z);
    radarCtx.rotate(rotation);

    // Draw triangle pointing forward (narrow end at front, wide end at back)
    radarCtx.beginPath();
    radarCtx.moveTo(0, -triangleHeight / 2); // Front tip (narrow)
    radarCtx.lineTo(-triangleBase / 2, triangleHeight / 2); // Back left (wide)
    radarCtx.lineTo(triangleBase / 2, triangleHeight / 2); // Back right (wide)
    radarCtx.closePath();
    radarCtx.fill();

    radarCtx.restore();
  });
}

function updateTreads(deltaTime) {
  tanks.forEach((tank, playerId) => {
    // Initialize tracking variables
    if (!tank.userData.leftTreadOffset) {
      tank.userData.leftTreadOffset = 0;
      tank.userData.rightTreadOffset = 0;
    }

    // Get velocity (either from network for other players, or from local input for my tank)
    let forwardSpeed = 0;
    let rotationSpeed = 0;

    if (playerId === myPlayerId) {
      // For my tank, calculate from current input
      if (mouseControlEnabled) {
        // Mouse control - proportional, no dead zone
        forwardSpeed = -mouseY; // Negative because screen Y is inverted
        rotationSpeed = -mouseX; // Negative because positive mouseX means turn right
      } else {
        // Keyboard control - digital on/off
        if (keys['KeyW']) {
          forwardSpeed = 1.0;
        } else if (keys['KeyS']) {
          forwardSpeed = -1.0;
        }

        if (keys['KeyA']) {
          rotationSpeed = 1.0;
        } else if (keys['KeyD']) {
          rotationSpeed = -1.0;
        }
      }
    } else {
      // For other players, use velocity from network
      forwardSpeed = tank.userData.forwardSpeed || 0;
      rotationSpeed = tank.userData.rotationSpeed || 0;
    }

    // Tank tread width (distance between tread centers)
    const treadWidth = 3.5;

    // Calculate base movement amounts
    const tankSpeed = gameConfig ? gameConfig.TANK_SPEED : 5;
    const tankRotSpeed = gameConfig ? gameConfig.TANK_ROTATION_SPEED : 2;

    const forwardDistance = forwardSpeed * tankSpeed * deltaTime;
    const rotationDistance = rotationSpeed * tankRotSpeed * deltaTime * treadWidth / 2;

    // Left tread speed (positive rotation = turn right, left tread goes faster)
    const leftDistance = forwardDistance + rotationDistance;
    // Right tread speed (positive rotation = turn right, right tread goes slower)
    const rightDistance = forwardDistance - rotationDistance;

    // Adjust multiplier for more realistic tread speed
    const treadSpeed = 0.5;
    tank.userData.leftTreadOffset += leftDistance * treadSpeed;
    tank.userData.rightTreadOffset += rightDistance * treadSpeed;

    // Animate left tread textures
    if (tank.userData.leftTreadTextures) {
      for (let i = 0; i < tank.userData.leftTreadTextures.length; i++) {
        const texture = tank.userData.leftTreadTextures[i];
        if (texture && texture.offset) {
          texture.offset.x = tank.userData.leftTreadOffset;
        }
      }
    }

    // Animate right tread textures
    if (tank.userData.rightTreadTextures) {
      for (let i = 0; i < tank.userData.rightTreadTextures.length; i++) {
        const texture = tank.userData.rightTreadTextures[i];
        if (texture && texture.offset) {
          texture.offset.x = tank.userData.rightTreadOffset;
        }
      }
    }
  });
}

function updateClouds(deltaTime) {
  const mapSize = gameConfig ? gameConfig.MAP_SIZE : 100;
  const mapBoundary = mapSize / 2;

  clouds.forEach((cloud) => {
    // Move cloud across the sky (in X direction)
    cloud.position.x += cloud.userData.velocity * deltaTime;

    // Wrap around when cloud goes past the boundary
    if (cloud.position.x > mapBoundary + 30) {
      cloud.position.x = -mapBoundary - 30;
    }
  });
}

let lastTime = performance.now();

function updateChatWindow() {
  const chatWindow = document.getElementById('chatWindow');
  if (!chatWindow) return;
  // Only update the message area, not the input
  const chatInput = document.getElementById('chatInput');
  // Remove all children except the input
  while (chatWindow.firstChild) {
    if (chatWindow.firstChild !== chatInput) {
      chatWindow.removeChild(chatWindow.firstChild);
    } else {
      break;
    }
  }
  let shown = 0;
  // Add messages above the input
  for (let i = Math.max(0, chatMessages.length - CHAT_MAX_MESSAGES); i < chatMessages.length; i++) {
    const msg = chatMessages[i];
    const div = document.createElement('div');
    div.textContent = msg;
    chatWindow.insertBefore(div, chatInput);
    shown++;
  }
}

function animate() {
    // Update chat window every frame (for fade-out, etc.)
  updateChatWindow();
  requestAnimationFrame(animate);

  const now = performance.now();
  const deltaTime = (now - lastTime) / 1000;
  lastTime = now;

  handleInput(deltaTime);

  // Client-side jump physics prediction
  if (myTank && gameConfig) {
    const verticalVelocity = myTank.userData.verticalVelocity || 0;

    if (verticalVelocity !== 0 || myTank.position.y > 0.1) {
      // Apply gravity
      const nextVerticalVelocity = verticalVelocity - gameConfig.GRAVITY * deltaTime;
      const tankHeight = 2;
      const nextY = myTank.position.y + nextVerticalVelocity * deltaTime;
      // Check for collision above (jumping up into obstacle)
      if (nextVerticalVelocity > 0 && checkCollision(myTank.position.x, myTank.position.z, 2, nextY)) {
        // Block upward movement into obstacle
        myTank.userData.verticalVelocity = 0;
      } else {
        myTank.userData.verticalVelocity = nextVerticalVelocity;
        myTank.position.y += myTank.userData.verticalVelocity * deltaTime;
      }

      // Prevent tank from going below ground
      if (myTank.position.y < 0) {
        myTank.position.y = 0;
        myTank.userData.verticalVelocity = 0;
        jumpMomentumForward = 0;
        jumpMomentumRotation = 0;
      }

      // Check for landing
      if (myTank.userData.verticalVelocity <= 0) {
        // Check if landing on top of an obstacle
        const obstacle = checkIfOnObstacle(myTank.position.x, myTank.position.z, 2);

        if (obstacle) {
          const obstacleBase = obstacle.baseY || 0;
          const obstacleHeight = obstacle.h || 4;
          const obstacleTop = obstacleBase + obstacleHeight;
          if (myTank.position.y <= obstacleTop && myTank.position.y > obstacleTop - 2) {
            // Landing on top of obstacle
            myTank.position.y = obstacleTop;
            myTank.userData.verticalVelocity = 0;
            jumpMomentumForward = 0;
            jumpMomentumRotation = 0;

            // Play land sound only if we haven't already played it for this landing
            if (!myTank.userData.hasLanded) {
              if (landSound && landSound.isPlaying) {
                landSound.stop();
              }
              if (landSound) {
                landSound.play();
              }
              myTank.userData.hasLanded = true;
            }
          }
        } else if (myTank.position.y <= 0) {
          // Landing on ground
          myTank.position.y = 0;
          myTank.userData.verticalVelocity = 0;
          jumpMomentumForward = 0;
          jumpMomentumRotation = 0;

          // Play land sound only if we haven't already played it for this landing
          if (!myTank.userData.hasLanded) {
            if (landSound && landSound.isPlaying) {
              landSound.stop();
            }
            if (landSound) {
              landSound.play();
            }
            myTank.userData.hasLanded = true;
          }
        }
      }
    }
  }

  updateProjectiles();
  updateShields();
  updateTreads(deltaTime);
  updateClouds(deltaTime);
  updateCamera();
  updateCompass();
  updateRadar();

  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

// Start the game
init();
