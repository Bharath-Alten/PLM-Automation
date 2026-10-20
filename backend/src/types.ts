export type SheetRow = Record<string, string | number | boolean | null>;

export type ParsedWorkbook = {
  fileName: string;
  sheetNames: string[];
  sheets: Record<string, SheetRow[]>;
  summary: {
    totalRows: number;
    totalSheets: number;
    sheetCounts: Record<string, number>;
  };
};

export type AutomationProgressEvent = {
  type: 'status' | 'log' | 'error' | 'result';
  step?: string;
  message?: string;
  timestamp?: string;
  success?: boolean;
  data?: Record<string, unknown>;
};

// One line of results.jsonl: what happened to one workbook row.
export type RowStatus = 'updated' | 'not-in-plm' | 'invalid' | 'failed';

export type RowResult = {
  row: number;
  routing: string;
  operation: string;
  dht: string;
  status: RowStatus;
  message: string;
};
