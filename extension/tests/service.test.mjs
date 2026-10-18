import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSaveService, loadTargets, CANNOT_READ, SERVER_ERROR, CONFIGURE, INTERRUPTED, resultKey,
  saveTimeoutMs, settleStale, clearOrphanedSaving, createReasonWriter, createSubjectNamed, deleteSavedItem,
  linkItemToSubject, patchItemReason, REASON_DEBOUNCE_MS } from '../src/service.js';

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

test('an empty subject field reads only the focus, and a query reads every page', async () => {
  const urls = [];
  const fetcher = async (url) => {
    urls.push(url);
    const body = url.includes('/focus') ? { subjects: [{ id: 's1', name: 'Science' }], targets: [] }
      : url.includes('cursor=') ? { items: [{ id: 's3', name: 'Art' }] }
      : { items: [{ id: 's2', name: 'Astronomy' }], next_cursor: 'token' };
    return { ok: true, json: async () => body };
  };
  const focusOnly = await loadTargets('http://host', '', fetcher);
  assert.deepEqual(urls, ['http://host/api/core/focus']);
  assert.deepEqual(focusOnly.map((target) => target.id), ['s1']);
  urls.length = 0;
  const searched = await loadTargets('http://host', 'a', fetcher);
  assert.equal(urls.length, 3, 'focus, the first page and the page the cursor named');
  assert.deepEqual(searched.map((target) => target.id), ['s1', 's2', 's3']);
});

test('the reason is written with the whole text once the typing stops, and never before', async () => {
  const written = [], scheduled = [], states = [];
  const writer = createReasonWriter({
    write: async (id, text) => { written.push({ id, text }); },
    schedule: (run, delay) => { scheduled.push({ run, delay }); return scheduled.length; },
    cancel: (timer) => { if (timer) scheduled[timer - 1].run = () => {}; },
    onState: (state) => states.push(state),
  });
  await writer.attach('item-1', '');
  writer.type('Com');
  writer.type('Compare');
  assert.deepEqual(written, [], 'nothing is sent while the keystrokes are still coming');
  assert.deepEqual(scheduled.map((entry) => entry.delay), [REASON_DEBOUNCE_MS, REASON_DEBOUNCE_MS]);
  scheduled.forEach((entry) => entry.run());
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(written, [{ id: 'item-1', text: 'Compare' }], 'one write, carrying the full text');
  assert.deepEqual(states, ['saving', 'saved']);
  writer.type('Compare observations');
  await writer.blur();
  assert.deepEqual(written.at(-1), { id: 'item-1', text: 'Compare observations' }, 'blur writes a changed text');
  await writer.blur();
  assert.equal(written.length, 2, 'an unchanged text is not written again');
});

test('a reason typed before the save answers is written as soon as the id arrives', async () => {
  const written = [];
  const writer = createReasonWriter({ write: async (id, text) => { written.push({ id, text }); },
    schedule: () => 0, cancel: () => {} });
  writer.type('Queued while uploading');
  assert.deepEqual(written, [], 'there is no item to write to yet');
  await writer.attach('item-7', '');
  assert.deepEqual(written, [{ id: 'item-7', text: 'Queued while uploading' }]);
});

test('a stored reason is not written back, and a failed write does not spin', async () => {
  const written = [], states = [];
  const failing = createReasonWriter({ write: async () => { throw new Error('offline'); },
    schedule: () => 0, cancel: () => {}, onState: (state) => states.push(state) });
  await failing.attach('item-8', '');
  failing.type('text');
  await failing.blur();
  assert.deepEqual(states, ['saving', 'error']);
  const loaded = createReasonWriter({ write: async (id, text) => { written.push(text); }, schedule: () => 0, cancel: () => {} });
  await loaded.attach('item-9', 'Written earlier');
  assert.deepEqual(written, [], 'what the item already says is not sent back to it');
});

test('the reason, the subject and the link are sent on their own routes', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, method: options.method, body: JSON.parse(options.body) });
    return { ok: true, status: 200, json: async () => ({ id: 'subject-1', name: 'Astronomy' }) };
  };
  await patchItemReason('http://host', 'item-1', 'Read it twice', fetcher);
  const subject = await createSubjectNamed('http://host', 'Astronomy', fetcher);
  await linkItemToSubject('http://host', 'item-1', subject.id, fetcher);
  assert.deepEqual(calls[0], { url: 'http://host/api/library/items/item-1', method: 'PATCH', body: { reason: 'Read it twice' } });
  assert.deepEqual(calls[1], { url: 'http://host/api/core/subjects', method: 'POST', body: { name: 'Astronomy' } });
  assert.deepEqual(calls[2], { url: 'http://host/api/core/links', method: 'POST',
    body: { src_id: 'item-1', dst_id: 'subject-1', kind: 'about' } });
  await assert.rejects(patchItemReason('http://host', 'i', '', async () => ({ ok: false, status: 500 })), /HTTP 500/);
  await assert.rejects(linkItemToSubject('http://host', 'i', 'd', async () => { throw new Error('down'); }), /did not answer/);
});

test('deleting an item removes it on the server and drops its stored result', async () => {
  const store = { [resultKey(tab.url)]: { state: 'saved', id: 'item-1' }, 'save:other': { state: 'saved', id: 'o' } };
  const api = { storage: { local: { remove: async (key) => { delete store[key]; } } } };
  const calls = [];
  const result = await deleteSavedItem(api, tab.url, 'http://host', 'item-1', async (url, options) => {
    calls.push({ url, method: options.method });
    return { ok: true, status: 204 };
  });
  assert.deepEqual(calls, [{ url: 'http://host/api/library/items/item-1', method: 'DELETE' }]);
  assert.equal(result.state, 'deleted');
  assert.equal(store[resultKey(tab.url)], undefined);
  assert.deepEqual(store['save:other'], { state: 'saved', id: 'o' });
  const gone = { [resultKey(tab.url)]: { state: 'saved', id: 'item-2' } };
  await deleteSavedItem({ storage: { local: { remove: async (key) => { delete gone[key]; } } } },
    tab.url, 'http://host', 'item-2', async () => ({ ok: false, status: 404 }));
  assert.equal(gone[resultKey(tab.url)], undefined, 'an item somebody else deleted still leaves no stored result');
  await assert.rejects(deleteSavedItem({ storage: { local: { remove: async () => assert.fail('must not clear') } } },
    tab.url, 'http://host', 'item-3', async () => ({ ok: false, status: 500 })), /HTTP 500/);
});
