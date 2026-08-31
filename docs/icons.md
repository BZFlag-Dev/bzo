# Icons

bzo uses two distinct icon marks, on two distinct channels.

## Browser mark — the simple tank

`public/favicon.svg` and `public/favicon.ico` carry a plain top-down tank drawn
in a 32-unit box: two grey treads, a red hull, a round turret and a barrel. It
stays legible at 16 px, which is what a browser tab, a bookmark and a history
entry need. Browsers pick these up through `<link rel="icon">`.

`favicon.ico` holds 16×16, 32×32 and 48×48 entries and exists for the implicit
`GET /favicon.ico` that clients issue when they ignore the link tags.

## Installed-app mark — the BZFlag icon

`public/icons/` carries the BZFlag application icon: an octagon with a red-to-
white gradient behind a dark top-down tank. Only the web app manifest references
these, so they appear on a launcher, a home screen or a headset app library, and
never in a browser tab.

| File | Purpose |
|---|---|
| `bzflag-1024.png` | master, extracted verbatim from upstream |
| `bzflag-512.png`, `bzflag-192.png` | manifest `purpose: "any"` |
| `bzflag-maskable-512.png`, `bzflag-maskable-192.png` | manifest `purpose: "maskable"` |
| `apple-touch-icon-180.png` | iOS home screen |

### Provenance

The master is the `ic10` (1024×1024) entry of `Xcode/BZFlag.icns` in the
[BZFlag](https://github.com/BZFlag-Dev/bzflag) source tree, which is the
highest-resolution copy upstream ships — `MSVC/bzflag.ico` stops at 256×256. The
vector original is `misc/art/bzicon-red.svg`. Artwork is from the BZFlag project
and used here under its license.

### Why the maskable variants differ

Android composites `purpose: "maskable"` icons under an OEM-chosen shape and
guarantees only a centred circle of 80% diameter. The BZFlag octagon's flat
edges run to all four borders of the canvas, so cropping it unmodified shears
off the flats. The maskable files scale the art to 72% and centre it on opaque
`#000000`, matching the manifest's `background_color`, so the whole octagon
survives any mask.

iOS applies its own rounded-rectangle mask and renders transparency as black, so
`apple-touch-icon-180.png` is pre-flattened onto black and left square.

### Regenerating

The PNGs are committed as source; there is no build step and no image
dependency. To rebuild them, extract `ic10` from `BZFlag.icns` as
`bzflag-1024.png` and derive the rest with a Lanczos downscale, applying the
72% inset and black field for the maskable pair.
