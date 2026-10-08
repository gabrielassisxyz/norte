import { configuredOrigin } from './settings.js';
import { CANNOT_READ, CONFIGURE, readableURL, resultKey, settleStale } from './service.js';

const browserAPI = globalThis.browser ?? chrome;
const element = (id) => document.getElementById(id);
let tab;
let available = false;
let submitting = false;
let searchVersion = 0;

let staleTimer;
function render(stored) {
  clearTimeout(staleTimer);
  const result = settleStale(stored, Date.now());
  if (result?.state === 'saving') staleTimer = setTimeout(() => render(result), Math.max(result.deadline - Date.now(), 0) + 1);
  submitting = result?.state === 'saving';
  element('save').disabled = !available || submitting;
  element('status').textContent = submitting ? 'Salvando…' : result?.state === 'saved' ? 'salvo' : result?.message ?? '';
  element('configure').hidden = result?.message !== CONFIGURE;
  element('reader').hidden = result?.state !== 'saved';
  if (result?.state === 'saved') element('reader').href = `${result.origin}/biblioteca/${result.id}`;
}

async function targets() {
  const version = ++searchVersion;
  const result = await browserAPI.runtime.sendMessage({ type: 'targets', query: element('search').value });
  if (version !== searchVersion) return;
  element('targets-status').textContent = result.error ?? '';
  if (result.error) return;
  const selected = element('link').selectedOptions[0];
  const options = result.map((target) => new Option(target.title, target.id));
  if (selected?.value && !result.some((target) => target.id === selected.value)) options.unshift(selected.cloneNode(true));
  element('link').replaceChildren(new Option('Sem vínculo', ''), ...options);
  element('link').value = selected?.value ?? '';
}

browserAPI.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && tab && changes[resultKey(tab.url)]) render(changes[resultKey(tab.url)].newValue);
});

element('save-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!available || submitting) return;
  render({ state: 'saving' });
  browserAPI.runtime.sendMessage({ type: 'save', tab: { id: tab.id, url: tab.url },
    fields: { why: element('why').value, link_to: element('link').value } })
    .then(render, () => render({ state: 'error', message: 'Não foi possível salvar. Tente novamente.' }));
});

let searchTimer;
element('search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => targets().catch(() => {
    element('targets-status').textContent = 'Não foi possível carregar os vínculos.';
  }), 150);
});

async function initialize() {
  [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });
  element('title').textContent = tab?.title || 'Salvar página';
  if (!tab || !readableURL(tab.url)) return render({ state: 'error', message: CANNOT_READ });
  if (!await configuredOrigin(browserAPI)) return render({ state: 'error', message: CONFIGURE });
  available = true;
  const stored = await browserAPI.storage.local.get(resultKey(tab.url));
  render(stored[resultKey(tab.url)]);
  element('save').focus();
  await targets();
}
initialize().catch(() => render({ state: 'error', message: 'Não foi possível abrir o Norte. Tente novamente.' }));
