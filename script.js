import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// =============================================================================
// CONFIG - every tunable number in the piece, in one place.
// Nothing below this block invents its own constants.
// =============================================================================
const CONFIG = {
  // The heart's parametric curve and the ribbon skinned around it.
  heart: {
    worldScale: 2.7,
    curveResolution: 180,   // samples of t in [0, 2pi)
    curveTension: 0.55,
    zWaveAmplitude: 1.1,    // keeps the curve from ever going perfectly flat
    zWaveFrequency: 3,
    tubeRadius: 0.145,
    saturation: 0.92,
    lightnessBase: 46,      // percent
    lightnessSwing: 8,      // percent, travels along the ribbon over time
    lightnessSpeed: 1.6,
    lightnessWaves: 18,
  },

  // A real cardiac rhythm: a loud first thump, a softer second one a fifth of
  // a beat later, then a long quiet fill. That asymmetry is the whole reason
  // it reads as a heartbeat instead of a sine wave.
  heartbeat: {
    bpm: 62,
    lubAmplitude: 1.0,
    lubWidth: 0.055,        // fraction of one beat, Gaussian sigma
    dubOffset: 0.2,         // fraction of one beat after the lub
    dubAmplitude: 0.62,
    dubWidth: 0.05,
    scaleDepth: 0.045,      // how far the whole heart swells on a full beat
    bloomBoost: 0.35,       // extra bloom strength at peak systole
    dustPush: 0.13,         // how far the stardust is shoved outward
  },

  // Ambient drift that is not the heartbeat. All of this is silenced under
  // prefers-reduced-motion.
  idle: {
    rotationSpeed: 0.12,
    tiltAmplitude: 0.08,
    tiltSpeed: 0.15,
    starDriftSpeed: 0.006,
  },

  entrance: { duration: 2.9 },

  // Stardust orbiting the ribbon.
  dust: { jitterSpread: 0.9, scatterSpread: [16, 10, 10], saturation: 0.95, lightness: 0.62 },

  // Background starfield, scattered through a spherical shell behind the heart.
  stars: { innerRadius: 22, shellDepth: 55, minSize: 2.5, sizeSpread: 6 },

  // Streaks crossing the sky. Rarer, not absent, under reduced motion.
  shooters: {
    max: 4,
    gap: [3, 5],            // [minimum, extra random] seconds between streaks
    fadeRate: 0.6,
    tailLength: 0.35,
  },

  // Sparks thrown off when the visitor taps or clicks the heart.
  burst: { perTap: 34, speed: [2.2, 3.4], drag: 1.9, fadeRate: 1.35, size: [6, 9] },

  camera: {
    fov: 50,
    near: 0.1,
    far: 200,
    baseDistance: 7.2,
    maxPortraitFactor: 1.7,
    parallaxX: 1.1,
    parallaxY: 0.7,
    zoomRange: 2.4,
    easeRate: 2.2,
  },

  bloom: { strength: 0.85, radius: 0.4, threshold: 0.45 },

  interaction: {
    wheelStep: 0.08,
    pinchStep: 0.0055,      // per pixel of finger separation
    dragSpeed: 0.005,       // radians per pixel
    dragDecay: 2.4,         // how fast a flung heart settles back down
    tiltGain: 0.014,        // device tilt degrees -> parallax units
    tapSlop: 10,            // px of movement still counted as a tap, not a drag
  },

  // Quality tiers. The renderer picks one up front from what the device
  // reports, then adapts the render scale at runtime if frames come in slow.
  // Counts are chosen so the low tier stays under roughly half the vertex and
  // fill cost of the high tier.
  tiers: {
    high:   { pixelRatio: 2,    dust: 260, stars: 900, tubular: 320, radial: 8, bloomScale: 1,    burstPool: 240 },
    medium: { pixelRatio: 1.75, dust: 190, stars: 620, tubular: 260, radial: 7, bloomScale: 0.75, burstPool: 160 },
    low:    { pixelRatio: 1.35, dust: 120, stars: 380, tubular: 190, radial: 6, bloomScale: 0.55, burstPool: 100 },
  },

  // Runtime adaptation. Only the render scale moves - geometry is never
  // rebuilt mid-flight, because a rebuild hitches worse than the frame it saves.
  adaptive: {
    sampleFrames: 90,
    slowFrameMs: 22,        // below ~45fps
    fastFrameMs: 13,        // above ~75fps, room to give quality back
    scaleStep: 0.85,
    minScale: 0.6,
    cooldownFrames: 120,
  },

  personalization: { maxNameLength: 40, maxMessageLength: 120 },
};

// Hue ramps. Each is a closed loop, so the drift returns to where it began.
// The default deliberately routes magenta -> violet -> gold around the wheel
// so it never once passes through green.
const THEMES = {
  aurora: [{ f: 0, h: 330 }, { f: 0.25, h: 285 }, { f: 0.5, h: 42 }, { f: 0.75, h: 285 }, { f: 1, h: 330 }],
  rose:   [{ f: 0, h: 348 }, { f: 0.25, h: 320 }, { f: 0.5, h: 12 },  { f: 0.75, h: 320 }, { f: 1, h: 348 }],
  ocean:  [{ f: 0, h: 196 }, { f: 0.25, h: 224 }, { f: 0.5, h: 268 }, { f: 0.75, h: 224 }, { f: 1, h: 196 }],
  ember:  [{ f: 0, h: 18 },  { f: 0.25, h: 44 },  { f: 0.5, h: 350 }, { f: 0.75, h: 44 },  { f: 1, h: 18 }],
};

