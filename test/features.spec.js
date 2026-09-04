// The personalization, share and fallback paths - everything a visitor can
// reach that is not the 3D scene itself.
const { test, expect } = require('@playwright/test');
const { serveLocalCdn, collectConsoleErrors } = require('./fixtures');

test.beforeEach(async ({ page }) => {
  await serveLocalCdn(page);
});

test.describe('personalization', () => {
  test('accepts a known theme', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/index.html?theme=ocean');
    await page.waitForTimeout(1200);
    expect(errors).toEqual([]);
    await expect(page.locator('body')).toHaveClass(/webgl-ready/);
  });

  test('falls back to the default palette on an unknown theme', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    // Includes a prototype-chain name, which a bare `in` or property lookup
    // would wrongly treat as a valid theme.
    await page.goto('/index.html?theme=constructor');
    await page.waitForTimeout(1200);
    expect(errors).toEqual([]);
    await expect(page.locator('body')).toHaveClass(/webgl-ready/);
  });

  test('renders markup in ?to= as literal text, never as HTML', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const payload = '<img src=x onerror="window.__pwned=1">';
    await page.goto('/index.html?to=' + encodeURIComponent(payload));
    await page.waitForTimeout(1200);

    // textContent, not innerHTML: the tag arrives as characters on screen.
    await expect(page.locator('#title')).toHaveText(`For ${payload}`);
    expect(await page.locator('#title img').count()).toBe(0);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    expect(errors).toEqual([]);
  });

  test('caps an over-long name and collapses its whitespace', async ({ page }) => {
    await page.goto('/index.html?to=' + encodeURIComponent('  a\n\n  b  ' + 'x'.repeat(200)));
    const text = await page.locator('#title').textContent();
    // "For " plus the 40-character cap.
    expect(text.length).toBe(4 + 40);
    expect(text.startsWith('For a b')).toBe(true);
  });

  test('caps an over-long message', async ({ page }) => {
    await page.goto('/index.html?msg=' + encodeURIComponent('y'.repeat(400)));
    const text = await page.locator('#subtitle').textContent();
    expect(text.length).toBe(120);
  });
});

test.describe('share', () => {
  test('copies the current link, query params and all', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const errors = collectConsoleErrors(page);
    await page.goto('/index.html?to=Ada&theme=rose');

    const share = page.locator('#share');
    await expect(share).toBeVisible();
    await share.click();

    await expect(share).toHaveText('link copied');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain('to=Ada');
    expect(copied).toContain('theme=rose');

    // The confirmation is announced to screen readers too, not just painted.
    await expect(page.locator('#share-status')).toHaveText('link copied');
    expect(errors).toEqual([]);
  });

  test('is reachable and operable from the keyboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/index.html');
    await page.locator('#share').focus();
    await expect(page.locator('#share')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#share')).toHaveText('link copied');
  });

  test('pressing it does not spin the heart', async ({ page, context }) => {
    // The scene listens for pointerdown on window; the button must not be
    // swallowed by the drag handler behind it.
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/index.html');
    await page.waitForTimeout(1200);
    await page.locator('#share').click();
    await expect(page.locator('#share')).toHaveText('link copied');
  });
});

test.describe('no-WebGL fallback', () => {
  test('shows a CSS heart instead of a black screen', async ({ page }) => {
    // Deny the page a WebGL context the way a machine without one would.
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        if (typeof type === 'string' && type.indexOf('webgl') !== -1) return null;
        return original.call(this, type, ...rest);
      };
    });
    await page.goto('/index.html');
    await page.waitForTimeout(1200);

    await expect(page.locator('body')).toHaveClass(/no-webgl/);
    await expect(page.locator('body')).not.toHaveClass(/webgl-ready/);
    await expect(page.locator('#fallback')).toBeVisible();

    // The words still land, so the page keeps saying what it came to say.
    await expect(page.locator('#title')).toHaveText('My Universe');
    await expect(page.locator('#subtitle')).toHaveText("In every lifetime, I'd find you again");
  });

  test('still personalizes the overlay without WebGL', async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        if (typeof type === 'string' && type.indexOf('webgl') !== -1) return null;
        return original.call(this, type, ...rest);
      };
    });
    await page.goto('/index.html?to=Ada');
    await expect(page.locator('#title')).toHaveText('For Ada');
  });
});
