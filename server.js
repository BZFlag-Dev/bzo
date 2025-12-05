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
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static('public'));

const server = app.listen(PORT, '::', () => {
  log(`Server running on http://[::]:${PORT}`);
});

// WebSocket server
const wss = new WebSocketServer({ server });

// Game constants
const GAME_CONFIG = {
  MAP_SIZE: 100,
  TANK_SPEED: 5, // units per second
  TANK_ROTATION_SPEED: 2, // radians per second
  SHOT_SPEED: 20,
  SHOT_COOLDOWN: 1000, // ms
  SHOT_DISTANCE: 50, // Max distance a shot can travel
  MAX_SPEED_TOLERANCE: 1.5, // Allow 50% tolerance for latency
  SHOT_POSITION_TOLERANCE: 2, // Max distance shot can be from claimed position
  PAUSE_COUNTDOWN: 2000, // ms
  JUMP_VELOCITY: 30, // Initial upward velocity
  GRAVITY: 30, // Gravity acceleration (units per second squared)
  JUMP_COOLDOWN: 500, // ms between jumps
};

// Generate random obstacles on server start
function generateObstacles() {
  const obstacles = [];
  const mapSize = GAME_CONFIG.MAP_SIZE;
  const numObstacles = Math.floor(mapSize / 20 + Math.random() * 3); // 5-7 obstacles
  const minDistance = 15; // Minimum distance from center and other obstacles

  for (let i = 0; i < numObstacles; i++) {
    let attempts = 0;
    let validPosition = false;
    let obstacle;

    while (!validPosition && attempts < 50) {
      // Random position (avoid center spawn area)
      const x = (Math.random() - 0.5) * (mapSize * 0.8);
      const z = (Math.random() - 0.5) * (mapSize * 0.8);

      // Random size
      const w = 6 + Math.random() * 6; // Width 6-12
      const d = 6 + Math.random() * 6; // Depth 6-12

      // Random rotation (in radians)
      const rotation = Math.random() * Math.PI * 2;

      // Random height and base elevation
      // 60% chance of ground obstacle, 40% chance of floating obstacle
      let h, baseY;
      if (Math.random() < 0.6) {
        // Ground obstacle: 4-8 units tall, sits on ground
        h = 4 + Math.random() * 4;
        baseY = 0;
      } else {
        // Floating obstacle: 3-5 units tall, elevated 3-6 units above ground
        h = 3 + Math.random() * 2;
        baseY = 3 + Math.random() * 3;
      }

      obstacle = { x, z, w, d, h, baseY, rotation };

      // Check distance from center
      const distFromCenter = Math.sqrt(x * x + z * z);
      if (distFromCenter < minDistance) {
        attempts++;
        continue;
      }

      // Check distance from other obstacles
      validPosition = true;
      for (const other of obstacles) {
        const dist = Math.sqrt(
          Math.pow(x - other.x, 2) + Math.pow(z - other.z, 2)
        );
        if (dist < (w + other.w) / 2 + minDistance) {
          validPosition = false;
          break;
        }
      }

      attempts++;
    }

    if (validPosition && obstacle) {
      obstacles.push(obstacle);
    }
  }

  return obstacles;
}

const OBSTACLES = generateObstacles();

// Generate random clouds with fractal pattern
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

