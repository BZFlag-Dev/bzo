/*
 * This file is part of a project licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * See the LICENSE file in the project root or visit https://www.gnu.org/licenses/agpl-3.0.html
 */

// Detect mobile browser
function isMobileBrowser() {
  const ua = navigator.userAgent || navigator.vendor || window.opera;
  // Standard mobile detection
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return true;
  // iPadOS 13+ sends Mac OS user agent, but has touch support and screen size like iPad
  const isIpad = (
    (navigator.platform === 'MacIntel' && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1) ||
    // Some browsers use iPad in user agent but not in platform
    (/iPad/.test(ua))
  );
  return isIpad;
}
const isMobile = isMobileBrowser();

let virtualInput = { forward: 0, turn: 0, fire: false, jump: false };
let lastVirtualJump = false;
if (isMobile) {
  console.log('Mobile device detected, enabling virtual joystick and buttons.');
  window.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('controlsOverlay');
    if (overlay) overlay.style.display = 'block';
    const joystick = document.getElementById('joystick');
    const knob = document.getElementById('joystickKnob');
    const fireBtn = document.getElementById('fireBtn');
    const jumpBtn = document.getElementById('jumpBtn');
    let joystickActive = false;
    let joystickTouchId = null;
    let joystickCenter = { x: 0, y: 0 };
    function setJoystick(x, y) {
      // Clamp to circle
      const mag = Math.sqrt(x * x + y * y);
      if (mag > 1) { x /= mag; y /= mag; }
      virtualInput.forward = -y; // Up is forward
      virtualInput.turn = -x;
      if (knob) knob.style.transform = `translate(${x * 35}px, ${y * 35}px)`;
    }
    function handleJoystickStart(e) {
      // Only start joystick if touch is within joystick element
      if (e.touches && e.touches.length > 0) {
        // Find the touch that started within the joystick
        for (let i = 0; i < e.touches.length; i++) {
          const touch = e.touches[i];
          const rect = joystick.getBoundingClientRect();
          if (
            touch.clientX >= rect.left && touch.clientX <= rect.right &&
            touch.clientY >= rect.top && touch.clientY <= rect.bottom
          ) {
            joystickActive = true;
            joystickTouchId = touch.identifier;
            joystickCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            handleJoystickMove(e);
            e.preventDefault();
            break;
          }
        }
      } else {
        // Mouse event
        joystickActive = true;
        joystickTouchId = null;
        const rect = joystick.getBoundingClientRect();
        joystickCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        handleJoystickMove(e);
        e.preventDefault();
      }
    }
    function handleJoystickMove(e) {
      if (!joystickActive) return;
      let clientX, clientY;
      if (e.touches && e.touches.length > 0) {
        // Find the touch matching joystickTouchId
        let found = false;
        for (let i = 0; i < e.touches.length; i++) {
          const touch = e.touches[i];
          if (touch.identifier === joystickTouchId) {
            clientX = touch.clientX;
            clientY = touch.clientY;
            found = true;
            break;
          }
        }
        if (!found) return;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }
      const dx = clientX - joystickCenter.x;
      const dy = clientY - joystickCenter.y;
      setJoystick(dx / 60, dy / 60);
      e.preventDefault();
    }
    function handleJoystickEnd(e) {
      if (e.changedTouches && e.changedTouches.length > 0) {
        // Only end joystick if the touch ending matches joystickTouchId
        for (let i = 0; i < e.changedTouches.length; i++) {
          const touch = e.changedTouches[i];
          if (touch.identifier === joystickTouchId) {
            joystickActive = false;
            joystickTouchId = null;
            setJoystick(0, 0);
            e.preventDefault();
            break;
          }
        }
      } else {
        // Mouse event
        joystickActive = false;
        joystickTouchId = null;
        setJoystick(0, 0);
        e.preventDefault();
      }
    }
    if (joystick) {
      joystick.addEventListener('touchstart', handleJoystickStart);
      joystick.addEventListener('touchmove', handleJoystickMove);
      joystick.addEventListener('touchend', handleJoystickEnd);
      joystick.addEventListener('mousedown', handleJoystickStart);
      window.addEventListener('mousemove', handleJoystickMove);
      window.addEventListener('mouseup', handleJoystickEnd);
    }
    if (fireBtn) {
      function setFirePressed(pressed) {
        if (pressed) fireBtn.classList.add('pressed');
        else fireBtn.classList.remove('pressed');
      }
      fireBtn.addEventListener('touchstart', e => { e.preventDefault(); virtualInput.fire = true; setFirePressed(true); });
      fireBtn.addEventListener('touchend', e => { e.preventDefault(); virtualInput.fire = false; setFirePressed(false); });
      fireBtn.addEventListener('mousedown', e => { e.preventDefault(); virtualInput.fire = true; setFirePressed(true); });
      fireBtn.addEventListener('mouseup', e => { e.preventDefault(); virtualInput.fire = false; setFirePressed(false); });
      fireBtn.addEventListener('mouseleave', e => { setFirePressed(false); });
      fireBtn.addEventListener('touchcancel', e => { setFirePressed(false); });
    }
    if (jumpBtn) {
      function setJumpPressed(pressed) {
        if (pressed) jumpBtn.classList.add('pressed');
        else jumpBtn.classList.remove('pressed');
      }
      jumpBtn.addEventListener('touchstart', e => { e.preventDefault(); virtualInput.jump = true; setJumpPressed(true); });
      jumpBtn.addEventListener('touchend', e => { e.preventDefault(); virtualInput.jump = false; setJumpPressed(false); });
      jumpBtn.addEventListener('mousedown', e => { e.preventDefault(); virtualInput.jump = true; setJumpPressed(true); });
      jumpBtn.addEventListener('mouseup', e => { e.preventDefault(); virtualInput.jump = false; setJumpPressed(false); });
      jumpBtn.addEventListener('mouseleave', e => { setJumpPressed(false); });
      jumpBtn.addEventListener('touchcancel', e => { setJumpPressed(false); });
    }
  });
}
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
  if (isMobile) {
    latestOrientation.status = 'Mobile device detected';
    requestOrientationPermission();
  }
}

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


// Input state
const keys = {};
let lastShotTime = 0;

// Operator Panel logic: make globally accessible
function updateOperatorBtn() {
  const operatorBtn = document.getElementById('operatorBtn');
  const operatorOverlay = document.getElementById('operatorOverlay');
  if (!operatorBtn || !operatorOverlay) return;
  if (operatorOverlay.style.display === 'block') {
    operatorBtn.classList.add('active');
    operatorBtn.title = 'Hide Operator Panel (O)';
  } else {
    operatorBtn.classList.remove('active');
    operatorBtn.title = 'Show Operator Panel (O)';
  }
}

