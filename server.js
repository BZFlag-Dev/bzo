// Helper to send the map list and current map to a given websocket
function sendMapList(ws) {
  fs.readdir(path.join(__dirname, 'maps'), (err, files) => {
    let maps = [];
    if (!err && files) {
      maps = files.filter(f => f.endsWith('.bzw'));
      maps = ['random', ...maps];
    }
    ws.send(JSON.stringify({
      type: 'mapList',
      maps,
      currentMap: MAP_SOURCE
    }));
  });
}
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
  const now = new Date();
  const timestamp = now.toISOString();
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  const logMsg = `[${timestamp}] ${msg}`;
  // Write to console
  console.log(logMsg);
  // Append to server.log
  fs.appendFileSync(path.join(__dirname, 'server.log'), logMsg + '\n');
}

function logError(...args) {
  const now = new Date();
  const timestamp = now.toISOString();
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  const logMsg = `[${timestamp}] [ERROR] ${msg}`;
  console.error(logMsg);
  fs.appendFileSync(path.join(__dirname, 'server.log'), logMsg + '\n');
}

const app = express();
const bodyParser = require('body-parser');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static('public'));

function getAvailableTankModels() {
  const objDir = path.join(__dirname, 'public', 'obj');
  try {
    return fs.readdirSync(objDir)
      .filter((fileName) => fileName.toLowerCase().endsWith('.obj'))
      .map((fileName) => {
        const id = fileName.slice(0, -4).toLowerCase();
        const label = id
          .split(/[-_\s]+/)
          .filter(Boolean)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' ');
        return {
          id,
          path: `/obj/${fileName}`,
          label: label || id,
        };
      })
      .sort((left, right) => left.id.localeCompare(right.id));
  } catch (error) {
    logError('Failed to list tank models:', error.message || error);
    return [];
  }
}

function isAllowedTankModel(modelId) {
  if (typeof modelId !== 'string') return false;
  const normalized = modelId.trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(normalized)) return false;
  return getAvailableTankModels().some((model) => model.id === normalized);
}

app.get('/api/tank-models', (req, res) => {
  res.json({ models: getAvailableTankModels() });
});
// --- Admin API Endpoints ---

const server = app.listen(PORT, '::', () => {
  log(`Server running on http://[::]:${PORT}`);
});

// WebSocket server
const wss = new WebSocketServer({ server });

// Game constants
const GAME_CONFIG = {
  MAP_SIZE: 400,
  TANK_SPEED: 12.5, // BZ-like default at this world scale (units per second)
  TANK_ROTATION_SPEED: 1.57, // BZ-like default at this world scale (radians per second)
  SHOT_SPEED: 50, // BZ-like default at this world scale (units per second)
  SHOT_COOLDOWN: 1000, // ms
  SHOT_DISTANCE: 175, // Derived from default shot duration (3.5s) at SHOT_SPEED
  MAX_SPEED_TOLERANCE: 1.5, // Allow 50% tolerance for latency
  SHOT_POSITION_TOLERANCE: 2, // Max distance shot can be from claimed position
  PAUSE_COUNTDOWN: 2000, // ms
  JUMP_VELOCITY: 22, // HiX-reachable jump baseline with current gravity
  GRAVITY: 30, // Gravity acceleration (units per second squared)
  JUMP_COOLDOWN: 500, // ms between jumps
};

// WebSocket keep-alive configuration
const WS_PING_INTERVAL = 30000; // Send ping every 30 seconds
const WS_PONG_TIMEOUT = 60000; // Close connection if no pong after 60 seconds

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

// Anti-cheat configuration
const ANTICHEAT_CONFIG = {
  mode: serverConfig.antiCheat?.mode || 'strict', // 'strict', 'warning', or 'disabled'
  linearDriftThreshold: serverConfig.antiCheat?.linearDriftThreshold || 3.0,
  linearDriftThresholdVelocityChanged: serverConfig.antiCheat?.linearDriftThresholdVelocityChanged || 20.0,
  angularDriftThreshold: serverConfig.antiCheat?.angularDriftThreshold || 0.5,
};

// Optional gameplay overrides from server-config.json
const configTankSpeed = Number(serverConfig.tankSpeed);
if (Number.isFinite(configTankSpeed) && configTankSpeed > 0) {
  GAME_CONFIG.TANK_SPEED = configTankSpeed;
}

const configTankRotationSpeed = Number(serverConfig.tankRotationSpeed);
if (Number.isFinite(configTankRotationSpeed) && configTankRotationSpeed > 0) {
  GAME_CONFIG.TANK_ROTATION_SPEED = configTankRotationSpeed;
}

const configJumpVelocity = Number(serverConfig.jumpVelocity);
if (Number.isFinite(configJumpVelocity) && configJumpVelocity >= 0) {
  GAME_CONFIG.JUMP_VELOCITY = configJumpVelocity;
}

const configShotSpeed = Number(serverConfig.shotSpeed);
if (Number.isFinite(configShotSpeed) && configShotSpeed > 0) {
  GAME_CONFIG.SHOT_SPEED = configShotSpeed;
}

const configShotDuration = Number(serverConfig.shotDuration);
if (Number.isFinite(configShotDuration) && configShotDuration > 0) {
  GAME_CONFIG.SHOT_DISTANCE = GAME_CONFIG.SHOT_SPEED * configShotDuration;
}

const configShotDistance = Number(serverConfig.shotDistance);
if (Number.isFinite(configShotDistance) && configShotDistance > 0) {
  GAME_CONFIG.SHOT_DISTANCE = configShotDistance;
}

