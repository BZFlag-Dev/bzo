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
- a versioned Docker image at `ghcr.io/bzflag-dev/bzo:<version>`
- a moving Docker tag at `ghcr.io/bzflag-dev/bzo:latest`

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

### Direct docker run

```bash
docker run -d \
  --name bzo \
  -p 3000:3000 \
  -v bzo-data:/data \
  ghcr.io/bzflag-dev/bzo:latest
```

The image defaults to `SERVER_CONFIG_PATH=/data/server-config.json`.

## Install from source

### Prerequisites

- Node.js 20+
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
docker pull ghcr.io/bzflag-dev/bzo:latest
```

If you want automatic container updates, use your preferred container update manager. That is not built into the game itself.

## Changelog and release notes

- Human-readable history is kept in [CHANGELOG.md](CHANGELOG.md)
- Tagged GitHub releases use the matching changelog section as release notes

## Controls

- `W` / `S` — move forward/backward
- `A` / `D` — turn left/right
- `Space` — shoot
- `Tab` — jump
- `M` — toggle mouse movement
- `C` — toggle camera
- `O` — operator panel
- `/` or `T` — chat

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

1. install dependencies
2. run lint and validation
3. fail if `package.json` does not match the pushed tag
4. fail if [CHANGELOG.md](CHANGELOG.md) does not contain a matching non-placeholder section
5. publish a GitHub release
6. attach a source tarball
7. build and publish a multi-arch Docker image to GHCR

## AGPL source availability

This project is licensed under the GNU Affero General Public License v3.0.

Network users can access the source code from the running app via `/source`, or directly at:

- <https://github.com/BZFlag-Dev/bzo>