function toggleOperatorPanel() {
  const operatorOverlay = document.getElementById('operatorOverlay');
  if (!operatorOverlay) return;
  // Use computed style to check visibility
  const computedStyle = window.getComputedStyle(operatorOverlay);
  const isVisible = computedStyle.display !== 'none';
  if (isVisible) {
    operatorOverlay.style.setProperty('display', 'none');
    showMessage('Operator Panel: Hidden');
    console.log('OperatorOverlay display set to none:', operatorOverlay.style.display);
  } else {
    operatorOverlay.style.setProperty('display', 'block');
    showMessage('Operator Panel: Shown');
    console.log('OperatorOverlay display set to block:', operatorOverlay.style.display);
    // Request map list from server when panel is shown
    if (window.ws && window.ws.readyState === 1) {
      const reqId = Math.floor(Math.random() * 1e9);
      window.ws.send(JSON.stringify({ type: 'admin', action: 'getMaps', adminReqId: reqId }));
      window._operatorMapReqId = reqId;
    }
  }
  updateOperatorBtn();
}

// Mouse movement toggle button
window.addEventListener('DOMContentLoaded', () => {
  // Prevent mouse events on huds from passing through and triggering game actions
  const mainhud = document.getElementById('mainhud');
  if (mainhud) {
    ['click', 'mousedown', 'mouseup'].forEach(evt => {
      mainhud.addEventListener(evt, function(e) {
        e.stopPropagation();
        e.preventDefault();
      });
    });
  }
  const operatorOverlay = document.getElementById('operatorOverlay');
  if (operatorOverlay) {
    ['click', 'mousedown', 'mouseup'].forEach(evt => {
      operatorOverlay.addEventListener(evt, function(e) {
        e.stopPropagation();
        e.preventDefault();
      });
    });
  }
  const entryDialog = document.getElementById('entryDialog');
  if (entryDialog) {
    ['click', 'mousedown', 'mouseup'].forEach(evt => {
      entryDialog.addEventListener(evt, function(e) {
        e.stopPropagation();
        e.preventDefault();
      });
    });
  }
  
  setupMobileOrientationDebug();
  const mouseBtn = document.getElementById('mouseBtn');
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const debugBtn = document.getElementById('debugBtn');
  const cameraBtn = document.getElementById('cameraBtn');
  const helpBtn = document.getElementById('helpBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsHud = document.getElementById('settingsHud');
  const playerNameEl = document.getElementById('playerName');
  const helpPanel = document.getElementById('helpPanel');
  
  function updateSettingsBtn() {
    if (!settingsHud || !settingsBtn) return;
    if (settingsHud.style.display === 'block') {
      settingsBtn.classList.add('active');
      settingsBtn.title = 'Hide Settings';
    } else {
      settingsBtn.classList.remove('active');
      settingsBtn.title = 'Show Settings';
    }
  }

  function toggleSettingsHud() {
    if (!settingsHud) return;
    if (settingsHud.style.display === 'block') {
      settingsHud.style.display = 'none';
      showMessage('Settings: Hidden');
    } else {
      settingsHud.style.display = 'block';
      showMessage('Settings: Shown');
    }
    updateSettingsBtn();
  }
  function updateHelpBtn() {
    if (!helpPanel || !helpBtn) return;
    if (helpPanel.style.display === 'block') {
      helpBtn.classList.add('active');
      helpBtn.title = 'Hide Help (?)';
    } else {
      helpBtn.classList.remove('active');
      helpBtn.title = 'Show Help (?)';
    }
  }

  function toggleHelpPanel() {
    if (!helpPanel) return;
    if (helpPanel.style.display === 'block') {
      helpPanel.style.display = 'none';
      showMessage('Help Panel: Hidden');
    } else {
      helpPanel.style.display = 'block';
      showMessage('Help Panel: Shown');
    }
    updateHelpBtn();
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
    setTimeout(() => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const msg = `Screen resolution: ${w}x${h}`;
      chatMessages.push(msg);
      updateChatWindow();
    }, 200);
    setTimeout(updateHudButtons, 100);
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

  // Restore camera mode from localStorage
  const savedCameraMode = localStorage.getItem('cameraMode');
  if (savedCameraMode === 'first-person' || savedCameraMode === 'third-person' || savedCameraMode === 'overview') {
    cameraMode = savedCameraMode;
  }
  // Restore mouse mode from localStorage
  const savedMouseMode = localStorage.getItem('mouseControlEnabled');
  if (savedMouseMode === 'true') mouseControlEnabled = true;

  // Attach HUD Button Handlers (only once)
  if (mouseBtn) mouseBtn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); toggleMouseMode(); });
  if (fullscreenBtn) fullscreenBtn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); toggleFullscreen(); });
  if (debugBtn) debugBtn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); toggleDebugHud(); });
  if (cameraBtn) cameraBtn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); toggleCameraMode(); });
  if (helpBtn) helpBtn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); toggleHelpPanel(); });
  if (helpBtn) updateHelpBtn();
  if (settingsBtn) settingsBtn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); toggleSettingsHud(); });
  if (operatorBtn) operatorBtn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); toggleSettingsHud(); toggleOperatorPanel(); });
  if (closeOperatorBtn) closeOperatorBtn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); toggleOperatorPanel(); });
  if (operatorBtn) updateOperatorBtn();
  if (playerNameEl) playerNameEl.addEventListener('click', () => {
    localStorage.removeItem('playerName');
    if (window.ws && window.ws.readyState === 1) {
      window.ws.send(JSON.stringify({ type: 'leaveGame' }));
    }
    // Remove old tank from scene if present
    if (window.myTank && window.scene) {
      window.scene.remove(window.myTank);
      window.myTank = null;
    }
    if (typeof window.cameraMode !== 'undefined') {
      window.cameraMode = 'overview';
    }
    const entryDialog = document.getElementById('entryDialog');
    if (entryDialog) {
      entryDialog.style.display = 'block';
    }
    window.isPaused = true;
  });

  // Attach Key Handlers
  document.addEventListener('keydown', (e) => {
    if (document.activeElement === chatInput) return;
    if (document.activeElement === entryInput) return;
    if (e.key === 'm' || e.key === 'M') toggleMouseMode();
    else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    else if (e.key === 'i' || e.key === 'I') toggleDebugHud();
    else if (e.key === 'c' || e.key === 'C') toggleCameraMode();
    else if (e.key === 'o' || e.key === 'O') toggleOperatorPanel();
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
    toggleDebugHud();
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
    const entryDialog = document.getElementById('entryDialog');
    const isentryDialogOpen = entryDialog && entryDialog.style.display === 'block';

    // Allow pause/unpause with P key even when paused
    if (e.code === 'KeyP') {
      sendToServer({ type: 'pause' });
      // Don't block other UI, but don't process further game input
      e.preventDefault();
      return;
    }

    // Activate chat with / or t, but NOT if name dialog is open
    if (!chatActive && !isentryDialogOpen && (e.key === '/' || e.key === 't' || e.key === 'T')) {
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
        return;
      }
      // Close help dialog if open
      if (helpPanel.style.display === 'block') {
        toggleHelpPanel();
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
  let isentryDialogOpen = false;
  if (savedName && savedName.trim().length > 0) {
    const trimmed = savedName.trim();
    // Show dialog if name is 'Player' or 'Player n'
    if (trimmed === 'Player' || /^Player \d+$/.test(trimmed)) {
      if (entryDialog) {
        entryDialog.style.display = 'block';
        isPaused = true;
        isentryDialogOpen = true;
        if (entryInput) {
          entryInput.value = '';
          entryInput.focus();
        }
      }
    } else {
      myPlayerName = savedName;
      // Join game directly
      if (entryDialog) entryDialog.style.display = 'none';
      isentryDialogOpen = false;
    }
  } else {
    // Pause and show name dialog
    if (entryDialog) {
      entryDialog.style.display = 'block';
      isPaused = true;
      isentryDialogOpen = true;
      if (entryInput) {
        entryInput.value = '';
        entryInput.focus();
      }
    }
  }

  // Add click handler for name change
  const playerNameEl = document.getElementById('playerName');
  const nameOkButton = document.getElementById('nameOkButton');
  const nameDefaultButton = document.getElementById('nameDefaultButton');
  const nameCancelButton = document.getElementById('nameCancelButton');

  if (playerNameEl && entryDialog) {
    playerNameEl.addEventListener('click', () => {
      entryInput.value = myPlayerName;
      entryDialog.style.display = 'block';
      isPaused = true;
      isentryDialogOpen = true;
      entryInput.focus();
      entryInput.select();
    });

    // Stop clicks from propagating to the game
    entryDialog.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    nameOkButton.addEventListener('click', () => {
      const newName = entryInput.value.trim().substring(0, 20);
      if (newName.length > 0) {
        localStorage.setItem('playerName', newName);
        myPlayerName = newName;
        // Always leave and rejoin
        if (window.ws && window.ws.readyState === 1) {
          window.ws.send(JSON.stringify({ type: 'leaveGame' }));
        }
        window.hasJoinedGame = false;
        sendToServer({
          type: 'joinGame',
          name: newName,
          isMobile: isMobile,
        });
        window.hasJoinedGame = true;
        entryDialog.style.display = 'none';
        isPaused = false;
        isentryDialogOpen = false;
      }
    });

    nameDefaultButton.addEventListener('click', () => {
      // Send blank name to server to request default Player n assignment
      localStorage.setItem('playerName', '');
      myPlayerName = '';
      if (window.ws && window.ws.readyState === 1) {
        window.ws.send(JSON.stringify({ type: 'leaveGame' }));
      }
      window.hasJoinedGame = false;
      sendToServer({
        type: 'joinGame',
        name: "",
      });
      window.hasJoinedGame = true;
      entryDialog.style.display = 'none';
      isPaused = false;
      isentryDialogOpen = false;
    });

    nameCancelButton.addEventListener('click', () => {
      // Don't allow cancel if no name is set
      if (!localStorage.getItem('playerName')) {
        entryInput.focus();
        return;
      }
      entryDialog.style.display = 'none';
      isPaused = false;
      isentryDialogOpen = false;
    });

    entryInput.addEventListener('keypress', (e) => {
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

  // North wall (red, now at Z = -mapSize/2)
  const northWall = new THREE.Mesh(
    new THREE.BoxGeometry(mapSize + wallThickness * 2, wallHeight, wallThickness),
    nsWallMaterials
  );
  northWall.position.set(0, wallHeight / 2, -mapSize / 2 - wallThickness / 2);
  northWall.castShadow = true;
  northWall.receiveShadow = true;
  scene.add(northWall);

  // Add giant 'N' above north wall
  (function() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 256);
    ctx.font = 'bold 200px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#B20000';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 10;
    ctx.strokeText('N', 128, 128);
    ctx.fillText('N', 128, 128);
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: true });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(0, wallHeight + 8, -mapSize / 2);
    sprite.scale.set(20, 20, 1);
    scene.add(sprite);
  })();

  // South wall (blue, now at Z = +mapSize/2)
  const southWall = new THREE.Mesh(
    new THREE.BoxGeometry(mapSize + wallThickness * 2, wallHeight, wallThickness),
    nsWallMaterials
  );
  southWall.position.set(0, wallHeight / 2, mapSize / 2 + wallThickness / 2);
  southWall.castShadow = true;
  southWall.receiveShadow = true;
  scene.add(southWall);

  // Add giant 'S' above south wall
  (function() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 256);
    ctx.font = 'bold 200px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#1976D2';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 10;
    ctx.strokeText('S', 128, 128);
    ctx.fillText('S', 128, 128);
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: true });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(0, wallHeight + 8, mapSize / 2);
    sprite.scale.set(20, 20, 1);
    scene.add(sprite);
  })();

  // East wall (+X, green)
  const eastWall = new THREE.Mesh(
    new THREE.BoxGeometry(wallThickness, wallHeight, mapSize),
    ewWallMaterials
  );
  eastWall.position.set(mapSize / 2 + wallThickness / 2, wallHeight / 2, 0);
  eastWall.castShadow = true;
  eastWall.receiveShadow = true;
  scene.add(eastWall);

  // Add giant 'E' above east wall
  (function() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 256);
    ctx.font = 'bold 200px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#388E3C';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 10;
    ctx.strokeText('E', 128, 128);
    ctx.fillText('E', 128, 128);
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: true });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(mapSize / 2, wallHeight + 8, 0);
    sprite.scale.set(20, 20, 1);
    scene.add(sprite);
  })();

  // West wall (-X, yellow)
  const westWall = new THREE.Mesh(
    new THREE.BoxGeometry(wallThickness, wallHeight, mapSize),
    ewWallMaterials
  );
  westWall.position.set(-mapSize / 2 - wallThickness / 2, wallHeight / 2, 0);
  westWall.castShadow = true;
  westWall.receiveShadow = true;
  scene.add(westWall);

  // Add giant 'W' above west wall
  (function() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 256);
    ctx.font = 'bold 200px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FBC02D';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 10;
    ctx.strokeText('W', 128, 128);
    ctx.fillText('W', 128, 128);
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: true });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(-mapSize / 2, wallHeight + 8, 0);
    sprite.scale.set(20, 20, 1);
    scene.add(sprite);
  })();

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
    const h = obs.h || 4;
    const baseY = obs.baseY || 0;
    let mesh;
    if (obs.type === 'pyramid') {
      // Pyramid: use ConeGeometry with 4 sides (square base)
      // Always use a unit square base (side 1) for geometry, then scale to match obs.d and obs.w
      const geometry = new THREE.ConeGeometry(0.5 / Math.SQRT2, h, 4, 1); // base square: 1x1
      // Ensure geometry groups for multi-material: sides (0), base (1)
      geometry.clearGroups();
      // Sides: faces 0 to geometry.index.count - 4 (each face is 3 indices, last 4 faces are base)
      geometry.addGroup(0, geometry.index.count - 12, 0); // sides
      geometry.addGroup(geometry.index.count - 12, 12, 1); // base (last 4 faces)
      geometry.rotateY(-Math.PI / 4); // align with axes
      // Rotate so long side runs North-South (Y axis)
      if (obs.w > obs.d) {
        geometry.rotateY(Math.PI / 2);
      }
      // Scale to match obs.w (X) and obs.d (Z) so base is exactly obs.w x obs.d in world
      geometry.scale(2 * obs.w, 1, 2 * obs.d);
      if (obs.inverted) {
        geometry.rotateX(Math.PI); // Invert pyramid
      }
      // Use concrete texture for pyramid base (same as box top/bottom)
      const concreteTexture = createObstacleTexture();
      concreteTexture.wrapS = THREE.RepeatWrapping;
      concreteTexture.wrapT = THREE.RepeatWrapping;
      concreteTexture.repeat.set(obs.w, obs.d);
      // Invert texture for inverted pyramids
      if (obs.inverted) {
        concreteTexture.rotation = Math.PI;
        concreteTexture.center.set(0.5, 0.5);
      }
      const pyramidTexture = createPyramidTexture();
      pyramidTexture.wrapS = THREE.RepeatWrapping;
      pyramidTexture.wrapT = THREE.RepeatWrapping;
      pyramidTexture.repeat.set(obs.w, obs.h);
      // Multi-material: [sides, base]
      mesh = new THREE.Mesh(
        geometry,
        [
          new THREE.MeshLambertMaterial({ map: pyramidTexture, flatShading: true }), // sides
          new THREE.MeshLambertMaterial({ map: concreteTexture, flatShading: true })  // base
        ]
      );
      // For inverted, base is on top, so adjust position
      if (obs.inverted) {
        mesh.position.set(obs.x, baseY + h / 2, obs.z);
      } else {
        mesh.position.set(obs.x, baseY + h / 2, obs.z);
      }
      mesh.rotation.y = obs.rotation || 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      obstacleMeshes.push(mesh);
    } else {
      // Box (default, now aligned: width=X=w, depth=Z=d)
      const concreteTexture = createObstacleTexture();
      concreteTexture.wrapS = THREE.RepeatWrapping;
      concreteTexture.wrapT = THREE.RepeatWrapping;
      // Tile concrete texture by world units
      concreteTexture.repeat.set(obs.w, h);
      const wallTexture = createWallTexture();
      wallTexture.wrapS = THREE.RepeatWrapping;
      wallTexture.wrapT = THREE.RepeatWrapping;
      // Tile wall texture by world units
      wallTexture.repeat.set(obs.d, h);
      const materials = [
        new THREE.MeshLambertMaterial({ map: wallTexture.clone() }), // right
        new THREE.MeshLambertMaterial({ map: wallTexture.clone() }), // left
        new THREE.MeshLambertMaterial({ map: concreteTexture.clone() }), // top
        new THREE.MeshLambertMaterial({ map: concreteTexture.clone() }), // bottom
        new THREE.MeshLambertMaterial({ map: wallTexture.clone() }), // front
        new THREE.MeshLambertMaterial({ map: wallTexture.clone() })  // back
      ];
      // Sides: repeat by world units (corrected)
      materials[0].map.repeat.set(obs.d, h); // right
      materials[1].map.repeat.set(obs.d, h); // left
      materials[4].map.repeat.set(obs.w, h); // front
      materials[5].map.repeat.set(obs.w, h); // back
      // Top/bottom: repeat by world units
      materials[2].map.repeat.set(obs.w, obs.d); // top
      materials[3].map.repeat.set(obs.w, obs.d); // bottom
      materials.forEach(m => { m.map.needsUpdate = true; });
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(obs.w, h, obs.d), // Aligned: width=X=w, depth=Z=d
        materials
      );
      mesh.position.set(obs.x, baseY + h / 2, obs.z);
      mesh.rotation.y = obs.rotation || 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      obstacleMeshes.push(mesh);
    }
  });
}

