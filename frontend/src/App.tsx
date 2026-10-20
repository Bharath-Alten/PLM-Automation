import { useEffect, useMemo, useRef, useState } from 'react';

import type { JobStatus, ParsedWorkbook, RowResult } from './types';

const DHT_COLUMN_INDEX = 4; // column E
const MAX_SHOWN_ROWS = 400; // the table is for checking; every row is still sent

const plain = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

const STATUS_LABEL: Record<RowResult['status'], string> = {
  updated: 'DHT entered',
  'not-in-plm': 'Not in PLM (skipped)',
  invalid: 'Invalid row',
  failed: 'Failed'
};

export default function App() {
  const [data, setData] = useState<ParsedWorkbook | null>(null);
  const [sheet, setSheet] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<JobStatus | null>(null);
  const logEnd = useRef<HTMLDivElement>(null);

  const rows = data?.sheets[sheet] ?? [];
  const columns = useMemo(() => Object.keys(rows[0] ?? {}).filter((key) => key !== '__row'), [rows]);
  const running = job?.status === 'queued' || job?.status === 'running';

  async function importFile(file: File) {
    setError('');
    setJob(null);
    const body = new FormData();
    body.append('file', file);
    const response = await fetch('/api/upload', { method: 'POST', body });
    const json = await response.json();
    if (!response.ok) return setError(json.error ?? 'Upload failed');
    setData(json);
    // Start on the sheet that holds the plan data (a routing column and an operation column).
    const planSheet = (json.sheetNames as string[]).find((name) => {
      const headers = Object.keys(json.sheets[name][0] ?? {}).map(plain);
      return headers.some((h) => /^(routing|gamma|gamme|gammes|routine)/.test(h)) && headers.some((h) => /^(op|operation)/.test(h));
    });
    setSheet(planSheet ?? json.sheetNames[0] ?? '');
  }

  function editCell(rowIndex: number, key: string, value: string) {
    setData((current) => {
      if (!current) return current;
      const next = current.sheets[sheet].map((row, i) => (i === rowIndex ? { ...row, [key]: value } : row));
      return { ...current, sheets: { ...current.sheets, [sheet]: next } };
    });
  }

  async function run() {
    if (!data) return;
    setError('');
    setBusy(true);
    // The spec reads the first sheet; put the one shown first so the screen and the run agree.
    const sheetNames = [sheet, ...data.sheetNames.filter((name) => name !== sheet)];
    const response = await fetch('/api/automation/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: data.fileName, parsedData: { ...data, sheetNames } })
    });
    const json = await response.json();
    setBusy(false);
    if (!response.ok) return setError(json.error ?? 'Could not start the run');
    setJob({ jobId: json.jobId, status: 'queued', logs: [] });
  }

  useEffect(() => {
    if (!job || !running) return;
    const timer = setInterval(async () => {
      const response = await fetch(`/api/automation/status/${job.jobId}`);
      if (response.ok) setJob(await response.json());
    }, 2000);
    return () => clearInterval(timer);
  }, [job?.jobId, running]);

  useEffect(() => logEnd.current?.scrollIntoView({ block: 'end' }), [job?.logs.length]);

  const counts = useMemo(() => {
    const tally = { updated: 0, 'not-in-plm': 0, invalid: 0, failed: 0 };
    job?.rows?.forEach((row) => (tally[row.status] += 1));
    return tally;
  }, [job?.rows]);

  return (
    <div className="app">
      <header>
        <h1>PLM Automation</h1>
        <p>Fill the DHT field of each operation in Windchill from the column E of your file.</p>
      </header>

      <div className="notice">
        <strong>Nothing is integrated.</strong> The run fills and checks the DHT fields, then stops before
        <em> Integrate</em> until the clarification with Airbus Atlantic is done.
      </div>

      <section className="card">
        <h2>1. Import</h2>
        <input type="file" accept=".xlsx" disabled={running} onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
        {error && <p className="error">{error}</p>}
        {data && (
          <p className="muted">
            {data.fileName} — {data.summary.totalRows} row(s).{' '}
            {data.sheetNames.length > 1 && (
              <select value={sheet} onChange={(e) => setSheet(e.target.value)} disabled={running}>
                {data.sheetNames.map((name) => <option key={name}>{name}</option>)}
              </select>
            )}
          </p>
        )}
      </section>

      {data && (
        <section className="card">
          <h2>2. Check the data</h2>
          <p className="muted">
            Column E (highlighted) is what goes into DHT. Edit a cell if needed.
            {rows.length > MAX_SHOWN_ROWS && ` Showing the first ${MAX_SHOWN_ROWS} of ${rows.length} rows; all of them are processed.`}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  {columns.map((key, i) => (
                    <th key={key} className={i === DHT_COLUMN_INDEX ? 'dht' : ''}>
                      {key}{i === DHT_COLUMN_INDEX ? ' → DHT' : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, MAX_SHOWN_ROWS).map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    <td className="muted">{String(row.__row ?? rowIndex + 2)}</td>
                    {columns.map((key, i) => (
                      <td key={key} className={i === DHT_COLUMN_INDEX ? 'dht' : ''}>
                        <input
                          value={row[key] === null ? '' : String(row[key])}
                          disabled={running}
                          onChange={(e) => editCell(rowIndex, key, e.target.value)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {data && (
        <section className="card">
          <h2>3. Run</h2>
          <button onClick={run} disabled={busy || running}>{running ? 'Running…' : 'Run automation'}</button>
          <span className="muted"> Sign in to PLM in the browser window that opens.</span>

          {job && (
            <>
              {job.result && (
                <p className={job.result.success ? 'ok' : 'error'}>{job.result.message}</p>
              )}
              {job.rows && job.rows.length > 0 && (
                <>
                  <p className="muted">
                    {counts.updated} entered · {counts['not-in-plm']} not in PLM · {counts.invalid} invalid · {counts.failed} failed
                    {job.artifacts?.report && <> · <a href={job.artifacts.report}>Download report</a></>}
                  </p>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Row</th><th>Routing</th><th>OP</th><th>DHT</th><th>Result</th><th>Message</th></tr></thead>
                      <tbody>
                        {job.rows.map((row, i) => (
                          <tr key={i} className={`s-${row.status}`}>
                            <td>{row.row}</td><td>{row.routing}</td><td>{row.operation}</td><td>{row.dht}</td>
                            <td>{STATUS_LABEL[row.status]}</td><td>{row.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              <div className="log">
                {job.logs.map((event, i) => (
                  <div key={i} className={event.type === 'error' ? 'log-error' : ''}>
                    {event.timestamp?.slice(11, 19)} {event.step ? `[${event.step}] ` : ''}{event.message}
                  </div>
                ))}
                <div ref={logEnd} />
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
