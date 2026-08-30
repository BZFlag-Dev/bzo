# AGENTS.md

Canonical instructions and project memory for AI coding agents working in this
repository. `CLAUDE.md` and `.github/copilot-instructions.md` both point here, so
Claude Code, GitHub Copilot, and any other agent read the same file.

## Memory Policy

- When the user asks to remember something, record it in this file so other
  sessions, other agents, and other contributors remember it too.
- Keep the corrected facts here accurate. A stale instruction is worse than a
  missing one, because agents act on it without checking.

## Coding Conventions

- **Always prefer code reuse over duplication.** When implementing new features
  or refactoring, extract and reuse shared logic instead of copying code.
- **Always remove trailing whitespace from edits.** No line ends with a space or
  tab.
- **Do not put style information in `public/index.html`.** Presentation rules
  belong in `public/styles.css`. No inline `style` attributes, no `<style>`
  blocks. To show/hide an element, toggle a class rather than writing
  `element.style.display` from JavaScript.
- **Client/server protocol is lockstep in this repo.** Do not add defensive
  fallbacks or default values for packet fields that the shipped `client.js` +
  `server.js` protocol guarantees. Prefer explicit failure or direct field use
  over silent fallback behavior.
- **Preserve the AGPL license header** that already appears at the top of major
  source files when creating or modifying files.

## Repo Snapshot

Real-time BZFlag-inspired tank arena: a Node/Express/`ws` server in `server.js`,
and a browser Three.js client under `public/`.

All front-end modules are plain ES modules loaded directly by the browser. There
is **no bundler**. When adding an external module, update the
`<script type="importmap">` block in `public/index.html`; keep the Three.js
version there in sync with `package.json` (both are currently `0.185.1`).

### Layout

| Path | Role |
|---|---|
| `server.js` | Express + WebSocket server, game loop, collision/shot validation, BZW parsing |
| `server/*.cjs` | Server-side copies of logic shared with the client |
| `public/client.js` | Scene setup, WebSocket handling, HUD orchestration, local prediction, XR menu screens |
| `public/render.js` | `RenderManager` class: Three.js scene, tanks, obstacles, teleporters, explosions, camera |
| `public/input.js` | All input ownership and routing; `setupInputHandlers`, `virtualInput`, `keys` |
| `public/hud.js` | HUD drawing helpers (scoreboard, altimeter, degree bar, shot status, debug) |
| `public/menus.js` | Shared dialog lifecycle, focus, and keyboard/controller navigation |
| `public/settings-menu.js` | Declarative Settings rows + DOM renderer |
| `public/xr-menu.js` | `XRMenuRenderer`: CanvasTexture menu panel for immersive XR |
| `public/webxr.js` | XR session lifecycle and controller input |
| `public/voice.js` | WebRTC nearby-voice manager |
| `public/audio.js` | Procedurally generated audio buffers |
| `public/*.mjs` | Client-side copies of logic shared with the server |
| `scripts/*.mjs` | Release tooling, doc checks, tests, OBJ generators |
| `maps/*.bzw` | Map files |
| `docs/` | Design plans and manual validation checklists |

### Shared client/server modules

Because the client is unbundled ESM and the server is CommonJS, logic needed on
both sides is kept as a **hand-maintained pair**: `public/<name>.mjs` and
`server/<name>.cjs`. Current pairs are `shot-limits` and `player-teams`.

**Any such pair must have a parity test** in `scripts/` that loads both copies
and asserts they agree across a shared input table. See
`scripts/test-shot-limits.mjs` and `scripts/test-player-teams.mjs`. Without one,
the copies drift silently — `player-teams` did exactly that, with the client
skipping the `trim()` the server performed.

### Known duplication (do not add more)

