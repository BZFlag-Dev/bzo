# AGENTS.md

Canonical instructions and project memory for AI coding agents working in this
repository. `CLAUDE.md` and `.github/copilot-instructions.md` both point here, so
Claude Code, GitHub Copilot, and any other agent read the same file.

## Reference: upstream BZFlag

The upstream BZFlag C++ source is checked out at `$HOME/bzflag/`. **Consult it
before designing or fixing gameplay logic.** bzo mirrors BZFlag except where the
web, mobile, or XR platform makes the upstream approach nonsensical (input
methods, rendering stack, network transport, UI shell).

Useful subtrees: `src/obstacle/` (obstacle geometry and collision),
`src/game/Intersect.cxx` (rect/circle primitives), `src/bzfs/` (server),
`src/bzflag/` (client), `include/`.

Prefer upstream naming too -- see `docs/tank-model-format.md` for tank part names.

### Intentional deviations from BZFlag

These are deliberate. Do not "fix" them without being asked.

- **Clients rejoin without waiting for a click.** BZFlag makes the player
  confirm before respawning; bzo respawns automatically after the same 5 second
  delay.
- **Clients reconnect directly when the server restarts**, rather than dropping
  to a menu.

- **bzo does not mirror BZFlag's client display options.** Upstream exposes
  `useFancyEffects`, `spawnEffect`, `shotEffect`, `deathEffect`, `landEffect`,
  `ricoEffect`, `tpEffect` and friends as ReadWrite BZDB, largely so the game
  degrades on old hardware. bzo needs hardware-accelerated WebGL to run at all,
  so that tradeoff does not apply. **Implement upstream's default variant and
  no setting.** Add a toggle only when a measured frame-rate impact justifies
  it, not for parity with the upstream options list.
- **Tanks are selectable OBJ models, not one compiled-in model.** BZFlag ships a
  single tank in `src/geometry/models/tank/` at three LODs, varied only by the
  `animatedTreads` and `treadStyle` settings. bzo loads several models from
  `public/obj/` and lets the player choose; `docs/tank-model-format.md` defines
  the part-naming contract, which keeps upstream's `body`/`turret`/`barrel`/
  `ltread`/`rtread` names. The death explosion throws the tank's own parts, so
  it differs from upstream's as a consequence. Accepted for now -- do not report
  the model set or the explosion as parity gaps.

- **The radar range is not saved between sessions.** BZFlag persists
  `displayRadarRange` with the rest of BZDB. bzo starts every session at
  upstream's `0.5` default (Medium) instead, because a headset has no key,
  scroll wheel, or on-screen control to zoom the radar with -- a level left
  behind by a desktop session would strand a headset player at a range they
  cannot change.
- **The one-tap VR button on the HUD is hidden on phones.** Chrome on Android
  reports `immersive-vr` support on any phone, through Cardboard, so support
  alone does not mean a headset is present. The Settings menu still offers VR
  Mode there.

The first two exist so a test session can be driven from the server alone. Re-testing
otherwise means walking to every browser, phone, and headset and clicking. They
may change once that stops being the dominant cost.

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
- **Version control is for history; source comments and documentation are not.**
  Describe what the code does now, never what it used to do. Do not write "this
  used to be X", "renamed from Y", "previously Z", or contrast the current
  behavior with an older version -- `git log` and `CHANGELOG.md` already hold
  that, and a note about code that no longer exists is noise a reader has to
  disprove. The same applies to commented-out code: delete it.
- **Preserve the AGPL license header** that already appears at the top of major
  source files when creating or modifying files.

## Repo Snapshot

Real-time BZFlag-inspired tank arena: a Node/Express/`ws` server in `server.js`,
and a browser Three.js client under `public/`.

All front-end modules are plain ES modules loaded directly by the browser. There
is **no bundler**. When adding an external module, update the
`<script type="importmap">` block in `public/index.html`.

**Serve every dependency from this origin.** Nothing in `public/` may reference a
third-party host: an installed PWA on a headset, or a phone on a LAN game server
with no internet route, must still load. Three.js is mounted from the installed
`node_modules/three` at `/vendor/three/`, so `package.json` is the only place its
version appears.

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
| `public/sw.js` | Service worker: install support and asset caching |
| `public/icons/` | Installed-app icons; see `docs/icons.md` |
| `public/*.mjs` | Client-side copies of logic shared with the server |
| `scripts/*.mjs` | Release tooling, doc checks, tests, OBJ generators |
| `maps/*.bzw` | Map files |
| `docs/` | Design plans and manual validation checklists |

