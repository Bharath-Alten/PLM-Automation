import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Icons, Stepper, StatusBadge } from './components';
import { buildPlan, isPlanSheet, type PlanRow } from './plan';
import type { JobStatus, ParsedWorkbook, RowResult } from './types';

const GROUPS_PER_PAGE = 25;
const STEPS = ['Import', 'Review', 'Run', 'Results'];

const formatElapsed = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

export default function App() {
  const [data, setData] = useState<ParsedWorkbook | null>(null);
  const [sheet, setSheet] = useState('');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'problems'>('all');
  const [groupsShown, setGroupsShown] = useState(GROUPS_PER_PAGE);

  const [scope, setScope] = useState<'test' | 'all'>('test');
  const [testRoutings, setTestRoutings] = useState(2);
  const [workers, setWorkers] = useState(2);

  const [starting, setStarting] = useState(false);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [now, setNow] = useState(Date.now());
  const [logFilter, setLogFilter] = useState<'all' | 'errors'>('all');
  const [copied, setCopied] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const rows = data?.sheets[sheet] ?? [];
  const plan = useMemo(() => buildPlan(rows), [rows]);
  const running = job?.status === 'queued' || job?.status === 'running';
  // A run is made of whole routings: all the operations of each routing it takes.
  const routingOrder = useMemo(() => new Map([...new Set(plan.rows.map((r) => r.routing))].map((name, i) => [name, i])), [plan.rows]);
  const scopeCount = scope === 'test' ? plan.rows.filter((r) => (routingOrder.get(r.routing) ?? 0) < testRoutings).length : plan.rows.length;

  // ---- import -------------------------------------------------------------------------------
  async function importFile(file: File) {
    setError('');
    setJob(null);
    setImporting(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch('/api/upload', { method: 'POST', body });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? 'The file could not be read.');
      const parsed = json as ParsedWorkbook;
      setData(parsed);
      // Start on the sheet that holds the plan data.
      setSheet(parsed.sheetNames.find((name) => isPlanSheet(parsed.sheets[name])) ?? parsed.sheetNames[0] ?? '');
      setQuery('');
      setFilter('all');
      setGroupsShown(GROUPS_PER_PAGE);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The file could not be read.');
    } finally {
      setImporting(false);
    }
  }

  function editDht(row: PlanRow, value: string) {
    const key = plan.keys.dht;
    if (!key) return;
    setData((current) => {
      if (!current) return current;
      const next = current.sheets[sheet].map((r, i) => (i === row.index ? { ...r, [key]: value } : r));
      return { ...current, sheets: { ...current.sheets, [sheet]: next } };
    });
  }

  // ---- run ----------------------------------------------------------------------------------
  async function run() {
    if (!data || starting || running) return;
    if (scope === 'all' && !window.confirm(`Run all ${plan.rows.length} operations on ${plan.routings} routings in PLM?`)) return;
    setError('');
    setStarting(true);
    try {
      // The spec reads the first sheet that has plan columns; put the chosen one first so screen and run agree.
      const sheetNames = [sheet, ...data.sheetNames.filter((name) => name !== sheet)];
      const response = await fetch('/api/automation/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: data.fileName,
          parsedData: { ...data, sheetNames },
          maxRoutings: scope === 'test' ? testRoutings : 0,
          workers
        })
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? 'The run could not be started.');
      setJob({ jobId: json.jobId, status: 'queued', logs: [], startedAt: new Date().toISOString() });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The run could not be started.');
    } finally {
      setStarting(false);
    }
  }

  async function stop() {
    if (!job) return;
    await fetch(`/api/automation/stop/${job.jobId}`, { method: 'POST' }).catch(() => undefined);
  }

  useEffect(() => {
    if (!job || !running) return;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/automation/status/${job.jobId}`);
        if (response.ok) setJob(await response.json());
      } catch {
        // the server is busy: try again at the next tick
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [job?.jobId, running]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [job?.logs.length, logFilter]);

  // ---- derived ------------------------------------------------------------------------------
  const resultBySheetRow = useMemo(() => new Map((job?.rows ?? []).map((r) => [r.row, r])), [job?.rows]);
  const tally = useMemo(() => {
    const t = { updated: 0, 'not-in-plm': 0, 'no-dht': 0, invalid: 0, failed: 0 };
    job?.rows?.forEach((r) => (t[r.status] += 1));
    return t;
  }, [job?.rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return plan.rows.filter((r) => {
      if (filter === 'problems' && !r.problem) return false;
      return !q || `${r.routing} ${r.operation} ${r.description} ${r.dht}`.toLowerCase().includes(q);
    });
  }, [plan.rows, query, filter]);

  const groups = useMemo(() => {
    const map = new Map<string, PlanRow[]>();
    for (const r of visible) map.set(r.routing || '(no routing)', [...(map.get(r.routing || '(no routing)') ?? []), r]);
    return [...map.entries()];
  }, [visible]);

  // Routings beyond this many are left out of the run (0 = none left out): what the last run used, else what is selected.
  const shownLimit = job ? job.options?.maxRoutings ?? 0 : scope === 'test' ? testRoutings : 0;
  const step = !data ? 1 : job ? (running ? 3 : 4) : 2;
  const total = job?.progress?.total || scopeCount;
  const done = job?.progress?.done ?? 0;
  const percent = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const elapsed = job?.startedAt ? (job.completedAt ? new Date(job.completedAt).getTime() : now) - new Date(job.startedAt).getTime() : 0;
  const stopped = job?.result?.summary?.businessStatus === 'stopped';
  const outcome = running ? 'running' : !job ? 'idle' : stopped ? 'stopped' : job.result?.success ? (job.result.summary?.businessStatus === 'partial-success' ? 'partial' : 'success') : 'failed';
  const OUTCOME_TEXT: Record<string, string> = { idle: 'Ready', running: 'Running', stopped: 'Stopped', partial: 'Finished with skips', success: 'Finished', failed: 'Failed' };

  const issues: RowResult[] = (job?.rows ?? []).filter((r) => r.status !== 'updated');
  const logLines = (job?.logs ?? []).filter((l) => logFilter === 'all' || l.type === 'error');

  async function copyLog() {
    const text = (job?.logs ?? []).map((l) => `${l.timestamp?.slice(11, 19) ?? ''} ${l.step ? `[${l.step}] ` : ''}${l.message ?? ''}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked: nothing to do
    }
  }

  // ---- view ---------------------------------------------------------------------------------
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">P</span>
          <div>
            <h1>PLM Automation</h1>
            <p>Update the DHT of each operation in Windchill</p>
          </div>
        </div>
        <span className={`pill pill-${outcome}`} role="status" aria-live="polite">
          <span className="pill-dot" />{OUTCOME_TEXT[outcome]}
        </span>
        {job && (
          <div className="top-progress">
            <div className="top-progress-text">
              <span>{done} of {total || '…'} operations · {percent}%</span>
              <span className="mono">{formatElapsed(elapsed)}</span>
            </div>
            <div className="bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
              <div className={`bar-fill ${running ? 'is-active' : ''}`} style={{ width: `${percent}%` }} />
            </div>
          </div>
        )}
      </header>

      <main className="container">
        <Stepper steps={STEPS} current={step} />

        <div className="safe-banner">
          {Icons.shield}
          <span><strong>Nothing is integrated.</strong> The run fills the DHT fields and checks them, then stops before <em>Integrate</em>, until the clarification with Airbus Atlantic is done.</span>
        </div>

        {error && <div className="alert" role="alert">{Icons.alert}<span>{error}</span></div>}

        {/* 1. Import ----------------------------------------------------------------------- */}
        {!data ? (
          <label
            className={`dropzone ${dragging ? 'is-dragging' : ''} ${importing ? 'is-busy' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files[0];
              if (file) void importFile(file);
            }}
          >
            <input type="file" accept=".xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
            <span className="dropzone-icon">{Icons.upload}</span>
            <strong>{importing ? 'Reading the file…' : 'Drop your Excel file here'}</strong>
            <span className="muted">or click to browse · .xlsx</span>
          </label>
        ) : (
          <section className="card file-card">
            <span className="file-icon">{Icons.file}</span>
            <div className="file-meta">
              <strong>{data.fileName}</strong>
              <span className="muted">{data.sheetNames.length} sheet(s) · {data.summary.totalRows} rows in total</span>
            </div>
            {data.sheetNames.length > 1 && (
              <label className="field-inline">
                <span className="muted">Sheet</span>
                <select value={sheet} disabled={running} onChange={(e) => { setSheet(e.target.value); setGroupsShown(GROUPS_PER_PAGE); }}>
                  {data.sheetNames.map((name) => <option key={name}>{name}</option>)}
                </select>
              </label>
            )}
            <label className={`btn btn-ghost ${running ? 'is-disabled' : ''}`}>
              Replace file
              <input type="file" accept=".xlsx" hidden disabled={running} onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
            </label>
          </section>
        )}

        {data && plan.error && <div className="alert" role="alert">{Icons.alert}<span>{plan.error}</span></div>}

        {data && !plan.error && (
          <>
            <div className="layout">
              {/* 2. Review ---------------------------------------------------------------- */}
              <section className="card review">
                <div className="card-head">
                  <div>
                    <h2>Review</h2>
                    <p className="muted">Check what will be typed into DHT. You can correct a DHT value here before running.</p>
                  </div>
                  <div className="toolbar">
                    <label className="search">
                      {Icons.search}
                      <input placeholder="Search routing, operation…" value={query} onChange={(e) => { setQuery(e.target.value); setGroupsShown(GROUPS_PER_PAGE); }} />
                    </label>
                    <div className="seg" role="group" aria-label="Filter rows">
                      <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All</button>
                      <button className={filter === 'problems' ? 'on' : ''} onClick={() => setFilter('problems')}>Problems{plan.problems ? ` (${plan.problems})` : ''}</button>
                    </div>
                  </div>
                </div>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th className="num">Row</th>
                        <th>Operation</th>
                        <th>Description</th>
                        <th className="dht-col">DHT <span className="th-note">from column E</span></th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.slice(0, groupsShown).map(([routing, items]) => {
                        const finished = items.filter((r) => resultBySheetRow.has(r.sheetRow)).length;
                        return (
                          <GroupRows key={routing} routing={routing} count={items.length} finished={job ? finished : undefined}>
                            {items.map((r) => {
                              const result = resultBySheetRow.get(r.sheetRow);
                              const outOfScope = shownLimit > 0 && (routingOrder.get(r.routing) ?? 0) >= shownLimit && !result;
                              return (
                                <tr key={r.sheetRow} className={`${r.problem ? 'row-problem' : ''} ${outOfScope ? 'row-dim' : ''}`}>
                                  <td className="num muted">{r.sheetRow}</td>
                                  <td className="mono">{r.paddedOperation || '—'}</td>
                                  <td className="desc" title={r.description}>{r.description || <span className="muted">—</span>}</td>
                                  <td className="dht-col">
                                    <input className="dht-input mono" aria-label={`DHT for ${routing} operation ${r.paddedOperation}`} value={r.dht} disabled={running} onChange={(e) => editDht(r, e.target.value)} />
                                  </td>
                                  <td>
                                    {result ? <StatusBadge status={result.status} title={result.message} />
                                      : r.problem ? <span className="badge badge-invalid" title={r.problem}>{r.problem}</span>
                                      : <span className="muted">{outOfScope ? 'Not in test run' : 'Ready'}</span>}
                                  </td>
                                </tr>
                              );
                            })}
                          </GroupRows>
                        );
                      })}
                      {!groups.length && (
                        <tr><td colSpan={5} className="empty">{filter === 'problems' && !query ? 'No problems found. Every row is ready.' : 'Nothing matches your search.'}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {groups.length > groupsShown && (
                  <button className="btn btn-ghost more" onClick={() => setGroupsShown((n) => n + GROUPS_PER_PAGE)}>
                    Show more routings ({groups.length - groupsShown} left)
                  </button>
                )}
              </section>

              {/* 3. Run -------------------------------------------------------------------- */}
              <aside className="card run">
                <h2>Run</h2>

                <fieldset className="scope" disabled={running}>
                  <legend className="sr-only">What to run</legend>
                  <label className={`choice ${scope === 'test' ? 'on' : ''}`}>
                    <input type="radio" name="scope" checked={scope === 'test'} onChange={() => setScope('test')} />
                    <span>
                      <strong>Test run</strong>
                      <span className="muted">The first
                        <input className="inline-number" type="number" min={1} max={Math.max(1, plan.routings)} value={testRoutings}
                          onChange={(e) => setTestRoutings(Math.max(1, Math.floor(Number(e.target.value) || 1)))} /> routings · {scopeCount} operations
                      </span>
                    </span>
                  </label>
                  <label className={`choice ${scope === 'all' ? 'on' : ''}`}>
                    <input type="radio" name="scope" checked={scope === 'all'} onChange={() => setScope('all')} />
                    <span>
                      <strong>Everything</strong>
                      <span className="muted">{plan.rows.length} operations · {plan.routings} routings</span>
                    </span>
                  </label>
                </fieldset>

                <label className="field">
                  <span>Parallel browsers</span>
                  <select value={workers} disabled={running} onChange={(e) => setWorkers(Number(e.target.value))}>
                    {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}{n === 1 ? ' (safest)' : ''}</option>)}
                  </select>
                </label>

                {running ? (
                  <button className="btn btn-danger" onClick={stop}>{Icons.stop} Stop run</button>
                ) : (
                  <button className="btn btn-primary" onClick={run} disabled={starting || !plan.ready}>
                    {Icons.play} {starting ? 'Starting…' : job ? 'Run again' : 'Run automation'}
                  </button>
                )}
                <p className="muted small">A browser window opens on PLM and signs in by itself. Leave it alone while it runs.</p>

                {job && (
                  <div className="progress-block">
                    {job.result && <p className={`outcome outcome-${outcome}`}>{job.result.message}</p>}
                    {job.artifacts?.report && (
                      <a className="btn btn-ghost" href={job.artifacts.report}>{Icons.download} Download report</a>
                    )}
                  </div>
                )}
              </aside>
            </div>

            {/* 4. Results -------------------------------------------------------------------- */}
            {job && (job.rows?.length ?? 0) > 0 && (
              <section className="card">
                <h2>Results</h2>
                <p className="muted results-line">
                  {tally.updated} entered · {tally['not-in-plm']} not in PLM · {tally['no-dht']} without cell · {tally.invalid} invalid · {tally.failed} failed
                </p>
                {issues.length > 0 && (
                  <div className="table-wrap issues">
                    <table>
                      <thead><tr><th className="num">Row</th><th>Routing</th><th>Operation</th><th>DHT</th><th>Result</th><th>Why</th></tr></thead>
                      <tbody>
                        {issues.map((r) => (
                          <tr key={r.row}>
                            <td className="num muted">{r.row}</td>
                            <td className="mono">{r.routing}</td>
                            <td className="mono">{r.operation}</td>
                            <td className="mono">{r.dht}</td>
                            <td><StatusBadge status={r.status} /></td>
                            <td className="why">{r.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {/* Log --------------------------------------------------------------------------- */}
            {job && (
              <section className="card">
                <div className="card-head">
                  <h2>Run log</h2>
                  <div className="toolbar">
                    <div className="seg" role="group" aria-label="Log filter">
                      <button className={logFilter === 'all' ? 'on' : ''} onClick={() => setLogFilter('all')}>All</button>
                      <button className={logFilter === 'errors' ? 'on' : ''} onClick={() => setLogFilter('errors')}>Errors</button>
                    </div>
                    <button className="btn btn-ghost" onClick={copyLog}>{Icons.copy} {copied ? 'Copied' : 'Copy'}</button>
                  </div>
                </div>
                <div className="log" ref={logRef} tabIndex={0}>
                  {logLines.length === 0 && <div className="log-empty">Nothing to show yet.</div>}
                  {logLines.map((l, i) => (
                    <div key={i} className={`log-line ${l.type === 'error' ? 'is-error' : ''}`}>
                      <span className="log-time">{l.timestamp?.slice(11, 19)}</span>
                      <span>{l.step ? <b>{l.step} </b> : null}{l.message}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

/** A routing's header line followed by its operation rows. */
function GroupRows({ routing, count, finished, children }: { routing: string; count: number; finished?: number; children: ReactNode }) {
  return (
    <>
      <tr className="group-row">
        <td colSpan={5}>
          <span className="group-name mono">{routing}</span>
          <span className="muted"> · {count} operation{count > 1 ? 's' : ''}{finished !== undefined ? ` · ${finished} processed` : ''}</span>
        </td>
      </tr>
      {children}
    </>
  );
}
