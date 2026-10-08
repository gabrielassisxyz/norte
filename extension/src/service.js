import { configuredOrigin } from './settings.js';
import { capturePage } from './capture.js';

export const CANNOT_READ = 'Não foi possível ler esta página. Abra uma página http ou https fora da loja de extensões.';
export const SERVER_ERROR = 'O servidor não respondeu. Confira se o Norte está aberto e tente novamente.';
export const CONFIGURE = 'configure o servidor';
export const resultKey = (url) => `save:${url}`;

export function readableURL(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) &&
      !['chromewebstore.google.com', 'addons.mozilla.org'].includes(parsed.hostname) &&
      !(parsed.hostname === 'chrome.google.com' && parsed.pathname.startsWith('/webstore'));
  } catch { return false; }
}

export function createSaveService(browserAPI, fetcher = fetch) {
  const pending = new Map();
  async function save(tab, fields) {
    const key = resultKey(tab.url);
    try {
      if (!readableURL(tab.url)) throw new Error(CANNOT_READ);
      const origin = await configuredOrigin(browserAPI);
      if (!origin) throw new Error(CONFIGURE);
      await browserAPI.storage.local.set({ [key]: { state: 'saving' } });
      let capture;
      try {
        const results = await browserAPI.scripting.executeScript({ target: { tabId: tab.id }, func: capturePage });
        capture = results[0]?.result;
        if (!capture || capture.url !== tab.url) throw new Error('Page changed');
      } catch { throw new Error(CANNOT_READ); }
      const payload = { ...capture, source: 'extension' };
      if (fields.why?.trim()) payload.why = fields.why.trim();
      if (fields.link_to) payload.link_to = [fields.link_to];
      let response;
      try {
        response = await fetcher(`${origin}/api/library/items`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
          signal: AbortSignal.timeout(25000), redirect: 'error',
        });
      } catch { throw new Error(SERVER_ERROR); }
      if (response.status === 413) throw new Error('página grande demais para salvar');
      if (!response.ok) throw new Error(`Não foi possível salvar (HTTP ${response.status}). Tente novamente.`);
      const item = await response.json();
      if (!item.id) throw new Error('O servidor retornou uma resposta sem identificação.');
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