### Shared client/server modules

Because the client is unbundled ESM and the server is CommonJS, logic needed on
both sides is kept as a **hand-maintained pair**: `public/<name>.mjs` and
`server/<name>.cjs`. Current pairs are `shot-limits`, `player-teams`, `collision-geometry`,
`tank-motion` and `headset-ua`. `npm run check:shared-pairs` enforces them: the two mirrored
pairs must match line for line, and any name a hand-written pair exports on
both sides must agree in type and arity. A pair that drifts does not throw --
the client and server just quietly disagree about geometry, which surfaces as
position corrections.

**Any such pair must have a parity test** in `scripts/` that loads both copies
and asserts they agree across a shared input table. See
`scripts/test-shot-limits.mjs` and `scripts/test-player-teams.mjs`. Without one,
the copies drift silently — `player-teams` did exactly that, with the client
skipping the `trim()` the server performed.

### Collision geometry follows BZFlag

Obstacle geometry lives in the `collision-geometry` pair and mirrors upstream
BZFlag (`src/obstacle/`, `src/game/Intersect.cxx`). The client resolves moves and
the server rejects them -- different jobs -- but both must agree about which
volume is solid, because every disagreement is either an honest player wrongly
rejected or a cheater wrongly allowed. Both sides agree by agreeing with the
same reference implementation.

`scripts/test-collision-geometry.mjs` fuzzes the two copies against each other.

**The server must be strictly more permissive than the client.** Move packets
quantize position with `toFixed(2)`, so a transmitted position can sit ~0.007
further into an obstacle than where the client actually stood -- far more than
the ~0.001 margin the client keeps while sliding along a surface. The server
therefore tests a slightly smaller radius (`antiCheat.collisionSlack`, default
`0.05`). Without it the server rejects most frames of a slide and the player
rubber-bands down every slope. Slack may only ever remove collisions, never add
them; do not apply it to heights or to the teleporter portal interior.

bzo is BZFlag's world relabeled for Three.js: `bzo(x, y, z) = bzf(x, z, -y)`.
That is a proper rotation, not a mirror. Because the ordered pair `(x, z)` seen
from `+Y` has the opposite orientation to `(x, y)` seen from `+Z`, a Three.js
rotation about `+Y` is a negative 2D rotation in `(x, z)`; that is why
`getColliderLocalPoint` uses `+rotation` where upstream uses `-angle`. It matches
how `render.js` draws obstacles (`mesh.rotation.y = obs.rotation`).

### Known duplication (do not add more)

`server.js` and `public/client.js` still each carry their own copy of:
`checkCollision`, `getCollisionColliders`, `getWorldBorderColliders`,
`getBoxCollisionDistanceSquared`, `normalizeAngle`, `rotateXZ`,
`getSegmentBoxEntryTime`, `getShotTeleporterDims`, `getShotTeleporterCrossing`,
`transformShotThroughTeleporter`, `traceShotThroughTeleporters`. Several have
already drifted. When touching any of them, change both sides in the same edit;
the fix is to move each into the `collision-geometry` pair, matching upstream
BZFlag, with fuzz coverage -- as the pyramid path already has.

## Visual effects

Effects mirror BZFlag's, taking geometry and timing from upstream rather than
approximating the look. Read the relevant `draw()` before building one: several
of these are not what their names suggest. The muzzle flash is a flared cone out
of the barrel, not a billboard; the shot teleport effect is a spinning collar
that rides along with the shot for four seconds, not a flash at the portal.

| bzo | upstream | source |
|---|---|---|
| muzzle flash | `StdShotEffect` | `effectsRenderer.cxx:897` |
| shot teleport collar | `StdShotTeleportEffect` | `effectsRenderer.cxx:1665` |
| jump jets | `TankSceneNode::renderJumpJets` | `TankSceneNode.cxx:1438` |
| spawn grow-in | `Player::spawnEffect` | `Player.cxx:1056` |
| landing squish | `Player::setLandingSpeed` | `Player.cxx:1015` |

Textures come from `$HOME/bzflag/data/` into `public/textures/`, and belong in
the map-entry preload list in `public/client.js`. Effect timings are hardcoded
constants upstream, so keep them as constants here, each annotated with the
upstream line it came from.

## Shot timing