log(`Anti-cheat mode: ${ANTICHEAT_CONFIG.mode}`);
log(
  `Gameplay config: tankSpeed=${GAME_CONFIG.TANK_SPEED}, tankRotationSpeed=${GAME_CONFIG.TANK_ROTATION_SPEED}, jumpVelocity=${GAME_CONFIG.JUMP_VELOCITY}, shotSpeed=${GAME_CONFIG.SHOT_SPEED}, shotDistance=${GAME_CONFIG.SHOT_DISTANCE}, shotDuration≈${(GAME_CONFIG.SHOT_DISTANCE / GAME_CONFIG.SHOT_SPEED).toFixed(2)}s`
);
if (MAP_SOURCE !== 'random') {
  mapPath = path.join(__dirname, 'maps', MAP_SOURCE);
  if (!fs.existsSync(mapPath)) {
    logError(`Map file not found: ${mapPath}. Reverting to random map.`);
    MAP_SOURCE = 'random';
  } else {
    // Watch the map file for changes and restart the server if it changes
    try {
      fs.watch(mapPath, (eventType, filename) => {
        if (eventType === 'change' || eventType === 'rename') {
          console.log(`\n📝 Map file changed: ${filename || mapPath}`);
          console.log('🔄 Restarting server due to map file change...\n');
          requestServerRestart('map file change');
        }
      });
      // console.log(`  ✓ Watching map file: ${path.basename(mapPath)}`);
    } catch (err) {
      logError(`Failed to watch map file: ${mapPath}`, err);
    }
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
    } else if (current && line.startsWith('name')) {
      // name <string>
      const [, ...nameParts] = line.split(/\s+/);
      const name = nameParts.join(' ').replace(/"/g, '').trim();
      if (name) current.name = name;
    } else if (current && line.startsWith('position')) {
      // position x y z (scale x and y by 0.5)
      const [, x, y, z] = line.split(/\s+/);
      current.x = parseFloat(x) * 0.5;
      current.z = parseFloat(y) * 0.5; // BZFlag Y -> our Z
      current.baseY = (parseFloat(z) || 0) * 0.5;
    } else if (current && line.startsWith('size')) {
      // size w d h (BZFlag counts center to edge so this effectively scales by 0.5)
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
      // Use BZW name if present, otherwise assign a generated name
      if (!current.name) {
        current.name = `${current.type[0].toUpperCase()}${obstacles.length}`;
      }
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
log(OBSTACLES);

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

// Game state
const players = new Map();
const projectiles = new Map();
let projectileIdCounter = 0;
// Minecraft-style world time (0-23999, 20 min per day, 20 ticks/sec)
let worldTime = Math.floor(Math.random() * 24000); // randomize start

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
    // Spread new tank colors away from currently connected players.
    this.color = Player.pickDistinctColor();
    this.tankModel = 'default';

    // Extrapolation state
    this.forwardSpeed = 0;
    this.rotationSpeed = 0;
    this.jumpDirection = null;
    this.slideDirection = undefined;
    this.airVelocityX = 0;
    this.airVelocityZ = 0;

    // Keep-alive tracking
    this.lastPongTime = Date.now();
    this.isAlive = true;

    // Anti-cheat tracking
    this.cheatWarnings = {
      linearDrift: 0,
      angularDrift: 0,
      totalWarnings: 0,
      lastWarningTime: 0,
    };
  }

  static colorIntToRgb(color) {
    return {
      r: (color >> 16) & 0xff,
      g: (color >> 8) & 0xff,
      b: color & 0xff
    };
  }

  static hslToRgb(h, s, l) {
    s /= 100;
    l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(Math.min(k(n) - 3, 9 - k(n)), 1));
    return {
      r: Math.round(255 * f(0)),
      g: Math.round(255 * f(8)),
      b: Math.round(255 * f(4))
    };
  }

  static rgbToColorInt({ r, g, b }) {
    return (r << 16) | (g << 8) | b;
  }

  static rgbToHsl(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const light = (max + min) / 2;
    const delta = max - min;

    if (delta === 0) {
      return { hue: 0, sat: 0, light: light * 100 };
    }

    const sat = delta / (1 - Math.abs(2 * light - 1));
    let hue;
    switch (max) {
      case rn:
        hue = 60 * (((gn - bn) / delta) % 6);
        break;
      case gn:
        hue = 60 * ((bn - rn) / delta + 2);
        break;
      default:
        hue = 60 * ((rn - gn) / delta + 4);
        break;
    }
    if (hue < 0) hue += 360;
    return { hue, sat: sat * 100, light: light * 100 };
  }

  static hueDistance(a, b) {
    const diff = Math.abs(a - b) % 360;
    return Math.min(diff, 360 - diff);
  }

  static scoreCandidateColor(candidate, existingColors) {
    if (existingColors.length === 0) {
      return Number.POSITIVE_INFINITY;
    }

    let minScore = Number.POSITIVE_INFINITY;
    for (const existing of existingColors) {
      const dr = candidate.rgb.r - existing.rgb.r;
      const dg = candidate.rgb.g - existing.rgb.g;
      const db = candidate.rgb.b - existing.rgb.b;
      const rgbDistanceSq = dr * dr + dg * dg + db * db;
      const hueDistance = Player.hueDistance(candidate.hue, existing.hue);
      const satDistance = Math.abs(candidate.sat - existing.sat);
      const lightDistance = Math.abs(candidate.light - existing.light);
      const separationScore = rgbDistanceSq + hueDistance * 64 + satDistance * 12 + lightDistance * 10;
      if (separationScore < minScore) {
        minScore = separationScore;
      }
    }
    return minScore;
  }

  // Pick a pastel-ish color that is as far as practical from current players.
  static pickDistinctColor() {
    const existingColors = Array.from(players.values())
      .map((player) => player.color)
      .filter((color) => Number.isFinite(color))
      .map((color) => {
        const rgb = Player.colorIntToRgb(color);
        const hsl = Player.rgbToHsl(rgb.r, rgb.g, rgb.b);
        return {
          rgb,
          hue: hsl.hue,
          sat: hsl.sat,
          light: hsl.light
        };
      });

    const saturationOptions = [58, 66, 74];
    const lightnessOptions = [58, 64, 70];
    const hueStep = 12;
    const scoredCandidates = [];
    let bestScore = -1;

    for (let hue = 0; hue < 360; hue += hueStep) {
      for (const sat of saturationOptions) {
        for (const light of lightnessOptions) {
          const rgb = Player.hslToRgb(hue, sat, light);
          const candidate = { hue, sat, light, rgb };
          const score = Player.scoreCandidateColor(candidate, existingColors);
          scoredCandidates.push({ candidate, score });
          if (score > bestScore) {
            bestScore = score;
          }
        }
      }
    }

    if (scoredCandidates.length === 0) {
      const fallbackRgb = Player.hslToRgb(Math.floor(Math.random() * 360), 66, 64);
      return Player.rgbToColorInt(fallbackRgb);
    }

    const scoreThreshold = bestScore * 0.72;
    const topCandidates = scoredCandidates
      .filter(({ score }) => score >= scoreThreshold)
      .sort((left, right) => right.score - left.score)
      .slice(0, 28);
    const chosen = topCandidates[Math.floor(Math.random() * topCandidates.length)] || scoredCandidates[0];
    return Player.rgbToColorInt(chosen.candidate.rgb);
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
    this.jumpDirection = null;
    this.slideDirection = undefined;
    this.forwardSpeed = 0;
    this.rotationSpeed = 0;
    this.airVelocityX = 0;
    this.airVelocityZ = 0;
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
      forwardSpeed: this.forwardSpeed,
      rotationSpeed: this.rotationSpeed,
      verticalVelocity: this.verticalVelocity,
      jumpDirection: this.jumpDirection,
      slideDirection: this.slideDirection,
      airVelocityX: this.airVelocityX,
      airVelocityZ: this.airVelocityZ,
      connectDate: this.connectDate ? this.connectDate.toISOString() : undefined,
      color: this.color,
      tankModel: this.tankModel,
    };
  }

  /**
   * Get extrapolated position at a specific time based on last known state.
   * @param {number} atTime - Timestamp (ms) to extrapolate to
   * @returns {{x: number, y: number, z: number, r: number}}
   */
  getExtrapolatedPosition(atTime) {
    const dt = (atTime - this.lastUpdate) / 1000; // Convert to seconds
    if (dt <= 0) return { x: this.x, y: this.y, z: this.z, r: this.rotation };

    // Apply rotation
    const rotSpeed = GAME_CONFIG.TANK_ROTATION_SPEED || 1.5;
    const newR = this.rotation + this.rotationSpeed * rotSpeed * dt;

    // Determine if player is in air based on jumpDirection
    const isInAir = this.jumpDirection !== null && this.jumpDirection !== undefined;

    if (isInAir) {
      const hasAirVelocity = Number.isFinite(this.airVelocityX) && Number.isFinite(this.airVelocityZ);
      const speed = GAME_CONFIG.TANK_SPEED || 15;
      const moveDirection = this.slideDirection !== undefined ? this.slideDirection : this.jumpDirection;
      const dx = hasAirVelocity ? this.airVelocityX * dt : -Math.sin(moveDirection) * this.forwardSpeed * speed * dt;
      const dz = hasAirVelocity ? this.airVelocityZ * dt : -Math.cos(moveDirection) * this.forwardSpeed * speed * dt;

      // Apply gravity to vertical velocity
      const gravity = GAME_CONFIG.GRAVITY || 9.8;
      const vv = this.verticalVelocity - gravity * dt;
      const dy = (this.verticalVelocity + vv) / 2 * dt; // Average velocity over dt

      return {
        x: this.x + dx,
        y: Math.max(0, this.y + dy), // Don't go below ground
        z: this.z + dz,
        r: newR
      };
    }

    // On ground: check for circular vs straight motion
    const speed = GAME_CONFIG.TANK_SPEED || 15;
    const rs = this.rotationSpeed || 0;
    const fs = this.forwardSpeed || 0;

    // Use slide direction if present, otherwise use rotation
    const moveDirection = this.slideDirection !== undefined ? this.slideDirection : this.rotation;

    if (Math.abs(rs) < 0.001) {
      // Straight line motion (or sliding)
      const dx = -Math.sin(moveDirection) * fs * speed * dt;
      const dz = -Math.cos(moveDirection) * fs * speed * dt;
      return { x: this.x + dx, y: this.y, z: this.z + dz, r: newR };
    } else {
      // Circular arc motion
      // Radius of curvature: R = |linear_velocity / angular_velocity|
      const R = Math.abs((fs * speed) / (rs * rotSpeed));

      // Arc angle traveled
      const theta = rs * rotSpeed * dt;

      // Center of circle in world space
      // Forward is (-sin(r), -cos(r)), perpendicular at r - π/2
      const perpAngle = this.rotation - Math.PI / 2;
      const centerSign = -(rs * fs); // Negated to match correct circular motion
      const cx = this.x + Math.sign(centerSign) * R * (-Math.sin(perpAngle));
      const cz = this.z + Math.sign(centerSign) * R * (-Math.cos(perpAngle));

      // New position rotated around center
      // Negate theta for clockwise rotation (rs > 0 means turn right = clockwise)
      const dx = this.x - cx;
      const dz = this.z - cz;
      const cosTheta = Math.cos(-theta);
      const sinTheta = Math.sin(-theta);
      const newDx = dx * cosTheta - dz * sinTheta;
      const newDz = dx * sinTheta + dz * cosTheta;

      return {
        x: cx + newDx,
        y: this.y,
        z: cz + newDz,
        r: this.rotation + theta
      };
    }
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

function getColliderLocalPoint(x, z, obs) {
  const rotation = obs.rotation || 0;
  const dx = x - obs.x;
  const dz = z - obs.z;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: dx * cos - dz * sin,
    z: dx * sin + dz * cos
  };
}

