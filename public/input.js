// input.js
// Handles keyboard, mouse, and touch input for the game.
// Exports: setupInputHandlers, virtualInput, keys, lastVirtualJump

import { getXRControllerInput, xrState, debugLog } from './webxr.js';

// Virtual input state (for mobile/touch)
export let virtualInput = { forward: 0, turn: 0, fire: false, jump: false };
export let lastVirtualJump = false;

// Keyboard input state
export const keys = {};

// Gamepad state
let gamepadConnected = false;
let gamepadIndex = -1;
let gamepadInfo = null;
let lastGamepadButtonState = { fire: false, jump: false };
let gamepadFrameCounter = 0;

// Gamepad detection and event listeners
function setupGamepadListeners() {
  // Listen for gamepad connections
  window.addEventListener('gamepadconnected', (e) => {
    console.log('[Gamepad] Connected:', e.gamepad.id);
    console.log('[Gamepad] Mapping:', e.gamepad.mapping);
    gamepadConnected = true;
    gamepadIndex = e.gamepad.index;
    gamepadInfo = {
      id: e.gamepad.id,
      buttons: e.gamepad.buttons.length,
      axes: e.gamepad.axes.length,
      mapping: e.gamepad.mapping,
    };
    console.log('[Gamepad] Info:', gamepadInfo);
  });

  window.addEventListener('gamepaddisconnected', (e) => {
    console.log('[Gamepad] Disconnected:', e.gamepad.id);
    if (e.gamepad.index === gamepadIndex) {
      gamepadConnected = false;
      gamepadIndex = -1;
      gamepadInfo = null;
      // Reset virtual input
      virtualInput.forward = 0;
      virtualInput.turn = 0;
      virtualInput.fire = false;
      virtualInput.jump = false;
    }
  });

  // Initial check for already-connected gamepads
  const gamepads = navigator.getGamepads();
  for (let i = 0; i < gamepads.length; i++) {
    if (gamepads[i]) {
      console.log('[Gamepad] Found at startup:', gamepads[i].id);
      console.log('[Gamepad] Mapping:', gamepads[i].mapping);
      gamepadConnected = true;
      gamepadIndex = gamepads[i].index;
      gamepadInfo = {
        id: gamepads[i].id,
        buttons: gamepads[i].buttons.length,
        axes: gamepads[i].axes.length,
        mapping: gamepads[i].mapping,
      };
      console.log('[Gamepad] Info:', gamepadInfo);
      break;
    }
  }
}

// Update virtualInput from gamepad state (called each frame)
export function updateVirtualInputFromGamepad() {
  if (!gamepadConnected || gamepadIndex < 0) return;

  const gamepads = navigator.getGamepads();
  const gamepad = gamepads[gamepadIndex];
  if (!gamepad) {
    gamepadConnected = false;
    return;
  }

  const axes = gamepad.axes;
  const buttons = gamepad.buttons;

  // Apply deadzone to prevent drift
  const deadzone = 0.2;
  function applyDeadzone(value) {
    if (Math.abs(value) < deadzone) {
      return 0;
    }
    // Scale the remaining range to 0-1 for smoother control
    const sign = value > 0 ? 1 : -1;
    return sign * ((Math.abs(value) - deadzone) / (1 - deadzone));
  }

  // Standard gamepad mapping (most USB controllers and iOS MFi controllers):
  // Axes 0: Left stick X (turn left/right)
  // Axes 1: Left stick Y (forward/backward)
  // Axes 2: Right stick X (unused)
  // Axes 3: Right stick Y (unused)
  // Button 0: A/X (fire)
  // Button 1: B/Circle (jump)
  // Button 6: Left trigger (alternative jump)
  // Button 7: Right trigger (alternative fire)

  if (axes.length >= 2) {
    // Left stick Y-axis: forward/backward (inverted because -1 is up)
    const axisY = axes[1];
    const axisX = axes[0];
    
    virtualInput.forward = -applyDeadzone(axisY);
    virtualInput.turn = -applyDeadzone(axisX);
  } else {
    // No axes available, reset to 0
    virtualInput.forward = 0;
    virtualInput.turn = 0;
  }

  // Fire button: A button (0) or right trigger (7)
  const firePressed = 
    (buttons[0] && buttons[0].pressed) ||
    (buttons[7] && buttons[7].pressed);
  virtualInput.fire = firePressed;

  // Jump button: B button (1) or left trigger (6)
  const jumpPressed = 
    (buttons[1] && buttons[1].pressed) ||
    (buttons[6] && buttons[6].pressed);
  virtualInput.jump = jumpPressed;

  // Track button state changes
  lastGamepadButtonState.fire = firePressed;
  lastGamepadButtonState.jump = jumpPressed;

  // Debug logging every 120 frames (every 2 seconds at 60fps)
  gamepadFrameCounter++;
  if (gamepadFrameCounter % 120 === 0) {
    // Log active axes and buttons
    const activeAxes = [];
    for (let i = 0; i < axes.length; i++) {
      if (Math.abs(axes[i]) > 0.01) {
        activeAxes.push(`Axis${i}=${axes[i].toFixed(2)}`);
      }
    }
    const activeButtons = [];
    for (let i = 0; i < buttons.length; i++) {
      if (buttons[i].pressed) {
        activeButtons.push(`Btn${i}`);
      }
    }
    if (activeAxes.length > 0 || activeButtons.length > 0) {
      console.log('[Gamepad] Active:', activeAxes.join(', '), activeButtons.join(', '));
      console.log('[Gamepad] virtualInput:', `forward=${virtualInput.forward.toFixed(2)}, turn=${virtualInput.turn.toFixed(2)}, fire=${virtualInput.fire}, jump=${virtualInput.jump}`);
    }
  }
}

