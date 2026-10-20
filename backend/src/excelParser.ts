import fs from 'fs';
import * as XLSX from 'xlsx';

import type { ParsedWorkbook, SheetRow } from './types.js';

// First row = headers, the rest = data. Blank headers become C1, C2, ... so no column is lost,
// and key order follows the worksheet, which is how "column E" is found later (5th key).
function normalizeSheetRows(rows: unknown[][]): SheetRow[] {
  if (!rows.length) return [];
  const headers = (rows[0] ?? []).map((cell, i) => {
    const raw = String(cell ?? '').replace(/\s+/g, ' ').trim();
    return raw === '' ? `C${i + 1}` : raw;
  });

  return rows.slice(1).map((row, rowIndex) => {
    const normalized: SheetRow = { __row: rowIndex + 2 }; // worksheet row number (1-based, header is row 1)
    headers.forEach((key, index) => {
      const value = row[index];
      normalized[key] = value === undefined || value === null || value === ''
        ? null
        : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : String(value);
    });
    return normalized;
  });
}

export function parseWorkbook(filePath: string, fileName: string): ParsedWorkbook {
  const workbook = XLSX.read(fs.readFileSync(filePath), { type: 'buffer' });
  const sheets: Record<string, SheetRow[]> = {};
  const sheetCounts: Record<string, number> = {};

  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1, raw: false, blankrows: false, defval: ''
    }) as unknown[][];
    sheets[sheetName] = normalizeSheetRows(rows);
    sheetCounts[sheetName] = sheets[sheetName].length;
  }

  return {
    fileName,
    sheetNames: workbook.SheetNames,
    sheets,
    summary: {
      totalRows: Object.values(sheetCounts).reduce((sum, count) => sum + count, 0),
      totalSheets: workbook.SheetNames.length,
      sheetCounts
    }
  };
}
