# Battlezone Online

Battlezone Online is a real-time multiplayer tank game built with Node.js, WebSockets, and Three.js.

## What users can install

There are two supported ways to run the game:

1. Docker image from GitHub Container Registry
2. Source release tarball or git checkout

For most users, Docker is the best install and update path.

## Release contents

Each tagged release publishes:

- a GitHub release with notes generated from [CHANGELOG.md](CHANGELOG.md)
- a source tarball
- a versioned Ubuntu 26.04 image at `ghcr.io/timriker/bzo:<version>-ubuntu26.04`
- a moving `ubuntu26.04` tag
- `ghcr.io/timriker/bzo:<version>` and `ghcr.io/timriker/bzo:latest`, both using Ubuntu 26.04

Every published image contains `linux/amd64` and `linux/arm64` variants. Release
tags use stable `vX.Y.Z` SemVer only; prerelease and build-metadata tags are not
published. Ubuntu 26.04 images use the pinned Node.js `24.19.0` runtime.

Docker images are built on Ubuntu 26.04 with pinned Node.js `24.19.0`.
Runtime compatibility is validated in CI on Node.js `18.19.1` and `24.19.0`.

## Install with Docker

### Quick start with docker compose

Use [docker-compose.yml](docker-compose.yml):

```bash
docker compose up -d
```

This starts the server on port 3000 and stores runtime config in `./data/server-config.json`.

On first start, the server copies [example-server-config.json](example-server-config.json) to the configured runtime path if no config exists.

Then open:

- `http://localhost:3000`

The image is multi-arch (`linux/amd64` and `linux/arm64`), so Docker will pull the
correct variant for your host by default.

If you need to force an architecture, set `platform` in compose:

```yaml
services:
  bzo:
    image: ghcr.io/timriker/bzo:latest
    platform: linux/amd64 # or linux/arm64
    volumes:
      - ./data:/data
```

### Direct docker run

```bash
docker run -d \
  --name bzo \
  -p 3000:3000 \
  -v bzo-data:/data \
  ghcr.io/timriker/bzo:latest
```

The image defaults to `SERVER_CONFIG_PATH=/data/server-config.json`.

To force a specific architecture when running directly:

```bash
docker run -d \
  --name bzo \
  --platform linux/amd64 \
  -p 3000:3000 \
  -v bzo-data:/data \
  ghcr.io/timriker/bzo:latest
```

Use `--platform linux/arm64` on ARM hosts if you want to pin that explicitly.

### Docker data persistence

- Persist server settings and runtime config by mounting `/data` (already done in
  `docker-compose.yml`).
- `SERVER_CONFIG_PATH` defaults to `/data/server-config.json`.

### Persisting custom maps (optional)

Built-in maps ship inside the image. If you want your own map files to persist
across image updates, mount a host directory to `/app/maps`:

```yaml
services:
  bzo:
    image: ghcr.io/timriker/bzo:latest
    volumes:
      - ./data:/data
      - ./maps:/app/maps:ro
```

Then set `mapFile` in `./data/server-config.json` to one of the files in `./maps`.

## Install from source

### Prerequisites

- Node.js 18.19.1 or Node.js 24.19.0
- npm

### Setup

```bash
npm install
```

If `server-config.json` does not exist, the server will create it from [example-server-config.json](example-server-config.json) on first start.

### Run

Production:

```bash
npm start
```

Development:

```bash
npm run dev
```

Then open:

- `http://localhost:3000`

## Configuration

Runtime configuration lives in `server-config.json` by default.

You can override the path with:

```bash
SERVER_CONFIG_PATH=/path/to/server-config.json npm start
```

See [example-server-config.json](example-server-config.json) for the supported shape.

## Updating

### Source installs

There is no built-in self-update path for source installs.

To update, download a newer release or pull newer source, then run:

```bash
npm install
```

### Docker installs

Docker is the recommended update path.

Manual update:

```bash
docker compose pull
docker compose up -d
```

or:

```bash
docker pull ghcr.io/timriker/bzo:latest
```

If you want automatic container updates, use your preferred container update manager. That is not built into the game itself.

## Changelog and release notes

- Human-readable history is kept in [CHANGELOG.md](CHANGELOG.md)
- Tagged GitHub releases use the matching changelog section as release notes

## Controls

- `W` / `S` or `Up` / `Down` — move forward/backward
- `A` / `D` or `Left` / `Right` — turn left/right
- `Space` — shoot
- `Tab` — jump
- `Q` — self-destruct
- `P` — pause/resume
- `N` — open chat
- `Enter` — send chat (while chat input is focused)
- `Esc` — exit chat input or mouse mode
- `M` — toggle mouse movement
- `C` — cycle camera mode
- `O` — toggle operator panel
- `F` — toggle fullscreen
- `I` — toggle debug HUD
- `B` — toggle nearby voice microphone
- `/` or `?` — show/hide help panel

## WebXR

The VR mode uses native WebXR and requires a browser and headset that support
`immersive-vr`. For local validation, open the game at `http://localhost:3000`.
For remote access, terminate TLS at the reverse proxy and open the game over
`https://`; the client automatically uses `wss://` for its WebSocket connection
when the page is served over HTTPS.

If the deployment sets a restrictive `Permissions-Policy` header, allow
`xr-spatial-tracking=(self)`. The Node.js server does not terminate TLS itself,
so HTTPS and the corresponding WebSocket proxy configuration are deployment
responsibilities.

Use the [WebXR validation checklist](docs/webxr-validation.md) when checking a
new browser, headset, or deployment. WebGPU rendering is outside the scope of
this checklist.

## Development checks

```bash
npm run check
```

This runs syntax and lint checks.

CI also runs these checks on pushes and pull requests.

## Release process

Prepare a release locally:

```bash
npm run release:prepare -- 1.0.1
```

That updates:

- `package.json`
- `package-lock.json`
- `CHANGELOG.md`

Then edit the new changelog section so it contains the real user-visible changes.

Validate locally:

```bash
npm run check
npm run release:check -- v1.0.1
npm run release:check:increment -- v1.0.1
```

Then commit, tag, and push:

```bash
git add package.json package-lock.json CHANGELOG.md
git commit -m "Release v1.0.1"
git tag v1.0.1
git push
git push origin v1.0.1
```

The release workflow will:

1. verify that the stable tag is newer than the previous release and points to `main`
2. install dependencies and run lint, validation, audit, and CodeQL checks
3. fail if `package.json` does not match the pushed tag
4. fail if [CHANGELOG.md](CHANGELOG.md) does not contain a matching non-placeholder section
5. build and smoke-test Ubuntu 26.04 images with pinned Node.js `24.19.0` for `linux/amd64` and `linux/arm64`
6. promote the verified versioned and moving Docker tags to GHCR
7. publish a GitHub release and attach a source tarball

## AGPL source availability

This project is licensed under the GNU Affero General Public License v3.0.

Network users can access the source code from the running app via `/source`, or directly at:

- <https://github.com/timriker/bzo>
