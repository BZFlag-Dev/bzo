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
const FLAG_STATUS = Object.freeze({
  NO_EXIST: 0,
  ON_GROUND: 1,
  ON_TANK: 2,
  IN_AIR: 3,
  COMING: 4,
  GOING: 5,
});

// Flag::FlagEndurance. Whether the flag can be dropped, and what dropping does.
const FLAG_ENDURANCE = Object.freeze({
  NORMAL: 0,
  UNSTABLE: 1,
  STICKY: 2,
});

// Flag::FlagQuality.
const FLAG_QUALITY = Object.freeze({
  GOOD: 0,
  BAD: 1,
});

// global.cxx defaults. Locked BZDB variables upstream, so they are constants
// here too.
const FLAG_ALTITUDE = 11.0;
const FLAG_RADIUS = 2.5;
const FLAG_POLE_SIZE = 0.8;
const FLAG_POLE_WIDTH = 0.025;
// _flagHeight: the clearance a flag needs above its landing spot, not its
// drawn size. DropGeometry tests a cylinder this tall.
const FLAG_CLEARANCE = 10.0;
const MAX_FLAG_GRABS = 4;
const BASE_SIZE = 60.0;

// BZFlag's tank radius, deliberately not bzo's 2. The grab radius scales with
// the world rather than with the vehicle, as the sound reference distance in
// audio.js does: a bzo tank is half as wide as an upstream one, and building
// the radius from it would mean driving almost dead centre over a flag to take
// it. Tune this one figure if 6.82 plays badly.
const BZFLAG_TANK_RADIUS = 4.32;
const FLAG_GRAB_RADIUS = BZFLAG_TANK_RADIUS + FLAG_RADIUS;
// checkEnvironment() only grabs when the tank and the flag are on the same
// level, and rate-limits requests to five a second.
const FLAG_GRAB_LEVEL_TOLERANCE = 0.1;
const FLAG_GRAB_INTERVAL_MS = 200;

// bzfs.cxx:86. A vacated superflag slot refills on a halflife distribution.
const SUPER_FLAG_HALF_LIFE_SECONDS = 10.0;

// _identifyRange. How far the Identify flag reaches when it names the nearest
// flag on the ground (searchFlag, bzfs.cxx:3631).
const IDENTIFY_RANGE = 50.0;

// Every superflag is white; only team flags carry a colour (Flag.cxx:409). That
// is what makes hiding a superflag's identity free: an unidentified flag looks
// exactly like an identified one.
const SUPER_FLAG_COLOR = 0xffffff;

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

const FLAG_TYPES = Object.freeze({
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
});

const FLAG_ABBREVIATIONS = Object.freeze(Object.keys(FLAG_TYPES));

function getFlagType(abbreviation) {
  return FLAG_TYPES[abbreviation] || null;
}

function isTeamFlag(abbreviation) {
  return getFlagTeamIndex(abbreviation) !== null;
}

// The BZFlag colour index of a team flag, or null for a superflag or for a flag
// whose identity is still hidden.
function getFlagTeamIndex(abbreviation) {
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
function rememberFlagIdentity(known, index, type, status) {
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
function getKnownFlagAbbreviation(known, flag) {
  if (!flag) return null;
  return flag.type || known.get(flag.index) || null;
}

function getTeamFlagAbbreviation(colorIndex) {
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
function computeFlagFlight(thrownAltitude, gravity) {
  const upTime = Math.sqrt(2 * thrownAltitude / gravity);
  return {
    flightEnd: 2 * upTime,
    initialVelocity: gravity * upTime,
  };
}

// The parabola a thrown flag follows, relative to the interpolated altitude.
function getFlagFlightHeight(elapsed, initialVelocity, gravity) {
  return elapsed * (initialVelocity - 0.5 * gravity * elapsed);
}

// Where a Coming or Going flag hangs while it fades. Equals the thrown altitude
// exactly, which is what the apex of the parabola above reaches.
function getFlagHoverHeight(flightEnd, initialVelocity, gravity) {
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
function getFlagFlightState(flag, elapsed, gravity) {
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
module.exports = {
  FLAG_STATUS,
  FLAG_ENDURANCE,
  FLAG_QUALITY,
  FLAG_ALTITUDE,
  FLAG_RADIUS,
  FLAG_POLE_SIZE,
  FLAG_POLE_WIDTH,
  FLAG_CLEARANCE,
  MAX_FLAG_GRABS,
  BASE_SIZE,
  BZFLAG_TANK_RADIUS,
  FLAG_GRAB_RADIUS,
  FLAG_GRAB_LEVEL_TOLERANCE,
  FLAG_GRAB_INTERVAL_MS,
  SUPER_FLAG_HALF_LIFE_SECONDS,
  IDENTIFY_RANGE,
  SUPER_FLAG_COLOR,
  FLAG_TYPES,
  FLAG_ABBREVIATIONS,
  getFlagType,
  isTeamFlag,
  getFlagTeamIndex,
  getKnownFlagAbbreviation,
  getTeamFlagAbbreviation,
  rememberFlagIdentity,
  computeFlagFlight,
  getFlagFlightHeight,
  getFlagHoverHeight,
  getFlagFlightState,
};
