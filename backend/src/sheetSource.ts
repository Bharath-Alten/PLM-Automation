import fs from 'fs';
import path from 'path';
import { chromium } from '@playwright/test';

// Reads the input workbook from a Google Sheets / Drive link instead of an uploaded file.
// The link may go through the company proxy (docs.google.com.rproxy.goskope.com): its host is kept,
// so the download goes the same way the browser reached it.

const ALLOWED_HOST = /^(docs|drive)\.google\.com(\.rproxy\.goskope\.com)?$/i;

export type SheetLink = { origin: string; id: string };

export function parseSheetLink(link: string): SheetLink {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw new Error('This is not a valid link.');
  }
  if (url.protocol !== 'https:' || !ALLOWED_HOST.test(url.hostname)) {
    throw new Error('Only Google Sheets / Drive links (docs.google.com) are accepted.');
  }
  const id = url.pathname.match(/\/d\/([a-zA-Z0-9_-]{10,})/)?.[1] ?? url.searchParams.get('id');
  if (!id) throw new Error('No document id found in the link (expected .../spreadsheets/d/<id>/...).');
  return { origin: url.origin, id };
}

// An .xlsx is a zip file: it starts with "PK". A sign-in or "no access" page is HTML.
const isXlsx = (bytes: Buffer) => bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;

function exportUrls({ origin, id }: SheetLink): string[] {
  // A native Google Sheet exports directly; an Excel file stored in Drive (link has rtpof=true) downloads as is.
  return [
    `${origin}/spreadsheets/d/${id}/export?format=xlsx`,
    `${origin.replace(/^https:\/\/docs\./, 'https://drive.')}/uc?export=download&id=${id}`
  ];
}

function save(bytes: Buffer, { id }: SheetLink, dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `google-sheet-${id.slice(0, 8)}.xlsx`;
  const filePath = path.join(dir, `${Date.now()}-${fileName}`);
  fs.writeFileSync(filePath, bytes);
  return { filePath, fileName };
}

const SIGN_IN_WAIT_MS = Number(process.env.GOOGLE_SIGN_IN_WAIT_MS || 300_000);

/**
 * The sheet is private: open the link in a browser window, let the person sign in there, and download
 * with that session. The credentials are typed in the browser only; the app never sees them.
 */
async function downloadWithSignIn(link: SheetLink, openUrl: string, dir: string) {
  const browser = await chromium.launch({ headless: false, channel: process.env.BROWSER_CHANNEL || undefined });
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.goto(openUrl, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    const deadline = Date.now() + SIGN_IN_WAIT_MS;
    while (Date.now() < deadline) {
      for (const candidate of exportUrls(link)) {
        const response = await context.request.get(candidate, { timeout: 30_000 }).catch(() => undefined);
        const bytes = response?.ok() ? await response.body().catch(() => undefined) : undefined;
        if (bytes && isXlsx(bytes)) return save(bytes, link, dir);
      }
      await page.waitForTimeout(3000); // still on the sign-in page: give the person time
    }
    throw new Error(`Not signed in within ${Math.round(SIGN_IN_WAIT_MS / 60000)} minutes, or the account has no access to this sheet.`);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/** Downloads the document as .xlsx into `dir` and returns the file path. */
export async function downloadSheet(rawLink: string, dir: string): Promise<{ filePath: string; fileName: string }> {
  const link = parseSheetLink(rawLink);

  // 1. Shared with "anyone with the link": a plain download works.
  let lastReason = '';
  for (const candidate of exportUrls(link)) {
    try {
      const response = await fetch(candidate, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (response.ok && isXlsx(bytes)) return save(bytes, link, dir);
      lastReason = response.ok ? 'Google asked to sign in.' : `Google answered ${response.status}.`;
    } catch (error) {
      lastReason = error instanceof Error ? error.message : String(error);
    }
  }

  // 2. Private: a browser window opens, the person signs in, and the download uses that session.
  try {
    return await downloadWithSignIn(link, rawLink.trim(), dir);
  } catch (error) {
    throw new Error(`The sheet could not be downloaded (${lastReason}). ${error instanceof Error ? error.message : String(error)}`);
  }
}