// Get gamepad connection status
export function isGamepadConnected() {
  return gamepadConnected;
}

// Get gamepad info
export function getGamepadInfo() {
  return gamepadInfo;
}

// Setup all input event listeners
export function setupInputHandlers() {
  // Setup gamepad detection
  setupGamepadListeners();

  // Touch/virtual joystick
  const joystick = document.getElementById('joystick');
  const knob = document.getElementById('joystickKnob');
  const fireBtn = document.getElementById('fireBtn');
  const jumpBtn = document.getElementById('jumpBtn');
  let joystickActive = false;
  let joystickTouchId = null;
  let joystickCenter = { x: 0, y: 0 };
  function setJoystick(x, y) {
    const mag = Math.sqrt(x * x + y * y);
    if (mag > 1) { x /= mag; y /= mag; }
    virtualInput.forward = -y;
    virtualInput.turn = -x;
    if (knob) knob.style.transform = `translate(${x * 35}px, ${y * 35}px)`;
  }
  function handleJoystickStart(e) {
    if (e.touches && e.touches.length > 0) {
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
    fireBtn.addEventListener('mouseleave', () => { setFirePressed(false); });
    fireBtn.addEventListener('touchcancel', () => { setFirePressed(false); });
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
    jumpBtn.addEventListener('mouseleave', () => { setJumpPressed(false); });
    jumpBtn.addEventListener('touchcancel', () => { setJumpPressed(false); });
  }

  // Keyboard
  document.addEventListener('keydown', (e) => {
    const activeElement = document.activeElement;
    const isEditableElement = activeElement && (
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.isContentEditable
    );
    if (isEditableElement) return;
    keys[e.code] = true;
  });
  document.addEventListener('keyup', (e) => {
    const activeElement = document.activeElement;
    const isEditableElement = activeElement && (
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.isContentEditable
    );
    if (isEditableElement) return;
    keys[e.code] = false;
  });
}

// Update virtualInput from XR controller input
let vxrFrameCounter = 0;

export function updateVirtualInputFromXR() {
  if (!xrState.enabled) return;

  const xrInput = getXRControllerInput();

  // Right controller thumbstick: forward/backward (Y-axis) and left/right turn (X-axis)
  const newForward = -xrInput.rightThumbstick.y;
  virtualInput.forward = newForward;

  // Right controller thumbstick left/right: tank rotation
  virtualInput.turn = -xrInput.rightThumbstick.x;

  // Right trigger OR A button: fire
  virtualInput.fire = xrInput.rightTrigger > 0.5 || xrInput.buttonA;

  // B button OR side grip button: jump
  virtualInput.jump = xrInput.buttonB || xrInput.buttonGrip;

  // Debug logging every 60 frames
  vxrFrameCounter++;
  if (vxrFrameCounter % 60 === 0) {
    //debugLog(`virtualInput: forward=${newForward.toFixed(2)}, turn=${virtualInput.turn.toFixed(2)}, fire=${virtualInput.fire}, jump=${virtualInput.jump}`);
  }
}

// --- HUD & Orientation helpers ---

export const latestOrientation = {
  alpha: null,
  beta: null,
  gamma: null,
  status: '',
};

const defaultHudContext = {
  isMobile: false,
  showMessage: () => {},
  updateHudButtons: () => {},
  toggleDebugHud: () => {},
  updateDebugDisplay: () => {},
  getDebugEnabled: () => false,
  setDebugEnabled: () => {},
  getDebugState: () => ({}),
  getCameraMode: () => 'first-person',
  setCameraMode: () => {},
  getMouseControlEnabled: () => false,
  setMouseControlEnabled: () => {},
  getVirtualControlsEnabled: () => false,
  setVirtualControlsEnabled: (isMobile) => {},
  pushChatMessage: () => {},
  updateChatWindow: () => {},
  sendToServer: () => {},
  getScene: () => null,
  toggleEntryDialog: () => {},
  getChatInput: () => null,
};

let hudContext = { ...defaultHudContext };

const domRefs = {
  operatorOverlay: null,
  virtualControlsBtn: null,
  controlsOverlay: null,
  mouseBtn: null,
  fullscreenBtn: null,
  debugBtn: null,
  cameraBtn: null,
  helpBtn: null,
  settingsBtn: null,
  settingsHud: null,
  helpPanel: null,
  closeSettingsBtn: null,
  operatorBtn: null,
  closeOperatorBtn: null,
  wireframeBtn: null,
  playerNameEl: null,
};

let wireframeEnabled = false;
let orientationMode = null;
let orientationCenter = null;
let orientationListenersAttached = false;
let keyboardListenerAttached = false;
let orientationDebugInitialized = false;

function isMobileBrowser() {
  const ua = navigator.userAgent || navigator.vendor || window.opera;
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return true;
  const isIpad = (
    navigator.platform === 'MacIntel' && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1
  ) || /iPad/.test(ua);
  return Boolean(isIpad);
}

export const isMobile = isMobileBrowser();

function detectOrientationMode() {
  orientationMode = window.matchMedia('(orientation: landscape)').matches ? 'landscape' : 'portrait';
}

function resetOrientationCenter(status) {
  orientationCenter = null;
  if (status) {
    latestOrientation.status = status;
  }
}

function setupOrientationListeners() {
  if (orientationListenersAttached) return;
  detectOrientationMode();
  window.addEventListener('orientationchange', () => {
    detectOrientationMode();
    if (hudContext.isMobile && hudContext.getMouseControlEnabled()) {
      resetOrientationCenter('Orientation changed, recentered');
    }
  });
  window.addEventListener('resize', () => {
    const prev = orientationMode;
    detectOrientationMode();
    if (orientationMode !== prev && hudContext.isMobile && hudContext.getMouseControlEnabled()) {
      resetOrientationCenter('Orientation changed (resize), recentered');
    }
  });
  orientationListenersAttached = true;
}

function setupMobileOrientationDebug() {
  if (orientationDebugInitialized) return;
  orientationDebugInitialized = true;
  if (!hudContext.isMobile) {
    latestOrientation.status = 'Desktop device';
    return;
  }
  function handleOrientation(event) {
    const { alpha, beta, gamma } = event;
    latestOrientation.alpha = alpha;
    latestOrientation.beta = beta;
    latestOrientation.gamma = gamma;
    latestOrientation.status = 'OK';
  }

  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then(permissionState => {
        if (permissionState === 'granted') {
          window.addEventListener('deviceorientation', handleOrientation);
          latestOrientation.status = 'Permission granted';
        } else {
          latestOrientation.status = 'Permission denied';
        }
      })
      .catch(err => {
        latestOrientation.status = `Permission error: ${err}`;
      });
  } else {
    window.addEventListener('deviceorientation', handleOrientation);
    latestOrientation.status = 'Listener attached';
  }
}

