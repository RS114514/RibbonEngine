// Run: node --experimental-vm-modules tools/test_flowchart_ui.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vmModule from 'node:vm';

const root = new URL('../', import.meta.url);
const css = await readFile(new URL('app/pages/flowchart/flowchart.css', root), 'utf8');
const styles = {};
for (const match of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const values = Object.fromEntries(match[2].split(';').filter(s => s.includes(':')).map(s => {
    const i = s.indexOf(':');
    return [s.slice(0, i).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase()), s.slice(i + 1).trim()];
  }));
  for (const selector of match[1].trim().split(',')) styles[selector.trim().slice(1)] = values;
}
const timers = [];
const context = vmModule.createContext({
  console,
  setTimeout: fn => { timers.push(fn); return timers.length; },
  clearTimeout() {}
});
// common.js imports generated Styles.js and the native gal/storage boundary.
// Only that boundary is replaced; the page and all data imports run unchanged.
const common = new vmModule.SyntheticModule(['S', 'log'], function () {
  this.setExport('S', (names, extra) => Object.assign(
    {}, ...names.split(/\s+/).map(name => styles[name] || {}), extra || {}, { classes: names }
  ));
  this.setExport('log', () => {});
}, { context });
const modules = new Map();
async function load(url) {
  const key = url.href;
  if (modules.has(key)) return modules.get(key);
  const mod = new vmModule.SourceTextModule(await readFile(url, 'utf8'), { context, identifier: key });
  modules.set(key, mod);
  await mod.link(async (specifier, parent) => {
    const target = new URL(specifier, parent.identifier);
    if (target.href === new URL('app/common.js', root).href) return common;
    assert.ok(target.href.startsWith(new URL('app/data/', root).href), 'unexpected non-data dependency: ' + target);
    return load(target);
  });
  return mod;
}
const page = await load(new URL('app/pages/flowchart/flowchart.js', root));
await page.evaluate();
const dataModule = await load(new URL('app/data/flowchart_data.js', root));
if (dataModule.status !== 'evaluated') await dataModule.evaluate();
const data = dataModule.namespace.flowchart_data;
const { flowchartMethods, renderFlowchart } = page.namespace;
const routeNames = ['共通', '宁宁', '宁宁·重启', '巡', '紬', '憧子', '和奏'];
const routeName = Object.fromEntries(data.routes.map((r, i) => [r, routeNames[i]]));
const h = (tag, props, children) => ({ tag, props: props || {}, children: Array.isArray(children) ? children : [children] });
const walk = tree => [tree, ...tree.children.filter(c => c && typeof c === 'object').flatMap(walk)];
const text = tree => tree.children.map(c => typeof c === 'object' && c ? text(c) : (c || '')).join('');
const hasClass = (n, cls) => (n.props.staticStyle?.classes || '').split(' ').includes(cls);
const findAll = (tree, cls) => walk(tree).filter(n => hasClass(n, cls));
function find(tree, cls, label) {
  const found = findAll(tree, cls).find(n => label === undefined || text(n).includes(label));
  assert.ok(found, 'render must expose ' + cls + (label ? ': ' + label : ''));
  return found;
}
const click = node => { assert.equal(typeof node.props.on?.click, 'function'); node.props.on.click(); };
const render = vm => renderFlowchart(vm, h);
const touch = (x, y) => ({ changedTouches: [{ pageX: x, pageY: y }] });
function fresh() {
  const state = { ...flowchartMethods, view: 'flowchart', calls: [], initGame(s, l) { this.calls.push([s, l]); } };
  state.initFlowchart();
  return state;
}
function routeLabel(route) {
  return routeName[route] || route;
}
function show(vm, node) {
  vm.selectFcRoute(routeLabel(node.route));
  vm.resetFcPan();
  const placed = vm._fcLayout.placed[node.id];
  if (placed) {
    vm.flowPanX = -Math.min(placed.x, vm.flowPanMaxX);
    vm.flowPanY = -Math.min(placed.y, vm.flowPanMaxY);
  }
  return render(vm);
}
function raw(id) { return data.nodes.find(n => n.id === id); }
function clickCard(vm, title) { click(find(render(vm), 'fc-node', title)); }
function assertJump(vm, scenario, line) {
  assert.equal(vm.view, 'game');
  assert.equal(vm.currentScenario, scenario);
  assert.equal(vm.currentScenarioData, null);
  assert.deepEqual(vm.calls.at(-1), [scenario, line]);
}

