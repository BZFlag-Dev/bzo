# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and versions use SemVer tags like v1.0.0.

## [Unreleased]

## [1.0.41] - 2026-08-31

### Added
- A headset browser launching the installed app asks for an immersive session ahead of the rest of the client, so an app launched from its own icon can open in VR with no 2D landing page.
- The XR menu asks for a name, team, and tank before an unjoined player joins, standing in for the entry dialog, which an immersive session cannot show.
- Name and MOTD can be typed in XR through the headset's system keyboard. Headsets without one mark those rows Desktop only.
- `[INSTALL]` log lines record the manifest and icon fetches that make up an install, with the browser that asked, since which icon a launcher takes is documented nowhere.

### Fixed
- Icons revalidate instead of being cached for a week, and the manifest points at a URL carrying each file's timestamp. A launcher keeps whichever icon it was shown at install time, so a stale one outlived every cache it came from.
- The Settings Install row reads Installed inside the installed app. It asked whether the display mode was `standalone`, which an app launched from a `display: fullscreen` manifest is not, so the app reported itself uninstallable.

### Changed
- Every icon is green. BZFlag's marks are red and its forums are blue, so the colour is what tells a bzo icon from a BZFlag one; the manifest and page theme colour follow it.
- Icon files are named for the manifest role they fill -- `any-`, `maskable-`, `tile-` -- with no product prefix, since nothing but icons lives in that directory.
- The Settings Install row reads Browser menu where the browser never offers the install event, rather than Unavailable. Safari, Firefox and the headset browsers all install from their own menus.
- Headset browsers are served their own app icons. A phone launcher crops a maskable icon and needs the art padded inside it; the Meta Quest app library letterboxes the same file and needs it padded not at all, which left the mark at half the tile inside a ring. The manifest, already generated per request, now branches on the user agent.
- Leaving VR closes the window when the app was launched from a headset icon, instead of dropping the player onto a flat window they have no use for.
- A headset launch keeps asking for its immersive session on each signal that could carry the activation it needs -- window load, focus, page show, visibility, and the Launch Handler -- rather than only once at load. If none of them lands, the first click in the window enters VR.
- The radar range starts at Medium every session and is no longer remembered. It matches BZFlag's `displayRadarRange` default, and a headset has no way to zoom the radar, so a level saved on a desktop no longer follows the player into VR.
- The one-tap VR button beside the settings gear is shown only on a device with a headset. Chrome on Android reports VR support on any phone through Cardboard, which put the button under the player's thumb during play; VR Mode is still in the Settings menu there.
- Controller input is dropped whenever the headset reports the session unfocused, rather than only when it is hidden, so a stick held while the system keyboard or the headset's own menu is up no longer drives the tank.

## [1.0.40] - 2026-08-31

### Added
- Installable as an app on mobile, desktop, and Meta Quest. The web app manifest is generated per request, so a server installs under the host it was reached at and two servers appear as separate apps.
- Added the BZFlag application icon at up to 1024x1024 for launchers and home screens, including maskable variants that survive Android's circular crop and an Apple touch icon. The simple tank mark stays the browser tab icon.
- Added a service worker. Images, audio, models, and Three.js load from disk; HTML and JavaScript revalidate on every start, so a cached client can never outlive the server it talks to.
- Added an Install App row to Settings, offered only when the browser reports the game is installable and not already installed.
- Added `maps/collision-test.bzw` and an optional `testSpawn` block in `server.json`, which place a named player at a fixed position for automated collision testing.
- Added `npm run check:shared-pairs`, which fails when a `public/*.mjs` and `server/*.cjs` pair drift apart. A drifted pair does not throw; the client and server just disagree about geometry.

