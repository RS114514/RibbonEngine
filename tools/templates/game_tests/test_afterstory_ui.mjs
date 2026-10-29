// Run: node --experimental-vm-modules --test tools/test_afterstory_ui.mjs
// Only native gal is replaced. Styles are interpreted from the actual page CSS
// in memory (the same declaration conversion as build.py); no build/files written.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

const ROOT = new URL('../', import.meta.url);
const CSS = readFileSync(new URL('app/pages/afterstory/afterstory.css', ROOT), 'utf8');
const HEROES = [
  { key: 'nene', clear: 'nene_restart', voice: 'nen001_027_ref.opus' },
  { key: 'meguru', clear: 'meguru', voice: 'meg006_022.opus' },
  { key: 'tsumugi', clear: 'tsumugi', voice: 'tsu011_002.opus' },
  { key: 'touko', clear: 'touko', voice: 'tou006_017.opus' },
  { key: 'wakana', clear: 'wakana', voice: 'wak001_033.opus' }
];

function parseStyles(css) {
  const styles = {};
  for (const [, selectors, body] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const declarations = {};
    for (const declaration of body.split(';')) {
      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      const key = declaration.slice(0, colon).trim().replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      declarations[key] = declaration.slice(colon + 1).trim();
    }
    for (const selector of selectors.split(',')) {
      if (selector.trim().startsWith('.')) styles[selector.trim().slice(1)] = declarations;
    }
  }
  return styles;
}
const STYLES = parseStyles(CSS);

async function fixture(files = new Map()) {
  assert.equal(typeof SourceTextModule, 'function', 'run with --experimental-vm-modules');
  const calls = [];
  const native = {
    readText(path) { calls.push(['readText', path]); return files.get(path) || ''; },
    writeText(path, text) { calls.push(['writeText', path]); files.set(path, text); return true; },
    playBgm(...args) { calls.push(['playBgm', ...args]); },
    stopBgm() { calls.push(['stopBgm']); },
    setBgmVolume(...args) { calls.push(['setBgmVolume', ...args]); },
    playVoice(...args) { calls.push(['playVoice', ...args]); },
    stopVoice() { calls.push(['stopVoice']); }
  };
  const context = createContext({ console, setTimeout, clearTimeout, setInterval, clearInterval });
  const modules = new Map();
  const stylesUrl = new URL('app/Styles.js', ROOT).href;
  function moduleAt(id) {
    if (modules.has(id)) return modules.get(id);
    let mod;
    if (id === 'gal') {
      mod = new SyntheticModule(['default'], function () { this.setExport('default', native); }, { context, identifier: id });
    } else if (id === stylesUrl) {
      mod = new SyntheticModule(['default'], function () { this.setExport('default', STYLES); }, { context, identifier: id });
    } else {
      assert.ok(id.startsWith(ROOT.href), 'unexpected external module: ' + id);
      mod = new SourceTextModule(readFileSync(new URL(id), 'utf8'), { context, identifier: id });
    }
    modules.set(id, mod);
    return mod;
  }
  async function load(relative) {
    const mod = moduleAt(new URL(relative, ROOT).href);
    if (mod.status === 'unlinked') {
      await mod.link((specifier, parent) => moduleAt(specifier === 'gal' ? 'gal' : new URL(specifier, parent.identifier).href));
    }
    if (mod.status === 'linked') await mod.evaluate();
    return mod.namespace;
  }
  const page = await load('app/pages/afterstory/afterstory.js');
  const { gameMethods } = await load('app/pages/game/game.js');
  const { titleMethods } = await load('app/pages/title/title.js');
  const storage = await load('app/storage.js');
  const vm = Object.assign({ view: 'afterstory', currentScenario: 'main', currentLine: 42, afterPanX: 0, selectedAfterHeroine: '' },
    titleMethods, gameMethods, page.afterstoryMethods);
  const render = () => page.renderAfterstory(vm, h);
  return { vm, storage, calls, files, render, load };
}

function h(tag, data, children = []) {
  return { tag, data, children: (Array.isArray(children) ? children : [children]).filter(child => child != null) };
}
function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  return [node, ...node.children.flatMap(nodes)];
}
function text(node) {
  return typeof node === 'string' ? node : node.children.map(text).join('');
}
function card(tree, key) {
  const result = nodes(tree).find(node => node.data.key === key);
  assert.ok(result, key + ' card must be rendered');
  return result;
}
function button(tree, label) {
  const result = nodes(tree).find(node => node.data.on?.click && label.test(text(node)));
  assert.ok(result, 'missing button: ' + label);
  return result;
}
function enter(tree, key) {
  button(card(tree, key), /^(?:▶ )?进入后日谈物语$|^进入后日谈$|^未解锁$/).data.on.click({ stopPropagation() {} });
}
function lockMask(node) {
  return nodes(node).find(item => item.tag === 'div' && /rgba\([^)]*,\s*0\.\d+\)/.test(item.data.staticStyle?.backgroundColor || '') && /未解锁/.test(text(item)));
}
function assertLocked(f, key) {
  const before = f.vm.currentScenario;
  enter(f.render(), key);
  assert.equal(f.vm.view, 'afterstory', key + ': locked click must not enter game');
  assert.equal(f.vm.currentScenario, before, key + ': locked click must not change scenario');
  const node = card(f.render(), key);
  assert.ok(lockMask(node), key + ': translucent lock mask must be visible');
  assert.match(text(node), /通关.+解锁/, key + ': explain the unlock requirement');
}

