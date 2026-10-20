import { defineConfig } from '@playwright/test';

import base from './playwright.config';

// Same browser settings and credentials as a real run, but only the tools/ specs, one at a time, no time limit.
export default defineConfig(base, {
  testDir: './tools',
  timeout: 0,
  fullyParallel: false,
  workers: 1,
  reporter: 'list'
});