// Sand-like texture for BZFlag-style pyramids
function createPyramidTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  // Base BZFlag blue color
  ctx.fillStyle = '#3a5fa9'; // BZFlag default blue
  ctx.fillRect(0, 0, 128, 128);
  // Add some noise for grain (blue shades)
  for (let i = 0; i < 4000; i++) {
    const x = Math.random() * 128;
    const y = Math.random() * 128;
    const alpha = Math.random() * 0.15 + 0.05;
    ctx.fillStyle = `rgba(58, 95, 169, ${alpha.toFixed(2)})`;
    ctx.fillRect(x, y, 1, 1);
  }
  // Subtle horizontal lines for wind effect (lighter blue)
  ctx.globalAlpha = 0.08;
  ctx.strokeStyle = '#7faaff';
  for (let y = 0; y < 128; y += 8) {
    ctx.beginPath();
    ctx.moveTo(0, y + Math.random() * 2);
    ctx.lineTo(128, y + Math.random() * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1.0;
  return new THREE.CanvasTexture(canvas);
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
  // body.rotation.y = Math.PI; // No rotation: face +Z at rad=0
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
  // turret.rotation.y = Math.PI; // No rotation: face +Z at rad=0
  tankGroup.add(turret);
  tankGroup.userData.turret = turret; // Store reference for hiding in first-person

  // Tank barrel
  const barrelGeometry = new THREE.CylinderGeometry(0.2, 0.2, 3, 8);
  const barrelMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 });
  const barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 1.7, -1.5); // Point barrel toward -Z
  barrel.castShadow = true;
  // barrel.rotation.y = Math.PI; // No rotation: face +Z at rad=0
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

  const tank = tanks.get(myPlayerId);
  if (!tank) {
    debugContent.innerHTML = '<div>No player tank data available.</div>';
    return;
  }

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
    try {
    html += `<div><span class="label">Speed:</span><span class="value">${tank.userData.forwardSpeed.toFixed(2)} u/s</span></div>`;
    html += `<div><span class="label">Angular:</span><span class="value">${tank.userData.rotationSpeed.toFixed(2)} rad/s</span></div>`;
    html += `<div><span class="label">Vertical:</span><span class="value">${tank.userData.verticalSpeed.toFixed(2)} u/s</span></div>`;
    } catch (e) {}
    html += `<div><span class="label">Position:</span><span class="value">(${tank.position.x.toFixed(1)}, ${myTank ? myTank.position.y.toFixed(1) : '0.0'}, ${myTank.position.z.toFixed(1)})</span></div>`;
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

  ws.onopen = () => {
    showMessage('Connected to server!');
    showMessage('Updating coordinates, things are broken');

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
  };
}

