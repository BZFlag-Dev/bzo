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

- Move the left thumbstick forward and backward; the tank should move along its
  current heading.
- Move the right thumbstick left and right; the tank should rotate without
  changing its heading from head movement.
- Press the right trigger or A button to fire.
- Press the B button or grip button to jump.
- Release every control and confirm that no stale input continues to act.

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
