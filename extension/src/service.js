import { configuredOrigin } from './settings.js';
import { capturePage } from './capture.js';

export const CANNOT_READ = 'This page could not be read. Open an http or https page outside the extension store.';
export const SERVER_ERROR = 'The server did not answer. Check that Norte is running and try again.';
export const CONFIGURE = 'configure the server';
export const INTERRUPTED = 'The save was interrupted. Try again.';
export const resultKey = (url) => `save:${url}`;

const BASE_TIMEOUT_MS = 25000;
const MAX_TIMEOUT_MS = 300000;
const BYTES_PER_EXTRA_SECOND = 512 * 1024;
// Covers page capture and storage round trips around the upload itself.
const SAVING_MARGIN_MS = 10000;

// A large page needs longer to upload than the flat base allows; the cap keeps a dead server bounded.
export function saveTimeoutMs(bodyBytes) {
  return Math.min(BASE_TIMEOUT_MS + Math.ceil(bodyBytes / BYTES_PER_EXTRA_SECOND) * 1000, MAX_TIMEOUT_MS);
}

export const savingEntry = (now, timeoutMs = 0) => ({ state: 'saving', startedAt: now, deadline: now + timeoutMs + SAVING_MARGIN_MS });

// A "saving" entry outlives its worker if the worker dies or the browser quits mid-save.
export function settleStale(result, now) {
  if (result?.state !== 'saving' || now <= (result.deadline ?? 0)) return result;
  return { state: 'error', message: INTERRUPTED };
}

// A freshly started worker has no request in flight, so every stored "saving" entry is orphaned.
export async function clearOrphanedSaving(browserAPI) {
  const all = await browserAPI.storage.local.get(null);
  const fixes = {};
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith('save:') && value?.state === 'saving') fixes[key] = { state: 'error', message: INTERRUPTED };
  }
  if (Object.keys(fixes).length) await browserAPI.storage.local.set(fixes);
}

export function readableURL(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) &&
      !['chromewebstore.google.com', 'addons.mozilla.org'].includes(parsed.hostname) &&
      !(parsed.hostname === 'chrome.google.com' && parsed.pathname.startsWith('/webstore'));
  } catch { return false; }
}

export function createSaveService(browserAPI, fetcher = fetch, now = Date.now) {
  const pending = new Map();
  async function save(tab, fields) {
    const key = resultKey(tab.url);
    try {
      if (!readableURL(tab.url)) throw new Error(CANNOT_READ);
      const origin = await configuredOrigin(browserAPI);
      if (!origin) throw new Error(CONFIGURE);
      await browserAPI.storage.local.set({ [key]: savingEntry(now()) });
      let capture;
      try {
        const results = await browserAPI.scripting.executeScript({ target: { tabId: tab.id }, func: capturePage });
        capture = results[0]?.result;
        if (!capture || capture.url !== tab.url) throw new Error('Page changed');
      } catch { throw new Error(CANNOT_READ); }
      const payload = { ...capture, source: 'extension' };
      if (fields.reason?.trim()) payload.reason = fields.reason.trim();
      if (fields.link_to) payload.link_to = [fields.link_to];
      const body = JSON.stringify(payload);
      const timeout = saveTimeoutMs(new TextEncoder().encode(body).length);
      await browserAPI.storage.local.set({ [key]: savingEntry(now(), timeout) });
      let response;
      try {
        response = await fetcher(`${origin}/api/library/items`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
          signal: AbortSignal.timeout(timeout), redirect: 'error',
        });
      } catch { throw new Error(SERVER_ERROR); }
      if (response.status === 413) throw new Error('the page is too large to save');
      if (!response.ok) throw new Error(`Could not save (HTTP ${response.status}). Try again.`);
      const item = await response.json();
      if (!item.id) throw new Error('The server answered without an identifier.');
      const result = { state: 'saved', id: item.id, origin };
      await browserAPI.storage.local.set({ [key]: result });
      return result;
    } catch (error) {
      const result = { state: 'error', message: error.message };
      await browserAPI.storage.local.set({ [key]: result });
      return result;
    }
  }
  return (tab, fields = {}) => {
    const key = resultKey(tab.url);
    if (pending.has(key)) return pending.get(key);
    const request = save(tab, fields).finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  };
}

export async function loadTargets(origin, query, fetcher = fetch) {
  const focusResponse = await fetcher(`${origin}/api/core/focus`, { signal: AbortSignal.timeout(10000) });
  if (!focusResponse.ok) throw new Error(SERVER_ERROR);
  const focus = await focusResponse.json();
  const subjects = [];
  let cursor;
  do {
    const params = new URLSearchParams({ q: query, limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const response = await fetcher(`${origin}/api/core/subjects?${params}`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(SERVER_ERROR);
    const page = await response.json();
    subjects.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor);
  return [...focus.targets, ...focus.subjects.map((subject) => ({ ...subject, title: subject.name, type: 'subject' })),
    ...subjects.map((subject) => ({ ...subject, title: subject.name, type: 'subject' }))]
    .filter((target, index, all) => all.findIndex((other) => other.id === target.id) === index);
}
