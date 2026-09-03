# Flags

Design and staging plan for BZFlag-style flags in bzo. All flag work is tracked
as **GitHub issue #6**; reference it from every flag commit and changelog entry.
Upstream references are paths under `$HOME/bzflag/`.

Phases 1 (the Useless superflag, animation, and the drop key), 2 (team flags and
capture) and 3 (Identify) are **implemented**. Phase 4 and later are not.

The flag table in `public/flags.mjs` carries only the flags bzo implements, so
**this document is the list of what is missing** -- see "What is left to add".

## What upstream does

**The server owns everything; the client animates from events.** There is no
per-frame flag packet. `FlagInfo::dropFlag()` (`src/bzfs/FlagInfo.cxx:154`)
computes launch position, landing position, `flightEnd`, and `initialVelocity`
once and ships them with `MsgDropFlag` + `MsgFlagUpdate`.
`World::updateFlag()` (`src/bzflag/World.cxx:729`) then integrates the arc
locally: x/y is a straight lerp from launch to landing, and z is that lerp plus
`t * (v0 + 0.5 * gravity * t)`. Server and client land the flag independently on
the same numbers.

**Status machine** (`include/Flag.h:60`):
`NoExist -> Coming -> OnGround -> OnTank -> InAir -> OnGround`, plus `Going` for
a flag that vanishes instead of landing. `Coming` and `Going` are the warp
effects: a hover at apex while the cloth fades in or out and a
`FlagWarpSceneNode` disc stack grows then shrinks.

**Identity hiding is unconditional, not an option.** `sendFlagUpdate()`
(`src/bzfs/bzfs.cxx:361`) sets `hide = (flagTeam == NoTeam) && (player == -1)`,
and `Flag::fakePack` substitutes the abbreviation `"PZ"`. Team flags are never
hidden, and a superflag becomes known to *everyone* the moment someone picks it
up. This costs nothing visually because every superflag renders white
(`FlagType::getColor`, `src/common/Flag.cxx:409`); only the name differs.

**The client initiates grab, drop, and capture.** `checkEnvironment()`
(`src/bzflag/playing.cxx:4119`) sweeps every flag each frame, throttled to one
grab request per 200ms, and sends `MsgGrabFlag` for anything within
`tankRadius + flagRadius` with `|dz| < 0.1`. `grabFlag()` (`bzfs.cxx:3674`)
revalidates with a very loose radius (`tankSpeed + tankRadius + flagRadius`) to
absorb lag. Capture is likewise client-detected. That matches bzo's rule that
the client always sends valid data and the server checks only catch modified
clients.

**Constants** (`src/common/global.cxx`): `_flagAltitude` 11, `_flagRadius` 2.5,
`_flagPoleSize` 0.8, `_flagPoleWidth` 0.025, `_flagHeight` 10 (drop-spot
clearance, not visual size), `_maxFlagGrabs` 4, `_baseSize` 60. Flight time is
`2 * sqrt(2 * 11 / 9.8)` ~ 3.0s for both the coming arc and every drop.

## Data model

`public/flags.mjs` + `server/flags.cjs` are a **mirrored** shared pair, checked
by `npm run check:shared-pairs` and covered by `scripts/test-flags.mjs`. They
hold the flag-type table, the status and endurance enums, the world constants,
and the flight math -- `computeFlagFlight()` (server, once per event) and
`getFlagFlightState()` (client, once per flag per frame). Both are pure, so the
test can hold them against upstream's numbers without a server around them.

Everything else is server-only, as it is upstream: landing-spot search
(`DropGeometry`, which lives in `bzfs`), spawn positions, grab validation.

Server state is a `flags` array indexed by flag index, each entry mirroring
`FlagInfo`. Flag ownership lives only there -- there is no second copy on the
player -- so `flag.owner` is the one answer to who carries what.

## Protocol

Client to server:

| message | payload | upstream |
|---|---|---|
| `grabFlag` | `{ index }` | `MsgGrabFlag` |
| `dropFlag` | none | `MsgDropFlag` |
| `captureFlag` | `{ team }` | `MsgCaptureFlag` |