### Changed
- Tanks collide as BZFlag's oriented 2.8 x 6.0 box rather than a 4-unit circle, so a tank is narrower across and longer front to back, and turning near a wall behaves as it does upstream. Every tank uses this box whatever model is selected, so the model stays cosmetic.
- Movement resolves the way BZFlag does: on contact the timestep is searched for the last moment the tank was clear, then the velocity component along the surface normal is cancelled and the rest of the step is spent sliding. This replaces expanding obstacles by the tank radius, which cannot work for a rotated box.
- Serve Three.js from the installed dependency instead of a CDN, so the game has no third-party origins and loads on a headset or a LAN with no route to the internet.
- Fire rate is limited by shot slots alone, matching bzfs, which has no elapsed-time check. The previous reload timer compared consecutive shots one reload apart, the interval network jitter lands in, and rejected honest shots.
- Rejected shots are logged as anti-cheat events and counted in the periodic summary, and shot logs use the `shotBegin` and `shotEnd` names the protocol already uses.
- `npm run dev` restarts the server if it exits, so a crash no longer leaves it stopped.
- Settings toggles show On in green and Off in red. Off was previously green, which read as backwards.

### Fixed
- A malformed WebSocket frame from any client crashed the whole server. Sockets had no error listener, so a protocol violation became an uncaught exception.
- Clicking the settings, VR, or player-name controls no longer fires the tank.
- Clicking outside a dialog closes it without firing, and the next click fires normally.
- Driving off the edge of an obstacle no longer strands the tank. Support and standing-on-top now use the same test, rather than a margin tuned for the old circular footprint.
- `public/favicon.ico` was a text file containing a data URI, so any client requesting the default icon path received garbage. It is now a real multi-size icon.
- Styles are revalidated rather than cached for a week, so a CSS change reaches players without a forced reload.
- The page title and iOS home-screen name identify the server rather than reading "Battlezone Online" on every host.

## [1.0.39] - 2026-08-30

### Added
- Added the BZFlag tank-appeared sound when a tank spawns, which had no sound before.
- Added BZFlag's spawn animation, growing a tank in from 1% to full size over 0.64 seconds.
- Added a muzzle flash when a shot is fired.
- Added BZFlag's jump jets: four flames under the tank that fire on a jump and fade as it rises, with a warm light while they burn.
- Added a spinning collar that rides along with a shot after it passes through a teleporter.

### Changed
- Matched BZFlag's reload timing: a shot slot now returns after the shot lifetime divided by the number of slots, 700ms with the shipped settings rather than a flat 1000ms. Set `shotReloadTime` in `server.json` to override.
- Replaced the procedurally generated shot, explosion, jump, and landing sounds with the BZFlag samples they were imitating.
- Moved gameplay audio into `public/audio/` and preloaded every sample on map entry.
- Matched BZFlag's sound attenuation, using inverse rolloff from a reference distance of 20 tank radii.
- Removed per-sound volume levels, so samples keep the relative balance they were mixed with, as in BZFlag. Landing volume no longer varies with impact speed.
- Logged every rejected shot as `[SHOT_REJECT]` with its reason. Observer, dead-player, and malformed-direction rejections previously failed silently, hiding exactly the cases where the client and server disagree.

## [1.0.38] - 2026-08-30

### Fixed
- Fixed players rubber-banding down pyramid slopes. The server rejected moves with no tolerance, but positions are sent rounded to 0.01, which is coarser than the margin the client keeps while sliding, so most frames of a slide were rejected and rolled back.
- Fixed tanks being held in mid-air by a distant inverted pyramid, and being unable to fall anywhere on the map afterwards.
- Fixed tanks freezing against steep pyramid faces, including in mid-air while falling, when no slide surface was reported.
- Fixed inverted pyramid collision on the server, which treated every inverted pyramid as upright and disagreed with the client about roughly a fifth of the space around it.
- Fixed tanks clipping into the edges of pyramids, where a tank whose centre sat outside the base footprint was not tested at all.

### Changed
- Added `antiCheat.collisionSlack` so the server validates movement slightly more permissively than the client, as the protocol's rounded positions require.
- Replaced both ad-hoc pyramid collision routines with shared geometry that mirrors BZFlag, so the client and server evaluate the same solid volume.