// =============================================================================
// Personalization: ?to=Name, ?msg=A short line, ?theme=aurora|rose|ocean|ember
// "made for one, shared with everyone" - the same piece carries a different
// name, line or palette per recipient without touching the file. No params ->
// today's exact default. Values are read with URLSearchParams and written with
// textContent only, never innerHTML, so a hand-crafted URL cannot inject
// markup; theme is matched against a fixed allowlist rather than trusted.
// =============================================================================
const params = new URLSearchParams(window.location.search);

function readTheme() {
  const raw = params.get('theme');
  return raw && Object.prototype.hasOwnProperty.call(THEMES, raw) ? raw : 'aurora';
}
const HUE_STOPS = THEMES[readTheme()];

(function personalizeOverlay() {
  const to = params.get('to');
  const msg = params.get('msg');
  if (!to && !msg) return;
  const clean = (s, max) => s.replace(/\s+/g, ' ').trim().slice(0, max);
  const titleEl = document.getElementById('title');
  const subtitleEl = document.getElementById('subtitle');
  if (to && titleEl) titleEl.textContent = `For ${clean(to, CONFIG.personalization.maxNameLength)}`;
  if (msg && subtitleEl) subtitleEl.textContent = clean(msg, CONFIG.personalization.maxMessageLength);
})();

// =============================================================================
// Share: copy the current URL, params and all, so a personalized link is one
// tap away. Purely additive - the piece renders identically if it is ignored.
// =============================================================================
(function wireShare() {
  const button = document.getElementById('share');
  const status = document.getElementById('share-status');
  if (!button) return;
  button.hidden = false;

  let resetTimer = 0;
  function announce(text) {
    button.textContent = text;
    if (status) status.textContent = text;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => { button.textContent = 'share'; }, 2200);
  }

  // execCommand is deprecated but is still the only copy path on insecure
  // origins and older mobile browsers, where navigator.clipboard is absent.
  function legacyCopy(text) {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    document.body.removeChild(field);
    return ok;
  }

  button.addEventListener('click', async () => {
    const url = window.location.href;
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(url);
        announce('link copied');
        return;
      } catch (_) { /* fall through to the legacy path */ }
    }
    announce(legacyCopy(url) ? 'link copied' : 'press ctrl+c');
  });
})();

// =============================================================================
// Reduced motion.
// The heart still forms, glows and keeps its full colour ramp for everyone.
// What stops is every motion the page imposes on its own: the heartbeat's
// swell, the idle rotation and tilt, mouse/tilt parallax, the starfield's
// drift and twinkle, the hue drift, the shimmer travelling along the ribbon,
// and shooting stars. The scene settles into a still image and stays there.
//
// Two things are deliberately kept. The entrance still plays, because it is
// the piece rather than decoration on top of it, and it is a single
// short pass that ends. And everything the visitor drives - zoom, drag,
// tap-to-scatter - still responds, because that is motion they asked for,
// not motion imposed on them.
// =============================================================================
const motionQuery = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = !!(motionQuery && motionQuery.matches);
if (motionQuery && motionQuery.addEventListener) {
  motionQuery.addEventListener('change', (e) => { reducedMotion = e.matches; });
}

// =============================================================================
// Quality tier. Picked from what the device is willing to tell us, then
// adapted at runtime. Small touch screens and low core/memory counts get the
// cheap tier up front rather than discovering the hard way.
// =============================================================================
function detectTier() {
  const coarsePointer = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  const shortEdge = Math.min(window.innerWidth, window.innerHeight);
  const memory = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  if (memory <= 2 || cores <= 2 || (coarsePointer && shortEdge < 700)) return 'low';
  if (memory <= 4 || cores <= 4 || coarsePointer) return 'medium';
  return 'high';
}
const TIER = CONFIG.tiers[detectTier()];

// =============================================================================
// Hue ramp -> a per-vertex attribute the GPU reads.
// hueAt(f) depends only on the fixed parameter f, never on time, so every hue
// in the piece is baked once into a buffer attribute. The per-frame work is a
// single scalar uniform (uHueShift) that the shader adds; the CPU no longer
// recolors ~2900 tube vertices and 260 dust motes every frame.
// =============================================================================
function lerpHue(h1, h2, frac) {
  const diff = (((h2 - h1 + 540) % 360) - 180);
  return (h1 + diff * frac + 360) % 360;
}
function hueAt(f) {
  for (let i = 0; i < HUE_STOPS.length - 1; i++) {
    const a = HUE_STOPS[i], b = HUE_STOPS[i + 1];
    if (f >= a.f && f <= b.f) return lerpHue(a.h, b.h, (f - a.f) / (b.f - a.f));
  }
  return HUE_STOPS[0].h;
}

