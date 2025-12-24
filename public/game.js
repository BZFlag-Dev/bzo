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
  lastVirtualJump,
  initHudControls,
  latestOrientation,
  toggleMouseMode,
  hideHelpPanel,
  isMobile
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

// Input state
let lastShotTime = 0;

// Entry Dialog
function toggleEntryDialog(name = '') {
  const entryDialog = document.getElementById('entryDialog');
  const entryInput = document.getElementById('entryInput');
  if (!entryDialog || !entryInput) return;
  const isentryDialogOpen = entryDialog.style.display !== 'block';
  entryDialog.style.display = isentryDialogOpen ? 'block' : 'none';
  isPaused = isentryDialogOpen;
  if (isentryDialogOpen) {
    if (name === '') name = myPlayerName;
    lastCameraMode = cameraMode;
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
    cameraMode = 'first-person';
  }
}


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

// Dead reckoning state - track last sent velocities (not positions, since positions are extrapolated)
let lastSentForwardSpeed = 0;
let lastSentRotationSpeed = 0;
let lastSentVerticalVelocity = 0;
let lastSentTime = 0;
let worldTime = 0;
// Velocity-based thresholds: only send when velocity changes significantly
// Thresholds must be large enough to avoid noise from frame-to-frame velocity calculation variations
const VELOCITY_THRESHOLD = 0.15; // Send if forward/rotation speed changes by 15%
const VERTICAL_VELOCITY_THRESHOLD = 1.0; // Send if vertical velocity changes significantly
const MAX_UPDATE_INTERVAL = 5000; // Force update every 5 seconds

// Extrapolation state
let myJumpDirection = null; // null when on ground, rotation when in air
let showGhosts = localStorage.getItem('showGhosts') === 'true'; // Toggle for ghost rendering

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
let debugUpdateInterval = null;

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
    worldTime
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

      // Ghost toggle button
      const ghostBtn = document.getElementById('ghostBtn');
      if (ghostBtn) {
        ghostBtn.addEventListener('click', () => {
          showGhosts = !showGhosts;
          localStorage.setItem('showGhosts', showGhosts);
          ghostBtn.classList.toggle('active', showGhosts);
          ghostBtn.title = showGhosts ? 'Hide Ghost Players' : 'Show Ghost Players';
          // Update visibility of all ghost meshes (including local player)
          tanks.forEach((tank) => {
            if (tank.userData.ghostMesh) {
              tank.userData.ghostMesh.visible = showGhosts;
            }
          });
        });
        // Set initial state from localStorage
        ghostBtn.classList.toggle('active', showGhosts);
        ghostBtn.title = showGhosts ? 'Hide Ghost Players' : 'Show Ghost Players';
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
});

// Initialize Three.js
function init() {
  setupInputHandlers();

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
    toggleDebugHud({
      debugEnabled,
      setDebugEnabled: v => { debugEnabled = v; },
      updateHudButtons: () => updateHudButtons({ mouseBtn, mouseControlEnabled, debugBtn, debugEnabled, fullscreenBtn, cameraBtn, cameraMode }),
      showMessage,
      updateDebugDisplay,
      getDebugState: () => ({ fps, latency, packetsSent, packetsReceived, sentBps, receivedBps, playerX, playerY, playerZ, playerRotation, myTank, cameraMode, OBSTACLES, clouds: renderManager.getClouds(), latestOrientation })
    });
  }

  const renderContext = renderManager.init({});
  scene = renderContext.scene;
  camera = renderContext.camera;

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
  let isentryDialogOpen = false;
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
      });
      toggleEntryDialog();
    });

    entryInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        entrykButton.click();
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
  };
}