## [1.0.37] - 2026-08-30

### Added
- Added immersive XR Join, Help, Voice, and Operator screens linked from XR Settings.
- Added XR team/tank selection with authoritative rejoin, voice controls, and controller-accessible operator map and shot-limit actions.
- Added client/server parity checks for player team normalization so the two copies of the rules cannot drift apart.

### Changed
- Increased dialog and control text sizes across desktop, mobile, and XR, with scrolling XR menu rows to preserve readability.
- Disabled Anaglyph 3D while XR is active because the rendering modes are incompatible.
- Added Player Options as the first Settings destination and changed the player-name shortcut to open the main Settings menu.
- Moved agent instructions and project memory into a single `AGENTS.md` shared by all coding agents.

### Fixed
- Fixed the reported client version, which was pinned to an old release and is now derived from the release tooling.
- Fixed team names with surrounding whitespace being rejected by the client while the server accepted them.

## [1.0.36] - 2026-08-30

### Added
- Added shared dialog navigation and input ownership for keyboard, mouse, touch, gamepad, and XR controllers.
- Added a BZFlag-style Team selector with Automatic, Rogue, Observer, and enabled color teams.
- Added authoritative team-mode configuration through server JSON and BZW `-c`, `-offa`, `-autoTeam`, and six-team `-mp` options.
- Added an immersive XR Settings panel opened by either controller stick, with `Exit VR` as the first choice.
- Added focused input-context, player-team, team-mode, and shot-limit checks to the release validation suite.

### Changed
- Updated HiX to enable team play with ten slots each for Rogue, Red, Green, Blue, Purple, and Observer.
- Updated XR controls so either controller can navigate menus, activate actions, fire, and jump.
- Updated Settings, Help, Voice, Operator, and Entry dialogs to use a consistent responsive presentation and shared navigation behavior.
- Updated player and voice state terminology from role/spectator to team/observer.

### Fixed
- Fixed dialog input leaking into gameplay and stale controls continuing after input-context changes.
- Fixed the Entry Team selector being skipped by Tab after reopening the join dialog.
- Fixed automatic team assignment, per-team capacity enforcement, and BZFlag-compatible balancing behavior.
- Fixed team colors not propagating to reused tank and ghost meshes after joining or changing teams.
- Fixed team mode temporarily assigning random tank colors before join confirmation; random pastel colors are now limited to non-team-mode Rogues.

## [1.0.35] - 2026-08-29

### Added
- Added camera-attached WebXR HUD overlays for the radar, chat tabs, scoreboard, and shot cooldown indicators.
- Added an empty test world for focused rendering and WebXR diagnostics.

### Changed
- Updated WebXR session state handling to publish consistent lifecycle snapshots to subscribers.
- Aligned WebXR HUD overlays on a shared camera plane with headset-oriented sizing and placement.

### Fixed
- Fixed projectile heads, trails, and impact effects rendering behind the ground debug grid.
- Fixed WebXR HUD visibility by rendering overlays through the camera-attached XR path.

## [1.0.34] - 2026-08-28

### Changed
- Updated projected ground shadows to use a BZFlag-style stencil path so overlapping casters do not over-darken by object count.
- Updated ground debug grid visibility to follow the existing debug-geometry toggle.

### Fixed
- Fixed horizon and movement-related shadow flashing by preserving last valid projected shadow meshes and hardening stencil/decal layering.
- Fixed shadow occlusion so obstacle geometry correctly blocks ground shadow darkening.
- Fixed ground/grid/shadow draw ordering so debug grid rendering can be layered beneath shadow darkening when enabled.
- Follow-up on closed issue #22 for ground/shadow visual stability.

## [1.0.33] - 2026-08-28

