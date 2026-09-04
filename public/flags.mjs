/*
 * Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/timriker/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */

// Flag types, statuses, world constants, and the flight math. Mirrors BZFlag's
// include/Flag.h, src/common/Flag.cxx and src/bzfs/FlagInfo.cxx.
//
// The server computes a flight once, when the flag is thrown, and the client
// integrates it every frame from the same numbers -- so both sides must agree
// about the arc or a flag lands in one place and is drawn in another.

// Flag::FlagStatus. Where a flag is.
export const FLAG_STATUS = Object.freeze({
  NO_EXIST: 0,
  ON_GROUND: 1,
  ON_TANK: 2,
  IN_AIR: 3,
  COMING: 4,
  GOING: 5,
});

// Flag::FlagEndurance. Whether the flag can be dropped, and what dropping does.
export const FLAG_ENDURANCE = Object.freeze({
  NORMAL: 0,
  UNSTABLE: 1,
  STICKY: 2,
});

// Flag::FlagQuality.
export const FLAG_QUALITY = Object.freeze({
  GOOD: 0,
  BAD: 1,
});

// global.cxx defaults. Locked BZDB variables upstream, so they are constants
// here too.
export const FLAG_ALTITUDE = 11.0;
export const FLAG_RADIUS = 2.5;
export const FLAG_POLE_SIZE = 0.8;
export const FLAG_POLE_WIDTH = 0.025;
// _flagHeight: the clearance a flag needs above its landing spot, not its
// drawn size. DropGeometry tests a cylinder this tall.
export const FLAG_CLEARANCE = 10.0;
export const MAX_FLAG_GRABS = 4;
export const BASE_SIZE = 60.0;

// BZFlag's tank radius, deliberately not bzo's 2. The grab radius scales with
// the world rather than with the vehicle, as the sound reference distance in
// audio.js does: a bzo tank is half as wide as an upstream one, and building
// the radius from it would mean driving almost dead centre over a flag to take
// it. Tune this one figure if 6.82 plays badly.
export const BZFLAG_TANK_RADIUS = 4.32;
export const FLAG_GRAB_RADIUS = BZFLAG_TANK_RADIUS + FLAG_RADIUS;
// checkEnvironment() only grabs when the tank and the flag are on the same
// level, and rate-limits requests to five a second.
export const FLAG_GRAB_LEVEL_TOLERANCE = 0.1;
export const FLAG_GRAB_INTERVAL_MS = 200;

// bzfs.cxx:86. A vacated superflag slot refills on a halflife distribution.
export const SUPER_FLAG_HALF_LIFE_SECONDS = 10.0;

// _identifyRange. How far the Identify flag reaches when it names the nearest
// flag on the ground (searchFlag, bzfs.cxx:3631).
export const IDENTIFY_RANGE = 50.0;

// Wings' four BZDB variables. All are Locked upstream, which means a server may
// set them and a client may not, so they are world configuration and reach the
// client with the rest of it -- they are not constants the way _flagRadius is.
// These are only the stock values.
//
// _wingsJumpCount is how many times a tank may leave a surface before it has to
// touch one again, refilled every tick it spends on the ground or on a building
// (LocalPlayer.cxx:328) and spent by the take-off as well as by each flap. At
// the stock 1 that is one jump and no flaps, which is why Wings is worth
// carrying for its air control rather than for its altitude; a server that wants
// tanks to actually fly raises it.
export const DEFAULT_WINGS_JUMP_COUNT = 1;
// _wingsSlideTime. Zero means a wings tank takes the velocity its stick asks for
// outright; above zero it accelerates towards it over that many seconds, so
// flight carries momentum.
export const DEFAULT_WINGS_SLIDE_TIME = 0.0;
// _wingsJumpVelocity and _wingsGravity have no stock values of their own: they
// are the strings "_jumpVelocity" and "_gravity", so unless a server sets them a
// wings jump rises and falls exactly as an ordinary one does.

// Every superflag is white; only team flags carry a colour (Flag.cxx:409). That
// is what makes hiding a superflag's identity free: an unidentified flag looks
// exactly like an identified one.
export const SUPER_FLAG_COLOR = 0xffffff;