`server.js` and `public/client.js` each carry their own copy of the collision and
teleporter math: `checkCollision`, `getCollisionColliders`,
`getWorldBorderColliders`, `getColliderLocalPoint`,
`getBoxCollisionDistanceSquared`, `normalizeAngle`, `rotateXZ`,
`getSegmentBoxEntryTime`, `getShotTeleporterDims`, `getShotTeleporterCrossing`,
`transformShotThroughTeleporter`, `traceShotThroughTeleporters`. Several have
already drifted. When touching any of them, change both sides in the same edit
and note the divergence; the long-term fix is to extract a
`public/collision.mjs` + `server/collision.cjs` pair with a parity test.

## Dev Workflow

- Install dependencies once with `npm install`.
- `npm run dev` starts `server.js` via nodemon; `npm start` runs it without
  auto-restart.
- The server watches `public/` and `server.js`, forcing connected clients to
  reload on any `public/` change and restarting itself when `server.js` changes.
- Because `npm run dev` is used, edits to watched files usually restart or reload
  the running server automatically. **Do not start duplicate dev servers** unless
  explicitly asked.
- The development server is typically already running in GNU Screen session `0`.
- Gameplay logs stream to `server.log`, which is cleared on each server boot.

## Checks and Tests

Run before proposing a change as done:

```bash
npm run check
```

That runs, in order:

| Command | What it covers |
|---|---|
| `npm run check:server` | `node --check server.js` |
| `npm run lint` | ESLint across server, `public/`, and `scripts/` |
| `npm run check:controls-docs` | README controls section matches the in-game help panel |
| `npm run test:input-context` | `InputContextManager` ownership rules |
| `npm run test:player-teams` | Team normalization, plus client/server parity |
| `npm run test:team-mode` | Server team-mode config and BZW `options` parsing |
| `npm run test:shot-limits` | Shot slot limits, plus client/server parity |

CI runs the same checks on pushes and pull requests, and additionally runs
`npm audit --omit=dev --audit-level=high` and a Node 18.19.1 / 24.19.0
compatibility matrix.

There is no automated browser or gameplay test. Manual play sessions remain the
regression check for rendering, prediction, and XR. Use
`docs/webxr-validation.md` for XR changes.

## Release Process

Full steps also live in the README. When the user says "release now" or "do/make
a release", execute this end to end unless they explicitly ask for a dry run,
prepare-only, or no-commit. After completing it, stop at a concise confirmation
of outcomes; do not append optional follow-up suggestions.

```bash
npm run release:prepare -- 1.0.37
```

That updates `package.json`, `package-lock.json`, `public/version.mjs`, and opens
a new `CHANGELOG.md` section from `[Unreleased]`.

Then edit the new changelog section so it contains the real user-visible changes,
and validate:

```bash
npm run check
npm run release:check -- v1.0.37
npm run release:check:increment -- v1.0.37
```

Then commit, tag, and push:

```bash
git add package.json package-lock.json public/version.mjs CHANGELOG.md
git commit -m "Release v1.0.37"
git tag v1.0.37
git push
git push origin v1.0.37
```

`.github/workflows/release.yml` then gates on: tag commit is on `main` →
`npm run check` → `npm audit` → release metadata → tag increment → CodeQL →
Node 18/24 compatibility → multi-arch Docker build and smoke test → GHCR tag
promotion → GitHub release with notes extracted from `CHANGELOG.md`.

- Release tags are stable `vX.Y.Z` SemVer only. Prereleases and build metadata
  are not published.
- `public/version.mjs` is written by `scripts/prepare-release.mjs` and verified
  against the tag by `scripts/check-release.mjs`. Do not edit it by hand, and do
  not reintroduce a hardcoded client version string elsewhere.

## Environment Preference

For git push/tag operations in this environment, always run with
`SSH_AUTH_SOCK=/home/timr/.ssh/ssh_auth_sock` (or export it first) so SSH
authentication succeeds.

## Debugging Tips

