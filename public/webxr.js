/*
 * Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/timriker/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */

// WebXR Manager for VR/AR support (Quest 2, Viture Luma Ultra, etc.)

let xrSession = null;
let xrSupported = false;
let xrEnabled = false;
let xrMode = null; // 'immersive-vr' or 'immersive-ar'
let xrInputSources = new Map(); // Map of controller input source ID -> controller state
let xrSessionLifecycle = null;
let xrStartPromise = null;
let xrEndPromise = null;
const xrStateSubscribers = new Set();

export const xrState = {
  enabled: false,
  isSupported: false,
  headPose: null, // { position: THREE.Vector3, quaternion: THREE.Quaternion }
  controllers: new Map(), // input source ID -> { pose, grip, select }
  frameCounter: 0,
};

export function getXRStateSnapshot() {
  return {
    enabled: Boolean(xrEnabled),
    isSupported: Boolean(xrSupported || xrState.isSupported),
    mode: xrMode,
    headPose: xrState.headPose,
    frameCounter: xrState.frameCounter,
  };
}

export function subscribeToXRState(listener) {
  if (typeof listener !== 'function') {
    throw new TypeError('XR state listener must be a function');
  }

  xrStateSubscribers.add(listener);
  listener(getXRStateSnapshot());

  return () => {
    xrStateSubscribers.delete(listener);
  };
}

// Send debug message through app-wide logger in client.js
export function debugLog(message) {
  if (typeof window !== 'undefined' && typeof window.gameDebugLog === 'function') {
    window.gameDebugLog(message, 'WebXR');
  }
}

function publishSessionState() {
  const snapshot = getXRStateSnapshot();
  for (const listener of [...xrStateSubscribers]) {
    listener(snapshot);
  }
}

// Check if WebXR is available
async function checkXRSupport() {
  debugLog('Checking XR support... navigator.xr=' + (navigator.xr ? 'YES' : 'NO'));
  if (!navigator.xr) {
    debugLog('navigator.xr not available - WebXR not supported');
    return 'none';
  }

  try {
    // Try immersive-vr
    const vrSupported = await navigator.xr.isSessionSupported('immersive-vr');
    if (vrSupported) {
      debugLog('immersive-vr (VR) supported');
      xrMode = 'immersive-vr';
      xrSupported = true;
      xrState.isSupported = true;
      return 'vr';
    }

    // Fall back to immersive-ar
    const arSupported = await navigator.xr.isSessionSupported('immersive-ar');
    if (arSupported) {
      debugLog('immersive-ar (AR) supported');
      xrMode = 'immersive-ar';
      xrSupported = true;
      xrState.isSupported = true;
      return 'ar';
    }

    debugLog('Neither immersive-ar nor immersive-vr supported');
    xrSupported = false;
    xrState.isSupported = false;
    return 'none';
  } catch (err) {
    debugLog('Failed to check support: ' + err.message);
    console.error('[WebXR] Full error:', err);
    return 'none';
  }
}

// Request and create XR session
async function requestXRSession(renderer, animationCallback) {
  debugLog('Requesting XR session, supported: ' + xrSupported);
  if (!xrSupported) {
    debugLog('WebXR not supported on this device');
    return false;
  }

  if (!renderer) {
    debugLog('ERROR: renderer is null or undefined');
    return false;
  }

  if (xrSession || xrStartPromise) {
    debugLog('XR session request ignored because a session is already active or starting');
    return Boolean(xrSession);
  }

  if (xrEndPromise) {
    await xrEndPromise;
  }

  const startPromise = startXRSession(renderer, animationCallback);
  xrStartPromise = startPromise;

  try {
    return await startPromise;
  } finally {
    if (xrStartPromise === startPromise) {
      xrStartPromise = null;
    }
  }
}

