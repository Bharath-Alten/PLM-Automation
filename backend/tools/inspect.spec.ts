import { test } from '@playwright/test';

import { PLM_URL } from '../tests/selectors';

// Opens PLM signed in (credentials from backend/.env, like a real run) and pauses with the Playwright
// Inspector, to record clicks or pick a locator (e.g. the DHT field inside the ppbIFrame).
// Run: npm run inspect
test('inspect PLM', async ({ page }) => {
  await page.goto(PLM_URL);
  await page.pause();
});
