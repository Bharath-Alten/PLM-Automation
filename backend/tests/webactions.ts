import type { FrameLocator, Locator, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Small wrapper the specs share: every step is logged (the run panel shows it) and screenshots go
// into the run's artifact folder.
export class Actions {
  private screenshotDir: string;

  constructor(private page: Page) {
    this.screenshotDir = path.join(process.env.ARTIFACT_DIR || 'outputs', 'screenshots');
    fs.mkdirSync(this.screenshotDir, { recursive: true });
  }

  async log(message: string) {
    console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
  }

  async screenshot(name: string) {
    const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_');
    await this.page.screenshot({ path: path.join(this.screenshotDir, `${safe}.png`) }).catch(() => undefined);
  }

  async click(scope: Page | FrameLocator, xpath: string, description: string) {
    await this.log(description);
    await (scope as Page).locator(xpath).click();
  }

  async fill(scope: Page | FrameLocator, xpath: string, value: string, description: string) {
    await this.log(description);
    await (scope as Page).locator(xpath).fill(value);
  }

  async isVisible(locator: Locator) {
    return locator.isVisible().catch(() => false);
  }
}
