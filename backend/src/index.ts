import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';

import * as XLSX from 'xlsx';

import { config } from './config.js';
import { parseWorkbook } from './excelParser.js';
import { runPlaywrightSpec } from './playwright/specRunner.js';
import type { AutomationProgressEvent, ParsedWorkbook, RowResult } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

const uploadDir = path.join(__dirname, '..', config.uploadDir);
fs.mkdirSync(uploadDir, { recursive: true });

// Built React app (frontend/dist). Resolves the same from backend/src (tsx) and backend/dist (node).
const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
const frontendIndex = path.join(frontendDist, 'index.html');

// Keeps only safe characters, so a file name can never point outside its folder.
const safeFileName = (name: string) => name.replace(/[^a-zA-Z0-9.\-_]/g, '_');

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${safeFileName(file.originalname)}`)
  }),
  limits: { fileSize: config.maxUploadBytes },
  fileFilter: (_req, file, cb) => {
    if (!/\.xlsx$/i.test(file.originalname)) return cb(new Error('Only .xlsx files are accepted'));
    cb(null, true);
  }
});

type Job = {
  status: 'queued' | 'running' | 'completed' | 'failed';
  startTime?: string;
  endTime?: string;
  logs: AutomationProgressEvent[];
  result?: { success: boolean; message: string; summary: Record<string, unknown> };
  rows?: RowResult[];
  artifacts?: Record<string, string>;
};

const jobs = new Map<string, Job>();
// Jobs live in memory only; keep the most recent ones so a long-running server does not grow forever.
const MAX_JOBS = 50;

function forgetOldJobs() {
  for (const [jobId, job] of jobs) {
    if (jobs.size <= MAX_JOBS) break;
    if (job.status === 'completed' || job.status === 'failed') jobs.delete(jobId);
  }
}

/** Writes the parsed (possibly edited) sheets back to an .xlsx file. */
function writeWorkbook(data: ParsedWorkbook, outPath: string) {
  const wb = XLSX.utils.book_new();
  for (const sheetName of data.sheetNames) {
    const rows = (data.sheets[sheetName] ?? []).map(({ __row, ...cells }) => cells);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheetName.substring(0, 31));
  }
  XLSX.writeFile(wb, outPath);
}

/** The per-row outcome of a run as a workbook (the "Error Message" report of the old flow). */
function writeReport(rows: RowResult[], outPath: string) {
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows.map((r) => ({
    Row: r.row, Routing: r.routing, OP: r.operation, DHT: r.dht, Status: r.status, Message: r.message
  })));
  XLSX.utils.book_append_sheet(wb, sheet, 'Report');
  XLSX.writeFile(wb, outPath);
}

app.use(cors({ origin: config.frontendUrl, credentials: true }));
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', app: config.appName });
});

app.post('/api/upload', (req, res) => {
  upload.single('file')(req as any, res as any, (err: any) => {
    if (err) return res.status(400).json({ error: err.message || 'Invalid upload' });
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
      return res.json(parseWorkbook(req.file.path, req.file.originalname));
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to parse uploaded file' });
    }
  });
});

app.post('/api/automation/run', (req, res) => {
  const payload = req.body as { fileName?: string; parsedData?: ParsedWorkbook };
  if (!payload.parsedData?.sheetNames?.length) {
    return res.status(400).json({ error: 'No workbook data. Import a file first.' });
  }
  const data = payload.parsedData;

  if ([...jobs.values()].some((job) => job.status === 'queued' || job.status === 'running')) {
    return res.status(409).json({ error: 'A run is already in progress. PLM allows one run at a time.' });
  }

  const jobId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  forgetOldJobs();
  const job: Job = { status: 'queued', startTime: new Date().toISOString(), logs: [] };
  jobs.set(jobId, job);

  void (async () => {
    job.status = 'running';
    job.logs.push({ type: 'status', step: 'Playwright started', message: 'Automation queued and waiting to start.', timestamp: new Date().toISOString() });

    const jobArtifactDir = path.join(uploadDir, 'artifacts', jobId);
    fs.mkdirSync(jobArtifactDir, { recursive: true });
    job.artifacts = {};

    try {
      const snapshotPath = path.join(jobArtifactDir, `${jobId}-snapshot.xlsx`);
      writeWorkbook(data, snapshotPath);
      job.artifacts.snapshot = `/api/automation/artifact/${jobId}/${path.basename(snapshotPath)}`;
    } catch (e) {
      job.logs.push({ type: 'error', step: 'Snapshot failed', message: (e as Error).message, timestamp: new Date().toISOString() });
    }

    try {
      const result = await runPlaywrightSpec(data, jobArtifactDir, (event) => job.logs.push(event));
      job.result = { success: result.success, message: result.message, summary: result.summary };
      job.rows = result.results;
      if (result.results.length) {
        const reportPath = path.join(jobArtifactDir, `${jobId}-report.xlsx`);
        writeReport(result.results, reportPath);
        job.artifacts.report = `/api/automation/artifact/${jobId}/${path.basename(reportPath)}`;
      }
      job.status = result.success ? 'completed' : 'failed';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown automation error';
      job.status = 'failed';
      job.logs.push({ type: 'error', step: 'Automation failed', message, timestamp: new Date().toISOString() });
      job.result = { success: false, message, summary: { error: message } };
    }
    job.endTime = new Date().toISOString();
  })();

  return res.json({ jobId, status: 'queued' });
});

app.get('/api/automation/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  return res.json({
    jobId: req.params.jobId,
    status: job.status,
    logs: job.logs,
    result: job.result,
    rows: job.rows,
    artifacts: job.artifacts,
    startedAt: job.startTime,
    completedAt: job.endTime
  });
});

app.get('/api/automation/artifact/:jobId/:fileName', (req, res) => {
  const { jobId, fileName } = req.params;
  // Only files of a known job, and never a path that climbs out of its folder.
  if (!jobs.has(jobId) || fileName !== path.basename(fileName)) {
    return res.status(404).json({ error: 'Artifact not found.' });
  }
  const filePath = path.join(uploadDir, 'artifacts', jobId, fileName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Artifact not found.' });
  return res.sendFile(filePath);
});

// Unknown API routes return JSON rather than the UI.
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API route not found.' });
});

if (fs.existsSync(frontendIndex)) {
  app.use(express.static(frontendDist));
  app.get('*', (_req, res) => res.sendFile(frontendIndex));
}

function openBrowser(url: string) {
  const command = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(command, (error) => {
    if (error) console.log(`Open ${url} in your browser.`);
  });
}

app.listen(config.port, config.host, () => {
  const url = `http://localhost:${config.port}`;
  console.log(`${config.appName} listening on ${url}`);
  if (fs.existsSync(frontendIndex)) {
    if (process.argv.includes('--open')) openBrowser(url);
  } else {
    console.log('UI build not found (frontend/dist). Run "npm start" from the project root, or "npm run dev" for development.');
  }
});