- **Client-side logging to server**: send debug messages from the client with
  `ws.send(JSON.stringify({ type: 'debug', message: 'your debug info' }))` and
  they appear in `server.log`. This is especially useful on headsets like Quest 2
  where browser console access is limited.
- **NEVER use `tail`, `grep`, or other terminal commands on `server.log`.** It is
  always open in the editor; read it with `read_file` instead.
- `server.log` is the primary runtime output surface during development. Assume
  it is already open and read it directly whenever runtime diagnostics are
  needed. Do not ask the user to re-open it.

## Server Architecture (`server.js`)

- A single Express app serves static assets and hosts a `ws` WebSocket server
  that drives gameplay.
- The game loop (`setInterval(gameLoop, 16)`) updates projectile travel and
  collision checks. The server only *verifies* player `move` messages and never
  originates `playerMoved` messages itself; movement updates are broadcast only
  in response to client `move` messages.
- Player lifecycle: connection emits `init`, `newPlayer`, and `playerJoined`;
  `joinGame`, `move`, `shoot`, `pause`, and `chat` are validated server-side
  before broadcasting.
- Movement and shot validation rely on `GAME_CONFIG` thresholds and obstacle
  collision helpers. Keep new mechanics in sync with these checks.
- Map loading reads `server.json` to choose between procedural obstacles and
  `.bzw` files parsed by `parseBZWMap`. Add maps to `maps/` and update the config
  or use the operator panel to switch.
- Admin/operator overlay messages share the WebSocket channel; reuse that pattern
  for additional operator tools.
- `forceClientReload()` broadcasts a `reload` message and closes sockets. It is
  exposed globally and triggered on `SIGUSR1` or watched file changes.

## Client Architecture (`public/`)

- `client.js` owns scene setup, Three.js assets, WebSocket handling, HUD
  orchestration, and per-frame prediction. Any protocol change must be reflected
  in its `handleServerMessage` switch.
- Input is centralized in `input.js`, which exports `setupInputHandlers`,
  `virtualInput`, and `keys` for desktop, mobile, gamepad, and XR controls.
- HUD helpers live in `hud.js`; extend those utilities rather than duplicating UI
  logic in `client.js`.
- Audio buffers are generated procedurally in `audio.js` for shooting,
  explosions, jumping, and landing.
- `styles.css` and `index.html` define HUD layout, mobile overlays, and the
  import map.
- The client connects back to the host that served it (`ws://<host>`, or
  `wss://` when the page is HTTPS). Never hardcode URLs, so the same build runs
  locally and in production.

## Configuration & Data

- Runtime settings (name, MOTD, default map, team mode, voice ICE servers) live
  in `server.json`; `example-server.json` documents the expected shape.
- `SERVER_CONFIG_PATH` overrides the config path; `MAPS_PATH` overrides the
  writable runtime maps directory.
- Obstacles are generated and resolved server-side and sent in the `init`
  payload. The client recreates meshes from that data, so keep the schema stable
  when extending obstacle properties.
- **Map scale**: `maps/*.bzw` use standard BZFlag coordinates at 1:1 scale. Box
  `x`/`y` in BZW are half-extents, which the parser multiplies by 2 to get full
  width and depth. 1 bzo unit = 1 BZFlag unit.

## Conventions & Testing

- When adding network messages, document them in both the server switch
  statements and the client handlers, and update debug HUD counters if needed.
- The controls list currently exists in several places: the README "Controls"
  section, the help `<ul>` in `public/index.html`, `XR_HELP_ITEMS` in
  `public/client.js`, and the regex pairs in `scripts/check-controls-docs.mjs`.
  Only the first two are cross-checked. When changing a control, update all four.

## Persistent Project Decisions

- Operator controls are part of the single-page app and stay in-game. Do not
  reintroduce a separate `/admin` page for operator tools, because navigating
  away from the SPA drops active game state and the WebSocket connection.
- The old `/admin` server route was an abandoned experiment and has been removed.
  Keep future operator/admin UX inside the existing overlay/HUD flow unless the
  user asks for a different architecture.
