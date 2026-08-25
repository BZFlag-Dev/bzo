import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MAX_SHOT_SLOTS, normalizeShotSlotCount } from '../public/shot-limits.mjs';

const require = createRequire(import.meta.url);
const serverLimits = require('../server/shot-limits.cjs');

assert.equal(MAX_SHOT_SLOTS, 64);
assert.equal(serverLimits.MAX_SHOT_SLOTS, MAX_SHOT_SLOTS);
assert.equal(normalizeShotSlotCount(1), 1);
assert.equal(normalizeShotSlotCount(3), 3);
assert.equal(normalizeShotSlotCount('3'), 3);
assert.equal(normalizeShotSlotCount(MAX_SHOT_SLOTS), MAX_SHOT_SLOTS);
assert.equal(normalizeShotSlotCount(MAX_SHOT_SLOTS + 1), MAX_SHOT_SLOTS);
assert.equal(normalizeShotSlotCount(0), 1);
assert.equal(normalizeShotSlotCount(-1), 1);
assert.equal(normalizeShotSlotCount(1.5), 1);
assert.equal(normalizeShotSlotCount(Number.POSITIVE_INFINITY), 1);
assert.equal(normalizeShotSlotCount(Number.MAX_SAFE_INTEGER + 1), 1);
assert.equal(normalizeShotSlotCount(null), 1);
assert.equal(normalizeShotSlotCount(undefined), 1);

for (const value of [1, 3, '3', MAX_SHOT_SLOTS, MAX_SHOT_SLOTS + 1, 0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, null, undefined]) {
  assert.equal(
    serverLimits.normalizeShotSlotCount(value),
    normalizeShotSlotCount(value),
    `client/server normalization diverged for ${String(value)}`
  );
}

console.log('Shot slot limit tests passed');
