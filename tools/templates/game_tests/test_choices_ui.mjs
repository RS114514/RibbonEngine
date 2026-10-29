import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const plain = value => JSON.parse(JSON.stringify(value));
async function load() {
  const files = new Map();
  const gal = {
    readText: path => files.get(path) || '',
    writeText: (path, value) => { files.set(path, value); return true; },
    playBgm() {}, stopBgm() {}, setBgmVolume() {}, stopVoice() {}, playVoice() {}
  };
  let timer = 0;
  const context = createContext({ console, setTimeout: () => ++timer, clearTimeout() {} });
  const modules = new Map();
  function get(path) {
    if (modules.has(path)) return modules.get(path);
    // Styles.js is build-generated, not a mock of game behavior. Load the existing artifact.
    const module = path === 'gal'
      ? new SyntheticModule(['default'], function () { this.setExport('default', gal); }, { context, identifier: path })
      : new SourceTextModule(readFileSync(path.endsWith('/app/Styles.js') ? resolve(root, 'build/stage/Styles.js') : path, 'utf8'), { context, identifier: path });
    modules.set(path, module);
    return module;
  }
  const entry = new SourceTextModule(`
    export * from './app/pages/game/game.js';
    export * from './app/pages/title/title.js';
    export * from './app/storage.js';
    export { choices_all } from './app/data/choices_all.js';
    export { flowchart_data } from './app/data/flowchart_data.js';
  `, { context, identifier: resolve(root, 'choices-test-entry.js') });
  await entry.link((specifier, ref) => get(specifier === 'gal' ? 'gal' : resolve(dirname(ref.identifier), specifier)));
  await entry.evaluate();
  const api = entry.namespace;
  const vm = { ...api.titleMethods, ...api.gameMethods, view: 'game', choiceSelections: {}, choiceFlags: {} };
  return { api, vm };
}
function choose(vm, index) {
  assert.ok(vm.activeChoice, `missing choice at ${vm.currentScenario}:${vm.currentLine}`);
  vm.selectChoiceOption(vm.activeChoice.options.find(option => option.index === index));
}
function advance(vm) {
  const line = vm.currentLine;
  for (let page = 0; page < 100 && vm.currentLine === line && !vm.activeChoice; page++) vm.nextLine();
  assert.ok(vm.currentLine !== line || vm.activeChoice, `stuck on ${line}`);
}

