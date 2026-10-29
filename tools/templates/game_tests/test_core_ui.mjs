import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const styles = {};
for (const page of ['title', 'game']) {
  const css = readFileSync(resolve(root, `app/pages/${page}/${page}.css`), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const rule = {};
    for (const declaration of body.split(';')) {
      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      rule[declaration.slice(0, colon).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = declaration.slice(colon + 1).trim();
    }
    for (const selector of selectors.split(',')) if (selector.trim().startsWith('.')) styles[selector.trim().slice(1)] = rule;
  }
}

async function load() {
  const files = new Map();
  const audio = [];
  const timers = new Map();
  let timerId = 0;
  const gal = {
    readText: path => files.get(path) || '',
    writeText: (path, value) => { files.set(path, value); return true; },
    playBgm: (...args) => audio.push(args),
    stopBgm() {}, setBgmVolume() {}, stopVoice() {}, playVoice() {}
  };
  const context = createContext({ console: { warn() {} }, setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id) });
  const modules = new Map();
  function get(path) {
    if (modules.has(path)) return modules.get(path);
    let module;
    if (path === 'gal' || path.endsWith('/Styles.js')) {
      const value = path === 'gal' ? gal : styles;
      module = new SyntheticModule(['default'], function () { this.setExport('default', value); }, { context, identifier: path });
    } else {
      module = new SourceTextModule(readFileSync(path, 'utf8'), { context, identifier: path });
    }
    modules.set(path, module);
    return module;
  }
  const entry = new SourceTextModule(`export * from './app/pages/game/game.js'; export * from './app/pages/title/title.js'; export * from './app/storage.js'; export { chapter_all } from './app/data/chapter_all.js'; export { default as Root } from './app/root.js';`, { context, identifier: resolve(root, 'ui-test-entry.js') });
  await entry.link((specifier, ref) => get(specifier === 'gal' ? 'gal' : resolve(dirname(ref.identifier), specifier)));
  await entry.evaluate();
  const api = entry.namespace;
  const vm = { ...api.titleMethods, ...api.gameMethods, view: 'game', currentScenario: 'main', currentLine: 0, gameZoomIndex: 0, choiceSelections: {}, choiceFlags: {}, titleSavePage: 0 };
  return { api, vm, files, audio, timers };
}

const h = (tag, props = {}, children = []) => ({ tag, props, children });
function all(node) {
  if (!node || typeof node !== 'object') return [];
  return [node, ...(Array.isArray(node.children) ? node.children.flatMap(all) : [])];
}
const textOf = tree => all(tree).filter(n => n.tag === 'text').map(n => n.children).join('\n');
const plain = value => JSON.parse(JSON.stringify(value));

 test('save/load and title continue preserve choices, flags and CG thumbnails', async () => {
  const { api, vm, files } = await load();
  vm.choiceSelections = { sample_choice: 2 };
  vm.choiceFlags = { nen: 3, meg: 1 };
  vm.executeSave(6);
  const saved = JSON.parse(files.get('/userdisk/gal_data/sanoba_witch/saves.json')).slot6;
  assert.deepEqual(saved.extra.choices, { sample_choice: 2 });
  assert.deepEqual(saved.extra.flags, { nen: 3, meg: 1 });
  vm.choiceSelections = {}; vm.choiceFlags = {};
  vm.executeLoad(6);
  assert.deepEqual(plain(vm.choiceSelections), { sample_choice: 2 });
  assert.deepEqual(plain(vm.choiceFlags), { nen: 3, meg: 1 });
  vm.choiceSelections = {}; vm.continueGame();
  assert.deepEqual(plain(vm.choiceSelections), { sample_choice: 2 });
  api.saveSlotRecord(2, { line: 10, cg: 'ev101a', sd: 'sd01', extra: {} });
  assert.equal(api.loadSlotRecord(2).cg, 'ev101a');
  assert.equal(api.loadSlotRecord(2).sd, 'sd01');
});

test('backlog renders visited lines, never skipped script lines', async () => {
  const { api, vm } = await load();
  api.clearBacklog();
  vm.initGame('main', 0);
  vm.currentLine = 20;
  vm.applyCurrentLine(false);
  const visited = api.getBacklog();
  assert.equal(visited.length, 2);
  vm.openHistoryModal();
  const rendered = textOf(api.renderGame(vm, h));
  assert.ok(rendered.includes(visited[0].text));
  assert.ok(rendered.includes(visited[1].text));
  assert.equal(vm.historyFocusIndex, 1);
});

test('stage cycles 1.0, 1.5, 2.0 and 2.5 without advancing dialogue', async () => {
  const { api, vm } = await load();
  vm.initGame('main', 0);
  const stage = api.renderGame(vm, h).children[0];
  stage.props.on.click();
  assert.equal(vm.zoomMode, true);
  assert.ok(textOf(api.renderGame(vm, h)).includes('1.0x'));
  for (const label of ['1.5x', '2.0x', '2.5x', '1.0x']) {
    const tree = api.renderGame(vm, h);
    const viewport = all(tree).find(n => n.props.staticStyle?.width === '664px' && n.props.on?.click);
    assert.ok(viewport, 'zoom viewport must respond to taps');
    viewport.props.on.click();
    assert.ok(textOf(api.renderGame(vm, h)).includes(label));
  }
  assert.equal(vm.currentLine, 0);
});