// The exact algorithm THREE.Color.setHSL uses, so moving the color math onto
// the GPU reproduces the previous CPU output rather than approximating it.
// setHSL writes into the working (linear) color space, and inside the
// EffectComposer materials neither tone-map nor convert color space, so these
// values land in the render target the same way the vertex colors did.
const GLSL_HSL = `
  float hue2rgb(float p, float q, float t) {
    if (t < 0.0) t += 1.0;
    if (t > 1.0) t -= 1.0;
    if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
    if (t < 1.0 / 2.0) return q;
    if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
    return p;
  }
  vec3 hsl2rgb(float h, float s, float l) {
    if (s == 0.0) return vec3(l);
    float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
    float p = 2.0 * l - q;
    return vec3(hue2rgb(p, q, h + 1.0 / 3.0), hue2rgb(p, q, h), hue2rgb(p, q, h - 1.0 / 3.0));
  }
`;

// =============================================================================
// Renderer / scene / camera. Everything from here on assumes WebGL succeeded;
// bootstrap() below is what decides that.
// =============================================================================
const canvas = document.getElementById('scene');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (_) {
  renderer = null;
}
// A browser without WebGL hands back a renderer whose context is null rather
// than throwing, so check the context itself, not just the constructor.
if (!renderer || !renderer.getContext()) {
  document.body.classList.add('no-webgl');
  throw new Error('WebGL unavailable');
}

let renderScale = TIER.pixelRatio;
function effectivePixelRatio() {
  return Math.min(window.devicePixelRatio || 1, renderScale);
}

renderer.setPixelRatio(effectivePixelRatio());
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x05020c, 0.028);

const camera = new THREE.PerspectiveCamera(
  CONFIG.camera.fov, window.innerWidth / window.innerHeight, CONFIG.camera.near, CONFIG.camera.far);

function computeBaseDist() {
  const aspect = window.innerWidth / window.innerHeight;
  const portraitFactor = aspect < 1 ? Math.min(1 / aspect, CONFIG.camera.maxPortraitFactor) : 1;
  return CONFIG.camera.baseDistance * portraitFactor;
}
let BASE_DIST = computeBaseDist();
camera.position.set(0, 0, BASE_DIST);

// ---------- Post-processing (real bloom, not a canvas hack) ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth * TIER.bloomScale, window.innerHeight * TIER.bloomScale),
  CONFIG.bloom.strength,
  CONFIG.bloom.radius,
  CONFIG.bloom.threshold,
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

const heartGroup = new THREE.Group();
scene.add(heartGroup);

// =============================================================================
// The heart curve, and the ribbon skinned around it.
// =============================================================================
function heartRaw(t) {
  const x = 16 * Math.pow(Math.sin(t), 3);
  const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
  return { x, y };
}
const S = CONFIG.heart.worldScale;
function heartPoint(t) {
  const p = heartRaw(t);
  const z = Math.sin(t * CONFIG.heart.zWaveFrequency) * CONFIG.heart.zWaveAmplitude;
  return new THREE.Vector3((p.x / 16) * S, (p.y / 16) * S, (z / 16) * S);
}

const curvePoints = [];
for (let i = 0; i < CONFIG.heart.curveResolution; i++) {
  curvePoints.push(heartPoint((i / CONFIG.heart.curveResolution) * Math.PI * 2));
}
const heartCurve = new THREE.CatmullRomCurve3(curvePoints, true, 'catmullrom', CONFIG.heart.curveTension);

const TUBULAR_SEGMENTS = TIER.tubular;
const RADIAL_SEGMENTS = TIER.radial;
const tubeGeo = new THREE.TubeGeometry(
  heartCurve, TUBULAR_SEGMENTS, CONFIG.heart.tubeRadius, RADIAL_SEGMENTS, true);

// Bake the two per-vertex inputs the ribbon shader needs: the hue this vertex
// sits at on the ramp, and how far along the curve it is.
const ringVerts = RADIAL_SEGMENTS + 1;
const tubeVertexCount = tubeGeo.attributes.position.count;
const tubeHue = new Float32Array(tubeVertexCount);
const tubeF = new Float32Array(tubeVertexCount);
for (let i = 0; i <= TUBULAR_SEGMENTS; i++) {
  const f = i / TUBULAR_SEGMENTS;
  const h = hueAt(f) / 360;
  for (let r = 0; r < ringVerts; r++) {
    const idx = i * ringVerts + r;
    if (idx >= tubeVertexCount) break;
    tubeHue[idx] = h;
    tubeF[idx] = f;
  }
}
tubeGeo.setAttribute('aHue', new THREE.BufferAttribute(tubeHue, 1));
tubeGeo.setAttribute('aF', new THREE.BufferAttribute(tubeF, 1));

const tubeMat = new THREE.ShaderMaterial({
  uniforms: { uHueShift: { value: 0 }, uTime: { value: 0 } },
  vertexShader: `
    attribute float aHue;
    attribute float aF;
    uniform float uHueShift;
    uniform float uTime;
    varying vec3 vColor;
    ${GLSL_HSL}
    void main() {
      float l = (${CONFIG.heart.lightnessBase.toFixed(1)}
        + sin(uTime * ${CONFIG.heart.lightnessSpeed.toFixed(2)} + aF * ${CONFIG.heart.lightnessWaves.toFixed(1)})
        * ${CONFIG.heart.lightnessSwing.toFixed(1)}) / 100.0;
      vColor = hsl2rgb(fract(aHue + uHueShift), ${CONFIG.heart.saturation.toFixed(2)}, l);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    varying vec3 vColor;
    void main() { gl_FragColor = vec4(vColor, 1.0); }
  `,
});
heartGroup.add(new THREE.Mesh(tubeGeo, tubeMat));

