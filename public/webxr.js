/*
 * This file is part of a project licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * See the LICENSE file in the project root or visit https://www.gnu.org/licenses/agpl-3.0.html
 */

// WebXR Manager for VR support (Quest 2, etc.)

import * as THREE from 'three';

let xrSession = null;
let xrSupported = false;
let xrEnabled = false;
let xrInputSources = new Map(); // Map of controller input source ID -> controller state
let xrAnimationCallback = null;
let sendToServerCallback = null; // For logging debug messages

export const xrState = {
  enabled: false,
  isSupported: false,
  headPose: null, // { position: THREE.Vector3, quaternion: THREE.Quaternion }
  controllers: new Map(), // input source ID -> { pose, grip, select }
};

// Set callback for sending debug messages to server
export function setSendToServer(callback) {
  sendToServerCallback = callback;
}

// Send debug message to server and console
export function debugLog(message) {
  console.log('[WebXR] ' + message);
  if (sendToServerCallback) {
    try {
      sendToServerCallback({ type: 'debug', message: '[WebXR] ' + message });
    } catch (e) {
      console.error('[WebXR] Failed to send to server:', e);
    }
  }
}

// Register callback for frame updates (will be called from renderer.setAnimationLoop)
export function setXRFrameCallback(callback) {
  xrAnimationCallback = callback;
}

// Check if WebXR is available
async function checkXRSupport() {
  debugLog('Checking XR support... navigator.xr=' + (navigator.xr ? 'YES' : 'NO'));
  if (!navigator.xr) {
    debugLog('navigator.xr not available - WebXR not supported');
    return false;
  }

  try {
    const supported = await navigator.xr.isSessionSupported('immersive-vr');
    debugLog('isSessionSupported result: ' + supported);
    xrSupported = supported;
    xrState.isSupported = supported;
    return supported;
  } catch (err) {
    debugLog('Failed to check support: ' + err.message);
    console.error('[WebXR] Full error:', err);
    return false;
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

  try {
    debugLog('About to call navigator.xr.requestSession');
    // Request immersive VR session with local-floor reference space
    xrSession = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['hand-tracking', 'local-floor'],
    });

    debugLog('XR session created successfully');
    xrEnabled = true;
    xrState.enabled = true;

    // Setup input handling
    setupXRInput();

    // Configure renderer for XR
    debugLog('Configuring renderer for XR...');
    renderer.xr.enabled = true;
    renderer.xr.setSession(xrSession);

    // Set up the XR animation loop
    if (animationCallback) {
      debugLog('Setting XR animation loop...');
      renderer.xr.setAnimationLoop(animationCallback);
    }

    debugLog('XR session started successfully');

    // Listen for session end
    xrSession.addEventListener('end', () => {
      debugLog('XR session ended');
      endXRSession();
    });

    return true;
  } catch (err) {
    debugLog('ERROR: Failed to create XR session: ' + err.message);
    xrEnabled = false;
    xrState.enabled = false;
    return false;
  }
}

// End XR session
function endXRSession() {
  if (xrSession) {
    xrSession.end();
    xrSession = null;
  }
  xrEnabled = false;
  xrState.enabled = false;
  xrInputSources.clear();
  xrState.controllers.clear();
}

// Store reference to reset animation loop
let normalAnimationCallback = null;

export function setNormalAnimationLoop(renderer, callback) {
  normalAnimationCallback = { renderer, callback };
}

// Restore normal animation loop after exiting XR
export function restoreNormalAnimationLoop() {
  if (normalAnimationCallback) {
    const { renderer, callback } = normalAnimationCallback;
    renderer.xr.setAnimationLoop(null); // Clear XR loop
    // Resume normal RAF
    requestAnimationFrame(callback);
  }
}

// Setup XR input (controllers)
function setupXRInput() {
  if (!xrSession) return;

  xrSession.addEventListener('inputsourceschange', (event) => {
    event.added.forEach((inputSource) => {
      xrInputSources.set(inputSource.handedness, {
        inputSource,
        gamepad: null,
        pressed: false,
          thumbstick: { x: 0, y: 0 },
          grip: 0,
      });
    });

    event.removed.forEach((inputSource) => {
      xrInputSources.delete(inputSource.handedness);
    });
  });
}