### Added
- Added explicit BZFlag-style player teleport packets (`tp`/`pt`) so teleports are replicated as authoritative events instead of being inferred from movement.
- Added the shipped BZFlag teleport sound asset at [public/teleport.wav](public/teleport.wav) and preload/caching for required gameplay audio during map initialization.

### Changed
- Updated player teleports to validate from the client's predicted source-side state and preserve turn, jump direction, vertical velocity, and airborne horizontal velocity through teleport exits.
- Updated server debug packet logging to use a consistent `[DEBUG] Player "name": ...` format.

### Fixed
- Fixed teleporter frame/interior collision handling so tanks pass through active portals instead of sliding on them.
- Fixed blocked or out-of-bounds teleporter exits by rejecting invalid destinations instead of placing players outside the map.
- Fixed jump-through-teleporter kinematics so falling/rising state, turning, and post-teleport extrapolation stay aligned without false anticheat spikes.
- Fixed projectile teleport ping-pong on stacked upper/lower teleporters by extending shot re-entry blocking to cover the portal breadth after exit.

## [1.0.32] - 2026-08-28

### Added
- Added BZFlag-style tabbed chat panel with `All`, `Chat`, `Server`, `Misc`, and `Debug` tabs plus per-tab scrollback and unread indicators.
- Added chat navigation and compose shortcuts: direct tab select (`1`-`5`), tab cycling (`[`/`]`), reply to last direct sender (`.`), and message-nemesis targeting (`,`).

### Changed
- Aligned chat packet naming/content toward BZFlag semantics by replacing `chat` packets with `message` packets carrying `src`, `dst`, `msgType`, and `text`.
- Updated chat rendering to distinguish message categories and direct-message direction in the panel (`[->name]` outbound and `[name->]` inbound) similar to BZFlag formatting.
- Updated radar zoom hotkeys to use `+`/`-` (and numpad equivalents), freeing `[`/`]` for chat tab cycling.

### Fixed
- Fixed private-message delivery and sender-name display by handling player IDs as string identifiers in both client and server message routing.
- Fixed message misclassification where normal chat could appear as `[SERVER]` when legacy/alternate message fields were received.
- Fixed chat panel click propagation so selecting chat tabs no longer triggers firing.
- Fixed cross-monitor chat text clipping and improved desktop layout so chat shrinks away from the debug HUD when there is sufficient horizontal space.

## [1.0.31] - 2026-08-27

### Added
- Added a unified radar world-to-panel transform path so obstacle, projectile, and tank rendering now share one conversion pipeline.

### Changed
- Simplified radar math by centralizing world-relative rotation and panel scaling into shared helpers used by all radar entities.

### Fixed
- Fixed radar obstacle orientation regression for large rotated walls (for example `ne_xwall`) introduced by the polygon clipping rewrite.

## [1.0.30] - 2026-08-27

### Added
- Added authoritative shot lifecycle diagnostics in `server.log` with `[SHOT_START]`, `[SHOT_TP]`, and `[SHOT_END]` entries to trace teleporter traversal and termination causes.

### Changed
- Updated shot lifecycle packet names to BZFlag-style semantics: `shotBegin` and `shotEnd` replace `projectileCreated` and `projectileRemoved`.
- Updated shot expiration to use lifetime-budget semantics (`shotRange / shotSpeed`) so teleport traversal does not incorrectly shorten lifetime based on straight-line displacement from spawn.
- Updated teleporter frame/crossing classification to use BZFlag-matching tolerance (`1e-6`) and harmonized server/client teleporter aperture math with rendered teleporter geometry.

### Fixed
- Fixed false shot-end explosions on valid teleporter traversals by separating teleporter frame-hit detection from generic obstacle collision checks and excluding teleporter solids from post-teleport projectile collision tests.
- Fixed immediate teleporter ping-pong loops by adding short re-entry blocking for the destination teleporter after teleport exit.
- Fixed radar obstacle clipping for large rotated structures (for example corner x-walls) by clipping obstacle polygons to the radar square instead of culling by coarse bounds.

