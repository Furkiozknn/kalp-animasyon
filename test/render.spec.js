// Does the scene actually draw?
//
// The console-error smoke test in smoke.spec.js proves the module ran; it
// cannot tell a glowing heart from a black rectangle. These tests decode the
// screenshot and look at the pixels, which is what catches a shader that
// compiles but outputs nothing - the exact failure mode of moving the colour
// maths from the CPU onto the GPU.
const { test, expect } = require('@playwright/test');
const { serveLocalCdn, collectConsoleErrors, waitForStillFrame } = require('./fixtures');
const { summarize, meanDifference, changedFraction } = require('./png');

// Long enough for the ~2.9s entrance to finish, so the ribbon is fully drawn
// rather than caught partway through revealing itself.
const SETTLED_MS = 4200;

test.beforeEach(async ({ page }) => {
  await serveLocalCdn(page);
});

async function settledShot(page, url = '/index.html') {
  const errors = collectConsoleErrors(page);
  await page.goto(url);
  await page.waitForTimeout(SETTLED_MS);
  const shot = await page.screenshot({ type: 'png' });
  return { errors, frame: summarize(shot) };
}

test('renders a lit, coloured heart rather than a black screen', async ({ page }) => {
  const { errors, frame } = await settledShot(page);
  expect(errors).toEqual([]);

  // The scene is mostly deep space by design, so the thresholds are about
  // "something bright and coloured is clearly present", not about coverage.
  expect(frame.brightest).toBeGreaterThan(150);
  expect(frame.litFraction).toBeGreaterThan(0.004);
  expect(frame.colorfulFraction).toBeGreaterThan(0.002);
});

test('WebGL initialises and the CSS fallback stays hidden', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('body')).toHaveClass(/webgl-ready/);
  await expect(page.locator('#fallback')).toBeHidden();
});

test('reduced motion keeps the artwork but stops every ambient animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = collectConsoleErrors(page);
  await page.goto('/index.html');

  // The entrance is allowed to play, so wait for it to finish rather than for
  // a fixed delay. That it settles at all is itself the assertion: with any
  // ambient animation left running this never returns.
  const { frame: still } = await waitForStillFrame(page);

  // The artwork itself is untouched: still lit, still coloured.
  const frame = summarize(still);
  expect(frame.brightest).toBeGreaterThan(150);
  expect(frame.litFraction).toBeGreaterThan(0.004);
  expect(frame.colorfulFraction).toBeGreaterThan(0.002);

  // ...and it stays settled - no heartbeat, drift, twinkle, shimmer or
  // streaks creeping back in a second later.
  await page.waitForTimeout(1000);
  expect(meanDifference(still, await page.screenshot({ type: 'png' }))).toBeLessThan(1);
  expect(errors).toEqual([]);
});

test('the scene is genuinely animating when motion is allowed', async ({ page }) => {
  // The mirror of the test above: without the reduced-motion preference the
  // very same measurement must show clear frame-to-frame change, so a frozen
  // scene can never pass both.
  await page.goto('/index.html');
  await page.waitForTimeout(SETTLED_MS);
  const first = await page.screenshot({ type: 'png' });
  await page.waitForTimeout(500);
  const second = await page.screenshot({ type: 'png' });
  expect(meanDifference(first, second)).toBeGreaterThan(1);
});

test('renders on a small portrait viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors, frame } = await settledShot(page);
  expect(errors).toEqual([]);
  expect(frame.brightest).toBeGreaterThan(150);
  expect(frame.litFraction).toBeGreaterThan(0.004);

  // The page must never scroll sideways on a phone.
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('a tap scatters sparks, and only on a tap', async ({ page }) => {
  // Measured against the still reduced-motion scene rather than the live one:
  // with the heartbeat running, the scene's own brightness swings by ~13% from
  // frame to frame, which is far more than 34 sparks contribute. Comparing
  // against a frozen backdrop makes the burst the only thing that can move.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = collectConsoleErrors(page);
  await page.goto('/index.html');

  const { frame: before } = await waitForStillFrame(page);

  // Tap off-centre so the press lands on the canvas, not the overlay text,
  // and screenshot straight away: the sparks live well under a second.
  await page.mouse.click(200, 200);
  const during = await page.screenshot({ type: 'png' });

  // Counted by changed pixels rather than whole-frame mean. A few dozen sparks
  // cover ~0.15% of the frame, which a mean dilutes below the noise floor;
  // against a scene measured to be pixel-identical when still, 0.03% is an
  // unambiguous signal with two orders of magnitude of headroom.
  expect(changedFraction(before, during)).toBeGreaterThan(0.0003);

  // Sparks are short-lived, so the scene must fall still again afterwards
  // rather than the tap leaving something permanently animating.
  await waitForStillFrame(page);

  expect(errors).toEqual([]);
});

test('pinch and drag gestures do not throw', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/index.html');
  await page.waitForTimeout(1500);

  // Two-finger pinch, dispatched as real touch events with two touch points.
  await page.evaluate(() => {
    const canvas = document.getElementById('scene');
    const touch = (id, x, y) => new Touch({ identifier: id, target: canvas, clientX: x, clientY: y });
    const fire = (type, points) => canvas.dispatchEvent(
      new TouchEvent(type, { touches: points, targetTouches: points, changedTouches: points, bubbles: true }));
    fire('touchstart', [touch(1, 100, 300), touch(2, 300, 300)]);
    fire('touchmove', [touch(1, 60, 300), touch(2, 340, 300)]);
    fire('touchend', []);
  });

  // Drag, as a pointer press that travels well past the tap threshold.
  await page.mouse.move(300, 400);
  await page.mouse.down();
  await page.mouse.move(420, 400, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(600);

  expect(errors).toEqual([]);
  await expect(page.locator('body')).toHaveClass(/webgl-ready/);
});
