import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizeResults } from '../src/playwright/specRunner';
import type { RowResult } from '../src/types';

const result = (status: RowResult['status'], row = 1): RowResult => ({ row, routing: 'R', operation: '10', dht: '1', status, message: '' });

test('all rows updated is a success', () => {
  const s = summarizeResults([result('updated'), result('updated', 2)], 2, 'spec');
  assert.equal(s.summary.businessStatus, 'success');
  assert.match(s.message, /Nothing was integrated/);
});

test('operations missing in PLM make a partial success', () => {
  const s = summarizeResults([result('updated'), result('not-in-plm', 2)], 2, 'spec');
  assert.equal(s.summary.businessStatus, 'partial-success');
  assert.equal(s.success, true);
});

test('nothing updated is a failure, and rows never reached are counted', () => {
  const s = summarizeResults([result('failed')], 3, 'spec');
  assert.equal(s.summary.businessStatus, 'failed');
  assert.equal(s.summary.rowsNotReached, 2);
  assert.equal(s.success, false);
});
