// Dev-only test config - does not affect how the page itself is served or
// built. The site keeps loading directly as static HTML/CSS/JS.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test',
  timeout: 30000,
  fullyParallel: true,
  reporter: [['list']],
  webServer: {
    command: 'python3 -m http.server 4173',
    url: 'http://localhost:4173/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
  use: {
    baseURL: 'http://localhost:4173',
    // Escape hatch for sandboxed/offline environments that already ship a
    // Chromium but can't download Playwright's pinned build. Unset in CI, so
    // CI keeps using the browser `npx playwright install` provides.
    ...(process.env.PW_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } }
      : {}),
  },
});
