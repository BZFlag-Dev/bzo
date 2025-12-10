/*
 * This file is part of a project licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * See the LICENSE file in the project root or visit https://www.gnu.org/licenses/agpl-3.0.html
 */

const express = require('express');
const logPath = require('path').join(__dirname, 'server.log');
// Clear server.log on restart
require('fs').writeFileSync(logPath, '');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');


// Common log function: logs to console and to server.log
function log(...args) {
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  // Write to console
  console.log(msg);
  // Append to server.log
  fs.appendFileSync(path.join(__dirname, 'server.log'), msg + '\n');
}

function logError(...args) {
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  console.error(msg);
  fs.appendFileSync(path.join(__dirname, 'server.log'), '[ERROR] ' + msg + '\n');
}

const app = express();
const bodyParser = require('body-parser');
const { type } = require('os');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static('public'));
// Serve admin panel for /admin route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
// --- Admin API Endpoints ---

// List available maps

const server = app.listen(PORT, '::', () => {
  log(`Server running on http://[::]:${PORT}`);
});

// WebSocket server
const wss = new WebSocketServer({ server });

// Game constants
const GAME_CONFIG = {
  MAP_SIZE: 400,
  TANK_SPEED: 10, // units per second
  TANK_ROTATION_SPEED: 2, // radians per second
  SHOT_SPEED: 30,
  SHOT_COOLDOWN: 1000, // ms
  SHOT_DISTANCE: 50, // Max distance a shot can travel
  MAX_SPEED_TOLERANCE: 1.5, // Allow 50% tolerance for latency
  SHOT_POSITION_TOLERANCE: 2, // Max distance shot can be from claimed position
  PAUSE_COUNTDOWN: 2000, // ms
  JUMP_VELOCITY: 30, // Initial upward velocity
  GRAVITY: 30, // Gravity acceleration (units per second squared)
  JUMP_COOLDOWN: 500, // ms between jumps
};

// --- Map selection: load from config and maps/ directory ---
const configPath = path.join(__dirname, 'server-config.json');
let serverConfig = {};
try {
  serverConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
  logError('Could not load server-config.json:', e);
}

let MAP_SOURCE = serverConfig.mapFile || 'random';
let mapPath = '';
if (MAP_SOURCE !== 'random') {
  mapPath = path.join(__dirname, 'maps', MAP_SOURCE);
  if (!fs.existsSync(mapPath)) {
    logError(`Map file not found: ${mapPath}. Reverting to random map.`);
    MAP_SOURCE = 'random';
  }
}

// Parse a BZW file and convert to obstacle format
function parseBZWMap(filename) {
  const text = fs.readFileSync(filename, 'utf8');
  const lines = text.split(/\r?\n/);
  const obstacles = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('world')) {
      // Look ahead for size
      for (let j = i + 1; j < lines.length; j++) {
        const wline = lines[j].trim();
        if (wline.startsWith('size')) {
          const [, size] = wline.split(/\s+/);
          if (size) {
            GAME_CONFIG.MAP_SIZE = parseFloat(size);
          }
          break;
        }
        if (wline === 'end') break;
      }
    } else if (line.startsWith('box')) {
      current = { type: 'box' };
    } else if (line.startsWith('pyramid')) {
      current = { type: 'pyramid' };
    } else if (line.startsWith('base')) {
      current = { type: 'box' };
    } else if (line.startsWith('teleporter')) {
      current = { type: 'box' };
    } else if (current && line.startsWith('position')) {
      // position x y z (scale x and y by 0.5)
      const [, x, y, z] = line.split(/\s+/);
      current.x = parseFloat(x) * 0.5;
      current.z = parseFloat(y) * 0.5; // BZFlag Y -> our Z
      current.baseY = (parseFloat(z) || 0) * 0.5;
    } else if (current && line.startsWith('size')) {
      // size w d h (scale w and d by 0.5)
      const [, w, d, h] = line.split(/\s+/);
      const rawW = parseFloat(w);
      const rawD = parseFloat(d);
      const rawH = parseFloat(h);
      current.w = Math.abs(rawW);
      current.d = Math.abs(rawD);
      current.h = Math.abs(rawH) * 0.5;
      if (current.type === 'pyramid') {
        current.inverted = rawH < 0;
      }
    } else if (current && line.startsWith('rotation')) {
      // rotation deg (invert sign to match Three.js)
      const [, deg] = line.split(/\s+/);
      current.rotation = -(parseFloat(deg) || 0) * Math.PI / 180;
    } else if (current && line === 'end') {
      // Assign a name for debugging
      current.name = `${current.type[0].toUpperCase()}${obstacles.length}`;
      obstacles.push(current);
      current = null;
    }
  }
  return obstacles;
}