// Regression: removing the entry guard lets the REAL initGame enter after_nene.
test('uncleared card clicks stay on afterstory, without starting the real game', async () => {
  const f = await fixture();
  f.storage.writeSettings({ clearedRoutes: [], bgmEnabled: false });
  assert.equal(f.storage.isRouteCleared('nene_restart'), false);
  f.vm.initAfterStory();
  for (const hero of HEROES) assertLocked(f, hero.key);
  assert.equal(f.vm.currentLine, 42);
  assert.equal(f.storage.getBacklog().length, 0, 'no game line should be applied');
});

test('each persisted route lights only its own card and enters its independent after array', async () => {
  const f = await fixture();
  for (const hero of HEROES) {
    f.storage.writeSettings({ clearedRoutes: [], bgmEnabled: false });
    assert.equal(f.storage.markRouteClearedInStorage(hero.clear), true);
    assert.equal(f.storage.isRouteCleared(hero.clear), true);
    assert.deepEqual(JSON.parse(f.files.get(f.storage.getSettingsFilePath())).clearedRoutes, [hero.clear]);
    f.vm.view = 'afterstory';
    f.vm.initAfterStory();
    for (const other of HEROES.filter(item => item.key !== hero.key)) assertLocked(f, other.key);
    const unlocked = card(f.render(), hero.key);
    assert.equal(lockMask(unlocked), undefined, hero.key + ': mask must disappear');
    assert.match(text(unlocked), /已通关/);
    assert.equal(nodes(unlocked).find(node => node.tag === 'image').data.staticStyle.opacity, '1');
    const play = button(unlocked, /^进入后日谈$/);
    const label = nodes(play).find(node => node.tag === 'text');
    assert.ok([...text(label)].length * px(label.data.staticStyle.fontSize) <= px(play.data.staticStyle.width), 'unlocked button label must fit');
    enter(f.render(), hero.key);
    assert.equal(f.vm.view, 'game');
    assert.equal(f.vm.currentScenario, 'after_' + hero.key);
    assert.equal(f.vm.currentLine, 0);
    const actual = await f.load('app/data/after_' + hero.key + '.js');
    assert.equal(f.vm.currentScenarioData, actual['after_' + hero.key], 'real game must use the dedicated data array');
    assert.ok(f.vm.currentScenarioData.length > 0);
  }
});

test('Nene normal ending is not her final afterstory prerequisite', async () => {
  const f = await fixture();
  // Evidence: the configured normal ending continues into restart, whose ending is TRUE END.
  const { FLOWCHART } = await f.load('app/data/flowchart_data.js');
  assert.equal(FLOWCHART.nodes.find(node => node.id === 'node_nene_normal_end').next, 'node_restart_monologue');
  assert.equal(FLOWCHART.nodes.find(node => node.id === 'node_restart_true_end').route, 'nene_restart');
  f.storage.writeSettings({ clearedRoutes: [], bgmEnabled: false });
  f.storage.markRouteClearedInStorage('nene');
  f.vm.initAfterStory();
  assertLocked(f, 'nene');
  assert.match(text(card(f.render(), 'nene')), /重启/);
  f.storage.markRouteClearedInStorage('nene_restart');
  f.vm.initAfterStory();
  enter(f.render(), 'nene');
  assert.equal(f.vm.currentScenario, 'after_nene');
});

test('entry rechecks storage and rejects unknown or forged prerequisite arguments', async () => {
  const f = await fixture();
  f.storage.writeSettings({ clearedRoutes: ['meguru'], bgmEnabled: false });
  f.vm.initAfterStory();
  const staleTree = f.render();
  f.storage.writeSettings({ clearedRoutes: [], bgmEnabled: false });
  enter(staleTree, 'meguru');
  assert.equal(f.vm.view, 'afterstory', 'stale lit card must not bypass current storage');
  f.storage.markRouteClearedInStorage('nene');
  for (const heroine of [null, { key: 'unknown' }, { key: 'meguru', clearRoute: 'nene', unlocked: true }]) {
    f.vm.startHeroineStory(heroine);
    assert.equal(f.vm.view, 'afterstory');
    assert.equal(f.vm.currentScenario, 'main');
  }
});