// Flag.cxx builds one FlagType per flag. This table is the whole of what bzo
// knows about flags: an abbreviation it does not carry is not a flag the server
// can hand out, is not offered by `superFlags.allowed`, and is not documented in
// the help panel, which is generated from here.
//
// Rows keep upstream's declaration order. `team` is a BZFlag colour index for a
// team flag and null for a superflag; resolve it to a colour through the `teams`
// pair, which is where team identity lives.
const TEAM_FLAG_HELP = "If it's yours, prevent other teams from taking it."
  + " If it's not take it to your base to capture it!";

export const FLAG_TYPES = Object.freeze({
  'R*': Object.freeze({
    abbreviation: 'R*',
    name: 'Red Team',
    endurance: FLAG_ENDURANCE.NORMAL,
    quality: FLAG_QUALITY.GOOD,
    team: 1,
    help: TEAM_FLAG_HELP,
  }),
  'G*': Object.freeze({
    abbreviation: 'G*',
    name: 'Green Team',
    endurance: FLAG_ENDURANCE.NORMAL,
    quality: FLAG_QUALITY.GOOD,
    team: 2,
    help: TEAM_FLAG_HELP,
  }),
  'B*': Object.freeze({
    abbreviation: 'B*',
    name: 'Blue Team',
    endurance: FLAG_ENDURANCE.NORMAL,
    quality: FLAG_QUALITY.GOOD,
    team: 3,
    help: TEAM_FLAG_HELP,
  }),
  'P*': Object.freeze({
    abbreviation: 'P*',
    name: 'Purple Team',
    endurance: FLAG_ENDURANCE.NORMAL,
    quality: FLAG_QUALITY.GOOD,
    team: 4,
    help: TEAM_FLAG_HELP,
  }),
  R: Object.freeze({
    abbreviation: 'R',
    name: 'Ricochet',
    endurance: FLAG_ENDURANCE.UNSTABLE,
    quality: FLAG_QUALITY.GOOD,
    team: null,
    help: 'Shots bounce off walls.  Don\'t shoot yourself!',
  }),
  JP: Object.freeze({
    abbreviation: 'JP',
    name: 'Jumping',
    endurance: FLAG_ENDURANCE.UNSTABLE,
    quality: FLAG_QUALITY.GOOD,
    team: null,
    help: 'Tank can jump.  Use Tab key.  Can\'t steer in the air.',
  }),
  ID: Object.freeze({
    abbreviation: 'ID',
    name: 'Identify',
    endurance: FLAG_ENDURANCE.UNSTABLE,
    quality: FLAG_QUALITY.GOOD,
    team: null,
    help: 'Identifies type of nearest flag.',
  }),
  US: Object.freeze({
    abbreviation: 'US',
    name: 'Useless',
    endurance: FLAG_ENDURANCE.UNSTABLE,
    quality: FLAG_QUALITY.GOOD,
    team: null,
    help: 'You have found the useless flag. Use it wisely.',
  }),
  WG: Object.freeze({
    abbreviation: 'WG',
    name: 'Wings',
    endurance: FLAG_ENDURANCE.UNSTABLE,
    quality: FLAG_QUALITY.GOOD,
    team: null,
    help: 'Tank can drive in air.',
  }),
});

export const FLAG_ABBREVIATIONS = Object.freeze(Object.keys(FLAG_TYPES));

export function getFlagType(abbreviation) {
  return FLAG_TYPES[abbreviation] || null;
}

export function isTeamFlag(abbreviation) {
  return getFlagTeamIndex(abbreviation) !== null;
}

// LocalPlayer::doJump. Who may leave a surface, and who may do it again without
// touching one first. Wings never consults the world switch -- a flap is a flap,
// whatever the map says about jumping -- and it is the only flag that answers
// true while the tank is already in the air.
export function canJump(abbreviation, allowJumping, airborne, flapsLeft) {
  if (abbreviation === 'WG') return flapsLeft > 0;
  if (airborne) return false;
  return allowJumping || abbreviation === 'JP';
}

// LocalPlayer::doUpdateMotion. Wings is the one flag that drives and steers off
// the ground; every other tank keeps the velocity it took off with until it
// lands.
export function hasAirControl(abbreviation) {
  return abbreviation === 'WG';
}