// Generate random obstacles on server start
function generateObstacles() {
  const obstacles = [];
  GAME_CONFIG.MAP_SIZE = 100;
  const mapSize = GAME_CONFIG.MAP_SIZE;
  const numBoxes = Math.floor(mapSize * mapSize / 2000 + Math.random() * 3);
  const numPyramids = Math.floor(numBoxes / 2);
  const minDistance = 15; // Minimum distance from center and other obstacles

  // Helper to check overlap for both types
  function isTooClose(x, z, w, d, others) {
    for (const other of others) {
      const dist = Math.sqrt(Math.pow(x - other.x, 2) + Math.pow(z - other.z, 2));
      if (dist < (w + other.w) / 2 + minDistance) {
        return true;
      }
    }
    return false;
  }

  // Generate boxes
  for (let i = 0; i < numBoxes; i++) {
    let attempts = 0;
    let validPosition = false;
    let obstacle;
    while (!validPosition && attempts < 50) {
      const x = (Math.random() - 0.5) * (mapSize * 0.8);
      const z = (Math.random() - 0.5) * (mapSize * 0.8);
      const w = 6 + Math.random() * 6;
      const d = 6 + Math.random() * 6;
      const rotation = Math.random() * Math.PI * 2;
      let h, baseY;
      if (Math.random() < 0.6) {
        h = 4 + Math.random() * 4;
        baseY = 0;
      } else {
        h = 3 + Math.random() * 2;
        baseY = 3 + Math.random() * 3;
      }
      obstacle = { x: x * 0.5, z: z * 0.5, w: w * 0.5, d: d * 0.5, h: h * 0.5, baseY, rotation, name: `O${i}` , type: 'box'};
      const distFromCenter = Math.sqrt(x * x + z * z);
      if (distFromCenter < minDistance) {
        attempts++;
        continue;
      }
      if (isTooClose(x, z, w, d, obstacles)) {
        attempts++;
        continue;
      }
      validPosition = true;
    }
    if (validPosition && obstacle) {
      obstacles.push(obstacle);
    }
  }

  // Generate pyramids
  for (let i = 0; i < numPyramids; i++) {
    let attempts = 0;
    let validPosition = false;
    let pyramid;
    while (!validPosition && attempts < 50) {
      const x = (Math.random() - 0.5) * (mapSize * 0.8);
      const z = (Math.random() - 0.5) * (mapSize * 0.8);
      const w = 6 + Math.random() * 6;
      const d = 6 + Math.random() * 6;
      const rotation = Math.random() * Math.PI * 2;
      let h, baseY;
      if (Math.random() < 0.6) {
        h = 4 + Math.random() * 4;
        baseY = 0;
      } else {
        h = 3 + Math.random() * 2;
        baseY = 3 + Math.random() * 3;
      }
      const inverted = Math.random() < 0.2; // 20% chance for random inverted pyramid
      pyramid = { x: x * 0.5, z: z * 0.5, w: w * 0.5, d: d * 0.5, h: h * 0.5, baseY, rotation, name: `P${i}` , type: 'pyramid', inverted };
      const distFromCenter = Math.sqrt(x * x + z * z);
      if (distFromCenter < minDistance) {
        attempts++;
        continue;
      }
      if (isTooClose(x, z, w, d, obstacles)) {
        attempts++;
        continue;
      }
      validPosition = true;
    }
    if (validPosition && pyramid) {
      obstacles.push(pyramid);
    }
  }

  return obstacles;
}

let OBSTACLES;
if (MAP_SOURCE === 'random') {
  OBSTACLES = generateObstacles();
  log(`Generated ${OBSTACLES.length} random obstacles`);
} else {
  // Always look for maps in maps/ directory
  const mapFilePath = path.join(__dirname, 'maps', MAP_SOURCE);
  OBSTACLES = parseBZWMap(mapFilePath);
  log(`Loaded ${OBSTACLES.length} obstacles from maps/${MAP_SOURCE}`);
}
//const OBSTACLES = [
//  {"x":0,"z":0,"w":5,"d":5,"h":4,"baseY":5,"rotation":0,"name":"O0"},
//  {"x":0,"z":-10,"w":5,"d":5,"h":4,"baseY":0,"rotation":0,"name":"O1"}
//];
//log(OBSTACLES);

// Generate random clouds with fractal patter.
function generateClouds() {
  const clouds = [];
  const numClouds = 15;

  for (let i = 0; i < numClouds; i++) {
    // Random position in sky
    const x = (Math.random() - 0.5) * 200;
    const y = 30 + Math.random() * 40;
    const z = (Math.random() - 0.5) * 200;

    // Fractal puffs (multiple spheres clustered together)
    const puffs = [];
    const numPuffs = 5 + Math.floor(Math.random() * 8);

    for (let j = 0; j < numPuffs; j++) {
      puffs.push({
        offsetX: (Math.random() - 0.5) * 10,
        offsetY: (Math.random() - 0.5) * 3,
        offsetZ: (Math.random() - 0.5) * 10,
        radius: 2 + Math.random() * 4
      });
    }

    clouds.push({ x, y, z, puffs });
  }

  return clouds;
}

// Calculate sun and moon positions based on time and estimated location
function getCelestialPositions() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const timeOfDay = hours + minutes / 60;

  // Estimate location (US Eastern timezone based on typical usage)
  const latitude = 40; // ~New York area

  // Simple sun path calculation
  // Sun rises at ~6am, sets at ~6pm, peaks at noon
  const sunAngle = ((timeOfDay - 6) / 12) * Math.PI; // 0 to PI across day
  const sunHeight = Math.sin(sunAngle) * 80; // Height in scene
  const sunDistance = 150;

  const sunPosition = {
    x: Math.cos(sunAngle) * sunDistance,
    y: Math.max(sunHeight, -20),
    z: 0,
    visible: sunHeight > -5
  };

  // Moon opposite side of sun
  const moonAngle = sunAngle + Math.PI;
  const moonHeight = Math.sin(moonAngle) * 80;

  const moonPosition = {
    x: Math.cos(moonAngle) * sunDistance,
    y: Math.max(moonHeight, -20),
    z: 0,
    visible: moonHeight > -5
  };

  return { sun: sunPosition, moon: moonPosition };
}