test('unlock survives a new module context; page reads never write unlock data', async () => {
  const first = await fixture();
  first.storage.writeSettings({ clearedRoutes: [], bgmEnabled: false });
  first.storage.markRouteClearedInStorage('touko');
  const f = await fixture(first.files);
  const before = Array.from(f.files);
  f.vm.initAfterStory();
  assert.equal(lockMask(card(f.render(), 'touko')), undefined);
  assertLocked(f, 'wakana');
  enter(f.render(), 'touko');
  assert.equal(f.vm.currentScenario, 'after_touko');
  assert.deepEqual(Array.from(f.files), before, 'browsing/entry must not manufacture progress');
  assert.equal(f.calls.some(call => call[0] === 'writeText'), false);
});

test('locked previews still announce all five heroines and return restores title', async () => {
  const f = await fixture();
  f.storage.writeSettings({ clearedRoutes: [], bgmEnabled: false });
  f.vm.initAfterStory();
  assert.equal(f.calls.at(-1)[0], 'stopBgm');
  for (const hero of HEROES) {
    f.calls.length = 0;
    button(card(f.render(), hero.key), /^(?:♪ )?播报$/).data.on.click({ stopPropagation() {} });
    assert.equal(f.vm.selectedAfterHeroine, hero.key);
    assert.deepEqual(f.calls.filter(call => /Voice|Bgm/.test(call[0])), [
      ['stopBgm'], ['stopVoice'], ['playVoice', '/userdisk/gal_data/sanoba_witch/voice/' + hero.voice, 1]
    ]);
    assert.equal(f.vm.view, 'afterstory');
  }
  const back = button(f.render(), /^返回标题$/);
  f.calls.length = 0;
  back.data.on.click();
  assert.equal(f.vm.view, 'title');
  assert.equal(f.vm.titleModalType, '', 'real initTitle must run');
  assert.equal(f.calls[0][0], 'stopVoice');
  assert.equal(f.calls.at(-1)[0], 'stopBgm');
});

const px = value => Number.parseFloat(value) || 0;
function outer(style, dimension) {
  const sides = dimension === 'width' ? ['Left', 'Right'] : ['Top', 'Bottom'];
  return px(style[dimension]) + sides.reduce((sum, side) => sum + px(style['padding' + side]) + px(style['border' + side + 'Width'] || style.borderWidth), 0);
}

test('all five cards and controls fit the fixed viewport without relying on clipping', async () => {
  const f = await fixture();
  f.storage.writeSettings({ clearedRoutes: [], bgmEnabled: false });
  f.vm.initAfterStory();
  const tree = f.render();
  assert.equal(outer(tree.data.staticStyle, 'width'), 800);
  assert.equal(outer(tree.data.staticStyle, 'height'), 220);
  const list = nodes(tree).find(node => node.children.filter(child => child?.data?.key).length === 5);
  const listStyle = list.data.staticStyle;
  const cards = list.children;
  const needed = cards.reduce((sum, node) => sum + outer(node.data.staticStyle, 'width') + px(node.data.staticStyle.marginLeft) + px(node.data.staticStyle.marginRight), 0);
  assert.ok(outer(listStyle, 'width') <= 800, 'card content width must not be 984px');
  assert.ok(needed <= px(listStyle.width), 'five cards must fit without flex shrink');
  for (const node of nodes(tree)) {
    const style = node.data.staticStyle;
    if (node.tag === 'div') assert.equal(style.display, 'flex', text(node) + ': native div needs explicit flex');
    if (node.tag === 'image') assert.equal(node.data.attrs.resize, 'contain');
    if (style.position === 'absolute' && tree.children.includes(node)) {
      assert.ok(px(style.left) + outer(style, 'width') <= 800, 'root child exceeds screen width');
      assert.ok(px(style.top) + outer(style, 'height') <= 220, 'root child exceeds screen height');
    }
  }
  for (const node of cards) {
    const info = node.children.find(child => nodes(child).some(item => item.tag === 'text' && /句台词/.test(text(item))));
    assert.ok(px(info.data.staticStyle.top) + outer(info.data.staticStyle, 'height') <= px(node.data.staticStyle.height), 'info area must fit card height');
    const actions = nodes(info).find(item => item.children.length === 2 && item.children.every(child => child?.data?.on?.click));
    assert.ok(actions.children.reduce((sum, child) => sum + outer(child.data.staticStyle, 'width'), 0) <= px(actions.data.staticStyle.width), 'buttons must not overlap');
    for (const action of actions.children) {
      const label = nodes(action).find(item => item.tag === 'text');
      assert.ok([...text(label)].length * px(label.data.staticStyle.fontSize) <= px(action.data.staticStyle.width), 'button label must fit at full CJK width');
    }
  }
  assert.doesNotMatch(text(tree), /[◆♪▶�]/, 'avoid decorative glyphs unsupported by the device font');
  for (const style of Object.values(STYLES)) {
    for (const shorthand of ['padding', 'margin', 'border', 'borderWidth', 'borderStyle', 'borderColor']) {
      assert.equal(style[shorthand], undefined, 'native CSS needs expanded ' + shorthand);
    }
  }
});