// Each test exercises real game/storage/data. Mutations caught: id collisions,
// wrong route lookup, ignored exp, cumulative rewards, guessed targets/skips.
test('main 2337 selection does not suppress main 2864 with the same dummy id', async () => {
  const { vm } = await load();
  vm.initGame('main', 2337); choose(vm, 1);
  vm.initGame('main', 2864);
  assert.equal(vm.activeChoice?.targetLine, 2864);
});
test('main 6984 never shows the meguru choice, while meguru 6984 does', async () => {
  const { vm } = await load();
  vm.initGame('main', 6984); assert.equal(vm.activeChoice, null);
  vm.initGame('meguru', 6984); assert.equal(vm.activeChoice?.route, 'meguru');
});
test('route affinity grows once, survives revisits, and changes by replacement', async () => {
  const { vm } = await load();
  vm.initGame('main', 2864); const choice = vm.activeChoice;
  choose(vm, 1); assert.equal(vm.choiceFlags.nen, 1);
  vm.activeChoice = choice; choose(vm, 1); assert.equal(vm.choiceFlags.nen, 1);
  vm.activeChoice = choice; choose(vm, 2);
  assert.equal(vm.choiceFlags.nen || 0, 0); assert.equal(vm.choiceFlags.meg, 1);
  assert.equal(vm.choiceSelections['main:2864'], 2);
});
test('all five affinity flags use the original precise route thresholds', async () => {
  const { vm } = await load();
  for (const [line, flags, route] of [
    [8485, { wak: 3 }, 'wakana'],
    [9220, { nen: 4 }, 'nene'],
    [9220, { meg: 4 }, 'meguru'],
    [9220, { tsu: 2 }, 'tsumugi'],
    [9220, { tou: 3 }, 'touko']
  ]) {
    vm.choiceFlags = flags;
    vm.currentScenario = 'main';
    assert.equal(vm.resolveRouteBranchAt(line), route);
  }
  vm.choiceFlags = { nen: 3 };
  assert.equal(vm.resolveRouteBranchAt(9220), null);
});
test('canonical save/load and title continue restore selections, flags and exact pending skip', async () => {
  const { api, vm } = await load();
  vm.initGame('main', 2864); choose(vm, 1); vm.executeSave(4);
  const saved = api.loadSlotRecord(4);
  assert.equal(saved.extra.choices['main:2864'], 1); assert.equal(saved.extra.flags.nen, 1);
  vm.choiceFlags = {}; vm.choiceSelections = {}; vm.executeLoad(4);
  assert.equal(vm.currentLine, 2864);
  assert.equal(vm.activeChoice?.targetLine, 2864);
  assert.equal(vm.selectedChoiceIndex, 1);
  choose(vm, 1);
  assert.equal(vm.currentLine, 2864);
  assert.equal(vm.activeChoice, null);
  assert.ok(vm.pendingSkipStack.some(s => s.skipAfterLine === 2990 && s.skipToLine === 3055));
  vm.currentLine = 2990; vm.applyCurrentLine(false); advance(vm); assert.equal(vm.currentLine, 3055);
  vm.choiceFlags = {}; vm.choiceSelections = {}; vm.continueGame();
  assert.equal(vm.choiceSelections['main:2864'], 1); assert.equal(vm.choiceFlags.nen, 1);
  vm.initGame('main', 2864); assert.equal(vm.activeChoice?.targetLine, 2864);
});
test('empty first branch targets keep the first dialogue and never invent +1', async () => {
  const { vm } = await load();
  vm.initGame('main', 2337); choose(vm, 1); assert.equal(vm.currentLine, 2337);
  vm.choiceSelections = {}; vm.choiceFlags = {};
  vm.initGame('main', 2337); choose(vm, 2); assert.equal(vm.currentLine, 2340);
});
test('006 branch targets and skipped interval follow source nexts exactly', async () => {
  const { api, vm } = await load(); api.clearBacklog();
  vm.initGame('main', 2864); choose(vm, 1);
  while (vm.currentLine < 3055) advance(vm);
  assert.equal(vm.currentLine, 3055);
  const visited = Array.from(api.getBacklog(), row => row.line);
  assert.ok(visited.includes(2990)); assert.ok(!visited.some(line => line >= 2991 && line < 3055));
  vm.choiceSelections = {}; vm.choiceFlags = {}; vm.initGame('main', 2864); choose(vm, 2);
  assert.equal(vm.currentLine, 2991);
});
test('nested 009 branch skips unreachable choices, including jump-to-choice', async () => {
  const { vm } = await load();
  vm.initGame('main', 3877); choose(vm, 1);
  assert.equal(vm.nextChoiceLine('main', 3878), 3963);
  vm.jumpToNextChoice(); assert.equal(vm.currentLine, 3963); choose(vm, 1);
  assert.equal(vm.nextChoiceLine('main', 3964), 4298);
  vm.currentLine = 3973; vm.applyCurrentLine(false); advance(vm);
  assert.equal(vm.currentLine, 4219);
  vm.jumpToNextChoice(); assert.equal(vm.currentLine, 4298);
});
test('route-scoped next-choice never falls back to a main flowchart node', async () => {
  const { vm } = await load();
  assert.equal(vm.nextChoiceLine('meguru', 6985), 7100);
  assert.equal(vm.nextChoiceLine('nene', 0), 4074);
  assert.equal(vm.nextChoiceLine('main', 6453), 7666);
});
test('back from a branch entry reopens only that choice without farming affinity', async () => {
  const { vm } = await load();
  vm.initGame('main', 2337); choose(vm, 1);
  vm.initGame('main', 2864); choose(vm, 2);
  vm.prevLine(); assert.equal(vm.activeChoice?.targetLine, 2864);
  assert.equal(vm.choiceSelections['main:2337'], 1);
  choose(vm, 2); assert.equal(vm.choiceFlags.meg, 1);
  vm.currentLine = 3055; vm.applyCurrentLine(false); vm.prevLine();
  assert.equal(vm.currentLine, 3054);
});