// Game state
const players = new Map();
const projectiles = new Map();
let projectileIdCounter = 0;

// Get next available player number
function getNextPlayerNumber() {
  let num = 1;
  const takenNumbers = new Set(Array.from(players.values()).map(p => p.playerNumber));
  while (takenNumbers.has(num)) {
    num++;
  }
  return num;
}

// Player class
class Player {
  constructor(ws, name = null, playerNumber = null) {
    this.playerNumber = playerNumber !== null ? playerNumber : getNextPlayerNumber();
    this.id = this.playerNumber.toString();
    this.ws = ws;
    // Always assign a default name if none provided
    this.name = name && name.trim() ? name : `Player ${this.playerNumber}`;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.rotation = 0;
    this.health = 0;
    this.lastShot = 0;
    this.lastUpdate = Date.now();
    this.kills = 0;
    this.deaths = 0;
    this.paused = false;
    this.pauseCountdownStart = 0;
    this.verticalVelocity = 0;
    this.isJumping = false;
    this.lastJumpTime = 0;
    this.onObstacle = false;
    this.connectDate = new Date();
  }

  respawn() {
    const spawnPos = findValidSpawnPosition();
    this.x = spawnPos.x;
    this.y = spawnPos.y;
    this.z = spawnPos.z;
    this.rotation = spawnPos.rotation;
    this.health = 100;
    this.verticalVelocity = 0;
    this.isJumping = false;
    this.onObstacle = false;
  }

  getState() {
    return {
      id: this.id,
      name: this.name,
      x: this.x,
      y: this.y,
      z: this.z,
      rotation: this.rotation,
      health: this.health,
      kills: this.kills,
      deaths: this.deaths,
      paused: this.paused,
      verticalVelocity: this.verticalVelocity,
      connectDate: this.connectDate ? this.connectDate.toISOString() : undefined,
    };
  }
}

// Projectile class
class Projectile {
  constructor(id, playerId, x, y, z, dirX, dirZ) {
    this.id = id;
    this.playerId = playerId;
    this.x = x;
    this.y = y || 2.2; // Default height if not specified (tank height + barrel height)
    this.z = z;
    this.dirX = dirX;
    this.dirZ = dirZ;
    this.createdAt = Date.now();
    this.originX = x;
    this.originZ = z;
  }
}

// Helper functions
// Returns a unique player name. If the given name is empty or taken, returns 'Player n' with the lowest available n.
function nameCheck(requestedName, excludeId = null) {
  let name = requestedName && requestedName.trim() ? requestedName.trim() : '';
  // Get the player number for excludeId
  let playerNumber = null;
  if (excludeId) {
    const playerObj = Array.from(players.values()).find(p => p.id === excludeId);
    if (playerObj) playerNumber = playerObj.playerNumber;
  }
  // If name is empty, assign 'Player n' for their own player number
  if (name.length === 0) {
    if (playerNumber !== null) {
      return `Player ${playerNumber}`;
    }
  }
  // Prevent picking a 'Player n' name unless n matches their player number
  const playerNameMatch = name.match(/^Player\s*(\d+)$/i);
  if (playerNameMatch) {
    const n = parseInt(playerNameMatch[1], 10);
    if (playerNumber === null || n !== playerNumber) {
      // Not allowed to pick a Player n name unless n matches their player number
      return `Player ${playerNumber !== null ? playerNumber : 1}`;
    }
  }
  // Check if name is already taken
  const nameTaken = Array.from(players.values()).some(p => p.id !== excludeId && p.name && p.name.toLowerCase() === name.toLowerCase());
  if (nameTaken) {
    // Assign 'Player n' for their own player number
    if (playerNumber !== null) {
      return `Player ${playerNumber}`;
    }
  }
  return name;
}
function distance(x1, z1, x2, z2) {
  return Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2);
}

