// storage.js —— 通用 Galgame 运行时数据存储规范
import { getGal, log } from './common.js';

var DEFAULT_GAME_ID = 'galgame';
var _activeGameId = DEFAULT_GAME_ID;

// 历史履历（Backlog）内存队列（FIFO，最大 100 条）
var _backlogQueue = [];
var MAX_BACKLOG = 100;

// 内存镜像缓存
var _savesCache = {};
var _settingsCache = {};

export function setGameId(id) {
  if (id && typeof id === 'string') {
    _activeGameId = id;
  }
}

export function getGameId() {
  return _activeGameId;
}

export function getSaveFilePath(gameId) {
  var gid = gameId || _activeGameId;
  return '/userdisk/gal_data/' + gid + '/saves.json';
}

export function getSettingsFilePath(gameId) {
  var gid = gameId || _activeGameId;
  return '/userdisk/gal_data/' + gid + '/settings.json';
}

export function getNowDateStr() {
  var d = new Date();
  var m = d.getMonth() + 1;
  var day = d.getDate();
  var h = d.getHours();
  var min = d.getMinutes();
  return (m < 10 ? '0' + m : '' + m) + '-' + (day < 10 ? '0' + day : '' + day) + ' ' +
         (h < 10 ? '0' + h : '' + h) + ':' + (min < 10 ? '0' + min : '' + min);
}

// 旧版本/旧 AI 生成的存档字段兼容：读取时补齐，不静默丢选择状态。
export function normalizeSaves(parsed) {
  var saves = parsed || {};
  for (var key in saves) {
    if (!/^slot\d+$/.test(key) || !saves[key] || typeof saves[key] !== 'object') continue;
    var item = saves[key];
    var extra = item.extra || {};
    item.time = item.time || item.date || '';
    item.chapter = item.chapter || '--';
    item.speaker = item.speaker || '';
    item.text = item.text || extra.text || '';
    item.bg = item.bg || '';
    item.cg = item.cg || '';
    item.sd = item.sd || '';
    item.extra = {
      choices: extra.choices || item.choiceSelections || {},
      flags: extra.flags || item.choiceFlags || {}
    };
  }
  return saves;
}

// 读取全部存档
export function readAllSaves(gameId) {
  var gid = gameId || _activeGameId;
  var G = getGal();
  if (G && typeof G.readText === 'function') {
    try {
      // 1. 尝试标准命名空间路径
      var newPath = getSaveFilePath(gid);
      var txt = G.readText(newPath);
      if (txt) {
        var parsed = normalizeSaves(JSON.parse(txt));
        _savesCache[gid] = parsed;
        return parsed;
      }
      // 2. 尝试通用备用平铺路径
      var flatTxt = G.readText('/userdisk/gal_data/' + gid + '_saves.json');
      if (flatTxt) {
        var flatParsed = normalizeSaves(JSON.parse(flatTxt));
        _savesCache[gid] = flatParsed;
        return flatParsed;
      }
    } catch (e) {
      log('readAllSaves error: ' + e);
    }
  }
  return _savesCache[gid] || {};
}

// 写入全部存档
export function writeAllSaves(saves, gameId) {
  var gid = gameId || _activeGameId;
  _savesCache[gid] = saves;
  var G = getGal();
  if (G && typeof G.writeText === 'function') {
    try {
      var str = JSON.stringify(saves);
      var ok = G.writeText(getSaveFilePath(gid), str);
      if (!ok) {
        ok = G.writeText('/userdisk/gal_data/' + gid + '_saves.json', str);
      }
      return ok;
    } catch (e) {
      log('writeAllSaves error: ' + e);
      return false;
    }
  }
  return true;
}

// 写入单槽存档记录
export function saveSlotRecord(slotNum, state, gameId) {
  var gid = gameId || _activeGameId;
  var saves = readAllSaves(gid);
  var record = {
    slot: Number(slotNum),
    gameId: gid,
    time: getNowDateStr(),
    timestamp: Date.now(),
    scenario: state.scenario || 'main',
    line: Number(state.line || 0),
    chapter: state.chapter || '--',
    speaker: state.speaker || '',
    text: (state.text || '').substring(0, 48),
    bg: state.bg || '',
    cg: state.cg || '',
    sd: state.sd || '',
    thumb: state.thumb || '',
    bgm: state.bgm || '',
    character: state.character || null,
    playTimeMs: Number(state.playTimeMs || 0),
    extra: state.extra || {}
  };
  saves['slot' + slotNum] = record;
  saves.latest = '' + slotNum;
  writeAllSaves(saves, gid);
  return record;
}

