## Copilot Memory Policy

- When the user asks to remember something, always store a note in `.github/copilot-instructions.md` so that other sessions and contributors will also remember it. This ensures persistent, project-wide memory for important conventions and preferences.

## Coding Conventions

- **Always prefer code reuse over duplication.** When implementing new features or refactoring, extract and reuse shared logic instead of copying code. This ensures maintainability and consistency across the project.

## Repo Snapshot
- Real-time BZFlag-inspired arena: Node/Express/WS server in `server.js`, browser-side Three.js client under `public/`.
- All front-end modules are plain ES modules loaded directly by the browser; no bundler. Update the `<script type="importmap">` block in `public/index.html` when adding new external modules.
- Preserve the AGPL license header that already appears at the top of major source files when creating or modifying files.

## Dev Workflow
- Install dependencies once with `npm install`.
- `npm run dev` starts `server.js` via nodemon; `npm start` runs it without auto-restart.
- The server watches all files in `public/` and `server.js`, forcing connected clients to reload on any change in `public/` and restarting itself if `server.js` changes.
- Gameplay logs stream to `server.log`, which is cleared on each server boot.

## Server Architecture (`server.js`)
- Single Express app serves static assets and hosts a `ws` WebSocket server that drives gameplay.
- Game loop (`setInterval(gameLoop, 16)`) updates projectile travel and collision checks. The server only verifies player 'move' messages and does not create new playerMoved messages itself; movement updates are broadcast only in response to client 'move' messages.
- Player lifecycle: connection emits `init`, `newPlayer`, and `playerJoined` messages; `joinGame`, `move`, `shoot`, `pause`, and `chat` requests are validated server-side before broadcasting.
- Movement/shot validation relies on `GAME_CONFIG` thresholds and obstacle collision helpers; keep any new mechanics in sync with these checks.
- Map loading: reads `server-config.json` to choose between procedural obstacles and `.bzw` files parsed by `parseBZWMap`. Add maps to `maps/` and update the config or admin panel message to switch.
- Admin overlay messages share the WebSocket channel; reuse that pattern for additional operator tools.
- `forceClientReload()` broadcasts a `reload` message and closes sockets; it is exposed globally and triggered on `SIGUSR1` or watched file changes.

## Client Architecture (`public/`)
- `game.js` owns scene setup, Three.js assets, WebSocket handling, HUD orchestration, and per-frame prediction; any protocol changes must be reflected in its `handleServerMessage` switch.
- Input is centralized in `input.js`, which exports `setupInputHandlers`, `virtualInput`, and `keys` for desktop and mobile controls.
- HUD helpers live in `hud.js`; prefer extending those utilities over duplicating UI logic in `game.js`.
- Audio buffers are generated procedurally in `audio.js` for shooting, explosions, jumping, and landing.
- `styles.css` and `index.html` define HUD layout, mobile overlays, and the import map (currently referencing Three.js 0.160.0 even though `package.json` pulls 0.181.2; align versions if upgrading).
- Client connects back to the host that served it (`ws://<host>`); avoid hardcoding URLs so the same build runs locally and in production.

## Configuration & Data
- Runtime settings (name, MOTD, default map) live in `server-config.json`; `example-server-config.json` documents the expected shape.
- Obstacles are generated/resolved server-side and sent in the `init` payload; client recreates meshes from that data, so keep the schema stable when extending obstacle properties.
- Maps in `maps/*.bzw` use scaled BZFlag coordinates (X/Z halved); ensure new parsers respect the scaling so collisions remain accurate.

## Conventions & Testing

- No automated tests are present; manual play sessions via the browser are the de-facto regression check.
- When adding network messages, document them in both server switch statements and client handlers, and update debug HUD counters if needed.

# Player Join/Entry/Scoreboard Flow (Persistent Project Memory)

## Player Connection and Entry Flow

1. **Player connects to server**
	- Server adds them to the player list, but they have not yet joined the game (not spawned).
	- Server includes them in the `init` message to all clients, with `health = 0` and a placeholder position (e.g., `x: 0, y: 0, z: 0`).
	- Server broadcasts a `playerJoined` message to all clients with `health = 0` and position (0,0,0).

2. **Client receives `init` or `playerJoined` with `health = 0`**
	- Adds the player to the scoreboard.
	- Creates their tank in the world, but sets `tank.visible = false`.
	- Shows their name and stats in the scoreboard, but does not show their tank in the 3D world.

3. **Player sends `joinGame` (with their name)**
	- Server updates their player object with name, position, and `health > 0`.
	- Server broadcasts a new `playerJoined` message for that player, with `health > 0` and their spawn position.

4. **Client receives `playerJoined` with `health > 0`**
	- Updates the player's tank: sets `tank.visible = true`, updates position, name, and stats.
	- Scoreboard is already correct, but update if needed.

5. **Player leaves before joining**
	- Server sends a `playerLeft` message to all clients.
	- Client removes the player from the scoreboard and world.

## Summary Table

| Event                | Scoreboard | Tank in World | Tank Visible | Notes                        |
|----------------------|------------|---------------|--------------|------------------------------|
| Connect (not joined) | Yes        | Yes           | No           | health = 0                   |
| JoinGame             | Yes        | Yes           | Yes          | health > 0, set position     |
| Leave (not joined)   | No         | No            | N/A          | Remove from all              |

## Notes
- This protocol ensures all connected players are always visible in the scoreboard, even if not yet joined.
- Tanks for unjoined players exist in the scene but are invisible.
- When a player joins, their tank becomes visible and is placed at the correct position.
- No need to remove/re-add tanks or scoreboard entries—just update visibility and state.
- When a player leaves before joining, remove them from scoreboard and world.

---

**This flow is project memory and should be followed for all future join/entry/scoreboard logic.**