Server to client:

| message | payload | upstream |
|---|---|---|
| `flagUpdate` | `{ flags: [...] }`, also embedded in `init` | `MsgFlagUpdate` |
| `flagGrabbed` | `{ playerId, flag }` | `MsgGrabFlag` |
| `flagDropped` | `{ playerId, flag }` | `MsgDropFlag` |
| `flagCaptured` | `{ playerId, index, flagTeam, baseTeam }` | `MsgCaptureFlag` |
| `nearFlag` | `{ index, flagType, position }`, to one player | `MsgNearFlag` |

Two deliberate departures from upstream's packets, neither a behaviour change:

- A hidden flag carries `type: null` rather than upstream's fake `"PZ"`. There
  is no wire compatibility to preserve here, and a packet that lies about the
  type is the sort of thing a reader has to disprove.
- `dropFlag` carries no position. Upstream sends the client's own position
  because the server's copy lags; bzo uses the server's copy, which is already
  movement-validated, so there is one less field to check and nothing to game.
  The difference is at most a frame of tank motion in where the flag lands.

## Phase 1 -- the Useless superflag (implemented)

16 superflag slots, upstream's `-s` default count, all of type `US`. Useless
does nothing by design, so the whole grab/drop/animation path can be exercised
with no gameplay effect to get wrong.

- Flags spawn through upstream's `addFlag()`: status `Coming`, a 3s hover-and-
  fall arc, and the warp disc stack.
- Grab is client-detected and server-validated; drop is the `Space` key, the
  XR `A` button, or the touch Drop button.
- A dropped flag flies upstream's parabola to whatever surface is below the
  tank, and either lands there or, on its fourth grab or anywhere but the
  ground, goes `Going` and vanishes. A vanished slot is refilled on upstream's
  halflife schedule (`FlagHalfLife` 10s, `bzfs.cxx:7621`).
- Dying, disconnecting, pausing, or self-destructing drops the carried flag
  (upstream `zapFlagByPlayer`).

**`flagsOnBuildings` reaches spawning and dropping by different routes.**
`resetFlag` passes `maxZ = 0` when it is off, so `DropGeometry::dropIt` takes its
short path and a flag always *spawns* on the ground; when it is on, `resetFlag`
picks a random altitude too and the downward ray decides which surface under it
the flag settles on. `dropFlag` always passes `maxZ = MAXFLOAT`, so a *dropped*
flag casts the full ray whatever the setting, and the setting only decides
whether a superflag may stay where the ray put it. With it off, a superflag
dropped on a roof takes the roof as its landing and goes `Going` from there,
rising out of the world rather than falling to the floor.

Either way a spawn must leave a tank-radius cylinder `_flagHeight` tall clear
above it, so a flag never appears somewhere a tank could not drive to reach.

bzo reads the switch as `-fb` from a map's `options` block or as
`flagsOnBuildings` in `server.json`, and either turns it on. `maps/hix.bzw` sets
it. Team flags ignore it entirely -- they always rest where the ray puts them.

**Grab radius is BZFlag's, not bzo's.** `FLAG_GRAB_RADIUS` is
`4.32 + 2.5 = 6.82`, built from BZFlag's tank radius rather than bzo's 2, for
the same reason the sound reference distance keeps 86.4: the figure scales with
the world, not the vehicle. A bzo tank would otherwise have to be almost
centred on a flag to take it. It is one constant in the shared pair if it needs
tuning.

## Phase 2 -- team flags and capture (implemented)

CTF is on when team mode is on and the map has bases, which is upstream's
`ClassicCTF`. Team flags come first in the flag array, as they do upstream, so a
team's flag index does not move when the superflag count changes.

- One team flag per colour team that has a base. Bases parse with a BZFlag
  colour index 1-4 in `server.js`; the flag home is the centre of the top of one
  of that team's bases. `maps/hix.bzw` has all four at z=26 h=4, so homes land at
  z=30.