function getBoxCollisionDistanceSquared(localX, localZ, halfW, halfD) {
  const closestX = Math.max(-halfW, Math.min(localX, halfW));
  const closestZ = Math.max(-halfD, Math.min(localZ, halfD));
  const distX = localX - closestX;
  const distZ = localZ - closestZ;
  return distX * distX + distZ * distZ;
}

function getWorldBorderColliders() {
  const halfMap = GAME_CONFIG.MAP_SIZE / 2;
  const thickness = 4;
  const span = GAME_CONFIG.MAP_SIZE + thickness * 2;
  return [
    { type: 'box', name: 'boundary_north', collisionKind: 'boundary', infiniteHeight: true, x: 0, z: -halfMap - thickness / 2, w: span, d: thickness, h: 0, baseY: 0, rotation: 0 },
    { type: 'box', name: 'boundary_south', collisionKind: 'boundary', infiniteHeight: true, x: 0, z: halfMap + thickness / 2, w: span, d: thickness, h: 0, baseY: 0, rotation: 0 },
    { type: 'box', name: 'boundary_east', collisionKind: 'boundary', infiniteHeight: true, x: halfMap + thickness / 2, z: 0, w: thickness, d: span, h: 0, baseY: 0, rotation: 0 },
    { type: 'box', name: 'boundary_west', collisionKind: 'boundary', infiniteHeight: true, x: -halfMap - thickness / 2, z: 0, w: thickness, d: span, h: 0, baseY: 0, rotation: 0 }
  ];
}

