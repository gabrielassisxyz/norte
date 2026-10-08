// This function is serialized by scripting.executeScript: keep it self-contained.
export function capturePage() {
  const snapshot = { url: location.href, title: document.title, html: document.documentElement.outerHTML };
  const selected = window.getSelection();
  if (!selected || selected.isCollapsed || !selected.rangeCount) return snapshot;
  const range = selected.getRangeAt(0);
  // Text the reader never extracts must not enter the context, or it would not match.
  const hidden = 'script, style, noscript, template';
  const visibleText = (range) => {
    const parts = [];
    const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest(hidden)) continue;
      const first = range.comparePoint(node, 0), last = range.comparePoint(node, node.data.length);
      const start = node === range.startContainer ? range.startOffset : first === 0 ? 0 : -1;
      const end = node === range.endContainer ? range.endOffset : last === 0 ? node.data.length : -1;
      if (start >= 0 && end > start) parts.push(node.data.slice(start, end));
    }
    return parts.join('');
  };
  const before = document.createRange();
  before.selectNodeContents(document.body);
  before.setEnd(range.startContainer, range.startOffset);
  const after = document.createRange();
  after.selectNodeContents(document.body);
  after.setStart(range.endContainer, range.endOffset);
  snapshot.selection = {
    exact: range.toString(),
    prefix: Array.from(visibleText(before)).slice(-32).join(''),
    suffix: Array.from(visibleText(after)).slice(0, 32).join(''),
  };
  return snapshot;
}
