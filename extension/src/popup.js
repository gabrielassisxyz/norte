import { configuredOrigin } from './settings.js';
import { CANNOT_READ, CONFIGURE, createReasonWriter, readableURL, resultKey, settleStale } from './service.js';

const browserAPI = globalThis.browser ?? chrome;
const element = (id) => document.getElementById(id);
const SUBJECT_DEBOUNCE_MS = 150;

let tab;
let item;
let deleted = false;
let links = [];
let queuedReason = false;
let staleTimer;
let subjectTimer;
let searchVersion = 0;
let options = [];
let active = -1;

async function send(message) {
  const answer = await browserAPI.runtime.sendMessage(message);
  if (answer?.error) throw new Error(answer.error);
  return answer;
}

const reasonState = { saving: 'Saving…', saved: 'Saved', error: 'The note could not be saved. Try again.' };
const reason = createReasonWriter({
  write: (id, text) => send({ type: 'reason', id, reason: text }).then(() => store({ reason: text })),
  onState: (state) => { element('reason-state').textContent = reasonState[state] ?? ''; },
});

// The stored result is what a reopened popup renders, so an edit that succeeded
// has to land in it as well as on the server.
async function store(fields) {
  const key = resultKey(tab.url);
  const stored = (await browserAPI.storage.local.get(key))[key];
  if (stored?.state !== 'saved') return;
  await browserAPI.storage.local.set({ [key]: { ...stored, ...fields } });
}

function renderChips() {
  element('chips').replaceChildren(...links.map((subject) => {
    const chip = document.createElement('li');
    chip.className = 'chip';
    chip.textContent = subject.title;
    return chip;
  }));
}

function render(stored) {
  clearTimeout(staleTimer);
  const result = settleStale(stored, Date.now());
  if (result?.state === 'saving') staleTimer = setTimeout(() => render(result), Math.max(result.deadline - Date.now(), 0) + 1);
  const saving = result?.state === 'saving';
  const saved = result?.state === 'saved' && !deleted;
  element('status').textContent = deleted ? 'Deleted' : saving ? 'Saving…' : saved ? 'Saved' : result?.message ?? '';
  element('configure').hidden = result?.message !== CONFIGURE;
  element('actions').hidden = !saved;
  // The reason box stays live while the page is still uploading: what is typed
  // there is queued and written as soon as the item exists.
  element('editor').hidden = !saved && !saving;
  element('subject').disabled = !saved;
  element('retry').hidden = deleted || result?.state !== 'error' ||
    result?.message === CANNOT_READ || result?.message === CONFIGURE;
  if (!saved) return;
  item = { id: result.id, origin: result.origin };
  element('open').dataset.href = `${result.origin}/library/${result.id}`;
  links = result.links ?? [];
  renderChips();
  reason.attach(result.id, result.reason ?? '');
  if (!element('reason').value && !queuedReason) element('reason').value = result.reason ?? '';
}

async function startSave() {
  element('confirm').hidden = true;
  render({ state: 'saving' });
  element('reason').focus();
  try {
    render(await browserAPI.runtime.sendMessage({ type: 'save', tab: { id: tab.id, url: tab.url } }));
  } catch {
    render({ state: 'error', message: 'Could not save. Try again.' });
  }
}

function closeOptions() {
  options = [];
  active = -1;
  element('subject-options').hidden = true;
  element('subject').setAttribute('aria-expanded', 'false');
  element('subject').removeAttribute('aria-activedescendant');
}

function renderOptions() {
  element('subject-options').replaceChildren(...options.map((option, index) => {
    const row = document.createElement('li');
    row.id = `subject-option-${index}`;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(index === active));
    row.className = index === active ? 'option active' : 'option';
    row.textContent = option.create ? `Create "${option.title}"` : option.title;
    row.addEventListener('mousedown', (event) => { event.preventDefault(); choose(option); });
    return row;
  }));
  element('subject-options').hidden = options.length === 0;
  element('subject').setAttribute('aria-expanded', String(options.length > 0));
  if (active >= 0) element('subject').setAttribute('aria-activedescendant', `subject-option-${active}`);
  else element('subject').removeAttribute('aria-activedescendant');
}

async function loadOptions() {
  const version = ++searchVersion;
  const query = element('subject').value.trim();
  const found = await send({ type: 'targets', query });
  if (version !== searchVersion) return;
  const linked = new Set(links.map((subject) => subject.id));
  options = found.filter((target) => target.type === 'subject' && !linked.has(target.id));
  if (query && !options.some((option) => option.title.toLowerCase() === query.toLowerCase())) {
    options.push({ title: query, create: true });
  }
  active = options.length ? 0 : -1;
  renderOptions();
}

async function choose(option) {
  if (!item) return;
  closeOptions();
  element('subject').value = '';
  element('subject-state').textContent = 'Linking…';
  try {
    const subject = option.create ? await send({ type: 'subject', name: option.title }) : option;
    await send({ type: 'link', src_id: item.id, dst_id: subject.id });
    links = [...links, { id: subject.id, title: subject.name ?? subject.title }];
    renderChips();
    await store({ links });
    element('subject-state').textContent = '';
  } catch (error) {
    element('subject-state').textContent = error.message;
  }
}

async function remove() {
  element('confirm').hidden = true;
  element('status').textContent = 'Deleting…';
  try {
    await send({ type: 'delete', id: item.id, url: tab.url });
    deleted = true;
    render({ state: 'deleted' });
  } catch (error) {
    element('status').textContent = error.message;
    element('confirm').hidden = true;
  }
}

element('reason').addEventListener('input', () => {
  queuedReason = true;
  reason.type(element('reason').value);
});
element('reason').addEventListener('blur', () => { reason.blur(); });

element('subject').addEventListener('focus', () => { loadOptions().catch(subjectFailed); });
element('subject').addEventListener('input', () => {
  clearTimeout(subjectTimer);
  subjectTimer = setTimeout(() => loadOptions().catch(subjectFailed), SUBJECT_DEBOUNCE_MS);
});
element('subject').addEventListener('blur', () => closeOptions());
element('subject').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') return closeOptions();
  if (!options.length) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    active = (active + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length;
    renderOptions();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if (active >= 0) choose(options[active]);
  }
});

function subjectFailed() {
  element('subject-state').textContent = 'The subjects could not be loaded.';
}

element('open').addEventListener('click', () => {
  browserAPI.tabs.create({ url: element('open').dataset.href });
});
element('delete').addEventListener('click', () => { element('confirm').hidden = false; });
element('cancel-delete').addEventListener('click', () => { element('confirm').hidden = true; });
element('confirm-delete').addEventListener('click', () => { remove(); });
element('retry').addEventListener('click', () => { startSave(); });

browserAPI.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !tab || deleted || !changes[resultKey(tab.url)]) return;
  render(changes[resultKey(tab.url)].newValue);
});

async function initialize() {
  [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });
  element('title').textContent = tab?.title || 'Save the page';
  if (!tab || !readableURL(tab.url)) return render({ state: 'error', message: CANNOT_READ });
  if (!await configuredOrigin(browserAPI)) return render({ state: 'error', message: CONFIGURE });
  const key = resultKey(tab.url);
  const stored = settleStale((await browserAPI.storage.local.get(key))[key], Date.now());
  // A URL already saved is edited, never saved twice: the click was the undo
  // of a click, not a second save.
  if (stored?.state === 'saved') {
    render(stored);
    element('reason').focus();
    return;
  }
  await startSave();
}
initialize().catch(() => render({ state: 'error', message: 'Norte could not be opened. Try again.' }));
