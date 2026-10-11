import { configureServer, DEFAULT_ORIGIN } from './settings.js';
const browserAPI = globalThis.browser ?? chrome;
const input = document.getElementById('origin');
const status = document.getElementById('status');
const button = document.getElementById('connect');
browserAPI.storage.local.get('serverOrigin').then((stored) => { input.value = stored.serverOrigin ?? DEFAULT_ORIGIN; });
document.getElementById('settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  button.disabled = true;
  try {
    await configureServer(input.value, browserAPI);
    status.textContent = 'Server connected.';
  } catch (error) {
    status.textContent = error.message;
  } finally { button.disabled = false; }
});