const TUBE_INDICES_PER_SEGMENT = RADIAL_SEGMENTS * 6;
tubeGeo.setDrawRange(0, 0); // revealed progressively on entrance

// =============================================================================
// Stardust drifting around the ribbon. Position, flicker, entrance and color
// all run in the vertex shader now - the CPU uploads nothing per frame.
// =============================================================================
const DUST_COUNT = TIER.dust;
const dustGeo = new THREE.BufferGeometry();
const dustBase = new Float32Array(DUST_COUNT * 3);
const dustJitter = new Float32Array(DUST_COUNT * 3);
const dustFrom = new Float32Array(DUST_COUNT * 3);
const dustOut = new Float32Array(DUST_COUNT * 3);
const dustHue = new Float32Array(DUST_COUNT);
const dustPhase = new Float32Array(DUST_COUNT);
const dustSpeed = new Float32Array(DUST_COUNT);
const dustSize = new Float32Array(DUST_COUNT);
const scatter = CONFIG.dust.scatterSpread;
const outward = new THREE.Vector3();
for (let i = 0; i < DUST_COUNT; i++) {
  const t = Math.random() * Math.PI * 2;
  const base = heartPoint(t);
  base.toArray(dustBase, i * 3);
  // Which way a mote is pushed on a beat: away from the heart's center, so
  // the whole cloud blooms outward together instead of shearing.
  outward.copy(base);
  if (outward.lengthSq() < 1e-6) outward.set(0, 1, 0);
  outward.normalize().toArray(dustOut, i * 3);

  dustHue[i] = hueAt((t / (Math.PI * 2)) % 1) / 360;
  const j = CONFIG.dust.jitterSpread;
  dustJitter[i * 3] = (Math.random() - 0.5) * j;
  dustJitter[i * 3 + 1] = (Math.random() - 0.5) * j;
  dustJitter[i * 3 + 2] = (Math.random() - 0.5) * j;
  dustFrom[i * 3] = (Math.random() - 0.5) * scatter[0];
  dustFrom[i * 3 + 1] = (Math.random() - 0.5) * scatter[1];
  dustFrom[i * 3 + 2] = (Math.random() - 0.5) * scatter[2];
  dustPhase[i] = Math.random() * Math.PI * 2;
  dustSpeed[i] = Math.random() * 0.03 + 0.015;
  dustSize[i] = Math.random() * 10 + 5;
}
// `position` carries the settled position; the shader blends away from it on
// entrance and adds jitter, so Three still gets a real position attribute to
// compute bounds from.
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustBase, 3));
dustGeo.setAttribute('aJitter', new THREE.BufferAttribute(dustJitter, 3));
dustGeo.setAttribute('aFrom', new THREE.BufferAttribute(dustFrom, 3));
dustGeo.setAttribute('aOut', new THREE.BufferAttribute(dustOut, 3));
dustGeo.setAttribute('aHue', new THREE.BufferAttribute(dustHue, 1));
dustGeo.setAttribute('aPhase', new THREE.BufferAttribute(dustPhase, 1));
dustGeo.setAttribute('aSpeed', new THREE.BufferAttribute(dustSpeed, 1));
dustGeo.setAttribute('aSize', new THREE.BufferAttribute(dustSize, 1));

const dustMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uPixelRatio: { value: renderer.getPixelRatio() },
    uTime: { value: 0 },
    uForm: { value: 0 },
    uHueShift: { value: 0 },
    uBeat: { value: 0 },
    uStill: { value: 0 },
  },
  vertexShader: `
    attribute vec3 aJitter;
    attribute vec3 aFrom;
    attribute vec3 aOut;
    attribute float aHue;
    attribute float aPhase;
    attribute float aSpeed;
    attribute float aSize;
    uniform float uPixelRatio;
    uniform float uTime;
    uniform float uForm;
    uniform float uHueShift;
    uniform float uBeat;
    uniform float uStill;
    varying vec3 vColor;
    ${GLSL_HSL}
    void main() {
      float flicker = mix(0.5 + 0.5 * sin(uTime * aSpeed * 40.0 + aPhase), 0.0, uStill);
      vec3 settled = position + aJitter * flicker + aOut * uBeat * ${CONFIG.heartbeat.dustPush.toFixed(3)};
      vec3 here = mix(aFrom, settled, uForm);
      vColor = hsl2rgb(fract(aHue + uHueShift),
                       ${CONFIG.dust.saturation.toFixed(2)}, ${CONFIG.dust.lightness.toFixed(2)});
      vec4 mv = modelViewMatrix * vec4(here, 1.0);
      gl_PointSize = aSize * uPixelRatio * (10.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    varying vec3 vColor;
    void main() {
      float d = length(gl_PointCoord - vec2(0.5));
      float alpha = smoothstep(0.5, 0.0, d);
      gl_FragColor = vec4(vColor, alpha * alpha);
    }
  `,
});
heartGroup.add(new THREE.Points(dustGeo, dustMat));

