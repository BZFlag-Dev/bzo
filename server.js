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
const { normalizeShotSlotCount } = require('./server/shots.cjs');
const {
  BASE_SIZE,
  BZFLAG_TANK_RADIUS,
  FLAG_ABBREVIATIONS,
  FLAG_ALTITUDE,
  FLAG_CLEARANCE,
  FLAG_ENDURANCE,
  FLAG_GRAB_LEVEL_TOLERANCE,
  FLAG_QUALITY,
  FLAG_RADIUS,
  FLAG_STATUS,
  IDENTIFY_RANGE,
  MAX_FLAG_GRABS,
  DEFAULT_WINGS_JUMP_COUNT,
  DEFAULT_WINGS_SLIDE_TIME,
  SUPER_FLAG_HALF_LIFE_SECONDS,
  canJump,
  computeFlagFlight,
  hasAirControl,
  getFlagType,
  getTeamFlagAbbreviation,
  isTeamFlag,
} = require('./server/flags.cjs');
const {
  documentTitle,
  escapeHtml,
  sanitizeHost,
  shortHostName,
} = require('./server/server-name.cjs');
const {
  getBaseTeamAtPoint,
  getBaseTopY,
  getColliderLocalPoint,
  getTankLocalAngle,
  isOverFlatTop,
  pyramidIntersectsCylinder,
  pyramidIntersectsTank,
  testOrigRectTank,
} = require('./server/collision.cjs');
const {
  normalizePlayerTeamSelection,
  parseBZWTeamMode,
  resolveTeamMode,
  selectPlayerTeam,
  getPlayerTeamColor,
  getInitialPlayerColor,
  isColorTeam,
  isObserverTeam,
  isColorTeamIndex,
  getTeamColorIndex,
  getTeamFromColorIndex,
  getTeamScoreDeltasForCapture,
  getTeamScoreDeltasForKill,
} = require('./server/teams.cjs');
const path = require('path');
const fs = require('fs');
const { isHeadsetBrowserUA } = require('./server/headset.cjs');
const {
  DEFAULT_VOICE_CHANNEL,
  areVoicePeers,
  normalizeVoiceChannel,
} = require('./server/voice-channels.cjs');


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

// Cache policy. Markup, styles and scripts must revalidate on every load: the
// client/server protocol is lockstep, so a client older than the running server
// is a desync, not a stale pixel. Only content that cannot change behaviour --
// textures, models, audio -- is cached without asking. Icons are not among
// them: a launcher captures one at install time and keeps it for the life of
// the installation, so a stale icon outlives every other kind.
const REVALIDATE = 'no-cache';
const ASSET_MAX_AGE = 604800; // 7 days

function setStaticHeaders(res, filePath) {
  if (/\.(?:html|css|js|mjs)$/.test(filePath) || filePath.includes(`${path.sep}icons${path.sep}`)) {
    res.setHeader('Cache-Control', REVALIDATE);
  } else {
    res.setHeader('Cache-Control', `public, max-age=${ASSET_MAX_AGE}`);
  }
}

// Serve Three.js from the installed dependency so the game has no third-party
// origins: an installed PWA on a headset or a LAN with no internet route still
// loads. `addons` is mounted first so the shorter path does not shadow it.
// Both directories are reached through three's own `exports` map, which is the
// only supported way in: it does not expose package.json.
const threeBuildDir = path.dirname(require.resolve('three'));
const threeAddonsDir = path.dirname(require.resolve('three/addons'));
app.use('/vendor/three/addons', express.static(threeAddonsDir, {
  setHeaders: (res) => res.setHeader('Cache-Control', REVALIDATE),
}));
app.use('/vendor/three', express.static(threeBuildDir, {
  setHeaders: (res) => res.setHeader('Cache-Control', REVALIDATE),
}));

// index.html is rendered per request so the page is named after the host before
// any script runs. iOS reads `apple-mobile-web-app-title` for a home screen
// label, so it has to be in the markup that Safari parses, not added later by
// the client. Mounted ahead of the static handler, which would otherwise serve
// the untemplated file.
const INDEX_PATH = path.join(__dirname, 'public', 'index.html');
const INDEX_TITLE = '<title>Battlezone Online</title>';
const INDEX_APPLE_TITLE = '<meta name="apple-mobile-web-app-title" content="Battlezone Online">';
let indexTemplate = null;
let indexTemplateMtime = 0;

function readIndexTemplate() {
  const { mtimeMs } = fs.statSync(INDEX_PATH);
  if (indexTemplate === null || mtimeMs !== indexTemplateMtime) {
    const html = fs.readFileSync(INDEX_PATH, 'utf8');
    for (const marker of [INDEX_TITLE, INDEX_APPLE_TITLE]) {
      if (!html.includes(marker)) {
        throw new Error(`public/index.html is missing the marker: ${marker}`);
      }
    }
    indexTemplate = html;
    indexTemplateMtime = mtimeMs;
  }
  return indexTemplate;
}

function renderIndex(host) {
  return readIndexTemplate()
    .replace(INDEX_TITLE, `<title>${escapeHtml(documentTitle(host))}</title>`)
    .replace(
      INDEX_APPLE_TITLE,
      `<meta name="apple-mobile-web-app-title" content="${escapeHtml(shortHostName(host))}">`
    );
}

// The browser sets Host from the address the player typed, so it is the name
// they expect to see. X-Forwarded-Host is not consulted: any client can send it,
// and a proxy configured as the README describes already preserves Host.
function requestHost(req) {
  return sanitizeHost(req.get('host'));
}

app.get(['/', '/index.html'], (req, res) => {
  const host = requestHost(req);
  if (!host) {
    res.status(400).type('text/plain').send('Malformed Host header');
    return;
  }
  // res.send generates an ETag for this body, so an unchanged page still costs
  // one conditional request and a bodiless 304.
  res.set('Cache-Control', REVALIDATE);
  res.type('html').send(renderIndex(host));
});

// Which icon a launcher takes from the manifest is documented nowhere and the
// platforms disagree, so log the fetches: the pair of lines names the browser
// that asked and the file it settled on.
app.use((req, res, next) => {
  if (req.path === '/manifest.webmanifest' || req.path.startsWith('/icons/')) {
    log(`[INSTALL] ${req.path} ua="${req.get('user-agent') || ''}"`);
  }
  next();
});

// Serve static files
app.use(express.static('public', { setHeaders: setStaticHeaders }));

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

// The manifest is generated per request so the installed app is named after the
// host the client asked for, verbatim. Two hosts pointing at different servers
// then install as two separately-named apps. TLS terminates at a reverse proxy
// (see README), so the forwarded header carries the host the client sent.
//
// The icons vary by browser for a second reason, in `docs/icons.md`: a phone
// launcher crops a maskable icon and needs the art padded inside it, while a
// headset library letterboxes the same file and needs it padded not at all.
app.get('/manifest.webmanifest', (req, res) => {
  const host = requestHost(req);
  if (!host) {
    res.status(400).type('text/plain').send('Malformed Host header');
    return;
  }
  const headset = isHeadsetBrowserUA(req.get('user-agent'));
  // The icon URL carries the file's own timestamp: a browser that cached an
  // icon days ago holds a response it still considers fresh, and would not ask
  // again until it expired, long after the artwork changed.
  const icon = (file, size, purpose) => ({
    src: `/icons/${file}?v=${Math.floor(fs.statSync(path.join(__dirname, 'public', 'icons', file)).mtimeMs)}`,
    sizes: `${size}x${size}`,
    type: 'image/png',
    purpose,
  });
  // A shared cache must not hand one device the other's manifest.
  res.set('Vary', 'User-Agent');
  res.set('Cache-Control', REVALIDATE);
  res.type('application/manifest+json').send(JSON.stringify({
    id: '/',
    name: host,
    short_name: shortHostName(host),
    description: serverConfig.description,
    start_url: '/',
    scope: '/',
    display: 'fullscreen',
    display_override: ['fullscreen', 'standalone', 'minimal-ui'],
    orientation: 'any',
    background_color: '#000000',
    theme_color: '#4caf50',
    categories: ['games'],
    launch_handler: { client_mode: 'focus-existing' },
    icons: [
      icon(headset ? 'tile-192.png' : 'any-192.png', 192, 'any'),
      icon(headset ? 'tile-512.png' : 'any-512.png', 512, 'any'),
      icon(headset ? 'tile-1024.png' : 'any-1024.png', 1024, 'any'),
      icon(headset ? 'tile-192.png' : 'maskable-192.png', 192, 'maskable'),
      icon(headset ? 'tile-512.png' : 'maskable-512.png', 512, 'maskable'),
    ],
  }, null, 2));
});

// AGPL §13: provide source code access to network users
app.get('/source', (req, res) => {
  res.redirect(302, 'https://github.com/timriker/bzo');
});
// --- Admin API Endpoints ---

// Errors that reach a server object have no per-socket owner. Left unhandled
// they throw the same way a socket error does.
process.on('uncaughtException', (err) => {
  logError(`Uncaught exception: ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logError(`Unhandled rejection: ${reason && reason.stack ? reason.stack : reason}`);
  process.exit(1);
});

const server = app.listen(PORT, '::', () => {
  log(`Server running on http://[::]:${PORT}`);
});

server.on('error', (err) => {
  logError(`HTTP server error: ${err.message}`);
  process.exit(1);
});

// WebSocket server
const wss = new WebSocketServer({ server });

wss.on('error', (err) => {
  logError(`WebSocket server error: ${err.message}`);
});

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
  SHOT_RELOAD_TIME: null, // ms; derived below from BZFlag's _reloadTime / maxShots
  SHOT_COOLDOWN: null, // Legacy alias used by existing client fire gating
  SHOT_MAX_ACTIVE: 1, // BZFlag maxShots default
  SHOT_RADIUS: 0.5, // BZFlag _shotRadius default
  SHOT_TAIL_LENGTH: 4.0, // BZFlag _shotTailLength default
  SHOTS_KEEP_VERTICAL_VELOCITY: false, // BZFlag _shotsKeepVerticalVelocity default
  MAX_SPEED_TOLERANCE: 1.5, // Allow 50% tolerance for latency
  SHOT_POSITION_TOLERANCE: 2, // Max distance shot can be from claimed position
  PAUSE_COUNTDOWN: 2000, // ms
  RESPAWN_DELAY: 5000, // ms; BZFlag _explodeTime, which is also its _rejoinTime
  JUMP_VELOCITY: 19, // BZFlag _jumpVelocity default
  GRAVITY: 9.8, // BZFlag _gravity magnitude (units per second squared)
  // Wings' four BZDB variables. Locked upstream, which means the server sets
  // them and the client obeys, so they travel with the rest of the world's
  // physics. The two nulls are upstream's own defaults, which are the strings
  // "_jumpVelocity" and "_gravity" rather than numbers; they are resolved to the
  // world's values below.
  WINGS_JUMP_COUNT: DEFAULT_WINGS_JUMP_COUNT, // BZFlag _wingsJumpCount
  WINGS_JUMP_VELOCITY: null, // BZFlag _wingsJumpVelocity; defaults to JUMP_VELOCITY
  WINGS_GRAVITY: null, // BZFlag _wingsGravity magnitude; defaults to GRAVITY
  WINGS_SLIDE_TIME: DEFAULT_WINGS_SLIDE_TIME, // BZFlag _wingsSlideTime
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
  // The server must be strictly more permissive than the client, or it rejects
  // moves an unmodified client legitimately made. Move packets quantize
  // position to 0.01 (client.js sends toFixed(2)), which is ~0.007 of radial
  // error in the XZ plane -- far more than the ~0.001 margin the client keeps
  // when it slides along a surface. Without slack the server rejects most of a
  // slide and the player rubber-bands down every slope.
  collisionSlack: serverConfig.antiCheat?.collisionSlack ?? 0.05,
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

// `?? NaN` because Number(null) is 0, and a config that spells a key out as null
// is asking for the default rather than for zero.
const configWingsJumpCount = Number(serverConfig.wingsJumpCount ?? NaN);
if (Number.isInteger(configWingsJumpCount) && configWingsJumpCount >= 0) {
  GAME_CONFIG.WINGS_JUMP_COUNT = configWingsJumpCount;
}

const configWingsJumpVelocity = Number(serverConfig.wingsJumpVelocity ?? NaN);
if (Number.isFinite(configWingsJumpVelocity) && configWingsJumpVelocity >= 0) {
  GAME_CONFIG.WINGS_JUMP_VELOCITY = configWingsJumpVelocity;
}

const configWingsGravity = Number(serverConfig.wingsGravity ?? NaN);
if (Number.isFinite(configWingsGravity) && configWingsGravity > 0) {
  GAME_CONFIG.WINGS_GRAVITY = configWingsGravity;
}

const configWingsSlideTime = Number(serverConfig.wingsSlideTime ?? NaN);
if (Number.isFinite(configWingsSlideTime) && configWingsSlideTime >= 0) {
  GAME_CONFIG.WINGS_SLIDE_TIME = configWingsSlideTime;
}

// _wingsJumpVelocity and _wingsGravity are aliases upstream, so a server that
// says nothing about them gets a wings jump identical to an ordinary one.
if (GAME_CONFIG.WINGS_JUMP_VELOCITY === null) {
  GAME_CONFIG.WINGS_JUMP_VELOCITY = GAME_CONFIG.JUMP_VELOCITY;
}
if (GAME_CONFIG.WINGS_GRAVITY === null) {
  GAME_CONFIG.WINGS_GRAVITY = GAME_CONFIG.GRAVITY;
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

// BZFlag derives both numbers from _reloadTime, which itself defaults to
// _shotRange / _shotSpeed:
//   ShotPath.cxx:48    lifetime = _reloadTime
//   LocalPlayer.cxx:1311  forceReload(_reloadTime / numShots)
// So a shot lives for the full reload time while each slot comes back after
// _reloadTime / maxShots. Firing continuously then sustains exactly maxShots in
// flight. Only derive when the operator has not pinned shotReloadTime.
if (GAME_CONFIG.SHOT_RELOAD_TIME === null) {
  const shotLifetimeMs = (GAME_CONFIG.SHOT_RANGE / GAME_CONFIG.SHOT_SPEED) * 1000;
  GAME_CONFIG.SHOT_RELOAD_TIME = shotLifetimeMs / GAME_CONFIG.SHOT_MAX_ACTIVE;
}
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
    } catch (err) {
      logError(`Failed to watch map file: ${mapPath}`, err);
    }
  }
}

