import { test, expect } from '@playwright/test';
import { startHarness, articleText, selectedText } from './harness.mjs';

let harness;
test.afterEach(async () => { await harness?.close(); harness = undefined; });

test('loaded extension saves authenticated HTML, metadata and Unicode selection, then the real reader displays extraction', async () => {
  harness = await startHarness();
  const { page, popup, posts, origin, norteOrigin } = harness;
  expect((await fetch(`${origin}/article`)).status).toBe(401);
  const subjectResponse = await fetch(`${norteOrigin}/api/core/subjects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Astronomy', focus: true }),
  });
  expect(subjectResponse.status).toBe(201);
  const subject = await subjectResponse.json();
  await page.evaluate((selected) => {
    const text = document.querySelector('article p').firstChild;
    const range = document.createRange();
    const start = text.textContent.indexOf(selected);
    range.setStart(text, start); range.setEnd(text, start + selected.length);
    window.getSelection().addRange(range);
  }, selectedText);
  const view = await popup();
  await expect(view.getByRole('button', { name: 'Save', exact: true })).toBeFocused();
  await view.getByLabel('Why am I saving this?').fill('Compare observations next month');
  await view.getByLabel('Subject or focus', { exact: true }).selectOption(subject.id);
  await view.getByRole('button', { name: 'Save', exact: true }).focus();
  await view.keyboard.press('Enter');
  await view.keyboard.press('Enter');
  await expect(view.locator('#status')).toHaveText('saved');
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ url: `${origin}/article`, reason: 'Compare observations next month', link_to: [subject.id], source: 'extension' });
  expect(posts[0].html).toContain(articleText);
  expect(posts[0].selection.exact).toBe(selectedText);
  expect(Array.from(posts[0].selection.prefix)).toHaveLength(32);
  expect(Array.from(posts[0].selection.suffix)).toHaveLength(32);
  const id = (await view.locator('#reader').getAttribute('href')).split('/').at(-1);
  let item;
  await expect.poll(async () => {
    item = await (await fetch(`${norteOrigin}/api/library/items/${id}`)).json();
    return item.extract_status;
  }).toBe('done');
  expect(item.source).toBe('extension');
  // The reason the contract pins additionalProperties: false, so a body still
  // carrying `why` would have been refused rather than silently stripped --
  // reading it back off the saved item is what proves the field was accepted.
  expect(item.reason).toBe('Compare observations next month');
  expect(item.content_text).toContain(articleText);
  const reader = await harness.context.newPage();
  await reader.goto(norteOrigin);
  await reader.locator(`a[href="/library/${id}"]`).click();
  await expect(reader.getByText(articleText, { exact: false }).first()).toBeVisible();
});

test('missing host grant asks for settings without a server error', async () => {
  harness = await startHarness({ granted: false });
  const view = await harness.popup();
  await expect(view.locator('#configure')).toBeVisible();
  await expect(view.locator('#configure')).toHaveText('configure the server');
  await expect(view.locator('#configure')).toHaveAttribute('href', 'settings.html');
  await expect(view.locator('#save')).toBeDisabled();
  expect(harness.posts).toHaveLength(0);
});

test('413 stays visible without a URL-only fallback', async () => {
  harness = await startHarness();
  harness.controls.status = 413;
  const view = await harness.popup();
  await expect(view.locator('#save')).toBeEnabled();
  await view.locator('#save').click();
  await expect(view.locator('#status')).toHaveText('the page is too large to save');
  expect(harness.posts).toHaveLength(1);
  expect(harness.posts[0].html).toContain(articleText);
});

test('closing the popup keeps the save alive and results belong only to that URL', async () => {
  harness = await startHarness();
  harness.controls.delay = 500;
  const view = await harness.popup();
  await view.locator('#save').click();
  await view.close();
  await expect.poll(() => harness.posts.length).toBe(1);
  const reopened = await harness.popup();
  await expect(reopened.locator('#status')).toHaveText('saved');
  expect(harness.posts).toHaveLength(1);
  await reopened.close();
  const other = await harness.context.newPage();
  await other.goto(`${harness.origin}/another-article`);
  const otherPopup = await harness.popup(other);
  await expect(otherPopup.locator('#save')).toBeEnabled();
  await expect(otherPopup.locator('#status')).toBeEmpty();
});

test('restricted page sends nothing and a stopped server reports its own error', async () => {
  harness = await startHarness();
  const restricted = await harness.context.newPage();
  await restricted.goto('chrome://version');
  const blocked = await harness.popup(restricted);
  await expect(blocked.locator('#status')).toContainText('This page could not be read');
  await expect(blocked.locator('#save')).toBeDisabled();
  expect(harness.posts).toHaveLength(0);
  await blocked.close();
  const view = await harness.popup();
  await expect(view.locator('#save')).toBeEnabled();
  await harness.stopServer();
  await view.locator('#save').click();
  await expect(view.locator('#status')).toContainText('The server did not answer');
  expect(harness.posts).toHaveLength(0);
});