- During development it is intentional that any connected player may use operator
  controls such as map switching. OAuth or stronger authorization may come later
  but is not a current priority.
- The client should ALWAYS send valid data.
- The server checks are ONLY in place to detect modified clients.
- With unmodified client code, the server should never have to correct client
  actions.
- Project distribution is public by default: source code (AGPL), Docker images,
  release downloads/artifacts, and install endpoints stay publicly accessible
  unless the user explicitly requests a temporary exception.
- Deferred XR hand-control options are tracked in `docs/webxr-validation.md`
  under `Deferred TODO: Hand Controls`. Do not change current physical controller
  mappings unless cross-device compatibility requires it.

---

# Player Join / Entry / Scoreboard Flow

1. **Player connects to server**
   - Server adds them to the player list, but they have not yet joined (not
     spawned).
   - Server includes them in the `init` message to all clients with `health = 0`
     and a placeholder position (`x: 0, y: 0, z: 0`).
   - Server broadcasts `playerJoined` with `health = 0` and position (0,0,0).

2. **Client receives `init` or `playerJoined` with `health = 0`**
   - Adds the player to the scoreboard.
   - Creates their tank in the world, but sets `tank.visible = false`.
   - Shows their name and stats in the scoreboard, but no tank in the 3D world.

3. **Player sends `joinGame` (with their name)**
   - Server updates their player object with name, position, and `health > 0`.
   - Server broadcasts a new `playerJoined` for that player with `health > 0` and
     their spawn position.

4. **Client receives `playerJoined` with `health > 0`**
   - Updates the tank: `tank.visible = true`, updates position, name, and stats.
   - Scoreboard is already correct, but update if needed.

5. **Player leaves before joining**
   - Server sends `playerLeft` to all clients.
   - Client removes them from the scoreboard and world.

| Event | Scoreboard | Tank in World | Tank Visible | Notes |
|---|---|---|---|---|
| Connect (not joined) | Yes | Yes | No | `health = 0` |
| JoinGame | Yes | Yes | Yes | `health > 0`, set position |
| Leave (not joined) | No | No | N/A | Remove from all |

Notes:

- All connected players are always visible in the scoreboard, even if not joined.
- Tanks for unjoined players exist in the scene but are invisible.
- No need to remove and re-add tanks or scoreboard entries — just update
  visibility and state.

**This flow is project memory and should be followed for all future
join/entry/scoreboard logic.**

---

# World Coordinate System

Standard Three.js coordinates for the game world (top-down view):

- **+X = East** (right), **-X = West** (left)
- **+Z = South** (toward camera), **-Z = North** (away from camera)
- **+Y = Up**

Rotation `r`, player facing direction:

- `r = 0` → **North** (-Z)
- `r = π/2` (1.57) → **West** (-X)
- `r = π` (3.14) → **South** (+Z)
- `r = 3π/2` (4.71) → **East** (+X)

Movement vectors:

- Moving north: Z becomes **more negative** (-10 to -20)
- Moving south: Z becomes **more positive** (-10 to -5, or 0 to 10)
- Moving east: X becomes **more positive**
- Moving west: X becomes **more negative**

Examples:

- Position (30, -30): 30 units east of origin, 30 units north
- Position (50, 10): 50 units east, 10 units south of origin
- Intended vector (0, -5): moving north
- Intended vector (0, 5): moving south

---

# Movement Direction Vector (`d`)

**Status: IMPLEMENTED.**

## Problem

When sliding along obstacles or boundaries, the player's actual movement
direction differs from their rotation, but no packet is sent because `fs` and
`rs` do not change. That gives the server a stale position (incorrect hit
detection) and makes other clients extrapolate in the wrong direction (ghosting
through obstacles). It is most noticeable when sliding along walls or jumping
diagonally into obstacles.

## Solution