function normalizeAngle(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function checkCollision(x, y, z, tankRadius = 2) {
  const halfMap = GAME_CONFIG.MAP_SIZE / 2;

  // Check map boundaries (always check regardless of height)
  if (x - tankRadius < -halfMap || x + tankRadius > halfMap ||
      z - tankRadius < -halfMap || z + tankRadius > halfMap) {
    return { type: 'boundary' };
  }

  // Check obstacles
  for (const obs of OBSTACLES) {
    const tankHeight = 2;
    const epsilon = 0.01;
    // Allow passing under if tank top is below obstacle base
    if (y + tankHeight <= obs.baseY + epsilon) continue;
    // Allow passing over
    if (y >= obs.baseY + obs.h - epsilon) continue;
    const halfW = obs.w / 2;
    const halfD = obs.d / 2;
    const rotation = obs.rotation || 0;
    const obstacleHeight = obs.h || 4;

    // Transform tank position to obstacle's local space
    const dx = x - obs.x;
    const dz = z - obs.z;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;

    if (obs.type === 'box' || !obs.type) {
      // Box collision (AABB + circle)
      const closestX = Math.max(-halfW, Math.min(localX, halfW));
      const closestZ = Math.max(-halfD, Math.min(localZ, halfD));
      const distX = localX - closestX;
      const distZ = localZ - closestZ;
      const distSquared = distX * distX + distZ * distZ;
      if (distSquared < tankRadius * tankRadius) {
        const obstacleBase = obs.baseY || 0;
        const obstacleTop = obstacleBase + obstacleHeight;
        if (y >= obstacleBase + epsilon && y < obstacleTop - epsilon) {
          log(`[COLLISION] ${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)} ${obs.name} ${obs.x.toFixed(2)},${obstacleBase.toFixed(2)},${obs.z.toFixed(2)}, rot:${(obs.rotation).toFixed(2)}, h:${obstacleHeight.toFixed(2)}, top:${obstacleTop.toFixed(5)}, y-top:${(y-obstacleTop).toFixed(5)}`);
        }
        return obs;
      }
    } else if (obs.type === 'pyramid') {
      // Pyramid collision: check if tank is inside the pyramid's base, then check height at that (x,z)
      // Pyramid apex is at (0, h/2, 0) in local space, base is at y = 0
      // For simplicity, use bounding box for base, then check if tank is below pyramid surface
      if (Math.abs(localX) <= halfW && Math.abs(localZ) <= halfD) {
        // Compute normalized distance from center (0,0)
        const nx = Math.abs(localX) / halfW;
        const nz = Math.abs(localZ) / halfD;
        const n = Math.max(nx, nz); // For square pyramid
        // Height at this (x,z) under the pyramid
        const localY = y - obs.baseY;
        const maxPyramidY = obs.h * (1 - n); // Linear slope from center to edge
        if (localY >= epsilon && localY < maxPyramidY - epsilon) {
          // Collides with pyramid slope
          return obs;
        }
      }
    }
  }
  return false;
}

function findValidSpawnPosition(tankRadius = 2) {
  //return { x: 0, y: 0, z: 0, rotation: 0 };
  const halfMap = GAME_CONFIG.MAP_SIZE / 2;
  const maxAttempts = 100;
  const y = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const x = Math.random() * (GAME_CONFIG.MAP_SIZE - tankRadius * 4) - (halfMap - tankRadius * 2);
    const z = Math.random() * (GAME_CONFIG.MAP_SIZE - tankRadius * 4) - (halfMap - tankRadius * 2);
    const rotation = Math.random() * Math.PI * 2;

    if (!checkCollision(x, y, z, tankRadius)) {
      return { x, y, z, rotation };
    }
  }

  // If we couldn't find a valid position after many attempts, return a safe default
  return { x: 0, y: 0, z: 0, rotation: 0 };
}

// Validate player movement
function validateMovement(player, newX, newY, newZ, newRotation, deltaTime) {
  // Can't move while paused
  if (player.paused) {
    return false;
  }

  // Calculate distance moved
  const distMoved = distance(player.x, player.z, newX, newZ);
  const maxDist = GAME_CONFIG.TANK_SPEED * deltaTime * GAME_CONFIG.MAX_SPEED_TOLERANCE;

  if (distMoved > maxDist) {
    log(`Player "${player.name}" moved too fast: ${distMoved} > ${maxDist}`);
    return false;
  }

  // Calculate rotation change
  const rotDiff = Math.abs(normalizeAngle(newRotation - player.rotation));
  const maxRot = GAME_CONFIG.TANK_ROTATION_SPEED * deltaTime * GAME_CONFIG.MAX_SPEED_TOLERANCE;

  if (rotDiff > maxRot) {
    log(`Player "${player.name}" rotated too fast: ${rotDiff} > ${maxRot}`);
    return false;
  }

  // Check map boundaries
  const halfMap = GAME_CONFIG.MAP_SIZE / 2;
  if (Math.abs(newX) > halfMap || Math.abs(newZ) > halfMap) {
    log(`Player "${player.name}" out of bounds`);
    return false;
  }

  // Check collision with obstacles (pass Y position)
  let collision = checkCollision(newX, newY, newZ, 2);
  if (collision) {
    if (collision === true) {
      // Should not happen, but fallback
      log(`Player "${player.name}" collided with unknown object x:${player.x.toFixed(2)}, y:${player.y.toFixed(2)}, z:${player.z.toFixed(2)}`);
    } else if (collision.type === 'boundary') {
      log(`Player "${player.name}" collided boundary x:${player.x.toFixed(2)}, y:${player.y.toFixed(2)}, z:${player.z.toFixed(2)}`);
    } else {
      // Log obstacle details
      const { x, z, w, d, h, baseY, rotation } = collision;
      log(`Player "${player.name}" collided obs:${collision.name} ${x.toFixed(2)},${baseY.toFixed(2)},${z.toFixed(2)}, w:${w.toFixed(2)}, d:${d.toFixed(2)}, h:${h.toFixed(2)}, rot:${rotation.toFixed(2)} (p ${player.x.toFixed(2)},${player.y.toFixed(2)},${player.z.toFixed(2) })`);
    }
    return false;
  }

  return true;
}

