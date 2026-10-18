import { test, expect } from '@playwright/test';
import { startHarness, articleText, selectedText } from './harness.mjs';

let harness;
test.afterEach(async () => { await harness?.close(); harness = undefined; });

const savedID = (view) => view.locator('#open').getAttribute('data-href').then((href) => href.split('/').at(-1));

test('opening the popup saves the authenticated page, then the reason, the subject and the delete land on the item', async () => {
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
  // Nothing is clicked: the click on the extension is the save.
  await expect(view.locator('#status')).toHaveText('Saved');
  await expect(view.getByRole('button', { name: 'Open' })).toBeVisible();
  await expect(view.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ url: `${origin}/article`, source: 'extension' });
  expect(posts[0].reason).toBe(undefined);
  expect(posts[0].html).toContain(articleText);
  expect(posts[0].selection.exact).toBe(selectedText);
  expect(Array.from(posts[0].selection.prefix)).toHaveLength(32);
  expect(Array.from(posts[0].selection.suffix)).toHaveLength(32);
  const id = await savedID(view);

  await view.getByLabel('Why am I saving this?').fill('Compare observations next month');
  await expect(view.locator('#reason-state')).toHaveText('Saved');
  // The reason the contract pins additionalProperties: false, so a body still
  // carrying `why` would have been refused rather than silently stripped --
  // reading it back off the saved item is what proves the field was accepted.
  await expect.poll(async () => (await (await fetch(`${norteOrigin}/api/library/items/${id}`)).json()).reason)
    .toBe('Compare observations next month');

  await view.locator('#subject').click();
  await view.getByRole('option', { name: 'Astronomy' }).click();
  await expect(view.locator('#chips')).toHaveText('Astronomy');
  await view.locator('#subject').fill('Field notebooks');
  await view.getByRole('option', { name: 'Create "Field notebooks"' }).click();
  await expect(view.locator('.chip')).toHaveCount(2);
  const links = await (await fetch(`${norteOrigin}/api/core/links?src_id=${id}&kind=about`)).json();
  expect(links.items.map((link) => link.dst.title).sort()).toEqual(['Astronomy', 'Field notebooks']);
  expect(links.items.some((link) => link.dst.id === subject.id)).toBe(true);

  let item;
  await expect.poll(async () => {
    item = await (await fetch(`${norteOrigin}/api/library/items/${id}`)).json();
    return item.extract_status;
  }).toBe('done');
  expect(item.source).toBe('extension');
  expect(item.content_text).toContain(articleText);
  const reader = await harness.context.newPage();
  await reader.goto(norteOrigin);
  await reader.locator(`a[href="/library/${id}"]`).click();
  await expect(reader.getByText(articleText, { exact: false }).first()).toBeVisible();
  await reader.close();

  await view.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(view.locator('#confirm-question')).toHaveText('Delete this item?');
  await view.locator('#confirm-delete').click();
  await expect(view.locator('#status')).toHaveText('Deleted');
  expect((await fetch(`${norteOrigin}/api/library/items/${id}`)).status).toBe(404);
  await view.close();
  // The stored result went with the item, so the next click saves the page again.
  const again = await popup();
  await expect(again.locator('#status')).toHaveText('Saved');
  expect(posts).toHaveLength(2);
  expect(await savedID(again)).not.toBe(id);
});

test('Open shows the item in the library in its own tab', async () => {
  harness = await startHarness();
  const view = await harness.popup();
  await expect(view.locator('#status')).toHaveText('Saved');
  const id = await savedID(view);
  const opened = harness.context.waitForEvent('page');
  await view.getByRole('button', { name: 'Open' }).click();
  const reader = await opened;
  expect(reader.url()).toBe(`${harness.origin}/library/${id}`);
});

test('reopening the popup on a saved URL edits that item instead of saving again', async () => {
  harness = await startHarness();
  const view = await harness.popup();
  await expect(view.locator('#status')).toHaveText('Saved');
  const id = await savedID(view);
  await view.getByLabel('Why am I saving this?').fill('Worth a second pass');
  await expect(view.locator('#reason-state')).toHaveText('Saved');
  await view.close();
  const reopened = await harness.popup();
  await expect(reopened.locator('#status')).toHaveText('Saved');
  expect(harness.posts).toHaveLength(1);
  expect(await savedID(reopened)).toBe(id);
  await expect(reopened.getByLabel('Why am I saving this?')).toHaveValue('Worth a second pass');
});

test('missing host grant asks for settings without a server error', async () => {
  harness = await startHarness({ granted: false });
  const view = await harness.popup();
  await expect(view.locator('#configure')).toBeVisible();
  await expect(view.locator('#configure')).toHaveText('configure the server');
  await expect(view.locator('#configure')).toHaveAttribute('href', 'settings.html');
  await expect(view.locator('#actions')).toBeHidden();
  expect(harness.posts).toHaveLength(0);
});

test('413 stays visible without a URL-only fallback, and Retry sends the save again', async () => {
  harness = await startHarness();
  harness.controls.status = 413;
  const view = await harness.popup();
  await expect(view.locator('#status')).toHaveText('the page is too large to save');
  await expect(view.locator('#actions')).toBeHidden();
  expect(harness.posts).toHaveLength(1);
  expect(harness.posts[0].html).toContain(articleText);
  harness.controls.status = 0;
  await view.locator('#retry').click();
  await expect(view.locator('#status')).toHaveText('Saved');
  expect(harness.posts).toHaveLength(2);
});

test('closing the popup keeps the save alive and results belong only to that URL', async () => {
  harness = await startHarness();
  harness.controls.delay = 500;
  const view = await harness.popup();
  await expect(view.locator('#status')).toHaveText('Saving…');
  await view.close();
  await expect.poll(() => harness.posts.length).toBe(1);
  const reopened = await harness.popup();
  await expect(reopened.locator('#status')).toHaveText('Saved');
  expect(harness.posts).toHaveLength(1);
  await reopened.close();
  const other = await harness.context.newPage();
  await other.goto(`${harness.origin}/another-article`);
  const otherPopup = await harness.popup(other);
  await expect(otherPopup.locator('#status')).toHaveText('Saved');
  await expect.poll(() => harness.posts.length).toBe(2);
  expect(harness.posts[1].url).toBe(`${harness.origin}/another-article`);
});

test('restricted page sends nothing and a stopped server reports its own error', async () => {
  harness = await startHarness();
  const restricted = await harness.context.newPage();
  await restricted.goto('chrome://version');
  const blocked = await harness.popup(restricted);
  await expect(blocked.locator('#status')).toContainText('This page could not be read');
  await expect(blocked.locator('#editor')).toBeHidden();
  await expect(blocked.locator('#retry')).toBeHidden();
  expect(harness.posts).toHaveLength(0);
  await blocked.close();
  await harness.stopServer();
  const view = await harness.popup();
  await expect(view.locator('#status')).toContainText('The server did not answer');
  expect(harness.posts).toHaveLength(0);
});
