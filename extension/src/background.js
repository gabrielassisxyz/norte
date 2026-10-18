import { clearOrphanedSaving, createSaveService, createSubjectNamed, deleteSavedItem, linkItemToSubject,
  loadTargets, patchItemReason, CONFIGURE } from './service.js';
import { configuredOrigin } from './settings.js';

const browserAPI = globalThis.browser ?? chrome;
const save = createSaveService(browserAPI);
clearOrphanedSaving(browserAPI).catch(() => {});

async function withOrigin(handler) {
  const origin = await configuredOrigin(browserAPI);
  if (!origin) throw new Error(CONFIGURE);
  return await handler(origin);
}

browserAPI.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== browserAPI.runtime.id) return false;
  let task;
  if (message.type === 'save') task = save(message.tab, message.fields);
  else if (message.type === 'targets') {
    task = configuredOrigin(browserAPI).then((origin) => origin ? loadTargets(origin, message.query ?? '') : []);
  } else if (message.type === 'reason') {
    task = withOrigin((origin) => patchItemReason(origin, message.id, message.reason));
  } else if (message.type === 'subject') {
    task = withOrigin((origin) => createSubjectNamed(origin, message.name));
  } else if (message.type === 'link') {
    task = withOrigin((origin) => linkItemToSubject(origin, message.src_id, message.dst_id));
  } else if (message.type === 'delete') {
    task = withOrigin((origin) => deleteSavedItem(browserAPI, message.url, origin, message.id));
  } else return false;
  task.then(respond, (error) => respond({ error: error?.message || 'The request failed. Try again.' }));
  return true;
});