// Validate shot
function validateShot(player, shotX, shotY, shotZ) {
  // Shot originates from barrel end, which is ~3 units from tank center
  const barrelLength = 3.0;
  const dist = distance(player.x, player.z, shotX, shotZ);
  if (dist > barrelLength + GAME_CONFIG.SHOT_POSITION_TOLERANCE) {
    log(`Player "${player.name}" shot from invalid position: ${dist} units away`);
    return false;
  }

  const now = Date.now();
  if (now - player.lastShot < GAME_CONFIG.SHOT_COOLDOWN) {
    log(`Player "${player.name}" shot too quickly`);
    return false;
  }

  return true;
}

// send message to a specific player
function sendToPlayer(ws, message) {
  const data = JSON.stringify(message);
  if (ws.readyState === 1) {
    ws.send(data);
  }
}

// Broadcast to all players except sender
function broadcast(message, excludeWs = null) {
  const data = JSON.stringify(message);
  players.forEach((player) => {
    if (player.ws !== excludeWs && player.ws.readyState === 1) {
      player.ws.send(data);
    }
  });
}

// Broadcast to all players including sender
function broadcastAll(message) {
  const data = JSON.stringify(message);
  players.forEach((player) => {
    if (player.ws.readyState === 1) {
      player.ws.send(data);
    }
  });
}

// Helper function to check if position is on top of an obstacle
function checkObstacleCollision(x, y, z) {
  const tankRadius = 2;
  for (const obs of OBSTACLES) {
    const halfW = obs.w / 2;
    const halfD = obs.d / 2;
    const rotation = obs.rotation || 0;

    // Transform position to obstacle's local space
    const dx = x - obs.x;
    const dz = z - obs.z;

    const cos = Math.cos(-rotation);
    const sin = Math.sin(-rotation);
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;

    // Check if tank center is above this obstacle (with some margin for tank size)
    const margin = tankRadius * 0.7;
    if (Math.abs(localX) <= halfW + margin && Math.abs(localZ) <= halfD + margin) {
      const obstacleBase = obs.baseY || 0;
      const obstacleHeight = obs.h || 4;
      const obstacleTop = obstacleBase + obstacleHeight;
      // Check if tank is at or falling toward the top of obstacle
      if (y >= obstacleTop - 1 && y <= obstacleTop + 2) {
        return { onObstacle: true, obstacleHeight: obstacleTop };
      }
    }
  }
  return { onObstacle: false, obstacleHeight: 0 };
}

// Game loop - update projectiles and check collisions
function gameLoop() {
  const now = Date.now();
  const deltaTime = 0.016; // ~60fps

  // Update player jump physics
  players.forEach((player) => {
    if (player.verticalVelocity !== 0 || player.y > 0) {
      // Apply gravity
      player.verticalVelocity -= GAME_CONFIG.GRAVITY * deltaTime;

      // Update vertical position
      player.y += player.verticalVelocity * deltaTime;

      // Check for landing on ground or obstacle
      const obstacleCheck = checkObstacleCollision(player.x, player.y, player.z);

      if (obstacleCheck.onObstacle && player.verticalVelocity <= 0) {
        // Land on obstacle - only end jump when actually landing
        player.y = obstacleCheck.obstacleHeight;
        player.verticalVelocity = 0;
        player.isJumping = false;
        player.onObstacle = true;
      } else if (player.y <= 0 && player.verticalVelocity <= 0) {
        // Land on ground - only end jump when actually landing
        player.y = 0;
        player.verticalVelocity = 0;
        player.isJumping = false;
        player.onObstacle = false;
      }
      // Note: isJumping stays true throughout the jump arc (up, peak, down) until landing

      // Broadcast position update for jumping players
      if (player.ws && player.ws.readyState === 1) {
        broadcastAll({
          type: 'playerMoved',
          id: player.id,
          x: player.x,
          y: player.y,
          z: player.z,
          rotation: player.rotation,
          verticalVelocity: player.verticalVelocity,
        });
      }
    } else if (player.onObstacle) {
      // Player is standing on obstacle - check if they've moved off
      const obstacleCheck = checkObstacleCollision(player.x, player.y, player.z);
      if (!obstacleCheck.onObstacle) {
        // Moved off obstacle - start falling
        player.verticalVelocity = -1;
        player.onObstacle = false;
      }
    }
  });

  // Update projectiles
  projectiles.forEach((proj, id) => {
    const deltaTime = (now - proj.createdAt) / 1000;
    proj.x += proj.dirX * GAME_CONFIG.SHOT_SPEED * 0.016; // ~60fps
    proj.z += proj.dirZ * GAME_CONFIG.SHOT_SPEED * 0.016;

    // Remove if out of bounds, too old, or traveled > SHOT_DISTANCE units
    const halfMap = GAME_CONFIG.MAP_SIZE / 2;
    const dx = proj.x - proj.originX;
    const dz = proj.z - proj.originZ;
    const distTraveled = Math.sqrt(dx * dx + dz * dz);
    if (Math.abs(proj.x) > halfMap || Math.abs(proj.z) > halfMap || deltaTime > 10 || distTraveled > GAME_CONFIG.SHOT_DISTANCE) {
      projectiles.delete(id);
      broadcastAll({ type: 'projectileRemoved', id });
      return;
    }

    // Check collision with obstacles
    for (const obs of OBSTACLES) {
      const halfW = obs.w / 2;
      const halfD = obs.d / 2;
      const rotation = obs.rotation || 0;
      const obstacleHeight = obs.h || 4;
      const obstacleBase = obs.baseY || 0;
      const obstacleTop = obstacleBase + obstacleHeight;

      // Only check collision if projectile is within obstacle's vertical range
      if (proj.y < obstacleBase || proj.y >= obstacleTop) {
        continue; // Projectile is below or above this obstacle
      }

      // Transform projectile position to obstacle's local space
      const dx = proj.x - obs.x;
      const dz = proj.z - obs.z;

      const cos = Math.cos(-rotation);
      const sin = Math.sin(-rotation);
      const localX = dx * cos - dz * sin;
      const localZ = dx * sin + dz * cos;

      // Check if projectile is inside obstacle bounds
      if (Math.abs(localX) <= halfW && Math.abs(localZ) <= halfD) {
        // Hit obstacle!
        projectiles.delete(id);
        broadcastAll({ type: 'projectileRemoved', id });
        return;
      }
    }

    // Check collision with players
    players.forEach((player) => {
      if (player.id === proj.playerId) return; // Can't hit yourself
      if (player.paused) return; // Can't hit paused players
      if (player.health <= 0) return; // Can't hit dead players

      // Check horizontal distance
      const dist = distance(proj.x, proj.z, player.x, player.z);
      if (dist < 2) { // Tank hitbox radius
        // Check vertical collision - tank is roughly 2 units tall
        const tankHeight = 2;
        const playerBottom = player.y;
        const playerTop = player.y + tankHeight;

        // Projectile must be within tank's vertical bounds
        if (proj.y >= playerBottom && proj.y <= playerTop) {
          // Hit!
          projectiles.delete(id);
          player.health = 0;
          player.deaths++;

          const shooter = players.get(proj.playerId);
          if (shooter) {
            shooter.kills++;
          }

          broadcastAll({
            type: 'playerHit',
            victimId: player.id,
            shooterId: proj.playerId,
            projectileId: id,
          });

          // Respawn player
          setTimeout(() => {
            if (players.has(player.id)) {
              player.respawn();
              broadcastAll({
                type: 'playerRespawned',
                player: player.getState(),
              });
            }
          }, 2000);
        }
      }
    });
  });
}

