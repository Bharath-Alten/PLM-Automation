export type Cell = string | number | boolean | null;
export type SheetRow = Record<string, Cell>;

export type ParsedWorkbook = {
  fileName: string;
  sheetNames: string[];
  sheets: Record<string, SheetRow[]>;
  summary: { totalRows: number; totalSheets: number; sheetCounts: Record<string, number> };
};

export type LogEvent = { type: 'status' | 'log' | 'error' | 'result'; step?: string; message?: string; timestamp?: string };

export type RowResult = {
  row: number;
  routing: string;
  operation: string;
  dht: string;
  status: 'updated' | 'not-in-plm' | 'invalid' | 'failed';
  message: string;
};

export type JobStatus = {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  logs: LogEvent[];
  rows?: RowResult[];
  result?: { success: boolean; message: string; summary: Record<string, unknown> };
  artifacts?: Record<string, string>;
};
