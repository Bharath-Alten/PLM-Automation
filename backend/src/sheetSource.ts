import fs from 'fs';
import path from 'path';

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

/** Downloads the document as .xlsx into `dir` and returns the file path. */
export async function downloadSheet(link: string, dir: string): Promise<{ filePath: string; fileName: string }> {
  const { origin, id } = parseSheetLink(link);
  // A native Google Sheet exports directly; an Excel file stored in Drive (link has rtpof=true) downloads as is.
  const candidates = [
    `${origin}/spreadsheets/d/${id}/export?format=xlsx`,
    `${origin.replace(/^https:\/\/docs\./, 'https://drive.')}/uc?export=download&id=${id}`
  ];

  let lastReason = '';
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (response.ok && isXlsx(bytes)) {
        fs.mkdirSync(dir, { recursive: true });
        const fileName = `google-sheet-${id.slice(0, 8)}.xlsx`;
        const filePath = path.join(dir, `${Date.now()}-${fileName}`);
        fs.writeFileSync(filePath, bytes);
        return { filePath, fileName };
      }
      lastReason = response.ok
        ? 'Google returned a web page instead of the file (the link is probably not shared, or asks to sign in).'
        : `Google answered ${response.status}.`;
    } catch (error) {
      lastReason = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`The sheet could not be downloaded. ${lastReason} Share it as "Anyone with the link can view" and try again.`);
}