setInterval(gameLoop, 16); // ~60fps

// Function to force all clients to reload
function forceClientReload() {
  log('Forcing all clients to reload...');
  broadcastAll({ type: 'reload' });

  // Close all connections after a short delay
  setTimeout(() => {
    players.forEach((player) => {
      if (player.ws.readyState === 1) {
        player.ws.close();
      }
    });
    players.clear();
  }, 500);
}

// WebSocket connection handler
// When a new player connects, assign a default name and number
wss.on('connection', (ws, req) => {
  let player = new Player(ws);
  players.set(player.id, player);

  // Broadcast newPlayer to all clients (player is dead until they join)
  player.health = 0;
  broadcastAll({
    type: 'newPlayer',
    player: player.getState(),
  });

  // Get client IP and port
  const forwardedFor = req.headers['x-forwarded-for'];
  const forwardedPort = req.headers['x-forwarded-port'];
  const clientIP = forwardedFor ? forwardedFor.split(',')[0].trim() : req.socket.remoteAddress;
  const clientPort = forwardedPort ? forwardedPort : req.socket.remotePort;
  const ipDisplay = forwardedFor ? `${clientIP} (via ${req.socket.remoteAddress})` : clientIP;
  const userAgent = req.headers['user-agent'] || 'unknown';
  if (forwardedFor && forwardedPort) {
    log(`Player ${player.playerNumber} connect from ${ipDisplay}:${clientPort} (x-forwarded-for + x-forwarded-port)`);
  } else if (forwardedFor) {
    log(`Player ${player.playerNumber} connect from ${ipDisplay}:${clientPort} (x-forwarded-for)`);
  } else {
    log(`Player ${player.playerNumber} connect from ${ipDisplay}:${clientPort}`);
  }
  //log(`Player ${player.playerNumber} user agent: ${userAgent}`);

  // Send initial server state in init message
  // Send initial state to new player (do not add to players map or broadcast yet)
  const celestialPositions = getCelestialPositions();
  const clouds = generateClouds();

  ws.send(JSON.stringify({
    type: 'init',
    player: player.getState(),
    players: Array.from(players.values()).map(p => p.getState()),
    config: GAME_CONFIG,
    obstacles: OBSTACLES,
    celestial: celestialPositions,
    clouds: clouds,
    serverName: serverConfig.serverName || '',
    description: serverConfig.description || '',
    motd: serverConfig.motd || '',
  }));

  // Handle messages
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);

      // --- Admin overlay WebSocket API ---
      if (message.type === 'admin' && message.action) {
        const sendAdminResp = (resp) => {
          ws.send(JSON.stringify({ ...resp, adminReqId: message.adminReqId }));
        };
        if (message.action === 'getMaps') {
          fs.readdir(path.join(__dirname, 'maps'), (err, files) => {
            if (err) return sendAdminResp({ error: 'Failed to list maps' });
            const maps = files.filter(f => f.endsWith('.bzw'));
            sendAdminResp({ maps });
          });
          return;
        }
        if (message.action === 'setMap') {
          const mapFile = message.mapFile;
          if (!mapFile || (mapFile !== 'random' && !mapFile.endsWith('.bzw'))) {
            return sendAdminResp({ error: 'Invalid map file' });
          }
          if (mapFile !== 'random') {
            const mapPath = path.join(__dirname, 'maps', mapFile);
            if (!fs.existsSync(mapPath)) {
              return sendAdminResp({ error: 'Map file not found' });
            }
          }
          try {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            config.mapFile = mapFile;
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            sendAdminResp({ success: true });
            log(`Admin set map to ${mapFile}. Server restart required.`);
            process.exit(0);
          } catch (e) {
            sendAdminResp({ error: 'Failed to update config' });
          }
          return;
        }
        if (message.action === 'uploadMap') {
          const { mapName, mapContent } = message;
          if (!mapName || !mapName.endsWith('.bzw') || !mapContent) {
            return sendAdminResp({ error: 'Invalid map upload' });
          }
          const mapPath = path.join(__dirname, 'maps', mapName);
          fs.writeFile(mapPath, mapContent, err => {
            if (err) {
              logError('Map upload failed:', err);
              return sendAdminResp({ error: 'Failed to save map' });
            }
            log(`Admin uploaded new map: ${mapName}`);
            sendAdminResp({ success: true });
          });
          return;
        }
        // Add more admin actions as needed
      }

      switch (message.type) {

        case 'chat': {
          // Ensure 'to' field exists
          const targetId = typeof message.to === 'number' ? message.to : 0;
          const fromId = player.id;
          const fromName = player.name;
          function getPlayerName(id) {
            if (id === 0) return 'ALL';
            if (id === -1) return 'SERVER';
            return players.has(id) ? players.get(id).name : `Player ${id}`;
          }
          const toName = getPlayerName(targetId);
          // Log locally only if to == -1
          if (targetId === -1) {
            log(`[CHAT] ${fromName}->${toName}: ${message.text}`);
            break;
          }
          //console.log('chat:', message, toName, targetId, players.get(targetId));
          // Broadcast to all if to == 0
          if (targetId === 0) {
            log(`[CHAT] ${fromName}->ALL: ${message.text}`);
            broadcastAll({
              type: 'chat',
              from: fromId,
              to: 0,
              text: message.text.trim(),
              id: fromId
            });
            break;
          }
          // Send to specific player if id exists
          if (targetId > 0 && players.has(targetId)) {
            log(`[CHAT] ${fromName}->${toName}: ${message.text}`);
            const targetPlayer = players.get(targetId);
            if (targetPlayer && targetPlayer.ws && targetPlayer.ws.readyState === 1) {
              targetPlayer.ws.send(JSON.stringify({
                type: 'chat',
                from: fromId,
                to: targetId,
                text: message.text.trim(),
                id: fromId
              }));
            }
            break;
          }
          // If targetId is invalid, ignore
          break;
        }
        case 'move':
          const now = Date.now();
          // Calculate deltaTime based on server's last update time
          const deltaTime = (now - player.lastUpdate) / 1000;
          player.lastUpdate = now;

          // Clamp deltaTime to reasonable values (prevent abuse and handle reconnects)
          const clampedDeltaTime = Math.min(Math.max(deltaTime, 0.001), 0.5);

          if (validateMovement(player, message.x, message.y, message.z, message.rotation, clampedDeltaTime)) {
            player.x = message.x;
            player.y = message.y;
            player.z = message.z;
            player.rotation = message.rotation;
            player.forwardSpeed = message.forwardSpeed;
            player.rotationSpeed = message.rotationSpeed;
            if (message.verticalVelocity !== undefined) {
              // Check if client is attempting to jump (sudden positive velocity)
              const isJumpAttempt = message.verticalVelocity >= GAME_CONFIG.JUMP_VELOCITY * 0.9 &&
                                     player.verticalVelocity < GAME_CONFIG.JUMP_VELOCITY * 0.5;

              if (isJumpAttempt) {
                // Validate jump - allow from ground or from top of any obstacle
                const jumpTime = Date.now();
                const timeSinceLastJump = jumpTime - player.lastJumpTime;

                // Check if on ground or on top of an obstacle
                const obstacleCheck = checkObstacleCollision(player.x, player.y, player.z);
                const onValidSurface = player.y <= 0.5 ||
                                      (obstacleCheck.onObstacle && Math.abs(player.y - obstacleCheck.obstacleHeight) < 0.5);

                if (!player.isJumping && timeSinceLastJump >= GAME_CONFIG.JUMP_COOLDOWN && onValidSurface) {
                  // Allow jump
                  player.lastJumpTime = jumpTime;
                  player.verticalVelocity = GAME_CONFIG.JUMP_VELOCITY;
                  player.isJumping = true;
                }
                // Otherwise reject by keeping server's current velocity
              } else {
                // Accept velocity for falling/landing
                player.verticalVelocity = message.verticalVelocity;
              }
            }

            broadcast({
              type: 'playerMoved',
              id: player.id,
              x: player.x,
              y: player.y,
              z: player.z,
              rotation: player.rotation,
              forwardSpeed: player.forwardSpeed,
              rotationSpeed: player.rotationSpeed,
              verticalVelocity: player.verticalVelocity,
            }, ws);
          } else {
            // Send correction back to client
            ws.send(JSON.stringify({
              type: 'positionCorrection',
              x: player.x,
              y: player.y,
              z: player.z,
              rotation: player.rotation,
              verticalVelocity: player.verticalVelocity,
            }));
          }
          break;

        case 'shoot': {
          // message: { type: 'shot', x, y, z, dirX, dirZ }
          if (player.health <= 0) break; // Dead players can't shoot
          if (!validateShot(player, message.x, message.y, message.z)) break;
          const now = Date.now();
          player.lastShot = now;
          const id = (++projectileIdCounter).toString();
          const proj = new Projectile(
            id,
            player.id,
            message.x,
            message.y,
            message.z,
            message.dirX,
            message.dirZ
          );
          projectiles.set(id, proj);
          broadcastAll({
            type: 'projectileCreated',
            id: proj.id,
            playerId: proj.playerId,
            x: proj.x,
            y: proj.y,
            z: proj.z,
            dirX: proj.dirX,
            dirZ: proj.dirZ,
            createdAt: proj.createdAt
          });
          break;
        }

        case 'joinGame':
          let joinName = nameCheck(message.name, player.id);
          player.name = joinName;
          player.health = 100;
          // spawn at valid position
          const spawnPos = findValidSpawnPosition();
          player.x = spawnPos.x;
          player.y = spawnPos.y
          player.z = spawnPos.z;
          player.rotation = spawnPos.rotation;
          player.verticalVelocity = 0;
          player.isJumping = false;
          player.onObstacle = false;
          player.deaths = 0;
          player.kills = 0;
          if (message.isMobile) {
            log(`Player ${player.id} joining game as "${joinName}" [MOBILE]`);
          } else {
            log(`Player ${player.id} joining game as "${joinName}"`);
          }

          // broadcast join to all (full player info)
          broadcastAll({
            type: 'playerJoined',
            player: player.getState(),
          });
          break;

        case 'pause':
          if (!player.paused && player.pauseCountdownStart === 0) {
            // Start pause countdown
            player.pauseCountdownStart = Date.now();

            broadcastAll({
              type: 'pauseCountdown',
              playerId: player.id,
            });

            // After countdown, activate pause
            setTimeout(() => {
              if (players.has(player.id) && player.pauseCountdownStart > 0) {
                player.paused = true;
                player.pauseCountdownStart = 0;

                broadcastAll({
                  type: 'playerPaused',
                  playerId: player.id,
                  x: player.x,
                  y: player.y,
                  z: player.z,
                });
              }
            }, GAME_CONFIG.PAUSE_COUNTDOWN);
          } else if (player.paused) {
            // Unpause
            player.paused = false;
            player.pauseCountdownStart = 0;

            broadcastAll({
              type: 'playerUnpaused',
              playerId: player.id,
            });
          }
          break;
        case 'getMaps':
          fs.readdir(path.join(__dirname, 'maps'), (err, files) => {
            if (err) return sendAdminResp({ error: 'Failed to list maps' });
            let maps = files.filter(f => f.endsWith('.bzw'));
            maps = ['random', ...maps.filter(m => m !== 'random')];
            sendToPlayer(ws, {
              type: 'mapsList',
              currentMap: serverConfig.mapFile || 'random',
              maps,
            });
          });
          break;
      }
    } catch (err) {
      logError('Error handling message:', err.message);
    }
  });

  // Handle disconnect
  ws.on('close', () => {
    const playerName = player.name;
    const playerNum = player.playerNumber;
    const playerKills = player.kills
    const playerDeaths = player.deaths;
    players.delete(player.id);
    log(`Player "${playerName}" (#${playerNum}) disconnected. ${playerKills} kills, ${playerDeaths} deaths. Players: ${players.size}`);

    broadcast({
      type: 'playerLeft',
      id: player.id,
    });
  });
});

