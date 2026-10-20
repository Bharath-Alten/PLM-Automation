// Pure helpers for the PLM spec, kept apart from Playwright so they can be unit-tested offline.

/** "10" -> "0010", 10 -> "0010", "10.0" -> "0010": the UI shows operation numbers on 4 digits. */
export function padOperation(operation: string | number): string {
  const text = String(operation).trim().replace(/\.0+$/, '');
  return text.padStart(4, '0');
}

/** Compares what was typed with what the field now holds, tolerating "12.50" vs "12.5" and "12,5" vs "12.5". */
export function sameValue(expected: string, actual: string): boolean {
  const a = expected.trim();
  const b = actual.trim();
  if (a === b) return true;
  const num = (text: string) => (/^-?\d+([.,]\d+)?$/.test(text) ? Number(text.replace(',', '.')) : NaN);
  return !Number.isNaN(num(a)) && num(a) === num(b);
}

// "A.3", "B.12" ... : revision letter(s), then iteration.
const VERSION = /\b([A-Z]{1,2})\.(\d+)\b/;

function versionRank(text: string): number {
  const match = text.match(VERSION);
  if (!match) return -1;
  const letters = match[1].split('').reduce((sum, ch) => sum * 26 + (ch.charCodeAt(0) - 64), 0);
  return letters * 100000 + Number(match[2]);
}

/**
 * Index of the search-result row to open: among the rows that mention the routing number, the one with
 * the highest version (A.1 < A.2 < B.1). Rows without a version label rank lowest, and the first row wins a tie.
 * Returns -1 when no row mentions the routing.
 */
export function pickLatestVersion(rowTexts: string[], routing: string): number {
  // Whole token only: "GAM-100" must not match the row of "GAM-1000".
  const escaped = routing.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wanted = new RegExp(`(^|[^A-Za-z0-9_-])${escaped}($|[^A-Za-z0-9_-])`, 'i');
  let best = -1;
  let bestRank = -2;
  rowTexts.forEach((text, index) => {
    if (!wanted.test(text)) return;
    const rank = versionRank(text);
    if (rank > bestRank) {
      best = index;
      bestRank = rank;
    }
  });
  return best;
}
