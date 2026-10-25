import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);
const GAME_URL = new URL('app/pages/game/game.js', ROOT);
const GALLERY_URL = new URL('app/pages/gallery/gallery.js', ROOT);

function dataUrl(source) {
  return 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
}

const commonStub = `
export function S(names, extra) {
  return Object.assign({ testClasses: names }, extra || {});
}
export function log() {}
export function getChapterByLine() { return '1-1'; }
export function getGal() { return globalThis.__audioTestGal; }
`;

const storageStub = `
export function readAllSaves() { return {}; }
export function writeAllSaves() { return true; }
export function saveSlotRecord() {}
export function loadSlotRecord() { return null; }
export function getNowDateStr() { return '10-25 00:00'; }
export function pushBacklog() {}
export function readSettings() { return Object.assign({}, globalThis.__audioTestSettings); }
`;

// row[0] id, row[1] speaker, row[2] text, row[3] voice, row[4] bg, row[5] bgm, row[6] char, row[7] chapter
const MAIN_ROWS = [
  [0, '', '没有语音的第一句', null, '画面_黒', 'bgm01', null, '1-1'],
  [1, '', '带语音的第二句', 'voice01.ogg', '画面_黒', 'bgm02', null, '1-1'],
  [2, '', '回到第一首 BGM', null, '画面_黒', 'bgm01', null, '1-1']
];

const mediaStub = `
export function voicePath(name) {
  return '/userdisk/SenrenBanka/voice/' + (name.indexOf('.') >= 0 ? name : name + '.ogg');
}
export function bgmPath(name) {
  return '/userdisk/SenrenBanka/bgm/' + (name.indexOf('.') >= 0 ? name : name + '.opus');
}
export function bgUrl(name) {
  return name ? 'file:///userdisk/SenrenBanka/bg/' + name + (name.indexOf('.') >= 0 ? '' : '.png') : '';
}
export function fgUrl(name) {
  return 'file:///userdisk/SenrenBanka/fg/' + name + (name.indexOf('.') >= 0 ? '' : '.png');
}
export function cgUrl(name) {
  return 'file:///userdisk/SenrenBanka/cg/' + name + (name.indexOf('.') >= 0 ? '' : '.png');
}
export function titleBgUrl() { return 'file:///userdisk/SenrenBanka/bg/title_bg.png'; }
export function isBlackBg(name) { return !name || name === '__black__' || name === '画面_黒'; }
`;

const storyStub = dataUrl('export var STORY = ' + JSON.stringify({
  main: MAIN_ROWS,
  after: {},
  afterMeta: [],
  meta: {}
}) + ';');
const flowchartStub = dataUrl('export var FLOWCHART = { routes: [], nodes: [], choices: [], chain: {} };');
const galleryStub = dataUrl('export var GALLERY = ' + JSON.stringify({
  cg: [],
  bgm: [
    { id: 'bgm01', file: 'bgm01.opus', code: 'BGM01' },
    { id: 'bgm01i', file: 'bgm01i.opus', code: 'BGM01i' },
    { id: 'bgm02', file: 'bgm02.opus', code: 'BGM02' },
    { id: 'bgm03', file: 'bgm03.opus', code: 'BGM03' }
  ]
}) + ';');

