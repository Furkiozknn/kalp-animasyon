<div align="center">

![My Universe](assets/banner.svg)

# 💫 My Universe

*A glowing 3D heart, woven from light, adrift in its own galaxy.*

**"In every lifetime, I'd find you again."**

[![License: MIT](https://img.shields.io/badge/license-MIT-b06bff?style=flat-square)](LICENSE)
[![Three.js](https://img.shields.io/badge/three.js-r160-ff5fd1?style=flat-square)](https://threejs.org/)
[![Build Step](https://img.shields.io/badge/build%20step-none-ffd76d?style=flat-square&labelColor=1a0a1f)](#-run-it-locally)
[![Bloom](https://img.shields.io/badge/post--processing-real%20bloom-e2d4eb?style=flat-square&labelColor=1a0a1f)](#the-bloom-pipeline)
[![Tests](https://img.shields.io/badge/tests-22%20passing-8fd9a8?style=flat-square&labelColor=1a0a1f)](#-testing)

**[✨ Open the live piece ✨](https://furkiozknn.github.io/kalp-animasyon/)**

</div>

<br>

A single HTML file, a scattering of vanilla JavaScript, and [Three.js](https://threejs.org/) — that's the entire ingredient list. No framework, no bundler, no build step. Load the page and a heart forms itself out of stardust: a single unbroken ribbon of light traced along a real parametric curve, wrapped in genuine GPU bloom, drifting through a living starfield that occasionally streaks with a shooting star.

Then it starts beating — a real cardiac rhythm, not a sine wave — and the glow surges with every beat. Move your mouse, or tilt your phone, and the whole galaxy leans with you. Pinch to zoom, drag to spin it, tap it to scatter sparks.

<br>

## 📖 Table of Contents

- [The Visual Experience](#-the-visual-experience)
- [The Heartbeat](#-the-heartbeat)
- [The Curve Beneath the Light](#-the-curve-beneath-the-light)
- [A Slow Aurora Drift](#-a-slow-aurora-drift)
- [The Technical Craft](#-the-technical-craft)
  - [Scene, camera, renderer](#scene-camera-renderer)
  - [The bloom pipeline](#the-bloom-pipeline)
  - [Building the heart from a formula](#building-the-heart-from-a-formula)
  - [Colour, and why none of it runs on the CPU](#colour-and-why-none-of-it-runs-on-the-cpu)
  - [Stardust and starfield](#stardust-and-starfield)
  - [Shooting stars, and tap sparks](#shooting-stars-and-tap-sparks)
  - [The entrance, and the living loop](#the-entrance-and-the-living-loop)
  - [Quality tiers, and adapting mid-flight](#quality-tiers-and-adapting-mid-flight)
- [Ways In — Every Interaction](#-ways-in--every-interaction)
- [Sharing It — Personalized Links](#-sharing-it--personalized-links)
- [Motion & Accessibility](#-motion--accessibility)
- [When WebGL Isn't There](#-when-webgl-isnt-there)
- [Run It Locally](#-run-it-locally)
- [Testing](#-testing)
- [Project Structure](#-project-structure)
- [Stack & Credits](#-stack--credits)
- [License](#-license)

<br>

## 🎨 The Visual Experience

On load, nothing exists yet — just a starfield and silence. Then, over about three seconds, scattered points of light rush inward from the dark and knit themselves, segment by segment, into a single glowing ribbon: **the heart**. Then it starts beating, and never fully stops.

Six things carry the piece. Each is real, running live in your GPU, not a pre-baked video:

![Feature icons: bloom, parallax, starfield, shooting stars](assets/feature-icons.svg)

| | |
|---|---|
| 💓 **A real heartbeat** | Two Gaussian thumps per cycle — a loud *lub*, a softer *dub* — at 62bpm, driving the scale, the bloom and the stardust together. |
| ✨ **Bloom** | The glow is genuine HDR bloom via `UnrealBloomPass` — light bleeding into the dark around it — not a CSS filter or a blurred sprite. |
| 🖱️ **Parallax** | The camera eases toward your mouse, your finger, or your device's tilt. Scroll or pinch to zoom; drag to spin the heart. |
| 🌌 **Starfield** | Up to 900 depth-layered points fill the background, each twinkling on its own independent phase and speed. |
| 💫 **Shooting stars** | Every few seconds, a streak crosses the sky — up to four alive at once, each fading out on its own arc. |
| 🎇 **Tap sparks** | Tap or click the heart and it throws off a spray of sparks, drawn from a pool that allocates nothing after startup. |

Underneath the motion sit two more deliberate design choices, both worth a closer look: the **curve** the heart is built from, and the **color** it drifts through.

<br>

## 💓 The Heartbeat

A heart that pulses on a sine wave doesn't read as a heart — it reads as something breathing. A real cardiac cycle isn't symmetric: there's a loud first thump, a softer second one close behind it, and then a comparatively long silence before the next pair. That gap is what your ear and eye actually recognize.

So the pulse is built from two Gaussian thumps per cycle at 62bpm — a *lub* at full amplitude, a *dub* at 62% of it a fifth of a beat later — with the distance to each thump wrapped around the cycle so the pulse near phase zero rises *before* the beat rather than being clipped flat at the seam.

```js
function thump(phase, center, width, amplitude) {
  let d = phase - center;
  if (d > 0.5) d -= 1;          // wrap, so a pulse at the seam still rises
  if (d < -0.5) d += 1;
  return amplitude * Math.exp(-(d * d) / (2 * width * width));
}
```

One number comes out, and three things move on it at once: the heart swells about 4.5%, the bloom strength jumps by `0.35`, and every stardust mote is shoved outward along its own radial. Tying the glow to the beat is what sells it — a heart that only changes *size* looks like it's inflating; one that also *brightens* looks like it's pumping.

<br>

## 🧵 The Curve Beneath the Light

The heart isn't a modeled mesh or an imported asset — it's math. A classic parametric heart curve is sampled at 180 points, and a `THREE.TubeGeometry` is skinned around the resulting `CatmullRomCurve3`, turning a 1D line into a 3D ribbon with real thickness, real lighting, real depth.

![The heart curve, from scattered points to a woven ribbon](assets/heart-curve-math.svg)

On load, those 180 points don't just appear — they're revealed **segment by segment** along the tube's `drawRange`, so the ribbon looks like it's being drawn by hand, tracing itself into existence out of the dark. A gentle sine wave on the z-axis keeps the curve from ever going perfectly flat, so the heart always reads as an object in space, not a decal.

<br>

## 🌈 A Slow Aurora Drift

The ribbon's color isn't a static gradient — it's alive. Every vertex is colored along a hue ramp that drifts back and forth over roughly a minute, magenta into violet into gold and back, **deliberately routed around the hue wheel so it never once passes through green**. The same hue math colors every stardust mote orbiting the heart.

![Color journey: magenta to violet to gold and back, never crossing green](assets/color-journey.svg)

It's a small detail most visitors will never consciously notice — and that's rather the point. It just feels *right*, the way a well-graded film feels right.

<br>

## ⚙️ The Technical Craft

Everything below runs inside `script.js`, with every tunable number collected into a single `CONFIG` object at the top of the file — the loop reads that object and never hard-codes a constant of its own. No external assets besides two Google Fonts and the Three.js CDN import.

### Scene, camera, renderer

- `WebGLRenderer` with antialiasing, a device-pixel-ratio cap set by the quality tier (2 down to 1.35), `SRGBColorSpace` output, and `ACESFilmicToneMapping` at `0.95` exposure for filmic, non-blown-out highlights.
- `FogExp2` gives the scene depth without a hard horizon — distant stars and dust quietly dim rather than clip.
- A `PerspectiveCamera` (50° FOV) sits at a base distance that adapts to aspect ratio, so tall/portrait phone screens automatically pull back to keep the whole heart in frame.

### The bloom pipeline

```js
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(resolution, 0.85 /*strength*/, 0.4 /*radius*/, 0.45 /*threshold*/));
composer.addPass(new OutputPass());
```

This is a real HDR post-processing chain, not a filter. Only pixels brighter than the `0.45` threshold bleed outward, which is why the ribbon glows and the deep-space background stays inky black.

### Building the heart from a formula

```js
function heartRaw(t) {
  const x = 16 * Math.pow(Math.sin(t), 3);
  const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
  return { x, y };
}
```

180 samples of `t ∈ [0, 2π)` become a closed `CatmullRomCurve3` (tension `0.55`), which `TubeGeometry` skins into up to 320 tubular segments × 8 radial segments — a proper 3D ribbon, not a flat outline.

### Colour, and why none of it runs on the CPU

The hue at a point depends only on *where* that point sits along the curve — never on time. Time only ever adds a single scalar shift to the whole ramp. So every hue is baked once into a `aHue` buffer attribute at startup, and the per-frame work is one uniform:

```js
tubeMat.uniforms.uHueShift.value = hueShift / 360;   // that's the whole update
```

Doing it on the CPU instead meant, **every frame**: 581 `Color.setHSL` calls, 10,227 float writes, and 41 KB of buffer re-upload — 2.4 MB/s of bus traffic at 60fps. On a desktop core that measured 0.065 ms/frame; on a phone it's several times that, and the upload traffic costs more than the arithmetic does.

The GLSL `hsl2rgb` is a **port** of `THREE.Color.setHSL`, not an approximation — checked against it across 200,000 random inputs, worst-case channel difference `2.2e-16` (float64 epsilon). `setHSL` writes into the linear working color space, and materials rendering inside an `EffectComposer` neither tone-map nor convert color space, so the shader's values land in the render target exactly as the vertex colors used to. The scene is meant to look pixel-identical; only the bill changed.

### Stardust and starfield

- **Up to 260 stardust points** drift around the ribbon's own curve with per-particle jitter and flicker, colored by the same hue table as the ribbon. On entrance they fly in from random positions scattered across the scene, arriving exactly as the ribbon finishes forming. Position, flicker, entrance blend, heartbeat push and color all happen in the vertex shader — the CPU uploads nothing per frame.
- **Up to 900 background stars** are scattered across a spherical shell (radius 22–55) behind the heart, each with a random twinkle phase and speed, rendered through a custom `ShaderMaterial` with additive blending and distance-based point-size attenuation.

### Shooting stars, and tap sparks

A small pool of four reusable `THREE.Line` segments spawns at random intervals (roughly every 3–8 seconds), each with its own head position, velocity, and fading tail alpha — recycled rather than recreated, so there's zero garbage-collection stutter even after hundreds of streaks.

Tap sparks work the same way: a fixed-size `Points` cloud allocated once at startup, with a ring cursor handing out slots. A tap wakes 34 of them at random points on the curve and throws them outward along their own radials with a little sideways scatter, under drag, fading over about three-quarters of a second. A dead spark multiplies its own `gl_PointSize` by a life of zero, so it costs no fill at all rather than being drawn and discarded.

### The entrance, and the living loop

Time is tracked as an accumulated `simTime` built from a **clamped delta**, not `clock.getElapsedTime()` — so if you background the tab for ten minutes, the animation doesn't try to "catch up" and jump on return; it just resumes smoothly. The entrance itself eases with a cubic-out curve over ~2.9 seconds, after which the heart settles into its permanent life: the heartbeat, a slow self-rotation, and a soft tilt — plus whatever spin you've given it, decaying back toward that idle turn.

### Quality tiers, and adapting mid-flight

The renderer picks one of three tiers up front from what the device is willing to admit — pointer type, short-edge size, `deviceMemory`, `hardwareConcurrency`:

| | pixel ratio cap | stardust | stars | ribbon | bloom buffer |
|---|---|---|---|---|---|
| **high** | 2 | 260 | 900 | 320 × 8 | full |
| **medium** | 1.75 | 190 | 620 | 260 × 7 | 75% |
| **low** | 1.35 | 120 | 380 | 190 × 6 | 55% |

The low tier is roughly half the ribbon's vertices (2,889 → 1,337), about 46% of the pixels, and **30% of the bloom's** — and bloom, being a multi-pass blur, is usually the frame's largest single cost.

After that, the loop watches its own frame times over a 90-frame window and moves the **render scale** — never the geometry. Rebuilding buffers mid-flight hitches far worse than the frame it would save, whereas resolution is free to change and is where the cost actually is. Steps are 0.85× down to a floor of 0.6× the tier's cap, with a 120-frame cooldown so it can't oscillate.

<br>

## 🎛️ Ways In — Every Interaction

Nothing here is required. The piece plays on its own; all of this is optional.

| | |
|---|---|
| **Move the pointer** | The camera leans toward it, eased rather than snapped. |
| **Tilt your phone** | Same lean, from `deviceorientation`. iOS 13+ only hands orientation out after an explicit grant from inside a gesture, so the request rides along with your first tap rather than nagging behind its own button. |
| **Scroll / pinch** | Zooms the whole scene, clamped to `[-1, 1]`. |
| **Drag** | Spins the heart, and keeps spinning when you let go — the fling decays back into its own slow idle turn. |
| **Tap the heart** | Scatters a spray of sparks. A press that travels more than 10px is read as a drag instead, so the two never collide. |
| **share** | Copies the current link, personalization and all. |

<br>

## 💌 Sharing It — Personalized Links

*"made for one, shared with everyone"* — the same piece carries a different name, line or palette per recipient without ever touching the file. Three optional URL query params:

| Param | Effect | Example |
|---|---|---|
| `?to=Name` | Replaces the title with "For Name" | `?to=Ada` → **For Ada** |
| `?msg=A short line` | Replaces the subtitle | `?msg=happy%20anniversary` |
| `?theme=…` | Swaps the hue ramp | `aurora` (default), `rose`, `ocean`, `ember` |

All three combine (`?to=Ada&msg=…&theme=rose`), all are optional, and with none present the page renders exactly the original default — nothing changes for the live link already out in the world. The **share** button copies whatever is in the address bar, so a personalized link is one tap away from being sent on.

Values are read with `URLSearchParams` and written with `textContent` only — never `innerHTML` — so a hand-crafted URL can't inject markup; each is whitespace-collapsed and length-capped (40 characters for a name, 120 for a message). `theme` is matched against a fixed allowlist using `hasOwnProperty`, so inherited names like `constructor` don't select a palette. All three are covered by tests.

<br>

## ♿ Motion & Accessibility

Under `prefers-reduced-motion: reduce`, the scene doesn't *slow down* — it **stops**. One frozen clock feeds every ambient system, so the heartbeat, the idle rotation and tilt, the camera parallax, the starfield's drift and twinkle, the hue drift and the shimmer travelling along the ribbon all halt together, and shooting stars stop spawning entirely. The result is a still image, and a test asserts it is *pixel-identical* between frames — against a mirror test proving the same measurement sees clear movement when motion is allowed, so a broken scene can't quietly pass both.

The artwork itself is untouched: the heart still forms, still glows, still carries its full color ramp. Two things are deliberately kept — the entrance, because it's the piece rather than decoration on top of it and it's a single short pass that ends; and everything **you** drive, because zoom, drag and tap-to-scatter are motion you asked for, not motion imposed on you.

Beyond motion:

- `lang` is now `en` (the page's own words are English) with the Turkish hint marked `lang="tr"` inline, so a screen reader switches voice for that line instead of reading Turkish with an English one.
- The canvas carries a real description rather than sitting there as an unlabeled element, and there's a visually-hidden paragraph explaining every interaction.
- The **share** button is keyboard-reachable with a visible `:focus-visible` ring, comfortably above the 24px minimum target size, and its confirmation goes to an `aria-live` region rather than only being painted.

<br>

## 🛟 When WebGL Isn't There

A page whose entire content is a WebGL canvas has one bad failure mode: a black rectangle. Now, if the context can't be created, the body gets `.no-webgl` and a **CSS-only heart** — one square and two circles, the classic construction, no image and nothing to download — beats gently in its place. The title and subtitle still render, personalization included, so the page still says what it came to say. A `<noscript>` note covers scripting being off entirely.

The check tests the context itself, not just the constructor, because a browser without WebGL hands back a renderer whose context is `null` rather than throwing. Both paths are covered by tests.

<br>

## 🧑‍💻 Run It Locally

The page loads Three.js via an ES module import map, which browsers refuse to resolve over `file://` — so it needs a real (if trivial) local server:

```bash
npx serve .
```

Then open the printed local URL. That's the entire setup — no `npm install`, no build, no config. (`npm install` is only needed for the dev-only test suite below — the page itself never needed it and still doesn't.)

<br>

## 🧪 Testing

A small Playwright smoke test (`test/smoke.spec.js`) — dev-only, does not affect how the page is built or served:

```bash
npm install
npx playwright install --with-deps chromium   # first run only
npm test
```

**22 tests**, in three files:

| | |
|---|---|
| `smoke.spec.js` | The page loads with no console errors — default motion, reduced motion, and each personalization param. |
| `render.spec.js` | **Decodes the screenshot** and asserts the scene actually draws lit, colored pixels. This is the one regression the DOM can't reveal — a shader that compiles but outputs nothing leaves a black rectangle and a perfectly clean console. Also: reduced-motion stillness against a live-motion mirror, tap sparks, pinch and drag, small-viewport rendering with no horizontal overflow. |
| `features.spec.js` | Themes (including that `constructor` isn't one), length caps, markup in `?to=` rendering as literal text, share via clipboard and via keyboard, and the no-WebGL fallback. |

Two details worth knowing if you touch them:

- The suite serves Three.js from a local `three` devDependency and stubs the font stylesheet, so **a CDN outage can't redden CI** and the tests run offline. The page itself is unaffected — it still loads Three.js from the CDN with no build step.
- Tests wait for the scene to *settle* rather than for a fixed delay. `simTime` accumulates a delta clamped to 50ms per frame, so on a slow software renderer the clock runs behind wall-clock time and the ~2.9s entrance can still be drawing several seconds in.

CI (`.github/workflows/ci.yml`) runs the same suite on every push/PR.

<br>

## 📁 Project Structure

```
kalp-animasyon/
├── index.html              entry point — fonts, import map, OG/Twitter meta, overlay, share, fallback
├── styles.css               overlay typography, share pill, CSS-only fallback heart
├── script.js                the whole scene: CONFIG, heart, heartbeat, bloom, stars, sparks, input, tiers
├── LICENSE                  MIT
├── package.json              dev-only: Playwright runner + three (test fixture only)
├── playwright.config.js      dev-only: Playwright config (serves the page over http, no build)
├── test/
│   ├── fixtures.js           serves Three.js/fonts locally; waits for the scene to settle
│   ├── png.js                minimal PNG decoder — lets tests look at rendered pixels
│   ├── smoke.spec.js         console-error + personalization smoke test
│   ├── render.spec.js        does it actually draw? motion vs. stillness, sparks, gestures
│   └── features.spec.js      themes, share, injection safety, no-WebGL fallback
├── .github/workflows/ci.yml  runs the suite on push/PR
└── assets/
    ├── banner.svg             hero banner
    ├── heart-curve-math.svg   the parametric curve, explained visually
    ├── color-journey.svg      the magenta → violet → gold hue drift
    ├── feature-icons.svg      bloom / parallax / starfield / shooting stars
    ├── favicon-32.png         browser-tab icon
    ├── favicon-180.png        apple-touch-icon
    └── og-preview.png         social-share preview image (Open Graph / Twitter Card)
```

<br>

## 🛠️ Stack & Credits

Plain HTML, CSS, and JavaScript — [Three.js](https://threejs.org/) r160, loaded straight from a CDN via an import map, no bundler in sight. Display type is set in [Cormorant Garamond](https://fonts.google.com/specimen/Cormorant+Garamond) and [Cinzel](https://fonts.google.com/specimen/Cinzel) via Google Fonts; the README graphics use [Orbitron](https://fonts.google.com/specimen/Orbitron) for headings, all hand-authored SVG matching the scene's own palette.

<br>

## 📄 License

MIT — see [LICENSE](LICENSE).

<br>

<div align="center">

*made for one, shared with everyone*

</div>
