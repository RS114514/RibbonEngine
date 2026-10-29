import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);

function dataUrl(source) {
  return 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
}

const commonStub = `
export function S(names, extra) { return Object.assign({ classes: names }, extra || {}); }
export function log() {}
export function getChapterByLine() { return '--'; }
export function formatChapter(value) { var text = String(value || '').replace(/^chapter[\s\u3000]*/i, '').replace(/\s+/g, ' ').trim(); return text || '--'; }
export function getGal() { return globalThis.__renderGal; }
`;

const storageStub = `
export function readAllSaves() { return {}; }
export function writeAllSaves() { return true; }
export function saveSlotRecord() {}
export function loadSlotRecord() { return null; }
export function getNowDateStr() { return '01-01 00:00'; }
export function pushBacklog() {}
export function readSettings() { return { bgmEnabled: true, bgmVolume: 0.8 }; }
`;

const mediaStub = `
function withExt(name, ext) {
  if (!name) return '';
  var lower = String(name).toLowerCase();
  return lower.slice(-ext.length) === ext ? name : name + ext;
}
export function voicePath(name) { return '/userdisk/gal_data/voice/' + withExt(name, '.ogg'); }
export function bgmPath(name) { return '/userdisk/gal_data/bgm/' + withExt(name, '.opus'); }
export function bgUrl(name) {
  if (!name) return '';
  var value = String(name);
  return 'file:///userdisk/gal_data/bg/' + (/\\.[a-z0-9]+$/i.test(value) ? value : value + '.png');
}
export function fgUrl(name) { return 'file:///userdisk/gal_data/fg/' + withExt(name, '.png'); }
export function cgUrl(name) { return 'file:///userdisk/gal_data/cg/' + withExt(name, '.png'); }
export function sdUrl(name) { return 'file:///userdisk/gal_data/sd/' + withExt(name, '.png'); }
export function fxUrl(name) { return 'file:///userdisk/gal_data/fx/' + withExt(name, '.png'); }
export function coverUrl(name) { return 'file:///userdisk/gal_data/bg/' + name; }
export function titleBgUrl() { return 'file:///userdisk/gal_data/bg/title_bg.png'; }
export function isBlackBg(name) { return !name || name === '__black__' || name === '画面_黒'; }
`;

const storyStub = dataUrl('export var STORY = ' + JSON.stringify({
  main: [
    [0, 'Speaker A', 'Line one', 'voice_1', 'bg_1', 'bgm_1', { sprite: 'sprite_1' }, 'CHAPTER 1-1'],
    [1, '', 'Line two', null, 'bg_1', 'bgm_1', null, 'CHAPTER 1-1']
  ],
  after: {
    heroine_a: [[0, 'Speaker A', 'After line', 'after_voice', 'ema/ema_1.png', 'bgm_2', null, 'AFTER 1']]
  },
  afterMeta: [
    { key: 'heroine_a', name: 'Heroine A', chapter: 'AFTER 1', title: 'After A', voice: 'after_voice', cover: 'ema/ema_1.png' }
  ],
  meta: { titleBgm: 'bgm_1' }
}) + ';');

const flowchartStub = dataUrl('export var FLOWCHART = ' + JSON.stringify({
  routes: ['route_a'],
  nodes: [
    { id: 'n1', type: 'section', route: 'route_a', chapter: 'CHAPTER 1-1', title: 'Node 1', targetLine: 0, next: 'n2' },
    { id: 'n2', type: 'section', route: 'route_a', chapter: 'CHAPTER 1-1', title: 'Node 2', targetLine: 1, next: null }
  ],
  choices: [],
  chain: { n1: 'n2' },
  routeArt: { route_a: 'ema/ema_1.png' }
}) + ';');

const galleryStub = dataUrl('export var GALLERY = ' + JSON.stringify({
  cg: [{ id: 'cg_1', code: 'CG1', role: 'category', file: 'cg_1' }],
  bgm: [{ id: 'bgm_1', code: 'BGM1', file: 'bgm_1.opus' }]
}) + ';');

async function loadPage(path, replacements) {
  let source = await readFile(new URL(path, ROOT), 'utf8');
  for (const [pattern, replacement] of replacements) {
    const before = source;
    source = source.replace(pattern, replacement);
    assert.notEqual(source, before, 'failed to stub ' + pattern);
  }
  assert.doesNotMatch(source, /from '\.\.\/\.\.\//, path + ' still has unstubbed relative imports');
  return import(dataUrl(source));
}

const commonReplacement = [
  [/import \{[^}]+\} from '\.\.\/\.\.\/common\.js';/, `import { S, getGal, log, getChapterByLine, formatChapter } from '${dataUrl(commonStub)}';`]
];