// The `options` block of a BZW file carries bzfs command-line switches. Team
// mode is read out of it by the `teams` pair, because both sides need it; these
// are the ones only the server acts on, so they stay here.
//
// Returns undefined for a switch the map does not mention, so the server config
// keeps its say.
function parseBZWServerOptions(lines) {
  let inOptions = false;
  const options = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (!inOptions) {
      if (line === 'options') inOptions = true;
      continue;
    }
    if (line === 'end') {
      inOptions = false;
      continue;
    }
    const [option] = line.split(/\s+/, 1);
    // -fb: superflags may come to rest on buildings, and may spawn on them.
    if (option === '-fb') options.flagsOnBuildings = true;
    // -j: tanks may jump. bzo already defaults this on, so the switch only
    // matters on a server whose config has turned jumping off.
    if (option === '-j') options.jumping = true;
  }

  return options;
}

// Parse a BZW file and convert to obstacle format
function parseBZWMap(filename) {
  const text = fs.readFileSync(filename, 'utf8');
  const lines = text.split(/\r?\n/);
  const teamMode = parseBZWTeamMode(lines);
  const serverOptions = parseBZWServerOptions(lines);
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
    teamMode,
    serverOptions,
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

  // Place one obstacle at random, retrying until it clears the centre and every
  // obstacle already placed. Boxes and pyramids differ only in what is built.
  function placeObstacles(count, build) {
    for (let i = 0; i < count; i++) {
      for (let attempts = 0; attempts < 50; attempts++) {
        const x = (Math.random() - 0.5) * (mapSize * 0.8);
        const z = (Math.random() - 0.5) * (mapSize * 0.8);
        const w = 6 + Math.random() * 6;
        const d = 6 + Math.random() * 6;

        if (Math.sqrt(x * x + z * z) < minDistance) continue;
        if (isTooClose(x, z, w, d, obstacles)) continue;

        // Most sit on the ground; the rest float, leaving a gap to drive under.
        const grounded = Math.random() < 0.6;
        const h = grounded ? 4 + Math.random() * 4 : 3 + Math.random() * 2;
        const baseY = grounded ? 0 : 3 + Math.random() * 3;

        obstacles.push(build({ x, z, w, d, h, baseY, rotation: Math.random() * Math.PI * 2 }, i));
        break;
      }
    }
  }

  placeObstacles(numBoxes, (shape, i) => ({ ...shape, name: `O${i}`, type: 'box' }));
  placeObstacles(numPyramids, (shape, i) => ({
    ...shape,
    name: `P${i}`,
    type: 'pyramid',
    inverted: Math.random() < 0.2, // 20% chance for random inverted pyramid
  }));

  return obstacles;
}

let OBSTACLES;
let TELEPORTER_GRAPH = { teleporters: [], links: [] };
let mapTeamMode = null;
let mapServerOptions = {};
if (MAP_SOURCE === 'random') {
  OBSTACLES = generateObstacles();
  TELEPORTER_GRAPH = { teleporters: [], links: [] };
  log(`Generated ${OBSTACLES.length} random obstacles`);
} else {
  const mapData = parseBZWMap(mapPath);
  OBSTACLES = mapData.obstacles;
  TELEPORTER_GRAPH = mapData.teleporterGraph;
  mapTeamMode = mapData.teamMode;
  mapServerOptions = mapData.serverOptions;
  log(`Loaded ${OBSTACLES.length} obstacles from ${mapPath}`);
  log(`Loaded ${TELEPORTER_GRAPH.links.length} teleporter face links from ${mapPath}`);
}
const configuredMaxPlayers = Number(serverConfig.maxPlayers);
const defaultTeamLimit = Number.isInteger(configuredMaxPlayers) && configuredMaxPlayers > 0
  ? configuredMaxPlayers
  : 16;
const TEAM_MODE = resolveTeamMode(serverConfig.teamMode, mapTeamMode, defaultTeamLimit);
log(`Team mode: ${TEAM_MODE.enabled ? 'enabled' : 'disabled'}; autoTeam=${TEAM_MODE.autoTeam}; teams=${TEAM_MODE.teams.map((team) => `${team}:${TEAM_MODE.limits[team]}`).join(',')}`);

// Team scores follow bzfs: a team's score is wins minus losses, only colour
// teams keep one, and a team's tally resets when its first player joins an
// empty team (bzfs.cxx:2380) or when the world does (bzfs.cxx:1231).
const teamScores = new Map();

function getTeamScore(team) {
  let score = teamScores.get(team);
  if (!score) {
    score = { wins: 0, losses: 0 };
    teamScores.set(team, score);
  }
  return score;
}

function getTeamSizes() {
  const sizes = {};
  players.forEach((candidate) => {
    if (!candidate.joined) return;
    sizes[candidate.team] = (sizes[candidate.team] || 0) + 1;
  });
  return sizes;
}

// One entry per colour team the server offers, whatever its size: a team that
// empties mid-match keeps its score on screen until it is reset.
function getTeamScoreState() {
  const sizes = getTeamSizes();
  return TEAM_MODE.teams.filter(isColorTeam).map((team) => ({
    team,
    size: sizes[team] || 0,
    ...getTeamScore(team),
  }));
}

function broadcastTeamScores() {
  if (!TEAM_MODE.enabled) return;
  broadcastAll({ type: 'teamUpdate', teams: getTeamScoreState() });
}

// A capture moves the team score, and nothing else does outside a kill.
function recordTeamScoreForCapture(cappingTeam, cappedTeam) {
  if (!TEAM_MODE.enabled) return;
  const deltas = getTeamScoreDeltasForCapture(cappingTeam, cappedTeam);
  if (deltas.length === 0) return;
  deltas.forEach(({ team, wins, losses }) => {
    const score = getTeamScore(team);
    score.wins += wins;
    score.losses += losses;
  });
  broadcastTeamScores();
}

