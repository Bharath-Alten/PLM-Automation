import test from 'node:test';
import assert from 'node:assert/strict';

import { groupByRouting, pickSheet, toPlmRows, type SheetRow } from './plmData';

// Columns A..E: Routing, OP, Description, Unit, DHT.
const sheet: SheetRow[] = [
  { __row: 2, Routing: 'GAM-1', OP: 10, Description: 'Drill', Unit: 'h', DHT: '1.5' },
  { __row: 3, Routing: 'GAM-1', OP: '20', Description: 'Rivet', Unit: 'h', DHT: '2' },
  { __row: 4, Routing: 'GAM-2', OP: '', Description: 'Seal', Unit: 'h', DHT: '3' },
  { __row: 5, Routing: null, OP: null, Description: null, Unit: null, DHT: null },
  { __row: 6, Routing: 'GAM-2', OP: '30', Description: 'Paint', Unit: 'h', DHT: null }
];

test('rows are mapped and padded, blank lines vanish, bad rows carry a problem', () => {
  const rows = toPlmRows(sheet, {});
  assert.equal(rows.length, 4);
  assert.deepEqual([rows[0].routing, rows[0].paddedOperation, rows[0].dht, rows[0].row], ['GAM-1', '0010', '1.5', 2]);
  assert.equal(rows[2].problem, 'Operation Number Empty');
  assert.match(rows[3].problem ?? '', /DHT value is empty/);
});

test('the DHT value is read by position (column E), not by header name', () => {
  const rows = toPlmRows([{ Routing: 'R', OP: 10, C: 'c', D: 'd', Anything: '9' }], {});
  assert.equal(rows[0].dht, '9');
});

test('DHT_COLUMN, ROUTING_COLUMN and OP_COLUMN override the defaults', () => {
  const rows = toPlmRows([{ A: 'GAM-9', B: 40, C: 'x', D: 'y', E: 'z', F: '7.5' }], { ROUTING_COLUMN: 'A', OP_COLUMN: 'B', DHT_COLUMN: 'F' });
  assert.deepEqual([rows[0].routing, rows[0].paddedOperation, rows[0].dht], ['GAM-9', '0040', '7.5']);
});

test('a missing routing column is explained', () => {
  assert.throws(() => toPlmRows([{ Foo: 1, Bar: 2, Baz: 3, Qux: 4, Quux: 5 }], {}), /Routing column not found/);
});

test('real layout: accented headers, routing only on the first line of a group, title line skipped', () => {
  const sheet: SheetRow[] = [
    { Gamme: '3', 'Opération': null, 'Désign. opération': null, 'DHT Actuel': null, 'DHT Corrigé': null },
    { Gamme: 'C0S100-101-0601-02', 'Opération': '0010', 'Désign. opération': 'Doc', 'DHT Actuel': '0', 'DHT Corrigé': '0.00' },
    { Gamme: null, 'Opération': '0020', 'Désign. opération': 'Bracket', 'DHT Actuel': '0.5', 'DHT Corrigé': '1.35' },
    { Gamme: 'C0S100-101-0602-02', 'Opération': '0010', 'Désign. opération': 'Doc', 'DHT Actuel': '1', 'DHT Corrigé': '2.44' }
  ];
  const rows = toPlmRows(sheet, {});
  assert.deepEqual(rows.map((r) => [r.routing, r.paddedOperation, r.dht]), [
    ['C0S100-101-0601-02', '0010', '0.00'],
    ['C0S100-101-0601-02', '0020', '1.35'],
    ['C0S100-101-0602-02', '0010', '2.44']
  ]);
});

test('"Total :" lines are not operations and do not break the routing carried down', () => {
  const sheet: SheetRow[] = [
    { Gamme: 'C0S100-101-0601-02', 'Opération': '0010', D: 'a', E: 'b', 'DHT Corrigé': '0.00' },
    { Gamme: null, 'Opération': 'Total :', D: '-', E: '24.1', 'DHT Corrigé': '65.00' },
    { Gamme: 'C0S100-101-0602-02', 'Opération': '0010', D: 'a', E: 'b', 'DHT Corrigé': '1.00' }
  ];
  const rows = toPlmRows(sheet, {});
  assert.deepEqual(rows.map((r) => [r.routing, r.paddedOperation]), [['C0S100-101-0601-02', '0010'], ['C0S100-101-0602-02', '0010']]);
});

test('pickSheet takes the sheet that has routing and operation columns', () => {
  const sheets: Record<string, SheetRow[]> = {
    'Analyse Rapide': [{ Release: 'Oui', Gammes: 'X', 'DHT Actuel': '1' }],
    CZJ790: [{ Gamme: 'X', 'Opération': '0010', a: 1, b: 2, c: 3 }]
  };
  assert.equal(pickSheet(sheets, ['Analyse Rapide', 'CZJ790'], undefined), 'CZJ790');
  assert.equal(pickSheet(sheets, ['Analyse Rapide', 'CZJ790'], 'analyse rapide'), 'Analyse Rapide');
  assert.throws(() => pickSheet(sheets, ['Analyse Rapide', 'CZJ790'], 'nope'), /not found/);
});

test('groupByRouting keeps file order', () => {
  const groups = groupByRouting(toPlmRows(sheet, {}));
  assert.deepEqual([...groups.keys()], ['GAM-1', 'GAM-2']);
  assert.equal(groups.get('GAM-1')?.length, 2);
});
