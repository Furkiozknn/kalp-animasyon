// Dev-only smoke test - loads the live static page in a real browser and
// checks it renders without errors, with and without prefers-reduced-motion,
// and that the optional ?to=/?msg= personalization params work. Does not
// change how the site itself is built or served.
const { test, expect } = require('@playwright/test');

function collectConsoleErrors(page) {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

test('loads with no console errors (default motion)', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/index.html');
  await page.waitForTimeout(2000);
  expect(errors).toEqual([]);
  await expect(page.locator('#title')).toHaveText('My Universe');
});

test('loads with no console errors (prefers-reduced-motion: reduce)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = collectConsoleErrors(page);
  await page.goto('/index.html');
  await page.waitForTimeout(2000);
  expect(errors).toEqual([]);
});

test('?to= personalizes the title with no console errors', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/index.html?to=' + encodeURIComponent('Ada'));
  await page.waitForTimeout(1000);
  expect(errors).toEqual([]);
  await expect(page.locator('#title')).toHaveText('For Ada');
});

test('?msg= personalizes the subtitle with no console errors', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/index.html?msg=' + encodeURIComponent('a short line'));
  await page.waitForTimeout(1000);
  expect(errors).toEqual([]);
  await expect(page.locator('#subtitle')).toHaveText('a short line');
});

test('no query params leaves the default text untouched', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('#title')).toHaveText('My Universe');
});
