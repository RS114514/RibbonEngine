import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

// 1. 验证 story_data.js 中的剧本数据
test('Story Data: Nene route and restart 2nd run integrity', async () => {
  const storyMod = await import('../app/data/story_data.js');
  const story = storyMod.STORY;

  const { scn_nene: nene } = await import('../app/data/scn_nene.js');
  const { scn_nene_restart: restart } = await import('../app/data/scn_nene_restart.js');
  const { after_nene: after } = await import('../app/data/after_nene.js');
  assert.equal(story.routeClearKeys.nene, 'nene');
  assert.equal(story.routeClearKeys.nene_restart, 'nene_restart');
  assert.ok(after.length > 0);

  assert.equal(nene.length, 7158, 'Nene 1st run should have 7158 lines');
  const lastNeneLine = nene[nene.length - 1];
  assert.ok(lastNeneLine[2].includes('此时不拼，更待何时呢'), 'Last line should be Shushi memory-wiped monologue');

  // 二周目重启台词量与宁宁独白
  assert.equal(restart.length, 5507, 'Nene restart route should have 5507 lines');
  // 110 宁宁视角独白前几句
  const firstRestartLine = restart[0];
  const secondRestartLine = restart[1];
  const thirdRestartLine = restart[2];
  assert.equal(firstRestartLine[1], '柊史', 'First line speaker should be Shushi');
  assert.ok(firstRestartLine[2].includes('一路走好'), 'First line should be Shushi farewell');
  assert.equal(secondRestartLine[1], '宁宁', 'Second line speaker should be Nene');
  assert.ok(thirdRestartLine[2].includes('扣动扳机'), 'Third line should be Nene pulling trigger for time reversal');

  // 111 男主视角时间回溯（第 355 行起）
  const rewindLine = restart[355];
  assert.equal(rewindLine[1], '女同学');
  assert.ok(rewindLine[2].includes('可以跟你说点事吗'), 'Time reversed mirror opening');
});

// 2. 验证 storage.js 通关判定与安全场景解析
test('Storage & SafeScenario: support nene and nene_restart persistence', async () => {
  const storagePath = new URL('../app/storage.js', import.meta.url);
  const original = await readFile(storagePath, 'utf8');
  const stubbed = original.replace(
    "import { getGal, log } from './common.js';",
    "const getGal = () => globalThis.__testGal; const log = () => {};"
  );
  const storage = await import(
    'data:text/javascript;base64,' + Buffer.from(stubbed).toString('base64')
  );

  let mockSettings = { clearedRoutes: [] };
  globalThis.__testGal = {
    readText: () => JSON.stringify(mockSettings),
    writeText: (_path, value) => {
      mockSettings = JSON.parse(value);
      return true;
    }
  };

  assert.equal(storage.isRouteCleared('nene'), false);
  assert.equal(storage.isRouteCleared('nene_restart'), false);

  storage.markRouteClearedInStorage('nene');
  assert.equal(storage.isRouteCleared('nene'), true);
  assert.equal(storage.isRouteCleared('nene_restart'), false);

  storage.markRouteClearedInStorage('nene_restart');
  assert.equal(storage.isRouteCleared('nene_restart'), true);
});

// 3. 验证 title.js 中的二周目重启交互与弹层
test('Title UI: restart is a separate entry from start game', async () => {
  const titlePath = new URL('../app/pages/title/title.js', import.meta.url);
  let titleCode = await readFile(titlePath, 'utf8');
  titleCode = titleCode
    .replace("import { S, getGal, log, formatChapter } from '../../common.js';", "const S = () => ({}); const getGal = () => null; const log = () => {}; const formatChapter = value => String(value || '').replace(/^chapter[\\s\\u3000]*/i, '').trim() || '--';")
    .replace("import { readAllSaves, readSettings, writeSettings, clearAllData } from '../../storage.js';", `
      const readAllSaves = () => ({});
      const readSettings = () => globalThis.__titleTestSettings;
      const writeSettings = () => {};
      const clearAllData = () => {};
    `)
    .replace("import { STORY } from '../../data/story_data.js';", "const STORY = { meta: { titleBgm: '' }, routes: { nene: [], nene_restart: [] } };")
    .replace("import { bgmPath, bgUrl, isBlackBg, titleBgUrl, sysUrl, seUrl } from '../../media.js';", "const bgmPath = () => ''; const bgUrl = () => ''; const isBlackBg = () => false; const titleBgUrl = () => ''; const sysUrl = () => ''; const seUrl = () => '';");

  const titleMod = await import('data:text/javascript;base64,' + Buffer.from(titleCode).toString('base64'));

  // 情况 A: 未通关宁宁线
  globalThis.__titleTestSettings = { clearedRoutes: [] };
  const vmUnfinished = { ...titleMod.titleMethods };
  vmUnfinished.initTitle();
  assert.equal(vmUnfinished.hasNeneCleared, false);
  vmUnfinished.startNewGame();
  assert.equal(vmUnfinished.currentScenario, 'main');
  assert.equal(vmUnfinished.titleModalType, '');

  // 情况 B: 已通关宁宁一周目
  globalThis.__titleTestSettings = { clearedRoutes: ['nene'] };
  const vmCleared = { ...titleMod.titleMethods };
  vmCleared.initTitle();
  assert.equal(vmCleared.hasNeneCleared, true);

  // 开始游戏仍是共通线；二周目是独立入口，不替换开始游戏
  vmCleared.startNewGame();
  assert.equal(vmCleared.currentScenario, 'main');
  assert.equal(vmCleared.titleModalType, '');

  const h = (tag, props, children) => ({ tag, props: props || {}, children: Array.isArray(children) ? children.flat() : (children ? [children] : []) });
  const readText = node => node && typeof node === 'object' ? (node.children || []).map(readText).join('') : String(node || '');
  const titleText = readText(titleMod.renderTitle(vmCleared, h));
  assert.match(titleText, /开始游戏/);
  assert.match(titleText, /重新开始/);
  assert.match(titleText, /流程图/);

  // 独立的重启入口进入二周目
  vmCleared.startNeneRestart();
  assert.equal(vmCleared.currentScenario, 'nene_restart');
  assert.equal(vmCleared.currentLine, 0);
  assert.equal(vmCleared.view, 'game');
});

// 4. 验证流程图数据与回溯拓扑
test('Flowchart: topology contains Nene 1st run and restart true route', async () => {
  const flowMod = await import('../app/data/flowchart_data.js');
  const flow = flowMod.FLOWCHART;

  assert.ok(flow.routes.includes('nene'));
  assert.ok(flow.routes.includes('nene_restart'));

  const neneNormalEnd = flow.nodes.find(n => n.id === 'node_nene_normal_end');
  assert.ok(neneNormalEnd, 'node_nene_normal_end must exist');
  assert.equal(neneNormalEnd.next, 'node_restart_monologue', 'Normal end must connect to restart monologue');

  const restartMonologue = flow.nodes.find(n => n.id === 'node_restart_monologue');
  assert.ok(restartMonologue, 'node_restart_monologue must exist');
  assert.equal(restartMonologue.route, 'nene_restart');
  assert.equal(restartMonologue.targetLine, 0);

  const restartTrueEnd = flow.nodes.find(n => n.id === 'node_restart_true_end');
  assert.ok(restartTrueEnd, 'node_restart_true_end must exist');
  assert.equal(restartTrueEnd.route, 'nene_restart');
});
