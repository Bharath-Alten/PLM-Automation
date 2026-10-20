import { defineConfig } from '@playwright/test';

// A run from the terminal has no app to hand it backend/.env, so load it here (Node 20.12+).
// Real environment variables win over the file.
try {
  process.loadEnvFile('.env');
} catch {
  // no .env: the defaults apply
}

// PLM answers with HTTP authentication. Credentials live in backend/.env, never in this file.
const httpCredentials = process.env.PLM_USER && process.env.PLM_PASSWORD
  ? { username: process.env.PLM_USER, password: process.env.PLM_PASSWORD }
  : undefined;

export default defineConfig({
  testDir: './tests',
  // PLM specs only; the *.test.ts files are offline unit tests run by "npm test".
  testMatch: '**/*.spec.ts',
  timeout: 900_000,
  retries: 0,
  // One test per routing, so routings can run side by side. WORKERS=1 if PLM struggles.
  fullyParallel: true,
  workers: Number(process.env.WORKERS || 4),
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }]
  ],
  use: {
    headless: false,
    ignoreHTTPSErrors: true,
    // Applied to every page, which avoids net::ERR_INVALID_AUTH_CREDENTIALS when workers open pages together.
    httpCredentials,
    viewport: null,
    launchOptions: { args: ['--start-maximized'] },
    actionTimeout: 0,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  outputDir: 'test-results/'
});