- A team flag is `FlagNormal`: it never vanishes, never expires from grabs, and
  appears at its base rather than flying in. It leaves the world only when its
  team empties, and returns when the team's first player arrives
  (`bzfs.cxx:2478` and `:2966`). A flag an enemy carried off before the team
  emptied is cleared by `teamFlagTimeout` instead, default 30s.
- A dropped team flag rides the same downward ray onto whatever flat top it is
  standing over, and unlike a superflag it is allowed to stay there: team flags
  do come to rest on buildings. What it may never come to rest on is another
  team's base. When it would, upstream works down a
  chain: a drop zone, which bzo has none of, then the world centre, then its own
  base (`bzfs.cxx:3793`).
- Capture is carrying an enemy flag onto your own base, or your own flag onto an
  enemy base. The team that loses the flag is always the flag's own team, so an
  own goal costs your team and wins nobody anything. Everyone on the losing team
  dies with the standard explode delay and respawns on their base; the capping
  team gains a win and the capped team a loss (`bzfs.cxx:3994`). Upstream scores
  no individual deaths for a capture -- the team loss is the whole penalty.
- Spawning on base, from `RandomSpawnPolicy::getPosition`: in CTF that is every
  spawn, because `PlayerInfo::resetPlayer(ctf)` sets the flag at join, and it is
  set again for everyone caught by a capture.
- The `flag_alert`, `flag_won`, `flag_lost`, `teamgrab` and `killteam` sounds,
  and the "Flag Alert!!!", "Team Grab!!!" and "Don't capture your own flag!!!"
  alerts.

The capture cheat check only logs, as upstream's does -- every `removePlayer`
call in `bzfs.cxx` `captureFlag` is commented out. A quantized position and a
legitimate capture are hard to tell apart, and refusing an honest capture is
worse than trusting a modified client about a base it still had to drive to.

## What is left to add

Upstream carries 47 flag types: a Null type, four team flags, and 42
superflags. bzo has the four team flags, Useless and Identify, so **40
superflags remain** -- 26 good and 14 bad. The table below is the whole list,
grouped by the machinery each group needs rather than by name, because the
machinery is what decides the order. `src/common/Flag.cxx` is the authority for
every name, abbreviation, endurance, quality and help string;
`src/common/global.cxx` for every constant named here.

| Phase | Flags | What it needs that bzo does not have |
|---|---|---|
| 4 | `B` `JM` `CB` `WA` | shake timeout, shake wins, antidote flags |
| 5 | `V` `QT` `A` `M` `RC` `FO` `RO` `LT` `RT` `JP` `NJ` `BY` `TR` | the effect resolver, in the shared pair |
| 6 | `SR` `SH` `G` | damage rules, and a shot that remembers its flag |
| 7 | `T` `N` `O` | per-player tank dimensions |
| 8 | `F` `MG` `L` `IB` `SB` | per-shot rate, life, velocity and obstacle rules |
| 9 | `R` | shot reflection off obstacle normals |
| 10 | `SW` | a shot with no path -- an expanding sphere |
| 11 | `TH` | flag stealing |
| 12 | `GM` | a steerable shot, and a lock-on target |
| 13 | `ST` `CL` `MQ` `SE` | per-viewer visibility |
| 14 | `OO` `BU` `WG` `PZ` | movement through and under geometry |

Phases 4 to 8 are each a small hook on machinery the phase before it built.
Phases 9 to 14 are each their own feature and can be taken in any order once 8
is done.

## Phase 3 -- Identify (implemented)

The first superflag with an effect, and the one that makes an unidentified flag
on the ground worth walking up to. Everything hidden identity protects is
meaningless while every flag is the same flag.

Server-side and passive. `searchFlag()` finds the nearest flag resting on the
ground within `IDENTIFY_RANGE` 50 of a player carrying `ID`, and when that is a
different flag from last time sends `nearFlag` to that player alone. The client
puts `Closest Flag: <name>` on the HUD for 5 seconds and in the chat log.

- `nearFlag` is server-to-client, `{ index, flagType, position }`, and it is the
  one flag message sent to a single player rather than broadcast.