// Regression: replacing next/chain with an empty edge list must fail here.
test('real render connects the prologue to a clickable next-chapter bridge', () => {
  const state = fresh();
  const tree = render(state);
  assert.ok(state._fcLayout.edges.length > 0, 'next/chain must produce edges, not isolated chapter cards');
  assert.ok(findAll(tree, 'fc-edge-h').length > 0, 'render must draw the data edge');
  assert.ok(findAll(tree, 'fc-arrow').length > 0, 'edge direction must be visible');
  clickCard(state, '再老实地夸一次');
  assertJump(state, 'main', 2337);
});

test('all seven route buttons show a multi-node route, not one chapter at a time', () => {
  const state = fresh();
  assert.deepEqual(findAll(render(state), 'fc-route').map(text), routeNames);
  for (const route of routeNames) {
    click(find(render(state), 'fc-route', route));
    assert.equal(state.flowRoute, route);
    const nodes = state.getFcRouteNodes();
    assert.ok(nodes.length >= 2, route + ' must expose a route path, got ' + nodes.length);
    assert.ok(text(render(state)).includes(nodes.length + ' 个节点'), route + ' header shows full node count');
  }
  click(find(render(state), 'fc-route', '共通'));
  assert.ok(state.getFcRouteNodes().length >= 13);
  assert.equal(findAll(render(state), 'fc-chapter-button').length, 0, 'chapter tabs must not fragment the route graph');
});

test('Nene normal end reaches restart monologue, then time reversal, never common prologue', () => {
  const state = fresh();
  show(state, raw('node_nene_normal_end'));
  clickCard(state, '记忆抹除');
  assertJump(state, 'nene', 7157);
  state.view = 'flowchart';
  clickCard(state, '独白扣动扳机');
  assertJump(state, 'nene_restart', 0);
  show(state, raw('node_restart_monologue'));
  clickCard(state, '镜像初秋再会');
  assertJump(state, 'nene_restart', 355);
  show(state, raw('node_restart_true_end'));
  clickCard(state, 'TRUE END');
  assertJump(state, 'nene_restart', 5506);
});

test('every declared next/chain transition remains reachable in the route graph', () => {
  const state = fresh();
  const expected = new Set();
  for (const node of data.nodes) {
    if (node.next) expected.add(node.id + '>' + node.next);
    if (data.chain[node.id]) expected.add(node.id + '>' + data.chain[node.id]);
  }
  const seen = new Set();
  for (const route of routeNames) {
    state.selectFcRoute(route);
    for (const edge of state._fcLayout.edges) {
      const from = state._fcLayout.placed[edge.from];
      const to = state._fcLayout.placed[edge.to];
      assert.ok(from && to, 'every edge has visible/scrollable endpoints');
      assert.ok(Number.isFinite(from.x) && Number.isFinite(to.x));
      if (edge.kind === 'next') {
        const key = edge.from + '>' + edge.to;
        if (expected.has(key)) seen.add(key);
        else assert.ok(edge.from.startsWith('chapter_node:'), 'no invented plot transition: ' + key);
      }
    }
  }
  assert.deepEqual([...seen].sort(), [...expected].sort());
});

test('choice milestones are keyed by route and line, not repeated dummyselect IDs', () => {
  const state = fresh();
  for (const [id, title, line] of [
    ['node_choice_1', '再老实地夸一次', 2337],
    ['node_choice_2', '拜托绫地', 2864]
  ]) {
    show(state, raw(id));
    const card = find(render(state), 'fc-node', title);
    click(card);
    assertJump(state, 'main', line);
  }
  const source = data.choices.find(c => c.route === 'main' && c.targetLine === 8926);
  assert.equal(source.options.length, 4, 'source data still owns all four alternatives');
  assert.ok(state.getFcRouteNodes().some(n => n.targetLine === 8926 && n.type === 'select'));
});

test('choices omitted from major nodes are still selectable without inventing route links', () => {
  const state = fresh();
  for (const choice of data.choices) {
    state.selectFcRoute(routeName[choice.route]);
    const found = state.getFcRouteNodes().some(n => n.targetLine === choice.targetLine && n.type === 'select');
    assert.ok(found, choice.route + ':' + choice.targetLine + ' must have its own selectable source');
  }
  show(state, raw('node_end_meguru'));
  assert.ok(state.getFcRouteNodes().length > 1, 'sparse route gets real chapter nodes, not a lone end card');
  assert.ok(text(render(state)).includes('个节点'));
});

