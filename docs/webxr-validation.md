# WebXR validation checklist

This checklist covers the current WebGL-based WebXR path. It is intended for
manual regression checks after changes to controller input, session lifecycle,
or deployment configuration.

## Preconditions

- Install dependencies with `npm install`.
- Run `npm run check` and resolve any failure before starting a session.
- Use `http://localhost:3000` for local checks, or an HTTPS deployment for a
  remote headset.
- Record the browser, headset, browser version, page origin, and test date.

## Desktop regression

- Open the game without a headset.
- Confirm that the game joins normally and that keyboard, mouse, and gamepad
  controls still work.
- Confirm that the VR Mode button is disabled when WebXR is unavailable.

## Session startup and head tracking

- On a supported headset, start VR Mode from the in-game button.
- Confirm that the scene enters immersive VR and that head movement changes the
  view without moving the tank.
- Confirm that the tank remains centered at the XR origin while the world moves
  relative to the player.

## Controller mapping

- Move either thumbstick forward and backward; the tank should move along its
  current heading, with the right stick preferred when both are active.
- Move either thumbstick left and right; the tank should rotate without
  changing its heading from head movement, with the right stick preferred.
- Press either trigger or either primary face button to fire.
- Press either secondary face button or either grip button to jump.
- Release every control and confirm that no stale input continues to act.

## XR Settings menu

- Press either controller thumbstick and confirm that Settings opens without
  ending the XR session.
- Confirm that `Exit VR` is the first selected row and `Close` is the last row.
- Navigate up and down with either thumbstick.
- Activate a setting with either trigger and either primary face button.
- Open Join, change Team and Tank with left/right, select `Apply & Rejoin`, and
  confirm that the server returns the requested model and assigned team.
- Open Help and confirm that all control rows are readable without overlap.
- Open Voice, cycle microphone inputs, toggle browser audio processing, and
  confirm permission/microphone states refresh after activation.
- Open Operator, cycle maps and shot limits, refresh server data, and confirm
  restart/apply actions affect the selected values. Confirm MOTD and desktop-only
  controls remain readable but cannot be activated.
- From each submenu, use grip or the secondary face button and confirm that
  focus returns to Settings rather than closing the entire menu.
- Close Settings with either grip, either secondary face button, or another
  thumbstick press.
- Confirm that movement, firing, and jumping remain neutral until all controls
  are released after closing.
- Reopen Settings, activate `Exit VR`, and confirm that the normal desktop
  render loop resumes.

## Session lifecycle

- Exit VR Mode using the in-game button and confirm that the normal render loop
  resumes.
- End the session from the headset or browser system UI and confirm that the
  normal desktop loop resumes without a page reload.
- Hide and restore the headset view, then confirm that controllers and movement
  continue to work after visibility returns.
- Enter and exit VR Mode a second time and confirm that no duplicate input or
  animation callbacks are active.

## Deployment checks

- Confirm that a remote deployment uses HTTPS.
- Confirm that the WebSocket connection uses `wss://` when the page uses HTTPS.
- If a `Permissions-Policy` header is configured, confirm that
  `xr-spatial-tracking=(self)` is allowed.
- Confirm that a browser without WebXR fails gracefully and leaves desktop play
  available.

## Result

Record each check as pass, fail, or not applicable. Include the failing step,
browser and headset details, page origin, and any relevant debug output so the
result can be reproduced.

## Deferred TODO: Hand Controls

These are deferred options to revisit later. Do not change current physical
controller mappings unless cross-device compatibility requires it.

- Keep current controller bindings as primary where gamepad axes/buttons are
  available.
- Add visible hand/controller rendering with fallback order:
  hand model -> controller model -> ray/pointer only.
- Implement optional hand-driven actions when `inputSource.hand` is available:
  pinch-to-fire, grab-or-double-pinch jump, and a reliable exit/settings
  gesture.
- For locomotion with hands only, prototype a non-dominant pinch-and-drag
  virtual stick and compare to wrist-twist turn alternatives.
- Require a guaranteed escape path that does not depend solely on gesture
  recognition when controller buttons are present.
- Validate portability across Quest and other WebXR runtimes before changing
  defaults.
