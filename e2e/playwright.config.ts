import { defineConfig, devices } from '@playwright/test';

// The address of the locally running app. The run wrapper sets E2E_BASE_URL;
// the fallback is only for running by hand.
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',
  // A committed .only would silently shrink the suite.
  forbidOnly: true,
  fullyParallel: true,
  // No silent reruns: a pass after a fail is a finding. The wrapper passes --retries.
  retries: 0,
  reporter: [['line']],
  use: {
    baseURL,
    testIdAttribute: 'data-testid',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Phone-sized check: screen size, touch and the Safari engine family.
    // It is an emulation, not the device.
    { name: 'iphone', grepInvert: /@surface-api/, use: { ...devices['iPhone 15'] } },
    // Scenarios for a published interface need no browser: tag them @surface-api.
    { name: 'api', grep: /@surface-api/, use: {} },
  ],
});