## [1.0.29] - 2026-08-26

### Fixed
- Fixed Docker image missing the `server/` directory, causing a crash on startup with `Cannot find module './server/shot-limits.cjs'`.

## [1.0.28] - 2026-08-25

### Added
- Added radar zoom controls with keyboard bindings and a settings-panel preset toggle.

### Changed
- Updated the radar to a square-style panel layout with square-consistent world scaling.
- Updated radar culling for tanks, shots, and obstacles to use rectangular visibility rules that match the square display.
- Updated off-range tank indicators to sit closer to the panel edge while preserving stable edge projection.

### Fixed
- Fixed near-edge radar transitions so tanks remain rendered as arrows (including partial clipping) before switching to edge dots.

## [1.0.27] - 2026-08-25

### Added
- Added a Quest-friendly XR shortcut: pressing either controller thumbstick button exits XR and opens the browser settings HUD.

### Changed
- Updated XR locomotion to be right-stick-primary for forward/back movement, with left-stick fallback, so turning and movement can be handled with one thumb.
- Updated XR session toggle UX messaging so intentional XR exits do not display a false "request failed" error.

### Fixed
- Fixed XR controller axis handling robustness across WebXR gamepad layouts by adding stick-axis fallback support for both `[0,1]` and `[2,3]` axis pairs.

## [1.0.26] - 2026-08-25

### Added
- Added subtle team-color shading for base tiles on the radar while preserving vertical opacity tracking.

### Changed
- Updated cardinal indicator colors to fixed team-color mapping independent of map layout: north=red, east=green, south=blue, west=purple in both 3D markers and radar.
- Increased radar base tint strength so team ownership is easier to read at a glance.
- Updated `hix.bzw` object naming to use directional prefixes consistently and keep team names on bases only.
- Renamed base source texture assets to shorter filenames: `base_top_source.png` -> `base_top.png`, `base_wall_source.png` -> `base_wall.png`.

### Fixed
- Fixed inconsistent directional naming in `hix.bzw`, including mixed prefix/suffix patterns and duplicate platform direction labels.

## [1.0.25] - 2026-08-25

### Added
- Added BZFlag teleporter textures (`caution.png`, `telelink.png`) and BZ-inspired teleporter frame/portal rendering with animated portal visuals.
- Added base source textures (`base_top.png`, `base_wall.png`) and team-aware base rendering assets for map-defined bases.

### Changed
- Updated teleporter geometry and face rendering toward BZFlag parity, including border framing, portal face behavior, and map-driven placement/orientation.
- Updated mountain rendering visibility on large maps by expanding view-distance handling so mountains remain visible at BZFlag-like perimeter placement.
- Updated base texture mapping to match BZFlag behavior: top/bottom fixed UV mapping (single texture repeat) and side faces using size-based repeats.

### Fixed
- Fixed a client texture colorization TypeError in base tint generation (`drawImage` source type mismatch).
- Fixed base team colorization so map teams render distinctly as red/green/blue/purple instead of all appearing red/gray.

## [1.0.24] - 2026-08-25

### Added
- Added deterministic projectile impact-point refinement on the server for obstacle and map-edge hits, so impact billboards render at stable contact points.

### Changed
- Updated remote projectile spawn handling to use authoritative server coordinates instead of wall-clock lead compensation.
- Updated remote extrapolation stop handling to clamp only when the replicated remote state is an explicit full stop.

### Fixed
- Fixed missing shot-end billboard effects for other players by always honoring authoritative projectile removal coordinates.
- Fixed impact visuals landing inside geometry by backtracking projectile/map-edge collision points before broadcast.
- Fixed delayed remote stop visibility by forcing a dead-stick move update at local inertial stop (`fs=0`, `rs=0`) and replicating that stop state immediately.

## [1.0.23] - 2026-08-25

### Added
- Added BZFlag explosion atlas assets (`explode1.png`, `explode2.png`) and a billboarded shot-impact animation path for projectile termination effects.

