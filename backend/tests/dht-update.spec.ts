import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

import { Actions } from './webactions';
import { groupByRouting, loadPlmRows, type PlmRow } from './plmData';
import { pickLatestVersion, sameValue } from './operations';
import { PLM_URL, dhtInput, operationCell, planFrame, planGrid, resultLinks, searchBox, searchButton, structureTab } from './selectors';

// For each routing in the file: open its latest version in PLM, and for each operation of the file
// that exists in the structure, put the value of column E into the DHT field.
//
// THE RUN STOPS BEFORE "INTEGRATE". Nothing is checked in or integrated until the clarification
// meeting with Airbus Atlantic has cleared it; the field is filled and verified, then the next
// operation is handled. (Final step, once cleared: click Integrate and write the note "projet clocking".)

const LOGIN_WAIT_MS = Number(process.env.LOGIN_WAIT_MS || 300_000);
const RESULTS_PATH = process.env.RESULTS_PATH || path.join(process.cwd(), 'outputs', 'results.jsonl');

const rows = loadPlmRows();
const groups = groupByRouting(rows);

fs.mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });
// Lets the app tell "not reached" rows from processed ones if the run dies half way.
fs.writeFileSync(path.join(path.dirname(RESULTS_PATH), 'expected-rows.txt'), String(rows.length));

function record(row: PlmRow, status: 'updated' | 'not-in-plm' | 'invalid' | 'failed', message: string) {
  fs.appendFileSync(RESULTS_PATH, JSON.stringify({
    row: row.row, routing: row.routing, operation: row.operation, dht: row.dht, status, message
  }) + '\n');
  console.log(`ROW ${row.row} | Routing ${row.routing} | Op ${row.paddedOperation || '-'} | ${status.toUpperCase()} | ${message}`);
}

for (const [routing, items] of groups) {
  test(`Routing ${routing} | ${items.length} operation(s)`, async ({ page }) => {
    const actions = new Actions(page);
    const todo = items.filter((item) => {
      if (item.problem) record(item, 'invalid', item.problem);
      return !item.problem;
    });
    if (!todo.length) return;

    // Anything below that throws before an operation is reached fails every row still pending.
    const pending = new Set(todo);
    const failPending = (message: string) => {
      for (const item of pending) record(item, 'failed', message);
      pending.clear();
    };

    try {
      await actions.log(`Starting | Routing ${routing} | ${todo.length} operation(s)`);

      // 1. Open PLM and wait for the search box (the user signs in here if asked to).
      await page.goto(PLM_URL);
      await expect(searchBox(page)).toBeVisible({ timeout: LOGIN_WAIT_MS });

      // 2. Search the routing.
      await searchBox(page).click();
      await searchBox(page).clear();
      await searchBox(page).fill(routing);
      await expect(searchButton(page)).toBeVisible({ timeout: 15_000 });
      await searchButton(page).click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000);

      // 3. Open the right routing, at its latest version.
      const links = resultLinks(page);
      await expect(links.first()).toBeVisible({ timeout: 30_000 }).catch(() => undefined);
      const count = await links.count();
      const rowTexts = await Promise.all(
        Array.from({ length: count }, (_, i) => links.nth(i).locator('xpath=ancestor::tr[1]').innerText().catch(() => ''))
      );
      const chosen = pickLatestVersion(rowTexts, routing);
      if (chosen < 0) {
        await actions.screenshot(`Routing_${routing}_Not_Found`);
        failPending(`Routing ${routing} not found in PLM search results (${count} result(s))`);
        return;
      }
      await actions.log(`Opening result ${chosen + 1} of ${count}: ${rowTexts[chosen].replace(/\s+/g, ' ').slice(0, 120)}`);
      await links.nth(chosen).click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(5000);

      // 4. Structure tab.
      await expect(structureTab(page)).toBeVisible({ timeout: 15_000 });
      await structureTab(page).click();
      await page.waitForTimeout(10_000);
      const frame = planFrame(page);
      await planGrid(frame).waitFor({ state: 'visible', timeout: 30_000 });
      await page.waitForTimeout(2000);

      // 5. Operation by operation: missing in PLM -> skip; extra in PLM -> ignored (never looked at).
      for (const item of todo) {
        try {
          const cell = operationCell(frame, item.paddedOperation);
          if (!(await cell.isVisible().catch(() => false))) {
            pending.delete(item);
            record(item, 'not-in-plm', `Operation ${item.paddedOperation} does not exist in the process plan; skipped`);
            continue;
          }
          await cell.click();
          await page.waitForTimeout(3000);

          const input = dhtInput(frame);
          await expect(input, `DHT field for operation ${item.paddedOperation}`).toBeVisible({ timeout: 15_000 });
          if (!(await input.isEditable())) {
            throw new Error('DHT field is read-only (the plan may need to be checked out)');
          }
          await input.scrollIntoViewIfNeeded();
          await input.click({ force: true });
          await input.evaluate((el: HTMLInputElement, value: string) => {
            el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
          }, item.dht);
          await input.press('Enter');
          await page.waitForTimeout(1000);
          await input.press('Tab');
          await page.waitForTimeout(2000);

          const actual = await input.inputValue();
          if (!sameValue(item.dht, actual)) {
            throw new Error(`DHT shows "${actual}" after typing "${item.dht}"`);
          }
          await actions.screenshot(`Routing_${routing}_Op_${item.paddedOperation}_DHT`);
          pending.delete(item);
          record(item, 'updated', `DHT set to ${item.dht} (not integrated)`);
        } catch (error) {
          pending.delete(item);
          await actions.screenshot(`Routing_${routing}_Op_${item.paddedOperation}_Failed`);
          record(item, 'failed', error instanceof Error ? error.message.split('\n')[0] : String(error));
        }
      }

      await actions.log(`Routing ${routing} done. Paused before Integrate: waiting for Airbus Atlantic clearance.`);
    } catch (error) {
      await actions.screenshot(`Routing_${routing}_Failed`);
      failPending(error instanceof Error ? error.message.split('\n')[0] : String(error));
      throw error;
    }
  });
}