- The sweep runs off each accepted position update, as upstream runs it off
  `MsgPlayerUpdate` (`bzfs.cxx:5509`), not off the game loop -- a player who is
  not moving cannot have a new nearest flag.
- `player.lastIdFlag` is the dedupe. Upstream leaves it alone when the player
  stops carrying `ID`, so re-taking the flag beside the same flag stays silent;
  bzo clears it, because the answer is what a player who just picked the flag
  up is waiting for.
- A flag's identity stays hidden in `flagUpdate` regardless. Identify tells its
  carrier what one flag is; it does not reveal that flag to the world, which is
  why the message carries a type and the flag update still does not.
- The client guards on still carrying `ID`, as upstream does
  (`playing.cxx:2029`): the message can arrive a lag period after the flag is
  gone.
- The alert takes upstream's text and its 5 seconds but sits on slot 1 rather
  than slot 0. Driving past a row of flags reports each one, and slot 0 carries
  the death and kill notices, which a player has four seconds to read and cannot
  ask for again.

Do not confuse this with bzo's `identify` binding on `I` and right click, which
picks the tank in your sights. Same word, unrelated feature; the `ID` flag has
no key.

### Identity the client remembers

bzfs reveals a superflag's type only while somebody is carrying it, so a flag
that has been picked up and put back down goes anonymous again on the wire even
though the player watching it knows exactly what it is. `rememberFlagIdentity`
in the flags pair holds what a client has learned, keyed by flag index, fed by
`nearFlag` and by any flag state that arrives with a type on it -- which covers
a grab by anyone, since bzfs reveals it to everybody, and covers team flags,
which are never hidden.

The index is a *slot* rather than a flag, so the memory is dropped when the slot
empties or takes a flag flying in: its next identity is a fresh roll, and
keeping the old one would label a new Useless as the Identify that stood there
before it.

With the debug labels on, a flag whose identity this client knows carries its
abbreviation over it -- `ID`, `US`, or `B*` for the blue team flag, whose colour
already says so. A flag nobody has identified carries nothing, which is the
point. The label is created the first time a flag has something to say, so a
world of 200 flags does not pay for 200 label canvases to draw nothing.

### The registry rule this phase sets

**`FLAG_TYPES` holds only the flags bzo implements.** Adding a row is the last
step of implementing a flag, not the first, because the row is what:

- puts the flag in `superFlags.allowed`'s default, so the server starts handing
  it out (`normalizeSuperFlagConfig`, `server.js:2180`);
- documents it in the help panel, which `buildFlagHelp` generates from the same
  table so the two can never disagree;
- names it on the scoreboard, in the grab and drop messages, and in Identify's
  own answer.

A row with no behaviour behind it is a flag in the world that lies about what it
does. **This document is the list of what is missing. The code is not.**

Each row carries upstream's `name`, `abbreviation`, `endurance`, `quality`,
`team` and `help`, in upstream's declaration order, and `scripts/test-flags.mjs`
holds every row against those rules: a key matching its abbreviation, a name and
help string present, every bad flag sticky, every team flag normal.

Upstream's `-f` and `+f` (`CmdLineOptions.cxx:751` and `:757`) set per-type
counts and forbid types. `superFlags.allowed` covers the common case; per-type
counts are worth adding only when there are enough flags for the mix to matter.

## Phase 4 -- shaking a bad flag off

No bad flag is playable until you can get rid of it, so the machinery comes
before the flags. Sticky endurance is already plumbed: `addFlag` sets it from
`quality` (`server.js:2278`), the drop key refuses it (`:4092`), and
`dropPlayerFlag` zaps rather than throws it (`:2570`). What is missing is every
way upstream lets you shed one.

- **Shake timeout** (`LocalPlayer.cxx:159`). A client-side countdown, reset on
  pickup; at zero the client sends `dropFlag`. Upstream's `-st` takes tenths of
  a second, clamped to 0.1s..300s (`CmdLineOptions.cxx:1268`). The server must
  accept a drop request for a sticky flag when the countdown is the reason,
  which means the server runs the same clock -- otherwise a modified client
  drops a bad flag instantly. Put the countdown in the shared pair and have the
  server refuse a sticky drop that arrives early.
