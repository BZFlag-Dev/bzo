# Graphics quality and automatic scaling

The Graphics Quality setting controls the rendering workload rather than the
gameplay simulation. Its policy is implemented without a Three.js dependency in
`public/render-quality.js`; `RenderManager` applies the selected profile to the
already-created renderer in `public/render.js`.

## Profiles

| Profile | Device-pixel-ratio cap | Projected shadows | Point-light budget (projectile / explosion / impact) |
|---|---:|---|---:|
| Low | 1 | Disabled | 0 / 0 / 0 |
| Balanced | 1.5 | Stencil, at most every 100 ms | 8 / 3 / 4 |
| High | 2 | Stencil, at most every 48 ms | 16 / 6 / 8 |

The device-pixel-ratio cap is an upper bound. For example, a display reporting
`devicePixelRatio = 3` renders at 1.5 in Balanced and 2 in High; a display
reporting 1 renders at 1 in every profile. This limits the number of pixels
drawn without changing CSS layout or game coordinates.

Antialiasing and the stencil buffer are WebGL context-creation options. The
initial profile selects those options when the renderer is created. Changing a
quality setting later does not recreate the context, so it immediately adjusts
pixel ratio, projected-shadow work, and light budgets while preserving the
existing session (including WebXR). While an XR session owns the framebuffer,
normal canvas pixel-ratio/resize changes are deferred and applied immediately
after XR ends; this avoids calling `setSize()` or `setPixelRatio()` against a
presenting WebXR renderer.

## Auto policy

Auto begins from safe browser hints and then uses the renderer's existing WebGL
context. It never creates a probe canvas or a second context. The inputs are:

- `devicePixelRatio`, `navigator.deviceMemory`, and
  `navigator.hardwareConcurrency` when they are positive finite values;
- WebGL version, context antialias/stencil attributes, texture-size and sample
  limits, and anisotropy support;
- a rolling frame-time average after at least 30 frames.

Auto selects Low for no WebGL, limited texture/memory/CPU capability, or a
rolling frame average of 30 ms or slower. It selects High only for WebGL 2 with
strong capability signals and a frame average under 18 ms. All other cases use
Balanced. Runtime changes use hysteresis: downgrades require a sustained 30
frames of pressure, while upgrades require 120 frames of headroom. The
selection function is deterministic for the same mode, capabilities, and frame
metrics, which keeps it unit-testable outside a browser.

Projected shadows require both a non-Low profile and a stencil buffer with at
least one reported stencil bit. If the created context has no usable stencil
buffer, the renderer clears/avoids the stencil-shadow pass instead of trying to
create another WebGL context. The profile can still report Balanced or High:
the runtime capability check is the authoritative fallback for that one
context-specific feature.

## Pre-change baseline

For the baseline at repository commit
`0021fa6ce4bc16062b7935bf523a6cdfa92b9a7e` (Release v1.0.38),
`F:\Dev\BZO\git\public\render.js` created the renderer at line 398 with
antialiasing and stencil both enabled. Its line 417 disabled Three.js shadow
maps, while the custom projected-shadow update lived at line 742. Dynamic
lighting had no per-effect profile budget: impact, projectile, and explosion
lights were each gated only by `dynamicLightingEnabled` at lines 2788, 3235,
and 3293 respectively. These line references are intentionally tied to that
commit; use symbols rather than line numbers for later changes.

## Future WebGPU path

This policy deliberately describes capability and workload choices, not a WebGL
implementation detail. A future WebGPU renderer should reuse the same profile
names, device-pixel-ratio caps, frame-time thresholds, and per-effect budgets,
then map projected shadows and antialiasing to WebGPU-compatible techniques.
It must keep WebGL as a fallback until WebGPU support, XR compatibility, and
the equivalent feature path are validated on supported browsers and headsets.

## Verification

Run the policy test without a browser:

```bash
node scripts/test-render-quality.mjs
```

The test covers mode normalization, browser-hint collection, capability
inspection with mocked contexts, Low/Balanced/High/Auto selection, no-WebGL and
no-stencil behavior, initial renderer options, profile budgets, and defensive
copy/determinism guarantees.