async function startXRSession(renderer, animationCallback) {
  let session = null;

  try {
    debugLog('About to call navigator.xr.requestSession with mode: ' + xrMode);
    // Request XR session (AR or VR based on device support)
    const sessionFeatures = {
      optionalFeatures: ['hand-tracking', 'local-floor'],
    };
    session = await navigator.xr.requestSession(xrMode, sessionFeatures);

    debugLog('XR session (mode=' + xrMode + ') created successfully');
    xrSession = session;
    xrSessionLifecycle = createXRSessionLifecycle(session, renderer);

    // Configure renderer for XR
    debugLog('Configuring renderer for XR...');
    renderer.xr.enabled = true;
    await renderer.xr.setSession(session);

    if (xrSessionLifecycle?.session !== session || xrSessionLifecycle.ended) {
      throw new Error('XR session ended before renderer setup completed');
    }

    xrEnabled = true;
    xrState.enabled = true;
    publishSessionState();

    // Set up the XR animation loop
    if (animationCallback) {
      debugLog('Setting XR animation loop...');
      renderer.xr.setAnimationLoop(animationCallback);
    }

    debugLog('XR session started successfully');
    return true;
  } catch (err) {
    debugLog('ERROR: Failed to create XR session: ' + err.message);
    if (session && xrSessionLifecycle?.session === session) {
      await endXRSession(session, { requestEnd: true, restoreLoop: false });
    } else {
      resetXRState();
    }
    return false;
  }
}

function createXRSessionLifecycle(session, renderer) {
  const lifecycle = {
    session,
    renderer,
    ended: false,
    endRequested: false,
    inputSourcesChangeHandler: null,
    visibilityChangeHandler: null,
    endHandler: null,
  };

  lifecycle.inputSourcesChangeHandler = event => {
    if (xrSessionLifecycle !== lifecycle) {
      return;
    }

    event.removed?.forEach(inputSource => {
      removeXRInputSource(inputSource);
    });
    event.added?.forEach(inputSource => {
      addXRInputSource(inputSource);
    });
  };

  lifecycle.visibilityChangeHandler = () => {
    if (xrSessionLifecycle !== lifecycle) {
      return;
    }

    if (session.visibilityState === 'hidden') {
      xrState.headPose = null;
      resetXRControllerStates();
      xrState.controllers.clear();
    }
  };

  lifecycle.endHandler = () => {
    if (xrSessionLifecycle !== lifecycle) {
      return;
    }

    lifecycle.ended = true;
    debugLog('XR session ended');
    void endXRSession(session, { requestEnd: false, restoreLoop: true });
  };

  session.addEventListener('inputsourceschange', lifecycle.inputSourcesChangeHandler);
  session.addEventListener('visibilitychange', lifecycle.visibilityChangeHandler);
  session.addEventListener('end', lifecycle.endHandler);
  setupXRInput(session);

  return lifecycle;
}

async function endXRSession(session = xrSession, { requestEnd = true, restoreLoop = false } = {}) {
  if (xrEndPromise) {
    return await xrEndPromise;
  }

  const lifecycle = xrSessionLifecycle?.session === session ? xrSessionLifecycle : null;
  if (lifecycle && !requestEnd) {
    lifecycle.ended = true;
  }

  const endPromise = Promise.resolve().then(async () => {
    if (requestEnd && lifecycle && !lifecycle.ended && !lifecycle.endRequested) {
      lifecycle.endRequested = true;
      try {
        await session.end();
      } catch (err) {
        debugLog('XR session end request failed: ' + err.message);
      }
    }

    cleanupXRSession(lifecycle, session);
    if (restoreLoop) {
      restoreNormalAnimationLoop();
    }
  });

  xrEndPromise = endPromise;
  try {
    await endPromise;
  } finally {
    if (xrEndPromise === endPromise) {
      xrEndPromise = null;
    }
  }
}

function cleanupXRSession(lifecycle, session) {
  if (lifecycle) {
    session.removeEventListener('inputsourceschange', lifecycle.inputSourcesChangeHandler);
    session.removeEventListener('visibilitychange', lifecycle.visibilityChangeHandler);
    session.removeEventListener('end', lifecycle.endHandler);

    if (typeof lifecycle.renderer?.setAnimationLoop === 'function') {
      lifecycle.renderer.setAnimationLoop(null);
    } else if (lifecycle.renderer?.xr) {
      lifecycle.renderer.xr.setAnimationLoop(null);
    }
  }

  if (!lifecycle || xrSessionLifecycle === lifecycle) {
    xrSession = null;
    xrSessionLifecycle = null;
    resetXRState();
  }
}

function resetXRState() {
  xrEnabled = false;
  xrState.enabled = false;
  xrState.headPose = null;
  xrState.frameCounter = 0;
  xrInputSources.clear();
  xrState.controllers.clear();
  publishSessionState();
}

