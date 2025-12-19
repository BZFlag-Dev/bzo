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
- **NEVER use `tail`, `grep`, or terminal commands on `server.log`** - it's always open in the editor. Use `read_file` instead.

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

# Movement Direction Vector (Planned Feature)

## Problem
When sliding along obstacles or boundaries, the player's actual movement direction differs from their rotation, but no packet is sent because `fs` and `rs` don't change. This causes:
- Server has stale position (incorrect hit detection)
- Other clients extrapolate in wrong direction (ghost through obstacles)
- Especially noticeable when sliding along walls or jumping diagonally into obstacles

## Solution: Optional Direction Field (`d`)
Add optional `d` (direction) field to `move` messages when actual movement direction differs from expected direction.

### When to send `d`:
- `validateMove()` returns `altered: true` (slide occurred)
- Calculate actual movement direction from `(newX - oldX, newZ - oldZ)`
- If `abs(actualDirection - expectedDirection) > 0.01 radians`, include `d` in packet
- Expected direction:
  - On ground: `r` (rotation)
  - In air (jump/fall): `jumpDirection` (frozen direction)

### Packet structure:
```javascript
// Normal movement (no slide):
{ type: 'move', x, y, z, r, fs, rs, vv }

// Sliding movement:
{ type: 'move', x, y, z, r, fs, rs, vv, d: actualDirection }
```

### Server handling:
- If `d` present, use it for extrapolation instead of `r`
- Validate `d` is reasonable (perpendicular to collision normal if near obstacles)
- Store as `player.slideDirection` for extrapolation
- Broadcast `d` in `pm` message

### Client extrapolation:
```javascript
const moveDirection = player.slideDirection !== undefined 
  ? player.slideDirection 
  : (player.jumpDirection !== null ? player.jumpDirection : player.r);
const dx = -Math.sin(moveDirection) * fs * speed * dt;
const dz = -Math.cos(moveDirection) * fs * speed * dt;
```

### Benefits:
- Minimal bandwidth: Only 4 extra bytes when sliding
- No extra client compute: Sliding player already calculated direction
- Accurate extrapolation: Other clients see correct movement
- Better hit detection: Server has accurate position

### Implementation status:
**IMPLEMENTED** - Direction vector feature is now active.

---

# World Coordinate System (Persistent Project Memory)

## Three.js Default Coordinate System
This project uses the standard Three.js coordinate system for the game world (top-down view):

**Axes:**
- **+X = East** (right)
- **-X = West** (left)  
- **+Z = South** (toward camera/positive values)
- **-Z = North** (away from camera/negative values)
- **+Y = Up** (vertical height)

**Rotation (r) - Player facing direction:**
- **r = 0** = facing **North** (-Z direction)
- **r = π/2 (1.57)** = facing **West** (-X direction)
- **r = π (3.14)** = facing **South** (+Z direction)
- **r = 3π/2 (4.71)** = facing **East** (+X direction)

**Movement Vectors:**
- Moving north: Z becomes **more negative** (e.g., -10 to -20)
- Moving south: Z becomes **more positive** (e.g., -10 to -5, or 0 to 10)
- Moving east: X becomes **more positive**
- Moving west: X becomes **more negative**

**Examples:**
- Position (30, -30): 30 units east of origin, 30 units north
- Position (50, 10): 50 units east, 10 units south of origin
- Intended vector (0, -5): Moving north (toward more negative Z)
- Intended vector (0, 5): Moving south (toward more positive Z)

---