### Changed
- Updated local firing visuals so your own shots render immediately on send, then reconcile to the server projectile ID when the authoritative echo arrives.
- Updated shot-impact protocol handling to carry an explicit projectile end reason code and impact position data.

### Fixed
- Fixed delayed local shot visibility that previously made shots appear far from the barrel under network latency.
- Fixed shot-end visuals to only trigger explosion billboards for BZFlag-style explode reason (`reason === 0`).

## [1.0.22] - 2026-08-24

### Added
- Added an explicit naming migration note in the README for `compose.yml`, `server.json`, and `example-server.json`.

### Changed
- Renamed `docker-compose.yml` to `compose.yml`.
- Renamed `example-server-config.json` to `example-server.json`.
- Standardized default runtime config paths and examples to use `server.json` naming.

### Fixed
- Fixed Docker bind-mount ownership friction by pinning the container runtime user to UID/GID `1000:1000`.
- Fixed dev watcher config to watch `server.json` after the naming migration.

## [1.0.21] - 2026-08-24

### Added
- Added persistent runtime map storage for uploads and operator-managed maps via a runtime maps directory (defaulting to `/data/maps` in Docker).

### Changed
- Updated map discovery and selection to merge runtime-uploaded maps with bundled image maps.
- Updated Docker documentation to explain where server config and uploaded maps persist by default.

### Fixed
- Fixed Docker map switching reload behavior by restarting the process after operator map changes when not running under nodemon.
- Fixed silent operator failures by surfacing generic server success/error responses in the client and logging config write errors with paths server-side.

## [1.0.20] - 2026-08-24

### Added
- Added an explicit project policy that distribution artifacts remain public by default, including container images and release downloads.

### Changed
- Migrated repository and container registry references from `BZFlag-Dev` to `timriker` across docs, scripts, runtime links, and Docker defaults.

### Fixed
- Fixed post-transfer pull failures caused by stale owner paths by updating published image references to `ghcr.io/timriker/bzo`.

## [1.0.19] - 2026-08-24

### Added
- Added a repository security policy in `SECURITY.md` covering reporting flow, support scope, and update guidance.

### Changed
- Added a controls documentation consistency check (`npm run check:controls-docs`) and integrated it into `npm run check`.

### Fixed
- Applied safe dependency security updates in the lockfile to address known advisories in `express`, `body-parser`, `qs`, `js-yaml`, and `brace-expansion`.
- Aligned README and in-game Help controls so documented keybindings match the current implementation.

## [1.0.18] - 2026-08-24

### Added
- Added release-time Node.js compatibility validation on both Node.js `18.19.1` and `24.19.0`.

### Changed
- Switched container publishing to a single Ubuntu `26.04` image lane while keeping multi-arch (`linux/amd64`, `linux/arm64`) manifests.
- Updated the Docker runtime install path to pinned Node.js `24.19.0` binaries on Ubuntu `26.04`.

### Fixed
- Fixed release process drift by aligning CI, release workflow, Dockerfile, and README with the current Node compatibility and Docker publishing policy.

## [1.0.17] - 2026-08-24

### Added
- Added clone-safe ghost label binding so ghost name labels stay connected after tank cloning.

### Changed
- Updated jump-path debug rendering to use a momentum-only airborne projection and always terminate on ground impact.

### Fixed
- Fixed stale ghost player names (for example showing "Player 1") by ensuring ghost labels receive the same name updates as tank labels.
- Removed unnecessary per-update name prefix churn from packet-motion debug labels.

## [1.0.16] - 2026-08-24

### Added
- Added Nearby WebRTC voice chat with in-game microphone controls and per-player nearby peer routing.
- Added a dedicated Voice settings dialog opened from the main Settings HUD.

### Changed
- Moved the main browser entrypoint from `game.js` to `client.js`.
- Updated HUD panel behavior so opening Help, Voice, or Operator hides the Settings HUD.

