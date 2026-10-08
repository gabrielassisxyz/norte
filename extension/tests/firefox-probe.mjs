import assert from 'node:assert/strict';

async function waitForFirefox(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await check();
    if (result) return result;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error('Firefox extension smoke timed out');
}

// web-ext's older RDP client does not recognize these unsolicited DevTools events.
// Keep them out of its request/reply queue so startup is tested in the real browser.
export async function probeFirefoxBackground(desktop, sourceDir) {
  const remote = desktop.remoteFirefox;
  const client = remote.client;
  const addonId = desktop.reloadableExtensions.get(sourceDir);
  assert.ok(addonId, 'Firefox installed the extension');
  const addon = await waitForFirefox(async () => {
    const candidate = await remote.getInstalledAddon(addonId);
    return candidate.backgroundScriptStatus === 'RUNNING' ? candidate : null;
  });
  assert.equal(addon.debuggable, true);
  const events = [];
  const originalHandler = client._handleMessage.bind(client);
  client._handleMessage = (packet) => {
    if (['target-available-form', 'target-destroyed-form', 'evaluationResult', 'resources-available-array'].includes(packet.type)) {
      events.push(packet);
      return;
    }
    originalHandler(packet);
  };
  async function evaluate(target, text) {
    const { resultID } = await client.request({ to: target.consoleActor, type: 'evaluateJSAsync', text });
    const result = await waitForFirefox(() => events.find((event) => event.type === 'evaluationResult' && event.resultID === resultID));
    assert.equal(result.hasException, false, result.exceptionMessage);
    return result.result;
  }
  const watcher = await client.request({ to: addon.actor, type: 'getWatcher' });
  await client.request({ to: watcher.actor, type: 'watchTargets', targetType: 'frame' });
  const background = await waitForFirefox(() => events.find((event) => event.target?.url.endsWith('_generated_background_page.html'))?.target);
  await evaluate(background, 'browser.tabs.create({url: browser.runtime.getURL("popup.html")}); true');
  const popup = await waitForFirefox(() => events.find((event) => event.target?.url.endsWith('/popup.html'))?.target);
  await evaluate(popup, `browser.runtime.sendMessage({type: 'targets'}).then(
    result => globalThis.norteSmokeResult = JSON.stringify(result),
    error => globalThis.norteSmokeError = String(error)); true`);
  const result = await waitForFirefox(async () => {
    const value = await evaluate(popup, 'globalThis.norteSmokeResult || globalThis.norteSmokeError || ""');
    return typeof value === 'string' && value ? value : false;
  });
  assert.equal(result, '[]', 'Firefox popup receives a response from the background listener');
}