// Independent evidence oracle: same non-empty text contract as the read-only
// transcoder, but line expectations are reconstructed from original scene edges.
function sourceScenes(api, prefix, route) {
  const name = readdirSync(resolve(root, 'scenario_json')).find(name => name.startsWith(prefix + '.') && name.endsWith('.ks.json'));
  const raw = JSON.parse(readFileSync(resolve(root, 'scenario_json', name), 'utf8'));
  const anchor = (route === 'main' ? '' : route + '_') + raw.scenes[0].label.slice(1);
  let line = api.flowchart_data.chapterStart[anchor];
  assert.equal(typeof line, 'number', anchor);
  const scenes = raw.scenes.map(scene => {
    const start = line;
    for (const text of scene.texts || []) {
      const entries = text[1] || [];
      const value = (entries[1]?.[1] ?? entries[0]?.[1] ?? '').replace(/\\n/g, '\n').replace(/\\k\[\d+\]/g, '').trim();
      if (value) line++;
    }
    return { ...scene, start, end: line - 1 };
  });
  return { raw, scenes };
}
const scripts = { main: ['005', '006', '009', '010', '014', '017', '018', '019'], nene: ['104', '105', '108'], nene_restart: ['112', '113', '115'], meguru: ['214', '216', '217'], tsumugi: ['311', '313', '315'], touko: ['405', '407'], wakana: ['506'] };
test('every real option target matches original scene labels or the explicit shared prelude', async () => {
  const { api, vm } = await load();
  let checked = 0;
  for (const [route, prefixes] of Object.entries(scripts)) for (const prefix of prefixes) {
    const { scenes } = sourceScenes(api, prefix, route);
    for (const scene of scenes.filter(scene => scene.selects?.length)) {
      for (let index = 0; index < scene.selects.length; index++) {
        vm.choiceSelections = {}; vm.choiceFlags = {};
        vm.initGame(route, scene.start);
        const selected = scene.selects[index];
        const target = selected.target || scene.nexts?.[0]?.target;
        let node = scenes.find(s => s.label === target);
        assert.ok(node, `${prefix}:${scene.label} target ${target}`);
        while (node.end < node.start && !node.selects?.length) {
          assert.equal(node.nexts?.length, 1);
          node = scenes.find(s => s.label === node.nexts[0].target);
        }
        choose(vm, index + 1);
        assert.equal(vm.currentLine, node.start, `${route}:${scene.start} option ${index + 1} -> ${target}`);
        checked++;
      }
    }
  }
  assert.equal(checked, 76);
});


test('choice can be reopened and changed after a first answer', async () => {
  const { vm } = await load();
  vm.initGame('main', 2864);
  vm.highlightChoiceOption(vm.activeChoice.options.find(o => o.index === 1));
  vm.confirmChoiceOption();
  assert.equal(vm.choiceSelections['main:2864'], 1);
  vm.initGame('main', 2864);
  assert.equal(vm.activeChoice?.targetLine, 2864);
  vm.highlightChoiceOption(vm.activeChoice.options.find(o => o.index === 2));
  vm.confirmChoiceOption();
  assert.equal(vm.choiceSelections['main:2864'], 2);
});

test('choice requires an explicit selected option before confirm', async () => {
  const { vm } = await load();
  vm.initGame('main', 2864);
  assert.equal(vm.selectedChoiceIndex, -1);
  vm.confirmChoiceOption();
  assert.ok(vm.activeChoice);
  vm.highlightChoiceOption(vm.activeChoice.options.find(o => o.index === 1));
  vm.confirmChoiceOption();
  assert.equal(vm.activeChoice, null);
});

test('flowchart re-entry clears the confirmed-choice guard and reopens the choice', async () => {
  const { vm } = await load();
  vm.initGame('main', 2337);
  choose(vm, 1);
  vm.initGame('main', 2337);
  assert.equal(vm.currentLine, 2337);
  assert.equal(vm.activeChoice?.targetLine, 2337);
  assert.equal(vm.selectedChoiceIndex, 1);
});

test('original route entry lines switch to the chosen heroine route', async () => {
  const { vm } = await load();
  vm.initGame('main', 8484);
  vm.choiceFlags = { wak: 3 };
  vm.currentLine = 8485;
  vm.nextLine();
  assert.equal(vm.currentScenario, 'wakana');

  vm.initGame('main', 9219);
  vm.choiceFlags = { nen: 4 };
  vm.currentLine = 9220;
  vm.nextLine();
  assert.equal(vm.currentScenario, 'nene');
});
