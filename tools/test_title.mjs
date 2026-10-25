import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const MODULE_URL = new URL('../app/pages/title/title.js', import.meta.url);
const CSS_URL = new URL('../app/pages/title/title.css', import.meta.url);
const BGM_FILE = '/userdisk/SenrenBanka/bgm/BGM01.opus';

function dataUrl(source) {
  return 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
}

const commonStub = `
export function S(names) { return { testClasses: names }; }
export function log() {}
export function getChapterByLine() { return '1-1'; }
export function getGal() { return globalThis.__titleTestGal; }
`;
const storageStub = `
export function readAllSaves() { return globalThis.__titleTestSaves || {}; }
export function readSettings() { return { ...globalThis.__titleTestSettings }; }
export function writeSettings(settings) {
  globalThis.__titleTestWrites.push({ ...settings });
  globalThis.__titleTestSettings = { ...globalThis.__titleTestSettings, ...settings };
}
`;
const dataStub = `
export var STORY = { meta: { titleBgm: 'BGM01' }, after: {}, afterMeta: [] };
`;
const mediaStub = `
export function bgmPath(name) {
  return '/userdisk/SenrenBanka/bgm/' + (name.indexOf('.') >= 0 ? name : name + '.opus');
}
export function bgUrl(name) {
  return 'file:///userdisk/SenrenBanka/bg/' + name + (name.indexOf('.') >= 0 ? '' : '.png');
}
export function titleBgUrl() { return 'file:///userdisk/SenrenBanka/bg/title_bg.png'; }
export function isBlackBg(name) { return !name || name === '__black__' || name === '画面_黒'; }
`;
const source = await readFile(MODULE_URL, 'utf8');
let instrumentedSource = source.replace(
  /import \{[^}]+\} from '\.\.\/\.\.\/common\.js';/,
  `import { S, getGal, log, getChapterByLine } from '${dataUrl(commonStub)}';`
);
instrumentedSource = instrumentedSource.replace(
  /import \{[^}]+\} from '\.\.\/\.\.\/storage\.js';/,
  `import { readAllSaves, readSettings, writeSettings } from '${dataUrl(storageStub)}';`
);
instrumentedSource = instrumentedSource.replace(
  /import \{ STORY \} from '\.\.\/\.\.\/data\/story_data\.js';/,
  `import { STORY } from '${dataUrl(dataStub)}';`
);
instrumentedSource = instrumentedSource.replace(
  /import \{[^}]+\} from '\.\.\/\.\.\/media\.js';/,
  `import { bgmPath, bgUrl, isBlackBg, titleBgUrl } from '${dataUrl(mediaStub)}';`
);
assert.notEqual(instrumentedSource, source, 'test must load title.js with native dependencies stubbed');
const { titleMethods, renderTitle } = await import(dataUrl(instrumentedSource));

function h(tag, data, children) {
  return { tag, data: data || {}, children: children == null ? [] : children };
}

function textContent(node) {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  return textContent(node.children);
}

function findButton(node, label) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
  if (node.data && node.data.on && typeof node.data.on.click === 'function' && textContent(node).includes(label)) {
    return node;
  }
  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    const found = findButton(child, label);
    if (found) return found;
  }
  return null;
}

function makeVm(settings = {}, withPage = true) {
  const nativeCalls = [];
  globalThis.__titleTestSettings = {
    bgmEnabled: true,
    bgmVolume: 0.8,
    ...settings
  };
  globalThis.__titleTestWrites = [];
  globalThis.__titleTestSaves = {};
  globalThis.__titleTestGal = {
    playBgm(file, loop, volume) { nativeCalls.push({ method: 'playBgm', file, loop, volume }); },
    stopBgm() { nativeCalls.push({ method: 'stopBgm' }); },
    setBgmVolume(volume) { nativeCalls.push({ method: 'setBgmVolume', volume }); }
  };
  const finishCalls = [];
  const vm = Object.assign(Object.create(titleMethods), {
    $page: withPage ? { finish() { finishCalls.push('finish'); } } : undefined
  });
  vm.initTitle();
  return { vm, nativeCalls, finishCalls, writes: globalThis.__titleTestWrites };
}

test('initTitle respects persisted disabled state and volume', () => {
  const { vm, nativeCalls } = makeVm({ bgmEnabled: false, bgmVolume: 0.3 });
  assert.equal(vm.bgmOn, false);
  assert.equal(vm.bgmVolume, 0.3);
  assert.deepEqual(nativeCalls, [
    { method: 'setBgmVolume', volume: 0.3 },
    { method: 'stopBgm' }
  ]);

  const enabled = makeVm({ bgmEnabled: true, bgmVolume: 0.2 });
  assert.equal(enabled.vm.bgmOn, true);
  assert.equal(enabled.vm.bgmVolume, 0.2);
  assert.deepEqual(enabled.nativeCalls, [
    { method: 'setBgmVolume', volume: 0.2 },
    { method: 'playBgm', file: BGM_FILE, loop: true, volume: 0.2 }
  ]);
});

