import type { Cell, SheetRow } from './types';

// What the run will do with a sheet, worked out on screen with the same rules as the server
// (backend/tests/plmData.ts): column E is the DHT value, the routing is written once per group
// and inherited by the blank lines below it, headers are matched ignoring case and accents.

export const DHT_COLUMN_INDEX = 4; // column E

const plain = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

const ROUTING = ['routing', 'routingnumber', 'routine', 'routinenumber', 'gamma', 'gamme', 'gammes', 'gammenumber', 'processplan'];
const OPERATION = ['op', 'opnumber', 'operation', 'operationnumber', 'opno', 'opnum', 'operationno'];

export type PlanRow = {
  index: number;          // position in the sheet's rows, to edit the right cell
  sheetRow: number;       // worksheet row number, as in the report
  routing: string;
  operation: string;
  paddedOperation: string;
  description: string;
  dht: string;
  problem?: string;
};

export type Plan = {
  keys: { routing?: string; operation?: string; dht?: string; description?: string };
  rows: PlanRow[];
  routings: number;
  ready: number;
  problems: number;
  error?: string;
};

const text = (value: Cell | undefined) => (value === null || value === undefined ? '' : String(value).trim());
const dataKeys = (rows: SheetRow[]) => Object.keys(rows[0] ?? {}).filter((key) => key !== '__row');

/** True when the sheet has a routing and an operation column, i.e. it holds the plan data. */
export function isPlanSheet(rows: SheetRow[]): boolean {
  const keys = dataKeys(rows).map(plain);
  return keys.some((key) => ROUTING.includes(key)) && keys.some((key) => OPERATION.includes(key));
}

export function padOperation(operation: string): string {
  return operation.trim().replace(/\.0+$/, '').padStart(4, '0');
}

export function buildPlan(rows: SheetRow[]): Plan {
  const keys = dataKeys(rows);
  const find = (aliases: string[]) => keys.find((key) => aliases.includes(plain(key)));
  const routingKey = find(ROUTING);
  const operationKey = find(OPERATION);
  const dhtKey = keys[DHT_COLUMN_INDEX];
  const descriptionKey = keys.find((key) => /desig|desc|libel/.test(plain(key))) ?? keys[2];
  const empty: Plan = { keys: {}, rows: [], routings: 0, ready: 0, problems: 0 };

  if (!rows.length) return { ...empty, error: 'This sheet is empty.' };
  if (!routingKey || !operationKey) {
    return { ...empty, error: 'No routing / operation columns found. Pick another sheet, or name the headers "Routing" (or Gamme) and "OP" (or Opération).' };
  }
  if (!dhtKey) return { ...empty, error: 'The sheet has fewer than 5 columns, so there is no column E for DHT.' };

  let current = '';
  const planRows: PlanRow[] = [];
  rows.forEach((row, index) => {
    const own = text(row[routingKey]);
    if (own) current = own;
    const operation = text(row[operationKey]);
    const dht = text(row[dhtKey]);
    if (!operation && !dht) return; // blank line or routing title line
    const problem = !current ? 'Routing is empty' : !operation ? 'Operation number is empty' : !dht ? 'DHT value is empty' : undefined;
    planRows.push({
      index,
      sheetRow: typeof row.__row === 'number' ? row.__row : index + 2,
      routing: current,
      operation,
      paddedOperation: operation ? padOperation(operation) : '',
      description: descriptionKey ? text(row[descriptionKey]) : '',
      dht,
      problem
    });
  });

  const problems = planRows.filter((row) => row.problem).length;
  return {
    keys: { routing: routingKey, operation: operationKey, dht: dhtKey, description: descriptionKey },
    rows: planRows,
    routings: new Set(planRows.filter((row) => row.routing).map((row) => row.routing)).size,
    ready: planRows.length - problems,
    problems
  };
}