- **Shake wins** (`LocalPlayer.cxx:1714`). A kill count, upstream's `-sw`,
  clamped 1..20. Decrement on each win; at zero, drop. Same shared-clock
  reasoning -- the server owns the score, so let the server decide and tell the
  client, rather than the client asking.
- **Antidote flags** (`-sa`, `LocalPlayer.cxx:1668`). Entirely client-side
  upstream, and worth keeping that way: on picking up a sticky flag the client
  picks a random spot clear of buildings, draws a yellow flag there, and sends
  `dropFlag` when you drive within `tankRadius + flagRadius` of it. The radar
  draws it (`RadarRenderer.cxx:715`) and the HUD points at it -- bzo already
  has a heading-tape marker for its own team flag, so the antidote marker is a
  second entry in the same list. The server side is only the switch and, again,
  accepting the drop.
- `flagShakeTimeout`, `flagShakeWins` and `antidoteFlags` in `server.json`,
  reaching the client in `init` the way the rest of the game config does.

Then the four bad flags that need nothing else, because they change only what
the carrier sees:

- **`B` Blindness** -- no out-the-window view; the radar still works. Upstream
  draws a black screen and keeps the HUD.
- **`JM` Jamming** -- the radar stops working; the view is untouched.
- **`CB` Colorblindness** -- every tank draws in your own team's colour, so you
  cannot tell friend from enemy. Touches the tank colour lookup, the radar
  colour lookup, and the scoreboard.
- **`WA` Wide Angle** -- field of view goes to `_wideAngleAng` 1.745329 rad
  (100 degrees). One camera value on the desktop; in XR the headset owns the
  projection, so this one has nothing to do there and should say so rather than
  fighting it.

**Test:** each of these plus a shake timeout short enough to watch.

## Phase 5 -- the effect resolver, and the movement flags

Thirteen flags, one piece of machinery. Every one of them is a multiplier or a
clamp on tank motion, and both sides need the same answer: the client predicts
the move, the server validates it against the client's own reported velocities
(`validateMovement`, `server.js:1895`), so a speed multiplier the server does
not know about reads as linear drift.

Add to the shared pair:

```
getFlagEffects(abbreviation) -> {
  speedFactor, angVelFactor,
  linearAccel, angularAccel, friction,   // null means use the world's
  forwardOnly, reverseOnly, leftOnly, rightOnly, reverseControls,
  canJump, mustJump, mustFire,
  ...
}
```

Pure, table-driven, tested by `scripts/test-flags.mjs` against upstream's
numbers. `motion.mjs` and its `.cjs` twin take it as an argument rather than
looking it up, so they stay pure too. The call site on the client is wherever
input becomes velocity; on the server it is the extrapolation in
`getExtrapolatedPosition` and the drift thresholds.

Upstream applies these in `LocalPlayer::getMaxSpeed` (`LocalPlayer.cxx:1100`),
`getMaxAngVel` (`:1156`) and `doUpdateMotion` (`:1541`):

| Flag | Effect | Constant |
|---|---|---|
| `V` High Speed | speed x1.5 | `_velocityAd` |
| `QT` Quick Turn | turn x1.5 | `_angularAd` |
| `A` Agility | speed x2.25 for `_agilityTimeWindow` 1.0s after a direction change of at least `_agilityVelDelta` 0.3 | `_agilityAdVel` |
| `M` Momentum | acceleration limited to `_momentumLinAcc` 1.0 and `_momentumAngAcc` 1.0, friction `_momentumFriction` 0 | bad |
| `RC` Reverse Controls | drive and turn inputs negated | bad |
| `FO` Forward Only | reverse speed clamped to 0 | bad |
| `RO` Reverse Only | forward speed clamped to 0 | bad |
| `LT` Left Turn Only | right turn clamped to 0 | bad |
| `RT` Right Turn Only | left turn clamped to 0 | bad |
| `JP` Jumping | may jump | needs the world switch, below |
| `NJ` No Jumping | may not jump | bad |
| `BY` Bouncy | jumps continuously on landing (`LocalPlayer.cxx:877`) | bad |
| `TR` Trigger Happy | fires continuously (`LocalPlayer.cxx:1308`) | bad |

