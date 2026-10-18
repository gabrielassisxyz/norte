import { configuredOrigin } from './settings.js';
import { capturePage } from './capture.js';

export const CANNOT_READ = 'This page could not be read. Open an http or https page outside the extension store.';
export const SERVER_ERROR = 'The server did not answer. Check that Norte is running and try again.';
export const CONFIGURE = 'configure the server';
export const INTERRUPTED = 'The save was interrupted. Try again.';
export const VERSION_HINT = "The extension may be older than the server. Rebuild it and reload it in the browser's extensions page.";
export const resultKey = (url) => `save:${url}`;

// The popup's own edits are small requests against an item that already exists.
const EDIT_TIMEOUT_MS = 15000;
const JSON_HEADERS = { 'Content-Type': 'application/json' };
export const REASON_DEBOUNCE_MS = 800;

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

// The server already names what it refused; the fixed sentence hid it and asked for
// a retry that could never work. An unsupported property specifically means the built
// extension predates the contract the server now validates against, hence the hint.
async function refusedSaveMessage(response) {
  let error;
  try { error = (await response.json())?.error; } catch { error = null; }
  if (!error?.message) return `Could not save (HTTP ${response.status}). Try again.`;
  const lines = [`Could not save: ${error.message}`];
  if (error.code === 'invalid_request') lines.push(VERSION_HINT);
  return lines.join('\n');
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
      if (!response.ok) throw new Error(await refusedSaveMessage(response));
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
  // An empty field offers the focus, the way the web picker does; asking for
  // every page of the whole vocabulary would be a read nothing renders.
  let cursor;
  while (query.trim()) {
    const params = new URLSearchParams({ q: query, limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const response = await fetcher(`${origin}/api/core/subjects?${params}`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(SERVER_ERROR);
    const page = await response.json();
    subjects.push(...page.items);
    cursor = page.next_cursor;
    if (!cursor) break;
  }
  return [...focus.targets, ...focus.subjects.map((subject) => ({ ...subject, title: subject.name, type: 'subject' })),
    ...subjects.map((subject) => ({ ...subject, title: subject.name, type: 'subject' }))]
    .filter((target, index, all) => all.findIndex((other) => other.id === target.id) === index);
}

async function editRequest(url, options, fetcher, failure) {
  let response;
  try {
    response = await fetcher(url, { ...options, signal: AbortSignal.timeout(EDIT_TIMEOUT_MS), redirect: 'error' });
  } catch { throw new Error(SERVER_ERROR); }
  if (!response.ok) throw new Error(`${failure} (HTTP ${response.status})`);
  return response.status === 204 ? null : await response.json();
}

export function patchItemReason(origin, id, reason, fetcher = fetch) {
  return editRequest(`${origin}/api/library/items/${id}`,
    { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ reason }) },
    fetcher, 'The note could not be saved');
}

export function createSubjectNamed(origin, name, fetcher = fetch) {
  return editRequest(`${origin}/api/core/subjects`,
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name }) },
    fetcher, 'The subject could not be created');
}

export function linkItemToSubject(origin, itemId, subjectId, fetcher = fetch) {
  return editRequest(`${origin}/api/core/links`,
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ src_id: itemId, dst_id: subjectId, kind: 'about' }) },
    fetcher, 'The subject could not be linked');
}

// A deleted item leaves no stored result behind, so the next click on the
// extension saves the page again instead of showing something that is gone.
export async function deleteSavedItem(browserAPI, url, origin, id, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(`${origin}/api/library/items/${id}`,
      { method: 'DELETE', signal: AbortSignal.timeout(EDIT_TIMEOUT_MS), redirect: 'error' });
  } catch { throw new Error(SERVER_ERROR); }
  // A 404 means somebody else already deleted it, which is the outcome asked for.
  if (!response.ok && response.status !== 404) throw new Error(`The item could not be deleted (HTTP ${response.status})`);
  await browserAPI.storage.local.remove(resultKey(url));
  return { state: 'deleted' };
}

/**
 * Collects reason keystrokes and writes them once the typing stops.
 *
 * The id is attached separately because the popup starts saving the page and
 * accepting a reason at the same moment: text typed before the POST answers is
 * held here and written as soon as there is an item to write it to.
 */
export function createReasonWriter({ write, delay = REASON_DEBOUNCE_MS, schedule = setTimeout, cancel = clearTimeout, onState = () => {} }) {
  let timer, id = null, latest = '', sent = null, sending = false, touched = false;

  async function flush() {
    cancel(timer);
    if (id === null || sending || latest === sent) return;
    const text = latest;
    sending = true;
    onState('saving');
    let written = false;
    try {
      await write(id, text);
      sent = text;
      written = true;
      onState('saved');
    } catch { onState('error'); }
    sending = false;
    // Only a successful write may chase a newer keystroke; a failed one would spin.
    if (written && latest !== sent) await flush();
  }

  return {
    type(text) {
      touched = true;
      latest = text;
      cancel(timer);
      timer = schedule(() => { flush(); }, delay);
    },
    blur() { return flush(); },
    attach(itemId, savedReason = '') {
      id = itemId;
      sent = savedReason;
      if (!touched) latest = savedReason;
      return flush();
    },
  };
}