// Expose the forceClientReload function for manual triggering
// You can call this from the Node.js console or via a signal
global.forceReload = forceClientReload;

// Optional: Listen for SIGUSR1 signal to trigger reload
process.on('SIGUSR1', () => {
  console.log('Received SIGUSR1 signal');
  forceClientReload();
});

// Watch for file changes and auto-reload clients
const publicDir = path.join(__dirname, 'public');
console.log('Watching public/ for changes...');
fs.readdirSync(publicDir).forEach(file => {
  const filePath = path.join(publicDir, file);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    fs.watch(filePath, (eventType, filename) => {
      if (eventType === 'change') {
        console.log(`\n📝 File changed: ${filename || filePath}`);
        console.log('🔄 Reloading all clients...\n');
        forceClientReload();
      }
    });
    // console.log(`  ✓ Watching: ${path.basename(filePath)}`);
  }
});

// Watch server.js for changes and restart server if modified
const serverJsPath = path.join(__dirname, 'server.js');
if (fs.existsSync(serverJsPath)) {
  fs.watch(serverJsPath, (eventType, filename) => {
    if (eventType === 'change') {
      console.log(`\n📝 server.js changed: ${filename || serverJsPath}`);
      console.log('🔄 Restarting server...\n');
      setTimeout(() => {
        process.exit(0);
      }, 1000);
    }
  });
  console.log(`  ✓ Watching: server.js`);
}