test('SYSTEM opens the settings modal and only exposes connected BGM controls', () => {
  const { vm } = makeVm({ bgmVolume: 0.4 });
  const menu = renderTitle(vm, h);
  findButton(menu, 'SYSTEM').data.on.click();
  assert.equal(vm.titleModalType, 'settings');
  assert.equal(vm.titleConfirmModal, null);
  const modalText = textContent(renderTitle(vm, h));
  assert.match(modalText, /BGM/);
  assert.match(modalText, /40%/);
  assert.doesNotMatch(modalText, /Voice|VOICE|SE音量|音效音量/);
});

test('BGM switch updates native audio and persists immediately', () => {
  const { vm, nativeCalls, writes } = makeVm({ bgmEnabled: true, bgmVolume: 0.6 });
  vm.openTitleSettings();
  vm.toggleTitleBgm();
  assert.equal(vm.bgmOn, false);
  assert.equal(nativeCalls.at(-1).method, 'stopBgm');
  assert.deepEqual(writes.at(-1), { bgmEnabled: false, bgmVolume: 0.6 });
  vm.toggleTitleBgm();
  assert.equal(vm.bgmOn, true);
  assert.deepEqual(nativeCalls.at(-1), { method: 'playBgm', file: BGM_FILE, loop: true, volume: 0.6 });
  assert.deepEqual(writes.at(-1), { bgmEnabled: true, bgmVolume: 0.6 });
});

test('volume buttons apply and persist rounded values with 0..1 bounds', () => {
  const { vm, nativeCalls, writes } = makeVm({ bgmVolume: 0.5 });
  vm.openTitleSettings();
  const modal = renderTitle(vm, h);
  findButton(modal, '＋').data.on.click();
  assert.equal(vm.bgmVolume, 0.6);
  assert.deepEqual(nativeCalls.at(-1), { method: 'setBgmVolume', volume: 0.6 });
  assert.deepEqual(writes.at(-1), { bgmEnabled: true, bgmVolume: 0.6 });
  assert.match(textContent(renderTitle(vm, h)), /60%/);

  vm.adjustTitleBgmVolume(1);
  assert.equal(vm.bgmVolume, 1);
  vm.adjustTitleBgmVolume(0.1);
  assert.equal(vm.bgmVolume, 1);
  vm.adjustTitleBgmVolume(-2);
  assert.equal(vm.bgmVolume, 0);
  vm.adjustTitleBgmVolume(-0.1);
  assert.equal(vm.bgmVolume, 0);
  assert.equal(writes.at(-1).bgmVolume, 0);
});

test('EXIT has an independent confirmation, cancellation, and safe finish', () => {
  const { vm, finishCalls } = makeVm();
  vm.confirmExecuteTitleLoad = () => { throw new Error('exit must not execute title load'); };
  findButton(renderTitle(vm, h), 'EXIT').data.on.click();
  assert.equal(vm.titleModalType, 'exit');
  assert.equal(vm.titleConfirmModal, null);
  assert.match(textContent(renderTitle(vm, h)), /退出游戏/);

  vm.cancelTitleExit();
  assert.equal(vm.titleModalType, '');
  assert.equal(finishCalls.length, 0);
  vm.openTitleExitModal();
  vm.confirmTitleExit();
  assert.deepEqual(finishCalls, ['finish']);

  const withoutPage = makeVm({}, false);
  withoutPage.vm.openTitleExitModal();
  assert.doesNotThrow(() => withoutPage.vm.confirmTitleExit());
});

test('startNewGame clears residual after-story state and boots main/0 explicitly', () => {
  const { vm } = makeVm();
  const calls = [];
  vm.initGame = (scenario, line) => { calls.push([scenario, line]); };
  vm.currentScenario = 'after_heroine_a';
  vm.currentLine = 640;
  vm.choiceSelections = { old: 1 };
  vm.choiceFlags = { sub: 2 };
  vm.activeChoice = { id: 'old' };

  vm.startNewGame();

  assert.deepEqual(calls, [['main', 0]]);
  assert.equal(vm.currentScenario, 'main');
  assert.equal(vm.currentLine, 0);
  assert.deepEqual(vm.choiceSelections, {});
  assert.deepEqual(vm.choiceFlags, {});
  assert.equal(vm.activeChoice, null);
  assert.equal(vm.view, 'game');
});