test('graph uses fixed clipped containers with translated child coordinates', () => {
  const state = fresh();
  let tree = render(state);
  for (const n of walk(tree)) {
    const s = n.props.staticStyle || {};
    if (s.width !== undefined) assert.ok(parseFloat(s.width) <= 800, s.classes + ' width');
    if (s.height !== undefined) assert.ok(parseFloat(s.height) <= 220, s.classes + ' height');
  }
  for (const cls of ['fc-root', 'fc-viewport', 'fc-canvas']) {
    assert.equal(find(tree, cls).props.staticStyle.overflow, 'hidden', cls + ' clips natively');
  }
  show(state, raw('node_choice_1'));
  state.resetFcPan();
  const initial = Object.fromEntries(findAll(render(state), 'fc-node').map(n => [n.props.key, n.props.staticStyle.top]));
  assert.ok(state.flowPanMaxY > 0, 'route graph extends beyond viewport logically');
  click(find(render(state), 'fc-pan-button', '↓'));
  assert.ok(state.flowPanY < 0);
  tree = render(state);
  const canvas = find(tree, 'fc-canvas').props.staticStyle;
  assert.equal(parseFloat(canvas.width), 688);
  assert.equal(parseFloat(canvas.height), 152);
  assert.equal(parseFloat(canvas.left), 0);
  assert.equal(parseFloat(canvas.top), 0);
  assert.ok(findAll(tree, 'fc-node').some(n => initial[n.props.key] !== undefined && n.props.staticStyle.top !== initial[n.props.key]), 'pan moves node coordinates, not an oversized canvas');
  for (const n of [...findAll(tree, 'fc-edge-h'), ...findAll(tree, 'fc-edge-v')]) {
    const s = n.props.staticStyle;
    assert.ok(parseFloat(s.width) === 1 || parseFloat(s.height) === 1);
    assert.ok(parseFloat(s.left) >= 0 && parseFloat(s.top) >= 0);
    assert.ok(parseFloat(s.left) + parseFloat(s.width) <= 688);
    assert.ok(parseFloat(s.top) + parseFloat(s.height) <= 152);
  }
  click(find(tree, 'fc-reset', '复位'));
  assert.equal(state.flowPanY, 0);
});

test('dragging, including delayed click and touchend-only displacement, never jumps; next tap does', () => {
  const state = fresh();
  show(state, raw('node_choice_12'));
  let viewport = find(render(state), 'fc-viewport');
  // Native click may retain the originally touched card even after culling.
  const touchedCard = find(render(state), 'fc-node', '可能会投给因幡吧');
  viewport.props.on.touchstart(touch(300, 100));
  viewport.props.on.touchmove(touch(300, 35));
  viewport.props.on.touchend(touch(300, 35));
  while (timers.length) timers.shift()();
  click(touchedCard);
  assert.equal(state.calls.length, 0, 'a delayed synthetic click after drag is suppressed');
  viewport = find(render(state), 'fc-viewport');
  viewport.props.on.touchstart(touch(300, 40));
  viewport.props.on.touchend(touch(300, 100));
  while (timers.length) timers.shift()();
  clickCard(state, '可能会投给因幡吧');
  assert.equal(state.calls.length, 0, 'touchend also checks movement');
  viewport.props.on.touchstart(touch(300, 50));
  viewport.props.on.touchend(touch(300, 50));
  clickCard(state, '可能会投给因幡吧');
  assertJump(state, 'main', 8926);
});

test('all major cards and outgoing nodes preserve their exact scenario/line at the render boundary', () => {
  const state = fresh();
  for (const source of data.nodes) {
    show(state, source);
    clickCard(state, source.title);
    assertJump(state, source.scenario || source.route, source.targetLine);
    if (!source.next) continue;
    const targetPlaced = state._fcLayout.placed[source.next];
    if (!targetPlaced) continue;
    const target = targetPlaced.node;
    state.flowPanX = -Math.min(targetPlaced.x, state.flowPanMaxX);
    state.flowPanY = -Math.min(targetPlaced.y, state.flowPanMaxY);
    const tree = render(state);
    const card = find(tree, 'fc-node', target.title);
    if (routeLabel(target.route) !== routeLabel(source.route)) {
      assert.ok(hasClass(card, 'fc-node-bridge'), 'cross-route endpoint must be distinguished');
    }
    click(card);
    assertJump(state, target.scenario || target.route, target.targetLine);
  }
});