function handleServerMessage(message) {
  switch (message.type) {
    case 'init':
      // Show server info in entryDialog
      const serverNameEl = document.getElementById('serverName');
      const serverDescriptionEl = document.getElementById('serverDescription');
      const serverMotdEl = document.getElementById('serverMotd');
      if (serverNameEl) serverNameEl.textContent = 'Server: ' + (message.serverName || '');
      if (serverDescriptionEl) serverDescriptionEl.textContent = message.description || '';
      if (serverMotdEl) serverMotdEl.textContent = message.motd || '';
      worldTime = message.worldTime;
      // Clear any existing tanks from previous connections
      tanks.forEach((tank, id) => {
        // Remove ghost mesh if it exists
        if (tank.userData.ghostMesh) {
          scene.remove(tank.userData.ghostMesh);
          tank.userData.ghostMesh = null;
        }
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
      renderManager.clearClouds();

      myPlayerId = message.player.id;
      gameConfig = message.config;
      playerX = message.player.x;
      playerZ = message.player.z;
      playerRotation = message.player.rotation;

      if (myPlayerName !== 'Player' && !/^Player \d+$/.test(myPlayerName)) {
        sendToServer({
          type: 'joinGame',
          name: myPlayerName,
          isMobile,
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
        renderManager.setObstacles(OBSTACLES);
      } else {
        OBSTACLES = [];
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

    case 'playerJoined':
      if (message.player.id === myPlayerId) {
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
            ghostTank.visible = showGhosts;
            scene.add(ghostTank);
            myTank.userData.ghostMesh = ghostTank;
          }
          
          // Update ghost mesh name label too
          if (myTank.userData.ghostMesh && myTank.userData.ghostMesh.userData.nameLabel && 
              myTank.userData.ghostMesh.userData.nameLabel.material) {
            renderManager.updateSpriteLabel(myTank.userData.ghostMesh.userData.nameLabel, message.player.name, message.player.color);
          }
          
          myTank.userData.forwardSpeed = message.player.forwardSpeed || 0;
          myTank.userData.rotationSpeed = message.player.rotationSpeed || 0;
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

    case 'pm':
      // Compact playerMoved message
      const tank = tanks.get(message.id);
      if (tank) {
        const oldY = tank.position.y;
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
          renderManager.playLandSound(tank.position);
        }

        // Update ghost mesh position to server-confirmed position
        if (tank.userData.ghostMesh) {
          tank.userData.ghostMesh.position.set(message.x, message.y, message.z);
          tank.userData.ghostMesh.rotation.y = message.r;
        }
      }
      break;

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
        const y = message.y !== undefined ? message.y : 0;
        myTank.position.set(playerX, playerY, playerZ);
        myTank.rotation.y = playerRotation;
        myTank.userData.verticalVelocity = message.vv || 0;
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

    case 'chat':
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
      updateChatWindow();
      break;

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
  let tank = tanks.get(player.id);
  if (!tank) {
    // Use player.color if present, else fallback to green
    const tankColor = (typeof player.color === 'number') ? player.color : 0x4caf50;
    tank = renderManager.createTank(tankColor, player.name);
    scene.add(tank);
    tanks.set(player.id, tank);
    
    // Create ghost mesh for this tank (server-confirmed position indicator)
    if (player.id !== myPlayerId) {
      const ghostTank = renderManager.createGhostMesh(tank);
      ghostTank.visible = showGhosts; // Initially hidden unless ghosts are enabled
      scene.add(ghostTank);
      tank.userData.ghostMesh = ghostTank;
      
      // Store server position for ghost
      tank.userData.serverPosition = { x: player.x, y: player.y, z: player.z, r: player.rotation };
    }
  }
  // Always update tank state
  tank.position.set(player.x, player.y, player.z);
  tank.rotation.y = player.rotation;
  tank.userData.playerState = player; // Store player state for scoreboard
  tank.userData.verticalVelocity = player.verticalVelocity;
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
  
  callUpdateScoreboard();
}

function removePlayer(playerId) {
  const tank = tanks.get(playerId);
  if (tank) {
    // Remove ghost mesh if it exists
    if (tank.userData.ghostMesh) {
      scene.remove(tank.userData.ghostMesh);
      tank.userData.ghostMesh = null;
    }
    scene.remove(tank);
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
  const projectile = renderManager.createProjectile(data);
  if (!projectile) return;
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
  callUpdateScoreboard();

  // Remove the projectile
  removeProjectile(message.projectileId);

  // Get victim tank and create explosion effect
  if (victimTank) {
    // Immediately hide the tank from the scene
    victimTank.visible = false;
    // Create explosion with tank parts
    renderManager.createExplosion(victimTank.position, victimTank);
  }
}

function handlePlayerRespawn(message) {
  const tank = tanks.get(message.player.id);
  if (tank) {
    const y = 0;
    tank.position.set(message.player.x, message.player.y, message.player.z);
    tank.rotation.y = message.player.rotation;
    tank.userData.verticalVelocity = message.player.verticalVelocity;

    // Update player state with full respawn data (including health = 100)
    tank.userData.playerState = message.player;

    // Update ghost mesh position BEFORE making it visible
    if (tank.userData.ghostMesh) {
      tank.userData.ghostMesh.position.set(message.player.x, message.player.y, message.player.z);
      tank.userData.ghostMesh.rotation.y = message.player.rotation;
      tank.userData.ghostMesh.visible = showGhosts;
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

function updateStats(player) {
  callUpdateScoreboard();
}

function showMessage(text, type = '') {
  // Show a message in the chat window as if from SERVER
  const prefix = 'local: ';
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

// Returns: null (no collision), { type: 'boundary' }, { type: 'collision', obstacle }, or { type: 'ontop', obstacle }
function checkCollision(x, y, z, tankRadius = 2) {
  const mapSize = gameConfig.MAP_SIZE || gameConfig.mapSize || 100;
  const halfMap = mapSize / 2;

  // Check map boundaries (always apply regardless of height)
  if (x - tankRadius < -halfMap || x + tankRadius > halfMap ||
      z - tankRadius < -halfMap || z + tankRadius > halfMap) {
    return { type: 'boundary', obstacle: null };
  }

  for (const obs of OBSTACLES) {
    const obstacleHeight = obs.h || 4;
    const obstacleBase = obs.baseY || 0;
    const obstacleTop = obstacleBase + obstacleHeight;
    const epsilon = 0.15;
    const tankHeight = 2;
    
    // Check if we're "on top" of this obstacle (at its top height)
    if (Math.abs(y - obstacleTop) < 0.5) {
      const halfW = obs.w / 2;
      const halfD = obs.d / 2;
      const rotation = obs.rotation || 0;
      const dx = x - obs.x;
      const dz = z - obs.z;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const localX = dx * cos - dz * sin;
      const localZ = dx * sin + dz * cos;
      
      // Use same collision logic - closest point on box
      const closestX = Math.max(-halfW, Math.min(localX, halfW));
      const closestZ = Math.max(-halfD, Math.min(localZ, halfD));
      const distX = localX - closestX;
      const distZ = localZ - closestZ;
      const distSquared = distX * distX + distZ * distZ;
      
      if (distSquared < tankRadius * tankRadius) {
        return { type: 'ontop', obstacle: obs, obstacleTop };
      }
    }
    
    // Only check collision if tank top is below obstacle top and tank base is above obstacle base
    const tankTop = y + tankHeight;
    if (tankTop <= obstacleBase + epsilon) continue;
    if (y >= obstacleTop - epsilon) continue;

    // Shared math for both box and pyramid
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
      // Box collision: check closest point on box to tank center
      const closestX = Math.max(-halfW, Math.min(localX, halfW));
      const closestZ = Math.max(-halfD, Math.min(localZ, halfD));
      const distX = localX - closestX;
      const distZ = localZ - closestZ;
      const distSquared = distX * distX + distZ * distZ;
      if (distSquared < tankRadius * tankRadius) {
        if (typeof sendToServer === 'function') {
          try {
            // Build debug message with safe checks
            const debugParts = [];
            debugParts.push('[COLLISION]');
            debugParts.push(x !== undefined && x !== null ? x.toFixed(2) : `x=UNDEF`);
            debugParts.push(y !== undefined && y !== null ? y.toFixed(2) : `y=UNDEF`);
            debugParts.push(z !== undefined && z !== null ? z.toFixed(2) : `z=UNDEF`);
            debugParts.push(`${obs.name || 'UNNAMED'}:${obs.type || 'NOTYPE'}`);
            debugParts.push(obs.x !== undefined ? obs.x.toFixed(2) : `obsx=UNDEF`);
            debugParts.push(obstacleBase !== undefined ? obstacleBase.toFixed(2) : `base=UNDEF`);
            debugParts.push(obs.z !== undefined ? obs.z.toFixed(2) : `obsz=UNDEF`);
            debugParts.push(`rot:${obs.rotation !== undefined ? obs.rotation.toFixed(2) : 'UNDEF'}`);
            debugParts.push(`h:${obstacleHeight !== undefined ? obstacleHeight.toFixed(2) : 'UNDEF'}`);
            debugParts.push(`top:${obstacleTop !== undefined ? obstacleTop.toFixed(2) : 'UNDEF'}`);
            //sendToServer({ type: 'chat', to: -1, text: debugParts.join(' ') });
          } catch (e) {
            console.error('Error sending collision chat message:', e);
          }
        }
        return { type: 'collision', obstacle: obs };
      }
    } else if (obs.type === 'pyramid') {
      // Pyramid collision: check if tank top is under the sloped surface
      // Sample points around the tank's top circle (8 directions + center)
      const sampleCount = 8;
      const localY_top = tankTop - obstacleBase;
      for (let i = 0; i < sampleCount; i++) {
        const angle = (Math.PI * 2 * i) / sampleCount;
        const offsetX = Math.cos(angle) * tankRadius;
        const offsetZ = Math.sin(angle) * tankRadius;
        const sx = localX + offsetX;
        const sz = localZ + offsetZ;
        if (Math.abs(sx) <= halfW && Math.abs(sz) <= halfD) {
          const nx = Math.abs(sx) / halfW;
          const nz = Math.abs(sz) / halfD;
          const n = Math.max(nx, nz);
          const maxPyramidY = obs.h * (1 - n);
          if (localY_top >= epsilon && localY_top < maxPyramidY - epsilon) {
            if (typeof sendToServer === 'function') {
              try {
                // Build debug message with safe checks
                const debugParts = [];
                debugParts.push('[COLLISION]');
                debugParts.push(x !== undefined && x !== null ? x.toFixed(2) : `x=UNDEF`);
                debugParts.push(y !== undefined && y !== null ? y.toFixed(2) : `y=UNDEF`);
                debugParts.push(z !== undefined && z !== null ? z.toFixed(2) : `z=UNDEF`);
                debugParts.push(`${obs.name || 'UNNAMED'}:${obs.type || 'NOTYPE'}`);
                debugParts.push(obs.x !== undefined ? obs.x.toFixed(2) : `obsx=UNDEF`);
                debugParts.push(obstacleBase !== undefined ? obstacleBase.toFixed(2) : `base=UNDEF`);
                debugParts.push(obs.z !== undefined ? obs.z.toFixed(2) : `obsz=UNDEF`);
                debugParts.push(`rot:${obs.rotation !== undefined ? obs.rotation.toFixed(2) : 'UNDEF'}`);
                debugParts.push(`h:${obstacleHeight !== undefined ? obstacleHeight.toFixed(2) : 'UNDEF'}`);
                debugParts.push(`top:${obstacleTop !== undefined ? obstacleTop.toFixed(2) : 'UNDEF'}`);
                //sendToServer({ type: 'chat', to: -1, text: debugParts.join(' ') });
              } catch (e) {
                console.error('Error sending collision chat message:', e);
              }
            }
            return { type: 'collision', obstacle: obs };
          }
        }
      }
      // Also check the center point for completeness
      if (Math.abs(localX) <= halfW && Math.abs(localZ) <= halfD) {
        const nx = Math.abs(localX) / halfW;
        const nz = Math.abs(localZ) / halfD;
        const n = Math.max(nx, nz);
        const maxPyramidY = obs.h * (1 - n);
        if (localY_top >= epsilon && localY_top < maxPyramidY - epsilon) {
          if (typeof sendToServer === 'function') {
            sendToServer({ type: 'chat', to: -1, text: `[COLLISION] ${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)} ${obs.name}:${obs.type} ${obs.x.toFixed(2)},${obstacleBase.toFixed(2)},${obs.z.toFixed(2)} rot:${(obs.rotation).toFixed(2)}, h:${obstacleHeight.toFixed(2)}, top:${obstacleTop.toFixed(2)}` });
          }
          return obs;
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
  let fallingFromObstacle = null; // Obstacle we're falling from (to skip collision)
  let altered = false;
  if (newY < 0) {
      landedType = 'ground';
      altered = true
      return { x: newX, y: 0, z: newZ, moved: true, altered, landedOn, landedType, startedFalling, fallingFromObstacle };
  }

  // Try full movement first
  const collisionObj = checkCollision(newX, newY, newZ, tankRadius);
  // If we hit a collision while moving upward (jumping into obstacle bottom), start falling
  if (collisionObj && collisionObj.type === 'collision' && intendedDeltaY > 0) {
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
  
  if (!collisionObj || collisionObj.type === 'ontop') {
    // If we're on top of an obstacle, that's the landing
    if (collisionObj && collisionObj.type === 'ontop') {
      landedOn = collisionObj.obstacle;
      landedType = 'obstacle';
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
    return { x: newX, y: newY, z: newZ, moved: true, altered, landedOn, landedType, startedFalling, fallingFromObstacle };
  }

  // Find the collision normal
  const normal = getCollisionNormal(collisionObj.obstacle, x, y, z, newX, newY, newZ, tankRadius);

  if (normal) {
    // Project movement vector onto the surface (perpendicular to normal)
    const dot = intendedDeltaX * normal.x + intendedDeltaZ * normal.z;
    const slideX = intendedDeltaX - normal.x * dot;
    const slideZ = intendedDeltaZ - normal.z * dot;

    // Try sliding along the surface
    const slideNewX = x + slideX;
    const slideNewZ = z + slideZ;

    const slideCollisionObj = checkCollision(slideNewX, newY, slideNewZ, tankRadius);
    console.log('Slide collision check:', newX,newY,newZ,slideNewX,slideNewZ,slideCollisionObj);
    if (!slideCollisionObj || slideCollisionObj.type === 'ontop') {
      // If we're on top of an obstacle, that's the landing
      if (slideCollisionObj && slideCollisionObj.type === 'ontop') {
        landedOn = slideCollisionObj.obstacle;
        landedType = 'obstacle';
      } else if (y !== null && Math.abs(y) < 0.5) {
        landedType = 'ground';
      }
      const altered = Math.abs(slideX - intendedDeltaX) > 1e-6 || Math.abs(slideZ - intendedDeltaZ) > 1e-6;
      return { x: slideNewX, y: newY, z: slideNewZ, moved: true, altered, landedOn, landedType };
    }
  }

  // Fallback: try axis-aligned sliding using full collision logic
  // Try sliding along X axis only
  const xSlideCollisionObj = checkCollision(newX, newY, z, tankRadius);
  if (!xSlideCollisionObj || xSlideCollisionObj.type === 'ontop') {
    return { x: newX, y: newY, z: z, moved: true, altered: true, landedOn: null, landedType: null, startedFalling: false, fallingFromObstacle: null };
  }

  // Try sliding along Z axis only
  const zSlideCollisionObj = checkCollision(x, newY, newZ, tankRadius);
  if (!zSlideCollisionObj || zSlideCollisionObj.type === 'ontop') {
    return { x: x, y: newY, z: newZ, moved: true, altered: true, landedOn: null, landedType: null };
  }

  // No movement possible
  console.log('No movement possible due to collision');
  return { x: x, y: y, z: z, moved: false, altered: false, landedOn: null, landedType: null };
}

function getCollisionNormal(obs, fromX, fromY, fromZ, toX, toY, toZ, tankRadius = 2) {
  const mapSize = gameConfig.mapSize;
  const halfMap = mapSize / 2;

  // Check map boundaries
  if (toX - tankRadius < -halfMap) return { x: 1, z: 0 };
  if (toX + tankRadius > halfMap) return { x: -1, z: 0 };
  if (toZ - tankRadius < -halfMap) return { x: 0, z: 1 };
  if (toZ + tankRadius > halfMap) return { x: 0, z: -1 };

  // Use provided obstacle
  if (!obs) return null;
  const halfW = obs.w / 2;
  const halfD = obs.d / 2;
  const rotation = obs.rotation || 0;
  const dx = toX - obs.x;
  const dz = toZ - obs.z;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const localX = dx * cos - dz * sin;
  const localZ = dx * sin + dz * cos;
  const closestX = Math.max(-halfW, Math.min(localX, halfW));
  const closestZ = Math.max(-halfD, Math.min(localZ, halfD));
  const distX = localX - closestX;
  const distZ = localZ - closestZ;
  const distSquared = distX * distX + distZ * distZ;
  if (distSquared < tankRadius * tankRadius) {
    let normalLocalX = 0;
    let normalLocalZ = 0;
    if (distSquared > 0.0001) {
      const dist = Math.sqrt(distSquared);
      normalLocalX = distX / dist;
      normalLocalZ = distZ / dist;
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
    const cosRot = Math.cos(rotation);
    const sinRot = Math.sin(rotation);
    const normalX = normalLocalX * cosRot - normalLocalZ * sinRot;
    const normalZ = normalLocalX * sinRot + normalLocalZ * cosRot;
    const length = Math.sqrt(normalX * normalX + normalZ * normalZ);
    const worldNormal = { x: normalX / length, z: normalZ / length };
    if (typeof sendToServer === 'function') {
      sendToServer({
        type: 'chat',
        to: -1,
        text: `[NORMAL-DEBUG] obs:${obs.name} rot:${rotation.toFixed(2)} local:(${localX.toFixed(2)},${localZ.toFixed(2)}) closest:(${closestX.toFixed(2)},${closestZ.toFixed(2)}) normalLocal:(${normalLocalX.toFixed(2)},${normalLocalZ.toFixed(2)}) worldNormal:(${worldNormal.x.toFixed(2)},${worldNormal.z.toFixed(2)}) pos:(${toX.toFixed(2)},${toZ.toFixed(2)})`
      });
    }
    return worldNormal;
  }
  return null;
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

function handleInputEvents() {
  // Reset intended input each frame
  intendedForward = 0;
  intendedRotation = 0;
  intendedY = 0;
  jumpTriggered = false;

  if (!myTank || !gameConfig) return;

  // Check if tank is in the air (not on ground or obstacle)
  onGround = myTank.position.y < 0.1;
  onObstacle = false;
  if (onGround) {
    playerY = 0;
  } else {
    // Use checkCollision to detect if we're on top of an obstacle
    const collisionObj = checkCollision(myTank.position.x, myTank.position.y, myTank.position.z, 2);
    if (collisionObj && collisionObj.type === 'ontop') {
      onObstacle = true;
      playerY = collisionObj.obstacleTop;
    }
  }
  isInAir = !onGround && !onObstacle;

  if (isPaused || pauseCountdownStart > 0) return;

  // Gather intended input from controls
  if (isInAir) {
    // In air: use stored jump values to match what we send in packets
    intendedForward = myTank.userData.jumpForwardSpeed || 0;
    intendedRotation = myTank.userData.rotationSpeed || 0;
  } else {
    if (virtualControlsEnabled) {
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
    // We were in air, now we're on ground/obstacle - send landing packet
    forceMoveSend = true;
    jumpDirection = null;
    myJumpDirection = null;
    myTank.userData.jumpForwardSpeed = undefined;
    myTank.userData.fallForwardSpeed = undefined;
    myTank.userData.verticalVelocity = 0;
  }

  let moved = false;
  const oldX = playerX;
  const oldZ = playerZ;
  const oldRotation = playerRotation;


  // Step 3: Convert intended speed/rotation to deltas
  const speed = gameConfig.TANK_SPEED * deltaTime;
  const rotSpeed = gameConfig.TANK_ROTATION_SPEED * deltaTime;
  let moveRotation = playerRotation;
  let intendedDeltaX, intendedDeltaY = 0, intendedDeltaZ, intendedDeltaRot;

  // Determine forward speed for movement calculation
  let movementForwardSpeed = intendedForward;
  if (isInAir && jumpDirection !== null) {
    moveRotation = jumpDirection;
    // Use frozen forward speed from jump or fall start
    movementForwardSpeed = myTank.userData.fallForwardSpeed !== undefined 
      ? myTank.userData.fallForwardSpeed 
      : myTank.userData.jumpForwardSpeed || 0;
  }

  intendedDeltaX = -Math.sin(moveRotation) * movementForwardSpeed * speed;
  intendedDeltaZ = -Math.cos(moveRotation) * movementForwardSpeed * speed;
  intendedDeltaRot = intendedRotation * rotSpeed;
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
    // Store intendedForward at jump time for use in jump packet
    myTank.userData.jumpForwardSpeed = intendedForward;
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
    
    // Immediately re-validate with air physics since this frame's movement was calculated wrong
    // Recalculate movement with frozen direction and frozen forward speed
    const fallDeltaX = -Math.sin(jumpDirection) * frozenForwardSpeed * speed;
    const fallDeltaZ = -Math.cos(jumpDirection) * frozenForwardSpeed * speed;
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
      // In air: use last known forwardSpeed from userData
      forwardSpeed = myTank.userData.forwardSpeed || 0;
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
  
  // Velocity-based dead reckoning: only send when velocities change (positions are extrapolated)
  const forwardSpeedDelta = Math.abs(forwardSpeed - lastSentForwardSpeed);
  const rotationSpeedDelta = Math.abs(rotationSpeed - lastSentRotationSpeed);
  // Don't check vertical velocity changes while in air - gravity is extrapolated
  // Only jump/land transitions matter (handled by forceMoveSend)
  const verticalVelocityDelta = isInAir ? 0 : Math.abs(verticalVelocity - lastSentVerticalVelocity);
  
  const reasons = [];
  if (forceMoveSend) reasons.push('force');
  if (forwardSpeedDelta > VELOCITY_THRESHOLD) reasons.push(`fs:${forwardSpeedDelta.toFixed(3)}`);
  if (rotationSpeedDelta > VELOCITY_THRESHOLD) reasons.push(`rs:${rotationSpeedDelta.toFixed(3)}`);
  if (verticalVelocityDelta > VERTICAL_VELOCITY_THRESHOLD) reasons.push(`vv:${verticalVelocityDelta.toFixed(3)}`);
  if (timeSinceLastSend > MAX_UPDATE_INTERVAL) reasons.push(`time:${(timeSinceLastSend/1000).toFixed(1)}s`);
  
  // Minimum 100ms between non-forced updates to prevent rapid-fire from calculation noise
  const minTimeBetweenUpdates = 100; // ms
  const canSendVelocityUpdate = forceMoveSend || timeSinceLastSend > minTimeBetweenUpdates;
  
  const shouldSendUpdate =
    forceMoveSend || // Force send on jump/land transitions
    timeSinceLastSend > MAX_UPDATE_INTERVAL || // Heartbeat
    (canSendVelocityUpdate && (
      forwardSpeedDelta > VELOCITY_THRESHOLD ||
      rotationSpeedDelta > VELOCITY_THRESHOLD ||
      verticalVelocityDelta > VERTICAL_VELOCITY_THRESHOLD
    ));
  
  if (shouldSendUpdate && ws && ws.readyState === WebSocket.OPEN) {
    if (debugEnabled) console.log(`[CLIENT] Sending dw: ${reasons.join(', ')}`);
    
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
      dt: Number(deltaTime.toFixed(3)),
    };
    
    // Add optional direction field if sliding
    if (slideDirection !== null) {
      movePacket.d = Number(slideDirection.toFixed(2));
    }

    sendToServer(movePacket);
    // Store the ROUNDED values we actually sent to prevent rounding-induced deltas
    lastSentForwardSpeed = sentFS;
    lastSentRotationSpeed = sentRS;
    lastSentVerticalVelocity = sentVV;
    lastSentTime = now;
    
    // Update local player ghost to show what server/other players see
    if (myTank && myTank.userData.ghostMesh) {
      const ghostX = Number(playerX.toFixed(2));
      const ghostY = Number(playerY.toFixed(2));
      const ghostZ = Number(playerZ.toFixed(2));
      const ghostR = Number(playerRotation.toFixed(2));
      
      myTank.userData.ghostMesh.position.set(ghostX, ghostY, ghostZ);
      myTank.userData.ghostMesh.rotation.y = ghostR;
    }
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

function updateProjectiles(deltaTime) {
  const projectileSpeed = 18; // units per second (adjust as needed)
  projectiles.forEach((projectile, id) => {
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
    projectiles.forEach((proj, id) => {
      const pos = world2Radar(proj.position.x, proj.position.z, px, pz, playerHeading, center, radius, SHOT_DISTANCE);
      if (pos.distance > SHOT_DISTANCE) return;
      
      radarCtx.save();
      radarCtx.beginPath();
      radarCtx.arc(pos.x, pos.y, 4, 0, Math.PI * 2);
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

/**
 * Extrapolate a player's position based on their last known state and elapsed time.
 * @param {Object} player - Player object with position, rotation, speeds, jumpDirection
 * @param {number} dt - Time elapsed since last server update (seconds)
 * @returns {{x: number, y: number, z: number, r: number}} Extrapolated position and rotation
 */
function extrapolatePosition(player, dt) {
  if (!player || !gameConfig) return player;
  
  const { x, y, z, r, forwardSpeed, rotationSpeed, verticalVelocity, jumpDirection, slideDirection } = player;
  
  // Apply rotation
  const rotSpeed = gameConfig.TANK_ROTATION_SPEED || 1.5;
  const newR = r + (rotationSpeed || 0) * rotSpeed * dt;
  
  // Determine if player is in air based on jumpDirection
  const isInAir = jumpDirection !== null && jumpDirection !== undefined;
  
  if (isInAir) {
    // In air: straight-line motion in frozen jumpDirection
    const speed = gameConfig.TANK_SPEED || 15;
    const dx = -Math.sin(jumpDirection) * (forwardSpeed || 0) * speed * dt;
    const dz = -Math.cos(jumpDirection) * (forwardSpeed || 0) * speed * dt;
    
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
  const now = performance.now();
  const deltaTime = (now - lastTime) / 1000;
  lastTime = now;

  // Advance worldTime so 24000 ticks = 20 minutes (1200 seconds)
  // 24000 / 1200 = 20 ticks per second
  worldTime = (worldTime + 20 * deltaTime) % 24000;

  updateFps();
  updateChatWindow();
  updateAltimeter({ myTank });
  updateDegreeBar({ myTank, playerRotation });
  requestAnimationFrame(animate);
  handleInputEvents();
  handleMotion(deltaTime);
  
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
        slideDirection: tank.userData.slideDirection
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
  updateShields();
  renderManager.updateTreads(tanks, deltaTime, gameConfig);
  if (gameConfig) {
    renderManager.updateClouds(deltaTime, gameConfig.MAP_SIZE || 100);
  }
  renderManager.updateCamera({ cameraMode, myTank, playerRotation });
  updateRadar();

  renderManager.renderFrame();
}

// Start the game
init();
