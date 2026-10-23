import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';

import { padOperation } from './operations';

// Workbook values for the spec. A run from the app passes the edited sheets in WORKBOOK_DATA_PATH;
// a run from the terminal falls back to inputs/inputData.xlsx, like the previous project did.

type Cell = string | number | boolean | null;
export type SheetRow = Record<string, Cell>;

export type PlmRow = {
  row: number;        // worksheet row number, for messages
  routing: string;
  operation: string;  // as typed in the file
  paddedOperation: string;
  dht: string;
  problem?: string;   // set when the row cannot be processed
};

// Case-, accent- and punctuation-insensitive: "Opération" -> "operation".
const norm = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

const ROUTING_ALIASES = ['routing', 'routingnumber', 'routine', 'routinenumber', 'gamma', 'gamme', 'gammes', 'gammenumber', 'processplan'];
// An operation number is digits (10, 0010, "10.0"); anything else in that column ("Total :") is not an operation.
const OPERATION_NUMBER = /^\d{1,4}(\.0+)?$/;
const OPERATION_ALIASES =['op', 'opnumber', 'operation', 'operationnumber', 'opno', 'opnum', 'operationno'];

function dataKeys(rows: SheetRow[]) {
  return Object.keys(rows[0] ?? {}).filter((key) => key !== '__row');
}

/** "E" -> 4, "AA" -> 26. */
export function columnIndex(letter: string): number {
  return letter.trim().toUpperCase().split('').reduce((sum, ch) => sum * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
}

/**
 * Which key of the rows holds a value. `override` (an env setting) is a column letter ("B") or a header
 * name; otherwise the header must match one of the aliases ignoring case, spacing and punctuation.
 */
function findKey(rows: SheetRow[], aliases: string[], override: string | undefined): string | undefined {
  const keys = dataKeys(rows);
  if (override) {
    const byName = keys.find((key) => norm(key) === norm(override));
    if (byName) return byName;
    if (/^[A-Za-z]{1,2}$/.test(override.trim())) return keys[columnIndex(override)];
    return undefined;
  }
  return keys.find((key) => aliases.includes(norm(key)));
}

const text = (value: Cell | undefined) => (value === null || value === undefined ? '' : String(value).trim());

/**
 * Turns sheet rows into PLM rows. The DHT value always comes from column E (DHT_COLUMN changes it);
 * routing and operation are found by header name (ROUTING_COLUMN / OP_COLUMN change that).
 */
export function toPlmRows(rows: SheetRow[], env: Record<string, string | undefined> = process.env): PlmRow[] {
  if (!rows.length) return [];
  const keys = dataKeys(rows);
  const routingKey = findKey(rows, ROUTING_ALIASES, env.ROUTING_COLUMN);
  const operationKey = findKey(rows, OPERATION_ALIASES, env.OP_COLUMN);
  const dhtKey = keys[columnIndex(env.DHT_COLUMN || 'E')];

  if (!routingKey) throw new Error(`Routing column not found. Name the header "Routing" (or Gamma/Routine), or set ROUTING_COLUMN. Headers: ${keys.join(', ')}`);
  if (!operationKey) throw new Error(`Operation column not found. Name the header "OP" (or Operation), or set OP_COLUMN. Headers: ${keys.join(', ')}`);
  if (!dhtKey) throw new Error(`DHT column ${env.DHT_COLUMN || 'E'} does not exist in the file. Headers: ${keys.join(', ')}`);

  // The routing is written once, on the first line of its group; the lines below it are blank.
  let currentRouting = '';
  return rows.flatMap((sheetRow, index) => {
    const ownRouting = text(sheetRow[routingKey]);
    if (ownRouting) currentRouting = ownRouting;
    const routing = currentRouting;
    const operation = text(sheetRow[operationKey]);
    const dht = text(sheetRow[dhtKey]);
    if (!operation && !dht) return []; // blank line, or a routing title line with no operation
    if (operation && !OPERATION_NUMBER.test(operation)) return []; // "Total :" and other lines that are not operations
    const row = typeof sheetRow.__row === 'number' ? sheetRow.__row : index + 2;
    const problem = !routing ? 'Routing is empty'
      : !operation ? 'Operation Number Empty'
      : !dht ? `DHT value is empty (column ${env.DHT_COLUMN || 'E'})`
      : undefined;
    return [{ row, routing, operation, paddedOperation: operation ? padOperation(operation) : '', dht, problem }];
  });
}

/** True when the rows have both a routing and an operation column (the sheet that holds the plan data). */
export function hasPlanColumns(rows: SheetRow[]): boolean {
  const keys = dataKeys(rows).map(norm);
  return keys.some((key) => ROUTING_ALIASES.includes(key)) && keys.some((key) => OPERATION_ALIASES.includes(key));
}

/** Sheet to read: SHEET_NAME if set, else the first sheet that has routing and operation columns, else the first. */
export function pickSheet(sheets: Record<string, SheetRow[]>, sheetNames: string[], wanted = process.env.SHEET_NAME): string {
  if (wanted) {
    const found = sheetNames.find((name) => name.trim().toLowerCase() === wanted.trim().toLowerCase());
    if (!found) throw new Error(`Sheet "${wanted}" not found. Sheets: ${sheetNames.join(', ')}`);
    return found;
  }
  return sheetNames.find((name) => hasPlanColumns(sheets[name] ?? [])) ?? sheetNames[0];
}

/** Rows to process, in file order. */
export function loadPlmRows(): PlmRow[] {
  const dataPath = process.env.WORKBOOK_DATA_PATH;
  let rows: SheetRow[];
  if (dataPath) {
    const workbook = JSON.parse(fs.readFileSync(dataPath, 'utf8').replace(/^﻿/, '')) as { sheetNames: string[]; sheets: Record<string, SheetRow[]> };
    rows = workbook.sheets[pickSheet(workbook.sheets, workbook.sheetNames)] ?? [];
  } else {
    // XLSX.readFile is not available when xlsx is imported as an ES module: read the bytes ourselves.
    const inputPath = process.env.INPUT_FILE || 'inputs/inputData.xlsx';
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Input file not found: ${path.resolve(inputPath)}. Put your .xlsx there (or set INPUT_FILE), or run from the app with "npm start".`);
    }
    const wb = XLSX.read(fs.readFileSync(inputPath), { type: 'buffer' });
    const sheets: Record<string, SheetRow[]> = {};
    for (const name of wb.SheetNames) {
      const matrix = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, blankrows: false, defval: '' }) as unknown[][];
      const headers = (matrix[0] ?? []).map((cell, i) => String(cell ?? '').trim() || `C${i + 1}`);
      sheets[name] = matrix.slice(1).map((line, i) => Object.fromEntries([
        ['__row', i + 2],
        ...headers.map((h, c) => [h, line[c] === '' || line[c] === undefined ? null : (line[c] as Cell)])
      ]));
    }
    rows = sheets[pickSheet(sheets, wb.SheetNames)];
  }
  const limit = Number(process.env.MAX_ROWS || 0);
  const all = toPlmRows(rows);
  return limit > 0 ? all.slice(0, limit) : all;
}

/** Rows grouped by routing, keeping file order, so each routing is opened once. */
export function groupByRouting(rows: PlmRow[]): Map<string, PlmRow[]> {
  const groups = new Map<string, PlmRow[]>();
  for (const row of rows) {
    const key = row.routing || `(row ${row.row}: no routing)`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}