### Fixed
- Fixed mobile/desktop firing cadence so holding fire respects `shotReloadTime` on the client and server.
- Fixed Help panel usability by adding proper scrolling and a close button.
- Fixed movement collision precedence so driving on top of one obstacle no longer allows moving through overlapping obstacles or world boundaries.

## [1.0.15] - 2026-08-23

### Added
- Added a more stable WebXR foundation with cleaner session lifecycle handling and controller/input state isolation.

### Changed
- Updated the client to Three.js 0.185.1 and synced the browser import map and dependency versions to match the updated renderer.
- Improved renderer scheduling so the app handles normal playback and XR sessions more predictably.

### Fixed
- Fixed wall impacts while jumping so tanks keep the vertical component of their jump and resume a valid horizontal trajectory after contact instead of sticking to the obstacle.
- Stabilized WebXR startup, visibility changes, controller changes, and session teardown paths to reduce stale input and renderer issues.

## [1.0.14] - 2026-04-08

### Fixed
- Synchronized release metadata so `package-lock.json` now matches `package.json` versioning for the published package (`1.0.14`).
- Cut a follow-up patch release to carry the metadata correction without rewriting the previously published `v1.0.13` release.

## [1.0.13] - 2026-04-07

### Added
- Added projected planar (stencil-style) shadows for tanks: each visible tank casts a soft ground shadow computed by projecting its geometry onto the ground plane along the sun direction.

### Changed
- Switched from real-time Three.js shadow mapping (PCFSoftShadowMap) to projected planar shadows for better performance; shadow map generation on lights is now disabled.
- Updated npm dependencies to address audit findings.

## [1.0.12] - 2026-04-01

### Changed
- Updated projectile/shot behavior to better match classic BZFlag feel and timing.
- Refined shot handling so client and server behavior stays aligned with the BZFlag-style firing model.

## [1.0.11] - 2026-04-01

### Added
- Added BZFlag mountain, ground, bolt, and shot-tail textures to the client asset set.
- Added BZFlag-style onscreen shot-slot indicators beside the target HUD.

### Changed
- Updated mountains and ground to use BZFlag-style placement, scale, and texture repetition for a closer classic battlefield look.
- Retuned world lighting toward BZFlag day/night colors while keeping `bzo`'s world-time cycle.
- Switched projectile rendering from simple glowing spheres to BZFlag-inspired tinted bolt sprites with matching colored tails.
- Updated shot speed/range handling so server simulation, client rendering, radar visibility, and config defaults all use the same BZFlag-style values.
- Switched firing behavior from cooldown-only shooting to BZFlag-style shot slots, with the example config defaulting to one slot and the runtime server config set to three.

### Fixed
- Fixed projectile desync that made local shots appear much slower than the server-tracked projectile speed.
- Fixed shot-slot HUD behavior so each slot tracks its actual active projectile instead of multiple slots animating together.

## [1.0.10] - 2026-03-31

### Added
- Added BZFlag obstacle textures for boundaries, boxes, pyramids, tank treads, and tank body detailing.
- Added a BZFlag-style loading overlay that keeps chat available while delaying active join until render-critical world and tank assets are ready.
- Added a new `wheeled6` tank model option with a six-wheel armored-car silhouette.
- Added documentation for the supported tank OBJ naming contract in `docs/tank-model-format.md`.

### Changed
- Switched the default player tank model to `bzflag`, renamed the old default model to `modern`, and renamed the split BZFlag model asset to `bzflag`.
- Updated tank model selection and server-side model discovery to prefer the supported selectable models and hide source-only OBJ assets from the menu.
- Updated cloud height placement to float above the tallest obstacle by roughly one jump height.
- Added configurable BZFlag-style fog mode, density, start, and end settings while keeping fog color driven by time-of-day.

