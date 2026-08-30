# My Universe

A single-page WebGL scene: a glowing 3D heart woven from light, drifting stardust, and a living starfield — built with [Three.js](https://threejs.org/).

**[Live](https://furkiozknn.github.io/kalp-animasyon/)**

## What it does

- The heart forms from scattered light on load — a tube geometry traced along a parametric heart curve, colored with a magenta → violet → gold gradient that slowly drifts over time
- Real bloom post-processing (`UnrealBloomPass`) for the glow, not a canvas blur hack
- Mouse/touch parallax and scroll-to-zoom on the camera; the heart slowly turns on its own
- A depth-layered starfield with occasional shooting stars

## Run locally

Any static file server works, e.g.:

```bash
npx serve .
```

Then open the printed local URL. (Opening `index.html` directly via `file://` won't load the ES modules — it needs to be served over HTTP.)

## Stack

Plain HTML/CSS/JS, Three.js loaded via import map from a CDN — no build step.
