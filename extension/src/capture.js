// This function is serialized by scripting.executeScript: keep it self-contained.
export function capturePage() {
  const snapshot = { url: location.href, title: document.title, html: document.documentElement.outerHTML };
  const selected = window.getSelection();
  if (!selected || selected.isCollapsed || !selected.rangeCount) return snapshot;
  const range = selected.getRangeAt(0);
  const before = document.createRange();
  before.selectNodeContents(document.body);
  before.setEnd(range.startContainer, range.startOffset);
  const after = document.createRange();
  after.selectNodeContents(document.body);
  after.setStart(range.endContainer, range.endOffset);
  snapshot.selection = {
    exact: range.toString(),
    prefix: Array.from(before.toString()).slice(-32).join(''),
    suffix: Array.from(after.toString()).slice(0, 32).join(''),
  };
  return snapshot;
}