// 解析存档卡片缩略图（优先级：明确thumb > 事件CG > SD特殊演出 > 场景原画背景 > 默认壁纸）
export function resolveSlotThumbnail(it, gameId) {
  if (!it) return '';
  var gid = gameId || _activeGameId;
  var baseDir = '/userdisk/gal_data/' + gid + '/';

  if (it.thumb) {
    if (it.thumb.indexOf('file://') === 0) return it.thumb;
    return 'file://' + it.thumb;
  }
  if (it.cg) {
    return 'file://' + baseDir + 'cg/' + it.cg + '.png';
  }
  if (it.sd) {
    return 'file://' + baseDir + 'sd/' + String(it.sd).toUpperCase() + '.png';
  }
  if (it.bg && it.bg !== '画面_黒') {
    return 'file://' + baseDir + 'bg/' + it.bg + '.png';
  }
  return 'file://' + baseDir + 'bg/title_bg.png';
}

// 读取单槽记录
export function loadSlotRecord(slotNum, gameId) {
  var gid = gameId || _activeGameId;
  var saves = readAllSaves(gid);
  return saves['slot' + slotNum] || null;
}

// 删除单槽记录
export function deleteSlotRecord(slotNum, gameId) {
  var gid = gameId || _activeGameId;
  var saves = readAllSaves(gid);
  if (saves['slot' + slotNum]) {
    delete saves['slot' + slotNum];
    writeAllSaves(saves, gid);
  }
}

// 系统设置默认值
var DEFAULT_SETTINGS = {
  gameId: DEFAULT_GAME_ID,
  bgmVolume: 0.8,
  voiceVolume: 1.0,
  seVolume: 1.0,
  textSpeed: 'medium',
  autoDelay: 3500,
  bgmEnabled: true,
  unlockedCg: [],
  unlockedBgm: [],
  clearedRoutes: []
};

// 读取系统设置
export function readSettings(gameId) {
  var gid = gameId || _activeGameId;
  var G = getGal();
  if (G && typeof G.readText === 'function') {
    try {
      var txt = G.readText(getSettingsFilePath(gid));
      if (!txt) {
        txt = G.readText('/userdisk/gal_data/' + gid + '_settings.json');
      }
      if (txt) {
        var parsed = JSON.parse(txt);
        _settingsCache[gid] = Object.assign({}, DEFAULT_SETTINGS, parsed);
        return _settingsCache[gid];
      }
    } catch (e) {
      log('readSettings error: ' + e);
    }
  }
  return _settingsCache[gid] || Object.assign({}, DEFAULT_SETTINGS, { gameId: gid });
}

// 写入系统设置
export function writeSettings(settings, gameId) {
  var gid = gameId || _activeGameId;
  var merged = Object.assign({}, DEFAULT_SETTINGS, _settingsCache[gid] || {}, settings, { gameId: gid });
  _settingsCache[gid] = merged;
  var G = getGal();
  if (G && typeof G.writeText === 'function') {
    try {
      var str = JSON.stringify(merged);
      var ok = G.writeText(getSettingsFilePath(gid), str);
      if (!ok) {
        ok = G.writeText('/userdisk/gal_data/' + gid + '_settings.json', str);
      }
      return ok;
    } catch (e) {
      log('writeSettings error: ' + e);
      return false;
    }
  }
  return true;
}

// 历史履历（Backlog）入队
export function pushBacklog(entry) {
  if (!entry) return;
  _backlogQueue.push({
    id: entry.id || Date.now(),
    chapter: entry.chapter || '--',
    speaker: entry.speaker || '',
    text: entry.text || '',
    voice: entry.voice || null,
    bgm: entry.bgm || null,
    time: Date.now()
  });
  if (_backlogQueue.length > MAX_BACKLOG) {
    _backlogQueue.shift();
  }
}

// 获取全部历史履历
export function getBacklog() {
  return _backlogQueue.slice();
}

// 清空历史履历
export function clearBacklog() {
  _backlogQueue = [];
}

// 清除所有游玩数据（重置所有存档槽、清空系统设置与已解锁记录、清空履历）
export function clearAllData(gameId) {
  var gid = gameId || _activeGameId;
  _savesCache[gid] = {};
  _settingsCache[gid] = Object.assign({}, DEFAULT_SETTINGS, { gameId: gid });
  _backlogQueue = [];
  var G = getGal();
  if (G && typeof G.writeText === 'function') {
    try {
      G.writeText(getSaveFilePath(gid), '{}');
      G.writeText('/userdisk/gal_data/' + gid + '_saves.json', '{}');
      var defaultSettingsStr = JSON.stringify(_settingsCache[gid]);
      G.writeText(getSettingsFilePath(gid), defaultSettingsStr);
      G.writeText('/userdisk/gal_data/' + gid + '_settings.json', defaultSettingsStr);
    } catch (e) {
      log('clearAllData write error: ' + e);
    }
  }
  return true;
}
