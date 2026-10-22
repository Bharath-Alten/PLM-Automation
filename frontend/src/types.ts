export type Cell = string | number | boolean | null;
export type SheetRow = Record<string, Cell>;

export type ParsedWorkbook = {
  fileName: string;
  sheetNames: string[];
  sheets: Record<string, SheetRow[]>;
  summary: { totalRows: number; totalSheets: number; sheetCounts: Record<string, number> };
};

export type LogEvent = { type: 'status' | 'log' | 'error' | 'result'; step?: string; message?: string; timestamp?: string };

export type RowStatus = 'updated' | 'not-in-plm' | 'invalid' | 'failed';

export type RowResult = {
  row: number;
  routing: string;
  operation: string;
  dht: string;
  status: RowStatus;
  message: string;
};

export type JobStatus = {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  logs: LogEvent[];
  rows?: RowResult[];
  progress?: { done: number; total: number };
  options?: { maxRows: number; workers: number };
  result?: { success: boolean; message: string; summary: Record<string, unknown> };
  artifacts?: Record<string, string>;
  startedAt?: string;
  completedAt?: string;
};
