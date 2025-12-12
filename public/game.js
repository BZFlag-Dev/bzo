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
  toggleDebugLabels
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

// Removed duplicate setActive, updateHudButtons, toggleDebugHud, toggleSettingsHud, toggleHelpPanel definitions (now imported from hud.js)


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

// Dead reckoning state - track last sent position
let lastSentX = 0;
let lastSentZ = 0;
let lastSentRotation = 0;
let lastSentTime = 0;
let worldTime = 0;
const POSITION_THRESHOLD = 0.5; // Send update if position differs by more than 0.5 units
const ROTATION_THRESHOLD = 0.1; // Send update if rotation differs by more than 0.1 radians (~6 degrees)
const MAX_UPDATE_INTERVAL = 200; // Force send update at least every 200ms

// Debug tracking
let debugEnabled = false;
let debugLabelsEnabled = true;
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
  toggleEntryDialog: (name) => toggleEntryDialog(name),
  getChatInput: () => chatInput,
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
    // Show dialog if name is 'Player' or 'Player n'
    if (trimmed === 'Player' || /^Player \d+$/.test(trimmed)) {
      toggleEntryDialog(savedName);
    } else {
      myPlayerName = savedName;
    }
  } else {
    toggleEntryDialog();
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
    // ...existing code...
    case 'newPlayer':
      // Add player to scoreboard as dead, but do not create tank in scene
      if (message.player) {
        addPlayer(message.player);
        updateScoreboard();
      }
      break;
    case 'init':
      worldTime = message.worldTime || 0;
      // ...existing code...
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
      renderManager.clearClouds();

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
      // Build world geometry
      renderManager.buildGround(gameConfig.MAP_SIZE);
      renderManager.createMapBoundaries(gameConfig.MAP_SIZE);

      // Initialize dead reckoning state
      lastSentX = playerX;
      lastSentZ = playerZ;
      lastSentRotation = playerRotation;
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
          case 'worldTime':
            worldTime = message.worldTime;
            break;
            if (renderManager.dynamicLightingEnabled) {
              renderManager.setWorldTime(message.worldTime);
            }
            break;
      if (message.clouds) {
        renderManager.createClouds(message.clouds);
      } else {
        renderManager.clearClouds();
      }
      message.players.forEach(player => {
        if (player.health > 0) {
          addPlayer(player);
        }
      });
      break;
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
        myTank = renderManager.createTank(0x2196F3, myPlayerName);
        myTank.position.set(playerX, playerY, playerZ);
        myTank.rotation.y = playerRotation;
        myTank.userData.verticalVelocity = message.player.verticalVelocity || 0;
        myTank.userData.playerState = message.player;
        myTank.userData.forwardSpeed = message.player.forwardSpeed || 0;
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

    case 'pm':
      // Compact playerMoved message
      const tank = tanks.get(message.id);
      if (tank) {
        const oldY = tank.position.y;
        const oldVerticalVel = tank.userData.verticalVelocity || 0;

        tank.position.set(message.x, message.y, message.z);
        tank.rotation.y = message.r;
        tank.userData.forwardSpeed = message.fs;
        tank.userData.rotationSpeed = message.rs;
        tank.userData.verticalVelocity = message.vv;

        // Detect jump (vertical velocity suddenly became positive and large)
        if (oldVerticalVel < 10 && message.vv >= 20) {
          console.log('Jump detected for player', message.id);
          renderManager.playLocalJumpSound(tank.position);
        }

        // Detect landing
        if (oldVerticalVel < 0 && message.vv === 0 && oldY > message.y) {
          console.log('Landing detected for player', message.id);
          renderManager.playLandSound(tank.position);
        }
      }
      break;

    case 'positionCorrection':
      // Server corrected our position - update dead reckoning state
      playerX = message.x;
      playerY = message.y;
      playerZ = message.z;
      playerRotation = message.r;
      lastSentX = playerX;
      lastSentZ = playerZ;
      lastSentRotation = playerRotation;
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

    case 'nameChanged':
      if (message.playerId === myPlayerId) {
        myPlayerName = message.name;
        document.getElementById('playerName').textContent = myPlayerName;

        // Save to localStorage
        localStorage.setItem('playerName', message.name);

        // Update tank name label
        if (myTank && myTank.userData.nameLabel) {
          renderManager.updateSpriteLabel(myTank.userData.nameLabel, message.name);
        }

        showMessage(`Name changed to: ${message.name}`);
      } else {
        // Update other player's name label and state
        const tank = tanks.get(message.playerId);
        if (tank) {
          if (tank.userData.nameLabel) {
            renderManager.updateSpriteLabel(tank.userData.nameLabel, message.name);
          }
          if (tank.userData.playerState) {
            tank.userData.playerState.name = message.name;
          }
        }
        showMessage(`${message.name} joined`);
      }
      updateScoreboard();
      break;

    case 'mapList':
      handleMapsList(message);
      break;
  // Operator panel: request map list when shown
  const operatorOverlay = document.getElementById('operatorOverlay');
  const mapList = document.getElementById('mapList');
  if (operatorOverlay && mapList) {
    // Observe display changes to operatorOverlay
    let lastDisplay = operatorOverlay.style.display;
    const observer = new MutationObserver(() => {
      const currentDisplay = operatorOverlay.style.display;
      if (currentDisplay === 'block' && lastDisplay !== 'block') {
        // Panel just opened: request map list
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'listMaps' }));
        }
      }
      lastDisplay = currentDisplay;
    });
    observer.observe(operatorOverlay, { attributes: true, attributeFilter: ['style'] });
  }

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
  if (tanks.has(player.id)) return;

  const tank = renderManager.createTank(0xFF5722, player.name);
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
  updateScoreboard();

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
    tank.visible = true;
  }

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