`JP` needs one thing first: **every bzo tank can jump today.** Upstream gates it
on the world (`LocalPlayer.cxx:479`), so a world either allows jumping for all
or hands it out as a flag. Add the switch -- upstream's `-j`, a map `options`
entry and a `server.json` key, defaulting to on so today's behaviour is what
you get by default -- and then `JP` and `NJ` both mean something. bzo's jump is
already an arc with no air steering, which is upstream's.

`TR` is a firing rule rather than a motion one, but it belongs here: it is an
input clamp, and the resolver is where input clamps live.

## Phase 6 -- damage rules

Three flags that change what a hit does rather than what a shot is. bzo's server
owns hit detection (`simulateProjectilesStep`, `server.js:3326`), which makes
all three server-side and simpler than upstream.

- **`SH` Shield** -- being shot drops your flag instead of killing you
  (`bzfs.cxx:3879`), and the flag flies `_shieldFlight` 2.7 times the normal
  altitude (`FlagInfo.cxx:174`). Two lines in the hit path plus one argument to
  `computeFlagFlight`, which already takes the thrown altitude.
- **`SR` Steamroller** -- touching a tank kills it, within
  `_srRadiusMult` 2.0 tank radii. A new server-side per-tick proximity sweep
  over live players; there is no such sweep today. Upstream's `_squishFactor`
  and `_squishTime` only flatten the victim's model as it dies, which is
  cosmetic and can wait.
- **`G` Genocide** -- killing one tank kills its whole team. Upstream detects
  this on each client (`playing.cxx:2664`), because upstream's clients report
  their own deaths; bzo's server decides hits, so bzo does it in one place on
  the server when the killing shot carried `G`. That is a deliberate deviation
  and the reason to note it: the outcome is identical and the check is not
  duplicated per client.

`G` needs the projectile to remember which flag fired it. Add `flag` to
`Projectile` (`server.js:1598`) from the shooter's carried flag at fire time,
and put it in the `shotBegin` payload -- the client needs it too, from phase 8
on, to draw the shot right. This is the whole of phase 8's plumbing, arriving
one phase early because `G` is the cheapest thing that proves it works.

## Phase 7 -- per-player tank dimensions

Three flags, and one number that is currently a literal in a dozen places.
`checkCollision(x, y, z, tankRadius = 2, ...)` (`server.js:1693`),
`validateMovement`'s hardcoded `2` (`:1961`), the hit test's `dist < 2`
(`:3418`), `findValidSpawnPosition` and the client's `validateMove`
(`public/client.js:4212`) all assume one size for every tank.

Give a player a size derived from its flag, thread it through all of those, and
scale the rendered model to match:

| Flag | Effect | Constant |
|---|---|---|
| `T` Tiny | length and width x0.4 | `_tinyFactor` |
| `N` Narrow | width x0.001 | literal in `Player.cxx:756` |
| `O` Obesity | length and width x2.5, too wide for a teleporter | `_obeseFactor` |

Height is never scaled -- `Player::setFlagEffect` (`Player.cxx:733`) touches
only the first two of the three dimensions, so a Tiny tank is short and stubby
rather than small, and an Obese one is not tall. Upstream also eases the scale
in over `FlagEffectTime` rather than snapping it; that is cosmetic and can wait,
but the collision size must be the *target* from the moment the flag is taken or
the two sides disagree during the ease.

Upstream's dimensions are `_tankWidth` 2.8, `_tankLength` 6.0 (so
`_tankRadius` = 0.72 x length = 4.32) and `_tankHeight` 2.05. bzo's tank is
half that width, which is why `FLAG_GRAB_RADIUS` is built from
`BZFLAG_TANK_RADIUS` rather than from bzo's 2 -- the same question comes up
here, and the same answer applies: scale the *factors* from upstream and the
*base* from bzo.

