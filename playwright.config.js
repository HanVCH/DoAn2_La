const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    browserName: 'chromium',
    channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined),
    viewport: { width: 1440, height: 1024 },
    trace: 'retain-on-failure',
  },
  webServer: process.env.LA_TEST_MANAGED_SERVER === 'true' ? undefined : {
    command: 'node tests/support/browser-server.mjs',
    url: 'http://127.0.0.1:3100/register',
    env: { PORT: '3100', AUTH_REGISTER_URL: '', AUTH_LOGIN_URL: '', LOGIN_SUCCESS_PATH: '', GOOGLE_AUTH_URL: '', FACEBOOK_AUTH_URL: '', LOGIN_PATH: '/login', FORGOT_PASSWORD_PATH: '/forgot-password' },
    reuseExistingServer: false,
  },
});
