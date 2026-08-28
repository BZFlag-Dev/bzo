/*
 * Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/timriker/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */

const express = require('express');
const logPath = require('path').join(__dirname, 'server.log');
// Clear server.log on restart
require('fs').writeFileSync(logPath, '');
const { WebSocketServer } = require('ws');
const { normalizeShotSlotCount } = require('./server/shot-limits.cjs');
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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const PORT = process.env.PORT || 3000;
const CONFIG_PATH = process.env.SERVER_CONFIG_PATH
  ? path.resolve(process.env.SERVER_CONFIG_PATH)
  : path.join(__dirname, 'server.json');
const EXAMPLE_CONFIG_PATH = path.join(__dirname, 'example-server.json');

// Serve static files
app.use(express.static('public'));

function getAvailableTankModels() {
  const objDir = path.join(__dirname, 'public', 'obj');
  const hiddenModelFiles = new Set(['tank.obj']);
  try {
    return fs.readdirSync(objDir)
      .filter((fileName) => fileName.toLowerCase().endsWith('.obj'))
      .filter((fileName) => !hiddenModelFiles.has(fileName.toLowerCase()))
      .map((fileName) => {
        const id = fileName.slice(0, -4).toLowerCase();
        const label = id === 'bzflag'
          ? 'BZFlag'
          : id === 'wheeled6'
            ? 'Wheeled 6'
            : id
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
      .sort((left, right) => {
        if (left.id === 'bzflag') return -1;
        if (right.id === 'bzflag') return 1;
        return left.id.localeCompare(right.id);
      });
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

function normalizeTankModelId(modelId) {
  const normalized = typeof modelId === 'string' ? modelId.trim().toLowerCase() : '';
  if (normalized === 'default') return 'bzflag';
  if (normalized === 'bzflag-tank') return 'bzflag';
  if (normalized === 'tank') return 'bzflag';
  return normalized;
}

app.get('/api/tank-models', (req, res) => {
  res.json({ models: getAvailableTankModels() });
});

// AGPL §13: provide source code access to network users
app.get('/source', (req, res) => {
  res.redirect(302, 'https://github.com/timriker/bzo');
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
  TANK_SPEED: 25.0, // BZFlag-like default (units per second)
  TANK_ROTATION_SPEED: 0.785398, // BZFlag _tankAngVel default (radians per second)
  REVERSE_SPEED_RATIO: 0.5, // Max reverse speed as fraction of forward speed
  FORWARD_ACCEL: 1.8, // Forward input acceleration (normalized units per second)
  REVERSE_ACCEL: 1.2, // Reverse input acceleration (normalized units per second)
  FORWARD_DECEL: 2.5, // Forward/reverse input deceleration to zero
  TURN_ACCEL: 3.0, // Turn input acceleration (normalized units per second)
  TURN_DECEL: 4.0, // Turn input deceleration to zero
  SHOT_SPEED: 100, // BZFlag _shotSpeed default (units per second)
  SHOT_RANGE: 350, // BZFlag _shotRange default (world units)
  SHOT_DISTANCE: 350, // Legacy alias for client/radar code
  SHOT_RELOAD_TIME: 1000, // ms; configurable independently until shot-slot behavior matches BZFlag
  SHOT_COOLDOWN: 1000, // Legacy alias used by existing client fire gating
  SHOT_MAX_ACTIVE: 1, // BZFlag maxShots default
  SHOT_RADIUS: 0.5, // BZFlag _shotRadius default
  SHOT_TAIL_LENGTH: 4.0, // BZFlag _shotTailLength default
  SHOTS_KEEP_VERTICAL_VELOCITY: false, // BZFlag _shotsKeepVerticalVelocity default
  MAX_SPEED_TOLERANCE: 1.5, // Allow 50% tolerance for latency
  SHOT_POSITION_TOLERANCE: 2, // Max distance shot can be from claimed position
  PAUSE_COUNTDOWN: 2000, // ms
  JUMP_VELOCITY: 19, // BZFlag _jumpVelocity default
  GRAVITY: 9.8, // BZFlag _gravity magnitude (units per second squared)
  JUMP_COOLDOWN: 500, // ms between jumps
  FOG_MODE: 'none', // BZFlag _fogMode default
  FOG_DENSITY: 0.001, // BZFlag _fogDensity default
  FOG_START: null, // Defaults to 0.5 * map size like BZFlag
  FOG_END: null, // Defaults to map size like BZFlag
  VOICE_NEARBY_RADIUS: 60, // Maximum distance for the initial Nearby voice channel
};

// WebSocket keep-alive configuration
const WS_PING_INTERVAL = 30000; // Send ping every 30 seconds
const WS_PONG_TIMEOUT = 60000; // Close connection if no pong after 60 seconds

// --- Map selection: load from config and maps/ directory ---
function ensureServerConfig(configPath) {
  if (fs.existsSync(configPath)) {
    return;
  }

  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    if (!fs.existsSync(EXAMPLE_CONFIG_PATH)) {
      throw new Error(`No example config found at ${EXAMPLE_CONFIG_PATH}`);
    }

    fs.copyFileSync(EXAMPLE_CONFIG_PATH, configPath);
    log(`Created default server config at ${configPath}`);
  } catch (error) {
    logError(`Could not create default server config at ${configPath}:`, error);
  }
}

const configPath = CONFIG_PATH;
const BUNDLED_MAPS_DIR = path.join(__dirname, 'maps');
const RUNTIME_MAPS_DIR = process.env.MAPS_PATH
  ? path.resolve(process.env.MAPS_PATH)
  : path.join(path.dirname(configPath), 'maps');

function ensureRuntimeMapsDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch (error) {
    logError(`Could not ensure runtime maps directory at ${dirPath}:`, error);
  }
}

function listAvailableMapFiles() {
  const mapFiles = new Set();
  const mapDirs = [RUNTIME_MAPS_DIR, BUNDLED_MAPS_DIR];

  for (const dirPath of mapDirs) {
    try {
      if (!fs.existsSync(dirPath)) {
        continue;
      }
      for (const fileName of fs.readdirSync(dirPath)) {
        if (fileName.endsWith('.bzw')) {
          mapFiles.add(fileName);
        }
      }
    } catch (error) {
      logError(`Failed to read maps from ${dirPath}:`, error);
    }
  }

  return ['random', ...Array.from(mapFiles).sort((left, right) => left.localeCompare(right))];
}

function resolveMapFilePath(mapFile) {
  if (!mapFile || mapFile === 'random') {
    return '';
  }

  const safeFileName = path.basename(mapFile);
  if (safeFileName !== mapFile) {
    return '';
  }

  const runtimePath = path.join(RUNTIME_MAPS_DIR, safeFileName);
  if (fs.existsSync(runtimePath)) {
    return runtimePath;
  }

  const bundledPath = path.join(BUNDLED_MAPS_DIR, safeFileName);
  if (fs.existsSync(bundledPath)) {
    return bundledPath;
  }

  return '';
}

let serverConfig = {};
ensureServerConfig(configPath);
ensureRuntimeMapsDir(RUNTIME_MAPS_DIR);
try {
  serverConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
  logError(`Could not load server config at ${configPath}:`, e);
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

// Optional gameplay overrides from server config
const configTankSpeed = Number(serverConfig.tankSpeed);
if (Number.isFinite(configTankSpeed) && configTankSpeed > 0) {
  GAME_CONFIG.TANK_SPEED = configTankSpeed;
}

const configTankRotationSpeed = Number(serverConfig.tankRotationSpeed);
if (Number.isFinite(configTankRotationSpeed) && configTankRotationSpeed > 0) {
  GAME_CONFIG.TANK_ROTATION_SPEED = configTankRotationSpeed;
}

const configReverseSpeedRatio = Number(serverConfig.reverseSpeedRatio);
if (Number.isFinite(configReverseSpeedRatio) && configReverseSpeedRatio >= 0 && configReverseSpeedRatio <= 1) {
  GAME_CONFIG.REVERSE_SPEED_RATIO = configReverseSpeedRatio;
}

const configForwardAccel = Number(serverConfig.forwardAccel);
if (Number.isFinite(configForwardAccel) && configForwardAccel > 0) {
  GAME_CONFIG.FORWARD_ACCEL = configForwardAccel;
}

const configReverseAccel = Number(serverConfig.reverseAccel);
if (Number.isFinite(configReverseAccel) && configReverseAccel > 0) {
  GAME_CONFIG.REVERSE_ACCEL = configReverseAccel;
}

const configForwardDecel = Number(serverConfig.forwardDecel);
if (Number.isFinite(configForwardDecel) && configForwardDecel > 0) {
  GAME_CONFIG.FORWARD_DECEL = configForwardDecel;
}

const configTurnAccel = Number(serverConfig.turnAccel);
if (Number.isFinite(configTurnAccel) && configTurnAccel > 0) {
  GAME_CONFIG.TURN_ACCEL = configTurnAccel;
}

const configTurnDecel = Number(serverConfig.turnDecel);
if (Number.isFinite(configTurnDecel) && configTurnDecel > 0) {
  GAME_CONFIG.TURN_DECEL = configTurnDecel;
}

const configJumpVelocity = Number(serverConfig.jumpVelocity);
if (Number.isFinite(configJumpVelocity) && configJumpVelocity >= 0) {
  GAME_CONFIG.JUMP_VELOCITY = configJumpVelocity;
}

const configGravity = Number(serverConfig.gravity);
if (Number.isFinite(configGravity) && configGravity > 0) {
  GAME_CONFIG.GRAVITY = configGravity;
}

const configShotSpeed = Number(serverConfig.shotSpeed);
if (Number.isFinite(configShotSpeed) && configShotSpeed > 0) {
  GAME_CONFIG.SHOT_SPEED = configShotSpeed;
}

const configShotRange = Number(serverConfig.shotRange);
if (Number.isFinite(configShotRange) && configShotRange > 0) {
  GAME_CONFIG.SHOT_RANGE = configShotRange;
}

const configShotDuration = Number(serverConfig.shotDuration);
if (Number.isFinite(configShotDuration) && configShotDuration > 0) {
  GAME_CONFIG.SHOT_RANGE = GAME_CONFIG.SHOT_SPEED * configShotDuration;
}

const configShotDistance = Number(serverConfig.shotDistance);
if (Number.isFinite(configShotDistance) && configShotDistance > 0) {
  GAME_CONFIG.SHOT_RANGE = configShotDistance;
}

const configShotReloadTime = Number(serverConfig.shotReloadTime);
if (Number.isFinite(configShotReloadTime) && configShotReloadTime > 0) {
  GAME_CONFIG.SHOT_RELOAD_TIME = configShotReloadTime;
}

const configShotCooldown = Number(serverConfig.shotCooldown);
if (Number.isFinite(configShotCooldown) && configShotCooldown > 0) {
  GAME_CONFIG.SHOT_RELOAD_TIME = configShotCooldown;
}

const configShotMaxActive = Number(serverConfig.shotMaxActive);
if (Number.isInteger(configShotMaxActive) && configShotMaxActive > 0) {
  GAME_CONFIG.SHOT_MAX_ACTIVE = normalizeShotSlotCount(configShotMaxActive);
}

const configShotRadius = Number(serverConfig.shotRadius);
if (Number.isFinite(configShotRadius) && configShotRadius > 0) {
  GAME_CONFIG.SHOT_RADIUS = configShotRadius;
}

const configShotTailLength = Number(serverConfig.shotTailLength);
if (Number.isFinite(configShotTailLength) && configShotTailLength >= 0) {
  GAME_CONFIG.SHOT_TAIL_LENGTH = configShotTailLength;
}

const configuredVoiceNearbyRadius = Number(
  process.env.VOICE_NEARBY_RADIUS ?? serverConfig.voiceNearbyRadius
);
if (Number.isFinite(configuredVoiceNearbyRadius) && configuredVoiceNearbyRadius > 0) {
  GAME_CONFIG.VOICE_NEARBY_RADIUS = configuredVoiceNearbyRadius;
}

function parseVoiceIceServers(value) {
  let source = value;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch (error) {
      logError('Could not parse VOICE_ICE_SERVERS as JSON:', error.message || error);
      source = source.split(',').map((url) => url.trim()).filter(Boolean);
    }
  }

  const entries = Array.isArray(source) ? source : source ? [source] : [];
  return entries
    .map((entry) => {
      const candidate = typeof entry === 'string' ? { urls: [entry] } : entry;
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
      const urls = Array.isArray(candidate.urls)
        ? candidate.urls
        : typeof candidate.urls === 'string'
          ? [candidate.urls]
          : [];
      const validUrls = urls
        .filter((url) => typeof url === 'string' && /^(?:stun|turn|turns):/i.test(url))
        .map((url) => url.slice(0, 2048));
      if (validUrls.length === 0) return null;

      const normalized = { urls: validUrls };
      if (typeof candidate.username === 'string' && candidate.username.length <= 256) {
        normalized.username = candidate.username;
      }
      if (typeof candidate.credential === 'string' && candidate.credential.length <= 2048) {
        normalized.credential = candidate.credential;
      }
      return normalized;
    })
    .filter(Boolean)
    .slice(0, 8);
}

const configuredVoiceIceServers = process.env.VOICE_ICE_SERVERS ?? serverConfig.voiceIceServers;
const VOICE_ICE_SERVERS = parseVoiceIceServers(configuredVoiceIceServers);

if (typeof serverConfig.shotsKeepVerticalVelocity === 'boolean') {
  GAME_CONFIG.SHOTS_KEEP_VERTICAL_VELOCITY = serverConfig.shotsKeepVerticalVelocity;
}

GAME_CONFIG.SHOT_DISTANCE = GAME_CONFIG.SHOT_RANGE;
GAME_CONFIG.SHOT_COOLDOWN = GAME_CONFIG.SHOT_RELOAD_TIME;

const validFogModes = new Set(['none', 'linear', 'exp', 'exp2']);
const configFogMode = typeof serverConfig.fogMode === 'string' ? serverConfig.fogMode.trim().toLowerCase() : '';
if (validFogModes.has(configFogMode)) {
  GAME_CONFIG.FOG_MODE = configFogMode;
}

const configFogDensity = Number(serverConfig.fogDensity);
if (Number.isFinite(configFogDensity) && configFogDensity >= 0) {
  GAME_CONFIG.FOG_DENSITY = configFogDensity;
}

const configFogStart = Number(serverConfig.fogStart);
if (Number.isFinite(configFogStart) && configFogStart >= 0) {
  GAME_CONFIG.FOG_START = configFogStart;
}

const configFogEnd = Number(serverConfig.fogEnd);
if (Number.isFinite(configFogEnd) && configFogEnd >= 0) {
  GAME_CONFIG.FOG_END = configFogEnd;
}

if (!Number.isFinite(GAME_CONFIG.FOG_START)) {
  GAME_CONFIG.FOG_START = 0.5 * GAME_CONFIG.MAP_SIZE;
}

if (!Number.isFinite(GAME_CONFIG.FOG_END)) {
  GAME_CONFIG.FOG_END = GAME_CONFIG.MAP_SIZE;
}

log(`Anti-cheat mode: ${ANTICHEAT_CONFIG.mode}`);
log(
  `Gameplay config: tankSpeed=${GAME_CONFIG.TANK_SPEED}, tankRotationSpeed=${GAME_CONFIG.TANK_ROTATION_SPEED}, reverseSpeedRatio=${GAME_CONFIG.REVERSE_SPEED_RATIO}, forwardAccel=${GAME_CONFIG.FORWARD_ACCEL}, reverseAccel=${GAME_CONFIG.REVERSE_ACCEL}, forwardDecel=${GAME_CONFIG.FORWARD_DECEL}, turnAccel=${GAME_CONFIG.TURN_ACCEL}, turnDecel=${GAME_CONFIG.TURN_DECEL}, jumpVelocity=${GAME_CONFIG.JUMP_VELOCITY}, gravity=${GAME_CONFIG.GRAVITY}, shotSpeed=${GAME_CONFIG.SHOT_SPEED}, shotRange=${GAME_CONFIG.SHOT_RANGE}, shotReloadTime=${GAME_CONFIG.SHOT_RELOAD_TIME}ms, shotDuration≈${(GAME_CONFIG.SHOT_RANGE / GAME_CONFIG.SHOT_SPEED).toFixed(2)}s, shotMaxActive=${GAME_CONFIG.SHOT_MAX_ACTIVE}, shotRadius=${GAME_CONFIG.SHOT_RADIUS}, shotTailLength=${GAME_CONFIG.SHOT_TAIL_LENGTH}, shotsKeepVerticalVelocity=${GAME_CONFIG.SHOTS_KEEP_VERTICAL_VELOCITY}`
);
log(
  `Fog config: mode=${GAME_CONFIG.FOG_MODE}, density=${GAME_CONFIG.FOG_DENSITY}, start=${GAME_CONFIG.FOG_START}, end=${GAME_CONFIG.FOG_END}, color=time-of-day`
);
log(`Voice config: nearbyRadius=${GAME_CONFIG.VOICE_NEARBY_RADIUS}`);
log(`Voice ICE config: ${VOICE_ICE_SERVERS.length} server entr${VOICE_ICE_SERVERS.length === 1 ? 'y' : 'ies'}`);
log(`Map directories: runtime=${RUNTIME_MAPS_DIR}, bundled=${BUNDLED_MAPS_DIR}`);
if (MAP_SOURCE !== 'random') {
  mapPath = resolveMapFilePath(MAP_SOURCE);
  if (!fs.existsSync(mapPath)) {
    logError(`Map file not found: ${MAP_SOURCE}. Reverting to random map.`);
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
  const teleporters = [];
  const parsedLinks = [];
  let current = null;
  let currentLink = null;

  function getTeleporterEndpointName(teleporter, face) {
    return `${teleporter.linkName}:${face === 0 ? 'f' : 'b'}`;
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function globMatch(pattern, candidate) {
    const source = `^${escapeRegExp(pattern).replace(/\\\*/g, '.*').replace(/\\\?/g, '.')}$`;
    return new RegExp(source, 'i').test(candidate);
  }

  function normalizeEndpointPattern(value) {
    if (typeof value !== 'string') return '';
    let endpoint = value.trim();
    if (!endpoint) return '';
    if (endpoint.startsWith(':')) {
      endpoint = endpoint.slice(1);
    }
    const last = endpoint.slice(-1);
    if (last === 'F' || last === 'B') {
      endpoint = `${endpoint.slice(0, -1)}${last.toLowerCase()}`;
    }
    return endpoint;
  }

  function resolveNumericFace(faceId) {
    if (!Number.isInteger(faceId) || faceId < 0 || faceId >= teleporters.length * 2) {
      return [];
    }
    return [faceId];
  }

  function resolveNamedFaces(pattern) {
    const normalizedPattern = normalizeEndpointPattern(pattern);
    if (!normalizedPattern) return [];
    const matches = [];
    for (const teleporter of teleporters) {
      const frontName = getTeleporterEndpointName(teleporter, 0);
      const backName = getTeleporterEndpointName(teleporter, 1);
      if (globMatch(normalizedPattern, frontName)) {
        matches.push(teleporter.teleporterIndex * 2);
      }
      if (globMatch(normalizedPattern, backName)) {
        matches.push(teleporter.teleporterIndex * 2 + 1);
      }
    }
    return matches;
  }

  function resolveEndpointFaces(endpoint) {
    if (!endpoint || typeof endpoint.value !== 'string') return [];
    if (endpoint.kind === 'numeric') {
      return resolveNumericFace(endpoint.faceId);
    }
    return resolveNamedFaces(endpoint.value);
  }

  function parseLinkEndpoint(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return null;
    if (/^\d+$/.test(raw)) {
      return {
        kind: 'numeric',
        value: raw,
        faceId: parseInt(raw, 10),
      };
    }
    return {
      kind: 'named',
      value: raw,
      pattern: normalizeEndpointPattern(raw),
    };
  }

  function faceIdToEndpoint(faceId) {
    const teleporterIndex = Math.floor(faceId / 2);
    const face = faceId % 2;
    const teleporter = teleporters[teleporterIndex];
    if (!teleporter) return null;
    return {
      faceId,
      teleporterIndex,
      face,
      endpoint: getTeleporterEndpointName(teleporter, face),
    };
  }

  function buildTeleporterLinks() {
    const linksBySource = new Map();

    for (const link of parsedLinks) {
      const srcFaces = resolveEndpointFaces(link.from);
      const dstFaces = resolveEndpointFaces(link.to);

      if (!srcFaces.length || !dstFaces.length) {
        log(`Ignoring broken teleporter link from "${link.from?.value || ''}" to "${link.to?.value || ''}" in ${filename}`);
        continue;
      }

      for (const sourceFaceId of srcFaces) {
        if (!linksBySource.has(sourceFaceId)) {
          linksBySource.set(sourceFaceId, new Set());
        }
        const destinationSet = linksBySource.get(sourceFaceId);
        for (const destFaceId of dstFaces) {
          destinationSet.add(destFaceId);
        }
      }
    }

    // Match BZFlag link behavior: any unlinked source face defaults to
    // passing through to the opposite face on the same teleporter.
    for (let sourceFaceId = 0; sourceFaceId < teleporters.length * 2; sourceFaceId++) {
      if (!linksBySource.has(sourceFaceId) || linksBySource.get(sourceFaceId).size === 0) {
        const oppositeFaceId = (Math.floor(sourceFaceId / 2) * 2) + (1 - (sourceFaceId % 2));
        linksBySource.set(sourceFaceId, new Set([oppositeFaceId]));
      }
    }

    const normalizedLinks = [];
    for (const [sourceFaceId, destinationSet] of linksBySource.entries()) {
      const source = faceIdToEndpoint(sourceFaceId);
      if (!source) continue;

      for (const destFaceId of destinationSet) {
        const destination = faceIdToEndpoint(destFaceId);
        if (!destination) continue;

        normalizedLinks.push({
          sourceFaceId,
          sourceEndpoint: source.endpoint,
          sourceTeleporter: source.teleporterIndex,
          sourceFace: source.face,
          destFaceId,
          destEndpoint: destination.endpoint,
          destTeleporter: destination.teleporterIndex,
          destFace: destination.face,
        });
      }
    }

    normalizedLinks.sort((a, b) => {
      if (a.sourceFaceId !== b.sourceFaceId) return a.sourceFaceId - b.sourceFaceId;
      return a.destFaceId - b.destFaceId;
    });

    return {
      teleporters: teleporters.map((teleporter) => ({
        teleporterIndex: teleporter.teleporterIndex,
        name: teleporter.linkName,
        obstacleName: teleporter.obstacle.name,
        frontFaceId: teleporter.teleporterIndex * 2,
        backFaceId: teleporter.teleporterIndex * 2 + 1,
        frontEndpoint: `${teleporter.linkName}:f`,
        backEndpoint: `${teleporter.linkName}:b`,
      })),
      links: normalizedLinks,
    };
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    if (currentLink && line === 'end') {
      if (currentLink.from && currentLink.to) {
        parsedLinks.push(currentLink);
      } else {
        log(`Ignoring incomplete link block in ${filename}`);
      }
      currentLink = null;
      continue;
    }

    if (currentLink && line.startsWith('from')) {
      const [, ...fromParts] = line.split(/\s+/);
      currentLink.from = parseLinkEndpoint(fromParts.join(' ').replace(/"/g, '').trim());
      continue;
    }

    if (currentLink && line.startsWith('to')) {
      const [, ...toParts] = line.split(/\s+/);
      currentLink.to = parseLinkEndpoint(toParts.join(' ').replace(/"/g, '').trim());
      continue;
    }

    if (!current && line.startsWith('link')) {
      currentLink = { from: null, to: null };
      continue;
    }

    if (line.startsWith('world')) {
      // Look ahead for size
      for (let j = i + 1; j < lines.length; j++) {
        const wline = lines[j].trim();
        if (wline.startsWith('size')) {
          const [, size] = wline.split(/\s+/);
          if (size) {
            GAME_CONFIG.MAP_SIZE = parseFloat(size) * 2;
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
      current = { type: 'box', kind: 'base', team: 1 };
    } else if (line.startsWith('teleporter')) {
      current = { type: 'box', kind: 'teleporter' };
      const [, ...teleporterNameParts] = line.split(/\s+/);
      const inlineTeleporterName = teleporterNameParts.join(' ').replace(/"/g, '').trim();
      if (inlineTeleporterName) {
        current.name = inlineTeleporterName;
      }
    } else if (current && line.startsWith('name')) {
      // name <string>
      const [, ...nameParts] = line.split(/\s+/);
      const name = nameParts.join(' ').replace(/"/g, '').trim();
      if (name) current.name = name;
    } else if (current && line.startsWith('position')) {
      // position x y z (BZFlag +Y north maps to our -Z north)
      const [, x, y, z] = line.split(/\s+/);
      current.x = parseFloat(x);
      current.z = -parseFloat(y); // BZFlag +Y (north) -> our -Z (north)
      current.baseY = parseFloat(z) || 0;
    } else if (current && line.startsWith('size')) {
      // size w d h (BZFlag x/y are center-to-edge half extents, z is full height)
      const [, w, d, h] = line.split(/\s+/);
      const rawW = parseFloat(w);
      const rawD = parseFloat(d);
      const rawH = parseFloat(h);
      current.w = Math.abs(rawW) * 2;
      current.d = Math.abs(rawD) * 2;
      current.h = Math.abs(rawH);
      if (current.type === 'pyramid') {
        current.inverted = rawH < 0;
      }
    } else if (current && line.startsWith('rotation')) {
      // BZFlag rotation is CCW around +Z; our world maps BZFlag +Y (north) to -Z,
      // which flips the depth axis. The correct conversion is +deg + π.
      const [, deg] = line.split(/\s+/);
      current.rotation = (parseFloat(deg) || 0) * Math.PI / 180 + Math.PI;
    } else if (current && line.startsWith('border')) {
      const [, border] = line.split(/\s+/);
      current.border = Math.abs(parseFloat(border) || 0);
    } else if (current && current.kind === 'base' && line.startsWith('color')) {
      const [, color] = line.split(/\s+/);
      const team = parseInt(color, 10);
      current.team = Number.isInteger(team) ? Math.max(1, Math.min(4, team)) : 1;
    } else if (current && line === 'end') {
      // Use BZW name if present, otherwise assign a generated name
      if (!current.name) {
        if (current.kind === 'teleporter') {
          current.name = `t${teleporters.length}`;
        } else {
          current.name = `${current.type[0].toUpperCase()}${obstacles.length}`;
        }
      }

      if (current.kind === 'teleporter') {
        const teleporterIndex = teleporters.length;
        const linkName = current.name || `teleporter_${teleporterIndex}`;
        current.teleporterIndex = teleporterIndex;
        current.linkName = linkName;
        teleporters.push({
          teleporterIndex,
          linkName,
          obstacle: current,
        });
      }

      obstacles.push(current);
      current = null;
    }
  }

  const teleporterGraph = buildTeleporterLinks();
  return {
    obstacles,
    teleporterGraph,
  };
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
      obstacle = { x, z, w, d, h, baseY, rotation, name: `O${i}` , type: 'box'};
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
      pyramid = { x, z, w, d, h, baseY, rotation, name: `P${i}` , type: 'pyramid', inverted };
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
let TELEPORTER_GRAPH = { teleporters: [], links: [] };
if (MAP_SOURCE === 'random') {
  OBSTACLES = generateObstacles();
  TELEPORTER_GRAPH = { teleporters: [], links: [] };
  log(`Generated ${OBSTACLES.length} random obstacles`);
} else {
  const mapData = parseBZWMap(mapPath);
  OBSTACLES = mapData.obstacles;
  TELEPORTER_GRAPH = mapData.teleporterGraph;
  log(`Loaded ${OBSTACLES.length} obstacles from ${mapPath}`);
  log(`Loaded ${TELEPORTER_GRAPH.links.length} teleporter face links from ${mapPath}`);
}
log(OBSTACLES);

let TELEPORTER_OBSTACLES_BY_INDEX = new Map();
let TELEPORTER_LINKS_BY_SOURCE_FACE = new Map();

function rebuildTeleporterRuntimeState() {
  TELEPORTER_OBSTACLES_BY_INDEX = new Map();
  TELEPORTER_LINKS_BY_SOURCE_FACE = new Map();

  for (const obs of OBSTACLES) {
    if (obs?.kind !== 'teleporter') continue;
    if (!Number.isInteger(obs.teleporterIndex)) continue;
    TELEPORTER_OBSTACLES_BY_INDEX.set(obs.teleporterIndex, obs);
  }

  for (const link of TELEPORTER_GRAPH.links || []) {
    if (!Number.isInteger(link?.sourceFaceId) || !Number.isInteger(link?.destFaceId)) continue;
    if (!TELEPORTER_LINKS_BY_SOURCE_FACE.has(link.sourceFaceId)) {
      TELEPORTER_LINKS_BY_SOURCE_FACE.set(link.sourceFaceId, []);
    }
    TELEPORTER_LINKS_BY_SOURCE_FACE.get(link.sourceFaceId).push(link.destFaceId);
  }

  for (const [sourceFaceId, destinations] of TELEPORTER_LINKS_BY_SOURCE_FACE.entries()) {
    destinations.sort((a, b) => a - b);
    TELEPORTER_LINKS_BY_SOURCE_FACE.set(sourceFaceId, Array.from(new Set(destinations)));
  }
}

rebuildTeleporterRuntimeState();

function getMaxObstacleTopY(obstacles = []) {
  return obstacles.reduce((maxTop, obstacle) => {
    const baseY = Number.isFinite(obstacle?.baseY) ? obstacle.baseY : 0;
    const height = Number.isFinite(obstacle?.h) ? obstacle.h : 4;
    return Math.max(maxTop, baseY + height);
  }, 0);
}

function getJumpApexHeight() {
  const jumpVelocity = Number.isFinite(GAME_CONFIG.JUMP_VELOCITY) ? GAME_CONFIG.JUMP_VELOCITY : 19;
  const gravity = Number.isFinite(GAME_CONFIG.GRAVITY) && GAME_CONFIG.GRAVITY > 0 ? GAME_CONFIG.GRAVITY : 9.8;
  return (jumpVelocity * jumpVelocity) / (2 * gravity);
}

// Generate random clouds with fractal patter.
function generateClouds(obstacles = OBSTACLES) {
  const clouds = [];
  const numClouds = 15;
  const maxObstacleTopY = getMaxObstacleTopY(obstacles);
  const jumpApexHeight = getJumpApexHeight();
  const cloudBaseY = maxObstacleTopY + jumpApexHeight;

  for (let i = 0; i < numClouds; i++) {
    // Random position in sky
    const x = (Math.random() - 0.5) * 200;
    const y = cloudBaseY + Math.random() * 40;
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
    this.tankModel = 'bzflag';
    // Roles are server-authoritative. A player remains active unless joinGame
    // explicitly requests the receive-only spectator role.
    this.role = 'active';
    this.joined = false;
    this.voiceMicEnabled = false;
    this.voiceRosterSignature = '';

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
      role: this.role,
      voiceMicEnabled: this.voiceMicEnabled,
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
  constructor(id, playerId, shotSlot, x, y, z, dirX, dirZ, dirY = 0) {
    this.id = id;
    this.playerId = playerId;
    this.shotSlot = shotSlot;
    this.x = x;
    this.y = y || 2.2; // Default height if not specified (tank height + barrel height)
    this.z = z;
    this.dirX = dirX;
    this.dirY = dirY;
    this.dirZ = dirZ;
    this.createdAt = Date.now();
    this.originX = x;
    this.originY = this.y;
    this.originZ = z;
    this.lifetimeSeconds = GAME_CONFIG.SHOT_SPEED > 0
      ? (GAME_CONFIG.SHOT_RANGE / GAME_CONFIG.SHOT_SPEED)
      : 10;
    this.teleportReentryBlockTeleporterIndex = null;
    this.teleportReentryBlockDistance = 0;
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
  const boundaryHeight = 1000;
  const span = GAME_CONFIG.MAP_SIZE + thickness * 2;
  return [
    { type: 'box', name: 'boundary_north', collisionKind: 'boundary', infiniteHeight: true, x: 0, z: -halfMap - thickness / 2, w: span, d: thickness, h: boundaryHeight, baseY: 0, rotation: 0 },
    { type: 'box', name: 'boundary_south', collisionKind: 'boundary', infiniteHeight: true, x: 0, z: halfMap + thickness / 2, w: span, d: thickness, h: boundaryHeight, baseY: 0, rotation: 0 },
    { type: 'box', name: 'boundary_east', collisionKind: 'boundary', infiniteHeight: true, x: halfMap + thickness / 2, z: 0, w: thickness, d: span, h: boundaryHeight, baseY: 0, rotation: 0 },
    { type: 'box', name: 'boundary_west', collisionKind: 'boundary', infiniteHeight: true, x: -halfMap - thickness / 2, z: 0, w: thickness, d: span, h: boundaryHeight, baseY: 0, rotation: 0 }
  ];
}

function getCollisionColliders() {
  return [...OBSTACLES, ...getWorldBorderColliders()];
}

function checkCollision(x, y, z, tankRadius = 2, options = {}) {
  const ignoreTeleporters = options.ignoreTeleporters === true;
  const suppressLog = options.suppressLog === true;
  for (const obs of getCollisionColliders()) {
    if (ignoreTeleporters && obs?.kind === 'teleporter') continue;
    const obstacleHeight = obs.h || 4;
    const obstacleBase = obs.baseY || 0;
    const obstacleTop = obstacleBase + obstacleHeight;
    const epsilon = 0.15;
    // Scale height based on radius (tanks are 2 units tall, projectiles much smaller)
    const tankHeight = tankRadius; // For tanks (radius=2), height=2; for projectiles (radius=0.1), height=0.1
    // Only check if tank top is below obstacle top and tank base is above obstacle base
    const tankTop = y + tankHeight;
    if (tankTop <= obstacleBase + epsilon) continue;
    if (y >= obstacleTop - epsilon) continue;

    const halfW = obs.w / 2;
    const halfD = obs.d / 2;
    const { x: localX, z: localZ } = getColliderLocalPoint(x, z, obs);

    if (obs.type === 'box' || !obs.type) {
      const distSquared = getBoxCollisionDistanceSquared(localX, localZ, halfW, halfD);
      if (distSquared < tankRadius * tankRadius) {
        if (!suppressLog) {
          log(`[COLLISION] ${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)} ${obs.name}:${obs.type} ${obs.x.toFixed(2)},${obstacleBase.toFixed(2)},${obs.z.toFixed(2)} rot:${(obs.rotation || 0).toFixed(2)}, h:${obstacleHeight.toFixed(2)}, top:${obstacleTop.toFixed(2)}`);
        }
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
        if (!suppressLog) {
          log(`[COLLISION] ${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)} ${obs.name}:${obs.type} ${obs.x.toFixed(2)},${obstacleBase.toFixed(2)},${obs.z.toFixed(2)} rot:${(obs.rotation || 0).toFixed(2)}, h:${obstacleHeight.toFixed(2)}, top:${obstacleTop.toFixed(2)}`);
        }
        return obs;
      }
    }
  }
  return false;
}

function findProjectileImpactPoint(prevX, prevY, prevZ, nextX, nextY, nextZ, projectileRadius = 0.1, options = {}) {
  const queryOptions = { ...options, suppressLog: true };
  const prevHit = !!checkCollision(prevX, prevY, prevZ, projectileRadius, queryOptions);
  const nextHit = !!checkCollision(nextX, nextY, nextZ, projectileRadius, queryOptions);

  // Expected case: clear -> colliding. If not, fall back to the reported position.
  if (prevHit || !nextHit) {
    return { x: nextX, y: nextY, z: nextZ };
  }

  let lo = 0;
  let hi = 1;

  // Binary search first-contact on the segment. A tiny fixed iteration count
  // keeps this inexpensive while producing stable impact points.
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) * 0.5;
    const mx = prevX + (nextX - prevX) * mid;
    const my = prevY + (nextY - prevY) * mid;
    const mz = prevZ + (nextZ - prevZ) * mid;
    const midHit = !!checkCollision(mx, my, mz, projectileRadius, queryOptions);
    if (midHit) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  // Return the last non-colliding point so the visual impact renders just
  // outside obstacle geometry.
  const t = lo;
  return {
    x: prevX + (nextX - prevX) * t,
    y: prevY + (nextY - prevY) * t,
    z: prevZ + (nextZ - prevZ) * t,
  };
}

function findMapEdgeImpactPoint(prevX, prevY, prevZ, nextX, nextY, nextZ, halfMap) {
  const prevInside = Math.abs(prevX) <= halfMap && Math.abs(prevZ) <= halfMap;
  const nextInside = Math.abs(nextX) <= halfMap && Math.abs(nextZ) <= halfMap;

  // Expected case: inside -> outside. Fall back to current position otherwise.
  if (!prevInside || nextInside) {
    return { x: nextX, y: nextY, z: nextZ };
  }

  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) * 0.5;
    const mx = prevX + (nextX - prevX) * mid;
    const mz = prevZ + (nextZ - prevZ) * mid;
    const inside = Math.abs(mx) <= halfMap && Math.abs(mz) <= halfMap;
    if (inside) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const t = lo;
  return {
    x: prevX + (nextX - prevX) * t,
    y: prevY + (nextY - prevY) * t,
    z: prevZ + (nextZ - prevZ) * t,
  };
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
      // Should not happen, but fallback to safe rejection.
      log(`Player "${player.name}" collided with unknown object x:${player.x.toFixed(2)}, y:${player.y.toFixed(2)}, z:${player.z.toFixed(2)}`);
      return false;
    }

    if (collision.collisionKind === 'boundary') {
      log(`Player "${player.name}" collided boundary x:${player.x.toFixed(2)}, y:${player.y.toFixed(2)}, z:${player.z.toFixed(2)}`);
      return false;
    }

    // Log obstacle details and reject movement.
    const { x, z, w, d, h, baseY, rotation } = collision;
    log(`Player "${player.name}" collided obs:${collision.name} ${x.toFixed(2)},${baseY.toFixed(2)},${z.toFixed(2)}, w:${w.toFixed(2)}, d:${d.toFixed(2)}, h:${h.toFixed(2)}, rot:${rotation.toFixed(2)} (p ${player.x.toFixed(2)},${player.y.toFixed(2)},${player.z.toFixed(2) })`);
    return false;
  }

  return true;
}

// Validate shot
function validateShot(player, shotX, shotY, shotZ) {
  // Shot originates from barrel end, which is ~3 units from tank center
  const barrelLength = 3.0;
  const now = Date.now();

  if (player.lastShot > 0) {
    const elapsedSinceLastShot = now - player.lastShot;
    if (elapsedSinceLastShot < GAME_CONFIG.SHOT_RELOAD_TIME) {
      const remaining = GAME_CONFIG.SHOT_RELOAD_TIME - elapsedSinceLastShot;
      log(`Player "${player.name}" tried to fire too soon (${remaining}ms remaining)`);
      return false;
    }
  }

  // Use extrapolated position, not stored position
  const extrapolated = player.getExtrapolatedPosition(now);
  const dist = distance(extrapolated.x, extrapolated.z, shotX, shotZ);

  if (dist > barrelLength + GAME_CONFIG.SHOT_POSITION_TOLERANCE) {
    log(`Player "${player.name}" shot from invalid position: ${dist.toFixed(2)} units away (extrapolated: ${extrapolated.x.toFixed(2)}, ${extrapolated.z.toFixed(2)}, shot: ${shotX.toFixed(2)}, ${shotZ.toFixed(2)})`);
    return false;
  }

  let activeShotCount = 0;
  projectiles.forEach((proj) => {
    if (proj.playerId === player.id) activeShotCount++;
  });

  if (activeShotCount >= GAME_CONFIG.SHOT_MAX_ACTIVE) {
    log(`Player "${player.name}" exceeded active shot slots (${activeShotCount}/${GAME_CONFIG.SHOT_MAX_ACTIVE})`);
    return false;
  }

  return true;
}

function getAvailableShotSlot(playerId) {
  const occupiedSlots = new Set();
  projectiles.forEach((proj) => {
    if (proj.playerId === playerId && Number.isInteger(proj.shotSlot) && proj.shotSlot >= 0) {
      occupiedSlots.add(proj.shotSlot);
    }
  });
  for (let slot = 0; slot < GAME_CONFIG.SHOT_MAX_ACTIVE; slot++) {
    if (!occupiedSlots.has(slot)) return slot;
  }
  return -1;
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

// Nearby voice protocol. Clients send voiceState with { enabled }, and send
// voiceOffer/voiceAnswer with { targetId, description }. ICE messages use
// { targetId, candidate }, where candidate may be null for end-of-candidates.
// The legacy alias `to` is accepted for targetId so reconnecting clients can
// keep their peer-routing field without widening the server-side permissions.
// The server replies with voiceRoster, voiceState, voiceOffer, voiceAnswer,
// and voiceIceCandidate. Every server-to-client voice message includes the
// nearby channel name and signaling messages identify their sender in `from`.
// Signaling is forwarded only to eligible nearby peers. Audio media remains on
// the WebRTC connection, not on this socket.
// TODO: Add team and global routing when those game modes exist; this initial
// protocol intentionally supports the Nearby channel only.
const VOICE_CHANNEL = 'nearby';
const VOICE_ROSTER_REFRESH_INTERVAL = 200;
const MAX_VOICE_SDP_LENGTH = 128 * 1024;
const MAX_VOICE_CANDIDATE_LENGTH = 16 * 1024;

function sendToPlayer(player, message) {
  if (player?.ws?.readyState === 1) {
    player.ws.send(JSON.stringify(message));
  }
}

function normalizePlayerId(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) {
    return value;
  }
  return null;
}

function isNearbyVoicePeer(source, target) {
  if (!source || !target || source.id === target.id) return false;
  if (!source.joined || !target.joined) return false;
  if (!Number.isFinite(source.x) || !Number.isFinite(source.z)
    || !Number.isFinite(target.x) || !Number.isFinite(target.z)) {
    return false;
  }
  return distance(source.x, source.z, target.x, target.z) <= GAME_CONFIG.VOICE_NEARBY_RADIUS;
}

function getNearbyVoicePeers(player) {
  return Array.from(players.values())
    .filter((candidate) => isNearbyVoicePeer(player, candidate))
    .sort((left, right) => Number(left.id) - Number(right.id));
}

function getVoicePeerState(peer) {
  return {
    id: peer.id,
    name: peer.name,
    role: peer.role,
    micEnabled: peer.role === 'active' && peer.voiceMicEnabled === true,
  };
}

function sendVoiceRoster(player, force = false) {
  if (!player.joined) return;

  const peers = getNearbyVoicePeers(player);
  const signature = peers
    .map((peer) => `${peer.id}:${peer.role}:${peer.voiceMicEnabled === true ? 1 : 0}`)
    .join('|');
  if (!force && player.voiceRosterSignature === signature) return;

  player.voiceRosterSignature = signature;
  sendToPlayer(player, {
    type: 'voiceRoster',
    channel: VOICE_CHANNEL,
    nearbyRadius: GAME_CONFIG.VOICE_NEARBY_RADIUS,
    peers: peers.map(getVoicePeerState),
  });
}

function refreshVoiceRosters(force = false) {
  players.forEach((player) => sendVoiceRoster(player, force));
}

function sendNearbyVoiceState(player) {
  if (!player.joined) return;

  const stateMessage = {
    type: 'voiceState',
    channel: VOICE_CHANNEL,
    playerId: player.id,
    role: player.role,
    enabled: player.role === 'active' && player.voiceMicEnabled === true,
  };
  sendToPlayer(player, stateMessage);
  getNearbyVoicePeers(player).forEach((peer) => sendToPlayer(peer, stateMessage));
}

function getVoiceDescription(message, expectedType) {
  const description = message && message.description;
  if (!description || typeof description !== 'object' || Array.isArray(description)) return null;
  if (description.type !== expectedType || typeof description.sdp !== 'string') return null;
  if (description.sdp.length === 0 || description.sdp.length > MAX_VOICE_SDP_LENGTH) return null;
  return {
    type: expectedType,
    sdp: description.sdp,
  };
}

function getVoiceCandidate(message) {
  const candidate = message && message.candidate;
  if (candidate === null) return null;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  if (typeof candidate.candidate !== 'string' || candidate.candidate.length > MAX_VOICE_CANDIDATE_LENGTH) {
    return null;
  }
  if (candidate.sdpMid !== undefined && candidate.sdpMid !== null
    && (typeof candidate.sdpMid !== 'string' || candidate.sdpMid.length > 256)) {
    return null;
  }
  if (candidate.sdpMLineIndex !== undefined && candidate.sdpMLineIndex !== null
    && (!Number.isInteger(candidate.sdpMLineIndex) || candidate.sdpMLineIndex < 0)) {
    return null;
  }
  if (candidate.usernameFragment !== undefined && candidate.usernameFragment !== null
    && (typeof candidate.usernameFragment !== 'string' || candidate.usernameFragment.length > 256)) {
    return null;
  }
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid ?? null,
    sdpMLineIndex: candidate.sdpMLineIndex ?? null,
    usernameFragment: candidate.usernameFragment ?? null,
  };
}

function forwardVoiceSignal(player, message) {
  if (!player.joined) return;
  if (message.type === 'voiceOffer' && player.role === 'spectator') return;

  const targetId = normalizePlayerId(message.targetId ?? message.to);
  const target = targetId ? players.get(targetId) : null;
  if (!target || !isNearbyVoicePeer(player, target)) return;

  if (message.type === 'voiceOffer' || message.type === 'voiceAnswer') {
    const description = getVoiceDescription(message, message.type === 'voiceOffer' ? 'offer' : 'answer');
    if (!description) return;
    sendToPlayer(target, {
      type: message.type,
      channel: VOICE_CHANNEL,
      from: player.id,
      description,
    });
    return;
  }

  const candidate = getVoiceCandidate(message);
  if (candidate === null && message.candidate !== null) return;
  sendToPlayer(target, {
    type: 'voiceIceCandidate',
    channel: VOICE_CHANNEL,
    from: player.id,
    candidate,
  });
}

function getShotTeleporterDims(obs) {
  const halfW = Math.max(0.25, Number(obs.w) / 2 || 0.56);
  const sourceHalfBreadth = Math.max(0.25, Number(obs.d) / 2 || 2.24);
  const sourceHeight = Math.max(1.0, Number(obs.h) || 10.0);
  const border = Math.max(0.12, Number(obs.border) || 1.12);

  // Match the same teleporter geometry basis as render.js/BZFlag finalize path.
  const halfD = sourceHalfBreadth + (border * 2.0);
  const h = sourceHeight + border;
  const activeHalfD = Math.max(0.1, halfD - border);
  const activeH = Math.max(0.2, h - border);
  return { halfW, halfD, h, border, activeHalfD, activeH };
}

const BZFLAG_TELEPORT_TOLERANCE = 1e-6;

function getSegmentBoxEntryTime(localStart, localEnd, bounds) {
  const delta = {
    x: localEnd.x - localStart.x,
    y: localEnd.y - localStart.y,
    z: localEnd.z - localStart.z,
  };

  let tMin = 0;
  let tMax = 1;
  const axes = ['x', 'y', 'z'];

  for (const axis of axes) {
    const start = localStart[axis];
    const d = delta[axis];
    const min = bounds.min[axis];
    const max = bounds.max[axis];

    if (Math.abs(d) < 1e-9) {
      if (start < min || start > max) return null;
      continue;
    }

    let t1 = (min - start) / d;
    let t2 = (max - start) / d;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }

    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }

  if (tMax < 0 || tMin > 1) return null;
  return Math.max(0, tMin);
}

function getShotTeleporterCrossing(start, end, obs) {
  const dims = getShotTeleporterDims(obs);
  const startLocalXZ = getColliderLocalPoint(start.x, start.z, obs);
  const endLocalXZ = getColliderLocalPoint(end.x, end.z, obs);

  const localStart = {
    x: startLocalXZ.x,
    y: start.y - (obs.baseY || 0),
    z: startLocalXZ.z,
  };
  const localEnd = {
    x: endLocalXZ.x,
    y: end.y - (obs.baseY || 0),
    z: endLocalXZ.z,
  };

  const outerBounds = {
    min: { x: -dims.halfW, y: 0, z: -dims.halfD },
    max: { x: dims.halfW, y: dims.h, z: dims.halfD },
  };
  const innerBounds = {
    min: { x: -dims.halfW, y: 0, z: -dims.activeHalfD },
    max: { x: dims.halfW, y: dims.activeH, z: dims.activeHalfD },
  };

  const tOuter = getSegmentBoxEntryTime(localStart, localEnd, outerBounds);
  const tInner = getSegmentBoxEntryTime(localStart, localEnd, innerBounds);
  if (tInner === null || tInner < 0 || tInner > 1) return null;

  // Match BZFlag Teleporter::isTeleported behavior: if the outer frame
  // is hit before the inner active slab, this is a frame hit (no teleport).
  if (tOuter !== null && (tInner - tOuter) > BZFLAG_TELEPORT_TOLERANCE) return null;

  const hitLocalX = localStart.x + (localEnd.x - localStart.x) * tInner;
  const face = hitLocalX > 0 ? 0 : 1;
  const sourceFaceId = obs.teleporterIndex * 2 + face;

  return {
    t: tInner,
    face,
    sourceFaceId,
    tOuter,
    point: {
      x: start.x + (end.x - start.x) * tInner,
      y: start.y + (end.y - start.y) * tInner,
      z: start.z + (end.z - start.z) * tInner,
    },
  };
}

function getShotTeleporterFrameHit(start, end, obs) {
  const dims = getShotTeleporterDims(obs);
  const startLocalXZ = getColliderLocalPoint(start.x, start.z, obs);
  const endLocalXZ = getColliderLocalPoint(end.x, end.z, obs);

  const localStart = {
    x: startLocalXZ.x,
    y: start.y - (obs.baseY || 0),
    z: startLocalXZ.z,
  };
  const localEnd = {
    x: endLocalXZ.x,
    y: end.y - (obs.baseY || 0),
    z: endLocalXZ.z,
  };

  const outerBounds = {
    min: { x: -dims.halfW, y: 0, z: -dims.halfD },
    max: { x: dims.halfW, y: dims.h, z: dims.halfD },
  };
  const innerBounds = {
    min: { x: -dims.halfW, y: 0, z: -dims.activeHalfD },
    max: { x: dims.halfW, y: dims.activeH, z: dims.activeHalfD },
  };

  const tOuter = getSegmentBoxEntryTime(localStart, localEnd, outerBounds);
  if (tOuter === null || tOuter < 0 || tOuter > 1) return null;

  const tInner = getSegmentBoxEntryTime(localStart, localEnd, innerBounds);
  if (tInner !== null && tInner >= 0 && tInner <= 1 && (tInner - tOuter) <= BZFLAG_TELEPORT_TOLERANCE) {
    return null;
  }

  return {
    t: tOuter,
    point: {
      x: start.x + (end.x - start.x) * tOuter,
      y: start.y + (end.y - start.y) * tOuter,
      z: start.z + (end.z - start.z) * tOuter,
    },
  };
}

function rotateXZ(x, z, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: cos * x - sin * z,
    z: sin * x + cos * z,
  };
}

function transformShotThroughTeleporter(pointIn, dirIn, sourceObs, sourceFace, destObs, destFace) {
  const srcDims = getShotTeleporterDims(sourceObs);
  const dstDims = getShotTeleporterDims(destObs);

  const radians1 = (sourceObs.rotation || 0) + (sourceFace === 0 ? 0 : Math.PI);
  const radians2 = (destObs.rotation || 0) + (destFace === 1 ? 0 : Math.PI);

  const relativeX = pointIn.x - sourceObs.x;
  const relativeZ = pointIn.z - sourceObs.z;
  const relativeY = pointIn.y - (sourceObs.baseY || 0);
  const local = rotateXZ(relativeX, relativeZ, -radians1);

  const breadthScale = srcDims.activeHalfD > 1e-6 ? (dstDims.activeHalfD / srcDims.activeHalfD) : 1;
  const heightScale = srcDims.activeH > 1e-6 ? (dstDims.activeH / srcDims.activeH) : 1;

  const localOut = {
    x: -dstDims.halfW,
    z: local.z * breadthScale,
    y: relativeY * heightScale,
  };

  const rotatedOut = rotateXZ(localOut.x, localOut.z, radians2);
  const pointOut = {
    x: destObs.x + rotatedOut.x,
    y: (destObs.baseY || 0) + localOut.y,
    z: destObs.z + rotatedOut.z,
  };

  const rotateDelta = radians2 - radians1;
  const dirRotated = rotateXZ(dirIn.x, dirIn.z, rotateDelta);
  const dirOut = {
    x: dirRotated.x,
    y: dirIn.y,
    z: dirRotated.z,
  };

  return { pointOut, dirOut };
}

function getShotTeleportDestinationFace(sourceFaceId) {
  const destinations = TELEPORTER_LINKS_BY_SOURCE_FACE.get(sourceFaceId);
  if (destinations && destinations.length > 0) return destinations[0];
  const teleIndex = Math.floor(sourceFaceId / 2);
  const oppositeFace = (teleIndex * 2) + (1 - (sourceFaceId % 2));
  return oppositeFace;
}

const SHOT_TELEPORT_REENTRY_BLOCK_DISTANCE = 0.5;

function traceShotThroughTeleporters(start, dir, travelDistance, projectileId, reentryBlockTeleporterIndex = null, reentryBlockDistance = 0) {
  let point = { ...start };
  let direction = { ...dir };
  let remaining = travelDistance;
  let teleports = 0;
  let blockedTeleporterIndex = Number.isInteger(reentryBlockTeleporterIndex) ? reentryBlockTeleporterIndex : null;
  let blockedDistance = Math.max(0, Number(reentryBlockDistance) || 0);
  const maxTeleportsPerTick = 8;

  while (remaining > 1e-6 && teleports < maxTeleportsPerTick) {
    const end = {
      x: point.x + direction.x * remaining,
      y: point.y + direction.y * remaining,
      z: point.z + direction.z * remaining,
    };

    let earliest = null;
    for (const obs of TELEPORTER_OBSTACLES_BY_INDEX.values()) {
      const crossing = getShotTeleporterCrossing(point, end, obs);
      if (crossing) {
        if (blockedTeleporterIndex !== null && blockedDistance > 1e-6 && obs.teleporterIndex === blockedTeleporterIndex) {
          // Ignore immediate re-entry to the just-exited teleporter.
        } else if (!earliest || crossing.t < earliest.event.t) {
          earliest = { obs, type: 'teleport', event: crossing };
        }
      }

      const frameHit = getShotTeleporterFrameHit(point, end, obs);
      if (frameHit && (!earliest || frameHit.t < earliest.event.t)) {
        earliest = { obs, type: 'frameHit', event: frameHit };
      }
    }

    if (!earliest) {
      blockedDistance = Math.max(0, blockedDistance - remaining);
      if (blockedDistance <= 1e-6) blockedTeleporterIndex = null;
      point = end;
      break;
    }

    if (earliest.type === 'frameHit') {
      return {
        point: earliest.event.point,
        direction,
        teleports,
        reentryBlockTeleporterIndex: blockedTeleporterIndex,
        reentryBlockDistance: Math.max(0, blockedDistance - (remaining * earliest.event.t)),
        frameHit: true,
        frameHitObstacle: earliest.obs,
      };
    }

    const sourceObs = earliest.obs;
    const sourceFaceId = earliest.event.sourceFaceId;
    const destFaceId = getShotTeleportDestinationFace(sourceFaceId);
    const destTeleporterIndex = Math.floor(destFaceId / 2);
    const destFace = destFaceId % 2;
    const sourceFace = sourceFaceId % 2;
    const destObs = TELEPORTER_OBSTACLES_BY_INDEX.get(destTeleporterIndex);

    if (!destObs) {
      break;
    }

    const transformed = transformShotThroughTeleporter(
      earliest.event.point,
      direction,
      sourceObs,
      sourceFace,
      destObs,
      destFace,
    );

    const consumedDistance = remaining * earliest.event.t;
    blockedDistance = Math.max(0, blockedDistance - consumedDistance);
    if (blockedDistance <= 1e-6) blockedTeleporterIndex = null;
    remaining = Math.max(0, remaining - consumedDistance);
    point = {
      x: transformed.pointOut.x + transformed.dirOut.x * 0.02,
      y: transformed.pointOut.y + transformed.dirOut.y * 0.02,
      z: transformed.pointOut.z + transformed.dirOut.z * 0.02,
    };
    direction = transformed.dirOut;
    blockedTeleporterIndex = destTeleporterIndex;
    blockedDistance = Math.max(
      SHOT_TELEPORT_REENTRY_BLOCK_DISTANCE,
      (getShotTeleporterDims(destObs).halfW * 2) + 0.05,
    );
    teleports++;

    log(`[SHOT_TP] id=${projectileId} srcFace=${sourceFaceId} dstFace=${destFaceId} src=${sourceObs.linkName || sourceObs.name} dst=${destObs.linkName || destObs.name}`);
  }

  return {
    point,
    direction,
    teleports,
    reentryBlockTeleporterIndex: blockedTeleporterIndex,
    reentryBlockDistance: blockedDistance,
    frameHit: false,
    frameHitObstacle: null,
  };
}

const SHOT_SIM_STEP_SECONDS = 1 / 60;
const SHOT_SIM_MAX_STEPS_PER_LOOP = 8;

function formatShotPoint(x, y, z) {
  return `(${Number(x).toFixed(2)},${Number(y).toFixed(2)},${Number(z).toFixed(2)})`;
}

function logShotEnd(projectile, cause, point, details = '') {
  const extra = details ? ` ${details}` : '';
  log(
    `[SHOT_END] id=${projectile.id} player=${projectile.playerId} slot=${projectile.shotSlot}` +
    ` cause=${cause} at=${formatShotPoint(point.x, point.y, point.z)}` +
    ` origin=${formatShotPoint(projectile.originX, projectile.y, projectile.originZ)}` +
    ` dir=(${projectile.dirX.toFixed(4)},${(projectile.dirY || 0).toFixed(4)},${projectile.dirZ.toFixed(4)})${extra}`
  );
}

function simulateProjectilesStep(stepSeconds, now) {
  const stepDistance = GAME_CONFIG.SHOT_SPEED * stepSeconds;

  projectiles.forEach((proj, id) => {
    const deltaTime = (now - proj.createdAt) / 1000;
    const prevX = proj.x;
    const prevY = proj.y;
    const prevZ = proj.z;
    const traced = traceShotThroughTeleporters(
      { x: prevX, y: prevY, z: prevZ },
      { x: proj.dirX, y: proj.dirY || 0, z: proj.dirZ },
      stepDistance,
      id,
      proj.teleportReentryBlockTeleporterIndex,
      proj.teleportReentryBlockDistance,
    );
    proj.x = traced.point.x;
    proj.y = traced.point.y;
    proj.z = traced.point.z;
    proj.dirX = traced.direction.x;
    proj.dirY = traced.direction.y;
    proj.dirZ = traced.direction.z;
    proj.teleportReentryBlockTeleporterIndex = traced.reentryBlockTeleporterIndex;
    proj.teleportReentryBlockDistance = traced.reentryBlockDistance;

    if (traced.frameHit) {
      const impact = traced.point;
      const hitName = traced.frameHitObstacle?.name || 'teleporter frame';
      log(`Projectile ${id} hit obstacle "${hitName}" at (${impact.x.toFixed(2)}, ${impact.y.toFixed(2)}, ${impact.z.toFixed(2)})`);
      logShotEnd(proj, 'frame_hit', impact, `obstacle=${hitName}`);
      projectiles.delete(id);
      broadcastAll({ type: 'shotEnd', id, reason: 0, x: impact.x, y: impact.y, z: impact.z });
      return;
    }

    // Remove if out of bounds or lifetime budget exhausted.
    // Match BZFlag semantics: shot lifetime is time-based and does not shrink
    // from teleports based on straight-line displacement from spawn.
    const halfMap = GAME_CONFIG.MAP_SIZE / 2;
    const outOfBounds = Math.abs(proj.x) > halfMap || Math.abs(proj.z) > halfMap;
    const timedOut = deltaTime > proj.lifetimeSeconds;
    if (outOfBounds || timedOut) {
      projectiles.delete(id);
      const reason = outOfBounds ? 0 : 1;
      const removalPoint = outOfBounds
        ? findMapEdgeImpactPoint(prevX, prevY, prevZ, proj.x, proj.y, proj.z, halfMap)
        : { x: proj.x, y: proj.y, z: proj.z };
      broadcastAll({ type: 'shotEnd', id, reason, x: removalPoint.x, y: removalPoint.y, z: removalPoint.z });
      if (outOfBounds) {
        logShotEnd(proj, 'out_of_bounds', removalPoint, `lifetime=${deltaTime.toFixed(3)}/${proj.lifetimeSeconds.toFixed(3)}`);
      } else {
        logShotEnd(proj, 'timeout', removalPoint, `lifetime=${deltaTime.toFixed(3)}/${proj.lifetimeSeconds.toFixed(3)}`);
      }
      log(`Projectile ${id} removed (${outOfBounds ? 'out of bounds' : 'expired'})`);
      return;
    }

    // Check collision with obstacles using checkCollision() with small projectile radius
    const projectileRadius = 0.1;
    const obstacleHit = checkCollision(proj.x, proj.y, proj.z, projectileRadius, { ignoreTeleporters: true });
    if (obstacleHit) {
      const impact = findProjectileImpactPoint(
        prevX,
        prevY,
        prevZ,
        proj.x,
        proj.y,
        proj.z,
        projectileRadius,
        { ignoreTeleporters: true },
      );
      if (obstacleHit.collisionKind === 'boundary') {
        log(`Projectile ${id} hit boundary at (${impact.x.toFixed(2)}, ${impact.y.toFixed(2)}, ${impact.z.toFixed(2)})`);
      } else {
        log(`Projectile ${id} hit obstacle "${obstacleHit.name || 'unnamed'}" at (${impact.x.toFixed(2)}, ${impact.y.toFixed(2)}, ${impact.z.toFixed(2)})`);
      }
      logShotEnd(proj, 'obstacle', impact, `obstacle=${obstacleHit.name || obstacleHit.collisionKind || 'unknown'}`);
      projectiles.delete(id);
      broadcastAll({ type: 'shotEnd', id, reason: 0, x: impact.x, y: impact.y, z: impact.z });
      return;
    }

    // Check collision with players using extrapolated positions
    players.forEach((player) => {
      if (player.id === proj.playerId) return; // Can't hit yourself
      if (player.role === 'spectator') return; // Spectators are non-combatants
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

          logShotEnd(proj, 'player_hit', { x: proj.x, y: proj.y, z: proj.z }, `victim=${player.id}`);

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

// Game loop - update projectiles and check collisions
let lastGameLoopAt = Date.now();
let projectileSimAccumulator = 0;
let lastVoiceRosterRefreshAt = 0;
function gameLoop() {

  // Advance world time (20 ticks/sec, 24000 ticks/day)
  worldTime = (worldTime + 1) % 24000;
  const now = Date.now();
  const loopDeltaSeconds = Math.min(0.1, Math.max(0, (now - lastGameLoopAt) / 1000));
  lastGameLoopAt = now;
  // No need to broadcast worldTime periodically; clients track it locally at 20 ticks/sec.

  if (now - lastVoiceRosterRefreshAt >= VOICE_ROSTER_REFRESH_INTERVAL) {
    refreshVoiceRosters();
    lastVoiceRosterRefreshAt = now;
  }

  // Simulate projectiles at a fixed step to avoid path jitter from loop timing variance.
  projectileSimAccumulator += loopDeltaSeconds;
  const maxAccumulated = SHOT_SIM_STEP_SECONDS * SHOT_SIM_MAX_STEPS_PER_LOOP;
  if (projectileSimAccumulator > maxAccumulated) {
    projectileSimAccumulator = maxAccumulated;
  }
  while (projectileSimAccumulator >= SHOT_SIM_STEP_SECONDS) {
    simulateProjectilesStep(SHOT_SIM_STEP_SECONDS, now);
    projectileSimAccumulator -= SHOT_SIM_STEP_SECONDS;
  }
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

  if (reason === 'server.js change') {
    return;
  }

  const runningUnderNodemon = process.env.NODEMON === 'true' || process.env.npm_lifecycle_event === 'dev';

  // In production (for example Docker running "node server.js"), there is no
  // nodemon watcher to react to timestamp touches. Exit so restart policies
  // relaunch the process and pick up the updated config.
  if (!runningUnderNodemon) {
    setTimeout(() => {
      log('Restarting process to apply config change...');
      process.exit(0);
    }, 1000);
    return;
  }

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

function approachNormalizedValue(currentValue, targetValue, maxStep) {
  if (!Number.isFinite(targetValue)) return Number.isFinite(currentValue) ? currentValue : 0;
  const current = Number.isFinite(currentValue) ? currentValue : 0;
  if (!Number.isFinite(maxStep) || maxStep <= 0) return current;
  const delta = targetValue - current;
  if (Math.abs(delta) <= maxStep) return targetValue;
  return current + Math.sign(delta) * maxStep;
}

// Helper to send the map list and current map to a given websocket
function sendMapList(ws) {
  ws.send(JSON.stringify({
    type: 'mapList',
    maps: listAvailableMapFiles(),
    currentMap: MAP_SOURCE
  }));
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
  const clouds = generateClouds(OBSTACLES);
  ws.send(JSON.stringify({
    type: 'init',
    player: player.getState(),
    players: Array.from(players.values()).map(p => p.getState()),
    config: GAME_CONFIG,
    voiceRtcConfig: { iceServers: VOICE_ICE_SERVERS },
    obstacles: OBSTACLES,
    teleporterGraph: TELEPORTER_GRAPH,
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

        case 'message': {
          const rawTarget = message.dst ?? message.to;
          const isAllTarget = rawTarget === 0 || rawTarget === '0' || rawTarget === null || rawTarget === undefined || rawTarget === '';
          const isServerTarget = rawTarget === -1 || rawTarget === '-1';
          const targetId = isAllTarget || isServerTarget ? Number(rawTarget) : String(rawTarget);
          const fromId = player.id;
          const fromName = player.name;
          const msgType = message.msgType === 'action' ? 'action' : 'chat';
          const text = typeof message.text === 'string' ? message.text.trim() : '';
          if (text.length === 0) break;

          function getPlayerName(id) {
            if (id === 0) return 'ALL';
            if (id === -1) return 'SERVER';
            return players.has(id) ? players.get(id).name : `Player ${id}`;
          }
          const toName = getPlayerName(targetId);

          // Log locally only if to == -1
          if (isServerTarget) {
            log(`[CHAT] ${fromName}->${toName}: ${text}`);
            break;
          }

          // Broadcast to all if to == 0
          if (isAllTarget) {
            log(`[CHAT] ${fromName}->ALL: ${text}`);
            broadcastAll({
              type: 'message',
              src: fromId,
              dst: 0,
              msgType,
              text,
              ts: Date.now(),
            });
            break;
          }

          // Send to specific player if id exists
          if (typeof targetId === 'string' && players.has(targetId)) {
            log(`[CHAT] ${fromName}->${toName}: ${text}`);
            const targetPlayer = players.get(targetId);
            const payload = {
              type: 'message',
              src: fromId,
              dst: targetId,
              msgType,
              text,
              ts: Date.now(),
            };
            if (targetPlayer && targetPlayer.ws && targetPlayer.ws.readyState === 1) {
              targetPlayer.ws.send(JSON.stringify(payload));
            }
            if (player.ws && player.ws.readyState === 1 && targetId !== fromId) {
              player.ws.send(JSON.stringify(payload));
            }
            break;
          }

          // If targetId is invalid, ignore
          break;
        }
        case 'voiceState': {
          if (!player.joined) break;
          if (message.channel && message.channel !== VOICE_CHANNEL) break;

          // Spectators are receive-only, so the server never stores an enabled
          // microphone state for them even if a client sends enabled: true.
          player.voiceMicEnabled = player.role === 'active' && message.enabled === true;
          sendNearbyVoiceState(player);
          refreshVoiceRosters();
          break;
        }
        case 'voiceOffer':
        case 'voiceAnswer':
        case 'voiceIceCandidate': {
          if (message.channel && message.channel !== VOICE_CHANNEL) break;
          forwardVoiceSignal(player, message);
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
          if (player.role === 'spectator') break;

          const now = Date.now();
          // Calculate deltaTime based on server's last update time
          const deltaTime = (now - player.lastUpdate) / 1000;
          // DON'T update player.lastUpdate here - it breaks extrapolation in validateMovement!

          // Only accept new compact field names
          const x = Number(message.x);
          const y = Number(message.y);
          const z = Number(message.z);
          const r = Number(message.r);
          const reverseSpeedRatio = Number.isFinite(GAME_CONFIG.REVERSE_SPEED_RATIO)
            ? GAME_CONFIG.REVERSE_SPEED_RATIO
            : 0.5;
          const requestedFS = Math.max(-reverseSpeedRatio, Math.min(1, Number(message.fs)));
          const requestedRS = Math.max(-1, Math.min(1, Number(message.rs)));
          let fs = requestedFS;
          let rs = requestedRS;
          const vv = Number(message.vv);
                    const enforceMovementLimits = ANTICHEAT_CONFIG.mode !== 'disabled';
                    if (enforceMovementLimits && Number.isFinite(deltaTime) && deltaTime > 0) {
                      const forwardRate = Math.abs(requestedFS) < 0.001
                        ? GAME_CONFIG.FORWARD_DECEL
                        : (requestedFS >= 0 ? GAME_CONFIG.FORWARD_ACCEL : GAME_CONFIG.REVERSE_ACCEL);
                      const turnRate = Math.abs(requestedRS) < 0.001
                        ? GAME_CONFIG.TURN_DECEL
                        : GAME_CONFIG.TURN_ACCEL;

                      fs = requestedFS === 0
                        ? 0
                        : approachNormalizedValue(player.forwardSpeed || 0, requestedFS, forwardRate * deltaTime);
                      rs = requestedRS === 0
                        ? 0
                        : approachNormalizedValue(player.rotationSpeed || 0, requestedRS, turnRate * deltaTime);

                      fs = Math.max(-reverseSpeedRatio, Math.min(1, fs));
                      rs = Math.max(-1, Math.min(1, rs));
                    } else {
                      fs = requestedFS;
                      rs = requestedRS;
                    }

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
          if (player.role === 'spectator') break;
          if (player.health <= 0) break; // Dead players can't shoot
          if (!validateShot(player, message.x, message.y, message.z)) break;
          const rawDirX = Number(message.dirX);
          const rawDirZ = Number(message.dirZ);
          const rawDirY = Number(message.dirY);
          if (!Number.isFinite(rawDirX) || !Number.isFinite(rawDirZ)) break;
          const planarLength = Math.hypot(rawDirX, rawDirZ);
          if (planarLength < 1e-6) break;
          const shotDirX = rawDirX / planarLength;
          const shotDirZ = rawDirZ / planarLength;
          const shotDirY = Number.isFinite(rawDirY) ? rawDirY : 0;
          const shotSlot = getAvailableShotSlot(player.id);
          if (shotSlot < 0) {
            log(`Player "${player.name}" had no free shot slot despite passing validation`);
            break;
          }
          player.lastShot = Date.now();
          const id = (++projectileIdCounter).toString();
          const proj = new Projectile(
            id,
            player.id,
            shotSlot,
            message.x,
            message.y,
            message.z,
            shotDirX,
            shotDirZ,
            shotDirY
          );
          projectiles.set(id, proj);
          log(
            `[SHOT_START] id=${proj.id} player=${proj.playerId} slot=${proj.shotSlot}` +
            ` pos=${formatShotPoint(proj.x, proj.y, proj.z)}` +
            ` dir=(${proj.dirX.toFixed(4)},${proj.dirY.toFixed(4)},${proj.dirZ.toFixed(4)})`
          );
          broadcastAll({
            type: 'shotBegin',
            id: proj.id,
            playerId: proj.playerId,
            x: proj.x,
            y: proj.y,
            z: proj.z,
            shotSlot: proj.shotSlot,
            dirX: proj.dirX,
            dirY: proj.dirY,
            dirZ: proj.dirZ,
            createdAt: proj.createdAt
          });
          break;
        }

        case 'selfDestruct': {
          if (player.role === 'spectator') break;
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
            ? normalizeTankModelId(message.tankModel)
            : 'bzflag';
          const requestedRole = typeof message.role === 'string'
            ? message.role.trim().toLowerCase()
            : 'active';
          player.name = joinName;
          player.tankModel = isAllowedTankModel(requestedTankModel)
            ? requestedTankModel
            : 'bzflag';
          player.role = requestedRole === 'spectator' ? 'spectator' : 'active';
          player.voiceMicEnabled = false;
          player.joined = true;
          player.voiceRosterSignature = '';
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
            log(`Player ${player.id} joining game as "${joinName}" [${player.role.toUpperCase()}] [MOBILE]`);
          } else {
            log(`Player ${player.id} joining game as "${joinName}" [${player.role.toUpperCase()}]`);
          }

          // broadcast join to all (full player info)
          broadcastAll({
            type: 'playerJoined',
            player: player.getState(),
          });
          refreshVoiceRosters(true);
          break;
        }

        case 'setTankModel': {
          const requestedTankModel = typeof message.tankModel === 'string'
            ? normalizeTankModelId(message.tankModel)
            : '';
          if (!isAllowedTankModel(requestedTankModel)) {
            ws.send(JSON.stringify({ error: 'Invalid tank model' }));
            break;
          }

          if (player.tankModel !== requestedTankModel) {
            player.tankModel = requestedTankModel;
            broadcastAll({
              type: 'playerUpdated',
              player: player.getState(),
            });
          }
          break;
        }

        case 'pause':
          if (player.role === 'spectator') break;
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
          const mapFile = typeof message.mapFile === 'string' ? message.mapFile.trim() : '';
          const safeMapFile = path.basename(mapFile);
          if (!mapFile || mapFile !== safeMapFile || (mapFile !== 'random' && !mapFile.endsWith('.bzw'))) {
            ws.send(JSON.stringify({ error: 'Invalid map file' }));
            break;
          }
          if (mapFile !== 'random') {
            const selectedMapPath = resolveMapFilePath(mapFile);
            if (!selectedMapPath) {
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
          } catch (error) {
            logError(`Failed to update config at ${configPath}:`, error);
            ws.send(JSON.stringify({ error: 'Failed to update config' }));
          }
          break;
        }
        case 'uploadMap': {
          // Admin: upload map
          const { mapName, mapContent } = message;
          const normalizedMapName = typeof mapName === 'string' ? mapName.trim() : '';
          const safeMapName = path.basename(normalizedMapName);
          if (!normalizedMapName || normalizedMapName !== safeMapName || !safeMapName.endsWith('.bzw') || !mapContent) {
            ws.send(JSON.stringify({ error: 'Invalid map upload' }));
            break;
          }
          const uploadMapPath = path.join(RUNTIME_MAPS_DIR, safeMapName);
          fs.writeFile(uploadMapPath, mapContent, err => {
            if (err) {
              logError('Map upload failed:', err);
              ws.send(JSON.stringify({ error: 'Failed to save map' }));
              return;
            }
            log(`Admin uploaded new map: ${safeMapName}`);
            ws.send(JSON.stringify({ success: true }));
            // Send direct chat message to uploader
            ws.send(JSON.stringify({
              type: 'message',
              src: -1, // SERVER
              dst: player.id,
              msgType: 'server',
              text: `Upload ${safeMapName} with ${Buffer.byteLength(mapContent, 'utf8')} bytes`
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
    player.voiceMicEnabled = false;
    player.joined = false;
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
    refreshVoiceRosters(true);
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