`N` is the one that needs the oriented box rather than the cylinder, and
`checkCollision` already has both shapes (`options.rotation`). The hit test
does not -- it is a plain radius -- so `N` only reads as narrow against shots
once the hit test uses the box too. Worth doing in this phase; upstream's
`Player::getDimensions` is one shape for both.

`O` not fitting through a teleporter falls out of the box test for free, since
bzo's teleporter portal interior already keeps a full-radius check.

## Phase 8 -- shot variants

Five flags. All of them are the same change: a shot's rate, lifetime, velocity
and obstacle behaviour come from the firing flag instead of from
`GAME_CONFIG`. Phase 6 already put `flag` on the projectile and in `shotBegin`.

- `GAME_CONFIG.SHOT_SPEED`, `SHOT_RANGE`, `SHOT_RELOAD_TIME` and
  `SHOT_MAX_ACTIVE` become the defaults a resolver overrides per shot. Upstream
  multiplies: `ShotStatistics` and `LocalPlayer::fireShot` read `_*AdVel`,
  `_*AdRate` and `_*AdLife` and apply them to the world's numbers.
- `getShotRejection` (`server.js:1992`) and `getAvailableShotSlot` (`:2058`)
  are the reload gate. Both need the per-flag rate or a machine gun trips them.
- The client draws the shot and must agree about its length and lifetime.

| Flag | Velocity | Rate | Life | Notes |
|---|---|---|---|---|
| `F` Rapid Fire | x1.5 | x2 | x1/2 | `_rFireAdVel` `_rFireAdRate` `_rFireAdLife` |
| `MG` Machine Gun | x1.5 | x10 | x1/10 | `_mGunAd*` |
| `L` Laser | x1000 | x0.5 | x0.1 | `_laserAd*`; effectively instant, so it is a beam to draw, not a projectile to fly. Also `_lRAdRate` 0.5 when Laser and Ricochet meet. |
| `IB` Invisible Bullet | -- | -- | -- | the shot is not drawn on other players' radar, but is drawn out the window |
| `SB` Super Bullet | -- | -- | -- | passes through buildings; skip the obstacle test in `simulateProjectilesStep` |

`L` is the one with real client work in it: an instant beam has no travel to
interpolate, so it wants its own draw path.

## Phase 9 -- Ricochet

`R`, one flag, and bzo has nothing to build on -- a shot that hits an obstacle
ends. Upstream reflects the velocity about the surface normal and keeps going
until the lifetime runs out. The normal is the piece bzo already has:
`motion.mjs` takes a `getNormal` callback for exactly this, and
`findProjectileImpactPoint` already finds the impact point. Reflect there, both
on the server and in the client's own drawing of the shot, and keep the
lifetime running.

Worth its own phase because it is the first shot that does not travel in a
straight line, and because `SB` and `L` both interact with it.

## Phase 10 -- Shock Wave

`SW`. A shot with no position and no direction: firing kills every tank between
`_shockInRadius` (`_tankLength`) and `_shockOutRadius` 60, over
`_shockAdLife` 0.2 of the normal shot life, including tanks on and inside
buildings. Needs a shot kind that expands rather than moves, a sphere to draw,
and the team-kill warning upstream gives it. The proximity sweep from `SR` is
the same shape of code.

## Phase 11 -- Thief

`TH`. A fast, tiny, harmless tank whose shot steals a flag instead of killing:
speed `_thiefVelAd` 1.67, size `_thiefTinyFactor` 0.5, shot velocity
`_thiefAdShotVel` 8.0, rate `_thiefAdRate` 12.0, life `_thiefAdLife` 0.05, and
`_thiefDropTime` half a reload before the stolen flag can be dropped. Needs
phase 7's dimensions and phase 8's shot variants, and one new server rule: a
hit transfers the victim's flag to the shooter rather than killing.

## Phase 12 -- Guided Missile

