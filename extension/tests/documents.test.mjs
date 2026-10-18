import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

test('manifest describes the extension and its action in English', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.description, 'Save the current page to your Norte library.');
  assert.equal(manifest.action.default_title, 'Save to Norte');
});

test('popup.html is English, with lang, a roomy note box and one subject combobox', async () => {
  const dom = new JSDOM(await readFile(new URL('../src/popup.html', import.meta.url), 'utf8'));
  const document = dom.window.document;
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(document.title, 'Save to Norte');
  assert.equal(document.querySelector('header a').textContent, 'Settings');
  assert.equal(document.getElementById('title').textContent, 'Save the page');
  const reason = document.getElementById('reason');
  assert.equal(reason.tagName, 'TEXTAREA', 'the note is a textarea, not a one-line input');
  assert.ok(Number(reason.getAttribute('rows')) >= 5, 'the note box is at least five lines tall');
  assert.equal(reason.placeholder, 'Why am I saving this?');
  assert.equal(document.querySelector('label[for="reason"]').textContent, 'Why am I saving this? (optional)');
  const subject = document.getElementById('subject');
  assert.equal(subject.getAttribute('role'), 'combobox');
  assert.equal(subject.getAttribute('aria-controls'), 'subject-options');
  assert.equal(subject.getAttribute('aria-label'), 'Link to a subject');
  assert.equal(subject.placeholder, 'Search for a subject');
  assert.equal(document.querySelector('label[for="subject"]').textContent, 'Link to a subject (optional)');
  assert.equal(document.getElementById('subject-options').getAttribute('role'), 'listbox');
  assert.equal(document.getElementById('open').tagName, 'BUTTON');
  assert.equal(document.getElementById('open').textContent.trim(), 'Open');
  assert.equal(document.getElementById('delete').textContent, 'Delete');
  assert.equal(document.getElementById('confirm-question').textContent, 'Delete this item?');
  assert.equal(document.getElementById('cancel-delete').textContent, 'Keep');
  assert.equal(document.getElementById('retry').textContent, 'Retry');
  assert.equal(document.getElementById('configure').textContent, 'configure the server');
});

test('the note box cannot be dragged into another shape', async () => {
  const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /textarea\s*\{[^}]*resize:\s*none/, 'the reason box is not resizable');
});

test('settings.html is English, with lang and the connect form', async () => {
  const dom = new JSDOM(await readFile(new URL('../src/settings.html', import.meta.url), 'utf8'));
  const document = dom.window.document;
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(document.title, 'Configure Norte');
  assert.equal(document.querySelector('h1').textContent, 'Connect to the server');
  assert.equal(document.querySelector('main p').textContent, "Use Norte's address on your computer or your network.");
  assert.equal(document.querySelector('label[for="origin"]').textContent, 'Server address');
  assert.equal(document.getElementById('connect').textContent, 'Connect');
});