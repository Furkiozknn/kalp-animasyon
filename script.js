import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ---------- Renderer / Scene / Camera ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x05020c, 0.028);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
function computeBaseDist() {
  const aspect = window.innerWidth / window.innerHeight;
  const portraitFactor = aspect < 1 ? Math.min(1 / aspect, 1.7) : 1;
  return 7.2 * portraitFactor;
}
let BASE_DIST = computeBaseDist();
camera.position.set(0, 0, BASE_DIST);

// ---------- Post-processing (real bloom, not a canvas hack) ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.85, // strength
  0.4,  // radius
  0.45  // threshold
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloomPass.resolution.set(w, h);
  dustMat.uniforms.uPixelRatio.value = pixelRatio;
  starMat.uniforms.uPixelRatio.value = pixelRatio;
  BASE_DIST = computeBaseDist();
}
window.addEventListener('resize', onResize);

// ---------- Pointer: parallax + scroll zoom ----------
const pointerTarget = { x: 0, y: 0 };
window.addEventListener('mousemove', (e) => {
  pointerTarget.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointerTarget.y = (e.clientY / window.innerHeight) * 2 - 1;
});
window.addEventListener('touchmove', (e) => {
  const t = e.touches[0];
  if (!t) return;
  pointerTarget.x = (t.clientX / window.innerWidth) * 2 - 1;
  pointerTarget.y = (t.clientY / window.innerHeight) * 2 - 1;
}, { passive: true });

let zoom = 0; // -1 (far) .. 1 (near)
window.addEventListener('wheel', (e) => {
  zoom = THREE.MathUtils.clamp(zoom + Math.sign(e.deltaY) * 0.08, -1, 1);
}, { passive: true });

// ---------- Aurora hue ramp: magenta -> violet -> gold, no green crossing ----------
const HUE_STOPS = [
  { f: 0, h: 330 },
  { f: 0.25, h: 285 },
  { f: 0.5, h: 42 },
  { f: 0.75, h: 285 },
  { f: 1, h: 330 },
];
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
// hueAt(f) only depends on the fixed parameter f, not on time - the per-frame
// cost was recomputing the same 581 values (321 tube + 260 dust) every frame.
// Cache them once; per-frame code only adds the scalar hueShift afterward.

const heartGroup = new THREE.Group();
scene.add(heartGroup);

// ---------- Heart curve (with a gentle z-wave for real depth) ----------
function heartRaw(t) {
  const x = 16 * Math.pow(Math.sin(t), 3);
  const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
  return { x, y };
}
const WORLD_SCALE = 2.7;
const CURVE_RES = 180;
const curvePoints = [];
for (let i = 0; i < CURVE_RES; i++) {
  const t = (i / CURVE_RES) * Math.PI * 2;
  const p = heartRaw(t);
  const z = Math.sin(t * 3) * 1.1;
  curvePoints.push(new THREE.Vector3((p.x / 16) * WORLD_SCALE, (p.y / 16) * WORLD_SCALE, (z / 16) * WORLD_SCALE));
}
const heartCurve = new THREE.CatmullRomCurve3(curvePoints, true, 'catmullrom', 0.55);

// ---------- Glowing ribbon (TubeGeometry, vertex-colored gradient) ----------
const TUBULAR_SEGMENTS = 320;
const RADIAL_SEGMENTS = 8;
const tubeGeo = new THREE.TubeGeometry(heartCurve, TUBULAR_SEGMENTS, 0.145, RADIAL_SEGMENTS, true);

const ringVerts = RADIAL_SEGMENTS + 1;
const tubeColorAttr = new THREE.BufferAttribute(new Float32Array(tubeGeo.attributes.position.count * 3), 3);
tubeGeo.setAttribute('color', tubeColorAttr);
const tmpColor = new THREE.Color();

const tubeBaseHue = new Float32Array(TUBULAR_SEGMENTS + 1);
for (let i = 0; i <= TUBULAR_SEGMENTS; i++) tubeBaseHue[i] = hueAt(i / TUBULAR_SEGMENTS);