// =============================================================================
// Background starfield.
// =============================================================================
const STAR_COUNT = TIER.stars;
const starGeo = new THREE.BufferGeometry();
const starPos = new Float32Array(STAR_COUNT * 3);
const starPhase = new Float32Array(STAR_COUNT);
const starSpeed = new Float32Array(STAR_COUNT);
const starSize = new Float32Array(STAR_COUNT);
for (let i = 0; i < STAR_COUNT; i++) {
  const r = CONFIG.stars.innerRadius + Math.random() * CONFIG.stars.shellDepth;
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(THREE.MathUtils.randFloatSpread(2));
  starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
  starPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
  starPos[i * 3 + 2] = -Math.abs(r * Math.cos(phi)) - 5;
  starPhase[i] = Math.random() * Math.PI * 2;
  starSpeed[i] = Math.random() * 1.2 + 0.4;
  starSize[i] = Math.random() * CONFIG.stars.sizeSpread + CONFIG.stars.minSize;
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
starGeo.setAttribute('aPhase', new THREE.BufferAttribute(starPhase, 1));
starGeo.setAttribute('aSpeed', new THREE.BufferAttribute(starSpeed, 1));
starGeo.setAttribute('aSize', new THREE.BufferAttribute(starSize, 1));

const starMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 }, uPixelRatio: { value: renderer.getPixelRatio() } },
  vertexShader: `
    attribute float aPhase;
    attribute float aSpeed;
    attribute float aSize;
    uniform float uTime;
    uniform float uPixelRatio;
    varying float vTwinkle;
    void main() {
      vTwinkle = 0.4 + 0.6 * (0.5 + 0.5 * sin(uTime * aSpeed + aPhase));
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = aSize * uPixelRatio * (30.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    varying float vTwinkle;
    void main() {
      float d = length(gl_PointCoord - vec2(0.5));
      float alpha = smoothstep(0.5, 0.0, d);
      gl_FragColor = vec4(vec3(1.0, 0.98, 0.95), alpha * vTwinkle);
    }
  `,
});
const stars = new THREE.Points(starGeo, starMat);
scene.add(stars);

