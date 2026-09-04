/*
 * Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/timriker/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */

// Where the frame's time goes, in milliseconds per frame averaged over a
// second. One saturated core is the budget on the machines that matter, so the
// split between world simulation, HUD painting and draw submission is what
// decides which cost is worth attacking -- a figure no frame rate can give on
// its own. Sampled with performance.now() on purpose: this measures work done,
// not the display cadence the frame timestamp carries.
//
// The renderer marks phases of its own, so the accumulator lives here rather
// than in the frame loop that opens it. A phase runs from the previous mark to
// its own, whichever module made either.
const FRAME_PHASE_WINDOW_MS = 1000;
const FRAME_PHASES = Object.freeze([
  'xr', 'hud', 'input', 'matrix', 'shadows', 'sim', 'radar', 'worldfx', 'draw',
]);
const framePhaseTotals = new Map();
let framePhaseMark = 0;
let framePhaseWindowStart = performance.now();
let framePhaseFrames = 0;
let framePhaseReport = null;
let framePhaseProgramsLow = null;
let framePhaseProgramsHigh = null;
let framePhaseProgramRange = null;
// The shortest frame in the window. There is no web API for the display's
// refresh rate, and without it a client at 30fps because its panel is running
// at 30Hz is indistinguishable from one at 30fps because it is slow -- a
// difference worth an hour of chasing the wrong cost. The fastest frame a
// client managed bounds its refresh interval from below, which separates them.
let framePhaseLastStart = 0;
let framePhaseFastest = null;
let framePhaseFastestReport = null;

// The first mark of a frame measures from here.
export function startFramePhases() {
  const mark = performance.now();
  if (framePhaseLastStart > 0) {
    const interval = mark - framePhaseLastStart;
    if (interval > 0 && (framePhaseFastest === null || interval < framePhaseFastest)) {
      framePhaseFastest = interval;
    }
  }
  framePhaseLastStart = mark;
  framePhaseMark = mark;
}

export function markFramePhase(name) {
  const mark = performance.now();
  framePhaseTotals.set(name, (framePhaseTotals.get(name) || 0) + (mark - framePhaseMark));
  framePhaseMark = mark;
}

// Three.js keys its program cache on the light count, among other things, so a
// scene that adds and removes lights compiles a fresh set of programs every
// time it does. The spread over a window says whether that is happening; the
// single count a stats line carries cannot.
export function noteProgramCount(count) {
  if (!Number.isFinite(count)) return;
  if (framePhaseProgramsLow === null || count < framePhaseProgramsLow) framePhaseProgramsLow = count;
  if (framePhaseProgramsHigh === null || count > framePhaseProgramsHigh) framePhaseProgramsHigh = count;
}

export function rollFramePhases() {
  framePhaseFrames += 1;
  const elapsed = performance.now() - framePhaseWindowStart;
  if (elapsed < FRAME_PHASE_WINDOW_MS) return;

  const report = {};
  let measured = 0;
  for (const name of FRAME_PHASES) {
    const ms = Number(((framePhaseTotals.get(name) || 0) / framePhaseFrames).toFixed(2));
    report[name] = ms;
    measured += ms;
  }
  // Everything between the end of one frame callback and the start of the next:
  // the wait for the GPU to catch up and the display to accept the frame, the
  // browser laying out and painting the HUD's DOM, socket handlers, collection.
  // A client can be slow with nothing above it moving, and then none of the work
  // this file measures is the work to cut. The phases plus this one are the
  // whole frame, so the total matches 1000/fps.
  report.outside = Number(Math.max(0, (elapsed / framePhaseFrames) - measured).toFixed(2));
  framePhaseReport = report;
  framePhaseProgramRange = framePhaseProgramsLow === null
    ? null
    : `${framePhaseProgramsLow}-${framePhaseProgramsHigh}`;
  framePhaseFastestReport = framePhaseFastest === null
    ? null
    : Number(framePhaseFastest.toFixed(2));
  framePhaseTotals.clear();
  framePhaseFrames = 0;
  framePhaseProgramsLow = null;
  framePhaseProgramsHigh = null;
  framePhaseFastest = null;
  framePhaseWindowStart = performance.now();
}

// Milliseconds per frame for the last completed window, or null before one has
// completed.
export function getFramePhaseReport() {
  return framePhaseReport;
}

// "low-high" over the last completed window, or null.
export function getFrameProgramRange() {
  return framePhaseProgramRange;
}

// The shortest frame of the last completed window in ms, or null. At or below
// the display's refresh interval, so 33 means a 30Hz panel rather than a slow
// client.
export function getFastestFrame() {
  return framePhaseFastestReport;
}
