import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSaveService, loadTargets, CANNOT_READ, SERVER_ERROR, CONFIGURE, INTERRUPTED, resultKey,
  saveTimeoutMs, settleStale, clearOrphanedSaving } from '../src/service.js';

const tab = { id: 17, url: 'https://example.test/article' };
function saveAPI({ permission = true, injection = true } = {}) {
  const stored = {}, injections = [];
  return { stored, injections, permissions: { contains: async () => permission },
    storage: { local: { get: async () => ({ serverOrigin: 'http://host:8080' }), set: async (value) => Object.assign(stored, value) } },
    scripting: { executeScript: async (request) => {
      injections.push(request);
      if (!injection) throw new Error('blocked');
      return [{ result: { url: tab.url, title: 'Title', html: '<article>Private text</article>',
        selection: { exact: 'text', prefix: 'Private ', suffix: '' } } }];
    } },
  };
}

test('save posts the captured page and explicit wire fields once and stores by URL', async () => {
  const api = saveAPI(), posts = [];
  const save = createSaveService(api, async (url, options) => {
    posts.push({ url, options });
    return { ok: true, status: 201, json: async () => ({ id: 'item-id' }) };
  });
  const first = save(tab, { reason: ' Read later ', link_to: 'focus-id' });
  await Promise.all([first, save(tab)]);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, 'http://host:8080/api/library/items');
  assert.equal(posts[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(posts[0].options.body), { url: tab.url, title: 'Title', html: '<article>Private text</article>',
    selection: { exact: 'text', prefix: 'Private ', suffix: '' }, source: 'extension', reason: 'Read later', link_to: ['focus-id'] });
  assert.equal(api.injections[0].target.tabId, 17);
  assert.equal(api.stored[resultKey(tab.url)].state, 'saved');
  assert.equal(api.stored[resultKey('https://other.test')], undefined);
});

test('413 is visible and never falls back to URL only', async () => {
  const api = saveAPI();
  let posts = 0;
  const result = await createSaveService(api, async () => { posts++; return { status: 413, ok: false }; })(tab);
  assert.equal(result.message, 'the page is too large to save');
  assert.equal(posts, 1);
  assert.equal(api.stored[resultKey(tab.url)].state, 'error');
});

test('missing grant requires configuration without attempting server or page access', async () => {
  const api = saveAPI({ permission: false });
  const result = await createSaveService(api, () => { assert.fail('must not fetch'); })(tab);
  assert.equal(result.message, CONFIGURE);
  assert.equal(api.injections.length, 0);
});

test('restricted pages and injection failures send nothing; unreachable server is distinguished', async () => {
  for (const url of ['chrome://settings', 'https://chromewebstore.google.com/detail/x', 'https://addons.mozilla.org/firefox']) {
    const api = saveAPI();
    const result = await createSaveService(api, () => assert.fail('must not fetch'))({ ...tab, url });
    assert.equal(result.message, CANNOT_READ);
    assert.equal(api.injections.length, 0);
  }
  const injection = await createSaveService(saveAPI({ injection: false }), () => assert.fail('must not fetch'))(tab);
  assert.equal(injection.message, CANNOT_READ);
  const offline = await createSaveService(saveAPI(), async () => { throw new Error('connection refused'); })(tab);
  assert.equal(offline.message, SERVER_ERROR);
});

test('target wire shapes, subject search, and all pages are honored', async () => {
  const urls = [];
  const targets = await loadTargets('http://host:8080', 'science & art', async (url) => {
    urls.push(url);
    const body = url.endsWith('/focus') ? { subjects: [{ id: 's1', name: 'Science' }], targets: [{ id: 'p1', type: 'project', title: 'Project' }] } :
      url.includes('cursor=') ? { items: [{ id: 's2', name: 'Art' }] } : { items: [{ id: 's1', name: 'Science' }], next_cursor: 'next token' };
    return { ok: true, json: async () => body };
  });
  assert.deepEqual(targets.map(({ id, title }) => ({ id, title })), [
    { id: 'p1', title: 'Project' }, { id: 's1', title: 'Science' }, { id: 's2', title: 'Art' },
  ]);
  assert.equal(new URL(urls[1]).searchParams.get('q'), 'science & art');
  assert.equal(new URL(urls[2]).searchParams.get('cursor'), 'next token');
  await assert.rejects(loadTargets('http://host', '', async () => ({ ok: false })), /did not answer/);
});

test('upload timeout scales with body size and is capped', () => {
  assert.equal(saveTimeoutMs(0), 25000);
  assert.equal(saveTimeoutMs(1), 26000);
  assert.equal(saveTimeoutMs(512 * 1024), 26000);
  assert.equal(saveTimeoutMs(512 * 1024 + 1), 27000);
  assert.equal(saveTimeoutMs(10 * 1024 * 1024), 45000);
  assert.equal(saveTimeoutMs(10 ** 12), 300000);
});

test('the request uses the scaled timeout and the saving entry records its deadline', async () => {
  const api = saveAPI(), writes = [];
  const set = api.storage.local.set;
  api.storage.local.set = async (value) => { writes.push(structuredClone(value)); return set(value); };
  const html = 'x'.repeat(2 * 1024 * 1024);
  api.scripting.executeScript = async () => [{ result: { url: tab.url, title: 'T', html } }];
  const timeouts = [], realTimeout = AbortSignal.timeout;
  AbortSignal.timeout = (ms) => { timeouts.push(ms); return realTimeout.call(AbortSignal, ms); };
  try {
    await createSaveService(api, async () => ({ ok: true, status: 201, json: async () => ({ id: 'i' }) }), () => 1000)(tab);
  } finally { AbortSignal.timeout = realTimeout; }
  const saving = writes.map((write) => write[resultKey(tab.url)]).filter((entry) => entry.state === 'saving');
  assert.equal(saving[0].startedAt, 1000);
  assert.equal(saving.at(-1).deadline, 1000 + saveTimeoutMs(2 * 1024 * 1024 + 200) + 10000, 'deadline follows the body size');
  assert.ok(saving.at(-1).deadline > 1000 + 25000 + 10000);
  assert.deepEqual(timeouts, [saveTimeoutMs(2 * 1024 * 1024 + 200)]);
});

test('a saving entry past its deadline settles as a retryable error', () => {
  const fresh = { state: 'saving', startedAt: 0, deadline: 1000 };
  assert.deepEqual(settleStale(fresh, 1000), fresh);
  assert.deepEqual(settleStale(fresh, 1001), { state: 'error', message: INTERRUPTED });
  assert.deepEqual(settleStale({ state: 'saving' }, 5), { state: 'error', message: INTERRUPTED });
  const saved = { state: 'saved', id: 'x' };
  assert.equal(settleStale(saved, 10 ** 9), saved);
  assert.equal(settleStale(undefined, 1), undefined);
});

test('worker startup turns orphaned saving entries into errors and leaves the rest alone', async () => {
  const store = { serverOrigin: 'http://host', 'save:a': { state: 'saving', startedAt: 1, deadline: 9e12 },
    'save:b': { state: 'saved', id: 'b' }, 'save:c': { state: 'error', message: 'm' } };
  const api = { storage: { local: { get: async () => ({ ...store }), set: async (value) => Object.assign(store, value) } } };
  await clearOrphanedSaving(api);
  assert.deepEqual(store['save:a'], { state: 'error', message: INTERRUPTED });
  assert.deepEqual(store['save:b'], { state: 'saved', id: 'b' });
  assert.equal(store.serverOrigin, 'http://host');
});