// Update XR controller input each frame
export function updateXRControllerInput() {
  if (!xrSession || !xrEnabled) {
    return;
  }

  let frameCounter = xrState.frameCounter || 0;
  xrState.frameCounter = frameCounter + 1;

  for (const inputSource of xrSession.inputSources) {
    const handedness = inputSource.handedness; // 'left' or 'right'

    if (!xrInputSources.has(handedness)) {
      xrInputSources.set(handedness, {
        inputSource,
        gamepad: null,
        thumbstick: { x: 0, y: 0 },
        trigger: 0,
          grip: 0,
        buttonA: false,
        buttonB: false,
          buttonGrip: false,
      });
    }

    const controller = xrInputSources.get(handedness);
    controller.gamepad = inputSource.gamepad;

    // Get thumbstick and trigger values from gamepad
    if (inputSource.gamepad) {
      const axes = inputSource.gamepad.axes;
      const buttons = inputSource.gamepad.buttons;

      // Left controller: thumbstick for movement (axes 0, 1)
      if (handedness === 'left') {
        controller.thumbstick.x = axes[0] || 0; // left/right
        controller.thumbstick.y = axes[1] || 0; // up/down (forward/back)
        if (frameCounter % 60 === 0) {
          debugLog(`Left: axes.length=${axes.length}, [0]=${axes[0]?.toFixed(2)}, [1]=${axes[1]?.toFixed(2)}`);
        }
      }

      // Right controller: thumbstick for rotation (axes 2, 3) and buttons for actions
      if (handedness === 'right') {
        controller.thumbstick.x = axes[2] || 0; // left/right (turn)
        controller.thumbstick.y = axes[3] || 0; // up/down (unused in phase 1)

        controller.buttonA = false;
        controller.buttonB = false;
          controller.buttonGrip = false;

        // Trigger button (index 0) for shooting
        if (buttons[0]) {
          controller.trigger = buttons[0].value; // 0-1
          controller.triggerPressed = buttons[0].pressed;
        }

          // Side grip/squeeze button (index 1) for jumping
          if (buttons[1]) {
            controller.grip = buttons[1].value; // 0-1
            controller.buttonGrip = buttons[1].pressed || false;
          }

        // A button (index 4) for firing
        if (buttons[4]) {
          controller.buttonA = buttons[4].pressed || false;
        }

        // B button (index 5) for jumping
        if (buttons[5]) {
          controller.buttonB = buttons[5].pressed || false;
        }
        if (frameCounter % 60 === 0) {
          //debugLog(`Right: axes[2]=${axes[2]?.toFixed(2)}, axes[3]=${axes[3]?.toFixed(2)}, A=${controller.buttonA}, B=${controller.buttonB}, btnCount=${buttons.length}`);
        }
      }
    }

    xrState.controllers.set(handedness, controller);
  }
}


// Get controller input for game
export function getXRControllerInput() {
  const input = {
    leftThumbstick: { x: 0, y: 0 },
    rightThumbstick: { x: 0, y: 0 },
    rightTrigger: 0,
      rightGrip: 0,
    buttonA: false,
    buttonB: false,
      buttonGrip: false,
  };

  if (xrState.controllers.get('left')) {
    input.leftThumbstick = { ...xrState.controllers.get('left').thumbstick };
  }

  if (xrState.controllers.get('right')) {
    const rightController = xrState.controllers.get('right');
    input.rightThumbstick = { ...rightController.thumbstick };
    input.rightTrigger = rightController.trigger || 0;
      input.rightGrip = rightController.grip || 0;
    input.buttonA = rightController.buttonA || false;
    input.buttonB = rightController.buttonB || false;
      input.buttonGrip = rightController.buttonGrip || false;
  }

  return input;
}

// Export API
export async function initXR() {
  return await checkXRSupport();
}

export async function toggleXRSession(renderer, animationCallback) {
  debugLog('toggleXRSession called, currently enabled: ' + xrEnabled);
  if (xrEnabled) {
    debugLog('Ending XR session...');
    endXRSession();
    restoreNormalAnimationLoop();
    return false;
  } else {
    debugLog('Starting XR session...');
    return await requestXRSession(renderer, animationCallback);
  }
}

export function isXRSupported() {
  return xrSupported;
}

export function isXREnabled() {
  return xrEnabled;
}