An optional `d` (direction) field on `move` messages, sent when actual movement
direction differs from expected direction.

Send `d` when:

- `validateMove()` returns `altered: true` (a slide occurred), and
- the actual direction from `(newX - oldX, newZ - oldZ)` differs from the
  expected direction by more than `0.01` radians.

Expected direction is `r` (rotation) on the ground, or `jumpDirection` (the
frozen direction) in the air.

```javascript
// Normal movement (no slide):
{ type: 'move', x, y, z, r, fs, rs, vv }

// Sliding movement:
{ type: 'move', x, y, z, r, fs, rs, vv, d: actualDirection }
```

Server handling: if `d` is present, use it for extrapolation instead of `r`;
validate it is reasonable (perpendicular to the collision normal when near
obstacles); store as `player.slideDirection`; broadcast `d` in the `pm` message.

Client extrapolation:

```javascript
const moveDirection = player.slideDirection !== undefined
  ? player.slideDirection
  : (player.jumpDirection !== null ? player.jumpDirection : player.r);
const dx = -Math.sin(moveDirection) * fs * speed * dt;
const dz = -Math.cos(moveDirection) * fs * speed * dt;
```

---

# WebXR

See `docs/webxr-validation.md` for the manual validation checklist and
`docs/settings-dialog-plan.md` for the dialog/menu architecture and its current
status.

## Modules

`webxr.js` owns XR session and controller management:

- `initXR()` — detects support via `navigator.xr.isSessionSupported('immersive-vr')`
- `toggleXRSession(renderer, animationCallback)` — creates/ends the session
- `updateXRControllerInput()` — reads gamepad data from input sources each frame
- `getXRControllerInput()` — returns thumbstick/trigger/button state
- `xrState` — enabled flag, head pose, controller map

Integration points:

- **`render.js`** — renderer created with `xrCompatible: true` and
  `renderer.xr.enabled = true`; `getRenderer()` exposes it; `updateCamera()`
  handles XR first-person positioning.
- **`input.js`** — `updateVirtualInputFromXR()` maps controller input into
  `virtualInput`, gated by the active input context.
- **`client.js`** — calls `initXR()` on `DOMContentLoaded`,
  `updateXRControllerInput()` each frame before input handling, and drives the XR
  settings menu screens.

## Controller mapping

| Input | Effect |
|---|---|
| Either thumbstick up/down | Forward/backward movement (right stick preferred) |
| Either thumbstick left/right | Tank rotation (right stick preferred) |
| Either trigger or primary face button | Fire / activate menu row |
| Either grip or secondary face button | Jump / menu back |
| Press either thumbstick | Open or close XR Settings |

Tank rotation is independent of head direction. Three.js positions the camera for
stereo rendering and head tracking automatically.

## Future work

Phases 1 and 2 (head tracking, joystick input, trigger firing) are implemented.
Remaining, none of which are current priorities:

- Hand tracking. Tracked in detail under `Deferred TODO: Hand Controls` in
  `docs/webxr-validation.md`.
- Comfort settings and an optional snap-turning mode.
- Controller haptic feedback.
- Voice commands in XR.

## XR coordinate system mapping

**Problem:** in XR mode Three.js ignores manual camera positioning and uses the
XR reference frame, whose origin is the tracked head position. Game objects
positioned relative to the tank become unreachable.

**Solution:** a `worldGroup` (Three.js `Group`) contains all game content.

1. `renderManager.worldGroup` is a group in the scene holding all game objects.
2. Add tanks to `renderManager.getWorldGroup()` rather than to the scene.
3. `updateCamera()` checks `xrState.enabled`. In XR it translates `worldGroup` to
   `(-tankX, -tankY + eyeHeight, -tankZ)`, effectively placing the tank at the XR
   origin. Otherwise `worldGroup` stays at (0,0,0) and the camera moves normally.
4. Result: the same world appears the same from the player's perspective in both
   VR and desktop.
