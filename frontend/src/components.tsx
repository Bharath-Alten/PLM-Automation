import type { ReactNode } from 'react';

import type { RowStatus } from './types';

const icon = (path: ReactNode) => (
  <svg className="icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
);

export const Icons = {
  upload: icon(<><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></>),
  file: icon(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>),
  play: icon(<path d="m7 4 13 8-13 8z" />),
  stop: icon(<rect x="6" y="6" width="12" height="12" rx="1.5" />),
  download: icon(<><path d="M12 4v12" /><path d="m7 11 5 5 5-5" /><path d="M4 20h16" /></>),
  shield: icon(<><path d="M12 3 5 6v5c0 4.5 2.9 8.3 7 10 4.1-1.7 7-5.5 7-10V6z" /><path d="m9 12 2 2 4-4" /></>),
  check: icon(<path d="m5 12 5 5 9-10" />),
  alert: icon(<><path d="M12 4 3 20h18z" /><path d="M12 10v4" /><path d="M12 17.5v.01" /></>),
  search: icon(<><circle cx="11" cy="11" r="6" /><path d="m20 20-4-4" /></>),
  copy: icon(<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></>)
};

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="stepper" aria-label="Progress">
      {steps.map((label, i) => {
        const state = i + 1 < current ? 'done' : i + 1 === current ? 'current' : 'todo';
        return (
          <li key={label} className={`step ${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="step-dot">{state === 'done' ? Icons.check : i + 1}</span>
            <span className="step-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function Stat({ label, value, tone = 'neutral', hint }: { label: string; value: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad'; hint?: string }) {
  return (
    <div className={`stat tone-${tone}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export const STATUS_TEXT: Record<RowStatus, string> = {
  updated: 'DHT entered',
  'not-in-plm': 'Not in PLM',
  invalid: 'Invalid row',
  failed: 'Failed'
};

export function StatusBadge({ status, title }: { status: RowStatus; title?: string }) {
  return <span className={`badge badge-${status}`} title={title}>{STATUS_TEXT[status]}</span>;
}