// =============================================================================
// Shooting stars - a fixed pool of reusable lines, never reallocated.
// =============================================================================
const shooterTailScratch = new THREE.Vector3();
const shooterPool = [];
const shooterGroup = new THREE.Group();
scene.add(shooterGroup);
for (let i = 0; i < CONFIG.shooters.max; i++) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  geo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array([0, 1]), 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color(0xfff2e0) } },
    blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float alpha;
      varying float vAlpha;
      void main() {
        vAlpha = alpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() { gl_FragColor = vec4(uColor, vAlpha); }
    `,
  });
  const line = new THREE.Line(geo, mat);
  line.visible = false;
  shooterGroup.add(line);
  shooterPool.push({ line, life: 0, vel: new THREE.Vector3(), head: new THREE.Vector3() });
}

function shooterGap() {
  const [base, spread] = CONFIG.shooters.gap;
  return base + Math.random() * spread;
}
let nextShootAt = shooterGap();

function spawnShooter() {
  const s = shooterPool.find((p) => p.life <= 0);
  if (!s) return;
  s.head.set(THREE.MathUtils.randFloatSpread(20), 10 + Math.random() * 6, -10 - Math.random() * 15);
  s.vel.set(-6 - Math.random() * 3, -5 - Math.random() * 3, 0);
  s.life = 1;
  s.line.visible = true;
}

function updateShooters(dt) {
  for (const s of shooterPool) {
    if (s.life <= 0) continue;
    s.head.addScaledVector(s.vel, dt);
    s.life -= dt * CONFIG.shooters.fadeRate;
    if (s.life <= 0) { s.line.visible = false; continue; }
    shooterTailScratch.copy(s.head).addScaledVector(s.vel, -CONFIG.shooters.tailLength);
    const posAttr = s.line.geometry.attributes.position;
    posAttr.setXYZ(0, s.head.x, s.head.y, s.head.z);
    posAttr.setXYZ(1, shooterTailScratch.x, shooterTailScratch.y, shooterTailScratch.z);
    posAttr.needsUpdate = true;
    const alphaAttr = s.line.geometry.attributes.alpha;
    alphaAttr.setX(0, Math.min(1, s.life * 2));
    alphaAttr.setX(1, 0);
    alphaAttr.needsUpdate = true;
  }
}

// =============================================================================
// Tap sparks. A pooled Points cloud; a tap wakes a slice of it and throws
// those sparks off the ribbon. Nothing is allocated after startup.
// =============================================================================
const BURST_MAX = TIER.burstPool;
const burstGeo = new THREE.BufferGeometry();
const burstPos = new Float32Array(BURST_MAX * 3);
const burstColor = new Float32Array(BURST_MAX * 3);
const burstLife = new Float32Array(BURST_MAX);
const burstSize = new Float32Array(BURST_MAX);
const burstVel = new Float32Array(BURST_MAX * 3);
burstGeo.setAttribute('position', new THREE.BufferAttribute(burstPos, 3));
burstGeo.setAttribute('aColor', new THREE.BufferAttribute(burstColor, 3));
burstGeo.setAttribute('aLife', new THREE.BufferAttribute(burstLife, 1));
burstGeo.setAttribute('aSize', new THREE.BufferAttribute(burstSize, 1));
// Nothing is alive at startup, so keep the cloud out of the frustum-culling
// bounds computation entirely rather than letting stale zeros define them.
burstGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40);

const burstMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: { uPixelRatio: { value: renderer.getPixelRatio() } },
  vertexShader: `
    attribute vec3 aColor;
    attribute float aLife;
    attribute float aSize;
    uniform float uPixelRatio;
    varying vec3 vColor;
    varying float vLife;
    void main() {
      vColor = aColor;
      vLife = aLife;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      // A dead spark collapses to zero size, so it costs no fill at all.
      gl_PointSize = aSize * aLife * uPixelRatio * (10.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    varying vec3 vColor;
    varying float vLife;
    void main() {
      if (vLife <= 0.0) discard;
      float d = length(gl_PointCoord - vec2(0.5));
      float alpha = smoothstep(0.5, 0.0, d);
      gl_FragColor = vec4(vColor, alpha * alpha * vLife);
    }
  `,
});
const burstPoints = new THREE.Points(burstGeo, burstMat);
heartGroup.add(burstPoints);

let burstCursor = 0;
let burstAlive = 0;
const burstColorScratch = new THREE.Color();

function emitBurst(hueShift) {
  const [minSpeed, speedSpread] = CONFIG.burst.speed;
  const [minSize, sizeSpread] = CONFIG.burst.size;
  for (let n = 0; n < CONFIG.burst.perTap; n++) {
    const i = burstCursor;
    burstCursor = (burstCursor + 1) % BURST_MAX;
    const t = Math.random() * Math.PI * 2;
    const p = heartPoint(t);
    p.toArray(burstPos, i * 3);

    // Fly outward from the heart's center, with a little sideways scatter so
    // the spray does not look like a wireframe explosion.
    outward.copy(p);
    if (outward.lengthSq() < 1e-6) outward.set(0, 1, 0);
    outward.normalize();
    const speed = minSpeed + Math.random() * speedSpread;
    burstVel[i * 3] = outward.x * speed + (Math.random() - 0.5) * 0.8;
    burstVel[i * 3 + 1] = outward.y * speed + (Math.random() - 0.5) * 0.8;
    burstVel[i * 3 + 2] = outward.z * speed + (Math.random() - 0.5) * 0.8;

    const h = (hueAt((t / (Math.PI * 2)) % 1) + hueShift + 360) % 360;
    burstColorScratch.setHSL(h / 360, 1, 0.72);
    burstColorScratch.toArray(burstColor, i * 3);
    burstSize[i] = minSize + Math.random() * sizeSpread;
    burstLife[i] = 1;
  }
  burstAlive = Math.min(BURST_MAX, burstAlive + CONFIG.burst.perTap);
  burstGeo.attributes.aColor.needsUpdate = true;
  burstGeo.attributes.aSize.needsUpdate = true;
}

function updateBurst(dt) {
  if (burstAlive <= 0) return;
  const drag = Math.max(0, 1 - CONFIG.burst.drag * dt);
  let alive = 0;
  for (let i = 0; i < BURST_MAX; i++) {
    if (burstLife[i] <= 0) continue;
    burstLife[i] -= dt * CONFIG.burst.fadeRate;
    if (burstLife[i] <= 0) { burstLife[i] = 0; continue; }
    alive++;
    burstPos[i * 3] += burstVel[i * 3] * dt;
    burstPos[i * 3 + 1] += burstVel[i * 3 + 1] * dt;
    burstPos[i * 3 + 2] += burstVel[i * 3 + 2] * dt;
    burstVel[i * 3] *= drag;
    burstVel[i * 3 + 1] *= drag;
    burstVel[i * 3 + 2] *= drag;
  }
  burstAlive = alive;
  burstGeo.attributes.position.needsUpdate = true;
  burstGeo.attributes.aLife.needsUpdate = true;
}

// =============================================================================
// Heartbeat. Two Gaussian thumps per cycle - a loud lub, a softer dub a fifth
// of a beat later - then silence until the next cycle. Returns 0..~1.
// =============================================================================
const HB = CONFIG.heartbeat;
function thump(phase, center, width, amplitude) {
  // Wrap the distance so a pulse sitting near phase 0 still rises before the
  // beat starts instead of being clipped flat at the seam.
  let d = phase - center;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return amplitude * Math.exp(-(d * d) / (2 * width * width));
}
function heartbeatAt(time) {
  const phase = (time * HB.bpm / 60) % 1;
  return thump(phase, 0, HB.lubWidth, HB.lubAmplitude)
       + thump(phase, HB.dubOffset, HB.dubWidth, HB.dubAmplitude);
}

// =============================================================================
// Input. One pointer path for mouse, pen and touch; pinch and drag handled
// from raw touch events, which report every finger.
// =============================================================================
const pointerTarget = { x: 0, y: 0 };
const tiltTarget = { x: 0, y: 0 };
let zoom = 0;              // -1 (far) .. 1 (near)
let dragOffset = 0;        // radians the visitor has spun the heart by
let dragVelocity = 0;
let dragging = false;
let dragLastX = 0;
let pointerDownAt = null;  // {x, y} while a press is in flight

function setPointerFromClient(x, y) {
  pointerTarget.x = (x / window.innerWidth) * 2 - 1;
  pointerTarget.y = (y / window.innerHeight) * 2 - 1;
}

window.addEventListener('pointermove', (e) => {
  setPointerFromClient(e.clientX, e.clientY);
  if (dragging) {
    const dx = e.clientX - dragLastX;
    dragLastX = e.clientX;
    dragVelocity = dx * CONFIG.interaction.dragSpeed / Math.max(1e-3, 1 / 60);
    dragOffset += dx * CONFIG.interaction.dragSpeed;
  }
}, { passive: true });

window.addEventListener('pointerdown', (e) => {
  // Leave the share button (and anything else interactive) to handle its own
  // press - dragging the scene from a control would swallow the click.
  if (e.target && e.target.closest && e.target.closest('button, a')) return;
  dragging = true;
  dragLastX = e.clientX;
  dragVelocity = 0;
  pointerDownAt = { x: e.clientX, y: e.clientY };
  enableDeviceTilt();
}, { passive: true });

function endPress(e) {
  dragging = false;
  if (!pointerDownAt) return;
  const moved = Math.hypot(e.clientX - pointerDownAt.x, e.clientY - pointerDownAt.y);
  // A press that barely moved is a tap, not a fling: spark instead of spin.
  if (moved <= CONFIG.interaction.tapSlop) emitBurst(currentHueShift);
  pointerDownAt = null;
}
window.addEventListener('pointerup', endPress, { passive: true });
window.addEventListener('pointercancel', () => { dragging = false; pointerDownAt = null; }, { passive: true });

window.addEventListener('wheel', (e) => {
  zoom = THREE.MathUtils.clamp(zoom + Math.sign(e.deltaY) * CONFIG.interaction.wheelStep, -1, 1);
}, { passive: true });

// Pinch. Two fingers on the canvas scale the scene the way the README always
// claimed they did; a single finger falls through to the pointer handlers.
let pinchDistance = 0;
function touchSpread(touches) {
  return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
}
window.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    pinchDistance = touchSpread(e.touches);
    dragging = false;
    pointerDownAt = null;   // a second finger means this was never a tap
  }
}, { passive: true });
window.addEventListener('touchmove', (e) => {
  if (e.touches.length !== 2) return;
  const spread = touchSpread(e.touches);
  if (pinchDistance > 0) {
    zoom = THREE.MathUtils.clamp(
      zoom + (spread - pinchDistance) * CONFIG.interaction.pinchStep, -1, 1);
  }
  pinchDistance = spread;
}, { passive: true });
window.addEventListener('touchend', (e) => {
  if (e.touches.length < 2) pinchDistance = 0;
}, { passive: true });

// Device tilt. iOS 13+ only hands out orientation after an explicit grant from
// inside a user gesture, so the request rides along with the visitor's first
// press rather than nagging behind a separate button. Everywhere else the
// listener simply attaches.
let tiltRequested = false;
function attachTiltListener() {
  window.addEventListener('deviceorientation', (e) => {
    if (e.beta === null || e.gamma === null) return;
    const g = CONFIG.interaction.tiltGain;
    tiltTarget.x = THREE.MathUtils.clamp(e.gamma * g, -1, 1);
    // beta reads ~90 when the phone is held upright, so measure from there.
    tiltTarget.y = THREE.MathUtils.clamp((e.beta - 90) * g, -1, 1);
  }, { passive: true });
}
function enableDeviceTilt() {
  if (tiltRequested) return;
  tiltRequested = true;
  const DOE = window.DeviceOrientationEvent;
  if (!DOE) return;
  if (typeof DOE.requestPermission === 'function') {
    DOE.requestPermission().then((state) => {
      if (state === 'granted') attachTiltListener();
    }).catch(() => { /* declined or unavailable - parallax still works */ });
  } else {
    attachTiltListener();
  }
}
if (!(window.DeviceOrientationEvent && typeof window.DeviceOrientationEvent.requestPermission === 'function')) {
  // No gesture needed on this platform, so start listening straight away.
  enableDeviceTilt();
}

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const pixelRatio = effectivePixelRatio();
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloomPass.resolution.set(w * TIER.bloomScale, h * TIER.bloomScale);
  dustMat.uniforms.uPixelRatio.value = pixelRatio;
  starMat.uniforms.uPixelRatio.value = pixelRatio;
  burstMat.uniforms.uPixelRatio.value = pixelRatio;
  BASE_DIST = computeBaseDist();
}
window.addEventListener('resize', onResize);

// A lost context leaves a permanently black canvas unless the default is
// prevented, so park the loop and pick it back up if the browser restores it.
let contextLost = false;
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); contextLost = true; });
canvas.addEventListener('webglcontextrestored', () => { contextLost = false; onResize(); });

// =============================================================================
// Main loop.
// =============================================================================
const FORM_DURATION = CONFIG.entrance.duration;
function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }

const clock = new THREE.Clock();
const camPos = new THREE.Vector3(0, 0, BASE_DIST);

// Accumulated from the clamped dt (not clock.getElapsedTime(), which keeps
// counting real wall-clock time even while the tab is backgrounded and RAF is
// paused - a long background spell would otherwise make the entrance reveal
// and rotation jump instead of animating smoothly).
let simTime = 0;
let entranceDone = false;
let currentHueShift = 0;

// Adaptive render scale. Frame cost is dominated by fill rate here (bloom over
// a full-resolution buffer), so the lever that actually moves is how many
// pixels are drawn - not how many vertices. Geometry is never rebuilt.
let frameAccum = 0;
let frameCount = 0;
let cooldown = 0;
function adaptQuality(dt) {
  if (cooldown > 0) { cooldown--; return; }
  frameAccum += dt * 1000;
  frameCount++;
  if (frameCount < CONFIG.adaptive.sampleFrames) return;
  const avg = frameAccum / frameCount;
  frameAccum = 0;
  frameCount = 0;
  const floor = TIER.pixelRatio * CONFIG.adaptive.minScale;
  if (avg > CONFIG.adaptive.slowFrameMs && renderScale > floor) {
    renderScale = Math.max(floor, renderScale * CONFIG.adaptive.scaleStep);
    onResize();
    cooldown = CONFIG.adaptive.cooldownFrames;
  } else if (avg < CONFIG.adaptive.fastFrameMs && renderScale < TIER.pixelRatio) {
    renderScale = Math.min(TIER.pixelRatio, renderScale / CONFIG.adaptive.scaleStep);
    onResize();
    cooldown = CONFIG.adaptive.cooldownFrames;
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (contextLost) return;
  simTime += dt;
  const t = simTime;

  const formProgress = easeOutCubic(Math.min(t / FORM_DURATION, 1));
  // Ambient animation reads this clock; under reduced motion it simply stops
  // advancing, which freezes every shimmer, drift and twinkle at once instead
  // of each system having to remember to check the flag.
  const animTime = reducedMotion ? 0 : t;
  const hueShift = Math.sin(animTime * 0.12) * 20;
  currentHueShift = hueShift;
  const beat = reducedMotion ? 0 : heartbeatAt(t);

  // Reveal the ribbon segment by segment, then stop touching drawRange once
  // it is fully formed.
  if (!entranceDone) {
    const segCount = Math.round(TUBULAR_SEGMENTS * formProgress);
    tubeGeo.setDrawRange(0, segCount * TUBE_INDICES_PER_SEGMENT);
    if (formProgress >= 1) entranceDone = true;
  }

  tubeMat.uniforms.uHueShift.value = hueShift / 360;
  tubeMat.uniforms.uTime.value = animTime;

  // The heartbeat swells the whole heart and drives the bloom with it, so the
  // glow surges on the beat rather than sitting at a constant brightness.
  heartGroup.scale.setScalar(1 + beat * HB.scaleDepth);
  bloomPass.strength = CONFIG.bloom.strength + beat * HB.bloomBoost;

  // Idle rotation, plus however far the visitor has dragged. The fling decays
  // back to nothing so the heart always returns to its own slow turn.
  dragVelocity *= Math.max(0, 1 - CONFIG.interaction.dragDecay * dt);
  dragOffset += dragVelocity * dt;
  heartGroup.rotation.y = animTime * CONFIG.idle.rotationSpeed + dragOffset;
  heartGroup.rotation.x = Math.sin(animTime * CONFIG.idle.tiltSpeed) * CONFIG.idle.tiltAmplitude;

  dustMat.uniforms.uTime.value = animTime;
  dustMat.uniforms.uForm.value = entranceDone ? 1 : formProgress;
  dustMat.uniforms.uHueShift.value = hueShift / 360;
  dustMat.uniforms.uBeat.value = beat;
  dustMat.uniforms.uStill.value = reducedMotion ? 1 : 0;

  starMat.uniforms.uTime.value = animTime;
  stars.rotation.y = animTime * CONFIG.idle.starDriftSpeed;

  // A streak crossing the sky is unambiguous imposed motion, so under reduced
  // motion none are spawned at all - the pool just stays idle.
  if (!reducedMotion && t > nextShootAt) {
    spawnShooter();
    nextShootAt = t + shooterGap();
  }
  updateShooters(dt);
  updateBurst(dt);

  // Camera parallax and zoom, eased toward their targets. Reduced motion drops
  // the ambient mouse/tilt follow entirely; zoom and drag stay, since those are
  // deliberate actions the visitor took, not motion the page imposed.
  const followX = THREE.MathUtils.clamp(pointerTarget.x + tiltTarget.x, -1.6, 1.6);
  const followY = THREE.MathUtils.clamp(pointerTarget.y + tiltTarget.y, -1.6, 1.6);
  const targetX = reducedMotion ? 0 : followX * CONFIG.camera.parallaxX;
  const targetY = reducedMotion ? 0 : -followY * CONFIG.camera.parallaxY;
  const targetDist = BASE_DIST - zoom * CONFIG.camera.zoomRange;
  const ease = Math.min(1, dt * CONFIG.camera.easeRate);
  camPos.x += (targetX - camPos.x) * ease;
  camPos.y += (targetY - camPos.y) * ease;
  camPos.z += (targetDist - camPos.z) * ease;
  camera.position.set(camPos.x, camPos.y, camPos.z);
  camera.lookAt(0, 0, 0);

  composer.render();
  adaptQuality(dt);
}
requestAnimationFrame(animate);

// The page is live: let CSS drop the fallback heart and reveal the overlay.
document.body.classList.add('webgl-ready');