function getCollisionColliders() {
  return [...OBSTACLES, ...getWorldBorderColliders()];
}

function checkCollision(x, y, z, tankRadius = 2) {
  for (const obs of getCollisionColliders()) {
    const obstacleHeight = obs.h || 4;
    const obstacleBase = obs.baseY || 0;
    const obstacleTop = obstacleBase + obstacleHeight;
    const epsilon = 0.15;
    // Scale height based on radius (tanks are 2 units tall, projectiles much smaller)
    const tankHeight = tankRadius; // For tanks (radius=2), height=2; for projectiles (radius=0.1), height=0.1
    // Only check if tank top is below obstacle top and tank base is above obstacle base
    const tankTop = y + tankHeight;
    if (!obs.infiniteHeight) {
      if (tankTop <= obstacleBase + epsilon) continue;
      if (y >= obstacleTop - epsilon) continue;
    }

    const halfW = obs.w / 2;
    const halfD = obs.d / 2;
    const { x: localX, z: localZ } = getColliderLocalPoint(x, z, obs);

    if (obs.type === 'box' || !obs.type) {
      const distSquared = getBoxCollisionDistanceSquared(localX, localZ, halfW, halfD);
      if (distSquared < tankRadius * tankRadius) {
        log(`[COLLISION] ${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)} ${obs.name}:${obs.type} ${obs.x.toFixed(2)},${obstacleBase.toFixed(2)},${obs.z.toFixed(2)} rot:${(obs.rotation || 0).toFixed(2)}, h:${obstacleHeight.toFixed(2)}, top:${obstacleTop.toFixed(2)}`);
        return obs;
      }
    } else if (obs.type === 'pyramid') {
      // Pyramid collision: check if tank top is under the sloped surface
      // Sample points around the tank's top circle (8 directions + center)
      const sampleCount = 8;
      const localY_top = tankTop - obstacleBase;
      let collided = false;
      for (let i = 0; i < sampleCount; i++) {
        const angle = (Math.PI * 2 * i) / sampleCount;
        const offsetX = Math.cos(angle) * tankRadius;
        const offsetZ = Math.sin(angle) * tankRadius;
        const sx = localX + offsetX;
        const sz = localZ + offsetZ;
        if (Math.abs(sx) <= halfW && Math.abs(sz) <= halfD) {
          const nx = Math.abs(sx) / halfW;
          const nz = Math.abs(sz) / halfD;
          const n = Math.max(nx, nz);
          const maxPyramidY = obs.h * (1 - n);
          if (localY_top >= epsilon && localY_top < maxPyramidY - epsilon) {
            collided = true;
            break;
          }
        }
      }
      // Also check the center point for completeness
      if (!collided && Math.abs(localX) <= halfW && Math.abs(localZ) <= halfD) {
        const nx = Math.abs(localX) / halfW;
        const nz = Math.abs(localZ) / halfD;
        const n = Math.max(nx, nz);
        const maxPyramidY = obs.h * (1 - n);
        if (localY_top >= epsilon && localY_top < maxPyramidY - epsilon) {
          collided = true;
        }
      }
      if (collided) {
        log(`[COLLISION] ${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)} ${obs.name}:${obs.type} ${obs.x.toFixed(2)},${obstacleBase.toFixed(2)},${obs.z.toFixed(2)} rot:${(obs.rotation || 0).toFixed(2)}, h:${obstacleHeight.toFixed(2)}, top:${obstacleTop.toFixed(2)}`);
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

    if (!checkCollision(x, y, z, tankRadius)) {
      return { x, y, z, rotation };
    }
  }

  // If we couldn't find a valid position after many attempts, return a safe default
  return { x: 0, y: 0, z: 0, rotation: 0 };
}

// Validate player movement
function validateMovement(player, newX, newY, newZ, newRotation, deltaTime, velocityChanged = false) {
  // Can't move while paused
  if (player.paused) {
    return false;
  }

  // If anti-cheat is disabled, allow all movement (but still check collisions below)
  if (ANTICHEAT_CONFIG.mode === 'disabled') {
    // Skip to collision checks
  } else {
    // Get extrapolated position based on last known velocities
    const now = Date.now();
    const timeSinceLastUpdate = (now - player.lastUpdate) / 1000;
    const extrapolated = player.getExtrapolatedPosition(now);

    // Compare to extrapolated position, not last stored position
    // With velocity-based dead reckoning, the client position should match extrapolated position
    // We allow a tolerance based on physics drift, network jitter, and rounding errors
    // If velocity changed, use much looser validation since extrapolation doesn't account for it
    const distMoved = distance(extrapolated.x, extrapolated.z, newX, newZ);
    const maxDrift = velocityChanged ? ANTICHEAT_CONFIG.linearDriftThresholdVelocityChanged : ANTICHEAT_CONFIG.linearDriftThreshold;

    if (distMoved > maxDrift) {
      const exceedAmount = distMoved - maxDrift;
      const likelihood = Math.min(100, (exceedAmount / maxDrift) * 100).toFixed(1);

      player.cheatWarnings.linearDrift++;
      player.cheatWarnings.totalWarnings++;
      player.cheatWarnings.lastWarningTime = now;

      log(`[ANTICHEAT:${ANTICHEAT_CONFIG.mode.toUpperCase()}] Player "${player.name}" LINEAR DRIFT: ${distMoved.toFixed(2)} > ${maxDrift.toFixed(2)} (+${exceedAmount.toFixed(2)}) | Likelihood: ${likelihood}% | Warnings: ${player.cheatWarnings.totalWarnings}`);
      log(`  Stored: (${player.x.toFixed(2)}, ${player.y.toFixed(2)}, ${player.z.toFixed(2)}, r=${player.rotation.toFixed(2)})`);
      log(`  Extrap: (${extrapolated.x.toFixed(2)}, ${extrapolated.y.toFixed(2)}, ${extrapolated.z.toFixed(2)}, r=${extrapolated.r.toFixed(2)})`);
      log(`  Recvd:  (${newX.toFixed(2)}, ${newY.toFixed(2)}, ${newZ.toFixed(2)}, r=${newRotation.toFixed(2)})`);
      log(`  Vels: fs=${player.forwardSpeed.toFixed(2)}, rs=${player.rotationSpeed.toFixed(2)}, vv=${player.verticalVelocity.toFixed(2)}, dt=${timeSinceLastUpdate.toFixed(2)}s, velChanged=${velocityChanged}`);

      if (ANTICHEAT_CONFIG.mode === 'strict') {
        return false;
      }
      // In warning mode, continue with validation
    }

    // Calculate rotation change from extrapolated rotation
    const rotDiff = Math.abs(normalizeAngle(newRotation - extrapolated.r));
    const maxRotDrift = ANTICHEAT_CONFIG.angularDriftThreshold;

    if (rotDiff > maxRotDrift) {
      const exceedAmount = rotDiff - maxRotDrift;
      const likelihood = Math.min(100, (exceedAmount / maxRotDrift) * 100).toFixed(1);

      player.cheatWarnings.angularDrift++;
      player.cheatWarnings.totalWarnings++;
      player.cheatWarnings.lastWarningTime = now;

      log(`[ANTICHEAT:${ANTICHEAT_CONFIG.mode.toUpperCase()}] Player "${player.name}" ANGULAR DRIFT: ${rotDiff.toFixed(2)} > ${maxRotDrift.toFixed(2)} (+${exceedAmount.toFixed(2)}) | Likelihood: ${likelihood}% | Warnings: ${player.cheatWarnings.totalWarnings}`);
      log(`  stored: ${player.rotation.toFixed(2)}, extrapolated: ${extrapolated.r.toFixed(2)}, received: ${newRotation.toFixed(2)}, rs=${player.rotationSpeed.toFixed(2)}, dt=${timeSinceLastUpdate.toFixed(2)}s`);

      if (ANTICHEAT_CONFIG.mode === 'strict') {
        return false;
      }
      // In warning mode, continue with validation
    }
  }

  // Check collision against the unified collider set (map objects + border colliders).
  let collision = checkCollision(newX, newY, newZ, 2);
  if (collision) {
    if (collision === true) {
      // Should not happen, but fallback
      if (ANTICHEAT_CONFIG.mode === 'warning') {
        log(`[ANTICHEAT:WARNING] Player "${player.name}" collided with unknown object but movement accepted in warning mode x:${player.x.toFixed(2)}, y:${player.y.toFixed(2)}, z:${player.z.toFixed(2)}`);
      } else {
        log(`Player "${player.name}" collided with unknown object x:${player.x.toFixed(2)}, y:${player.y.toFixed(2)}, z:${player.z.toFixed(2)}`);
        return false;
      }
    } else if (collision.collisionKind === 'boundary') {
      if (ANTICHEAT_CONFIG.mode === 'warning') {
        log(`[ANTICHEAT:WARNING] Player "${player.name}" collided boundary but movement accepted in warning mode x:${player.x.toFixed(2)}, y:${player.y.toFixed(2)}, z:${player.z.toFixed(2)}`);
      } else {
        log(`Player "${player.name}" collided boundary x:${player.x.toFixed(2)}, y:${player.y.toFixed(2)}, z:${player.z.toFixed(2)}`);
        return false;
      }
    } else {
      // Log obstacle details
      const { x, z, w, d, h, baseY, rotation } = collision;
      if (ANTICHEAT_CONFIG.mode === 'warning') {
        log(`[ANTICHEAT:WARNING] Player "${player.name}" collided obs:${collision.name} ${x.toFixed(2)},${baseY.toFixed(2)},${z.toFixed(2)}, w:${w.toFixed(2)}, d:${d.toFixed(2)}, h:${h.toFixed(2)}, rot:${rotation.toFixed(2)} but movement accepted in warning mode (p ${player.x.toFixed(2)},${player.y.toFixed(2)},${player.z.toFixed(2) })`);
      } else {
        log(`Player "${player.name}" collided obs:${collision.name} ${x.toFixed(2)},${baseY.toFixed(2)},${z.toFixed(2)}, w:${w.toFixed(2)}, d:${d.toFixed(2)}, h:${h.toFixed(2)}, rot:${rotation.toFixed(2)} (p ${player.x.toFixed(2)},${player.y.toFixed(2)},${player.z.toFixed(2) })`);
        return false;
      }
    }
  }

  return true;
}

// Validate shot
function validateShot(player, shotX, shotY, shotZ) {
  // Shot originates from barrel end, which is ~3 units from tank center
  const barrelLength = 3.0;
  const now = Date.now();

  // Use extrapolated position, not stored position
  const extrapolated = player.getExtrapolatedPosition(now);
  const dist = distance(extrapolated.x, extrapolated.z, shotX, shotZ);

  if (dist > barrelLength + GAME_CONFIG.SHOT_POSITION_TOLERANCE) {
    log(`Player "${player.name}" shot from invalid position: ${dist.toFixed(2)} units away (extrapolated: ${extrapolated.x.toFixed(2)}, ${extrapolated.z.toFixed(2)}, shot: ${shotX.toFixed(2)}, ${shotZ.toFixed(2)})`);
    return false;
  }

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

// Game loop - update projectiles and check collisions
function gameLoop() {

  // Advance world time (20 ticks/sec, 24000 ticks/day)
  worldTime = (worldTime + 1) % 24000;
  const now = Date.now();
  // No need to broadcast worldTime periodically; clients track it locally at 20 ticks/sec.

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
      log(`Projectile ${id} removed (out of bounds ${distTraveled} or expired)`);
      return;
    }

    // Check collision with obstacles using checkCollision() with small projectile radius
    const projectileRadius = 0.1;
    const obstacleHit = checkCollision(proj.x, proj.y, proj.z, projectileRadius);
    if (obstacleHit) {
      if (obstacleHit.collisionKind === 'boundary') {
        log(`Projectile ${id} hit boundary at (${proj.x.toFixed(2)}, ${proj.y.toFixed(2)}, ${proj.z.toFixed(2)})`);
      } else {
        log(`Projectile ${id} hit obstacle "${obstacleHit.name || 'unnamed'}" at (${proj.x.toFixed(2)}, ${proj.y.toFixed(2)}, ${proj.z.toFixed(2)})`);
      }
      projectiles.delete(id);
      broadcastAll({ type: 'projectileRemoved', id });
      return;
    }

    // Check collision with players using extrapolated positions
    players.forEach((player) => {
      if (player.id === proj.playerId) return; // Can't hit yourself
      if (player.paused) return; // Can't hit paused players
      if (player.health <= 0) return; // Can't hit dead players

      // Use extrapolated position for accurate hit detection
      const extrapolated = player.getExtrapolatedPosition(now);

      // Check horizontal distance
      const dist = distance(proj.x, proj.z, extrapolated.x, extrapolated.z);
      if (dist < 2) { // Tank hitbox radius
        // Check vertical collision - tank is roughly 2 units tall
        const tankHeight = 2;
        const playerBottom = extrapolated.y;
        const playerTop = extrapolated.y + tankHeight;

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
          }, 5000);
        }
      }
    });
  });
}