test('continueGame restores saved scenario and line, rejecting unsafe scenarios', () => {
  const after = makeVm();
  globalThis.__titleTestSaves = {
    latest: '3',
    slot3: {
      line: 42,
      scenario: 'after_heroine_b',
      chapter: '2-1',
      extra: { choices: { c1: 2 }, flags: { sub: 1 } }
    }
  };
  const calls = [];
  after.vm.initGame = (scenario, line) => { calls.push([scenario, line]); };
  after.vm.currentScenario = 'after_heroine_a';

  after.vm.continueGame();

  assert.deepEqual(calls, [['after_heroine_b', 42]]);
  assert.equal(after.vm.currentScenario, 'after_heroine_b');
  assert.equal(after.vm.currentLine, 42);
  assert.deepEqual(after.vm.choiceSelections, { c1: 2 });
  assert.deepEqual(after.vm.choiceFlags, { sub: 1 });
  assert.equal(after.vm.view, 'game');

  const unsafe = makeVm();
  globalThis.__titleTestSaves = {
    latest: '1',
    slot1: { line: 10, scenario: '../../evil' }
  };
  const unsafeCalls = [];
  unsafe.vm.initGame = (scenario, line) => { unsafeCalls.push([scenario, line]); };
  unsafe.vm.currentScenario = 'after_heroine_c';

  unsafe.vm.continueGame();

  assert.deepEqual(unsafeCalls, [['main', 10]]);
  assert.equal(unsafe.vm.currentScenario, 'main');
  assert.equal(unsafe.vm.currentLine, 10);

  const empty = makeVm();
  const emptyCalls = [];
  empty.vm.initGame = (scenario, line) => { emptyCalls.push([scenario, line]); };
  empty.vm.currentScenario = 'after_heroine_d';

  empty.vm.continueGame();

  assert.deepEqual(emptyCalls, [['main', 0]]);
  assert.equal(empty.vm.currentScenario, 'main');
  assert.equal(empty.vm.currentLine, 0);
});

test('loadSlotFromTitle restores saved scenario and leaves the flowchart opener untouched', () => {
  const { vm } = makeVm();
  const calls = [];
  vm.initGame = (scenario, line) => { calls.push([scenario, line]); };
  vm.titleSaves = {
    slot7: {
      line: 12,
      scenario: 'after_heroine_c',
      chapter: '3-1',
      extra: { choices: { c7: 1 }, flags: { sub: 2 } }
    }
  };
  vm.titleModalType = 'load';

  vm.loadSlotFromTitle(7);

  assert.deepEqual(calls, [['after_heroine_c', 12]]);
  assert.equal(vm.currentScenario, 'after_heroine_c');
  assert.equal(vm.currentLine, 12);
  assert.deepEqual(vm.choiceSelections, { c7: 1 });
  assert.deepEqual(vm.choiceFlags, { sub: 2 });
  assert.equal(vm.titleModalType, '');
  assert.equal(vm.view, 'game');

  const before = calls.length;
  vm.openFlowchartModal();
  assert.equal(calls.length, before);
  assert.equal(vm.view, 'flowchart');

  const invalid = makeVm();
  const invalidCalls = [];
  invalid.vm.initGame = (scenario, line) => { invalidCalls.push([scenario, line]); };
  invalid.vm.titleSaves = { slot2: { line: 5, scenario: 'chapter_all' } };

  invalid.vm.loadSlotFromTitle(2);

  assert.deepEqual(invalidCalls, [['main', 5]]);
  assert.equal(invalid.vm.currentScenario, 'main');
});

test('page navigation and title re-entry clear stale modal overlays', () => {
  const { vm } = makeVm();
  const pages = [
    ['afterstory', vm.openAfterModal],
    ['flowchart', vm.openFlowchartModal],
    ['gallery', vm.openGallery]
  ];
  for (const [view, open] of pages) {
    vm.openTitleSettings();
    open.call(vm);
    assert.equal(vm.view, view);
    assert.equal(vm.titleModalType, '');
    assert.equal(vm.titleConfirmModal, null);
  }

  vm.openTitleSettings();
  assert.equal(vm.titleModalType, 'settings');
  vm.initTitle();
  assert.equal(vm.titleModalType, '');
});

test('settings and exit overlays preserve the 800x220 touch-friendly layout', async () => {
  const css = await readFile(CSS_URL, 'utf8');
  assert.match(css, /\.title-system-mask\s*\{[^}]*width:\s*800px;[^}]*height:\s*220px;/s);
  const action = css.match(/\.title-system-btn\s*\{([^}]*)\}/s);
  assert.ok(action, 'settings action style must exist');
  assert.ok(parseFloat(action[1].match(/height:\s*([\d.]+)px/)[1]) >= 30);
});