function checkCollision(x, y, z, tankRadius = 2) {
  const mapSize = gameConfig.MAP_SIZE || gameConfig.mapSize || 100;
  const halfMap = mapSize / 2;

  // Check map boundaries (always apply regardless of height)
  if (x - tankRadius < -halfMap || x + tankRadius > halfMap ||
      z - tankRadius < -halfMap || z + tankRadius > halfMap) {
    return { type: 'boundary' };
  }

  for (const obs of OBSTACLES) {
    const obstacleHeight = obs.h || 4;
    const obstacleBase = obs.baseY || 0;
    const obstacleTop = obstacleBase + obstacleHeight;
    const epsilon = 0.15;
    const tankHeight = 2;
    // Only check if tank top is below obstacle top and tank base is above obstacle base
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
          sendToServer({ type: 'chat', to: -1, text: `[COLLISION] ${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)} ${obs.name}:${obs.type} ${obs.x.toFixed(2)},${obstacleBase.toFixed(2)},${obs.z.toFixed(2)} rot:${(obs.rotation).toFixed(2)}, h:${obstacleHeight.toFixed(2)}, top:${obstacleTop.toFixed(2)}` });
        }
        return obs;
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
              sendToServer({ type: 'chat', to: -1, text: `[COLLISION] ${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)} ${obs.name}:${obs.type} ${obs.x.toFixed(2)},${obstacleBase.toFixed(2)},${obs.z.toFixed(2)} rot:${(obs.rotation).toFixed(2)}, h:${obstacleHeight.toFixed(2)}, top:${obstacleTop.toFixed(2)}` });
            }
            return obs;
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
  let altered = false;
  if (newY < 0) {
      landedType = 'ground';
      altered = true
      return { x: newX, y: 0, z: newZ, moved: true, altered, landedOn, landedType, startedFalling };
  }

  // Try full movement first
  const collisionObj = checkCollision(newX, newY, newZ, tankRadius);
  if (!collisionObj) {
    // Check for on obstacle (landing logic unchanged)
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

    const slideCollisionObj = checkCollision(slideNewX, newY, slideNewZ, tankRadius);
    if (!slideCollisionObj) {
      // Check for landing on obstacle (landing logic unchanged)
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
        const xyInBounds = Math.abs(localX) <= halfW + tankRadius && Math.abs(localZ) <= halfD + tankRadius;
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

  // Fallback: try axis-aligned sliding using full collision logic
  // Try sliding along X axis only
  const xSlideCollisionObj = checkCollision(newX, y, z, tankRadius);
  if (!xSlideCollisionObj) {
    return { x: newX, y: newY, z: z, moved: true, altered: true, landedOn: null, landedType: null };
  }

  // Try sliding along Z axis only
  const zSlideCollisionObj = checkCollision(x, y, newZ, tankRadius);
  if (!zSlideCollisionObj) {
    return { x: x, y: newY, z: newZ, moved: true, altered: true, landedOn: null, landedType: null };
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
// Intended input state
let intendedForward = 0; // -1..1
let intendedRotation = 0; // -1..1
let intendedY = 0; // -1..1 (for jump/momentum)
let jumpTriggered = false;
let isInAir = false;
let jumpDirection = null; // Stores the direction at jump start

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
    jumpDirection = null; // Reset jump direction when grounded
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
          jumpDirection = null; // Reset jump direction when landed on obstacle
          break;
        }
      }
    }
  }
  isInAir = !onGround && !onObstacle;

  if (isPaused || pauseCountdownStart > 0) return;

  // Gather intended input from controls
  if (isInAir) {
    // In air: movement is fixed to jumpDirection, but allow visual rotation
    intendedForward = myTank.userData.forwardSpeed || 0;
    intendedRotation = myTank.userData.rotationSpeed || 0;
  } else {
    if (virtualControlsEnabled) {
      intendedForward = virtualInput.forward;
      intendedRotation = virtualInput.turn;
      if (!isInAir && virtualInput.jump) {
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
    if ((keys['Tab']) && !isInAir) {
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

  let moved = false;
  const oldX = playerX;
  const oldZ = playerZ;
  const oldRotation = playerRotation;


  // Step 3: Convert intended speed/rotation to deltas
  const speed = gameConfig.TANK_SPEED * deltaTime;
  const rotSpeed = gameConfig.TANK_ROTATION_SPEED * deltaTime;
  let moveRotation = playerRotation;
  let intendedDeltaX, intendedDeltaY = 0, intendedDeltaZ, intendedDeltaRot;

  if (isInAir && jumpDirection !== null) {
    moveRotation = jumpDirection;
  }

  intendedDeltaX = -Math.sin(moveRotation) * intendedForward * speed;
  intendedDeltaZ = -Math.cos(moveRotation) * intendedForward * speed;
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

  if (jumpTriggered && !isInAir) {
    myTank.userData.verticalVelocity = gameConfig.JUMP_VELOCITY || 30;
    intendedDeltaY = myTank.userData.verticalVelocity * deltaTime;
    jumpDirection = playerRotation; // Store jump direction at jump start
    if (myTank) renderManager.playLocalJumpSound(myTank.position);
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
    // Always update playerRotation for visual tank rotation
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
      type: 'm',
      id: myPlayerId,
      x: Number(playerX.toFixed(2)),
      y: Number(playerY.toFixed(2)),
      z: Number(playerZ.toFixed(2)),
      r: Number(playerRotation.toFixed(2)),
      fs: Number(forwardSpeed.toFixed(2)),
      rs: Number(rotationSpeed.toFixed(2)),
      vv: Number(verticalVelocity.toFixed(2)),
      dt: Number(deltaTime.toFixed(3)),
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

  updateFps();
  updateChatWindow();
  requestAnimationFrame(animate);
  handleInputEvents();
  handleMotion(deltaTime);
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