BZFlag derives shot timing from `_reloadTime`, which itself defaults to
`_shotRange / _shotSpeed`:

- `ShotPath.cxx:48` — a shot's lifetime is `_reloadTime`
- `LocalPlayer.cxx:1311` — a slot reloads after `_reloadTime / numShots`

So firing continuously sustains exactly `maxShots` shots in flight. bzo derives
`SHOT_RELOAD_TIME` the same way, after the `server.json` overrides are applied,
so changing `shotMaxActive`, `shotSpeed`, or `shotDistance` keeps the relation
intact. With the defaults and five slots that is 700ms.

### The server does not enforce a reload timer

Fire rate is limited by shot slots alone. `bzfs.cxx` `shotFired()` has no
elapsed-time check at all, and `GameKeeper.cxx` `addShot()` refuses a shot only
when that shot's own slot is still live. Each slot expires a full shot lifetime
after it was filled, so two consecutive shots never share a timer.

**Do not add a global cooldown back.** A reload timer compares shots that are
one reload apart, which is the interval network jitter actually lands in: the
client starts its window when it sends and the server started its window when it
received, so any dip in latency between two shots makes an honest one look
early. Slot expiry compares shots a full lifetime apart, where jitter is noise.
The sustained rate is identical either way -- `maxShots` slots each held for one
shot lifetime is one shot per `SHOT_RELOAD_TIME`.

### Open question: shot position tolerance

bzo allows a shot origin `barrelLength + SHOT_POSITION_TOLERANCE` (~5 units)
from the extrapolated tank position. bzfs allows
`tankSpeed * _velocityAd + 2 * _muzzleFront` -- tens of units -- deliberately
absorbing a frame of tank motion and flag effects. bzo is much stricter than
upstream here. Rejections now log as `[ANTICHEAT:...] SHOT REJECTED`; if honest
shots are being refused on position during testing, widen the tolerance toward
upstream's rather than assuming a client bug.

`shotReloadTime` in `server.json` pins the value and disables the derivation.
Leave it unset unless an operator deliberately wants a non-BZFlag fire rate --
in particular do not add it to `example-server.json`, which is copied to
`server.json` on first start.

## Audio

Gameplay samples live in `public/audio/` and come from upstream BZFlag
(`$HOME/bzflag/data/*.wav`), so bzo sounds like the game it mirrors. The
manifest in `public/audio.js` maps each logical name to its file, its BZFlag
`SFX_*` code, and its distance/volume; `render.js` plays everything through
`playSound()` / `playLocalSound()` rather than bespoke per-sound methods.

All samples are preloaded by `preloadGameplayAudio()` during map entry. **Both
halves of the game ship from this repo, so the files are always present. Do not
add fallbacks for missing audio** -- a failed load is a broken build and should
surface as an error, not a silent degradation.

| bzo name | file | BZFlag SFX | event |
|---|---|---|---|
| `fire` | `fire.wav` | `SFX_FIRE` | a shot is fired |
| `shotBoom` | `boom.wav` | `SFX_SHOT_BOOM` | a shot expires or hits an obstacle |
| `explosion` | `explosion.wav` | `SFX_EXPLOSION`, `SFX_DIE` | a tank is destroyed |
| `jump` | `jump.wav` | `SFX_JUMP` | a tank jumps |
| `land` | `land.wav` | `SFX_LAND` | a tank lands |
| `teleport` | `teleport.wav` | `SFX_TELEPORT` | a tank passes through a teleporter |
| `pop` | `pop.wav` | `SFX_POP` | a tank appears (spawn) |

**Levels mirror BZFlag exactly, and there is no per-sound volume.** BZFlag scales
every sample only by distance and one global setting; the samples are pre-mixed
relative to each other, so adding per-sound gain undoes that balance. Its
attenuation, from `getWorldStuff()` in `src/bzflag/sound.cxx`, is
`amplitude = d < 86.4 ? 1 : 86.4 / d`, where `86.4` is 20 BZFlag tank radii
(`20 * 4.32`). That is the Web Audio `inverse` distance model with
`refDistance = 86.4` and `rolloffFactor = 1`, which reproduces the curve exactly.
The constant scales with the world, not the vehicle, so it stays `4.32` even
though a bzo tank has radius 2. Tune `MASTER_VOLUME` in `public/audio.js`, not
individual sounds.

