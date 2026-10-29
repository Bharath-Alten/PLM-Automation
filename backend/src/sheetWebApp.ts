import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';

// Reads the workbook through the Apps Script web app deployed by gsheet/install.mjs (clasp): no browser,
// no docs.google.com page. The request carries the shared token of gsheet/config.json and the Google
// token of the account signed in to clasp (~/.clasprc.json, written by "clasp login").

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Same result from backend/src (tsx) and backend/dist (node).
const CONFIG_PATH = path.join(__dirname, '..', '..', 'gsheet', 'config.json');
const CLASPRC_PATH = path.join(os.homedir(), '.clasprc.json');
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const RELOGIN = 'Run "clasp login" again on this machine, with the Google account that installed the script.';

type WebAppConfig = { url: string; token: string };
type Tokens = { access_token?: string; refresh_token?: string; expiry_date?: number; client_id?: string; client_secret?: string };

const cache = { token: '', expires: 0 };

/** The installer's configuration, or null when the web app is not set up on this machine. */
export function webAppConfig(): WebAppConfig | null {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^﻿/, ''));
    return c.url && c.token ? { url: c.url, token: c.token } : null;
  } catch {
    return null;
  }
}

// The part of .clasprc.json that holds the tokens (its layout changes with the clasp version).
function tokensIn(value: unknown): Tokens | null {
  if (!value || typeof value !== 'object') return null;
  const object = value as Record<string, unknown>;
  if (object.access_token || object.refresh_token) return object as Tokens;
  for (const key of ['default', 'token', 'tokens', ...Object.keys(object)]) {
    const found = tokensIn(object[key]);
    if (found) return found;
  }
  return null;
}

/** Google access token of the account signed in to clasp, renewed with its refresh token when it has expired. */
async function googleToken(renew = false): Promise<string> {
  if (!renew && cache.token && cache.expires - Date.now() > 60_000) return cache.token;
  let rc: Record<string, any>;
  try {
    rc = JSON.parse(fs.readFileSync(CLASPRC_PATH, 'utf8').replace(/^﻿/, ''));
  } catch {
    throw new Error(`No clasp session on this machine (${CLASPRC_PATH}). ${RELOGIN}`);
  }
  const tokens = tokensIn(rc);
  if (!tokens) throw new Error(`No Google token found in ${CLASPRC_PATH}. ${RELOGIN}`);
  const expires = Number(tokens.expiry_date || 0);
  if (!renew && tokens.access_token && expires - Date.now() > 60_000) {
    Object.assign(cache, { token: tokens.access_token, expires });
    return cache.token;
  }
  const settings = rc.oauth2ClientSettings ?? {};
  const clientId = tokens.client_id ?? settings.clientId;
  const clientSecret = tokens.client_secret ?? settings.clientSecret;
  if (!tokens.refresh_token || !clientId || !clientSecret) {
    if (tokens.access_token) return tokens.access_token;
    throw new Error(`The clasp session cannot be renewed. ${RELOGIN}`);
  }
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: tokens.refresh_token, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(30_000)
  }).catch((error) => { throw new Error(`The Google session could not be renewed: ${error instanceof Error ? error.message : error}`); });
  if (!response.ok) throw new Error(`The clasp Google session has expired or was revoked (error ${response.status}). ${RELOGIN}`);
  const json = await response.json() as { access_token: string; expires_in?: number };
  Object.assign(cache, { token: json.access_token, expires: Date.now() + Number(json.expires_in ?? 3600) * 1000 });
  return cache.token;
}

type WebAppAnswer = { error?: string; name?: string; sheets?: Record<string, string[][]> };

/** Reads every tab of the workbook and saves it as an .xlsx in `dir`, so the normal parser reads it. */
export async function readWorkbookViaWebApp(config: WebAppConfig, dir: string): Promise<{ filePath: string; fileName: string }> {
  const body = JSON.stringify({ jeton: config.token });
  let token = await googleToken();
  let text = '';
  for (const attempt of [1, 2]) {
    // Google answers the POST with a redirect to the result, followed as a GET (the token is not sent there).
    const response = await fetch(config.url, {
      method: 'POST', redirect: 'follow', body, signal: AbortSignal.timeout(120_000),
      headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` }
    }).catch((error) => { throw new Error(`Google Apps Script is unreachable: ${error instanceof Error ? error.message : error}`); });
    if ((response.status === 401 || response.status === 403) && attempt === 1) {
      token = await googleToken(true);
      continue;
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Google refuses access to the web app (error ${response.status}): the clasp account may be outside the company, or the session is invalid. ${RELOGIN}`);
    }
    if (!response.ok) throw new Error(`Google answered ${response.status} ${response.statusText}. Check gsheet/config.json, or run gsheet/install.mjs again.`);
    text = await response.text();
    break;
  }

  let answer: WebAppAnswer;
  try {
    answer = JSON.parse(text);
  } catch {
    const title = text.match(/<title>(.*?)<\/title>/is)?.[1]?.trim() || text.slice(0, 150).trim();
    throw new Error(`Unexpected answer from Google ("${title}"): the script may not be authorised yet. Open the address in gsheet/config.json in your browser once to authorise it, or run gsheet/install.mjs again.`);
  }
  if (answer.error) throw new Error(answer.error);
  if (!answer.sheets || !Object.keys(answer.sheets).length) throw new Error('The workbook has no data.');

  const workbook = XLSX.utils.book_new();
  for (const [name, values] of Object.entries(answer.sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(values), name.substring(0, 31));
  }
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `${(answer.name || 'google-sheet').replace(/[^a-zA-Z0-9.\-_]/g, '_')}.xlsx`;
  const filePath = path.join(dir, `${Date.now()}-${fileName}`);
  XLSX.writeFile(workbook, filePath);
  return { filePath, fileName };
}
