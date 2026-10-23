import type { FrameLocator, Locator, Page } from '@playwright/test';

// Every Windchill locator in one place. The ones marked "from the previous project" worked on
// plm-mc-12 six months ago. The Uses-table ones are new: check them against the real screen first.

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

// ---- the "Uses" table of the Structure tab: one row per operation ---------------------------

/** The "Uses" tab of the right-hand panel (it is the one open by default; clicking it again is harmless). */
export const usesTab = (frame: FrameLocator) => frame.locator("//span[normalize-space(text())='Uses']").first();

/** The operation's label number cell in the Uses table: //span[@qtip="0020"]. */
export const operationLabel = (frame: FrameLocator, paddedOperation: string) =>
  frame.locator(`//span[@qtip='${paddedOperation}']`).first();

/** Header of the column that receives the value ("Temps Traite..." is the start of its title). */
export const DHT_COLUMN_HEADER = process.env.DHT_COLUMN_HEADER || 'Temps Traite';

const CELL_TAG = 'data-plm-dht-cell';
const EDITOR_TAG = 'data-plm-dht-editor';

/**
 * The DHT cell of an operation: in the same row as its label, the cell lying under the column whose
 * header starts with `header`. The column is matched by position on screen, so it does not matter how
 * many columns sit before it or how the grid builds its markup. The cell is tagged, so dhtCell() can
 * use it. Returns false when the row or the column cannot be found.
 */
export async function tagDhtCell(label: Locator, header: string = DHT_COLUMN_HEADER): Promise<boolean> {
  // Only a plain string goes into evaluate: Windchill's scripts break Playwright's unpacking of object
  // arguments ("refs.set is not a function"), while strings work. Header and tag travel as "header|tag".
  return label.evaluate((el, packed) => {
    const [wanted, tag] = packed.split('|');
    const doc = el.ownerDocument;
    doc.querySelectorAll(`[${tag}]`).forEach((n) => n.removeAttribute(tag));
    const plain = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const prefix = plain(wanted);

    // The header text element: the deepest visible element whose text starts with the wanted title.
    const headers = Array.from(doc.querySelectorAll('div, span, td, th')).filter((n) => {
      const text = plain(n.textContent ?? '');
      const rect = n.getBoundingClientRect();
      return text.startsWith(prefix) && text.length < 60 && rect.width > 0 && rect.height > 0;
    });
    const header = headers.find((n) => !headers.some((other) => other !== n && n.contains(other)));
    if (!header) return false;
    const headerRect = header.getBoundingClientRect();
    const x = headerRect.left + headerRect.width / 2;

    const row = el.closest('tr');
    if (!row) return false;
    const cell = Array.from(row.querySelectorAll('td')).find((td) => {
      const rect = td.getBoundingClientRect();
      return rect.width > 0 && x >= rect.left && x <= rect.right;
    });
    if (!cell) return false;
    cell.setAttribute(tag, '1');
    return true;
  }, `${header}|${CELL_TAG}`);
}

/** The label numbers currently in the Uses table, to show in the log when an operation is not found. */
export async function visibleLabels(frame: FrameLocator): Promise<string[]> {
  const texts = await frame.locator('//span[@qtip]').allTextContents().catch(() => [] as string[]);
  return texts.map((t) => t.trim()).filter((t) => /^\d{4}$/.test(t));
}

/** The cell tagged by tagDhtCell. */
export const dhtCell = (frame: FrameLocator) => frame.locator(`[${CELL_TAG}='1']`).first();

/**
 * After the cell has been clicked: the input that opened over it (the numeric editor, aria-valuemin,
 * preferred). The input found is tagged. Returns false when no editor is showing.
 */
export async function tagEditor(cell: Locator): Promise<boolean> {
  return cell.evaluate((td, tag) => {
    const doc = td.ownerDocument;
    doc.querySelectorAll(`[${tag}]`).forEach((n) => n.removeAttribute(tag));
    const box = td.getBoundingClientRect();
    const overlaps = (r: DOMRect) => r.width > 0 && r.height > 0 && r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top;
    const inputs = Array.from(doc.querySelectorAll('input')).filter((i) => i.type !== 'hidden' && overlaps(i.getBoundingClientRect()));
    const editor = inputs.find((i) => i.hasAttribute('aria-valuemin')) ?? inputs[0];
    if (!editor) return false;
    editor.setAttribute(tag, '1');
    return true;
  }, EDITOR_TAG);
}

/** The editor tagged by tagEditor. */
export const dhtEditor = (frame: FrameLocator) => frame.locator(`input[${EDITOR_TAG}='1']`).first();