function updateTubeColors(hueShift, time) {
  const arr = tubeColorAttr.array;
  for (let i = 0; i <= TUBULAR_SEGMENTS; i++) {
    const f = i / TUBULAR_SEGMENTS;
    const h = (tubeBaseHue[i] + hueShift + 360) % 360;
    const l = (46 + Math.sin(time * 1.6 + f * 18) * 8) / 100;
    tmpColor.setHSL(h / 360, 0.92, l);
    const base = i * ringVerts * 3;
    for (let r = 0; r < ringVerts; r++) {
      const idx = base + r * 3;
      arr[idx] = tmpColor.r;
      arr[idx + 1] = tmpColor.g;
      arr[idx + 2] = tmpColor.b;
    }
  }
  tubeColorAttr.needsUpdate = true;
}
updateTubeColors(0, 0);

const tubeMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
heartGroup.add(tubeMesh);

const TUBE_INDICES_PER_SEGMENT = RADIAL_SEGMENTS * 6;
tubeGeo.setDrawRange(0, 0); // revealed progressively on entrance

// ---------- Stardust drifting around the ribbon ----------
const DUST_COUNT = 260;
const dustGeo = new THREE.BufferGeometry();
const dustPos = new Float32Array(DUST_COUNT * 3);
const dustColor = new Float32Array(DUST_COUNT * 3);
const dustSize = new Float32Array(DUST_COUNT);
const dustData = [];
for (let i = 0; i < DUST_COUNT; i++) {
  const t = Math.random() * Math.PI * 2;
  const p = heartRaw(t);
  const z = Math.sin(t * 3) * 1.1;
  const f = (t / (Math.PI * 2)) % 1;
  dustData.push({
    f,
    baseHue: hueAt(f),
    base: new THREE.Vector3((p.x / 16) * WORLD_SCALE, (p.y / 16) * WORLD_SCALE, (z / 16) * WORLD_SCALE),
    jitter: new THREE.Vector3((Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9),
    from: new THREE.Vector3((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10),
    phase: Math.random() * Math.PI * 2,
    speed: Math.random() * 0.03 + 0.015,
  });
  dustSize[i] = Math.random() * 10 + 5;
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
dustGeo.setAttribute('color', new THREE.BufferAttribute(dustColor, 3));
dustGeo.setAttribute('aSize', new THREE.BufferAttribute(dustSize, 1));

const dustMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexColors: true,
  uniforms: { uPixelRatio: { value: renderer.getPixelRatio() } },
  vertexShader: `
    attribute float aSize;
    varying vec3 vColor;
    uniform float uPixelRatio;
    void main() {
      vColor = color;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
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
const dustPoints = new THREE.Points(dustGeo, dustMat);
heartGroup.add(dustPoints);

// ---------- Starfield background ----------
const STAR_COUNT = 900;
const starGeo = new THREE.BufferGeometry();
const starPos = new Float32Array(STAR_COUNT * 3);
const starPhase = new Float32Array(STAR_COUNT);
const starSpeed = new Float32Array(STAR_COUNT);
const starSize = new Float32Array(STAR_COUNT);
for (let i = 0; i < STAR_COUNT; i++) {
  const r = 22 + Math.random() * 55;
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(THREE.MathUtils.randFloatSpread(2));
  starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
  starPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
  starPos[i * 3 + 2] = -Math.abs(r * Math.cos(phi)) - 5;
  starPhase[i] = Math.random() * Math.PI * 2;
  starSpeed[i] = Math.random() * 1.2 + 0.4;
  starSize[i] = Math.random() * 6 + 2.5;
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

// ---------- Shooting stars ----------
const MAX_SHOOTERS = 4;
const shooterPool = [];
const shooterGroup = new THREE.Group();
scene.add(shooterGroup);
for (let i = 0; i < MAX_SHOOTERS; i++) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  geo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array([0, 1]), 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: false,
    uniforms: { uColor: { value: new THREE.Color(0xfff2e0) } },
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
let nextShootAt = 2 + Math.random() * 4;
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
    s.life -= dt * 0.6;
    if (s.life <= 0) { s.line.visible = false; continue; }
    shooterTailScratch.copy(s.head).addScaledVector(s.vel, -0.35);
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

// ---------- Entrance + main loop ----------
const FORM_DURATION = 2.9;
function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }

const clock = new THREE.Clock();
const camPos = new THREE.Vector3(0, 0, BASE_DIST);
const shooterTailScratch = new THREE.Vector3();

// Accumulated from the clamped dt (not clock.getElapsedTime(), which keeps
// counting real wall-clock time even while the tab is backgrounded and RAF is
// paused - a long background spell would otherwise make the entrance reveal
// and rotation jump instead of animating smoothly).
let simTime = 0;
let entranceDone = false;

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  simTime += dt;
  const t = simTime;

  const formProgress = easeOutCubic(Math.min(t / FORM_DURATION, 1));
  const hueShift = Math.sin(t * 0.12) * 20;

  // reveal the ribbon segment by segment, then stop touching drawRange once fully formed
  if (!entranceDone) {
    const segCount = Math.round(TUBULAR_SEGMENTS * formProgress);
    tubeGeo.setDrawRange(0, segCount * TUBE_INDICES_PER_SEGMENT);
    if (formProgress >= 1) entranceDone = true;
  }
  updateTubeColors(hueShift, t);

  // breathing pulse + slow living rotation
  const pulse = 1 + Math.sin(t * 0.9) * 0.02;
  heartGroup.scale.setScalar(pulse);
  heartGroup.rotation.y = t * 0.12;
  heartGroup.rotation.x = Math.sin(t * 0.15) * 0.08;

  // stardust: entrance + orbit-following jitter
  const posAttr = dustGeo.attributes.position;
  const colAttr = dustGeo.attributes.color;
  for (let i = 0; i < DUST_COUNT; i++) {
    const d = dustData[i];
    const flicker = 0.5 + 0.5 * Math.sin(t * d.speed * 40 + d.phase);
    const tx = d.base.x + d.jitter.x * flicker;
    const ty = d.base.y + d.jitter.y * flicker;
    const tz = d.base.z + d.jitter.z * flicker;
    if (entranceDone) {
      posAttr.setXYZ(i, tx, ty, tz);
    } else {
      const x = d.from.x + (tx - d.from.x) * formProgress;
      const y = d.from.y + (ty - d.from.y) * formProgress;
      const z = d.from.z + (tz - d.from.z) * formProgress;
      posAttr.setXYZ(i, x, y, z);
    }
    const h = (d.baseHue + hueShift + 360) % 360;
    tmpColor.setHSL(h / 360, 0.95, 0.62);
    colAttr.setXYZ(i, tmpColor.r, tmpColor.g, tmpColor.b);
  }
  posAttr.needsUpdate = true;
  colAttr.needsUpdate = true;

  // starfield twinkle + slow drift
  starMat.uniforms.uTime.value = t;
  stars.rotation.y = t * 0.006;

  // shooting stars
  if (t > nextShootAt) {
    spawnShooter();
    nextShootAt = t + 3 + Math.random() * 5;
  }
  updateShooters(dt);

  // camera parallax + scroll zoom, eased toward target
  const targetX = pointerTarget.x * 1.1;
  const targetY = -pointerTarget.y * 0.7;
  const targetDist = BASE_DIST - zoom * 2.4;
  const ease = Math.min(1, dt * 2.2);
  camPos.x += (targetX - camPos.x) * ease;
  camPos.y += (targetY - camPos.y) * ease;
  camPos.z += (targetDist - camPos.z) * ease;
  camera.position.set(camPos.x, camPos.y, camPos.z);
  camera.lookAt(0, 0, 0);

  composer.render();
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
