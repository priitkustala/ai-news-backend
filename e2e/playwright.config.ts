import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// The local test environment's bindings (priitkustala/ai-news#40, #92): `node dist/cli.js keys` writes them
// into local.env in the memory folder AI_NEWS_SECRETS_DIR; a checkout not yet moved keeps the git-ignored
// ../.env.local; a value already set in the environment wins.
const secretsDir = process.env.AI_NEWS_SECRETS_DIR;
const localEnvFiles = [...(secretsDir ? [path.join(secretsDir, 'local.env')] : []), path.resolve(__dirname, '..', '.env.local')];
for (const file of localEnvFiles) if (fs.existsSync(file)) process.loadEnvFile(file);

// The address of the locally running app. The run wrapper sets E2E_BASE_URL;
// the fallback is only for running by hand.
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',
  // A committed .only would silently shrink the suite.
  forbidOnly: true,
  // One worker on one stack (AD-08): a seed resets shared state, so scenarios never overlap.
  fullyParallel: false,
  workers: 1,
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
    { name: 'iphone', grepInvert: /@surface-api|@surface-job|@surface-data/, use: { ...devices['iPhone 15'] } },
    // Scenarios for a published interface need no browser: tag them @surface-api.
    { name: 'api', grep: /@surface-api|@surface-job|@surface-data/, use: {} },
  ],
});