// SegmentedShotStrategy::makeSegments. A shot that would stop at a wall
// reflects off it instead when the world says every shot ricochets, and the
// Ricochet flag makes one that reflects whatever the world says. With the world
// switch on the flag has nothing left to offer, which is why the server forbids
// it there.
export function shotRicochets(abbreviation, allShotsRicochet) {
  return allShotsRicochet === true || abbreviation === 'R';
}

// LocalPlayer::doJump's vertical component. A flap relaunches a tank that is on
// its way up only if it is climbing slower than the flap would, and a falling
// one is slowed rather than relaunched -- so flapping late in a dive costs you
// most of what the flap was worth.
export function getWingsJumpVelocity(wingsJumpVelocity, verticalVelocity) {
  if (verticalVelocity < 0) return wingsJumpVelocity + verticalVelocity;
  return Math.max(wingsJumpVelocity, verticalVelocity);
}

// LocalPlayer::doSlideMotion, which a wings tank flies through when
// _wingsSlideTime is above zero. The stick adds to the velocity rather than
// replacing it, and the result is held at maxSpeed -- a tank already over that,
// from a flap taken at speed, is bled back towards it over the same slide time
// rather than snapped to it. Heading is bzo's, where forward is (-sin, -cos).
export function getWingsSlideVelocity(
  velocityX, velocityZ, heading, desiredSpeed, maxSpeed, slideTime, deltaTime
) {
  const scale = deltaTime / slideTime;
  const speedAdjustment = desiredSpeed * scale;
  let x = velocityX - (Math.sin(heading) * speedAdjustment);
  let z = velocityZ - (Math.cos(heading) * speedAdjustment);
  const newSpeed = Math.hypot(x, z);
  if (newSpeed > maxSpeed) {
    const oldSpeed = Math.hypot(velocityX, velocityZ);
    const adjustedSpeed = oldSpeed > maxSpeed
      ? Math.max(0, oldSpeed - (maxSpeed * scale))
      : maxSpeed;
    const speedScale = adjustedSpeed / newSpeed;
    x *= speedScale;
    z *= speedScale;
  }
  return { x, z };
}

// The BZFlag colour index of a team flag, or null for a superflag or for a flag
// whose identity is still hidden.
export function getFlagTeamIndex(abbreviation) {
  const type = getFlagType(abbreviation);
  return type && type.team ? type.team : null;
}

// What a client has learned about a slot's identity. bzfs reveals a superflag's
// type only while somebody is carrying it, so `flag.type` drops back to null
// the moment it is dropped -- but the flag is the same flag, and a player who
// saw what it was still knows. Identify feeds this too.
//
// `known` is a Map from flag index to abbreviation. The index is a *slot*, not a
// flag, so a slot that empties or takes a flag flying in has to be forgotten:
// its next identity is a fresh roll, and keeping the old one would label a new
// Useless as the Identify that stood there before it.
export function rememberFlagIdentity(known, index, type, status) {
  if (status === FLAG_STATUS.NO_EXIST || status === FLAG_STATUS.COMING) {
    known.delete(index);
    return;
  }
  if (type) known.set(index, type);
}

// The abbreviation to label a flag with, or null for one this client has no
// business knowing. A carried flag names itself; anything else is whatever was
// learned while its identity was visible. A team flag is never hidden, so it
// always answers.
export function getKnownFlagAbbreviation(known, flag) {
  if (!flag) return null;
  return flag.type || known.get(flag.index) || null;
}

export function getTeamFlagAbbreviation(colorIndex) {
  for (const type of Object.values(FLAG_TYPES)) {
    if (type.team === colorIndex) return type.abbreviation;
  }
  return null;
}

// FlagInfo::addFlag and FlagInfo::dropFlag both derive the flight from one
// thrown altitude. Upstream's downTime repeats upTime rather than using the
// landing altitude (FlagInfo.cxx:170), so the flight always lasts
// 2 * sqrt(2 * altitude / gravity) however far the flag has to fall; the height
// curve below is a lerp between the two altitudes plus this parabola, so it
// still arrives in the right place. `gravity` is bzo's positive magnitude where
// upstream's is negative.
export function computeFlagFlight(thrownAltitude, gravity) {
  const upTime = Math.sqrt(2 * thrownAltitude / gravity);
  return {
    flightEnd: 2 * upTime,
    initialVelocity: gravity * upTime,
  };
}