Every remaining BZFlag sound is gated on a feature bzo does not have yet:
`ricochet` and `bounce` need bouncing shots, `flag_*`/`teamgrab`/`thief` need
flags, and `laser`/`shock`/`missile`/`burrow`/`phantom`/`steamroller`/`lock`
need superflags. When adding one of those features, take its sound from upstream
at the same time. The BZFlag sound codes are in `src/bzflag/sound.h`, resolved
through the `soundFiles[]` table in `src/bzflag/sound.cxx`.

## WebXR

- **An immersive session shows no DOM.** Anything the player must read or answer
  while in XR belongs on the `XRMenuRenderer` canvas panel, not in a dialog. The
  Player Options screen doubles as the entry dialog: before the player joins it
  is titled Join Game and carries name, team, and tank.
- **The launch grant has not been observed.** Meta documents an app-icon launch
  as counting for the user activation `requestSession` demands, but a Quest 2
  installed from the browser reports `navigator.userActivation` as
  `false/false` half a second into the launch and refuses the request.
  `public/xr-launch.js` runs ahead of `client.js`, on a module graph small
  enough to execute before three finishes loading, asks immediately, and then
  again on window load, focus, page show, visibility change, and the Launch
  Handler; `startXRSession` adopts whichever session results. Read
  `server.log` for the `Launch session:` line, which names the signal and the
  activation state at the time. Do not move that request into the client's own
  startup, and do not remove the first-click fallback until a launch is seen to
  grant one.
- **Text entry is the headset's system keyboard.** Focusing a DOM text field
  during a session raises it where the runtime offers one (`isSystemKeyboardSupported`,
  Quest Browser 26.1+). `#xrTextInput` exists to receive that focus, because a
  field inside a hidden dialog cannot take it and an off-screen field makes the
  page scroll. The keyboard sends no key events -- only the field's value is
  readable -- and each showing starts a new edit, so the first key replaces the
  whole value. Do not build an in-panel keyboard for a case the runtime covers.
- **Controller input is neutralized whenever `visibilityState` is not
  `visible`.** The system keyboard and the headset's own menus both report
  `visible-blurred`, and a stick left at full deflection behind either would
  drive the tank blind.

## Dev Workflow

- Install dependencies once with `npm install`.
- `npm run dev` starts `server.js` via nodemon, wrapped in a loop that brings it
  back if it exits; `npm start` runs it once, without auto-restart. Ctrl-C stops
  the loop.
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
| `npm run test:collision-geometry` | Obstacle geometry, fuzzed for client/server parity |

CI runs the same checks on pushes and pull requests, and additionally runs
`npm audit --omit=dev --audit-level=high` and a Node 18.19.1 / 24.19.0
compatibility matrix.

There is no automated browser or gameplay test. Manual play sessions remain the
regression check for rendering, prediction, and XR. Use
`docs/webxr-validation.md` for XR changes.

## Committing

**Do not `git commit` or `git push` unless explicitly asked.** Make the changes,
run `npm run check`, and stop, leaving the working tree for the user to review
and play-test. Say plainly that the work is uncommitted.

The one standing exception is an explicit release request, below -- that is
itself an instruction to commit, tag, and push.

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

**Do not wait for that workflow to finish.** Pushing the tag completes the
release task; the workflow result arrives by email. Stop at a concise
confirmation once the tag is pushed.

- Release tags are stable `vX.Y.Z` SemVer only. Prereleases and build metadata
  are not published.
- `public/version.mjs` is written by `scripts/prepare-release.mjs` and verified
  against the tag by `scripts/check-release.mjs`. Do not edit it by hand, and do
  not reintroduce a hardcoded client version string elsewhere.

## Environment Preference

For git push/tag operations in this environment, always run with
`SSH_AUTH_SOCK="$HOME/.ssh/ssh_auth_sock"` (or export it first) so SSH
authentication succeeds.

## Debugging Tips

- **Client-side logging to server**: send debug messages from the client with
  `ws.send(JSON.stringify({ type: 'debug', message: 'your debug info' }))` and
  they appear in `server.log`. This is especially useful on headsets like Quest 2
  where browser console access is limited.
- **Do not `grep`, `tail`, or `cat` `server.log` for its contents.** It is always
  open in the editor as an addressable buffer, so read it with `read_file` and an
  offset. Repeatedly grepping it wastes tokens re-reading text that can be
  addressed directly. Cheap metadata commands are fine -- `wc -l` to watch it
  grow is useful.
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
