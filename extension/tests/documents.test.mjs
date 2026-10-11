import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

test('popup.html is English, with lang and the reason-labelled note input', async () => {
  const dom = new JSDOM(await readFile(new URL('../src/popup.html', import.meta.url), 'utf8'));
  const document = dom.window.document;
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(document.title, 'Save to Norte');
  assert.equal(document.querySelector('header a').textContent, 'Settings');
  assert.equal(document.getElementById('title').textContent, 'Save the page');
  const reason = document.getElementById('reason');
  assert.ok(reason, 'the note input keeps its reason id');
  assert.equal(reason.placeholder, 'Why am I saving this?');
  assert.equal(document.querySelector('label[for="reason"]').textContent, 'Why am I saving this? (optional)');
  assert.equal(document.querySelector('label[for="search"]').textContent, 'Link to a subject or focus (optional)');
  assert.equal(document.getElementById('search').placeholder, 'Search for a subject');
  assert.equal(document.getElementById('link').getAttribute('aria-label'), 'Subject or focus');
  assert.equal(document.querySelector('#link option').textContent, 'No link');
  assert.equal(document.getElementById('save').textContent, 'Save');
  assert.equal(document.getElementById('configure').textContent, 'configure the server');
  assert.equal(document.getElementById('reader').textContent, 'Open in the library');
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