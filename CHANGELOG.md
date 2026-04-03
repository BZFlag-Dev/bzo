# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and versions use SemVer tags like v1.0.0.

## [Unreleased]

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
- Server startup now bootstraps a runtime config from `example-server-config.json` when no config exists.

### Fixed
- Cleaned up release metadata and project packaging details so shipped artifacts are consistent.