### Fixed
- Fixed startup races that could leave the local tank partially initialized until switching models by gating gameplay join on render readiness.
- Fixed blank tank selection states caused by exposing `tank.obj` as a selectable model.
- Fixed wheel-face clipping on treaded models by nudging wheel meshes slightly outward from the tread surfaces.
- Fixed the `wheeled6` model so it renders as a true wheel-only vehicle without fake tread geometry.

## [1.0.9] - 2026-03-27

### Changed
- Increased scene fog start/end distances (120–500) to better match the 1:1 BZFlag world scale.

### Fixed
- Fixed obstacle rotation for all rotated boxes, walls, and teleporters parsed from `.bzw` maps by correcting the BZFlag +Y→Three.js -Z axis-flip compensation in the rotation formula.

## [1.0.8] - 2026-03-27

### Added
- Added BZFlag-style spawn visuals with a short ground flash ring and vertical spawn burst on join and respawn.

### Changed
- Updated first-person camera and shot origin alignment to use model-derived muzzle offsets for closer BZFlag parity.
- Updated first-person FOV behavior to use BZFlag-style horizontal FOV conversion by display aspect.
- Updated jump defaults to BZFlag-like values (`jumpVelocity: 19`, `gravity: 9.8`) and aligned landing flash/squish timing to BZFlag feel.

### Fixed
- Fixed server/client gravity configuration flow so gravity is configurable server-side and propagated through game config.
- Fixed landing feedback consistency by triggering effects on landing transitions without local threshold suppression.

## [1.0.7] - 2026-03-26

### Fixed
- Make the `prepare` script skip Husky installation when dev dependencies are omitted so container builds using `npm ci --omit=dev` no longer fail with `sh: 1: husky: not found`.

## [1.0.6] - 2026-03-26

### Fixed
- Replace `docker/build-push-action` (Buildx) with plain `docker build` + `docker push` commands to eliminate unexplained BuildKit exit code 127 failures and get clear build output in CI logs.

## [1.0.5] - 2026-03-26

### Fixed
- Add `no-cache: true` to Docker build step to prevent stale BuildKit layer cache from masking base image changes.
- Remove unused QEMU setup step; only `linux/amd64` is targeted so QEMU is not needed.

## [1.0.4] - 2026-03-26

### Changed
- Switch Docker base image from `node:20-slim` to `ubuntu:24.04` with OS-provided Node.js 18 and npm, matching the Ubuntu 24.04 development environment and avoiding mysterious `npm ci` exit code 127 failures in GitHub Actions Buildx.

## [1.0.3] - 2026-03-26

### Fixed
- Restrict Docker image build to `linux/amd64` to avoid QEMU emulation failures that caused `npm ci` to exit with code 127 when building `linux/arm64` on GitHub Actions runners.

## [1.0.2] - 2026-03-26

### Fixed
- Switch Docker base image from `node:20-alpine` to `node:20-slim` so that `npm` is available during the container build step and the release workflow succeeds.

## [1.0.1] - 2026-03-26

### Added
- Local Git hooks now lint staged JavaScript before commit and run full checks before push.

### Changed
- Release workflow now initializes QEMU before Buildx to support multi-architecture Docker image publishing.

### Fixed
- Fixed release automation gap that could fail container publishing during tagged releases.

## [1.0.0] - 2026-03-26

### Added
- Tag-gated release automation that validates `package.json` and `CHANGELOG.md` before publishing.
- GitHub Container Registry publishing for versioned Docker images.
- Docker packaging with a persistent `/data` volume for runtime config.
- `/source` route and in-app source-code link to satisfy AGPL network source availability.
- Release helper scripts for preparing, validating, and extracting changelog entries.

### Changed
- Updated licensing headers across source files with copyright and source references.
- Expanded documentation for releases, installation, configuration, and update strategy.
- Server startup now bootstraps a runtime config from `example-server.json` when no config exists.

### Fixed
- Cleaned up release metadata and project packaging details so shipped artifacts are consistent.
