# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and versions use SemVer tags like v1.0.0.

## [Unreleased]

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
