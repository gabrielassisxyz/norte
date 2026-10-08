import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { capturePage } from '../src/capture.js';

function capture(before, exact, after) {
  const dom = new JSDOM('<!doctype html><title>Article</title><body><p></p></body>', { url: 'https://example.test/article', runScripts: 'outside-only' });
  const text = dom.window.document.querySelector('p');
  text.textContent = before + exact + after;
  const range = dom.window.document.createRange();
  range.setStart(text.firstChild, before.length);
  range.setEnd(text.firstChild, before.length + exact.length);
  dom.window.getSelection().addRange(range);
  const snapshot = dom.window.eval(`(${capturePage.toString()})()`);
  dom.window.close();
  return JSON.parse(JSON.stringify(snapshot));
}

test('selection has exactly 32 code points on either side, including astral characters', () => {
  const result = capture('start' + '🌱'.repeat(40), 'selected text', '🚀'.repeat(40) + 'end');
  assert.deepEqual(result.selection, { exact: 'selected text', prefix: '🌱'.repeat(32), suffix: '🚀'.repeat(32) });
  assert.equal(result.url, 'https://example.test/article');
  assert.match(result.html, /selected text/);
});

test('selection context is shorter only at document text boundaries', () => {
  assert.deepEqual(capture('🌱x', 'text', 'y🚀').selection, { exact: 'text', prefix: '🌱x', suffix: 'y🚀' });
  assert.deepEqual(capture('', 'all', '').selection, { exact: 'all', prefix: '', suffix: '' });
  assert.equal(capture('before', '', 'after').selection, undefined);
});

test('script, style, noscript and template text never enter the context', () => {
  const dom = new JSDOM(`<!doctype html><body><p>before <script>var hidden = 1;</script><style>.x{}</style>` +
    `<noscript>nojs</noscript><template>tpl</template>[<b id="s">pick</b>]<script>after1()</script> tail</p></body>`,
  { url: 'https://example.test/a', runScripts: 'outside-only' });
  const range = dom.window.document.createRange();
  range.selectNodeContents(dom.window.document.getElementById('s'));
  dom.window.getSelection().addRange(range);
  const { selection } = dom.window.eval(`(${capturePage.toString()})()`);
  dom.window.close();
  assert.equal(selection.exact, 'pick');
  assert.equal(selection.prefix, 'before [');
  assert.equal(selection.suffix, '] tail');
});
