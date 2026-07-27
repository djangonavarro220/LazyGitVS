'use strict';

function matchesPaneRowText(element, wanted) {
  if (!wanted || !element) return false;
  const text = element.innerText || element.textContent || '';
  const title = element.getAttribute?.('title') || '';
  const ariaLabel = element.getAttribute?.('aria-label') || '';
  return [text, title, ariaLabel].some(value => value.includes(wanted));
}

function accumulateIframeOffset(offset, rect, clientLeft = 0, clientTop = 0) {
  return {
    x: offset.x + rect.left + clientLeft,
    y: offset.y + rect.top + clientTop
  };
}

function buildWorkbenchPaneRowProbe({ label, rowIndex, wantedRowText, verify = false }) {
  return `(() => {
    const wanted = ${JSON.stringify(label)};
    const rowIndex = ${JSON.stringify(rowIndex)};
    const wantedRowText = ${JSON.stringify(wantedRowText)};
    const verify = ${JSON.stringify(verify)};
    const targetKey = '__lgvsDogfoodPaneRowTarget';
    ${matchesPaneRowText.toString()}
    ${accumulateIframeOffset.toString()}
    const isVisible = element => {
      const rect = element?.getBoundingClientRect?.();
      return !!rect && rect.width > 0 && rect.height > 0;
    };
    const header = Array.from(document.querySelectorAll('.pane-header')).find(element =>
      isVisible(element) && ((element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim()).includes(wanted)
    );
    const pane = header?.closest('.pane');
    const body = pane?.querySelector('.pane-body') || header?.nextElementSibling;
    if (!body || !isVisible(body)) return undefined;
    if (verify) {
      const saved = globalThis[targetKey];
      delete globalThis[targetKey];
      if (!saved || !saved.target || !saved.root || saved.target.getRootNode() !== saved.root || !matchesPaneRowText(saved.target, wantedRowText)) return false;
      const active = saved.target.ownerDocument?.activeElement;
      const selectedAncestor = saved.target.closest?.('[aria-selected="true"], .focused, .selected');
      return saved.target.getAttribute('aria-selected') === 'true' || saved.target.classList.contains('focused') || saved.target.classList.contains('selected') || !!selectedAncestor || saved.target === active || saved.target.contains(active);
    }
    if (!wantedRowText) {
      const rect = body.getBoundingClientRect();
      return { x: rect.left + Math.min(100, Math.max(24, rect.width / 3)), y: rect.top + 18 + (rowIndex * 22) };
    }
    const roots = [];
    const visit = (root, offset) => {
      roots.push({ root, offset });
      for (const element of Array.from(root.querySelectorAll?.('*') || [])) {
        if (element.shadowRoot) visit(element.shadowRoot, offset);
        if (element.tagName !== 'IFRAME') continue;
        try {
          const frameDocument = element.contentDocument;
          if (!frameDocument) continue;
          const frameRect = element.getBoundingClientRect();
          if (frameRect.width <= 0 || frameRect.height <= 0) continue;
          visit(frameDocument, accumulateIframeOffset(offset, frameRect, element.clientLeft, element.clientTop));
        } catch { /* Cross-origin iframe: inaccessible by design. */ }
      }
    };
    visit(body, { x: 0, y: 0 });
    for (const { root, offset } of roots) {
      const rowSelector = '.monaco-list-row, [role="option"], [role="row"], [role="treeitem"], [title], [aria-label]';
      const rows = Array.from(root.querySelectorAll?.(rowSelector) || []);
      const matchingRows = rows.filter(element => isVisible(element) && matchesPaneRowText(element, wantedRowText));
      const row = matchingRows[0] || Array.from(root.querySelectorAll?.('*') || [])
        .filter(element => isVisible(element) && matchesPaneRowText(element, wantedRowText))
        .sort((a, b) => {
          const aRect = a.getBoundingClientRect();
          const bRect = b.getBoundingClientRect();
          return (aRect.width * aRect.height) - (bRect.width * bRect.height);
        })[0];
      if (!row) continue;
      const rect = row.getBoundingClientRect();
      globalThis[targetKey] = { target: row, root };
      return {
        x: offset.x + rect.left + Math.min(100, Math.max(24, rect.width / 3)),
        y: offset.y + rect.top + rect.height / 2,
        rowText: wantedRowText
      };
    }
    return undefined;
  })()`;
}

module.exports = { accumulateIframeOffset, buildWorkbenchPaneRowProbe, matchesPaneRowText };