const game = await loadPage('app/pages/game/game.js', [
  ...commonReplacement,
  [/import \{[^']*?\} from '\.\.\/\.\.\/storage\.js';/, `import { readAllSaves, writeAllSaves, saveSlotRecord, loadSlotRecord, getNowDateStr, pushBacklog, readSettings } from '${dataUrl(storageStub)}';`],
  [/import \{ STORY \} from '\.\.\/\.\.\/data\/story_data\.js';/, `import { STORY } from '${storyStub}';`],
  [/import \{ FLOWCHART \} from '\.\.\/\.\.\/data\/flowchart_data\.js';/, `import { FLOWCHART } from '${flowchartStub}';`],
  [/import \{[^}]+\} from '\.\.\/\.\.\/media\.js';/, `import { voicePath, bgmPath, bgUrl, fgUrl, cgUrl, sdUrl, fxUrl, isBlackBg } from '${dataUrl(mediaStub)}';`]
]);

const flowchart = await loadPage('app/pages/flowchart/flowchart.js', [
  ...commonReplacement,
  [/import \{ FLOWCHART as flowchart_data \} from '\.\.\/\.\.\/data\/flowchart_data\.js';/, `import { FLOWCHART as flowchart_data } from '${flowchartStub}';`],
  [/import \{[^}]+\} from '\.\.\/\.\.\/media\.js';/, `import { coverUrl, titleBgUrl } from '${dataUrl(mediaStub)}';`]
]);

const afterstory = await loadPage('app/pages/afterstory/afterstory.js', [
  ...commonReplacement,
  [/import \{ STORY \} from '\.\.\/\.\.\/data\/story_data\.js';/, `import { STORY } from '${storyStub}';`],
  [/import \{[^}]+\} from '\.\.\/\.\.\/media\.js';/, `import { coverUrl, titleBgUrl, voicePath } from '${dataUrl(mediaStub)}';`]
]);

const gallery = await loadPage('app/pages/gallery/gallery.js', [
  ...commonReplacement,
  [/import \{[^}]+\} from '\.\.\/\.\.\/storage\.js';/, `import { readSettings } from '${dataUrl(storageStub)}';`],
  [/import \{ GALLERY \} from '\.\.\/\.\.\/data\/gallery_data\.js';/, `import { GALLERY } from '${galleryStub}';`],
  [/import \{[^}]+\} from '\.\.\/\.\.\/media\.js';/, `import { cgUrl, bgmPath, titleBgUrl } from '${dataUrl(mediaStub)}';`]
]);

function h(tag, data, children) {
  return { tag, data: data || {}, children: children == null ? [] : children };
}

function text(node) {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  return text(node.children);
}

function makeGal() {
  const calls = [];
  globalThis.__renderGal = {
    playBgm(file, loop, volume) { calls.push(['playBgm', file, loop, volume]); },
    stopBgm() { calls.push(['stopBgm']); },
    playVoice(file, volume) { calls.push(['playVoice', file, volume]); },
    stopVoice() { calls.push(['stopVoice']); },
    status() { return { voice: false }; }
  };
  return calls;
}

test('game renders data-driven line, sprite, background and voice', () => {
  const calls = makeGal();
  const vm = Object.assign(Object.create(game.gameMethods), { view: 'game' });
  vm.initGame('main', 1);
  assert.ok(calls.some((call) => call[0] === 'playBgm' && call[1].endsWith('/bgm_1.opus')));

  calls.length = 0;
  vm.currentLine = 0;
  vm.applyCurrentLine(true);
  const tree = game.renderGame(vm, h);
  const body = text(tree);
  assert.match(body, /Line one/);
  assert.match(body, /1-1/);
  assert.doesNotMatch(body, /CHAPTER/);
  assert.match(body, /1 \/ 2/);
  assert.ok(calls.some((call) => call[0] === 'playVoice' && call[1].endsWith('/voice_1.ogg')));
  assert.ok(calls.some((call) => call[0] === 'stopBgm'));
});

test('afterstory renders cards and starts the generated scenario', () => {
  makeGal();
  const vm = Object.assign(Object.create(afterstory.afterstoryMethods), { view: 'afterstory' });
  vm.initAfterStory();
  const body = text(afterstory.renderAfterstory(vm, h));
  assert.match(body, /Heroine A/);
  assert.match(body, /After A|AFTER 1/);
  assert.match(body, /1 句台词/);

  const started = [];
  vm.initGame = (scenario, line) => started.push([scenario, line]);
  vm.startHeroineStory({ key: 'heroine_a' });
  assert.deepEqual(started, [['after_heroine_a', 0]]);
});

test('flowchart renders generated nodes and jumps to a target line', () => {
  makeGal();
  const vm = Object.assign(Object.create(flowchart.flowchartMethods), { view: 'flowchart' });
  vm.initFlowchart();
  const body = text(flowchart.renderFlowchart(vm, h));
  assert.match(body, /Node 1/);
  assert.doesNotMatch(body, /上一章|下一章/);
  assert.match(body, /Node 2/);

  const jumps = [];
  vm.initGame = (scenario, line) => jumps.push([scenario, line]);
  vm.jumpFromFlowchart(1);
  assert.deepEqual(jumps, [['main', 1]]);
});

test('gallery renders generated lists and plays the selected BGM', () => {
  const calls = makeGal();
  const vm = Object.assign(Object.create(gallery.galleryMethods), {});
  vm.initGallery();
  const body = text(gallery.renderGallery(vm, h));
  assert.match(body, /CG1/);

  vm.galleryTab = 'bgm';
  assert.match(text(gallery.renderGallery(vm, h)), /BGM1/);

  vm.playGalleryBgm(0);
  assert.ok(calls.some((call) => call[0] === 'playBgm' && call[1].endsWith('/bgm_1.opus')));
});
