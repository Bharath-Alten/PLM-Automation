# PLM Automation

Fills the **DHT** field of each operation in Windchill PLM from an Excel file. Same architecture as
SAP Tracker: a React UI and an Express server, which starts a Playwright spec for each run and
streams its output back.

## Workflow of a run

1. Open PLM, search the routing (Gamma) number.
2. Open the matching result at its latest version.
3. Structure tab, **Uses** table (one row per operation): find each operation number of the file by its
   label number (`//span[@qtip="0020"]`).
   - operation missing in the table: skipped, reported as "Not in PLM";
   - extra operation in PLM that is not in the file: ignored.
4. In that row, put the value of **column E** of the file into the **"Temps Traite..."** cell (it reads like
   `1.35 DHT`), and check it took. The value is typed even if the cell already holds one (it is overwritten).
   The other DHT columns (Temps Prépa, TRS) are never touched. No such cell on the row: skipped, reported
   as "No DHT item".
5. **Stop. Integrate is never clicked.** Wait for the Airbus Atlantic clarification.
   (Final step, once cleared: click Integrate and write the note "projet clocking".)

## Run it

First copy `backend/.env.example` to `backend/.env` and fill in `PLM_USER` / `PLM_PASSWORD`
(HTTP authentication, applied to every page). `.env` is git-ignored: never commit credentials.

```bash
npm install
npm run setup:browsers
npm start            # http://localhost:4000: import the .xlsx, check it, Run automation
```

Sign in to PLM in the window that opens. A report (`Row / Routing / OP / DHT / Status / Message`) is
produced for each run and downloadable from the UI.

Behind the company proxy `npm run setup:browsers` can fail with `unable to get local issuer certificate`.
Skip it and set `BROWSER_CHANNEL=chrome` (or `msedge`) in `backend/.env`: the installed browser is used.
Keep the project on a local drive (not a `\\server\...` share): npm workspaces need symlinks.

Terminal alternative (like the previous project): put the file in `backend/inputs/inputData.xlsx`, then
`cd backend && npx playwright test`.

## The file

| What | Where |
|---|---|
| Routing | header `Routing` (or Gamma / Gamme / Routine); override with `ROUTING_COLUMN` |
| Operation | header `OP` (or Operation); override with `OP_COLUMN` |
| DHT value | **column E**, by position; override with `DHT_COLUMN` |

The routing is written once per group in the file (blank on the lines below it); the blank lines inherit it.
Headers are matched ignoring case and accents (`Gamme`, `Opération` work). The sheet read is the first one
that has a routing and an operation column; force one with `SHEET_NAME`. Developed against `CZJ790 - Sphynx.xlsx`
(sheet `CZJ790`: 118 routings).

`ROUTING_COLUMN`, `OP_COLUMN` and `DHT_COLUMN` take a column letter or a header name (set them in `backend/.env`).
`WORKERS` (default 4) sets how many routings run side by side.
`MAX_ROWS=3` limits a run to the first rows, to try it out.

## Layout

```
backend/src/            server: index.ts, excelParser.ts, playwright/specRunner.ts
backend/tests/
  dht-update.spec.ts    the flow above
  selectors.ts          every Windchill locator, in one place
  plmData.ts            file rows -> routing / operation / DHT
  operations.ts         padding (10 -> 0010), latest-version choice, value comparison
  *.test.ts             offline tests: npm test
frontend/src/App.tsx    the UI
```

## To check on the real screen before the first run

These could not be tested without PLM access:

- The **Temps Traite** column: it is found by its header title starting with "Temps Traite" (change it with
  `DHT_COLUMN_HEADER` in `backend/.env`) and the cell by its position under that header.
- How the cell is edited: the run clicks it, then double-clicks if no input opened, and types in the numeric
  input that appears over it. If that is not how the grid works, `npm run inspect` shows what happens.
- Whether the plan must be **checked out** to edit (the run reports "The cell did not become editable" if so).
- Whether edits made on several operations survive until Integrate, since nothing is saved on purpose.
- The latest-version choice reads versions like `A.3` from the result row text.