function stopPropagationForHud(ids, preventDefault = true) {
  ids.forEach((id) => {
    const element = document.getElementById(id);
    if (!element) return;
    ['click', 'mousedown', 'mouseup'].forEach((evt) => {
      element.addEventListener(evt, (e) => {
        e.stopPropagation();
        if (preventDefault) e.preventDefault();
      });
    });
  });
}

function refreshHudButtons() {
  if (typeof hudContext.updateHudButtons !== 'function') return;
  hudContext.updateHudButtons({
    mouseBtn: domRefs.mouseBtn,
    mouseControlEnabled: hudContext.getMouseControlEnabled(),
    debugBtn: domRefs.debugBtn,
    debugEnabled: hudContext.getDebugEnabled(),
    fullscreenBtn: domRefs.fullscreenBtn,
    cameraBtn: domRefs.cameraBtn,
    cameraMode: hudContext.getCameraMode(),
  });
}

function setWireframeMode(enabled) {
  const scene = hudContext.getScene();
  if (!scene) return;
  scene.traverse((obj) => {
    if (obj.isMesh && obj.material) {
      if (Array.isArray(obj.material)) {
        obj.material.forEach((mat) => { if (mat) mat.wireframe = enabled; });
      } else {
        obj.material.wireframe = enabled;
      }
    }
  });
  wireframeEnabled = enabled;
  if (domRefs.wireframeBtn) {
    domRefs.wireframeBtn.classList.toggle('active', enabled);
  }
}

