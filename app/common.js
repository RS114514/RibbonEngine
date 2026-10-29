// common.js —— 样式、原生 gal 模块加载与通用存储导出
import ST from './Styles.js';
import galImported from 'gal';
import {
  setGameId,
  getGameId,
  getSaveFilePath,
  getSettingsFilePath,
  getNowDateStr,
  readAllSaves,
  writeAllSaves,
  saveSlotRecord,
  loadSlotRecord,
  deleteSlotRecord,
  readSettings,
  writeSettings,
  pushBacklog,
  getBacklog,
  clearBacklog,
  clearAllData,
  resolveSlotThumbnail
} from './storage.js';

export {
  setGameId,
  getGameId,
  getSaveFilePath,
  getSettingsFilePath,
  getNowDateStr,
  readAllSaves,
  writeAllSaves,
  saveSlotRecord,
  loadSlotRecord,
  deleteSlotRecord,
  readSettings,
  writeSettings,
  pushBacklog,
  getBacklog,
  clearBacklog,
  clearAllData,
  resolveSlotThumbnail
};

// 章节名由数据行提供；缺失时返回可读占位，不再猜测游戏章节区间。
export function getChapterByLine(line) {
  if (typeof line === 'string' && line.trim()) {
    return formatChapter(line);
  }
  return '--';
}

// 原版脚本常见的 `chapter　2-1` / `CHAPTER 2-1` 不应原样显示在窄屏上。
export function formatChapter(value) {
  var text = String(value || '').replace(/^chapter[\s\u3000]*/i, '').replace(/\s+/g, ' ').trim();
  return text || '--';
}

export function S(name, extra) {
  var out = {};
  if (typeof name === 'string') {
    var parts = name.split(/\s+/);
    for (var i = 0; i < parts.length; i++) {
      var cls = parts[i];
      if (cls && ST[cls]) {
        for (var k in ST[cls]) out[k] = ST[cls][k];
      }
    }
  }
  if (extra) {
    for (var k in extra) out[k] = extra[k];
  }
  return out;
}

export function fmtTime(ms) {
  var s = Math.floor((Number(ms) || 0) / 1000);
  if (s < 0) s = 0;
  var m = Math.floor(s / 60);
  var ss = s % 60;
  var mm = m < 10 ? '0' + m : '' + m;
  var sx = ss < 10 ? '0' + ss : '' + ss;
  return mm + ':' + sx;
}

export function getGal() {
  if (galImported && typeof galImported.playBgm === 'function') return galImported;
  try {
    if (typeof importModule === 'function') {
      var m = importModule('gal');
      if (m && typeof m.playBgm === 'function') return m;
    }
  } catch (e) {}
  try {
    if (globalThis.gal && typeof globalThis.gal.playBgm === 'function') return globalThis.gal;
  } catch (e) {}
  return null;
}

export function log(m) {
  try { console.warn('[gal] ' + m); } catch (e) {}
}
