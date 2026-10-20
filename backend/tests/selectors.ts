import type { FrameLocator, Page } from '@playwright/test';

// Every Windchill locator in one place. The ones marked "from the previous project" worked on
// plm-mc-12 six months ago. The DHT field is new: check it against the real screen first.

export const PLM_URL = process.env.PLM_URL || 'https://plm-mc-12.myatlantic.aero/Windchill/app/';

// from the previous project
export const searchBox = (page: Page) =>
  page.locator("//input[contains(@id,'SearchField') or @id='gloabalSearchField']");
export const searchButton = (page: Page) =>
  page.locator("//img[contains(@class,'search-trigger') or contains(@src,'search')]");
export const resultLinks = (page: Page) =>
  page.locator("//img[@qtip='Process Plan']/parent::div/parent::td/following-sibling::td[3]/div/a");
export const structureTab = (page: Page) => page.locator("(//span[text()='Structure'])[1]");
export const planFrame = (page: Page) => page.frameLocator("//iframe[@id='ppbIFrame']");
// The UI sometimes renders two matching grid bodies: take the first to avoid a strict-mode violation.
export const planGrid = (frame: FrameLocator) => frame.locator("//div[contains(@class,'x-grid3-body')]").first();

/** The cell of an operation in the structure tree: "0010, ..." or just "0010". */
export const operationCell = (frame: FrameLocator, paddedOperation: string) =>
  frame.locator(
    `//td[contains(@class,'x-grid3-cell')]//span[starts-with(normalize-space(text()),'${paddedOperation},') or normalize-space(text())='${paddedOperation}']`
  ).first();

// new: the DHT input in the operation's right-hand panel, found by its label.
// Set DHT_INPUT_XPATH to override it without touching the code.
export const dhtInput = (frame: FrameLocator) =>
  frame.locator(
    process.env.DHT_INPUT_XPATH ||
      "(//label[normalize-space(.)='DHT' or normalize-space(.)='DHT:']/following::input[not(@type='hidden')])[1]"
  ).first();