// The parabola a thrown flag follows, relative to the interpolated altitude.
export function getFlagFlightHeight(elapsed, initialVelocity, gravity) {
  return elapsed * (initialVelocity - 0.5 * gravity * elapsed);
}

// Where a Coming or Going flag hangs while it fades. Equals the thrown altitude
// exactly, which is what the apex of the parabola above reaches.
export function getFlagHoverHeight(flightEnd, initialVelocity, gravity) {
  return 0.5 * flightEnd * (initialVelocity - 0.25 * gravity * flightEnd);
}

function lerp(from, to, t) {
  return ((1 - t) * from) + (t * to);
}

// World::updateFlag. Returns where the flag is now, how opaque it is, and how
// big its warp is, for a flag `elapsed` seconds into its current status. A
// status that does not move returns its stored position untouched.
//
// `landed` reports that the flight is over: the client uses it to settle the
// flag, the server to decide when to send the next update.
export function getFlagFlightState(flag, elapsed, gravity) {
  const position = flag.position;
  const landing = flag.landingPosition;
  const launch = flag.launchPosition;
  const flightEnd = flag.flightEnd;
  const done = elapsed >= flightEnd;

  if (flag.status === FLAG_STATUS.IN_AIR) {
    if (done) {
      return { x: landing.x, y: landing.y, z: landing.z, alpha: 1, warp: 0, landed: true };
    }
    const t = elapsed / flightEnd;
    return {
      x: lerp(launch.x, landing.x, t),
      y: lerp(launch.y, landing.y, t) + getFlagFlightHeight(elapsed, flag.initialVelocity, gravity),
      z: lerp(launch.z, landing.z, t),
      alpha: 1,
      warp: 0,
      landed: false,
    };
  }

  // A Coming or Going flag never travels: it hovers over its landing spot and
  // rises or falls through the second or first half of the flight. Upstream
  // settles a Coming flag at z = 0 rather than at its landing altitude
  // (World.cxx:772); bzo uses the landing altitude, which is the same point
  // wherever a flag can currently spawn and stays right if that changes.
  const hover = getFlagHoverHeight(flightEnd, flag.initialVelocity, gravity);
  const quarter = 0.25 * flightEnd;
  const half = 0.5 * flightEnd;

  if (flag.status === FLAG_STATUS.COMING) {
    if (done) {
      return { x: landing.x, y: landing.y, z: landing.z, alpha: 1, warp: 0, landed: true };
    }
    if (elapsed >= half) {
      // Falling out of the hover.
      const y = landing.y + getFlagFlightHeight(elapsed, flag.initialVelocity, gravity);
      return { x: landing.x, y, z: landing.z, alpha: 1, warp: 0, landed: false };
    }
    // Hovering: the cloth fades in over the first quarter while the warp grows,
    // then the warp shrinks away over the second.
    const y = landing.y + hover;
    if (elapsed >= quarter) {
      const t = (elapsed - quarter) / quarter;
      return { x: landing.x, y, z: landing.z, alpha: 1, warp: 1 - t, landed: false };
    }
    const t = elapsed / quarter;
    return { x: landing.x, y, z: landing.z, alpha: t, warp: t, landed: false };
  }

  if (flag.status === FLAG_STATUS.GOING) {
    if (done) {
      return { x: landing.x, y: landing.y, z: landing.z, alpha: 0, warp: 0, landed: true };
    }
    if (elapsed < half) {
      // Rising into the hover.
      const y = landing.y + getFlagFlightHeight(elapsed, flag.initialVelocity, gravity);
      return { x: landing.x, y, z: landing.z, alpha: 1, warp: 0, landed: false };
    }
    // Hovering: the warp grows over the third quarter, then the cloth fades out
    // with it over the fourth.
    const y = landing.y + hover;
    if (elapsed < (3 * quarter)) {
      const t = ((3 * quarter) - elapsed) / quarter;
      return { x: landing.x, y, z: landing.z, alpha: 1, warp: 1 - t, landed: false };
    }
    const t = (flightEnd - elapsed) / quarter;
    return { x: landing.x, y, z: landing.z, alpha: t, warp: t, landed: false };
  }

  return { x: position.x, y: position.y, z: position.z, alpha: 1, warp: 0, landed: false };
}
