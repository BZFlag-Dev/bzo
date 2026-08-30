/*
 * Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/timriker/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const renderQualitySource = readFileSync(
  new URL('../public/render-quality.js', import.meta.url),
);
const {
  RENDER_QUALITY_MODES,
  collectRenderQualityHints,
  detectRenderCapabilities,
  getInitialRendererOptions,
  getRenderQualityProfiles,
  normalizeRenderQualityMode,
  selectRenderQualityProfile,
} = await import(`data:text/javascript;base64,${renderQualitySource.toString('base64')}`);

function createRenderer({
  antialias = true,
  stencil = true,
  stencilBits = 8,
  maxTextureSize = 8192,
  maxSamples = 4,
  maxAnisotropy = 16,
  webgl2 = true,
  anisotropyExtension = true,
} = {}) {
  const context = {
    MAX_TEXTURE_SIZE: 'MAX_TEXTURE_SIZE',
    MAX_SAMPLES: 'MAX_SAMPLES',
    STENCIL_BITS: 'STENCIL_BITS',
    getContextAttributes: () => ({ antialias, stencil }),
    getExtension: (name) => (anisotropyExtension && name === 'EXT_texture_filter_anisotropic'
      ? { MAX_TEXTURE_MAX_ANISOTROPY_EXT: 'MAX_TEXTURE_MAX_ANISOTROPY_EXT' }
      : null),
    getParameter: (parameter) => ({
      MAX_TEXTURE_SIZE: maxTextureSize,
      MAX_SAMPLES: maxSamples,
      STENCIL_BITS: stencilBits,
      MAX_TEXTURE_MAX_ANISOTROPY_EXT: maxAnisotropy,
    })[parameter],
  };
  return {
    capabilities: { isWebGL2: webgl2 },
    getContext: () => context,
  };
}

assert.deepEqual(RENDER_QUALITY_MODES, ['auto', 'low', 'balanced', 'high']);
assert.equal(normalizeRenderQualityMode('auto'), 'auto');
assert.equal(normalizeRenderQualityMode('low'), 'low');
assert.equal(normalizeRenderQualityMode('balanced'), 'balanced');
assert.equal(normalizeRenderQualityMode('high'), 'high');
for (const invalidMode of [undefined, null, '', 'Auto', 'ultra', 1]) {
  assert.equal(normalizeRenderQualityMode(invalidMode), 'auto');
}

const hints = collectRenderQualityHints({
  devicePixelRatio: 2,
  navigator: { deviceMemory: 8, hardwareConcurrency: 12 },
});
assert.deepEqual(hints, { devicePixelRatio: 2, deviceMemory: 8, hardwareConcurrency: 12 });
assert.deepEqual(collectRenderQualityHints({
  devicePixelRatio: 0,
  navigator: { deviceMemory: Infinity, hardwareConcurrency: -1 },
}), { devicePixelRatio: null, deviceMemory: null, hardwareConcurrency: null });
assert.deepEqual(collectRenderQualityHints(null), {
  devicePixelRatio: null,
  deviceMemory: null,
  hardwareConcurrency: null,
});

const capableCapabilities = detectRenderCapabilities(createRenderer(), hints);
assert.deepEqual(capableCapabilities, {
  webgl: true,
  webgl2: true,
  webgl1: false,
  antialias: true,
  stencil: true,
  maxTextureSize: 8192,
  maxSamples: 4,
  maxAnisotropy: 16,
  devicePixelRatio: 2,
  deviceMemory: 8,
  hardwareConcurrency: 12,
});

const noWebglCapabilities = detectRenderCapabilities(null, hints);
assert.deepEqual(noWebglCapabilities, {
  webgl: false,
  webgl2: false,
  webgl1: false,
  antialias: false,
  stencil: false,
  maxTextureSize: null,
  maxSamples: 0,
  maxAnisotropy: 0,
  devicePixelRatio: 2,
  deviceMemory: 8,
  hardwareConcurrency: 12,
});
assert.equal(selectRenderQualityProfile('auto', noWebglCapabilities).name, 'low');

const noStencilCapabilities = detectRenderCapabilities(createRenderer({ stencilBits: 0 }), hints);
assert.equal(noStencilCapabilities.stencil, false);
assert.equal(selectRenderQualityProfile('auto', noStencilCapabilities).name, 'high');
assert.equal(selectRenderQualityProfile('auto', noStencilCapabilities).renderer.stencil, true);

const webgl1Capabilities = detectRenderCapabilities(createRenderer({ webgl2: false }), hints);
assert.equal(webgl1Capabilities.webgl1, true);
assert.equal(webgl1Capabilities.webgl2, false);

const profiles = getRenderQualityProfiles();
assert.deepEqual(profiles.low, {
  name: 'low',
  pixelRatioCap: 1,
  renderer: { antialias: false, stencil: false },
  projectedShadows: 'off',
  shadowUpdateIntervalMs: Infinity,
  pointLightLimits: { projectile: 0, explosion: 0, impact: 0 },
});
assert.deepEqual(profiles.balanced, {
  name: 'balanced',
  pixelRatioCap: 1.5,
  renderer: { antialias: true, stencil: true },
  projectedShadows: 'stencil',
  shadowUpdateIntervalMs: 100,
  pointLightLimits: { projectile: 8, explosion: 3, impact: 4 },
});
assert.deepEqual(profiles.high, {
  name: 'high',
  pixelRatioCap: 2,
  renderer: { antialias: true, stencil: true },
  projectedShadows: 'stencil',
  shadowUpdateIntervalMs: 48,
  pointLightLimits: { projectile: 16, explosion: 6, impact: 8 },
});

assert.equal(selectRenderQualityProfile('low', capableCapabilities).name, 'low');
assert.equal(selectRenderQualityProfile('balanced', noWebglCapabilities).name, 'balanced');
assert.equal(selectRenderQualityProfile('high', noWebglCapabilities).name, 'high');
assert.equal(selectRenderQualityProfile('invalid', capableCapabilities).name, 'high');
assert.equal(selectRenderQualityProfile('auto', {
  ...capableCapabilities,
  deviceMemory: 2,
}).name, 'low');
assert.equal(selectRenderQualityProfile('auto', {
  webgl: true,
  maxTextureSize: 4096,
  deviceMemory: 4,
  hardwareConcurrency: 4,
}).name, 'balanced');
assert.equal(selectRenderQualityProfile('auto', capableCapabilities, { averageFrameMs: 17.9 }).name, 'high');
assert.equal(selectRenderQualityProfile('auto', capableCapabilities, { averageFrameMs: 30 }).name, 'low');

assert.deepEqual(getInitialRendererOptions('low', hints), {
  antialias: false,
  stencil: false,
  xrCompatible: true,
});
assert.deepEqual(getInitialRendererOptions('balanced', hints), {
  antialias: true,
  stencil: true,
  xrCompatible: true,
});
assert.deepEqual(getInitialRendererOptions('high', hints), {
  antialias: true,
  stencil: true,
  xrCompatible: true,
});
assert.deepEqual(getInitialRendererOptions('auto', {
  deviceMemory: 2,
  hardwareConcurrency: 8,
}), { antialias: false, stencil: false, xrCompatible: true });

const firstHighProfile = selectRenderQualityProfile('high', capableCapabilities);
firstHighProfile.renderer.antialias = false;
firstHighProfile.pointLightLimits.projectile = 0;
const secondHighProfile = selectRenderQualityProfile('high', capableCapabilities);
assert.equal(secondHighProfile.renderer.antialias, true);
assert.equal(secondHighProfile.pointLightLimits.projectile, 16);
assert.deepEqual(
  selectRenderQualityProfile('auto', capableCapabilities, { averageFrameMs: 18 }),
  selectRenderQualityProfile('auto', capableCapabilities, { averageFrameMs: 18 }),
);

console.log('render quality tests passed');
