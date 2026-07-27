const assert = require('assert');
const path = require('path');

const { accumulateIframeOffset, buildWorkbenchPaneRowProbe, matchesPaneRowText } = require(path.join(__dirname, '..', 'scripts', 'dogfood', 'workbench-pane-row.js'));

assert.deepStrictEqual(
  accumulateIframeOffset({ x: 11, y: 13 }, { left: 17, top: 19 }, 2, 3),
  { x: 30, y: 35 },
  'nested same-origin iframe coordinates must accumulate every frame rect and client border into the physical workbench point'
);

for (const [element, wanted] of [
  [{ innerText: 'master', getAttribute: () => '' }, 'master'],
  [{ textContent: '', getAttribute: name => name === 'title' ? 'other-repo → main' : '' }, 'other-repo'],
  [{ textContent: '', getAttribute: name => name === 'aria-label' ? 'master branch' : '' }, 'master']
]) {
  assert(matchesPaneRowText(element, wanted), `pane-row matching must include visible text, title, and aria-label for ${wanted}`);
}

const textProbe = buildWorkbenchPaneRowProbe({ label: '3 BRANCHES', rowIndex: 0, wantedRowText: 'master' });
assert(textProbe.includes("visit(element.shadowRoot, offset)"), 'text row probe must traverse open shadow roots within the located pane');
assert(textProbe.includes('element.contentDocument') && textProbe.includes('Cross-origin iframe: inaccessible by design.'), 'text row probe must traverse only safely readable same-origin iframes');
assert(textProbe.includes('accumulateIframeOffset(offset, frameRect, element.clientLeft, element.clientTop)'), 'text row probe must add nested iframe offsets before returning CDP physical coordinates');
assert(textProbe.includes("globalThis[targetKey] = { target: row, root }") && textProbe.includes('saved.target.getRootNode() !== saved.root'), 'text row probe must verify focus/selection against the exact root that produced the target');
assert(textProbe.includes("if (!wantedRowText)"), 'text row probe must keep the geometric compatibility branch unreachable for text selection');
assert(textProbe.includes("root.querySelectorAll?.('*')"), 'text row probe must include visible LGVS elements that do not expose Monaco row semantics');

const numericProbe = buildWorkbenchPaneRowProbe({ label: '2 FILES', rowIndex: 1 });
assert(numericProbe.includes('rowIndex * 22'), 'numeric compatibility calls retain the explicit geometric fallback');

console.log('workbenchPaneRowTraversal tests passed');