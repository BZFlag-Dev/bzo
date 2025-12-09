// input.js
// Handles keyboard, mouse, and touch input for the game.
// Exports: setupInputHandlers, virtualInput, keys, lastVirtualJump

// Virtual input state (for mobile/touch)
export let virtualInput = { forward: 0, turn: 0, fire: false, jump: false };
export let lastVirtualJump = false;

// Keyboard input state
export const keys = {};

// Setup all input event listeners
export function setupInputHandlers() {
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

  // Keyboard
  document.addEventListener('keydown', (e) => {
    keys[e.code] = true;
  });
  document.addEventListener('keyup', (e) => {
    keys[e.code] = false;
  });
}