`GM`. A shot that steers toward a locked target at `_gmTurnAngle` 0.628319 rad
per second after `_gmActivationTime` 0.5s, with life `_gmAdLife` 0.95 and a
`_gmSize` 1.5 model. Lock-on is upstream's `identify` at `_lockOnAngle` 0.15,
retargetable in flight.

bzo already has the target: the `identify` binding on `I`, right click, either
VR B button and either gamepad shoulder picks the tank in your sights within
`_targetingAngle` 0.3 and sets it as your nemesis. That is the lock. What is
missing is a shot whose direction is recomputed each tick on the server, and
the HUD lock-on box and sound.

## Phase 13 -- per-viewer visibility

Four flags that all ask the same new question: what a tank looks like depends on
who is looking. Today every client draws every tank the same way. All four need
the *carried flag of other players* to be known to the client, which it already
is -- `flag.owner` in the flags array -- so the work is in the render path, not
the protocol.

- **`ST` Stealth** -- invisible on radar; the model still draws, and its shots
  still draw.
- **`CL` Cloaking** -- the model does not draw; the radar blip still does. A
  cloaked tank hit by a laser is revealed (`LocalPlayer.cxx:1630`).
- **`MQ` Masquerade** -- to an enemy, your tank and your scoreboard row take
  *their* team's colour. To a teammate, nothing changes.
- **`SE` Seer** -- sees stealthed, cloaked and masquerading tanks normally. It
  is the counter to the other three, so it is cheapest to write last and it is
  what makes them testable without two machines.

## Phase 14 -- movement through and under geometry

Four flags, each of them a change to collision itself, which is why they are
last. `motion.mjs` and `collision.mjs` are the shared pairs involved, and both
have tests that need to keep passing.

- **`OO` Oscillation Overthruster** -- drives through buildings; cannot reverse
  or shoot while inside one (`LocalPlayer.cxx:678`, `:916`). Needs "inside a
  building" as a state the tank can be in, which `motion.mjs` currently treats
  as the one thing that must never happen.
- **`BU` Burrow** -- sits at `_burrowDepth` -1.32, immune to normal shots,
  killable by `SR` from anyone including teammates, speed x`_burrowSpeedAd` 0.80
  and turn x`_burrowAngularAd` 0.55. Needs negative ground, which bzo's
  `groundLimit` assumes is zero.
- **`WG` Wings** -- drives in the air, `_wingsJumpCount` 1 extra jump at
  `_wingsJumpVelocity`, gravity `_wingsGravity`, `_wingsSlideTime` 0.0. Needs
  air steering, which bzo deliberately does not have.
- **`PZ` Phantom Zone** -- passing through a teleporter toggles Zoned; a Zoned
  tank drives through buildings, fires Zoned shots, and can only be hit by
  `SB`, `SW` or another Zoned shot. Needs `OO`'s pass-through, a hook on bzo's
  teleporter path, and a shot kind with its own hit rules.

## Rules for an agent picking this up

- One phase per commit, and one changelog entry per phase, both referencing
  issue #6.
- `npm run check` before you are done. `check:shared-pairs` will fail if
  `public/flags.mjs` and `server/flags.cjs` drift, and every constant and every
  pure function added in these phases belongs in that pair and in
  `scripts/test-flags.mjs`.
- Take the numbers from `src/common/global.cxx`, not from this document. If they
  disagree, upstream is right and this document is stale.
- A flag's effect is server-authoritative wherever a modified client could gain
  by lying, and client-side wherever it only changes what its own player sees.
  Blindness is client-side; Velocity is not.
- Ship no setting for a flag's presentation. Where upstream offers variants,
  implement the default one.
- **Add the flag's row to `FLAG_TYPES` last.** The row is what puts the flag in
  `superFlags.allowed`'s default and in the help panel, so a row landing ahead
  of its behaviour is a flag in the world that lies about what it does and a
  help entry that promises it. Cross the flag off the table above in the same
  commit -- that table is the only list of what is missing.
- The help panel documents each flag from its row, with upstream's own help
  string. `buildFlagHelp` generates it, so there is nothing to write in
  `index.html`; get the `help` field right and the page follows.