function updateSettingsBtn() {
  if (!domRefs.settingsBtn || !domRefs.settingsHud) return;
  const visible = domRefs.settingsHud.style.display === 'block';
  domRefs.settingsBtn.classList.toggle('active', visible);
  domRefs.settingsBtn.title = visible ? 'Hide Settings' : 'Show Settings';
}

function toggleSettingsHud() {
  if (!domRefs.settingsHud) return;
  const visible = domRefs.settingsHud.style.display === 'block';
  domRefs.settingsHud.style.display = visible ? 'none' : 'block';
  hudContext.showMessage(visible ? 'Settings: Hidden' : 'Settings: Shown');
  updateSettingsBtn();
}

function updateHelpBtn() {
  if (!domRefs.helpBtn || !domRefs.helpPanel) return;
  const visible = domRefs.helpPanel.style.display === 'block';
  domRefs.helpBtn.classList.toggle('active', visible);
  domRefs.helpBtn.title = visible ? 'Hide Help (?)' : 'Show Help (?)';
}

function toggleHelpPanel() {
  if (!domRefs.helpPanel) return;
  const visible = domRefs.helpPanel.style.display === 'block';
  domRefs.helpPanel.style.display = visible ? 'none' : 'block';
  hudContext.showMessage(visible ? 'Help Panel: Hidden' : 'Help Panel: Shown');
  updateHelpBtn();
}

export function hideHelpPanel() {
  if (!domRefs.helpPanel) return;
  if (domRefs.helpPanel.style.display === 'block') {
    toggleHelpPanel();
  }
}

function toggleFullscreen() {
  const isFullscreen = document.fullscreenElement ||
                       document.webkitFullscreenElement ||
                       document.mozFullScreenElement;

  // Detect iOS (Chrome, Safari, etc.)
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.navigator.standalone === true;

  if (!isFullscreen) {
    // On iOS, show message about adding to home screen
    if (isIOS && !isStandalone) {
      hudContext.pushChatMessage('💡 iOS: Use "Share" → "Add to Home Screen" for fullscreen');
      hudContext.updateChatWindow();
      return;
    }

    // Request fullscreen
    const elem = document.documentElement;
    const request = elem.requestFullscreen ||
                   elem.webkitRequestFullscreen ||
                   elem.webkitEnterFullscreen ||
                   elem.mozRequestFullScreen;

    if (request) {
      try {
        if (request === elem.webkitEnterFullscreen) {
          // Older webkit
          request.call(elem);
        } else if (request === elem.webkitRequestFullscreen) {
          // Older webkit with keyboard input
          request.call(elem, Element.ALLOW_KEYBOARD_INPUT);
        } else {
          // Standard fullscreen
          request.call(elem);
        }
      } catch (e) {
        console.warn('Fullscreen request failed:', e);
        hudContext.pushChatMessage('⚠️ Fullscreen not supported');
        hudContext.updateChatWindow();
      }
    } else {
      hudContext.pushChatMessage('⚠️ Fullscreen not supported');
      hudContext.updateChatWindow();
    }
  } else {
    // Exit fullscreen
    const exit = document.exitFullscreen ||
               document.webkitExitFullscreen ||
               document.webkitCancelFullScreen ||
               document.mozCancelFullScreen;

    if (exit) {
      try {
        exit.call(document);
      } catch (e) {
        console.warn('Fullscreen exit failed:', e);
      }
    }
  }

  setTimeout(() => {
    const message = `Screen resolution: ${window.innerWidth}x${window.innerHeight}`;
    hudContext.pushChatMessage(message);
    hudContext.updateChatWindow();
  }, 200);
  setTimeout(refreshHudButtons, 100);
}

