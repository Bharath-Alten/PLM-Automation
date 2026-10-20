import test from 'node:test';
import assert from 'node:assert/strict';

import { padOperation, pickLatestVersion, sameValue } from './operations';

test('padOperation pads to four digits and drops a trailing .0', () => {
  assert.equal(padOperation('10'), '0010');
  assert.equal(padOperation(10), '0010');
  assert.equal(padOperation('10.0'), '0010');
  assert.equal(padOperation('0010'), '0010');
  assert.equal(padOperation(' 120 '), '0120');
});

test('sameValue tolerates number formatting only', () => {
  assert.ok(sameValue('12.5', '12.50'));
  assert.ok(sameValue('12,5', '12.5'));
  assert.ok(sameValue(' 7 ', '7'));
  assert.ok(!sameValue('12.5', '12.6'));
  assert.ok(!sameValue('abc', 'abd'));
});

test('pickLatestVersion takes the highest version among rows naming the routing', () => {
  const rows = [
    'GAM-100  Process Plan  A.1 (Released)',
    'GAM-100  Process Plan  B.2 (In Work)',
    'GAM-100  Process Plan  B.10 (In Work)',
    'GAM-1000 Process Plan  C.1'
  ];
  assert.equal(pickLatestVersion(rows, 'GAM-100'), 2);
});

test('pickLatestVersion returns -1 when nothing matches and the first row when no version is shown', () => {
  assert.equal(pickLatestVersion(['other plan A.1'], 'GAM-100'), -1);
  assert.equal(pickLatestVersion(['GAM-100', 'GAM-100'], 'gam-100'), 0);
});