test('Nene jumps refer to the actual scenario arrays, including the monologue and time-reversal opening', async () => {
  const first = await load(new URL('app/data/scn_nene.js', root));
  const restart = await load(new URL('app/data/scn_nene_restart.js', root));
  await first.evaluate();
  await restart.evaluate();
  const firstRows = first.namespace.scn_nene;
  const restartRows = restart.namespace.scn_nene_restart;
  assert.equal(firstRows.length, 7158);
  assert.equal(restartRows.length, 5507);
  assert.ok(firstRows[raw('node_nene_normal_end').targetLine][2].includes('此时不拼'));
  assert.ok(restartRows[raw('node_restart_monologue').targetLine][2].includes('一路走好'));
  assert.ok(restartRows[2][2].includes('扣动扳机'));
  assert.ok(restartRows[raw('node_restart_begin').targetLine][2].includes('可以跟你说点事吗'));
  assert.equal(raw('node_restart_true_end').targetLine, restartRows.length - 1);
});

test('known choice labels resolve via real chapterStart instead of guessing or always returning to source', () => {
  const state = fresh();
  state.selectFcRoute('巡');
  const choiceNode = state.getFcRouteNodes().find(n => n.targetLine === 6984);
  assert.ok(choiceNode);
  show(state, choiceNode);
  const card = find(render(state), 'fc-node', choiceNode.title);
  click(card);
  assertJump(state, 'meguru', 6984);
});

test('cancelled touches do not activate cards and stray moves do not pan', () => {
  const state = fresh();
  show(state, raw('node_choice_12'));
  state.resetFcPan();
  const viewport = find(render(state), 'fc-viewport');
  viewport.props.on.touchmove(touch(300, 20));
  assert.equal(state.flowPanY, 0);
  viewport.props.on.touchstart(touch(300, 100));
  assert.equal(typeof viewport.props.on.touchcancel, 'function');
  viewport.props.on.touchcancel();
  clickCard(state, '可能会投给因幡吧');
  assert.equal(state.calls.length, 0);
  viewport.props.on.touchmove(touch(300, 10));
  assert.equal(state.flowPanY, 0);
  viewport.props.on.touchstart(touch(300, 100));
  viewport.props.on.touchend(touch(300, 100));
  clickCard(state, '可能会投给因幡吧');
  assertJump(state, 'main', 8926);
});

test('all route renders stay within native size limits at both pan extremes', () => {
  const state = fresh();
  for (const route of routeNames) {
    state.selectFcRoute(route);
    for (const atEnd of [false, true]) {
      state.panFcBy(atEnd ? -100000 : 100000, atEnd ? -100000 : 100000);
      assert.ok(state.flowPanX <= 0 && state.flowPanX >= -state.flowPanMaxX);
      assert.ok(state.flowPanY <= 0 && state.flowPanY >= -state.flowPanMaxY);
      const tree = render(state);
      for (const element of walk(tree)) {
        assert.ok(['div', 'text', 'image'].includes(element.tag), 'native primitives, not DOM/SVG/canvas');
        const s = element.props.staticStyle;
        if (s.width !== undefined) assert.ok(parseFloat(s.width) <= 800, s.classes + ' width');
        if (s.height !== undefined) assert.ok(parseFloat(s.height) <= 220, s.classes + ' height');
      }
      const graph = find(tree, 'fc-canvas').props.staticStyle;
      assert.equal(parseFloat(graph.width), 688);
      assert.equal(parseFloat(graph.height), 152);
    }
  }
});

test('CSS declarations avoid unsupported shorthands and implicit flex layout', () => {
  for (const [name, s] of Object.entries(styles)) {
    for (const shorthand of ['padding', 'margin', 'border']) assert.equal(s[shorthand], undefined, name + ':' + shorthand);
    if (s.flexDirection || s.alignItems || s.justifyContent) assert.equal(s.display, 'flex', name);
  }
});