setInterval(gameLoop, 16); // ~60fps

// WebSocket keep-alive: periodically ping all clients and close dead connections
setInterval(() => {
  const now = Date.now();
  players.forEach((player) => {
    if (player.ws.readyState === 1) { // OPEN
      // Check if connection is dead (no pong response)
      if (now - player.lastPongTime > WS_PONG_TIMEOUT) {
        log(`Player "${player.name}" connection timeout (no pong for ${Math.floor((now - player.lastPongTime) / 1000)}s)`);
        player.ws.terminate();
        return;
      }

      // Mark as potentially dead and send ping
      player.isAlive = false;
      player.ws.ping();
    }
  });
}, WS_PING_INTERVAL);

// Anti-cheat monitoring: periodic summary report (every 5 minutes)
if (ANTICHEAT_CONFIG.mode !== 'disabled') {
  setInterval(() => {
    const playersWithWarnings = Array.from(players.values())
      .filter(p => p.cheatWarnings.totalWarnings > 0)
      .sort((a, b) => b.cheatWarnings.totalWarnings - a.cheatWarnings.totalWarnings);

    if (playersWithWarnings.length > 0) {
      log(`[ANTICHEAT SUMMARY] ${playersWithWarnings.length} player(s) with warnings:`);
      playersWithWarnings.forEach(p => {
        const timeSinceWarning = Math.floor((Date.now() - p.cheatWarnings.lastWarningTime) / 1000);
        log(`  "${p.name}": ${p.cheatWarnings.totalWarnings} total (${p.cheatWarnings.linearDrift} linear, ${p.cheatWarnings.angularDrift} angular) - last ${timeSinceWarning}s ago`);
      });
    }
  }, 300000); // 5 minutes
}

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