function recordTeamScoreForKill(killer, victim) {
  if (!TEAM_MODE.enabled || !victim) return;
  const deltas = getTeamScoreDeltasForKill(killer?.team, victim.team, killer?.id === victim.id);
  if (!deltas.length) return;
  for (const delta of deltas) {
    const score = getTeamScore(delta.team);
    score.wins += delta.wins;
    score.losses += delta.losses;
  }
  broadcastTeamScores();
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

// How high a tank can get, which is where the clouds have to start. Wings
// out-climbs an ordinary jump wherever a server raises _wingsJumpCount, because
// a flap taken at the top of the last one adds another whole apex. Upstream asks
// the same question in getMaxWorldHeight (bzfs.cxx:1264) and answers it with a
// deliberately generous over-estimate; this is the arithmetic behind it.
function getJumpApexHeight() {
  const apex = (velocity, gravity) => (velocity * velocity) / (2 * gravity);
  return Math.max(
    apex(GAME_CONFIG.JUMP_VELOCITY, GAME_CONFIG.GRAVITY),
    GAME_CONFIG.WINGS_JUMP_COUNT * apex(GAME_CONFIG.WINGS_JUMP_VELOCITY, GAME_CONFIG.WINGS_GRAVITY)
  );
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
    this.tankModel = 'bzflag';
    // Teams are server-authoritative. Observer is receive-only and non-combatant.
    this.team = 'rogue';
    this.color = getInitialPlayerColor(TEAM_MODE, this.team, () => Player.pickDistinctColor());
    this.joined = false;
    // PlayerInfo::restartOnBase. Set for every CTF spawn and after a capture.
    this.restartOnBase = false;
    // GameKeeper::Player::lastIdFlag. Which flag the Identify flag last named,
    // so the answer is sent once rather than on every position update.
    this.lastIdFlag = null;
    this.voiceMicEnabled = false;
    this.voiceChannel = DEFAULT_VOICE_CHANNEL;
    this.voiceRosterSignature = '';

    // Extrapolation state
    this.forwardSpeed = 0;
    this.rotationSpeed = 0;
    this.jumpDirection = null;
    this.slideDirection = undefined;
    this.airVelocityX = 0;
    this.airVelocityZ = 0;
    this.teleportReentryBlockTeleporterIndex = null;
    this.teleportReentryBlockDistance = 0;
    this.teleportReentryBlockUntil = 0;
    this.teleportCooldownUntil = 0;

    // Keep-alive tracking
    this.lastPongTime = Date.now();
    this.isAlive = true;

    // Anti-cheat tracking
    this.cheatWarnings = {
      linearDrift: 0,
      angularDrift: 0,
      shotRejected: 0,
      jumpRejected: 0,
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
    const spawnPos = getSpawnPosition(this);
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
    this.teleportReentryBlockTeleporterIndex = null;
    this.teleportReentryBlockDistance = 0;
    this.teleportReentryBlockUntil = 0;
    this.teleportCooldownUntil = 0;
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
      team: this.team,
      voiceMicEnabled: this.voiceMicEnabled,
      voiceChannel: this.voiceChannel,
      teleportCooldownUntil: this.teleportCooldownUntil,
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

      // Apply gravity to vertical velocity. A wings tank falls at _wingsGravity,
      // which is the world's own unless a server has said otherwise, so
      // extrapolating it at the world's would read as vertical drift.
      const gravity = hasAirControl(getPlayerFlag(this.id)?.type)
        ? GAME_CONFIG.WINGS_GRAVITY
        : GAME_CONFIG.GRAVITY;
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

// `options.rotation` selects BZFlag's two occupant shapes: a heading makes the
// occupant an oriented 2.8 x 6.0 box (Obstacle::inBox, used for tanks), and its
// absence keeps the cylinder (Obstacle::inCylinder, correct for projectiles).
function checkCollision(x, y, z, tankRadius = 2, options = {}) {
  const ignoreTeleporters = options.ignoreTeleporters === true;
  const suppressLog = options.suppressLog === true;
  const useTankBox = Number.isFinite(options.rotation);
  // Shrinks the tested radius only. Height is untouched, and the teleporter
  // portal interior keeps the full radius so slack can never make a portal
  // harder to pass through.
  const slack = Math.max(0, Math.min(options.slack || 0, tankRadius));
  const effectiveRadius = tankRadius - slack;
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
    const tankAngle = useTankBox ? getTankLocalAngle(options.rotation, obs.rotation) : 0;
    const hitsRect = (rectHalfW, rectHalfD, rectSlack) => (useTankBox
      ? testOrigRectTank(rectHalfW, rectHalfD, localX, localZ, tankAngle, rectSlack)
      : getBoxCollisionDistanceSquared(localX, localZ, rectHalfW, rectHalfD)
        < (tankRadius - rectSlack) * (tankRadius - rectSlack));

    if (obs.type === 'box' || !obs.type) {
      // Teleporter boxes are only solid on the frame. The inner active portal
      // area must remain non-colliding so crossing can trigger teleport.
      if (obs?.kind === 'teleporter') {
        const dims = getShotTeleporterDims(obs);
        if (hitsRect(dims.halfW, dims.halfD, slack)) {
          const activeBaseY = obstacleBase;
          const activeTopY = obstacleBase + dims.activeH;
          const overlapsActiveVertical = tankTop > (activeBaseY + epsilon) && y < (activeTopY - epsilon);
          // The portal interior keeps the full shape, so slack can never make a
          // portal harder to pass through.
          const inPortalInterior = overlapsActiveVertical
            && hitsRect(dims.halfW, dims.activeHalfD, 0);
          if (inPortalInterior) {
            continue;
          }

          if (!suppressLog) {
            log(`[COLLISION] ${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)} ${obs.name}:${obs.type} ${obs.x.toFixed(2)},${obstacleBase.toFixed(2)},${obs.z.toFixed(2)} rot:${(obs.rotation || 0).toFixed(2)}, h:${obstacleHeight.toFixed(2)}, top:${obstacleTop.toFixed(2)}`);
          }
          return obs;
        }
      } else {
        if (hitsRect(halfW, halfD, slack)) {
          if (!suppressLog) {
            log(`[COLLISION] ${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)} ${obs.name}:${obs.type} ${obs.x.toFixed(2)},${obstacleBase.toFixed(2)},${obs.z.toFixed(2)} rot:${(obs.rotation || 0).toFixed(2)}, h:${obstacleHeight.toFixed(2)}, top:${obstacleTop.toFixed(2)}`);
          }
          return obs;
        }
      }
    } else if (obs.type === 'pyramid') {
      // Mirrors BZFlag PyramidBuilding::inBox: the pyramid's cross-section at
      // the occupant's height is the base rectangle scaled by shrinkFactor.
      // The previous 8-point sample never consulted obs.inverted, so the server
      // treated every inverted pyramid as upright and disagreed with the client
      // about roughly a fifth of the volume around it.
      const hitsPyramid = useTankBox
        ? pyramidIntersectsTank(obs, x, y, z, options.rotation, tankHeight, slack)
        : pyramidIntersectsCylinder(obs, x, y, z, effectiveRadius, tankHeight);
      if (hitsPyramid) {
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

// RandomSpawnPolicy::getPosition. A player waiting to restart at base spawns on
// a random point of one of their own team's bases, which is every spawn in CTF
// and every spawn after a capture; everyone else spawns anywhere valid.
function getSpawnPosition(player) {
  const testSpawn = getTestSpawn(player.name);
  if (testSpawn) return testSpawn;

  if (player.restartOnBase) {
    player.restartOnBase = false;
    const base = getRandomTeamBase(getTeamColorIndex(player.team));
    if (base) {
      return { ...getRandomBasePosition(base), rotation: Math.random() * Math.PI * 2 };
    }
  }
  return findValidSpawnPosition();
}

// A fixed spawn for automated collision testing, so a probe always starts at a
// known distance from known geometry instead of somewhere random. Set
// `testSpawn` in server.json to enable; it is absent from example-server.json,
// so a normal server never has one.
function getTestSpawn(name) {
  const spawn = serverConfig.testSpawn;
  if (!spawn || spawn.name !== name) return null;
  return {
    x: Number(spawn.x) || 0,
    y: Number(spawn.y) || 0,
    z: Number(spawn.z) || 0,
    rotation: Number(spawn.rotation) || 0,
  };
}

function findValidSpawnPosition(tankRadius = 2) {
  const halfMap = GAME_CONFIG.MAP_SIZE / 2;
  const maxAttempts = 100;
  const y = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const x = Math.random() * (GAME_CONFIG.MAP_SIZE - tankRadius * 4) - (halfMap - tankRadius * 2);
    const z = Math.random() * (GAME_CONFIG.MAP_SIZE - tankRadius * 4) - (halfMap - tankRadius * 2);
    const rotation = Math.random() * Math.PI * 2;

    if (!checkCollision(x, y, z, tankRadius, { rotation })) {
      return { x, y, z, rotation };
    }
  }

  // If we couldn't find a valid position after many attempts, return a safe default
  return { x: 0, y: 0, z: 0, rotation: 0 };
}

// Validate player movement
function validateMovement(player, newX, newY, newZ, newRotation, deltaTime, velocityChanged = false, options = {}) {
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
  const ignoreTeleporters = options.ignoreTeleporters === true;
  let collision = checkCollision(newX, newY, newZ, 2, {
    ignoreTeleporters,
    rotation: newRotation,
    slack: ANTICHEAT_CONFIG.collisionSlack
  });
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
// Every rejection here is a client/server inconsistency: an unmodified client
// never fires a shot the server refuses. Return the reason so the caller can log
// all of them the same way rather than some paths logging and others going
// quiet. Returns null when the shot is good.
function getShotRejection(player, shotX, shotY, shotZ) {
  // Shot originates from barrel end, which is ~3 units from tank center
  const barrelLength = 3.0;
  const now = Date.now();

  if (player.team === 'observer') {
    return 'observer cannot shoot';
  }

  if (player.health <= 0) {
    return `dead player cannot shoot (health=${player.health})`;
  }

  // Fire rate is limited by shot slots alone, matching bzfs: GameKeeper.cxx
  // addShot() rejects a shot only when its own slot is still live, and there is
  // no elapsed-time check. Slots each expire independently a full shot lifetime
  // after they were filled, so consecutive shots never share a timer and network
  // jitter cannot make an honest shot look early. See the slot check below.

  // Use extrapolated position, not stored position
  const extrapolated = player.getExtrapolatedPosition(now);
  const dist = distance(extrapolated.x, extrapolated.z, shotX, shotZ);

  // NOTE: bzfs is far more permissive here. bzfs.cxx shotFired() allows
  // (tankSpeed * _velocityAd + 2 * _muzzleFront), tens of units, deliberately
  // absorbing a frame of tank motion and flag effects. bzo allows ~5. Watch the
  // ANTICHEAT log for position rejections during testing and widen this if
  // honest shots are being refused.
  if (dist > barrelLength + GAME_CONFIG.SHOT_POSITION_TOLERANCE) {
    return `shot from invalid position: ${dist.toFixed(2)} units from the barrel,`
      + ` limit ${(barrelLength + GAME_CONFIG.SHOT_POSITION_TOLERANCE).toFixed(2)}`
      + ` (extrapolated ${formatShotPoint(extrapolated.x, extrapolated.y, extrapolated.z)},`
      + ` shot ${formatShotPoint(shotX, shotY, shotZ)})`;
  }

  let activeShotCount = 0;
  projectiles.forEach((proj) => {
    if (proj.playerId === player.id) activeShotCount++;
  });

  if (activeShotCount >= GAME_CONFIG.SHOT_MAX_ACTIVE) {
    return `exceeded active shot slots (${activeShotCount}/${GAME_CONFIG.SHOT_MAX_ACTIVE})`;
  }

  return null;
}

// A rejected shot means the client believed it could fire and the server did
// not. That is the same class of client/server disagreement the drift checks
// report, so it is counted and reported the same way.
function logShotRejection(player, reason, message) {
  player.cheatWarnings.shotRejected++;
  player.cheatWarnings.totalWarnings++;
  player.cheatWarnings.lastWarningTime = Date.now();

  log(
    `[ANTICHEAT:${ANTICHEAT_CONFIG.mode.toUpperCase()}] Player "${player.name}" SHOT REJECTED:`
    + ` ${reason} | Warnings: ${player.cheatWarnings.totalWarnings}`
  );
  log(
    `  player=${player.id} at=${formatShotPoint(player.x, player.y, player.z)}`
    + ` sent=${formatShotPoint(Number(message.x), Number(message.y), Number(message.z))}`
    + ` dir=(${Number(message.dirX)},${Number(message.dirY)},${Number(message.dirZ)})`
  );
}

// LocalPlayer::doJump refuses the jump on the client, so an unmodified client
// never sends one from a tank that may not leave the ground. bzfs does not check
// this at all -- upstream trusts the client with jumping entirely -- but bzo's
// server is where the anti-cheat line is drawn, and free flight on a no-jump
// world is a larger prize than a little position drift.
function logJumpRejection(player, flagType) {
  player.cheatWarnings.jumpRejected++;
  player.cheatWarnings.totalWarnings++;
  player.cheatWarnings.lastWarningTime = Date.now();

  log(
    `[ANTICHEAT:${ANTICHEAT_CONFIG.mode.toUpperCase()}] Player "${player.name}" JUMP REJECTED:`
    + ` jumping is off and the tank carries ${flagType || 'no flag'}`
    + ` | Warnings: ${player.cheatWarnings.totalWarnings}`
  );
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

// --- Flags -------------------------------------------------------------
//
// Mirrors bzfs: the server owns every flag, and the client animates a flight
// from the numbers that came with the event that started it. See
// docs/flags-plan.md, and FlagInfo.cxx / bzfs.cxx upstream.
//
// A superflag lying on the ground is sent with `type: null`, because bzfs hides
// the identity of an unheld superflag from every client (bzfs.cxx:361). Picking
// one up reveals it to everyone.

// The radius the flag drop test uses for its clearance cylinder, and the step it
// walks that cylinder in. DropGeometry uses the tank radius; bzo's is 2.
const FLAG_DROP_TEST_RADIUS = 2;
// launchPosition sits on top of the tank, not at its feet. Upstream reads
// tankHeight from BZDB; bzo's tanks are 2 units tall.
const FLAG_LAUNCH_TANK_HEIGHT = 2;

// Team bases, as bzfs keeps them in its `bases` map. A BZW `base` object carries
// a BZFlag colour index, which parseBZWMap already clamps to 1-4.
let BASES_BY_TEAM = new Map();

function rebuildTeamBases(obstacles = OBSTACLES) {
  BASES_BY_TEAM = new Map();
  obstacles.forEach((obs) => {
    if (obs.kind !== 'base') return;
    const bases = BASES_BY_TEAM.get(obs.team) || [];
    bases.push(obs);
    BASES_BY_TEAM.set(obs.team, bases);
  });
}

function getTeamBases(colorIndex) {
  return BASES_BY_TEAM.get(colorIndex) || [];
}

function getRandomTeamBase(colorIndex) {
  const bases = getTeamBases(colorIndex);
  return bases.length === 0 ? null : bases[Math.floor(Math.random() * bases.length)];
}

// TeamBase::getRandomPosition. A point on the base's top surface, kept a tank
// radius clear of its edges.
function getRandomBasePosition(base) {
  const spanX = Math.max(0, base.w - (2 * FLAG_DROP_TEST_RADIUS));
  const spanZ = Math.max(0, base.d - (2 * FLAG_DROP_TEST_RADIUS));
  const localX = spanX * (Math.random() - 0.5);
  const localZ = spanZ * (Math.random() - 0.5);
  const rotated = rotateXZ(localX, localZ, -(base.rotation || 0));
  return {
    x: base.x + rotated.x,
    y: getBaseTopY(base),
    z: base.z + rotated.z,
  };
}

rebuildTeamBases(OBSTACLES);
// ClassicCTF upstream. Team flags need both a team game and bases to stand on,
// so a team-mode map with no bases plays without them.
const CTF_ENABLED = TEAM_MODE.enabled && BASES_BY_TEAM.size > 0;
// World::allowJumping, upstream's -j. Upstream has jumping off until the switch
// turns it on; bzo has had it on since before there was a switch, so the default
// stays on and `jumping: false` in server.json is what turns it off. A map's
// `-j` can still turn it back on, because a bzfs switch never turns anything
// off. With jumping on the `JP` flag has nothing to offer and is forbidden, and
// with it off `JP` is the only way a tank leaves the ground -- except `WG`,
// which never asks.
const ALLOW_JUMPING = serverConfig.jumping !== false || mapServerOptions.jumping === true;
GAME_CONFIG.ALLOW_JUMPING = ALLOW_JUMPING;
// CmdLineOptions.cxx:1705. Upstream drops a flag that contradicts the game style
// from the pool outright rather than leaving it to confuse people. It forbids
// `NJ` the other way round; bzo has no `NJ` yet.
const FORBIDDEN_FLAGS = ALLOW_JUMPING ? ['JP'] : [];
// -fb upstream. Whether a superflag may spawn on, and come to rest on, a
// building. A map's `options` block may turn it on; nothing turns it back off,
// which is how a bzfs switch behaves.
const FLAGS_ON_BUILDINGS = mapServerOptions.flagsOnBuildings === true
  || serverConfig.flagsOnBuildings === true;

// -tft upstream. How long a team flag survives once its team has emptied and
// nobody is carrying it.
const configuredTeamFlagTimeout = Number(serverConfig.teamFlagTimeout);
const TEAM_FLAG_TIMEOUT_SECONDS = Number.isFinite(configuredTeamFlagTimeout) && configuredTeamFlagTimeout >= 0
  ? configuredTeamFlagTimeout
  : 30;

const flags = [];
// Colour index -> when that team's abandoned flag stops existing.
const teamFlagTimeouts = new Map();
let nextSuperFlagInsertionAt = 0;

function isTeamEmpty(colorIndex) {
  const team = getTeamFromColorIndex(colorIndex);
  for (const candidate of players.values()) {
    if (candidate.joined && candidate.team === team) return false;
  }
  return true;
}

// +s/-s upstream: how many superflag slots the world carries, and which types
// may fill them. Upstream needs the switch to have any superflags at all; bzo
// defaults them on, and defaults `allowed` to every superflag in the shared
// flag table.
function normalizeSuperFlagConfig(value) {
  const requestedCount = Number(value?.count);
  const count = Number.isInteger(requestedCount) && requestedCount >= 0 ? requestedCount : 16;
  const requestedTypes = Array.isArray(value?.allowed) ? value.allowed : FLAG_ABBREVIATIONS;
  const allowed = requestedTypes
    .map((abbreviation) => (typeof abbreviation === 'string' ? abbreviation.trim().toUpperCase() : ''))
    .filter((abbreviation) => getFlagType(abbreviation) && !isTeamFlag(abbreviation))
    .filter((abbreviation) => !FORBIDDEN_FLAGS.includes(abbreviation));
  return {
    count: allowed.length > 0 ? count : 0,
    allowed: allowed.length > 0 ? allowed : [],
  };
}

const SUPER_FLAGS = normalizeSuperFlagConfig(serverConfig.superFlags);

// DropGeometry::dropFlag tests a tank-radius cylinder _flagHeight tall, so a
// spawning flag never appears somewhere a tank could not drive to reach it.
// checkCollision tests a box as tall as the radius it is handed, so the cylinder
// is walked in those steps.
//
// Only spawning uses this. A drop goes through dropTeamFlag, whose radius is 0
// and which upstream's own comment calls "not a real clearance check".
function hasFlagClearance(x, y, z) {
  for (let offset = 0; offset < FLAG_CLEARANCE; offset += FLAG_DROP_TEST_RADIUS) {
    if (checkCollision(x, y + offset, z, FLAG_DROP_TEST_RADIUS, { suppressLog: true })) return false;
  }
  return true;
}

// resetFlag() for a flag with no team: a random spot with room for the flag and
// for a tank to reach it. Upstream picks a random altitude as well as a random
// x and y, and lets the downward ray decide which surface under it the flag
// actually settles on. With flags on buildings off it passes maxZ = 0 instead,
// which skips the ray and forces the ground.
function findFlagSpawnPosition() {
  const span = Math.max(1, GAME_CONFIG.MAP_SIZE - BASE_SIZE);
  const maxHeight = getMaxObstacleTopY(OBSTACLES);
  for (let attempt = 0; attempt < 10000; attempt++) {
    const x = span * (Math.random() - 0.5);
    const z = span * (Math.random() - 0.5);
    const y = FLAGS_ON_BUILDINGS
      ? findFlagLandingY(x, z, maxHeight * Math.random())
      : 0;
    if (hasFlagClearance(x, y, z)) return { x, y, z };
  }
  log('Unable to position flags on this world.');
  return { x: 0, y: 0, z: 0 };
}

function getFlagOwner(flag) {
  return flag.owner === null ? null : players.get(flag.owner) || null;
}

// FlagInfo::pack. A superflag nobody is holding goes out without its type.
function getFlagState(flag, now = Date.now()) {
  const hidden = flag.owner === null && flag.team === null;
  const flightTime = flag.flightStartedAt === 0
    ? 0
    : Math.min(flag.flightEnd, (now - flag.flightStartedAt) / 1000);
  return {
    index: flag.index,
    type: hidden ? null : flag.type,
    status: flag.status,
    owner: flag.owner,
    position: { ...flag.position },
    launchPosition: { ...flag.launchPosition },
    landingPosition: { ...flag.landingPosition },
    flightTime,
    flightEnd: flag.flightEnd,
    initialVelocity: flag.initialVelocity,
  };
}

function getFlagStates() {
  const now = Date.now();
  return flags.filter((flag) => flag.status !== FLAG_STATUS.NO_EXIST).map((flag) => getFlagState(flag, now));
}

function broadcastFlagUpdate(flag) {
  broadcastAll({ type: 'flagUpdate', flags: [getFlagState(flag)] });
}

// FlagInfo::addFlag, which only ever runs for a superflag slot: a team flag has
// a fixed identity and simply appears at its base. The flag enters the world
// hovering at _flagAltitude, fades in, then falls to the ground.
function addFlag(flag) {
  const flight = computeFlagFlight(FLAG_ALTITUDE, GAME_CONFIG.GRAVITY);
  flag.type = SUPER_FLAGS.allowed[Math.floor(Math.random() * SUPER_FLAGS.allowed.length)];
  flag.status = FLAG_STATUS.COMING;
  flag.owner = null;
  flag.launchPosition = { ...flag.position };
  flag.landingPosition = { ...flag.position };
  flag.flightEnd = flight.flightEnd;
  flag.initialVelocity = flight.initialVelocity;
  flag.flightStartedAt = Date.now();
  // A bad flag is sticky and can only be shaken off; a good one may be dropped
  // freely and survives _maxFlagGrabs pickups.
  const type = getFlagType(flag.type);
  flag.endurance = type.quality === FLAG_QUALITY.BAD ? FLAG_ENDURANCE.STICKY : FLAG_ENDURANCE.UNSTABLE;
  flag.grabs = flag.endurance === FLAG_ENDURANCE.STICKY ? 1 : MAX_FLAG_GRABS;
}

// resetFlag(). Takes the flag off whoever holds it and sends it home: a team
// flag to the centre of the top of one of its team's bases, a superflag slot to
// a fresh random spot with its identity cleared for the insertion schedule.
function resetFlag(flag) {
  if (flag.status === FLAG_STATUS.ON_TANK) sendFlagDrop(flag);
  flag.owner = null;
  flag.flightStartedAt = 0;

  if (flag.team === null) {
    flag.position = findFlagSpawnPosition();
    flag.type = null;
    flag.status = FLAG_STATUS.NO_EXIST;
  } else {
    // getFlagSpawnPoint upstream. With no flag spawn zones the flag returns to
    // the centre of the top of one of its team's bases.
    const base = getRandomTeamBase(flag.team);
    flag.position = base
      ? { x: base.x, y: getBaseTopY(base), z: base.z }
      : { x: 0, y: 0, z: 0 };
    // A team flag is `required`, so it does not fly in -- it simply appears.
    // While its team has nobody on it, it stays out of the world entirely.
    flag.status = isTeamEmpty(flag.team) ? FLAG_STATUS.NO_EXIST : FLAG_STATUS.ON_GROUND;
  }

  flag.launchPosition = { ...flag.position };
  flag.landingPosition = { ...flag.position };
  broadcastFlagUpdate(flag);
}

// zapFlag(). The flag does not fly anywhere -- it stops existing where it is,
// and resetFlag decides where it belongs next.
function zapFlag(flag) {
  sendFlagDrop(flag);
  flag.status = FLAG_STATUS.NO_EXIST;
  flag.flightStartedAt = 0;
  resetFlag(flag);
}

// DropGeometry::dropIt with maxZ unbounded, which is what every drop passes: a
// downward ray from the drop point to the highest flat top at or below it, or
// the ground. `flagsOnBuildings` does not gate this -- it gates the maxZ that
// resetFlag passes when choosing where a flag *spawns*, and for a drop it only
// decides whether a superflag is allowed to stay where the ray put it.
function findFlagLandingY(x, z, fromY) {
  let landingY = 0;
  for (const obs of getCollisionColliders()) {
    // isValidLanding() skips anything a tank can drive through, and the world
    // boundary is not somewhere a flag belongs.
    if (obs.collisionKind === 'boundary' || obs.kind === 'teleporter') continue;
    const top = (obs.baseY || 0) + (obs.h || 0);
    if (top > fromY || top <= landingY) continue;
    if (!isOverFlatTop(obs, x, z)) continue;
    landingY = top;
  }
  return landingY;
}

// isOpposingTeam(). A team flag may not come to rest on another team's base:
// anyone picking it up there would instantly have carried their own team flag
// into enemy territory and blown up their whole team.
function isOpposingBaseAt(position, colorIndex) {
  const baseTeam = getBaseTeamAtPoint(OBSTACLES, position.x, position.y, position.z);
  return baseTeam !== null && baseTeam !== colorIndex;
}

// bzfs.cxx:3820. The timeout starts when the last held flag of an already empty
// team is dropped. It is the only thing that clears a team flag an enemy carried
// off before that team emptied.
function startTeamFlagTimeoutIfAbandoned(flag) {
  if (!isTeamEmpty(flag.team)) return;
  const stillCarried = flags.some((other) => (
    other !== flag && other.team === flag.team && other.owner !== null
  ));
  if (stillCarried) return;
  teamFlagTimeouts.set(flag.team, Date.now() + (TEAM_FLAG_TIMEOUT_SECONDS * 1000));
}

// bzfs.cxx:2478. The first player on a team brings its flag back into the world.
function resetTeamFlags(colorIndex) {
  if (!CTF_ENABLED) return;
  teamFlagTimeouts.delete(colorIndex);
  flags.forEach((flag) => {
    if (flag.team !== colorIndex) return;
    if (flag.status !== FLAG_STATUS.NO_EXIST) return;
    resetFlag(flag);
  });
}

// bzfs.cxx:2966. The last player leaving a team takes its flag out of the world,
// unless an enemy is carrying it -- then the timeout above deals with it.
function retireTeamFlags(colorIndex) {
  if (!CTF_ENABLED) return;
  if (colorIndex === null) return;
  if (!isTeamEmpty(colorIndex)) return;
  flags.forEach((flag) => {
    if (flag.team !== colorIndex) return;
    if (flag.status === FLAG_STATUS.NO_EXIST) return;
    const owner = getFlagOwner(flag);
    if (owner && getTeamColorIndex(owner.team) !== colorIndex) return;
    zapFlag(flag);
  });
}

// sendDrop(). Detaches the flag from its holder without moving it; the callers
// decide where it goes next. The state is packed before the owner is cleared
// because MsgDropFlag names the flag -- upstream's pack() defaults to not
// hiding -- and only the flagUpdate that follows makes it anonymous again.
function sendFlagDrop(flag) {
  const owner = getFlagOwner(flag);
  const state = getFlagState(flag);
  flag.owner = null;
  if (!owner) return;
  broadcastAll({ type: 'dropFlag', playerId: owner.id, flag: state });
}

function getPlayerFlag(playerId) {
  return flags.find((flag) => flag.owner === playerId) || null;
}

// grabFlag(). The client sweeps for flags it is driving over and asks; this
// check exists to catch a modified client, so it uses upstream's deliberately
// loose radius -- a tank's whole second of travel plus both radii -- and only
// rejects a distant grab when the two are on the same level, as bzfs does.
function grabFlag(player, flag) {
  if (player.team === 'observer') return;
  if (player.health <= 0 || player.paused) return;
  if (getPlayerFlag(player.id)) return;
  if (flag.status !== FLAG_STATUS.ON_GROUND) return;

  const reach = GAME_CONFIG.TANK_SPEED + BZFLAG_TANK_RADIUS + FLAG_RADIUS;
  const extrapolated = player.getExtrapolatedPosition(Date.now());
  const gap = distance(extrapolated.x, extrapolated.z, flag.position.x, flag.position.z);
  if (Math.abs(extrapolated.y - flag.position.y) < FLAG_GRAB_LEVEL_TOLERANCE && gap > reach) {
    log(
      `[ANTICHEAT:${player.name}] FLAG GRAB REJECTED flag ${flag.index} ` +
      `${flag.position.x.toFixed(2)},${flag.position.z.toFixed(2)} is ${gap.toFixed(2)} away`
    );
    return;
  }

  flag.owner = player.id;
  flag.status = FLAG_STATUS.ON_TANK;
  flag.flightStartedAt = 0;
  log(`Player "${player.name}" grabbed ${getFlagType(flag.type).name} flag ${flag.index}`);
  broadcastAll({ type: 'grabFlag', playerId: player.id, flag: getFlagState(flag) });
}

// searchFlag(). The whole of the Identify flag: while a player carries `ID`,
// name the nearest flag resting on the ground within `_identifyRange` for them
// alone. Runs off each accepted position update, as upstream runs it off
// MsgPlayerUpdate, so it costs nothing for a player who is not moving.
//
// A flag's identity stays hidden in `flagUpdate` regardless. Identify tells its
// carrier what one flag is; it does not reveal that flag to the world.
function searchFlag(player) {
  const playerFlag = getPlayerFlag(player.id);
  if (playerFlag?.type !== 'ID') {
    // Upstream leaves lastIdFlag alone here, so re-taking Identify beside the
    // same flag stays silent. Clearing it means the answer arrives again, which
    // is what a player who just picked the flag up is waiting for.
    player.lastIdFlag = null;
    return;
  }
  if (player.health <= 0 || player.paused) return;

  let closest = null;
  let closestDistanceSquared = IDENTIFY_RANGE * IDENTIFY_RANGE;
  for (const flag of flags) {
    if (flag.status !== FLAG_STATUS.ON_GROUND) continue;
    const dx = player.x - flag.position.x;
    const dy = player.y - flag.position.y;
    const dz = player.z - flag.position.z;
    const distanceSquared = (dx * dx) + (dy * dy) + (dz * dz);
    if (distanceSquared >= closestDistanceSquared) continue;
    closestDistanceSquared = distanceSquared;
    closest = flag;
  }

  if (!closest) {
    player.lastIdFlag = null;
    return;
  }
  // One message per flag, not one per update: the answer only changes when a
  // different flag becomes the nearest one.
  if (closest.index === player.lastIdFlag) return;
  player.lastIdFlag = closest.index;
  sendToPlayer(player, {
    type: 'nearFlag',
    index: closest.index,
    flagType: closest.type,
    position: { ...closest.position },
  });
}

// dropFlag(). Upstream takes the drop position from the client because the
// server's copy lags; bzo uses its own, which is already movement-validated.
function dropFlag(flag) {
  if (flag.status !== FLAG_STATUS.ON_TANK) return;
  const owner = getFlagOwner(flag);
  if (!owner) return;

  const half = GAME_CONFIG.MAP_SIZE / 2;
  const launch = {
    x: (owner.x < -half || owner.x > half) ? 0 : owner.x,
    y: owner.y + FLAG_LAUNCH_TANK_HEIGHT,
    z: (owner.z < -half || owner.z > half) ? 0 : owner.z,
  };
  const teamFlag = flag.team !== null;
  // Both kinds ride the same downward ray, cast from the tank's feet rather than
  // from the flag's launch altitude: dropIt gets `dropPos` while
  // FlagInfo::dropFlag adds the tank height to the launch point separately.
  let landing = {
    x: launch.x,
    y: findFlagLandingY(launch.x, launch.z, owner.y),
    z: launch.z,
  };
  let vanish = false;

  if (teamFlag) {
    // A team flag never vanishes, so when it has nowhere safe to land upstream
    // works down a chain: a drop zone, which bzo has none of, then the world
    // centre, then its own base.
    if (isOpposingBaseAt(landing, flag.team)) {
      const centre = { x: 0, y: 0, z: 0 };
      if (isOpposingBaseAt(centre, flag.team)) {
        const base = getRandomTeamBase(flag.team);
        landing = base ? { x: base.x, y: getBaseTopY(base), z: base.z } : centre;
      } else {
        landing = centre;
      }
    }
    startTeamFlagTimeoutIfAbandoned(flag);
  } else {
    // A good superflag has a limited number of grabs in it. With flags on
    // buildings off -- upstream's default -- one dropped anywhere but the ground
    // also has nowhere it is allowed to stay, so it rises out of the world from
    // wherever the ray put it rather than falling to the floor.
    flag.grabs -= 1;
    if (flag.grabs <= 0) {
      vanish = true;
      flag.grabs = 0;
    } else if (!FLAGS_ON_BUILDINGS && landing.y > 0) {
      vanish = true;
    }
  }

  const flight = computeFlagFlight(FLAG_ALTITUDE, GAME_CONFIG.GRAVITY);
  flag.status = vanish ? FLAG_STATUS.GOING : FLAG_STATUS.IN_AIR;
  flag.launchPosition = launch;
  flag.landingPosition = landing;
  flag.position = { ...landing };
  flag.flightEnd = flight.flightEnd;
  flag.initialVelocity = flight.initialVelocity;
  flag.flightStartedAt = Date.now();
  log(
    `Player "${owner.name}" dropped ${getFlagType(flag.type).name} flag ${flag.index} ` +
    `at ${landing.x.toFixed(2)},${landing.z.toFixed(2)}${vanish ? ' (vanishing)' : ''}`
  );

  sendFlagDrop(flag);
  broadcastFlagUpdate(flag);
}

// captureFlag(). Either an enemy flag brought onto the player's own base, or the
// player's own flag carried onto an enemy base. `baseColorIndex` is the base the
// client says it reached; the team that loses the flag is always the flag's own,
// so capturing your own flag costs your team and wins nobody anything.
function captureFlag(player, baseColorIndex) {
  const flag = getPlayerFlag(player.id);
  if (!flag || flag.team === null) return;
  if (player.health <= 0 || player.paused) return;
  const cappingIndex = getTeamColorIndex(player.team);
  if (!isColorTeam(player.team)) return;

  // Upstream's cheat check only logs, and so does this one: a legitimate capture
  // and a quantized position are hard to tell apart, and refusing an honest one
  // is worse than trusting a modified client about a base it has to drive to.
  const standingOn = getBaseTeamAtPoint(OBSTACLES, player.x, player.y, player.z);
  if (standingOn !== baseColorIndex) {
    log(
      `[ANTICHEAT:${player.name}] CAPTURE CLAIMED base ${baseColorIndex} ` +
      `while standing on ${standingOn === null ? 'no base' : standingOn}`
    );
  }

  const cappedIndex = flag.team;
  const cappedTeam = getTeamFromColorIndex(cappedIndex);
  const ownGoal = cappedIndex === cappingIndex;
  log(
    `Player "${player.name}" captured the ${cappedTeam} flag ` +
    `on the ${getTeamFromColorIndex(baseColorIndex)} base${ownGoal ? ' (their own)' : ''}`
  );

  // The flag goes home first, as upstream does it, so the drop that detaches it
  // reaches the client before the capture that explains it and before any client
  // respawns on the base it now sits on.
  resetFlag(flag);
  broadcastAll({
    type: 'captureFlag',
    playerId: player.id,
    index: flag.index,
    flagTeam: cappedIndex,
    baseTeam: baseColorIndex,
  });
  recordTeamScoreForCapture(ownGoal ? null : player.team, cappedTeam);

  // Everyone on the losing team dies and comes back on their own base. Upstream
  // scores no deaths for them -- the team loss is the whole penalty.
  players.forEach((victim) => {
    if (victim.team !== cappedTeam) return;
    victim.restartOnBase = true;
    if (victim.health <= 0) return;
    victim.health = 0;
    dropPlayerFlag(victim.id);
    broadcastAll({
      type: 'playerHit',
      victimId: victim.id,
      shooterId: player.id,
      projectileId: null,
      captured: true,
    });
    setTimeout(() => {
      if (!players.has(victim.id)) return;
      victim.respawn();
      broadcastAll({ type: 'playerRespawned', player: victim.getState() });
    }, GAME_CONFIG.RESPAWN_DELAY);
  });
}

// zapFlagByPlayer(). Death, disconnect, a pause, or a self-destruct all give up
// the flag: a droppable one is thrown where the tank stood, a sticky one just
// goes away.
function dropPlayerFlag(playerId) {
  const flag = getPlayerFlag(playerId);
  if (!flag) return;
  if (flag.endurance === FLAG_ENDURANCE.STICKY) zapFlag(flag);
  else dropFlag(flag);
}

// A team flag's identity is fixed and never hidden; a superflag slot starts
// empty and the insertion schedule gives it one.
function createFlagSlot(index, teamColorIndex) {
  return {
    index,
    team: teamColorIndex,
    type: teamColorIndex === null ? null : getTeamFlagAbbreviation(teamColorIndex),
    status: FLAG_STATUS.NO_EXIST,
    endurance: teamColorIndex === null ? FLAG_ENDURANCE.UNSTABLE : FLAG_ENDURANCE.NORMAL,
    owner: null,
    grabs: 0,
    position: { x: 0, y: 0, z: 0 },
    launchPosition: { x: 0, y: 0, z: 0 },
    landingPosition: { x: 0, y: 0, z: 0 },
    flightEnd: 0,
    initialVelocity: 0,
    flightStartedAt: 0,
  };
}

function createFlags() {
  flags.length = 0;
  // Team flags come first, as they do upstream, so a team's flag index does not
  // move when the superflag count changes.
  const teamFlagTeams = CTF_ENABLED
    ? TEAM_MODE.teams.filter((team) => isColorTeam(team) && getTeamBases(getTeamColorIndex(team)).length > 0)
    : [];
  teamFlagTeams.forEach((team) => {
    flags.push(createFlagSlot(flags.length, getTeamColorIndex(team)));
  });
  for (let slot = 0; slot < SUPER_FLAGS.count; slot++) {
    flags.push(createFlagSlot(flags.length, null));
  }

  flags.forEach((flag) => {
    // A team flag waits at its base for its team's first player; upstream starts
    // the superflag slots empty too and lets the insertion schedule fill them,
    // which would leave a fresh server flagless for a minute, so bzo spawns
    // those at once instead and a map always opens with its flags.
    if (flag.team !== null) {
      resetFlag(flag);
      return;
    }
    flag.position = findFlagSpawnPosition();
    addFlag(flag);
  });

  if (teamFlagTeams.length > 0) log(`Flags: team flags for ${teamFlagTeams.join(', ')}`);
  if (SUPER_FLAGS.count > 0) {
    log(
      `Flags: ${SUPER_FLAGS.count} superflag slots (${SUPER_FLAGS.allowed.join(', ')});` +
      ` flagsOnBuildings=${FLAGS_ON_BUILDINGS}`
    );
  }
  log(
    `Jumping: ${ALLOW_JUMPING ? 'allowed' : 'flag only'}`
    + (FORBIDDEN_FLAGS.length > 0 ? `; forbidden flags ${FORBIDDEN_FLAGS.join(', ')}` : '')
  );
  if (SUPER_FLAGS.allowed.includes('WG')) {
    log(
      `Wings: jumpCount=${GAME_CONFIG.WINGS_JUMP_COUNT},`
      + ` jumpVelocity=${GAME_CONFIG.WINGS_JUMP_VELOCITY},`
      + ` gravity=${GAME_CONFIG.WINGS_GRAVITY}, slideTime=${GAME_CONFIG.WINGS_SLIDE_TIME}`
    );
  }
}

// FlagInfo::landing plus the superflag insertion from the bzfs main loop. A
// flight that has run its course either settles the flag or empties its slot;
// an empty slot refills on a halflife distribution.
function updateFlags(now) {
  flags.forEach((flag) => {
    if (flag.flightStartedAt === 0) return;
    if (flag.status !== FLAG_STATUS.IN_AIR
      && flag.status !== FLAG_STATUS.COMING
      && flag.status !== FLAG_STATUS.GOING) return;
    if ((now - flag.flightStartedAt) / 1000 < flag.flightEnd) return;

    if (flag.status === FLAG_STATUS.GOING) {
      resetFlag(flag);
      return;
    }
    flag.status = FLAG_STATUS.ON_GROUND;
    flag.position = { ...flag.landingPosition };
    flag.flightStartedAt = 0;
    broadcastFlagUpdate(flag);
  });

  teamFlagTimeouts.forEach((deadline, colorIndex) => {
    if (now < deadline) return;
    teamFlagTimeouts.delete(colorIndex);
    if (!isTeamEmpty(colorIndex)) return;
    flags.forEach((flag) => {
      if (flag.team !== colorIndex) return;
      if (flag.status === FLAG_STATUS.NO_EXIST || flag.owner !== null) return;
      log(`Flag timeout for ${getTeamFromColorIndex(colorIndex)} team`);
      zapFlag(flag);
    });
  });

  if (SUPER_FLAGS.count === 0) return;
  if (now < nextSuperFlagInsertionAt) return;
  // -logf(bzfrand()) / (-logf(0.5) / FlagHalfLife) seconds until the next one.
  const roll = Math.random() + 0.01;
  const flagExp = -Math.log(0.5) / SUPER_FLAG_HALF_LIFE_SECONDS;
  nextSuperFlagInsertionAt = now + ((-Math.log(roll) / flagExp) * 1000);
  // resetFlag already chose where the empty slot's next flag belongs, as
  // upstream does; the insertion only decides when it arrives.
  const empty = flags.find((flag) => flag.team === null && flag.status === FLAG_STATUS.NO_EXIST);
  if (!empty) return;
  addFlag(empty);
  broadcastFlagUpdate(empty);
}

// Nearby voice protocol. Clients send voiceState with { enabled }, and send
// voiceOffer/voiceAnswer with { targetId, description }. ICE messages use
// { targetId, candidate }, where candidate may be null for end-of-candidates.
// The legacy alias `to` is accepted for targetId so reconnecting clients can
// keep their peer-routing field without widening the server-side permissions.
// The server replies with voiceRoster, voiceState, voiceOffer, voiceAnswer,
// and voiceIceCandidate. Every server-to-client voice message includes the
// nearby channel name and signaling messages identify their sender in `from`.
// Signaling is forwarded only to eligible peers on the sender's own channel.
// Audio media remains on the WebRTC connection, not on this socket.
//
// The channel rides on every message. Which players a channel puts together is
// server/voice-channels.cjs, mirrored to public/voice-channels.mjs, and the
// server is the side that enforces it: withholding the roster and the signalling
// is the only lever there is, because the media never passes through here.
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

// An observer's heartbeat, sent every MAX_UPDATE_INTERVAL by the client. It has
// no tank: nothing collides with it, nothing it does originates a shot, and the
// only thing on the server that reads its position is the nearby voice roster.
// So the position is taken as sent. The one test is that the numbers are
// numbers, because a NaN would poison the distance maths -- that is parsing, not
// validation, and there is deliberately no validation here.
//
// Velocities are forced to zero rather than read, so no path extrapolates a
// camera between heartbeats. The position is simply five seconds stale at worst.
//
// It goes out as an ordinary `pm`, because the other clients need it too: voice
// is peer to peer, so each client decides for itself how loud a peer is and
// where it stands, and it can only do that for an observer it can locate. Zero
// velocities mean the receiving end has nothing to extrapolate either, and the
// mesh it moves is the invisible one every observer already has at health 0.
//
// What this allows is being heard from somewhere you are not, which is a small
// thing beside what an observer may already watch, and smaller still beside a
// modified client picking a channel that ignores distance.
function applyObserverHeartbeat(player, message, ws) {
  const x = Number(message.x);
  const y = Number(message.y);
  const z = Number(message.z);
  const r = Number(message.r);
  if (![x, y, z, r].every(Number.isFinite)) return;
  player.x = x;
  player.y = y;
  player.z = z;
  player.rotation = r;
  player.forwardSpeed = 0;
  player.rotationSpeed = 0;
  player.verticalVelocity = 0;
  broadcast({
    type: 'pm',
    id: player.id,
    x, y, z, r,
    fs: 0,
    rs: 0,
    vv: 0,
    vx: 0,
    vz: 0,
  }, ws);
}

function isVoicePeer(source, target) {
  if (!source || !target || source.id === target.id) return false;
  if (!source.joined || !target.joined) return false;
  // Infinity rather than 0 for a player with no position yet: out of earshot is
  // the safe reading, and only Nearby consults it at all.
  const planar = Number.isFinite(source.x) && Number.isFinite(source.z)
    && Number.isFinite(target.x) && Number.isFinite(target.z)
    ? distance(source.x, source.z, target.x, target.z)
    : Infinity;
  return areVoicePeers(source, target, planar, GAME_CONFIG.VOICE_NEARBY_RADIUS);
}

function getVoicePeers(player) {
  return Array.from(players.values())
    .filter((candidate) => isVoicePeer(player, candidate))
    .sort((left, right) => Number(left.id) - Number(right.id));
}

function getVoicePeerState(peer) {
  return {
    id: peer.id,
    name: peer.name,
    team: peer.team,
    micEnabled: peer.voiceMicEnabled === true,
  };
}

function sendVoiceRoster(player, force = false) {
  if (!player.joined) return;

  const peers = getVoicePeers(player);
  // The player's own channel is in the signature because switching channels can
  // leave the peer set unchanged -- two teammates standing together, say -- and
  // the roster still has to go out saying which channel they are now on.
  const signature = [player.voiceChannel, ...peers
    .map((peer) => `${peer.id}:${peer.team}:${peer.voiceMicEnabled === true ? 1 : 0}`)]
    .join('|');
  if (!force && player.voiceRosterSignature === signature) return;

  player.voiceRosterSignature = signature;
  sendToPlayer(player, {
    type: 'voiceRoster',
    channel: player.voiceChannel,
    nearbyRadius: GAME_CONFIG.VOICE_NEARBY_RADIUS,
    peers: peers.map(getVoicePeerState),
  });
}

function refreshVoiceRosters(force = false) {
  players.forEach((player) => sendVoiceRoster(player, force));
}

function sendVoiceStateUpdate(player) {
  if (!player.joined) return;

  const stateMessage = {
    type: 'voiceState',
    channel: player.voiceChannel,
    playerId: player.id,
    team: player.team,
    enabled: player.voiceMicEnabled === true,
  };
  sendToPlayer(player, stateMessage);
  getVoicePeers(player).forEach((peer) => sendToPlayer(peer, stateMessage));
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

  const targetId = normalizePlayerId(message.targetId ?? message.to);
  const target = targetId ? players.get(targetId) : null;
  if (!target || !isVoicePeer(player, target)) return;

  if (message.type === 'voiceOffer' || message.type === 'voiceAnswer') {
    const description = getVoiceDescription(message, message.type === 'voiceOffer' ? 'offer' : 'answer');
    if (!description) return;
    sendToPlayer(target, {
      type: message.type,
      channel: player.voiceChannel,
      from: player.id,
      description,
    });
    return;
  }

  const candidate = getVoiceCandidate(message);
  if (candidate === null && message.candidate !== null) return;
  sendToPlayer(target, {
    type: 'voiceIceCandidate',
    channel: player.voiceChannel,
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
const PLAYER_TELEPORT_REENTRY_BLOCK_DISTANCE = 5.0;
const PLAYER_TELEPORT_REENTRY_BLOCK_MIN_MS = 250;
const PLAYER_TELEPORT_EXIT_EPSILON = 0.08;
const PLAYER_TELEPORT_COOLDOWN_MS = 1000;

function isPlayerTeleportReentryBlocked(player, teleporterIndex, now) {
  if (!player || !Number.isInteger(teleporterIndex)) return false;
  if (player.teleportReentryBlockTeleporterIndex !== teleporterIndex) return false;
  return player.teleportReentryBlockDistance > 1e-6 || now < (player.teleportReentryBlockUntil || 0);
}

function decayPlayerTeleportReentryBlock(player, travelDistance, now) {
  if (!player) return;
  const moved = Math.max(0, Number(travelDistance) || 0);
  player.teleportReentryBlockDistance = Math.max(0, (player.teleportReentryBlockDistance || 0) - moved);
  if (player.teleportReentryBlockDistance <= 1e-6 && now >= (player.teleportReentryBlockUntil || 0)) {
    player.teleportReentryBlockTeleporterIndex = null;
    player.teleportReentryBlockDistance = 0;
    player.teleportReentryBlockUntil = 0;
  }
}

function isPointInsideTeleporterPortal(obs, x, y, z, tankRadius = 2) {
  if (!obs || obs.kind !== 'teleporter') return false;
  const obstacleBase = obs.baseY || 0;
  const epsilon = 0.15;
  const tankTop = y + tankRadius;
  const { x: localX, z: localZ } = getColliderLocalPoint(x, z, obs);
  const dims = getShotTeleporterDims(obs);
  const innerDistSquared = getBoxCollisionDistanceSquared(localX, localZ, dims.halfW, dims.activeHalfD);
  const activeBaseY = obstacleBase;
  const activeTopY = obstacleBase + dims.activeH;
  const overlapsActiveVertical = tankTop > (activeBaseY + epsilon) && y < (activeTopY - epsilon);
  return overlapsActiveVertical && innerDistSquared < tankRadius * tankRadius;
}

function applyPlayerTeleportMessage(player, sourceState, fromFaceId, toFaceId, now) {
  if (!player || !sourceState || !Number.isInteger(fromFaceId) || !Number.isInteger(toFaceId)) {
    return { ok: false, reason: 'invalid_packet' };
  }

  if (!Number.isFinite(sourceState.x) || !Number.isFinite(sourceState.y) || !Number.isFinite(sourceState.z)) {
    return { ok: false, reason: 'invalid_source_state' };
  }

  const sourceRotation = Number.isFinite(sourceState.r) ? sourceState.r : player.rotation;
  const sourceVerticalVelocity = Number.isFinite(sourceState.vv) ? sourceState.vv : player.verticalVelocity;
  const sourceAirVelocityX = Number.isFinite(sourceState.vx) ? sourceState.vx : player.airVelocityX;
  const sourceAirVelocityZ = Number.isFinite(sourceState.vz) ? sourceState.vz : player.airVelocityZ;
  const hasSourceJumpDirection = sourceState.jd !== null && Number.isFinite(sourceState.jd);
  const sourceJumpDirection = hasSourceJumpDirection ? sourceState.jd : player.jumpDirection;

  if (now < (player.teleportCooldownUntil || 0)) {
    return { ok: false, reason: 'cooldown' };
  }

  const expectedToFaceId = getShotTeleportDestinationFace(fromFaceId);
  if (toFaceId !== expectedToFaceId) {
    return { ok: false, reason: 'invalid_link' };
  }

  const sourceTeleporterIndex = Math.floor(fromFaceId / 2);
  const destinationTeleporterIndex = Math.floor(toFaceId / 2);
  const sourceFace = fromFaceId % 2;
  const destinationFace = toFaceId % 2;
  const sourceObs = TELEPORTER_OBSTACLES_BY_INDEX.get(sourceTeleporterIndex);
  const destinationObs = TELEPORTER_OBSTACLES_BY_INDEX.get(destinationTeleporterIndex);
  if (!sourceObs || !destinationObs) {
    return { ok: false, reason: 'missing_teleporter' };
  }

  const deltaTime = Math.max(0, (now - player.lastUpdate) / 1000);
  if (!validateMovement(player, sourceState.x, sourceState.y, sourceState.z, sourceRotation, deltaTime, true)) {
    return { ok: false, reason: 'invalid_source_state' };
  }

  if (!isPointInsideTeleporterPortal(sourceObs, sourceState.x, sourceState.y, sourceState.z, 2)) {
    return { ok: false, reason: 'not_in_source_portal' };
  }

  if (isPlayerTeleportReentryBlocked(player, sourceTeleporterIndex, now)) {
    return { ok: false, reason: 'reentry_block' };
  }

  player.x = sourceState.x;
  player.y = sourceState.y;
  player.z = sourceState.z;
  player.rotation = sourceRotation;
  player.verticalVelocity = sourceVerticalVelocity;
  player.airVelocityX = sourceAirVelocityX;
  player.airVelocityZ = sourceAirVelocityZ;
  player.jumpDirection = sourceJumpDirection;

  const moveDirection = player.slideDirection !== undefined
    ? player.slideDirection
    : (player.jumpDirection !== null && player.jumpDirection !== undefined ? player.jumpDirection : player.rotation);
  const dirIn = {
    x: -Math.sin(moveDirection),
    y: 0,
    z: -Math.cos(moveDirection),
  };

  const transformed = transformShotThroughTeleporter(
    { x: sourceState.x, y: sourceState.y, z: sourceState.z },
    dirIn,
    sourceObs,
    sourceFace,
    destinationObs,
    destinationFace,
  );

  const outX = transformed.pointOut.x + transformed.dirOut.x * PLAYER_TELEPORT_EXIT_EPSILON;
  const outY = Math.max(0, transformed.pointOut.y + transformed.dirOut.y * PLAYER_TELEPORT_EXIT_EPSILON);
  const outZ = transformed.pointOut.z + transformed.dirOut.z * PLAYER_TELEPORT_EXIT_EPSILON;

  const destinationCollision = checkCollision(outX, outY, outZ, 2, {
    ignoreTeleporters: true,
    rotation: player.rotation,
    suppressLog: true,
  });
  if (destinationCollision) {
    return { ok: false, reason: 'blocked_exit' };
  }

  const radians1 = (sourceObs.rotation || 0) + (sourceFace === 0 ? 0 : Math.PI);
  const radians2 = (destinationObs.rotation || 0) + (destinationFace === 1 ? 0 : Math.PI);
  const rotateDelta = radians2 - radians1;

  player.x = outX;
  player.y = outY;
  player.z = outZ;
  player.rotation = normalizeAngle(player.rotation + rotateDelta);
  if (player.slideDirection !== undefined) {
    player.slideDirection = normalizeAngle(player.slideDirection + rotateDelta);
  }
  if (player.jumpDirection !== null && player.jumpDirection !== undefined) {
    player.jumpDirection = normalizeAngle(player.jumpDirection + rotateDelta);
  }
  if (Number.isFinite(player.airVelocityX) && Number.isFinite(player.airVelocityZ)) {
    const rotatedAirVelocity = rotateXZ(player.airVelocityX, player.airVelocityZ, rotateDelta);
    player.airVelocityX = rotatedAirVelocity.x;
    player.airVelocityZ = rotatedAirVelocity.z;
  }

  player.teleportReentryBlockTeleporterIndex = destinationTeleporterIndex;
  player.teleportReentryBlockDistance = Math.max(
    PLAYER_TELEPORT_REENTRY_BLOCK_DISTANCE,
    (getShotTeleporterDims(destinationObs).halfW * 2) + 0.25,
  );
  player.teleportReentryBlockUntil = now + PLAYER_TELEPORT_REENTRY_BLOCK_MIN_MS;
  player.teleportCooldownUntil = now + PLAYER_TELEPORT_COOLDOWN_MS;
  player.lastUpdate = now;

  return {
    ok: true,
    fromFaceId,
    toFaceId,
  };
}

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
      (getShotTeleporterDims(destObs).activeHalfD * 2) + 0.05,
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
    `[shotEnd] id=${projectile.id} player=${projectile.playerId} slot=${projectile.shotSlot}` +
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
      if (player.team === 'observer') return; // Observers are non-combatants
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
          recordTeamScoreForKill(shooter, player);

          logShotEnd(proj, 'player_hit', { x: proj.x, y: proj.y, z: proj.z }, `victim=${player.id}`);
          dropPlayerFlag(player.id);

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
          }, GAME_CONFIG.RESPAWN_DELAY);
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

  updateFlags(now);
}

createFlags();

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
        log(`  "${p.name}": ${p.cheatWarnings.totalWarnings} total (${p.cheatWarnings.linearDrift} linear, ${p.cheatWarnings.angularDrift} angular, ${p.cheatWarnings.shotRejected} shot) - last ${timeSinceWarning}s ago`);
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
    currentMap: MAP_SOURCE,
    shotMaxActive: GAME_CONFIG.SHOT_MAX_ACTIVE,
  }));
}

// WebSocket connection handler
// When a new player connects, assign a default name and number
wss.on('connection', (ws, req) => {

  let player = new Player(ws);
  players.set(player.id, player);

  // Set player as not yet joined (health = 0)
  player.health = 0;

  // A socket with no 'error' listener throws on the first protocol violation or
  // reset, killing the whole server. Any client can send a malformed frame, so
  // this listener is what keeps one bad peer from taking everyone down. ws
  // closes the socket itself afterwards; 'close' does the player cleanup.
  ws.on('error', (err) => {
    logError(`Player ${player.id} socket error: ${err.message}`);
  });

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
    teamMode: TEAM_MODE,
    teamScores: getTeamScoreState(),
    voiceRtcConfig: { iceServers: VOICE_ICE_SERVERS },
    obstacles: OBSTACLES,
    teleporterGraph: TELEPORTER_GRAPH,
    flags: getFlagStates(),
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

          // An unrecognized channel normalizes to the default rather than being
          // rejected, so an older or newer client lands somewhere valid instead
          // of silently having no voice at all.
          if (message.channel !== undefined) {
            player.voiceChannel = normalizeVoiceChannel(message.channel);
          }
          player.voiceMicEnabled = message.enabled === true;
          sendVoiceStateUpdate(player);
          // A channel change rewrites other players' rosters too, not just this
          // one's, so every roster is reconsidered rather than only the sender's.
          refreshVoiceRosters();
          break;
        }
        case 'voiceOffer':
        case 'voiceAnswer':
        case 'voiceIceCandidate': {
          forwardVoiceSignal(player, message);
          break;
        }
        case 'debug': {
          // Log debug messages from clients
          const payloadName = typeof message.name === 'string' ? message.name.trim() : '';
          const debugFrom = payloadName || player.name || `Player ${player.playerNumber}`;
          log(`[DEBUG] Player "${debugFrom}": ${message.message || ''}`);
          break;
        }
        case 'tp': {
          if (player.team === 'observer') break;

          const now = Date.now();
          const sourceState = {
            x: Number(message.x),
            y: Number(message.y),
            z: Number(message.z),
            r: Number(message.r),
            vv: Number(message.vv),
            vx: Number(message.vx),
            vz: Number(message.vz),
            jd: message.jd === null ? null : Number(message.jd),
          };
          const fromFaceId = Number(message.fromFaceId);
          const toFaceId = Number(message.toFaceId);
          const teleportResult = applyPlayerTeleportMessage(player, sourceState, fromFaceId, toFaceId, now);

          if (!teleportResult.ok) {
            ws.send(JSON.stringify({
              type: 'positionCorrection',
              x: player.x,
              y: player.y,
              z: player.z,
              r: player.rotation,
              vv: player.verticalVelocity || 0,
            }));
            if (teleportResult.reason !== 'cooldown' && teleportResult.reason !== 'reentry_block') {
              log(`[PLAYER_TP_REJECT] player=${player.id} fromFace=${fromFaceId} toFace=${toFaceId} reason=${teleportResult.reason}`);
            }
            break;
          }

          const ptPacket = {
            type: 'pt',
            id: player.id,
            x: player.x,
            y: player.y,
            z: player.z,
            r: player.rotation,
            fs: player.forwardSpeed || 0,
            rs: player.rotationSpeed || 0,
            vv: player.verticalVelocity || 0,
            vx: player.airVelocityX || 0,
            vz: player.airVelocityZ || 0,
            fromFaceId: teleportResult.fromFaceId,
            toFaceId: teleportResult.toFaceId,
            jd: player.jumpDirection,
          };
          if (player.slideDirection !== undefined) {
            ptPacket.d = player.slideDirection;
          }

          broadcastAll(ptPacket);
          log(
            `[PLAYER_TP] player=${player.id} srcFace=${teleportResult.fromFaceId} ` +
            `dstFace=${teleportResult.toFaceId} pos=(${player.x.toFixed(2)},${player.y.toFixed(2)},${player.z.toFixed(2)})`
          );
          break;
        }
        case 'm': {
          if (player.team === 'observer') {
            applyObserverHeartbeat(player, message, ws);
            break;
          }

          const now = Date.now();
          // Calculate deltaTime based on server's last update time
          const deltaTime = (now - player.lastUpdate) / 1000;
          // DON'T update player.lastUpdate here - it breaks extrapolation in validateMovement!

          // Only accept new compact field names
          let x = Number(message.x);
          let y = Number(message.y);
          let z = Number(message.z);
          let r = Number(message.r);
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

          let d = message.d !== undefined ? Number(message.d) : undefined; // Optional slide direction
          let vx = message.vx !== undefined ? Number(message.vx) : undefined;
          let vz = message.vz !== undefined ? Number(message.vz) : undefined;
          const hasAirVelocity = Number.isFinite(vx) && Number.isFinite(vz);

          const previousState = {
            x: player.x,
            y: player.y,
            z: player.z,
            r: player.rotation,
          };

          const teleportReentryActive = player.teleportReentryBlockTeleporterIndex !== null
            && (player.teleportReentryBlockDistance > 1e-6 || now < (player.teleportReentryBlockUntil || 0));

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

          // Whether this tank may leave a surface at all. The flap count is not
          // tracked here -- following it would mean running the client's whole
          // ground/air state machine off position updates -- so the server asks
          // the weaker question it can answer, and Wings is taken at its word
          // about how many flaps it has left.
          const carriedFlagType = getPlayerFlag(player.id)?.type ?? null;
          const jumpRefused = isJumpStart
            && !canJump(carriedFlagType, ALLOW_JUMPING, false, GAME_CONFIG.WINGS_JUMP_COUNT);
          if (jumpRefused) logJumpRejection(player, carriedFlagType);

          // Use actual deltaTime for validation since we compare to extrapolated position
          // The extrapolated position accounts for the full time interval using OLD velocities
          if (!jumpRefused && validateMovement(
            player,
            x,
            y,
            z,
            r,
            deltaTime,
            velocityChanged,
            { ignoreTeleporters: teleportReentryActive }
          )) {
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

            const movedPlanarDistance = Math.hypot(player.x - previousState.x, player.z - previousState.z);
            decayPlayerTeleportReentryBlock(player, movedPlanarDistance, now);

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

            searchFlag(player);
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
          const shotRejection = getShotRejection(player, message.x, message.y, message.z);
          if (shotRejection) {
            logShotRejection(player, shotRejection, message);
            break;
          }
          const rawDirX = Number(message.dirX);
          const rawDirZ = Number(message.dirZ);
          const rawDirY = Number(message.dirY);
          if (!Number.isFinite(rawDirX) || !Number.isFinite(rawDirZ)) {
            logShotRejection(player, 'shot direction is not a finite number', message);
            break;
          }
          const planarLength = Math.hypot(rawDirX, rawDirZ);
          if (planarLength < 1e-6) {
            logShotRejection(player, `shot direction has no horizontal component (${planarLength})`, message);
            break;
          }
          const shotDirX = rawDirX / planarLength;
          const shotDirZ = rawDirZ / planarLength;
          const shotDirY = Number.isFinite(rawDirY) ? rawDirY : 0;
          const shotSlot = getAvailableShotSlot(player.id);
          if (shotSlot < 0) {
            logShotRejection(player, 'no free shot slot despite passing validation', message);
            break;
          }
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
            `[shotBegin] id=${proj.id} player=${proj.playerId} slot=${proj.shotSlot}` +
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

        case 'grabFlag': {
          if (!player.joined) break;
          const requestedIndex = Number(message.index);
          if (!Number.isInteger(requestedIndex)) break;
          const flag = flags[requestedIndex];
          if (!flag) break;
          grabFlag(player, flag);
          break;
        }

        case 'captureFlag': {
          if (!player.joined) break;
          const baseTeam = Number(message.team);
          if (!isColorTeamIndex(baseTeam)) break;
          captureFlag(player, baseTeam);
          break;
        }

        case 'dropFlag': {
          if (!player.joined) break;
          if (player.health <= 0) break;
          const flag = getPlayerFlag(player.id);
          // A sticky flag cannot be dropped on request; only its shake timeout
          // or a kill gets rid of it.
          if (!flag || flag.endurance === FLAG_ENDURANCE.STICKY) break;
          dropFlag(flag);
          break;
        }

        case 'selfDestruct': {
          if (player.team === 'observer') break;
          if (player.health <= 0) break;
          player.health = 0;
          player.deaths++;
          recordTeamScoreForKill(player, player);
          dropPlayerFlag(player.id);
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
          }, GAME_CONFIG.RESPAWN_DELAY);
          break;
        }

        case 'joinGame': {
          let joinName = nameCheck(message.name, player.id);
          const requestedTankModel = typeof message.tankModel === 'string'
            ? normalizeTankModelId(message.tankModel)
            : 'bzflag';
          const previousTeam = player.joined ? player.team : null;
          const requestedTeam = normalizePlayerTeamSelection(message.team);
          if (requestedTeam !== 'automatic' && !TEAM_MODE.teams.includes(requestedTeam)) {
            ws.send(JSON.stringify({ error: `Team is not available: ${requestedTeam}` }));
            break;
          }
          const teamCounts = {};
          // What the players on each team have scored between them, which is
          // what auto-assignment balances on. Not the team score.
          const teamPlayerScores = {};
          players.forEach((candidate) => {
            if (!candidate.joined || candidate.id === player.id) return;
            teamCounts[candidate.team] = (teamCounts[candidate.team] || 0) + 1;
            teamPlayerScores[candidate.team] = (teamPlayerScores[candidate.team] || 0) + candidate.kills - candidate.deaths;
          });
          const assignedTeam = selectPlayerTeam(requestedTeam, TEAM_MODE, teamCounts, teamPlayerScores);
          if (!assignedTeam) {
            ws.send(JSON.stringify({ error: `Team is full: ${requestedTeam}` }));
            break;
          }
          // A team change takes the tank out of play, so it gives up its flag
          // like every other such path. This is keyed on the team actually
          // changing rather than on the join, because Player Options carries
          // name, team, and tank together and re-sends all three -- a player
          // changing only their tank keeps the flag. It runs before the spawn
          // below, since dropFlag() casts its ray from the owner's position.
          if (previousTeam && previousTeam !== assignedTeam) {
            dropPlayerFlag(player.id);
          }
          player.name = joinName;
          player.tankModel = isAllowedTankModel(requestedTankModel)
            ? requestedTankModel
            : 'bzflag';
          player.team = assignedTeam;
          if (TEAM_MODE.enabled) {
            player.color = getPlayerTeamColor(player.team);
            // bzfs.cxx:2377 resets a team the moment its size becomes one.
            // `teamCounts` excludes this player, so a lone player rejoining
            // their own team resets it too, as a leave and join would upstream.
            if (!teamCounts[assignedTeam] && isColorTeam(assignedTeam)) {
              teamScores.delete(assignedTeam);
            }
          }
          player.voiceMicEnabled = false;
          player.joined = true;
          player.voiceRosterSignature = '';
          // An observer never comes alive. health 0 is the state the join flow
          // already renders as a scoreboard entry with an invisible tank, which
          // is exactly what an observer wants, and it leaves every path that
          // tests health refusing on its own.
          //
          // It still gets a spawn position, because that is where its camera
          // starts: an observer should arrive standing on the field facing the
          // way a tank would, not hovering at the origin. After that the camera
          // lives on the client and reports itself every five seconds; see
          // applyObserverHeartbeat.
          const joinAsObserver = isObserverTeam(assignedTeam);
          player.health = joinAsObserver ? 0 : 100;
          // PlayerInfo::resetPlayer(ctf) puts every CTF spawn on the team base.
          player.restartOnBase = !joinAsObserver && CTF_ENABLED;
          const spawnPos = getSpawnPosition(player);
          player.x = spawnPos.x;
          player.y = spawnPos.y;
          player.z = spawnPos.z;
          player.rotation = spawnPos.rotation;
          player.verticalVelocity = 0;
          player.isJumping = false;
          player.onObstacle = false;
          player.forwardSpeed = 0;
          player.rotationSpeed = 0;
          player.jumpDirection = null;
          player.slideDirection = undefined;
          player.airVelocityX = 0;
          player.airVelocityZ = 0;
          player.teleportReentryBlockTeleporterIndex = null;
          player.teleportReentryBlockDistance = 0;
          player.teleportReentryBlockUntil = 0;
          player.teleportCooldownUntil = 0;
          player.lastUpdate = Date.now();
          player.deaths = 0;
          player.kills = 0;
          if (message.isMobile) {
            log(`Player ${player.id} joining game as "${joinName}" [${player.team.toUpperCase()}] [MOBILE]`);
          } else {
            log(`Player ${player.id} joining game as "${joinName}" [${player.team.toUpperCase()}]`);
          }

          // broadcast join to all (full player info)
          // bzfs.cxx:2478 and :2966: a team's flag follows its population. The
          // first player to arrive brings it back, and a team left empty by
          // someone switching away loses theirs.
          if (isColorTeam(assignedTeam) && !teamCounts[assignedTeam]) {
            resetTeamFlags(getTeamColorIndex(assignedTeam));
          }
          if (previousTeam && previousTeam !== assignedTeam) {
            retireTeamFlags(getTeamColorIndex(previousTeam));
          }

          broadcastAll({
            type: 'playerJoined',
            player: player.getState(),
          });
          broadcastTeamScores();
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
          if (player.team === 'observer') break;
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
                // bzfs.cxx:6913 gives up the flag before the pause takes hold.
                dropPlayerFlag(player.id);

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
        case 'setOperatorConfig': {
          const hasMotd = Object.prototype.hasOwnProperty.call(message, 'motd');
          const hasShotMaxActive = Object.prototype.hasOwnProperty.call(message, 'shotMaxActive');
          if (!hasMotd && !hasShotMaxActive) {
            ws.send(JSON.stringify({ error: 'No supported operator setting provided' }));
            break;
          }

          let nextMotd = serverConfig.motd || '';
          let nextShotMaxActive = GAME_CONFIG.SHOT_MAX_ACTIVE;

          if (hasMotd) {
            if (typeof message.motd !== 'string') {
              ws.send(JSON.stringify({ error: 'Invalid motd value' }));
              break;
            }
            nextMotd = message.motd.trim();
            if (nextMotd.length > 140) {
              ws.send(JSON.stringify({ error: 'MOTD must be 140 characters or fewer' }));
              break;
            }
          }

          if (hasShotMaxActive) {
            const requestedShotMaxActive = Number(message.shotMaxActive);
            if (!Number.isFinite(requestedShotMaxActive)) {
              ws.send(JSON.stringify({ error: 'Invalid shot max active value' }));
              break;
            }
            nextShotMaxActive = normalizeShotSlotCount(Math.round(requestedShotMaxActive));
          }

          try {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (hasMotd) config.motd = nextMotd;
            if (hasShotMaxActive) config.shotMaxActive = nextShotMaxActive;
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

            if (hasMotd) serverConfig.motd = nextMotd;
            if (hasShotMaxActive) {
              serverConfig.shotMaxActive = nextShotMaxActive;
              GAME_CONFIG.SHOT_MAX_ACTIVE = nextShotMaxActive;
            }

            broadcastAll({
              type: 'serverConfigUpdate',
              motd: serverConfig.motd || '',
              shotMaxActive: GAME_CONFIG.SHOT_MAX_ACTIVE,
            });
            sendMapList(ws);
            ws.send(JSON.stringify({ success: true }));
            log(
              `Operator updated config: motd=${hasMotd ? 'yes' : 'no'} ` +
              `shotMaxActive=${hasShotMaxActive ? String(nextShotMaxActive) : 'unchanged'}`
            );
          } catch (error) {
            logError(`Failed to update config at ${configPath}:`, error);
            ws.send(JSON.stringify({ error: 'Failed to update config' }));
          }
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
    const leavingTeam = player.team;
    dropPlayerFlag(player.id);
    players.delete(player.id);
    retireTeamFlags(getTeamColorIndex(leavingTeam));

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
    broadcastTeamScores();
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
