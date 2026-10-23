import axios from 'axios';
import { getToken } from '/@/utils/auth';
import type { IWorkbookData } from '@univerjs/presets';

type ApiErrorPayload = {
  error?: string;
  message?: string;
};

export type CellEdit = { sheet: string; r: number; c: number; value: string };

const OPENCLAW_API_BASE = import.meta.env.VITE_OPENCLAW_API_BASE || '/openclaw-api';

const excelHttp = axios.create({
  baseURL: OPENCLAW_API_BASE,
  timeout: 600 * 1000,
});

excelHttp.interceptors.response.use(
  (response) => response,
  async (error) => {
    // For arraybuffer responses the error body is also an ArrayBuffer; decode it.
    let payload: ApiErrorPayload | undefined = error?.response?.data;
    if (payload instanceof ArrayBuffer) {
      try {
        payload = JSON.parse(new TextDecoder().decode(payload));
      } catch {
        payload = undefined;
      }
    }
    return Promise.reject(new Error(payload?.error || payload?.message || error?.message || '请求失败'));
  },
);

function authHeaders() {
  const token = getToken();
  return token ? { 'X-Authorization': 'Bearer ' + token } : {};
}

/** Generate the filled report for a month (YYYY-MM, empty = current month). Returns the Univer
 * snapshot plus a token that "export current edits" uses to reach the cached generated file. */
export function generateReport(month: string) {
  return excelHttp
    .post('/excel/report', { month }, { headers: authHeaders() })
    .then((res) => res.data as { snapshot: IWorkbookData; token: string; source?: { filename: string; sheet_count: number; supplemented_cells: number; mode?: 'full' | 'cumulative'; frozen_cross_sheet_formulas?: { cell: string; formula: string; saved_value: number | string }[] } | null });
}

/** Export by regenerating the report from the DB and injecting edits. Returns .xlsx bytes. */
export function exportReport(month: string, edits: CellEdit[]) {
  return excelHttp
    .post('/excel/export', { month, edits }, { responseType: 'arraybuffer', headers: authHeaders() })
    .then((res) => res.data as ArrayBuffer);
}

/** Export the current online report: inject edits into the cached generated file (no DB
 * re-query), so untouched cells match exactly what was shown. Returns .xlsx bytes. */
export function exportCurrent(token: string, edits: CellEdit[]) {
  return excelHttp
    .post('/excel/export-current', { token, edits }, { responseType: 'arraybuffer', headers: authHeaders() })
    .then((res) => res.data as ArrayBuffer);
}

/** Persist the current edits and write manually-edited tagged cells back to ThingsBoard.
 * Returns how many edits were saved to the staging file plus a DB write-back summary. */
export function updateDatabase(token: string, edits: CellEdit[], month: string) {
  return excelHttp
    .post('/excel/update-db', { token, edits, month }, { headers: authHeaders() })
    .then(
      (res) =>
        res.data as {
          ok: boolean;
          saved: number;
          written: number;
          devices: number;
          storage?: 'report';
          skipped: Record<string, number>;
          details: { tag: string; key: string; points: number }[];
          errors: string[];
        },
    );
}

/** Heartbeat: refresh the cached report's TTL so it never expires while the page is open. */
export function keepAlive(token: string) {
  return excelHttp
    .post('/excel/keepalive', { token }, { headers: authHeaders() })
    .then((res) => res.data as { alive: boolean });
}
