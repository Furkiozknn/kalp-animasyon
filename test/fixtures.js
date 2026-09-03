// Hermetic test fixtures.
//
// The page itself loads Three.js from unpkg and its fonts from Google Fonts.
// That is fine in production, but it makes the smoke test depend on two
// third-party CDNs being reachable and healthy: a CDN blip becomes a red CI
// run that has nothing to do with the code. It also makes the suite unusable
// on an offline or egress-restricted machine.
//
// So the tests serve those two origins themselves: Three.js out of the
// `three` devDependency (pinned to the same version the import map names),
// and the font stylesheet as an empty sheet, since the page already declares
// full local fallback stacks for both faces. Nothing about how the page is
// built or shipped changes - only what the test browser talks to.
const fs = require('fs');
const path = require('path');

// `three` does not export ./package.json, so locate the package from its
// main entry (<root>/build/three.cjs) rather than hardcoding node_modules -
// that keeps working under npm/pnpm hoisting.
const THREE_ROOT = path.resolve(path.dirname(require.resolve('three')), '..');

// The import map points at unpkg paths whose layout mirrors the npm package
// one-to-one, so the version prefix is all that has to be stripped.
const UNPKG_THREE = /^https:\/\/unpkg\.com\/three@[^/]+\/(.*)$/;

const CONTENT_TYPES = {
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

async function serveLocalCdn(page) {
  await page.route(UNPKG_THREE, async (route) => {
    const rest = UNPKG_THREE.exec(route.request().url())[1];
    // Refuse to walk outside the package - a redirect or a crafted URL must
    // not turn this helper into an arbitrary-file reader.
    const file = path.resolve(THREE_ROOT, rest);
    if (file !== THREE_ROOT && !file.startsWith(THREE_ROOT + path.sep)) {
      return route.fulfill({ status: 403, body: 'outside package' });
    }
    if (!fs.existsSync(file)) {
      return route.fulfill({ status: 404, body: 'not vendored: ' + rest });
    }
    await route.fulfill({
      status: 200,
      contentType: CONTENT_TYPES[path.extname(file)] || 'application/octet-stream',
      body: fs.readFileSync(file),
    });
  });

  // Fonts: the page names real local fallbacks (Georgia / Times New Roman /
  // generic serif), so an empty sheet renders correctly, just not in the
  // display faces. Layout and every assertion below are unaffected.
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: '' }));
  await page.route('https://fonts.gstatic.com/**', (route) =>
    route.fulfill({ status: 404, body: '' }));
}

function collectConsoleErrors(page) {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

module.exports = { serveLocalCdn, collectConsoleErrors };
