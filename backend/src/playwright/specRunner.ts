import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

import { config } from '../config.js';
import type { AutomationProgressEvent, ParsedWorkbook, RowResult } from '../types.js';

// Runs a Playwright Test spec (tests/dht-update.spec.ts) as the app's automation job and streams its
// output to the UI. The spec reads the edited workbook from the JSON file named in WORKBOOK_DATA_PATH
// and appends one line per workbook row to the file named in RESULTS_PATH.

const DEFAULT_SPEC = 'tests/dht-update.spec.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Same result from backend/src/playwright (tsx) and backend/dist/playwright (node).
const backendDir = path.join(__dirname, '..', '..');
const playwrightCli = createRequire(import.meta.url).resolve('@playwright/test/cli');
const envFile = path.join(backendDir, '.env');

function envFileValues(): Record<string, string> {
  if (!fs.existsSync(envFile)) return {};
  const values: Record<string, string> = {};
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return values;
}

export function readResults(resultsPath: string): RowResult[] {
  if (!fs.existsSync(resultsPath)) return [];
  return fs.readFileSync(resultsPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try { return [JSON.parse(line) as RowResult]; } catch { return []; }
    });
}

/**
 * The business outcome of a run, from the per-row results. A run that touched rows but updated
 * none has failed, even though the Playwright process itself may have exited cleanly.
 */
export function summarizeResults(results: RowResult[], expectedRows: number, specFile: string) {
  const count = (status: RowResult['status']) => results.filter((r) => r.status === status).length;
  const updated = count('updated');
  const notInPlm = count('not-in-plm');
  const noDht = count('no-dht');
  const invalid = count('invalid');
  const failed = count('failed');
  const unprocessed = Math.max(0, expectedRows - results.length);
  const problems = failed + invalid + unprocessed;

  const businessStatus = expectedRows > 0 && updated === 0 ? 'failed' : problems > 0 || notInPlm > 0 || noDht > 0 ? 'partial-success' : 'success';
  const detail = [
    notInPlm ? `${notInPlm} operation(s) not in PLM` : '',
    noDht ? `${noDht} operation(s) without a DHT item` : '',
    invalid ? `${invalid} invalid row(s)` : '',
    failed ? `${failed} failed` : '',
    unprocessed ? `${unprocessed} not reached` : ''
  ].filter(Boolean).join(', ');

  const message = businessStatus === 'failed'
    ? `No DHT value was entered${detail ? `: ${detail}` : ''}. See the ROW lines.`
    : businessStatus === 'partial-success'
      ? `${specFile} completed with partial success: ${updated} DHT value(s) entered (${detail}). Nothing was integrated.`
      : `${specFile} passed: ${updated} DHT value(s) entered. Nothing was integrated.`;

  return {
    success: businessStatus !== 'failed',
    message,
    summary: { businessStatus, rowsUpdated: updated, rowsNotInPlm: notInPlm, rowsNoDht: noDht, rowsInvalid: invalid, rowsFailed: failed, rowsNotReached: unprocessed, rowsExpected: expectedRows }
  };
}

/** Rows the spec decided to process (written by the spec before it starts), 0 until then. */
export function readExpectedRows(artifactDir: string): number {
  const expectedPath = path.join(artifactDir, 'expected-rows.txt');
  return fs.existsSync(expectedPath) ? Number(fs.readFileSync(expectedPath, 'utf8')) || 0 : 0;
}

export type RunOptions = {
  maxRows?: number;     // 0 = every row; overrides MAX_ROWS from backend/.env
  workers?: number;     // routings processed side by side; overrides WORKERS from backend/.env
  signal?: AbortSignal; // aborting stops the run
};

export async function runPlaywrightSpec(
  payload: ParsedWorkbook,
  artifactDir: string,
  onProgress?: (event: AutomationProgressEvent) => void,
  options: RunOptions = {}
): Promise<{ success: boolean; message: string; summary: Record<string, unknown>; results: RowResult[] }> {
  const emit = (event: AutomationProgressEvent) => onProgress?.({ ...event, timestamp: new Date().toISOString() });

  fs.mkdirSync(artifactDir, { recursive: true });
  const dataPath = path.join(artifactDir, 'workbook-data.json');
  const resultsPath = path.join(artifactDir, 'results.jsonl');
  fs.writeFileSync(dataPath, JSON.stringify(payload, null, 2));
  fs.rmSync(resultsPath, { force: true });

  emit({ type: 'status', step: 'Excel data read', message: `Parsed ${payload.summary.totalRows} rows across ${payload.summary.totalSheets} sheet(s).` });

  const fromFile = envFileValues();
  const SPEC_FILE = process.env.PLAYWRIGHT_SPEC || fromFile.PLAYWRIGHT_SPEC || DEFAULT_SPEC;
  const specEnv: NodeJS.ProcessEnv = {
    ...fromFile,
    ...process.env,
    WORKBOOK_DATA_PATH: dataPath,
    RESULTS_PATH: resultsPath,
    ARTIFACT_DIR: artifactDir,
    FORCE_COLOR: '0'
  };
  if (options.maxRows !== undefined) specEnv.MAX_ROWS = String(options.maxRows);
  if (options.workers !== undefined) specEnv.WORKERS = String(options.workers);

  emit({ type: 'status', step: 'Sign-in', message: 'Sign in to PLM in the browser window when it opens.' });
  emit({ type: 'status', step: 'Playwright test started', message: `Running ${SPEC_FILE}` });

  const child = spawn(
    process.execPath,
    [playwrightCli, 'test', SPEC_FILE, '--reporter=list', `--output=${path.join(artifactDir, 'test-results')}`],
    { cwd: backendDir, env: specEnv }
  );

  const onData = (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      const text = line.trim();
      if (!text) continue;
      const bad = /\berror\b|\bfailed\b|✘/i.test(text) && !/\b0 (failed|errors?)\b/i.test(text);
      emit({ type: bad ? 'error' : 'log', step: 'Playwright', message: text });
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  const killRun = () => {
    if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    else child.kill('SIGTERM');
  };
  const timer = setTimeout(() => {
    emit({ type: 'error', step: 'Timeout', message: `Stopped after ${config.automationTimeoutMs / 1000}s` });
    killRun();
  }, config.automationTimeoutMs);
  options.signal?.addEventListener('abort', killRun, { once: true });

  const exitCode = await new Promise<number>((resolve) => {
    child.on('error', (error) => {
      emit({ type: 'error', step: 'Playwright', message: error.message });
      resolve(1);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
  clearTimeout(timer);

  const expectedRows = readExpectedRows(artifactDir);
  const results = readResults(resultsPath);
  const business = summarizeResults(results, expectedRows, SPEC_FILE);
  const success = exitCode === 0 && business.success;
  const message = exitCode === 0 ? business.message : `${SPEC_FILE} failed (exit code ${exitCode}). ${business.message}`;
  emit({ type: success ? 'status' : 'error', step: 'Test finished', message });

  return { success, message, results, summary: { spec: SPEC_FILE, exitCode, fileName: payload.fileName, ...business.summary } };
}