// Store reference to reset animation loop
let normalAnimationCallback = null;

export function setNormalAnimationLoop(renderer, callback) {
  if (!renderer || typeof callback !== 'function') {
    normalAnimationCallback = null;
    return;
  }
  normalAnimationCallback = { renderer, callback };
}

// Restore normal animation loop after exiting XR
export function restoreNormalAnimationLoop() {
  if (normalAnimationCallback) {
    const { renderer, callback } = normalAnimationCallback;
    if (!renderer) {
      return;
    }
    if (typeof renderer.setAnimationLoop === 'function') {
      renderer.setAnimationLoop(callback);
    } else if (renderer.xr) {
      renderer.xr.setAnimationLoop(null); // Clear XR loop
      // Resume normal RAF when the renderer has no unified animation-loop API.
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(callback);
      }
    } else if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(callback);
    }
  }
}

function createXRControllerState(inputSource) {
  return {
    inputSource,
    gamepad: null,
    thumbstick: { x: 0, y: 0 },
    trigger: 0,
    triggerPressed: false,
    grip: 0,
    buttonA: false,
    buttonB: false,
    buttonGrip: false,
    buttonThumbstick: false,
  };
}

function addXRInputSource(inputSource) {
  const handedness = inputSource?.handedness;
  if (!handedness) {
    return;
  }

  const controller = xrInputSources.get(handedness) || createXRControllerState(inputSource);
  controller.inputSource = inputSource;
  xrInputSources.set(handedness, controller);
}

function removeXRInputSource(inputSource) {
  const handedness = inputSource?.handedness;
  if (!handedness) {
    return;
  }

  const controller = xrInputSources.get(handedness);
  if (!controller || controller.inputSource === inputSource) {
    xrInputSources.delete(handedness);
    xrState.controllers.delete(handedness);
  }
}

function resetXRControllerState(controller) {
  controller.gamepad = null;
  controller.thumbstick.x = 0;
  controller.thumbstick.y = 0;
  controller.trigger = 0;
  controller.triggerPressed = false;
  controller.grip = 0;
  controller.buttonA = false;
  controller.buttonB = false;
  controller.buttonGrip = false;
  controller.buttonThumbstick = false;
}

function resetXRControllerStates() {
  xrInputSources.forEach(resetXRControllerState);
  xrState.controllers.forEach(resetXRControllerState);
}

function readThumbstickAxes(axes = [], preferredPair = [0, 1]) {
  const pairs = [preferredPair, [0, 1], [2, 3]];
  for (const [xIndex, yIndex] of pairs) {
    const xValue = axes[xIndex];
    const yValue = axes[yIndex];
    const hasX = Number.isFinite(xValue);
    const hasY = Number.isFinite(yValue);
    if (hasX || hasY) {
      return {
        x: hasX ? xValue : 0,
        y: hasY ? yValue : 0,
      };
    }
  }

  return { x: 0, y: 0 };
}

// Setup XR input (controllers)
function setupXRInput(session = xrSession) {
  if (!session) {
    return;
  }

  for (const inputSource of session.inputSources || []) {
    addXRInputSource(inputSource);
  }
}

