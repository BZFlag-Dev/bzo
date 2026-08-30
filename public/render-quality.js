/*
 * Copyright (C) 2025-2026 Tim Riker <timriker@gmail.com>
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Source: https://github.com/timriker/bzo
 * See LICENSE or https://www.gnu.org/licenses/agpl-3.0.html
 */

// This module deliberately contains no Three.js dependency. Profiles and policy
// selection stay deterministic so they can be exercised outside a browser.
export const RENDER_QUALITY_MODES = Object.freeze(['auto', 'low', 'balanced', 'high']);

const QUALITY_PROFILES = Object.freeze({
  low: Object.freeze({
    name: 'low',
    pixelRatioCap: 1,
    renderer: Object.freeze({ antialias: false, stencil: false }),
    projectedShadows: 'off',
    shadowUpdateIntervalMs: Infinity,
    pointLightLimits: Object.freeze({ projectile: 0, explosion: 0, impact: 0 }),
  }),
  balanced: Object.freeze({
    name: 'balanced',
    pixelRatioCap: 1.5,
    renderer: Object.freeze({ antialias: true, stencil: true }),
    projectedShadows: 'stencil',
    shadowUpdateIntervalMs: 100,
    pointLightLimits: Object.freeze({ projectile: 8, explosion: 3, impact: 4 }),
  }),
  high: Object.freeze({
    name: 'high',
    pixelRatioCap: 2,
    renderer: Object.freeze({ antialias: true, stencil: true }),
    projectedShadows: 'stencil',
    shadowUpdateIntervalMs: 48,
    pointLightLimits: Object.freeze({ projectile: 16, explosion: 6, impact: 8 }),
  }),
});

function finitePositive(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function copyProfile(profile) {
  return {
    ...profile,
    renderer: { ...profile.renderer },
    pointLightLimits: { ...profile.pointLightLimits },
  };
}

export function normalizeRenderQualityMode(mode) {
  return RENDER_QUALITY_MODES.includes(mode) ? mode : 'auto';
}

export function collectRenderQualityHints(environment = globalThis) {
  const navigatorRef = environment?.navigator;
  return {
    devicePixelRatio: finitePositive(environment?.devicePixelRatio),
    deviceMemory: finitePositive(navigatorRef?.deviceMemory),
    hardwareConcurrency: finitePositive(navigatorRef?.hardwareConcurrency),
  };
}

// Read only standard WebGL limits from the renderer's already-created context.
// No probe canvas is created, which avoids accidentally allocating a second GL context.
export function detectRenderCapabilities(renderer, hints = collectRenderQualityHints()) {
  const context = renderer?.getContext?.();
  const rendererCapabilities = renderer?.capabilities;
  const attributes = context?.getContextAttributes?.() || {};
  const getParameter = (parameter) => {
    try {
      return context ? context.getParameter(parameter) : null;
    } catch {
      return null;
    }
  };
  const maxTextureSize = context?.MAX_TEXTURE_SIZE === undefined
    ? null
    : finitePositive(getParameter(context.MAX_TEXTURE_SIZE));
  const maxSamples = context?.MAX_SAMPLES === undefined
    ? 0
    : finitePositive(getParameter(context.MAX_SAMPLES)) || 0;
  const stencilBits = context?.STENCIL_BITS === undefined
    ? 0
    : finitePositive(getParameter(context.STENCIL_BITS)) || 0;
  let maxAnisotropy = 0;
  try {
    const extension = context?.getExtension?.('EXT_texture_filter_anisotropic')
      || context?.getExtension?.('WEBKIT_EXT_texture_filter_anisotropic')
      || context?.getExtension?.('MOZ_EXT_texture_filter_anisotropic');
    maxAnisotropy = extension
      ? (finitePositive(getParameter(extension.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) || 0)
      : 0;
  } catch {
    maxAnisotropy = 0;
  }

  return {
    webgl: !!context,
    webgl2: !!rendererCapabilities?.isWebGL2,
    webgl1: !!context && !rendererCapabilities?.isWebGL2,
    antialias: !!attributes.antialias,
    stencil: !!attributes.stencil && stencilBits > 0,
    maxTextureSize,
    maxSamples,
    maxAnisotropy,
    devicePixelRatio: hints.devicePixelRatio || 1,
    deviceMemory: hints.deviceMemory,
    hardwareConcurrency: hints.hardwareConcurrency,
  };
}

export function selectRenderQualityProfile(mode = 'auto', capabilities = {}, frameMetrics = {}) {
  const normalizedMode = normalizeRenderQualityMode(mode);
  if (normalizedMode !== 'auto') return copyProfile(QUALITY_PROFILES[normalizedMode]);

  const constrainedDevice = capabilities.webgl === false
    || capabilities.webgl2 === false
    || (capabilities.maxTextureSize && capabilities.maxTextureSize < 4096)
    || (capabilities.deviceMemory && capabilities.deviceMemory <= 2)
    || (capabilities.hardwareConcurrency && capabilities.hardwareConcurrency <= 2)
    || (frameMetrics.averageFrameMs && frameMetrics.averageFrameMs >= 30);
  if (constrainedDevice) return copyProfile(QUALITY_PROFILES.low);

  const capableDevice = capabilities.webgl2
    && (!capabilities.maxTextureSize || capabilities.maxTextureSize >= 8192)
    && (!capabilities.maxSamples || capabilities.maxSamples >= 4)
    && (!capabilities.deviceMemory || capabilities.deviceMemory >= 8)
    && (!capabilities.hardwareConcurrency || capabilities.hardwareConcurrency >= 8)
    && (!frameMetrics.averageFrameMs || frameMetrics.averageFrameMs < 18);
  return copyProfile(capableDevice ? QUALITY_PROFILES.high : QUALITY_PROFILES.balanced);
}

export function getInitialRendererOptions(mode = 'auto', hints = collectRenderQualityHints()) {
  const profile = selectRenderQualityProfile(mode, hints);
  return {
    antialias: profile.renderer.antialias,
    stencil: profile.renderer.stencil,
    xrCompatible: true,
  };
}

export function getRenderQualityProfiles() {
  return Object.fromEntries(Object.entries(QUALITY_PROFILES).map(([name, profile]) => [name, copyProfile(profile)]));
}
