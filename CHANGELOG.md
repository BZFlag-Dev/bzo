# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and versions use SemVer tags like v1.0.0.

## [Unreleased]

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