function cameraModeLabel(mode) {
  if (mode === 'first-person') return 'First Person';
  if (mode === 'third-person') return 'Third Person';
  return 'Overview';
}

function cycleCameraMode() {
  const current = hudContext.getCameraMode();
  const next = current === 'first-person' ? 'third-person' : current === 'third-person' ? 'overview' : 'first-person';
  hudContext.setCameraMode(next);
  try {
    localStorage.setItem('cameraMode', next);
  } catch (_) {
    /* ignore storage errors */
  }
  hudContext.showMessage(`Camera: ${cameraModeLabel(next)}`);
  refreshHudButtons();
}

export function toggleMouseMode(forceState) {
  const current = hudContext.getMouseControlEnabled();
  const next = typeof forceState === 'boolean' ? forceState : !current;
  if (next === current) return;
  hudContext.setMouseControlEnabled(next);
  try {
    localStorage.setItem('mouseControlEnabled', next ? 'true' : 'false');
  } catch (_) {
    /* ignore storage errors */
  }
  if (next && hudContext.isMobile) {
    resetOrientationCenter('Orientation changed, recentered');
  }
  hudContext.showMessage(`Controls: ${next ? 'Mouse' : 'Keyboard'}`);
  refreshHudButtons();
}

function updateVirtualControlsBtn() {
  if (!domRefs.virtualControlsBtn) return;
  const enabled = hudContext.getVirtualControlsEnabled();
  domRefs.virtualControlsBtn.classList.toggle('active', enabled);
  domRefs.virtualControlsBtn.title = enabled ? 'Hide Virtual Controls' : 'Show Virtual Controls';
}

export function toggleVirtualControls(forceState) {
  if (!domRefs.controlsOverlay) return;
  const current = hudContext.getVirtualControlsEnabled();
  const next = typeof forceState === 'boolean' ? forceState : !current;
  hudContext.setVirtualControlsEnabled(next);
  domRefs.controlsOverlay.style.display = next ? 'block' : 'none';
  document.body.classList.toggle('virtual-controls-active', next);
  updateVirtualControlsBtn();
  hudContext.showMessage(`Virtual Controls: ${next ? 'Enabled' : 'Disabled'}`);
}

function updateOperatorBtn() {
  if (!domRefs.operatorBtn || !domRefs.operatorOverlay) return;
  const isVisible = window.getComputedStyle(domRefs.operatorOverlay).display !== 'none';
  domRefs.operatorBtn.classList.toggle('active', isVisible);
  domRefs.operatorBtn.title = isVisible ? 'Hide Operator Panel (O)' : 'Show Operator Panel (O)';
}

export function toggleOperatorPanel() {
  if (!domRefs.operatorOverlay) return;
  const currentVisible = window.getComputedStyle(domRefs.operatorOverlay).display !== 'none';
  if (currentVisible) {
    domRefs.operatorOverlay.style.setProperty('display', 'none');
    hudContext.showMessage('Operator Panel: Hidden');
  } else {
    domRefs.operatorOverlay.style.setProperty('display', 'block');
    hudContext.showMessage('Operator Panel: Shown');
    const requestId = Math.floor(Math.random() * 1e9);
    hudContext.sendToServer({ type: 'getMaps', requestId });
    window._operatorMapReqId = requestId;
  }
  updateOperatorBtn();
}

