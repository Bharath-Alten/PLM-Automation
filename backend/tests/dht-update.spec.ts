import { test, expect, type FrameLocator, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

import { Actions } from './webactions';
import { groupByRouting, loadPlmRows, type PlmRow } from './plmData';
import { dhtMatches, pickLatestVersion } from './operations';
import {
  DHT_COLUMN_HEADER, PLM_URL, dhtCell, dhtEditor, operationLabel, planFrame, planGrid, resultLinks,
  searchBox, searchButton, structureTab, tagDhtCell, tagEditor, usesTab, visibleLabels
} from './selectors';

// For each routing in the file: open its latest version in PLM, go to Structure > Uses, and for each
// operation of the file find its row by label number (//span[@qtip="0020"]); in that row, put the
// value of column E into the "Temps Traite..." cell (it reads like "1.35 DHT").
// The value is typed even if the cell already holds one (it is overwritten).
// Operation of the file that is not in the table, or no such cell: skip and carry on.
//
// THE RUN STOPS BEFORE "INTEGRATE". Nothing is checked in or integrated until the clarification
// meeting with Airbus Atlantic has cleared it; the cell is filled and verified, then the next
// operation is handled. (Final step, once cleared: click Integrate and write the note "projet clocking".)

const LOGIN_WAIT_MS = Number(process.env.LOGIN_WAIT_MS || 300_000);
const RESULTS_PATH = process.env.RESULTS_PATH || path.join(process.cwd(), 'outputs', 'results.jsonl');

const rows = loadPlmRows();
const groups = groupByRouting(rows);

fs.mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });
// Lets the app tell "not reached" rows from processed ones if the run dies half way.
fs.writeFileSync(path.join(path.dirname(RESULTS_PATH), 'expected-rows.txt'), String(rows.length));

/** Clicks //button[.='OK'] if it appears within a few seconds, in the PLM frame or on the page. */
async function clickOkIfPresent(page: Page, frame: FrameLocator): Promise<boolean> {
  const deadline = Date.now() + 3000;
  do {
    for (const scope of [frame, page]) {
      const button = scope.locator("//button[.='OK']").first();
      if (await button.isVisible().catch(() => false)) {
        await button.click();
        return true;
      }
    }
    await page.waitForTimeout(300);
  } while (Date.now() < deadline);
  return false;
}

function record(row: PlmRow, status: 'updated' | 'not-in-plm' | 'no-dht' | 'invalid' | 'failed', message: string) {
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

      // 4. Structure tab, then its Uses table (one row per operation).
      await expect(structureTab(page)).toBeVisible({ timeout: 15_000 });
      await structureTab(page).click();
      await page.waitForTimeout(10_000);
      const frame = planFrame(page);
      await planGrid(frame).waitFor({ state: 'visible', timeout: 30_000 });
      await usesTab(frame).click({ timeout: 5000 }).catch(() => undefined); // already open by default
      await page.waitForTimeout(2000);

      // 5. Operation by operation. In PLM but not in the file: never looked at. In the file but not in PLM: skipped.
      for (const item of todo) {
        try {
          // The row: its label number cell, //span[@qtip="0020"].
          const label = operationLabel(frame, item.paddedOperation);
          if (!(await label.count())) {
            pending.delete(item);
            await actions.log(`Operation ${item.paddedOperation} not found. Label numbers in the table: ${(await visibleLabels(frame)).join(', ') || '(none)'}`);
            record(item, 'not-in-plm', `Operation ${item.paddedOperation} is not in the Uses table; skipped`);
            continue;
          }
          await label.scrollIntoViewIfNeeded({ timeout: 5000 });

          // The cell to fill: same row, under the "Temps Traite..." column.
          if (!(await tagDhtCell(label))) {
            pending.delete(item);
            record(item, 'no-dht', `No "${DHT_COLUMN_HEADER}..." cell found on the row of operation ${item.paddedOperation}; skipped`);
            continue;
          }
          const cell = dhtCell(frame);
          const before = (await cell.innerText({ timeout: 5000 })).trim();

          // The value is typed whatever the cell holds now (it is overwritten).
          // Open the editor: one click, else a double click (depends on how the grid is set up).
          await cell.click({ timeout: 10_000 });
          await page.waitForTimeout(800);
          if (!(await tagEditor(cell))) {
            await cell.dblclick({ timeout: 10_000 });
            await page.waitForTimeout(800);
            if (!(await tagEditor(cell))) {
              throw new Error('The cell did not become editable (the plan may need to be checked out)');
            }
          }
          const editor = dhtEditor(frame);
          await editor.evaluate((el: HTMLInputElement, value: string) => {
            el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }, item.dht, { timeout: 5000 });
          await page.keyboard.press('Enter');
          await page.waitForTimeout(1500);

          // A confirmation may pop up after the value is entered: if an OK button shows, click it.
          const okClicked = await clickOkIfPresent(page, frame);
          if (okClicked) await actions.log(`Clicked OK for operation ${item.paddedOperation}`);
          await page.waitForTimeout(2000);

          // The table is redrawn after OK, so the cell found above may be gone: find the row and the cell again.
          const rowAgain = operationLabel(frame, item.paddedOperation);
          const found = (await rowAgain.count()) > 0 && (await tagDhtCell(rowAgain));
          if (!found) throw new Error('After entering the value, the row or its cell could not be found again (the table changed)');
          const after = (await dhtCell(frame).innerText({ timeout: 5000 })).trim();
          if (!dhtMatches(after, item.dht)) {
            throw new Error(`The cell shows "${after}" after typing "${item.dht}" (was "${before}")`);
          }
          await actions.screenshot(`Routing_${routing}_Op_${item.paddedOperation}_DHT`);
          pending.delete(item);
          record(item, 'updated', `${before} -> ${after}${okClicked ? ', OK clicked' : ''} (not integrated)`);
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