function checkCollision(x, z, tankRadius = 2, y = null) {
  const halfMap = GAME_CONFIG.MAP_SIZE / 2;

  // Check map boundaries (always check regardless of height)
  if (x - tankRadius < -halfMap || x + tankRadius > halfMap ||
      z - tankRadius < -halfMap || z + tankRadius > halfMap) {
    return { type: 'boundary' };
  }

  // Check obstacles
  for (const obs of OBSTACLES) {
    const halfW = obs.w / 2;
    const halfD = obs.d / 2;
    const rotation = obs.rotation || 0;
    const obstacleHeight = obs.h || 4;

    // Transform tank position to obstacle's local space
    const dx = x - obs.x;
    const dz = z - obs.z;

    // Rotate point to align with obstacle's axes
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;

    // Check if tank circle intersects with axis-aligned obstacle rectangle
    const closestX = Math.max(-halfW, Math.min(localX, halfW));
    const closestZ = Math.max(-halfD, Math.min(localZ, halfD));

    const distX = localX - closestX;
    const distZ = localZ - closestZ;
    const distSquared = distX * distX + distZ * distZ;

    if (distSquared < tankRadius * tankRadius) {
      const obstacleBase = obs.baseY || 0;
      const obstacleTop = obstacleBase + obstacleHeight;
      const tankHeight = 2;
      if (y !== null) {
        // Allow passing under if tank top is below obstacle base
        if (y + tankHeight <= obstacleBase) {
          continue;
        }
        // Block jumping up into obstacle: if tank bottom is below base and top is above base
        if (y < obstacleBase && y + tankHeight > obstacleBase) {
          log(`[SERVER COLLISION] x:${x.toFixed(2)}, y:${y !== null ? y.toFixed(5) : 'null'}, z:${z.toFixed(2)} obs: x:${obs.x.toFixed(2)}, z:${obs.z.toFixed(2)}, rot:${(obs.rotation||0).toFixed(2)}, base:${obstacleBase.toFixed(2)}, height:${obstacleHeight.toFixed(2)}, top:${obstacleTop.toFixed(5)}, y-top:${y !== null ? (y-obstacleTop).toFixed(5) : 'null'}`);
          return obs;
        }
        // Allow passing over if above 75% of top
        if (y >= obstacleTop * 0.75) {
          continue;
        }
        // Allow being on or just below the obstacle top (within epsilon)
        const epsilon = 0.15;
        if (y >= obstacleTop - epsilon && y <= obstacleTop + epsilon) {
          continue;
        }
        // Block if inside the vertical range (strictly below top - epsilon)
        if (y >= obstacleBase && y < obstacleTop - epsilon) {
          log(`[SERVER COLLISION] x:${x.toFixed(2)}, y:${y !== null ? y.toFixed(5) : 'null'}, z:${z.toFixed(2)} obs: x:${obs.x.toFixed(2)}, z:${obs.z.toFixed(2)}, rot:${(obs.rotation||0).toFixed(2)}, base:${obstacleBase.toFixed(2)}, height:${obstacleHeight.toFixed(2)}, top:${obstacleTop.toFixed(5)}, y-top:${y !== null ? (y-obstacleTop).toFixed(5) : 'null'}`);
          return obs;
        }
      } else {
        log(`[SERVER COLLISION] x:${x.toFixed(2)}, y:${y !== null ? y.toFixed(5) : 'null'}, z:${z.toFixed(2)} obs: x:${obs.x.toFixed(2)}, z:${obs.z.toFixed(2)}, rot:${(obs.rotation||0).toFixed(2)}, base:${obstacleBase.toFixed(2)}, height:${obstacleHeight.toFixed(2)}, top:${obstacleTop.toFixed(5)}, y-top:${y !== null ? (y-obstacleTop).toFixed(5) : 'null'}`);
        return obs;
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

    if (!checkCollision(x, z, tankRadius)) {
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
  let collision = checkCollision(newX, newZ, 2, player.y);
  if (collision && collision.type === 'boundary') {
    // Try sliding along X axis only
    let slideX = checkCollision(newX, player.z, 2, player.y);
    if (!slideX) {
      // Allow movement along X only
      newZ = player.z;
      collision = null;
    } else {
      // Try sliding along Z axis only
      let slideZ = checkCollision(player.x, newZ, 2, player.y);
      if (!slideZ) {
        // Allow movement along Z only
        newX = player.x;
        collision = null;
      }
    }
    if (collision && collision.type === 'boundary') {
      log(`Player "${player.name}" collided with map boundary x:${player.x.toFixed(2)}, y:${player.y.toFixed(2)}, z:${player.z.toFixed(2)}`);
      return false;
    }
  }
  if (collision) {
    if (collision === true) {
      // Should not happen, but fallback
      log(`Player "${player.name}" collided with unknown object x:${player.x.toFixed(2)}, y:${player.y.toFixed(2)}, z:${player.z.toFixed(2)}`);
    } else {
      // Log obstacle details
      const { x, z, w, d, h, baseY, rotation } = collision;
      log(`Player "${player.name}" collided with obstacle x:${x.toFixed(2)}, z:${z.toFixed(2)}, w:${w.toFixed(2)}, d:${d.toFixed(2)}, h:${h.toFixed(2)}, baseY:${baseY.toFixed(2)}, rotation:${rotation.toFixed(2)} (player x:${player.x.toFixed(2)}, y:${player.y.toFixed(2)}, z:${player.z.toFixed(2) })`);
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
  log(`Player ${player.playerNumber} user agent: ${userAgent}`);

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
  }));

  // Handle messages
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);

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
          console.log('chat:', message, toName, targetId, players.get(targetId));
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

          // broadcast join to all
          broadcastAll({
            type: 'playerJoined',
            player: player.getState(),
          }, ws);
          break;

        case 'changeName':
          let newName = nameCheck(message.name, player.id);
          if (newName !== player.name) {
            const oldName = player.name;
            player.name = newName;
            log(`Player name changed: "${oldName}" -> "${newName}"`);
            broadcastAll({
              type: 'nameChanged',
              playerId: player.id,
              name: player.name,
            });
          }
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
      }
    } catch (err) {
      logError('Error handling message:', err);
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
const filesToWatch = [
  path.join(__dirname, 'public', 'game.js'),
  path.join(__dirname, 'public', 'index.html'),
  path.join(__dirname, 'public', 'styles.css'),
  path.join(__dirname, 'server.js'),
];

console.log('Watching files for changes...');
filesToWatch.forEach(file => {
  if (fs.existsSync(file)) {
    fs.watch(file, (eventType, filename) => {
      if (eventType === 'change') {
        console.log(`\n📝 File changed: ${filename || file}`);
        console.log('🔄 Reloading all clients...\n');
        forceClientReload();

        // If server.js changed, restart the server
        if (file.endsWith('server.js')) {
          console.log('🔄 Restarting server...\n');
          setTimeout(() => {
            process.exit(0);
          }, 1000);
        }
      }
    });
    console.log(`  ✓ Watching: ${path.basename(file)}`);
  }
});