function handleServerMessage(message) {
  // Intercept admin responses for operator panel
  if (message.adminReqId && (message.maps || message.success || message.error)) {
    handleAdminResponse(message);
    return;
  }
  switch (message.type) {
    case 'newPlayer':
      // Add player to scoreboard as dead, but do not create tank in scene
      if (message.player) {
        addPlayer(message.player);
        updateScoreboard();
      }
      break;
    case 'init':
      // Show server info in entryDialog
      const serverNameEl = document.getElementById('serverName');
      const serverDescriptionEl = document.getElementById('serverDescription');
      const serverMotdEl = document.getElementById('serverMotd');
      if (serverNameEl) serverNameEl.textContent = 'Server: ' + (message.serverName || '');
      if (serverDescriptionEl) serverDescriptionEl.textContent = message.description || '';
      if (serverMotdEl) serverMotdEl.textContent = message.motd || '';
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
        const entryInput = document.getElementById('entryInput');
        const entryDialog = document.getElementById('entryDialog');
        if (entryInput && entryDialog) {
          entryInput.value = message.player.defaultName;
          entryDialog.style.display = 'block';
          isPaused = true;
          entryInput.focus();
          entryInput.select();
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
        myTank.userData.fowardSpeed = message.player.forwardSpeed || 0;
        myTank.userData.rotationSpeed = message.player.rotationSpeed || 0;
        scene.add(myTank);
        tanks.set(myPlayerId, myTank);

        updateStats(message.player);
        updateScoreboard();
      } else {
        // Another player joined: update their info and create their tank if needed
        addPlayer(message.player);
        updateScoreboard();
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
      break;

    case 'playerMoved':
      const tank = tanks.get(message.id);
      if (tank && message.id !== myPlayerId) {
        const oldY = tank.position.y;
        const oldVerticalVel = tank.userData.verticalVelocity || 0;

        tank.position.set(message.x, message.y, message.z);
        tank.rotation.y = message.rotation;
        // Store velocity for tread animation
        tank.userData.forwardSpeed = message.forwardSpeed;
        tank.userData.rotationSpeed = message.rotationSpeed;
        tank.userData.verticalVelocity = message.verticalVelocity;

        // Detect jump (vertical velocity suddenly became positive and large)
        if (oldVerticalVel < 10 && message.verticalVelocity >= 20) {
          // Play jump sound at tank's position
          if (jumpSound && jumpSound.context) {
            try {
              const jumpSoundClone = jumpSound.clone();
              tank.add(jumpSoundClone);
              jumpSoundClone.setVolume(0.4);
              jumpSoundClone.play();
              // Remove sound after playing
              setTimeout(() => tank.remove(jumpSoundClone), 200);
            } catch (error) {
            }
          }
        }

        // Detect landing
        if (oldVerticalVel < 0 && message.verticalVelocity === 0 && oldY > message.y) {
          // Play land sound at tank's position
          if (landSound && landSound.context) {
            try {
              const landSoundClone = landSound.clone();
              tank.add(landSoundClone);
              landSoundClone.setVolume(0.5);
              landSoundClone.play();
              // Remove sound after playing
              setTimeout(() => tank.remove(landSoundClone), 150);
            } catch (error) {
            }
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
      console.log('Player paused:', message.playerId, message.x, message.y, message.z);
      if (message.playerId === myPlayerId) {
        isPaused = true;
        pauseCountdownStart = 0;
        showMessage('PAUSED - Press P to unpause', 'death');
      }
      createShield(message.playerId, message.x, message.y, message.z);
      break;

    case 'playerUnpaused':
      console.log('Player unpaused:', message.playerId);
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

  const tank = createTank(0xFF5722, player.name);
  tank.position.set(player.x, player.y, player.z);
  tank.rotation.y = player.rotation;
  tank.userData.playerState = player; // Store player state for scoreboard
  tank.userData.verticalVelocity = player.verticalVelocity;
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

function createShield(playerId, x, y, z) {
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
  shield.position.set(x, y + 2, z);
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
    const y = 0;
    tank.position.set(message.player.x, message.player.y, message.player.z);
    tank.rotation.y = message.player.rotation;
    tank.userData.verticalVelocity = message.player.verticalVelocity;
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

function checkCollision(x, y, z, tankRadius = 2) {
  const mapSize = gameConfig.MAP_SIZE || gameConfig.mapSize || 100;
  const halfMap = mapSize / 2;

  // Check map boundari es (always apply regardless of height)
  if (x - tankRadius < -halfMap || x + tankRadius > halfMap ||
      z - tankRadius < -halfMap || z + tankRadius > halfMap) {
    return true;
  }

  // Check obstacles - check vertical range
  for (const obs of OBSTACLES) {
    const obstacleHeight = obs.h || 4;
    const obstacleBase = obs.baseY || 0;
    const obstacleTop = obstacleBase + obstacleHeight;
    const epsilon = 0.15;
    if (y >= obstacleTop - epsilon) continue;
    const tankHeight = 2;
    if (y + tankHeight <= obstacleBase + epsilon) continue;
    const halfW = obs.w / 2;
    const halfD = obs.d / 2;
    const rotation = obs.rotation || 0;
    const dx = x - obs.x;
    const dz = z - obs.z;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;
    if (obs.type === 'box' || !obs.type) {
      const margin = tankRadius * 0.7;
      const closestX = Math.max(-halfW, Math.min(localX, halfW));
      const closestZ = Math.max(-halfD, Math.min(localZ, halfD));
      const distX = localX - closestX;
      const distZ = localZ - closestZ;
      const distSquared = distX * distX + distZ * distZ;
      if (distSquared < tankRadius * tankRadius) {
        if (y < obstacleBase && y + tankHeight > obstacleBase) {
          if (typeof sendToServer === 'function') {
            sendToServer({ type: 'chat', to: -1, text: `[COLLISION] ${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)} ${obs.name}:${obs.x.toFixed(2)},${obstacleBase.toFixed(2)},${obs.z.toFixed(2)} rot:${(obs.rotation).toFixed(2)}, h:${obstacleHeight.toFixed(2)}, top:${obstacleTop.toFixed(2)}` });
          }
          return true;
        }
        if (y >= obstacleBase && y < obstacleTop) {
          if (typeof sendToServer === 'function') {
            sendToServer({ type: 'chat', to: -1,text: `[COLLISION] ${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)} ${obs.name}:${obs.x.toFixed(2)},${obstacleBase.toFixed(2)},${obs.z.toFixed(2)}, rot:${(obs.rotation||0).toFixed(2)}, h:${obstacleHeight.toFixed(2)}, top:${obstacleTop.toFixed(2)}` });
          }
          return true;
        }
      }
    } else if (obs.type === 'pyramid') {
      // Pyramid collision: check if tank is inside the pyramid's base, then check height at that (x,z)
      if (Math.abs(localX) <= halfW && Math.abs(localZ) <= halfD) {
        const nx = Math.abs(localX) / halfW;
        const nz = Math.abs(localZ) / halfD;
        const n = Math.max(nx, nz);
        const localY = y - obstacleBase;
        const maxPyramidY = obs.h * (1 - n);
        if (localY >= epsilon && localY < maxPyramidY - epsilon) {
          return true;
        }
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
  let landedOn = null;
  let landedType = null; // 'ground' or 'obstacle'
  let startedFalling = false;
  let altered = false;
  if (newY < 0) {
      landedType = 'ground';
      altered = true
      return { x: newX, y: 0, z: newZ, moved: true, altered, landedOn, landedType, startedFalling };
  }

  // Try full movement first
  if (!checkCollision(newX, newY, newZ, tankRadius)) {
    // Check for on obstacle
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
      const xyInBounds = Math.abs(localX) <= halfW + tankRadius && Math.abs(localZ) <= halfD + tankRadius;
      if (xyInBounds) {
        if (intendedDeltaY <= 0 && newY >= obstacleTop && newY <= obstacleTop + margin) {
          // on top
          obstacle = obs;
          landedOn = obstacle;
          landedType = 'obstacle';
          break;
        } else if (intendedDeltaY > 0 && newY < obstacleBase && newY + tankHeight + margin > obstacleBase) {
          // will hit bottom
          obstacle = obs;
          landedOn = obstacle;
          landedType = 'obstacle';
          break;
        }
      }
    }
    if (!obstacle && intendedDeltaY == 0 && y > 0) {
      // If not on obstacle or ground we are driving off an edge and should start falling
      startedFalling = true;
      return { x: newX, y: newY - 0.1, z: newZ, moved: true, altered, landedOn, landedType, startedFalling };
    }
    const actualDX = newX - x;
    const actualDZ = newZ - z;
    altered = Math.abs(actualDX - intendedDeltaX) > 1e-6 || Math.abs(actualDZ - intendedDeltaZ) > 1e-6;
    return { x: newX, y: newY, z: newZ, moved: true, altered, landedOn, landedType, startedFalling };
  }

  // Find the collision normal
  const normal = getCollisionNormal(x, y, z, newX, newY, newZ, tankRadius);

  if (normal) {
    // Project movement vector onto the surface (perpendicular to normal)
    const dot = intendedDeltaX * normal.x + intendedDeltaZ * normal.z;
    const slideX = intendedDeltaX - normal.x * dot;
    const slideZ = intendedDeltaZ - normal.z * dot;

    // Try sliding along the surface
    const slideNewX = x + slideX;
    const slideNewZ = z + slideZ;

    if (!checkCollision(slideNewX, newY, slideNewZ, tankRadius)) {
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
        const dx = slideNewX - obs.x;
        const dz = slideNewZ - obs.z;
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
      const altered = Math.abs(slideX - intendedDeltaX) > 1e-6 || Math.abs(slideZ - intendedDeltaZ) > 1e-6;
      return { x: slideNewX, y: newY, z: slideNewZ, moved: true, altered, landedOn, landedType };
    }
  }

  // Fallback: try axis-aligned sliding
  // Try sliding along X axis only
  if (!checkCollision(newX, y, z, tankRadius)) {
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
    return { x: newX, y: newY, z: z, moved: true, altered, landedOn, landedType };
  }

  // Try sliding along Z axis only
  if (!checkCollision(x, y, newZ, tankRadius)) {
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
    return { x: x, y: newY, z: newZ, moved: true, altered, landedOn, landedType };
  }

  // No movement possible
  return { x: x, y: y, z: z, moved: false, altered: false, landedOn: null, landedType: null };
}

function getCollisionNormal(fromX, fromY, fromZ, toX, toY, toZ, tankRadius = 2) {
  const mapSize = gameConfig.mapSize;
  const halfMap = mapSize / 2;

  // Check map boundaries
  if (toX - tankRadius < -halfMap) return { x: 1, z: 0 };
  if (toX + tankRadius > halfMap) return { x: -1, z: 0 };
  if (toZ - tankRadius < -halfMap) return { x: 0, z: 1 };
  if (toZ + tankRadius > halfMap) return { x: 0, z: -1 };

  // Check obstacles
  for (const obs of OBSTACLES) {
    const obstacleHeight = obs.h;
    const obstacleBase = obs.baseY;
    const obstacleTop = obstacleBase + obstacleHeight;

    // If tank can pass under or over, skip its normal
    if (toY + tankRadius <= obstacleBase || toY >= obstacleTop) {
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

// Intended input state
let intendedForward = 0; // -1..1
let intendedRotation = 0; // -1..1
let intendedY = 0; // -1..1 (for jump/momentum)
let jumpTriggered = false;
let isInAir = false;

function handleInputEvents() {
  // Reset intended input each frame
  intendedForward = 0;
  intendedRotation = 0;
  intendedY = 0;
  jumpTriggered = false;

  if (!myTank || !gameConfig) return;

  // Check if tank is in the air (not on ground or obstacle)
  const onGround = myTank.position.y < 0.1;
  let onObstacle = false;
  if (onGround) {
    myTank.userData.verticalVelocity = 0;
    playerY = 0;
  } else {
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
          myTank.userData.verticalVelocity = 0;
          playerY = obstacleTop;
          break;
        }
      }
    }
  }
  isInAir = !onGround && !onObstacle;

  if (isPaused || pauseCountdownStart > 0) return;

  // Gather intended input from controls
  if (isInAir) {
    intendedForward = myTank.userData.forwardSpeed || 0;
    intendedRotation = myTank.userData.rotationSpeed || 0;
  } else {
    if (isMobile) {
      intendedForward = virtualInput.forward;
      intendedRotation = virtualInput.turn;
      if (!isInAir && virtualInput.jump) {
        intendedY = 1;
        jumpTriggered = true;
      }
    } else {
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
      if ((keys['Tab']) && !isInAir) {
        intendedY = 1;
        jumpTriggered = true;
      }
      if (mouseControlEnabled) {
        if (typeof mouseY !== 'undefined') intendedForward = -mouseY;
        if (typeof mouseX !== 'undefined') intendedRotation = -mouseX;
      }
    }
  }
  intendedForward = Math.max(-1, Math.min(1, intendedForward));
  intendedRotation = Math.max(-1, Math.min(1, intendedRotation));
  intendedY = Math.max(-1, Math.min(1, intendedY));
}

function handleMotion(deltaTime) {
  if (!myTank || !gameConfig) return;
  if (isPaused || pauseCountdownStart > 0) return;

  let moved = false;
  const oldX = playerX;
  const oldZ = playerZ;
  const oldRotation = playerRotation;

  // Step 3: Convert intended speed/rotation to deltas
  const speed = gameConfig.TANK_SPEED * deltaTime;
  const rotSpeed = gameConfig.TANK_ROTATION_SPEED * deltaTime;
  let intendedDeltaX = -Math.sin(playerRotation) * intendedForward * speed;
  let intendedDeltaY = 0;
  let intendedDeltaZ = -Math.cos(playerRotation) * intendedForward * speed;
  let intendedDeltaRot = intendedRotation * rotSpeed;
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

  if (jumpTriggered && !isInAir) {
    myTank.userData.verticalVelocity = gameConfig.JUMP_VELOCITY || 30;
    intendedDeltaY = myTank.userData.verticalVelocity * deltaTime;
    if (jumpSound && jumpSound.isPlaying) jumpSound.stop();
    if (jumpSound) jumpSound.play();
  }

  const result = validateMove(playerX, playerY, playerZ, intendedDeltaX, intendedDeltaY, intendedDeltaZ, 2);

  if (result.startedFalling) {
    myTank.userData.verticalVelocity = -0.01;
  } else if (result.landedOn) {
    myTank.userData.verticalVelocity = 0;
  }

  let forwardSpeed = 0;
  let rotationSpeed = myTank.userData.rotationSpeed || 0;

  if (result.moved) {
    playerX = result.x;
    playerY = result.y;
    playerZ = result.z;
    playerRotation = intendedRotation * rotSpeed + oldRotation;
    myTank.position.set(playerX, playerY, playerZ);
    myTank.rotation.y = playerRotation;
  }

  if (deltaTime > 0) {
    const actualDeltaX = playerX - oldX;
    const actualDeltaZ = playerZ - oldZ;
    const forwardX = -Math.sin(playerRotation);
    const forwardZ = -Math.cos(playerRotation);
    const actualDistance = Math.sqrt(actualDeltaX * actualDeltaX + actualDeltaZ * actualDeltaZ);
    if (actualDistance > 0.001) {
      const dot = (actualDeltaX * forwardX + actualDeltaZ * forwardZ) / actualDistance;
      const actualSpeed = actualDistance / deltaTime;
      const tankSpeed = gameConfig.TANK_SPEED;
      forwardSpeed = (dot * actualSpeed) / tankSpeed;
      forwardSpeed = Math.max(-1, Math.min(1, forwardSpeed));
    }
    if (!(myTank.position.y > 0)) {
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
      y: playerY,
      z: playerZ,
      rotation: playerRotation,
      deltaTime: deltaTime,
      forwardSpeed: forwardSpeed,
      rotationSpeed: rotationSpeed,
      verticalVelocity: verticalVelocity,
    });
    lastSentX = playerX;
    lastSentZ = playerZ;
    lastSentRotation = playerRotation;
    lastSentTime = now;
  }
  if ((isMobile && virtualInput.fire) || (!isMobile && keys['Space'])) {
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
      shield.position.y = tank.position.y + 2;
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
        -Math.sin(playerRotation) * 0.5,
        2.2, // Eye level inside turret
        -Math.cos(playerRotation) * 0.5
      );
      camera.position.copy(myTank.position).add(fpOffset);

      // Look forward in the direction the tank is facing
      const lookTarget = new THREE.Vector3(
        myTank.position.x - Math.sin(playerRotation) * 10,
        myTank.position.y + 2,
        myTank.position.z - Math.cos(playerRotation) * 10
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
      Math.sin(playerRotation) * 12,
      4,
      Math.cos(playerRotation) * 12
    );
    camera.position.copy(myTank.position).add(cameraOffset);
    camera.lookAt(new THREE.Vector3(
      myTank.position.x - Math.sin(playerRotation) * 10,
      myTank.position.y + 3,
      myTank.position.z - Math.cos(playerRotation) * 10
    ));
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
  const pz = myTank.position.z;
  const playerHeading = myTank.rotation ? myTank.rotation.y : 0;
  // No radarRotation; use playerHeading directly
  // Clear radar
  radarCtx.clearRect(0, 0, size, size);

  // Draw world border (clip to SHOT_DISTANCE area, rotated to player forward)
  if (gameConfig && gameConfig.MAP_SIZE) {
    radarCtx.save();
    radarCtx.globalAlpha = 0.7;
    radarCtx.translate(center, center);
    radarCtx.beginPath();
    // Calculate visible world border segment within SHOT_DISTANCE
    const border = mapSize / 2;
    const left = Math.max(px - SHOT_DISTANCE, -border);
    const right = Math.min(px + SHOT_DISTANCE, border);
    const top = Math.max(pz - SHOT_DISTANCE, -border);
    const bottom = Math.min(pz + SHOT_DISTANCE, border);
    // Draw each edge if visible in radar
    const toRadar = (wx, wz) => {
      const dx = wx - px;
      const dz = wz - pz;
      const rotX = dx * Math.cos(playerHeading) - dz * Math.sin(playerHeading);
      const rotY = dx * Math.sin(playerHeading) + dz * Math.cos(playerHeading);
      return [
        (rotX / SHOT_DISTANCE) * (radius - 16),
        (rotY / SHOT_DISTANCE) * (radius - 16)
      ];
    };
    // Top edge (North, Z = -border)
    if (top === -border) {
      const [x1, y1] = toRadar(left, -border);
      const [x2, y2] = toRadar(right, -border);
      radarCtx.save();
      radarCtx.strokeStyle = '#B20000'; // North - red
      radarCtx.lineWidth = 2.5;
      radarCtx.setLineDash([6, 6]);
      radarCtx.beginPath();
      radarCtx.moveTo(x1, y1);
      radarCtx.lineTo(x2, y2);
      radarCtx.stroke();
      radarCtx.restore();
    }
    // Bottom edge (South, Z = +border)
    if (bottom === border) {
      const [x1, y1] = toRadar(left, border);
      const [x2, y2] = toRadar(right, border);
      radarCtx.save();
      radarCtx.strokeStyle = '#1976D2'; // South - blue
      radarCtx.lineWidth = 2.5;
      radarCtx.setLineDash([6, 6]);
      radarCtx.beginPath();
      radarCtx.moveTo(x1, y1);
      radarCtx.lineTo(x2, y2);
      radarCtx.stroke();
      radarCtx.restore();
    }
    // Left edge (West, X = -border)
    if (left === -border) {
      const [x1, y1] = toRadar(-border, top);
      const [x2, y2] = toRadar(-border, bottom);
      radarCtx.save();
      radarCtx.strokeStyle = '#FBC02D'; // West - yellow
      radarCtx.lineWidth = 2.5;
      radarCtx.setLineDash([6, 6]);
      radarCtx.beginPath();
      radarCtx.moveTo(x1, y1);
      radarCtx.lineTo(x2, y2);
      radarCtx.stroke();
      radarCtx.restore();
    }
    // Right edge (East, X = +border)
    if (right === border) {
      const [x1, y1] = toRadar(border, top);
      const [x2, y2] = toRadar(border, bottom);
      radarCtx.save();
      radarCtx.strokeStyle = '#388E3C'; // East - green
      radarCtx.lineWidth = 2.5;
      radarCtx.setLineDash([6, 6]);
      radarCtx.beginPath();
      radarCtx.moveTo(x1, y1);
      radarCtx.lineTo(x2, y2);
      radarCtx.stroke();
      radarCtx.restore();
    }
    radarCtx.restore();
  }

  // Draw projectiles (shots) within SHOT_DISTANCE, using same transform as map/obstacles
  if (typeof projectiles !== 'undefined' && projectiles.forEach) {
    projectiles.forEach((proj, id) => {
      const dx = proj.position.x - px;
      const dz = proj.position.z - pz;
      if (Math.abs(dx) > SHOT_DISTANCE || Math.abs(dz) > SHOT_DISTANCE) return;
      // Use same transform as tanks/obstacles
      const rotX = dx * Math.cos(playerHeading) - dz * Math.sin(playerHeading);
      const rotY = dx * Math.sin(playerHeading) + dz * Math.cos(playerHeading);
      const x = center + (rotX / SHOT_DISTANCE) * (radius - 16);
      const y = center + (rotY / SHOT_DISTANCE) * (radius - 16);
      radarCtx.save();
      radarCtx.beginPath();
      radarCtx.arc(x, y, 4, 0, Math.PI * 2);
      radarCtx.fillStyle = '#FFD700';
      radarCtx.globalAlpha = 0.85;
      radarCtx.shadowColor = '#FFD700';
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
      const dx = obs.x - px;
      const dz = obs.z - pz;
      if (Math.abs(dx) > SHOT_DISTANCE || Math.abs(dz) > SHOT_DISTANCE) return;
      // Rotate obstacle positions to match tanks and shots
      const rotX = dx * Math.cos(playerHeading) - dz * Math.sin(playerHeading);
      const rotY = dx * Math.sin(playerHeading) + dz * Math.cos(playerHeading);
      const x = center + (rotX / SHOT_DISTANCE) * (radius - 16);
      const y = center + (rotY / SHOT_DISTANCE) * (radius - 16);

      // Obstacle size scaling
      const scale = (radius - 16) / SHOT_DISTANCE;
      const w = (obs.w || 8) * scale;
      const d = (obs.d || 8) * scale;
      // Adjust rotation so that non-square buildings align with world axes
      const rot = (obs.rotation || 0) + playerHeading;
      radarCtx.save();
      radarCtx.translate(x, y);
      radarCtx.rotate(rot);
      radarCtx.globalAlpha = 0.5;
      radarCtx.fillStyle = 'rgba(180,180,180,0.5)';
      radarCtx.fillRect(-w/2, -d/2, w, d);
      radarCtx.restore();
    });
  }

  // Draw tanks within SHOT_DISTANCE, using same transform as map/obstacles/shots
  tanks.forEach((tank, playerId) => {
    if (!tank.position) return;
    // Only show on radar if alive and visible
    const state = tank.userData && tank.userData.playerState;
    if ((state && state.health <= 0) || tank.visible === false) return;
    const dx = tank.position.x - px;
    const dz = tank.position.z - pz;
    if (Math.abs(dx) > SHOT_DISTANCE || Math.abs(dz) > SHOT_DISTANCE) return;
    // Use radarRotation for all world-to-radar transforms
    const rotX = dx * Math.cos(playerHeading) - dz * Math.sin(playerHeading);
    const rotY = dx * Math.sin(playerHeading) + dz * Math.cos(playerHeading);
    const x = center + (rotX / SHOT_DISTANCE) * (radius - 16);
    const y = center + (rotY / SHOT_DISTANCE) * (radius - 16);

    radarCtx.save();
    radarCtx.translate(x, y);
    if (playerId === myPlayerId) {
      // Player tank: always point up (no rotation needed)
      radarCtx.beginPath();
      radarCtx.moveTo(0, -10);
      radarCtx.lineTo(-6, 8);
      radarCtx.lineTo(6, 8);
      radarCtx.closePath();
      radarCtx.fillStyle = 'rgba(33, 150, 243, 1)';
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
      radarCtx.fillStyle = 'rgba(255, 87, 34, 1)';
      radarCtx.globalAlpha = 0.95;
      radarCtx.fill();
    }
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

    // Always use tank.userData.forwardSpeed and rotationSpeed for all tanks
    const forwardSpeed = tank.userData.forwardSpeed || 0;
    const rotationSpeed = tank.userData.rotationSpeed || 0;

    // Tank tread width (distance between tread centers)
    const treadWidth = 3.5;

    // Calculate base movement amounts
    const tankSpeed = gameConfig ? gameConfig.TANK_SPEED : 5;
    const tankRotSpeed = gameConfig ? gameConfig.TANK_ROTATION_SPEED : 2;

    const forwardDistance = forwardSpeed * tankSpeed * deltaTime;
    const rotationDistance = rotationSpeed * tankRotSpeed * deltaTime * treadWidth / 2;

    // Left tread speed (positive rotation = turn right, left tread goes faster)
    const leftDistance = forwardDistance - rotationDistance;
    // Right tread speed (positive rotation = turn right, right tread goes slower)
    const rightDistance = forwardDistance + rotationDistance;

    // Adjust multiplier for more realistic tread speed
    const treadSpeed = 0.5;
    tank.userData.leftTreadOffset -= leftDistance * treadSpeed;
    tank.userData.rightTreadOffset -= rightDistance * treadSpeed;

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
}

function animate() {
  const now = performance.now();
  const deltaTime = (now - lastTime) / 1000;
  lastTime = now;

  updateChatWindow();
  requestAnimationFrame(animate);
  handleInputEvents();
  handleMotion(deltaTime);
  updateProjectiles();
  updateShields();
  updateTreads(deltaTime);
  updateClouds(deltaTime);
  updateCamera();
  updateRadar();

  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

// Start the game
init();