// Update XR controller input each frame
export function updateXRControllerInput() {
  if (!xrSession || !xrEnabled) {
    return;
  }

  if (xrSession.visibilityState === 'hidden') {
    resetXRControllerStates();
    xrState.controllers.clear();
    return;
  }

  const frameCounter = xrState.frameCounter || 0;
  xrState.frameCounter = frameCounter + 1;
  const activeHandedness = new Set();
  xrState.controllers.clear();

  for (const inputSource of xrSession.inputSources || []) {
    const handedness = inputSource.handedness; // 'left' or 'right'
    if (!handedness) {
      continue;
    }
    activeHandedness.add(handedness);

    if (!xrInputSources.has(handedness)) {
      addXRInputSource(inputSource);
    }

    const controller = xrInputSources.get(handedness);
    resetXRControllerState(controller);
    controller.inputSource = inputSource;
    controller.gamepad = inputSource.gamepad;

    // Get thumbstick and trigger values from gamepad
    if (inputSource.gamepad) {
      const axes = inputSource.gamepad.axes || [];
      const buttons = inputSource.gamepad.buttons || [];

      if (buttons[0]) {
        controller.trigger = buttons[0].value;
        controller.triggerPressed = buttons[0].pressed || false;
      }
      if (buttons[1]) {
        controller.grip = buttons[1].value;
        controller.buttonGrip = buttons[1].pressed || false;
      }
      if (buttons[4]) {
        controller.buttonA = buttons[4].pressed || false;
      }
      if (buttons[5]) {
        controller.buttonB = buttons[5].pressed || false;
      }
      if (buttons[3]) {
        controller.buttonThumbstick = buttons[3].pressed || false;
      }

      // Left controller: thumbstick for movement (axes 0, 1)
      if (handedness === 'left') {
        const stick = readThumbstickAxes(axes, [0, 1]);
        controller.thumbstick.x = stick.x;
        controller.thumbstick.y = stick.y;
        if (frameCounter % 60 === 0) {
          debugLog(`Left: axes.length=${axes.length}, [0]=${axes[0]?.toFixed(2)}, [1]=${axes[1]?.toFixed(2)}`);
        }
      }

      // Right controller: thumbstick for rotation (axes 2, 3) and buttons for actions
      if (handedness === 'right') {
        const stick = readThumbstickAxes(axes, [2, 3]);
        controller.thumbstick.x = stick.x;
        controller.thumbstick.y = stick.y;

        if (frameCounter % 60 === 0) {
          debugLog(`Right: axes[2]=${axes[2]?.toFixed(2)}, axes[3]=${axes[3]?.toFixed(2)}, A=${controller.buttonA}, B=${controller.buttonB}, btnCount=${buttons.length}`);
        }
      }
    }

    xrState.controllers.set(handedness, controller);
  }

  for (const handedness of xrInputSources.keys()) {
    if (!activeHandedness.has(handedness)) {
      xrInputSources.delete(handedness);
    }
  }
}


// Get controller input for game
export function getXRControllerInput() {
  const input = {
    leftThumbstick: { x: 0, y: 0 },
    rightThumbstick: { x: 0, y: 0 },
    leftThumbstickPressed: false,
    rightThumbstickPressed: false,
    leftTrigger: 0,
    rightTrigger: 0,
    leftGrip: 0,
    rightGrip: 0,
    buttonA: false,
    buttonB: false,
    buttonGrip: false,
  };

  if (xrState.controllers.get('left')) {
    const leftController = xrState.controllers.get('left');
    input.leftThumbstick = { ...leftController.thumbstick };
    input.leftThumbstickPressed = leftController.buttonThumbstick || false;
    input.leftTrigger = leftController.trigger || 0;
    input.leftGrip = leftController.grip || 0;
    input.buttonA = input.buttonA || leftController.buttonA || false;
    input.buttonB = input.buttonB || leftController.buttonB || false;
    input.buttonGrip = input.buttonGrip || leftController.buttonGrip || false;
  }

  if (xrState.controllers.get('right')) {
    const rightController = xrState.controllers.get('right');
    input.rightThumbstick = { ...rightController.thumbstick };
    input.rightTrigger = rightController.trigger || 0;
    input.rightGrip = rightController.grip || 0;
    input.buttonA = input.buttonA || rightController.buttonA || false;
    input.buttonB = input.buttonB || rightController.buttonB || false;
    input.buttonGrip = input.buttonGrip || rightController.buttonGrip || false;
    input.rightThumbstickPressed = rightController.buttonThumbstick || false;
  }

  return input;
}

// Export API
export async function initXR() {
  return await checkXRSupport();
}

export async function toggleXRSession(renderer, animationCallback) {
  debugLog('toggleXRSession called, currently enabled: ' + xrEnabled);
  if (xrStartPromise) {
    debugLog('XR session start already in progress');
    return await xrStartPromise;
  }

  if (xrSession || xrEnabled || xrEndPromise) {
    debugLog('Ending XR session...');
    await endXRSession(xrSession, { requestEnd: true, restoreLoop: true });
    return false;
  } else {
    debugLog('Starting XR session...');
    return await requestXRSession(renderer, animationCallback);
  }
}

export function isXREnabled() {
  return getXRStateSnapshot().enabled;
}