let gameSource = await readFile(GAME_URL, 'utf8');
gameSource = gameSource.replace(
  /import \{[^}]+\} from '\.\.\/\.\.\/common\.js';/,
  `import { S, getGal, log, getChapterByLine } from '${dataUrl(commonStub)}';`
);
gameSource = gameSource.replace(
  /import \{[^']*?\} from '\.\.\/\.\.\/storage\.js';/,
  `import { readAllSaves, writeAllSaves, saveSlotRecord, loadSlotRecord, getNowDateStr, pushBacklog, readSettings } from '${dataUrl(storageStub)}';`
);
gameSource = gameSource.replace(
  /import \{ STORY \} from '\.\.\/\.\.\/data\/story_data\.js';/,
  `import { STORY } from '${storyStub}';`
);
gameSource = gameSource.replace(
  /import \{ FLOWCHART \} from '\.\.\/\.\.\/data\/flowchart_data\.js';/,
  `import { FLOWCHART } from '${flowchartStub}';`
);
gameSource = gameSource.replace(
  /import \{[^}]+\} from '\.\.\/\.\.\/media\.js';/,
  `import { voicePath, bgmPath, bgUrl, fgUrl, isBlackBg } from '${dataUrl(mediaStub)}';`
);
assert.doesNotMatch(gameSource, /from '\.\.\/\.\.\/(?:common|storage|data|media)\//, 'game.js must load with native dependencies stubbed');
const { gameMethods } = await import(dataUrl(gameSource));

let gallerySource = await readFile(GALLERY_URL, 'utf8');
gallerySource = gallerySource.replace(
  /import \{[^}]+\} from '\.\.\/\.\.\/common\.js';/,
  `import { S, log, getGal } from '${dataUrl(commonStub)}';`
);
if (/from '\.\.\/\.\.\/storage\.js'/.test(gallerySource)) {
  gallerySource = gallerySource.replace(
    /import \{[^}]+\} from '\.\.\/\.\.\/storage\.js';/,
    `import { readSettings } from '${dataUrl(storageStub)}';`
  );
}
gallerySource = gallerySource.replace(
  /import \{ GALLERY \} from '\.\.\/\.\.\/data\/gallery_data\.js';/,
  `import { GALLERY } from '${galleryStub}';`
);
gallerySource = gallerySource.replace(
  /import \{[^}]+\} from '\.\.\/\.\.\/media\.js';/,
  `import { cgUrl, bgmPath, titleBgUrl } from '${dataUrl(mediaStub)}';`
);
assert.doesNotMatch(gallerySource, /from '\.\.\/\.\.\/(?:common|storage|data|media)\//, 'gallery.js must load with native dependencies stubbed');
const { galleryMethods } = await import(dataUrl(gallerySource));

function setAudioSettings(settings) {
  globalThis.__audioTestSettings = Object.assign(
    { bgmEnabled: true, bgmVolume: 0.8 },
    settings || {}
  );
}

function installGal() {
  const calls = [];
  globalThis.__audioTestGal = {
    playBgm(file, loop, volume) { calls.push({ method: 'playBgm', file, loop, volume }); },
    stopBgm() { calls.push({ method: 'stopBgm' }); },
    playVoice(file, volume) { calls.push({ method: 'playVoice', file, volume }); },
    stopVoice() { calls.push({ method: 'stopVoice' }); },
    status() { return { voice: false }; }
  };
  return calls;
}

function makeGameVm(settings) {
  setAudioSettings(settings);
  const calls = installGal();
  const vm = Object.assign(Object.create(gameMethods), { view: 'game' });
  return { vm, calls };
}

function makeGalleryVm(settings) {
  setAudioSettings(settings);
  const calls = installGal();
  const vm = Object.assign(Object.create(galleryMethods), {});
  vm.initGallery();
  return { vm, calls };
}

function playCalls(calls) {
  return calls.filter((call) => call.method === 'playBgm');
}

function captureInterval(run) {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let tick = null;
  const cleared = [];
  globalThis.setInterval = (fn) => {
    tick = fn;
    return 7;
  };
  globalThis.clearInterval = (id) => {
    cleared.push(id);
  };
  try {
    run(() => tick);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
  return cleared;
}

test('game BGM is silent when the persisted switch is off', () => {
  const { vm, calls } = makeGameVm({ bgmEnabled: false, bgmVolume: 0.25 });

  vm.initGame('main', 0);

  assert.equal(playCalls(calls).length, 0, 'disabled BGM must never reach playBgm');
});

test('game BGM resumes after the switch is enabled and the game is re-entered', () => {
  const { vm, calls } = makeGameVm({ bgmEnabled: false, bgmVolume: 0.4 });
  vm.initGame('main', 0);
  assert.equal(playCalls(calls).length, 0);

  setAudioSettings({ bgmEnabled: true, bgmVolume: 0.4 });
  vm.initGame('main', 0);
  assert.deepEqual(playCalls(calls)[0], {
    method: 'playBgm',
    file: '/userdisk/SenrenBanka/bgm/bgm01.opus',
    loop: true,
    volume: 0.4
  });
});

test('game BGM plays at the persisted volume and falls back to 0.8', () => {
  const persisted = makeGameVm({ bgmEnabled: true, bgmVolume: 0.35 });
  persisted.vm.initGame('main', 0);
  assert.deepEqual(playCalls(persisted.calls)[0], {
    method: 'playBgm',
    file: '/userdisk/SenrenBanka/bgm/bgm01.opus',
    loop: true,
    volume: 0.35
  });

  const defaults = makeGameVm({});
  defaults.vm.initGame('main', 0);
  assert.equal(playCalls(defaults.calls)[0].volume, 0.8);
});

test('ducking restore after a voice line reuses the persisted volume', () => {
  const { vm, calls } = makeGameVm({ bgmEnabled: true, bgmVolume: 0.42 });
  vm.initGame('main', 0);
  assert.equal(playCalls(calls)[0].volume, 0.42);

  calls.length = 0;
  vm.currentLine = 1;
  vm.applyCurrentLine(true);
  assert.ok(calls.some((call) => call.method === 'stopBgm'), 'voice must duck the BGM');
  assert.equal(vm.bgmSuspendedForVoice, true);

  calls.length = 0;
  vm.currentLine = 0;
  vm.applyCurrentLine(false);
  assert.deepEqual(playCalls(calls)[0], {
    method: 'playBgm',
    file: '/userdisk/SenrenBanka/bgm/bgm01.opus',
    loop: true,
    volume: 0.42
  });
  assert.equal(vm.bgmSuspendedForVoice, false);
});

test('ducking restore stays silent when the switch is off', () => {
  const { vm, calls } = makeGameVm({ bgmEnabled: true, bgmVolume: 0.5 });
  vm.initGame('main', 0);
  vm.currentLine = 1;
  vm.applyCurrentLine(true);

  setAudioSettings({ bgmEnabled: false, bgmVolume: 0.5 });
  calls.length = 0;
  vm.currentLine = 0;
  vm.applyCurrentLine(false);

  assert.equal(playCalls(calls).length, 0, 'disabled restore must not play');
  assert.equal(vm.bgmSuspendedForVoice, false);
});

test('voice watcher restore uses the persisted volume', () => {
  const { vm, calls } = makeGameVm({ bgmEnabled: true, bgmVolume: 0.63 });
  vm.initGame('main', 0);

  captureInterval((getTick) => {
    vm.currentLine = 1;
    vm.applyCurrentLine(true);
    const tick = getTick();
    assert.equal(typeof tick, 'function', 'voice watcher must schedule a timer');
    calls.length = 0;
    tick();
    tick();
  });

  assert.deepEqual(playCalls(calls)[0], {
    method: 'playBgm',
    file: '/userdisk/SenrenBanka/bgm/bgm01.opus',
    loop: true,
    volume: 0.63
  });
});

test('voice watcher restore stays silent when the switch is off', () => {
  const { vm, calls } = makeGameVm({ bgmEnabled: true, bgmVolume: 0.5 });
  vm.initGame('main', 0);

  captureInterval((getTick) => {
    vm.currentLine = 1;
    vm.applyCurrentLine(true);
    const tick = getTick();
    setAudioSettings({ bgmEnabled: false, bgmVolume: 0.5 });
    calls.length = 0;
    tick();
    tick();
  });

  assert.equal(playCalls(calls).length, 0, 'disabled watcher restore must not play');
  assert.equal(vm.bgmSuspendedForVoice, false);
});

test('auto play waits for voice EOS and uses five seconds for silent lines', () => {
  const { vm } = makeGameVm({ bgmEnabled: true, bgmVolume: 0.4 });
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = [];
  globalThis.setTimeout = (fn, delay) => {
    timers.push({ fn, delay });
    return timers.length;
  };
  globalThis.clearTimeout = () => {};
  try {
    vm.currentLine = 0;
    vm.autoPlay = false;
    vm.toggleAutoPlay();
    assert.equal(timers[0].delay, 5000, 'silent line must wait five seconds');

    vm.autoPlay = false;
    vm.currentLine = 1;
    timers.length = 0;
    vm.toggleAutoPlay();
    assert.equal(timers.length, 0, 'voice line must wait for the voice watcher');

    vm.onVoicePlaybackEnded();
    assert.equal(timers.at(-1).delay, 300, 'voice completion should advance promptly');
    timers.at(-1).fn();
    assert.equal(vm.currentLine, 2);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('gallery BGM honors the switch and persisted volume', () => {
  const disabled = makeGalleryVm({ bgmEnabled: false, bgmVolume: 0.3 });
  disabled.vm.playGalleryBgm(3);
  assert.equal(playCalls(disabled.calls).length, 0, 'disabled gallery BGM must not play');
  assert.equal(disabled.vm.galleryBgmIndex, 3, 'track selection is still remembered');
  assert.equal(disabled.vm.galleryPlayingBgm, '', 'no playing state without audio');

  const enabled = makeGalleryVm({ bgmEnabled: true, bgmVolume: 0.3 });
  enabled.vm.playGalleryBgm(3);
  assert.deepEqual(playCalls(enabled.calls)[0], {
    method: 'playBgm',
    file: '/userdisk/SenrenBanka/bgm/bgm03.opus',
    loop: true,
    volume: 0.3
  });
});

test('clicking the currently playing gallery track pauses instead of restarting', () => {
  const { vm, calls } = makeGalleryVm({ bgmEnabled: true, bgmVolume: 0.4 });
  vm.playGalleryBgm(3);
  assert.equal(vm.galleryPlayingBgm, 'bgm03.opus');
  calls.length = 0;

  vm.playGalleryBgm(3);

  assert.equal(vm.galleryPlayingBgm, '');
  assert.deepEqual(calls, [{ method: 'stopBgm' }]);
});

test('gallery pause/resume reuses the persisted volume and respects the switch', () => {
  const enabled = makeGalleryVm({ bgmEnabled: true, bgmVolume: 0.27 });
  enabled.vm.playGalleryBgm(1);
  enabled.vm.toggleGalleryBgmState();
  assert.equal(enabled.vm.galleryPlayingBgm, '');
  assert.equal(enabled.calls.at(-1).method, 'stopBgm');

  enabled.calls.length = 0;
  enabled.vm.toggleGalleryBgmState();
  assert.deepEqual(playCalls(enabled.calls)[0], {
    method: 'playBgm',
    file: '/userdisk/SenrenBanka/bgm/bgm01i.opus',
    loop: true,
    volume: 0.27
  });

  const disabled = makeGalleryVm({ bgmEnabled: false, bgmVolume: 0.27 });
  disabled.vm.galleryBgmIndex = 0;
  disabled.vm.galleryPlayingBgm = '';
  disabled.vm.toggleGalleryBgmState();
  assert.equal(playCalls(disabled.calls).length, 0, 'disabled gallery resume must stay silent');
});