function bindHudElements() {
  setupMobileOrientationDebug();

  domRefs.operatorOverlay = document.getElementById('operatorOverlay');
  domRefs.virtualControlsBtn = document.getElementById('virtualControlsBtn');
  domRefs.controlsOverlay = document.getElementById('controlsOverlay');
  domRefs.mouseBtn = document.getElementById('mouseBtn');
  domRefs.fullscreenBtn = document.getElementById('fullscreenBtn');
  domRefs.debugBtn = document.getElementById('debugBtn');
  domRefs.cameraBtn = document.getElementById('cameraBtn');
  domRefs.helpBtn = document.getElementById('helpBtn');
  domRefs.settingsBtn = document.getElementById('settingsBtn');
  domRefs.settingsHud = document.getElementById('settingsHud');
  domRefs.helpPanel = document.getElementById('helpPanel');
  domRefs.closeSettingsBtn = document.getElementById('closeSettingsHud');
  domRefs.operatorBtn = document.getElementById('operatorBtn');
  domRefs.closeOperatorBtn = document.getElementById('closeOperatorBtn');
  domRefs.wireframeBtn = document.getElementById('wireframeBtn');
  domRefs.playerNameEl = document.getElementById('playerName');

  stopPropagationForHud(['chatHud', 'debugHud', 'radarHud', 'controlsOverlay', 'settingsHud', 'helpPanel']);
  stopPropagationForHud(['operatorOverlay'], false);

  if (domRefs.wireframeBtn) {
    domRefs.wireframeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setWireframeMode(!wireframeEnabled);
    });
  }

  if (domRefs.virtualControlsBtn) {
    domRefs.virtualControlsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleVirtualControls();
    });
  }

  if (domRefs.mouseBtn) {
    domRefs.mouseBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleMouseMode();
    });
  }

  if (domRefs.fullscreenBtn) {
    domRefs.fullscreenBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleFullscreen();
    });
  }

  if (domRefs.debugBtn) {
    domRefs.debugBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      hudContext.toggleDebugHud({
        debugEnabled: hudContext.getDebugEnabled(),
        setDebugEnabled: hudContext.setDebugEnabled,
        updateHudButtons: () => refreshHudButtons(),
        showMessage: hudContext.showMessage,
        updateDebugDisplay: hudContext.updateDebugDisplay,
        getDebugState: hudContext.getDebugState,
      });
    });
  }

  if (domRefs.cameraBtn) {
    domRefs.cameraBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      cycleCameraMode();
    });
  }

  if (domRefs.helpBtn) {
    domRefs.helpBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleHelpPanel();
    });
  }

  if (domRefs.settingsBtn) {
    domRefs.settingsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleSettingsHud();
    });
  }

  if (domRefs.closeSettingsBtn) {
    domRefs.closeSettingsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleSettingsHud();
    });
  }

  if (domRefs.operatorBtn) {
    domRefs.operatorBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleSettingsHud();
      toggleOperatorPanel();
    });
  }

  if (domRefs.closeOperatorBtn) {
    domRefs.closeOperatorBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleOperatorPanel();
    });
  }

  if (domRefs.playerNameEl) {
    domRefs.playerNameEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      hudContext.toggleEntryDialog();
    });
  }

  if (!keyboardListenerAttached) {
    document.addEventListener('keydown', (e) => {
      const activeElement = document.activeElement;
      const chatInput = hudContext.getChatInput ? hudContext.getChatInput() : null;
      if (activeElement === chatInput) return;
      const entryInput = document.getElementById('entryInput');
      if (activeElement === entryInput) return;

      if (e.key === 'm' || e.key === 'M') {
        toggleMouseMode();
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      } else if (e.key === 'i' || e.key === 'I') {
        hudContext.toggleDebugHud({
          debugEnabled: hudContext.getDebugEnabled(),
          setDebugEnabled: hudContext.setDebugEnabled,
          updateHudButtons: () => refreshHudButtons(),
          showMessage: hudContext.showMessage,
          updateDebugDisplay: hudContext.updateDebugDisplay,
          getDebugState: hudContext.getDebugState,
        });
      } else if (e.key === 'c' || e.key === 'C') {
        cycleCameraMode();
      } else if (e.key === 'o' || e.key === 'O') {
        toggleOperatorPanel();
      } else if (e.key === '?' || e.key === '/') {
        toggleHelpPanel();
      }
    });
    keyboardListenerAttached = true;
  }

  try {
    const savedCameraMode = localStorage.getItem('cameraMode');
    if (savedCameraMode === 'first-person' || savedCameraMode === 'third-person' || savedCameraMode === 'overview') {
      hudContext.setCameraMode(savedCameraMode);
    }
  } catch (_) {
    /* ignore storage errors */
  }
  try {
    const savedMouseMode = localStorage.getItem('mouseControlEnabled');
    if (savedMouseMode === 'true') {
      hudContext.setMouseControlEnabled(true);
    }
  } catch (_) {
    /* ignore storage errors */
  }

  updateSettingsBtn();
  updateHelpBtn();
  updateOperatorBtn();
  updateVirtualControlsBtn();
  refreshHudButtons();
}

export function initHudControls(context) {
  hudContext = { ...hudContext, ...context, isMobile };
  setupOrientationListeners();
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => bindHudElements(), { once: true });
  } else {
    bindHudElements();
  }
  toggleVirtualControls(isMobile);
}
