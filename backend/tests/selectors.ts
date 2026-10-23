import type { FrameLocator, Locator, Page } from '@playwright/test';

// Every Windchill locator in one place. The ones marked "from the previous project" worked on
// plm-mc-12 six months ago. The DHT item and field are new: check them against the real screen first.

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

/**
 * The operation in the structure tree: //span[@qtip="0020"], or (previous project) a cell whose text
 * is "0020, ..." or just "0020".
 */
export const operationCell = (frame: FrameLocator, paddedOperation: string) =>
  frame.locator(
    `//span[@qtip='${paddedOperation}'] | //td[contains(@class,'x-grid3-cell')]//span[starts-with(normalize-space(text()),'${paddedOperation},') or normalize-space(text())='${paddedOperation}']`
  ).first();

const DHT_ITEM_ATTRIBUTE = 'data-plm-dht';

/**
 * Finds the DHT item of an operation: the first span after the operation whose qtip reads like
 * "1.35 DHT" (//span[@qtip="1.35 DHT"]), looking no further than the next operation's own span, so
 * another operation's DHT is never taken. The span found is tagged, so dhtItem() can click it.
 * Returns false when the operation has no DHT item.
 */
export async function tagDhtItem(operation: Locator): Promise<boolean> {
  return operation.evaluate((op, attribute) => {
    const doc = op.ownerDocument;
    doc.querySelectorAll(`[${attribute}]`).forEach((el) => el.removeAttribute(attribute));
    const FOLLOWING = 4; // Node.DOCUMENT_POSITION_FOLLOWING
    for (const span of Array.from(doc.querySelectorAll('span[qtip]'))) {
      if (span === op || op.contains(span) || !(op.compareDocumentPosition(span) & FOLLOWING)) continue;
      const qtip = (span.getAttribute('qtip') ?? '').trim();
      if (/^\d{4}$/.test(qtip)) return false; // the next operation: this one has no DHT item
      if (/\sDHT$/i.test(qtip)) {
        span.setAttribute(attribute, '1');
        return true;
      }
    }
    return false;
  }, DHT_ITEM_ATTRIBUTE);
}

/** The DHT item tagged by tagDhtItem. */
export const dhtItem = (frame: FrameLocator) => frame.locator(`[${DHT_ITEM_ATTRIBUTE}='1']`).first();

// The DHT input of the panel, found by its label. Set DHT_INPUT_XPATH to override it without touching the code.
export const dhtInput = (frame: FrameLocator) =>
  frame.locator(
    process.env.DHT_INPUT_XPATH ||
      "(//label[normalize-space(.)='DHT' or normalize-space(.)='DHT:']/following::input[not(@type='hidden')])[1]"
  ).first();

/**
 * The input to type the value in: the DHT-labelled one, else the numeric spinner of the previous
 * project's panel (index 2, then 1).
 */
export async function resolveDhtInput(frame: FrameLocator): Promise<Locator> {
  const labelled = dhtInput(frame);
  if (await labelled.isVisible().catch(() => false)) return labelled;
  const second = frame.locator("(//input[@aria-valuemin='-Infinity'])[2]");
  if (await second.isVisible().catch(() => false)) return second;
  return frame.locator("(//input[@aria-valuemin='-Infinity'])[1]");
}