function requestServerRestart(reason) {
  log(`Restart requested: ${reason}`);
  forceClientReload();
  // Touch server.js to update its timestamp and trigger nodemon file watcher
  // This causes nodemon to detect the "change" and restart immediately
  // without the "waiting for changes" message
  setTimeout(() => {
    try {
      const now = new Date();
      fs.utimesSync(__filename, now, now);
      log('Triggered nodemon restart via timestamp touch...');
    } catch (err) {
      logError('Failed to trigger restart:', err);
      process.exit(0);
    }
  }, 1000);
}

// WebSocket connection handler
// When a new player connects, assign a default name and number
wss.on('connection', (ws, req) => {

  let player = new Player(ws);
  players.set(player.id, player);

  // Set player as not yet joined (health = 0)
  player.health = 0;

  // Handle pong responses for keep-alive
  ws.on('pong', () => {
    player.lastPongTime = Date.now();
    player.isAlive = true;
  });

  // Notify all existing players (except the new one) about the new player (so they add to scoreboard/world, invisible)
  broadcast({
    type: 'playerJoined',
    player: player.getState(),
  }, ws);

  // Get client IP and port
  const forwardedFor = req.headers['x-forwarded-for'];
  const forwardedPort = req.headers['x-forwarded-port'];
  const clientIP = forwardedFor ? forwardedFor.split(',')[0].trim() : req.socket.remoteAddress;
  const clientPort = forwardedPort ? forwardedPort : req.socket.remotePort;
  const ipDisplay = forwardedFor ? `${clientIP} (via ${req.socket.remoteAddress})` : clientIP;
  if (forwardedFor && forwardedPort) {
    log(`Player ${player.playerNumber} connect from ${ipDisplay}:${clientPort} (x-forwarded-for + x-forwarded-port)`);
  } else if (forwardedFor) {
    log(`Player ${player.playerNumber} connect from ${ipDisplay}:${clientPort} (x-forwarded-for)`);
  } else {
    log(`Player ${player.playerNumber} connect from ${ipDisplay}:${clientPort}`);
  }
  //log(`Player ${player.playerNumber} user agent: ${userAgent}`);

  // Send initial server state in init message
  const clouds = generateClouds();
  ws.send(JSON.stringify({
    type: 'init',
    player: player.getState(),
    players: Array.from(players.values()).map(p => p.getState()),
    config: GAME_CONFIG,
    obstacles: OBSTACLES,
    worldTime,
    clouds: clouds,
    serverName: serverConfig.serverName || '',
    description: serverConfig.description || '',
    motd: serverConfig.motd || '',
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
        case 'debug': {
          // Log debug messages from clients
          const payloadName = typeof message.name === 'string' ? message.name.trim() : '';
          const debugFrom = payloadName || player.name || `Player ${player.playerNumber}`;
          log(`[DEBUG from ${debugFrom}] ${message.message || ''}`);
          break;
        }
        case 'm': {
          const now = Date.now();
          // Calculate deltaTime based on server's last update time
          const deltaTime = (now - player.lastUpdate) / 1000;
          // DON'T update player.lastUpdate here - it breaks extrapolation in validateMovement!

          // Only accept new compact field names
          const x = Number(message.x);
          const y = Number(message.y);
          const z = Number(message.z);
          const r = Number(message.r);
          const fs = Number(message.fs);
          const rs = Number(message.rs);
          const vv = Number(message.vv);
          const d = message.d !== undefined ? Number(message.d) : undefined; // Optional slide direction
          const vx = message.vx !== undefined ? Number(message.vx) : undefined;
          const vz = message.vz !== undefined ? Number(message.vz) : undefined;
          const hasAirVelocity = Number.isFinite(vx) && Number.isFinite(vz);

          // Track jump direction for extrapolation
          const oldVV = player.verticalVelocity || 0;
          const isJumpStart = oldVV <= 0 && vv > 10; // Transition from ground/falling to jumping
          const isLanding = player.jumpDirection !== null && vv === 0; // Transition from air to ground
          const isFallStart = player.jumpDirection === null && vv < 0; // Started falling (drove off edge)

          // Log jump/land/fall events but DON'T update jumpDirection yet - must validate first
          if (isJumpStart) {
            // Calculate expected landing position (assuming ~2 second flight)
            const jumpTime = 2.05; // Approximate jump duration
            const speed = GAME_CONFIG.TANK_SPEED || 15;
            const rotSpeed = GAME_CONFIG.TANK_ROTATION_SPEED || 1.5;
            const dx = -Math.sin(r) * fs * speed * jumpTime;
            const dz = -Math.cos(r) * fs * speed * jumpTime;
            const expectedLandX = x + dx;
            const expectedLandZ = z + dz;
            const expectedLandR = r + rs * rotSpeed * jumpTime;
            log(`[JUMP] Player "${player.name}" jumped: pos=(${x.toFixed(2)},${z.toFixed(2)}), r=${r.toFixed(2)}, fs=${fs.toFixed(2)}, rs=${rs.toFixed(2)}, vv=${vv.toFixed(2)}`);
            log(`[JUMP] Expected landing: pos=(${expectedLandX.toFixed(2)},${expectedLandZ.toFixed(2)}), r=${expectedLandR.toFixed(2)}`);
          } else if (isLanding) {
            log(`[LAND] Player "${player.name}" landed: pos=(${x.toFixed(2)},${z.toFixed(2)}), r=${r.toFixed(2)}, fs=${fs.toFixed(2)}, rs=${rs.toFixed(2)}, vv=${vv.toFixed(2)}`);
          } else if (isFallStart) {
            log(`[FALL] Player "${player.name}" started falling: pos=(${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}), r=${r.toFixed(2)}, fs=${fs.toFixed(2)}, rs=${rs.toFixed(2)}, vv=${vv.toFixed(2)}`);
          }

          // Check if velocities changed significantly - if so, use looser validation
          const fsChanged = Math.abs(fs - (player.forwardSpeed || 0)) > 0.1;
          const rsChanged = Math.abs(rs - (player.rotationSpeed || 0)) > 0.1;
          const vvChanged = Math.abs(vv - (player.verticalVelocity || 0)) > 0.5;
          const isSliding = d !== undefined; // Use loose validation whenever sliding (extrapolation may not match)
          const velocityChanged = fsChanged || rsChanged || vvChanged || isSliding;

          // Use actual deltaTime for validation since we compare to extrapolated position
          // The extrapolated position accounts for the full time interval using OLD velocities
          if (validateMovement(player, x, y, z, r, deltaTime, velocityChanged)) {
            // Validation passed - now update jumpDirection
            if (isJumpStart) {
              player.jumpDirection = r; // Store rotation at jump start
            } else if (isFallStart) {
              player.jumpDirection = r; // Store rotation at fall start (same as jump)
            } else if (isLanding) {
              player.jumpDirection = null; // Clear jump direction on landing
            }

            // Update position/rotation AND velocities for next extrapolation
            player.x = x;
            player.y = y;
            player.z = z;
            player.rotation = r;
            player.forwardSpeed = fs;
            player.rotationSpeed = rs;
            player.verticalVelocity = vv;
            player.slideDirection = d; // Store slide direction (undefined if not sliding)
            if (hasAirVelocity) {
              player.airVelocityX = vx;
              player.airVelocityZ = vz;
            } else if (player.jumpDirection !== null) {
              const speed = GAME_CONFIG.TANK_SPEED || 15;
              const moveDirection = d !== undefined ? d : player.jumpDirection;
              player.airVelocityX = -Math.sin(moveDirection) * fs * speed;
              player.airVelocityZ = -Math.cos(moveDirection) * fs * speed;
            } else {
              player.airVelocityX = 0;
              player.airVelocityZ = 0;
            }
            player.lastUpdate = now; // Update timestamp AFTER accepting the move

            const pmPacket = {
              type: 'pm',
              id: player.id,
              x,
              y,
              z,
              r,
              fs,
              rs,
              vv,
              vx: player.airVelocityX,
              vz: player.airVelocityZ,
            };

            // Include optional slide direction if present
            if (d !== undefined) {
              pmPacket.d = d;
            }

            broadcast(pmPacket, ws);
          } else {
            // Validation failed - jumpDirection unchanged (no update needed)
            // Send correction back to client
            // Reset velocities and timestamp so next extrapolation starts from corrected state
            player.forwardSpeed = 0;
            player.rotationSpeed = 0;
            player.verticalVelocity = 0;
            player.airVelocityX = 0;
            player.airVelocityZ = 0;
            player.lastUpdate = now;
            ws.send(JSON.stringify({
              type: 'positionCorrection',
              x: player.x,
              y: player.y,
              z: player.z,
              r: player.rotation,
              vv: 0,
            }));
          }
          break;
        }

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

        case 'selfDestruct': {
          if (player.health <= 0) break;
          player.health = 0;
          player.deaths++;
          log(`Player "${player.name}" self-destructed.`);

          broadcastAll({
            type: 'playerHit',
            victimId: player.id,
            shooterId: player.id,
            projectileId: null,
            suicide: true,
          });

          setTimeout(() => {
            if (players.has(player.id)) {
              player.respawn();
              broadcastAll({
                type: 'playerRespawned',
                player: player.getState(),
              });
            }
          }, 5000);
          break;
        }

        case 'joinGame': {
          let joinName = nameCheck(message.name, player.id);
          const requestedTankModel = typeof message.tankModel === 'string'
            ? message.tankModel.toLowerCase()
            : 'default';
          player.name = joinName;
          player.tankModel = isAllowedTankModel(requestedTankModel)
            ? requestedTankModel
            : 'default';
          player.health = 100;
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
        }

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
        case 'getMaps': {
          // Reply with all .bzw files in maps/ plus 'random', and indicate current map
          sendMapList(ws);
          break;
        }
        case 'setMap': {
          // Admin: set map
          const mapFile = message.mapFile;
          if (!mapFile || (mapFile !== 'random' && !mapFile.endsWith('.bzw'))) {
            ws.send(JSON.stringify({ error: 'Invalid map file' }));
            break;
          }
          if (mapFile !== 'random') {
            const mapPath = path.join(__dirname, 'maps', mapFile);
            if (!fs.existsSync(mapPath)) {
              ws.send(JSON.stringify({ error: 'Map file not found' }));
              break;
            }
          }
          try {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            config.mapFile = mapFile;
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            ws.send(JSON.stringify({ success: true }));
            log(`Admin set map to ${mapFile}. Server restart required.`);
            requestServerRestart(`admin map change to ${mapFile}`);
          } catch {
            ws.send(JSON.stringify({ error: 'Failed to update config' }));
          }
          break;
        }
        case 'uploadMap': {
          // Admin: upload map
          const { mapName, mapContent } = message;
          if (!mapName || !mapName.endsWith('.bzw') || !mapContent) {
            ws.send(JSON.stringify({ error: 'Invalid map upload' }));
            break;
          }
          const mapPath = path.join(__dirname, 'maps', mapName);
          fs.writeFile(mapPath, mapContent, err => {
            if (err) {
              logError('Map upload failed:', err);
              ws.send(JSON.stringify({ error: 'Failed to save map' }));
              return;
            }
            log(`Admin uploaded new map: ${mapName}`);
            ws.send(JSON.stringify({ success: true }));
            // Send direct chat message to uploader
            ws.send(JSON.stringify({
              type: 'chat',
              from: -1, // SERVER
              to: player.id,
              text: `Upload ${mapName} with ${Buffer.byteLength(mapContent, 'utf8')} bytes`
            }));
            // Send updated map list (mapList reply)
            sendMapList(ws);
          });
          break;
        }
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
    const cheatWarnings = player.cheatWarnings.totalWarnings;
    players.delete(player.id);

    let logMsg = `Player "${playerName}" (#${playerNum}) disconnected. ${playerKills} kills, ${playerDeaths} deaths.`;
    if (cheatWarnings > 0 && ANTICHEAT_CONFIG.mode !== 'disabled') {
      logMsg += ` [ANTICHEAT: ${cheatWarnings} warnings (${player.cheatWarnings.linearDrift} linear, ${player.cheatWarnings.angularDrift} angular)]`;
    }
    logMsg += ` Players: ${players.size}`;
    log(logMsg);

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
      requestServerRestart('server.js change');
    }
  });
  console.log(`  ✓ Watching: server.js`);
}