test('BGM retains a saved zero volume rather than falling back to 80 percent', async () => {
  const { api, vm, audio } = await load();
  api.writeSettings({ bgmVolume: 0, bgmEnabled: true });
  const line = api.chapter_all.findIndex(row => row[5]);
  assert.ok(line >= 0);
  vm.initGame('main', line);
  assert.ok(audio.length > 0);
  assert.equal(audio[0][2], 0);
});

test('all active game overlays have a defined fixed viewport style', async () => {
  const { api, vm } = await load();
  vm.initGame('main', 0);
  for (const type of ['menu', 'history', 'save', 'load']) {
    vm.openGameModal(type);
    const tree = api.renderGame(vm, h);
    for (const node of all(tree)) {
      if (node.tag === 'div') assert.ok(Object.keys(node.props.staticStyle || {}).length > 0, `unstyled div in ${type}`);
    }
  }
});

test('system menu uses two horizontal rows of buttons that fit the card', async () => {
  const { api, vm } = await load();
  vm.initGame('main', 0); vm.openGameModal('menu');
  const nodes = all(api.renderGame(vm, h));
  const grid = nodes.find(n => n.children?.length === 3 && n.children[0]?.children?.length === 3 && n.children[1]?.children?.length === 3);
  assert.ok(grid);
  assert.equal(grid.props.staticStyle.flexDirection, 'column');
  for (const row of grid.children.slice(0, 2)) {
    assert.equal(row.props.staticStyle.display, 'flex');
    assert.equal(row.props.staticStyle.flexDirection, 'row');
    assert.ok(parseFloat(row.children[0].props.staticStyle.height) * 2 < 140);
  }
});

test('long dialogue advances readable pages before advancing the script line', async () => {
  const { api, vm } = await load();
  const line = api.chapter_all.findIndex(row => row[2]?.length > 70 && !row[2].includes('请选择'));
  assert.ok(line >= 0);
  vm.initGame('main', line);
  assert.equal(vm.activeChoice, null);
  const before = textOf(api.renderGame(vm, h));
  vm.nextLine();
  assert.equal(vm.currentLine, line);
  assert.notEqual(textOf(api.renderGame(vm, h)), before);
});

test('heroine sprites resolve to real Japanese asset prefixes and fallback faces', async () => {
  const { api, vm } = await load();
  const imageAt = (scenario, line) => {
    vm.initGame(scenario, line);
    return all(api.renderGame(vm, h)).find(n => n.tag === 'image' && n.props.attrs?.src?.includes('/fg/'));
  };
  assert.match(imageAt('main', 2340).props.attrs.src, /fg\/寧々_制服_23\.png$/);
  assert.match(imageAt('main', 3055).props.attrs.src, /fg\/めぐる_制服_08\.png$/);
  assert.match(imageAt('main', 2337).props.attrs.src, /fg\/和奏_ウェイトレス_18\.png$/);
  assert.equal(imageAt('main', 2340).props.attrs.src.includes('宁宁_'), false);
});

test('chapter labels are human readable in dialogue, zoom and save cards', async () => {
  const { api, vm, files } = await load();
  vm.initGame('main', 2337);
  let tree = api.renderGame(vm, h);
  assert.ok(textOf(tree).includes('2-1'));
  assert.ok(!textOf(tree).includes('chapter　'));
  vm.toggleZoom();
  assert.ok(textOf(api.renderGame(vm, h)).includes('2-1'));
  vm.toggleZoom();
  files.set('/userdisk/gal_data/sanoba_witch/saves.json', JSON.stringify({
    slot3: { slot: 3, scenario: 'main', line: 2337, date: '10-29 18:00', chapter: 'chapter　2-1', speaker: '柊史', text: '旧存档台词', choiceSelections: { 'main:2337': 1 }, choiceFlags: { wak: 1 } },
    latest: '3'
  }));
  vm.initGame('main', 2337);
  vm.openGameModal('save');
  tree = api.renderGame(vm, h);
  assert.ok(textOf(tree).includes('10-29 18:00'));
  assert.ok(textOf(tree).includes('旧存档台词'));
  assert.ok(!textOf(tree).includes('undefined'));
  assert.ok(!textOf(tree).includes('chapter　'));
  const loaded = api.loadSlotRecord(3);
  assert.deepEqual(plain(loaded.extra.choices), { 'main:2337': 1 });
  assert.equal(loaded.time, '10-29 18:00');
});

test('page resume preserves progress and hide cancels automatic advancement', async () => {
  const { api, vm, timers } = await load();
  Object.assign(vm, api.Root.methods);
  vm.initGame('main', 200);
  vm.onShow();
  assert.equal(vm.currentLine, 200);
  vm.toggleAutoPlay();
  assert.ok(timers.size > 0);
  vm.onHide();
  assert.equal(vm.autoPlay, false);
  assert.equal(vm.skipMode, false);
  assert.equal(timers.size, 0);
  assert.ok(Object.hasOwn(api.Root.data(), 'saveNotice'));
});

test('load pagination exposes six slots on every page and wraps around', async () => {
  const { api, vm } = await load();
  vm.openTitleLoadModal();
  for (let page = 0; page < 5; page++) {
    assert.equal(vm.titleSavePage, page);
    const text = textOf(api.renderTitle(vm, h));
    for (let slot = page * 6 + 1; slot <= page * 6 + 6; slot++) assert.ok(text.includes(`s000${page + 1}-${String(slot).padStart(2, '0')}`));
    vm.changeTitleSavePage(1);
  }
  assert.equal(vm.titleSavePage, 0);
});
