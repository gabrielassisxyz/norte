import { clearOrphanedSaving, createSaveService, loadTargets } from './service.js';
import { configuredOrigin } from './settings.js';

const browserAPI = globalThis.browser ?? chrome;
const save = createSaveService(browserAPI);
clearOrphanedSaving(browserAPI).catch(() => {});

browserAPI.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== browserAPI.runtime.id) return false;
  let task;
  if (message.type === 'save') task = save(message.tab, message.fields);
  else if (message.type === 'targets') {
    task = configuredOrigin(browserAPI).then((origin) => origin ? loadTargets(origin, message.query ?? '') : []);
  } else return false;
  task.then(respond, () => respond({ error: 'The links could not be loaded.' }));
  return true;
});
