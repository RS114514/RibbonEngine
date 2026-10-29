// pages/game/game.js —— 超宽带鱼屏 390+322+88 分栏视觉小说主引擎
import { S, getGal, log, getChapterByLine, formatChapter, getBacklog, resolveSlotThumbnail } from '../../common.js';
import {
  readAllSaves,
  writeAllSaves,
  saveSlotRecord,
  loadSlotRecord,
  getNowDateStr,
  pushBacklog,
  readSettings
} from '../../storage.js';
import { STORY } from '../../data/story_data.js';
import { FLOWCHART } from '../../data/flowchart_data.js';
import { voicePath, bgmPath, bgUrl, fgUrl, cgUrl, sdUrl, fxUrl, isBlackBg } from '../../media.js';

var FLOW_NODES = FLOWCHART.nodes || [];
var FLOW_CHOICES = FLOWCHART.choices || [];
var FLOW_NODE_MAP = {};
for (var flowNodeIndex = 0; flowNodeIndex < FLOW_NODES.length; flowNodeIndex++) {
  FLOW_NODE_MAP[FLOW_NODES[flowNodeIndex].id] = FLOW_NODES[flowNodeIndex];
}

var ALL_CHOICES = STORY.choices || FLOW_CHOICES;
var CHOICE_BY_SCENARIO = {};
for (var choiceEntryIndex = 0; choiceEntryIndex < ALL_CHOICES.length; choiceEntryIndex++) {
  var choiceEntry = ALL_CHOICES[choiceEntryIndex];
  var choiceScenario = choiceEntry.scenario || 'main';
  if (!CHOICE_BY_SCENARIO[choiceScenario]) CHOICE_BY_SCENARIO[choiceScenario] = {};
  var lineKey = choiceEntry.line !== undefined ? choiceEntry.line : choiceEntry.targetLine;
  CHOICE_BY_SCENARIO[choiceScenario][lineKey] = choiceEntry;
}

function findChoiceForLine(line, scenario) {
  var key = scenario || 'main';
  var byLine = CHOICE_BY_SCENARIO[key];
  if (byLine && byLine[line]) return byLine[line];
  for (var i = 0; i < FLOW_CHOICES.length; i++) {
    if (FLOW_CHOICES[i].targetLine === line) return FLOW_CHOICES[i];
  }
  return null;
}

function resolveChoiceOptionLine(option) {
  if (!option) return null;
  if (typeof option.targetLine === 'number') return option.targetLine;
  var target = FLOW_NODE_MAP[option.targetNode];
  return target && typeof target.targetLine === 'number' ? target.targetLine : null;
}

var MAIN_ROWS = STORY.main || [];
var AFTER_STORIES = STORY.after || {};
var ROUTE_STORIES = STORY.routes || STORY.scenarios || {};
var SCENARIOS = { main: MAIN_ROWS };
for (var routeKey in ROUTE_STORIES) {
  if (Object.prototype.hasOwnProperty.call(ROUTE_STORIES, routeKey)) {
    SCENARIOS[routeKey] = ROUTE_STORIES[routeKey];
  }
}
for (var scenarioKey in AFTER_STORIES) {
  if (Object.prototype.hasOwnProperty.call(AFTER_STORIES, scenarioKey)) {
    SCENARIOS['after_' + scenarioKey] = AFTER_STORIES[scenarioKey];
  }
}

var BRANCH_RULES = STORY.branchRules || [];
var ROUTE_CLEAR_KEYS = STORY.routeClearKeys || {};
var FX_MAP = STORY.fxEvents || {};

function persistClearedRoutes(routes) {
  var settings = readSettings() || {};
  var merged = Object.assign({}, settings, { clearedRoutes: routes });
  var G = getGal();
  if (!G || typeof G.writeText !== 'function') return false;
  try {
    var text = JSON.stringify(merged);
    var gameId = merged.gameId || (STORY.meta && STORY.meta.gameId) || 'galgame';
    var ok = G.writeText('/userdisk/gal_data/' + gameId + '/settings.json', text);
    if (!ok) {
      ok = G.writeText('/userdisk/gal_data/' + gameId + '_settings.json', text);
    }
    return !!ok;
  } catch (e) {
    log('persistClearedRoutes error: ' + e);
    return false;
  }
}

var GAME_ZOOM_LEVELS = [
  { scale: 1.0, w: 391, h: 220, label: '1.0x' },
  { scale: 1.5, w: 587, h: 330, label: '1.5x' },
  { scale: 2.0, w: 782, h: 440, label: '2.0x' },
  { scale: 2.5, w: 978, h: 550, label: '2.5x' }
];

function getBgmPlaybackSettings() {
  var settings = readSettings() || {};
  var volume = typeof settings.bgmVolume === 'number' && isFinite(settings.bgmVolume)
    ? settings.bgmVolume
    : 0.8;
  if (volume < 0) volume = 0;
  if (volume > 1) volume = 1;
  return {
    enabled: settings.bgmEnabled !== false,
    volume: volume
  };
}

export function getSpriteUrl(charInfo) {
  if (!charInfo) return '';
  if (typeof charInfo === 'string') return fgUrl(charInfo);
  if (charInfo.sprite) return fgUrl(charInfo.sprite);
  var c = charInfo.char || '';
  var d = charInfo.dress || 'default';
  var f = charInfo.face || '01';
  if (!c) return '';
  return fgUrl(c + '_' + d + '_' + f);
}

export var gameMethods = {
  initGame: function (scenario, line) {
    var targetScenario = scenario || this.currentScenario || 'main';
    if (!SCENARIOS[targetScenario]) targetScenario = 'main';
    var rows = SCENARIOS[targetScenario] || [];
    this.currentScenario = targetScenario;
    this.currentScenarioData = rows;
    var targetLine = typeof line === 'number' && line >= 0 && line < rows.length ? line : 0;
    this.currentLine = targetLine;
    this.currentBgm = '';
    this.bgmSuspendedForVoice = false;
    this.autoPlay = false;
    this.skipMode = false;
    this.zoomMode = false;
    this.modalType = '';
    this.confirmModal = null;
    this.activeChoice = null;
    this.choiceNotice = '';
    this.menuNotice = '';
    this.normalEnd = false;
    this.clearAutoTimer();
    this.clearVoiceWatcher();
    this.clearFxTimers();
    this.clearFx();
    this.historyList = [];
    this.historyFocusIndex = 0;
    this.historyScrollY = 0;
    this.gameZoomIndex = 0;
    this.gameImgPanX = 0;
    this.gameImgPanY = 0;
    if (!this.choiceSelections) this.choiceSelections = {};
    if (!this.choiceFlags) this.choiceFlags = {};
    this.rebuildChoiceSkips();
    this.applyCurrentLine(true);
  },

  clearAutoTimer: function () {
    if (this.autoTimer) {
      clearTimeout(this.autoTimer);
      this.autoTimer = null;
    }
  },

  clearVoiceWatcher: function () {
    if (this._voiceWatchTimer) {
      clearInterval(this._voiceWatchTimer);
      this._voiceWatchTimer = null;
    }
    this._voiceWatchCounter = 0;
  },

  clearFxTimers: function () {
    if (this._fxAnimTimer) {
      clearInterval(this._fxAnimTimer);
      this._fxAnimTimer = null;
    }
  },

  clearFx: function () {
    this.fxWhite = 0;
    this.fxBlack = 0;
    this.fxShakeX = 0;
    this.fxShakeY = 0;
    this.fxOverlaySrc = '';
    this._fxAnim = null;
  },

  clearTransientFx: function () {
    this.fxWhite = 0;
    this.fxBlack = 0;
    this.fxShakeX = 0;
    this.fxShakeY = 0;
    this.fxOverlaySrc = '';
  },

  fxTicks: function (ms) {
    var value = Number(ms);
    if (!isFinite(value) || value <= 0) value = 240;
    return Math.max(1, Math.ceil(value / 33));
  },

  tickFx: function () {
    var a = this._fxAnim;
    if (!a) {
      this.clearFxTimers();
      return;
    }
    if (!isFinite(a.end) || a.end < 0) {
      this.clearFxTimers();
      this.fxWhite = 0;
      this.fxShakeX = 0;
      this.fxShakeY = 0;
      this.fxOverlaySrc = '';
      return;
    }
    a.tick++;
    var black = a.black;
    var white = a.white;
    for (var i = 0; i < a.segments.length; i++) {
      var s = a.segments[i];
      if (a.tick >= s.start && a.tick <= s.end) {
        var p = (a.tick - s.start) / Math.max(1, s.end - s.start);
        var val = s.from + (s.to - s.from) * p;
        if (s.field === 'fxBlack') black = val;
        if (s.field === 'fxWhite') white = val;
      } else if (a.tick > s.end) {
        if (s.field === 'fxBlack') black = s.to;
        if (s.field === 'fxWhite') white = s.to;
      }
    }
    this.fxBlack = black;
    this.fxWhite = white;

    if (a.shake && a.tick >= a.shake.start && a.tick <= a.shake.end) {
      var amp = a.shake.amp || 6;
      var phase = (a.tick - a.shake.start) % 4;
      if (phase === 0) { this.fxShakeX = amp; this.fxShakeY = 0; }
      else if (phase === 1) { this.fxShakeX = -amp; this.fxShakeY = amp / 2; }
      else if (phase === 2) { this.fxShakeX = amp / 2; this.fxShakeY = -amp; }
      else { this.fxShakeX = 0; this.fxShakeY = 0; }
    } else {
      this.fxShakeX = 0;
      this.fxShakeY = 0;
    }

    if (a.overlay && a.tick >= a.overlay.start && a.tick <= a.overlay.end) {
      this.fxOverlaySrc = a.overlay.src;
    } else {
      this.fxOverlaySrc = '';
    }

    if (a.tick >= a.end) {
      this.clearFxTimers();
      this._fxAnim = null;
      this.fxShakeX = 0;
      this.fxShakeY = 0;
      this.fxOverlaySrc = '';
    }
  },

  fxOverlayPath: function (kind) {
    if (!kind) return '';
    return fxUrl(kind);
  },

  runLineFx: function (row, nextRow) {
    this.clearFxTimers();
    var self = this;
    var scenario = this.currentScenario || 'main';
    var line = this.currentLine || 0;
    var evList = (FX_MAP[scenario] && FX_MAP[scenario][line]) || [];

    var anim = {
      tick: 0,
      end: 0,
      black: this.fxBlack || 0,
      white: 0,
      segments: [],
      shake: null,
      overlay: null
    };

    var lastBlack = anim.black;
    var lastWhite = 0;

    function pushBlack(to, ms) {
      var value = Number(ms);
      if (!isFinite(value) || value <= 0) {
        lastBlack = to;
        anim.black = to;
        return;
      }
      var t = self.fxTicks(value);
      var start = anim.end;
      anim.segments.push({ field: 'fxBlack', from: lastBlack, to: to, start: start, end: start + t });
      lastBlack = to;
      anim.end = start + t;
    }

    function pushWhite(to, ms) {
      var value = Number(ms);
      if (!isFinite(value) || value <= 0) {
        lastWhite = to;
        anim.white = to;
        return;
      }
      var t = self.fxTicks(value);
      var start = anim.end;
      anim.segments.push({ field: 'fxWhite', from: lastWhite, to: to, start: start, end: start + t });
      lastWhite = to;
      anim.end = start + t;
    }

    var shake = null;
    var white = false;
    var overlays = [];

    for (var i = 0; i < evList.length; i++) {
      var e = evList[i];
      var code = e[0];
      if (code === 'F' || code === 'f') {
        var ms = e[1] || 240;
        pushBlack(1, ms);
        pushBlack(0, ms);
      } else if (code === 'W') {
        white = true;
      } else if (code === 'S') {
        shake = { amp: e[1] || 8, ms: e[2] || 300 };
      } else if (code === 'O') {
        var path = this.fxOverlayPath(e[1]);
        if (path) overlays.push(path);
      }
    }

    if (white) {
      pushWhite(1, 100);
      pushWhite(0, 200);
    }
    if (shake) {
      var shakeEnd = this.fxTicks(shake.ms);
      anim.shake = { start: 0, end: shakeEnd, amp: shake.amp };
      anim.end = Math.max(anim.end, shakeEnd);
    }
    if (overlays.length) {
      var overlayEnd = this.fxTicks(500);
      anim.overlay = { start: 0, end: overlayEnd, src: overlays[0] };
      anim.end = Math.max(anim.end, overlayEnd);
    }

    this.fxBlack = anim.black;
    this.fxWhite = 0;
    if (anim.end > 0 || anim.shake || anim.overlay) {
      this._fxAnim = anim;
      this._fxAnimTimer = setInterval(function () { self.tickFx(); }, 33);
      this.tickFx();
    }
  },

  resolveRouteBranchAt: function (line) {
    if (this.currentScenario && this.currentScenario !== 'main') return null;
    var flags = this.choiceFlags || {};
    for (var i = 0; i < BRANCH_RULES.length; i++) {
      var r = BRANCH_RULES[i];
      if ((r.scenario || 'main') === 'main' && r.line === line) {
        if (!r.condition || flags[r.condition.flag] === r.condition.value) {
          return r.targetScenario;
        }
      }
    }
    return null;
  },

  hasAnyClearedRoute: function () {
    var settings = readSettings() || {};
    var cleared = settings.clearedRoutes;
    return !!(cleared && typeof cleared.length === 'number' && cleared.length > 0);
  },

  enterRoute: function (routeKey) {
    if (!routeKey || !SCENARIOS[routeKey]) return false;
    var G = getGal();
    if (G && typeof G.stopBgm === 'function') G.stopBgm();
    this.currentScenario = routeKey;
    this.currentLine = 0;
    this.initGame(routeKey, 0);
    return true;
  },

  markRouteCleared: function () {
    var clearKey = ROUTE_CLEAR_KEYS[this.currentScenario] || this.currentScenario.replace(/^route_/, '');
    if (!clearKey) return false;
    var settings = readSettings() || {};
    var cleared = settings.clearedRoutes;
    if (!cleared || typeof cleared.length !== 'number') cleared = [];
    var next = [];
    for (var i = 0; i < cleared.length; i++) {
      if (next.indexOf(cleared[i]) < 0) next.push(cleared[i]);
    }
    if (next.indexOf(clearKey) < 0) next.push(clearKey);
    persistClearedRoutes(next);
    return true;
  },

  applyCurrentLine: function (playAudio) {
    var self = this;
    var rows = this.currentScenarioData || SCENARIOS[this.currentScenario || 'main'] || [];
    var row = rows[this.currentLine];
    if (!row) return;

    var choice = findChoiceForLine(this.currentLine, this.currentScenario);
    if (choice) {
      this.activeChoice = choice;
      this.choiceNotice = choice.prompt || '请选择分支';
      this.autoPlay = false;
      this.skipMode = false;
      this.clearAutoTimer();
      this.clearVoiceWatcher();
      var cGal = getGal();
      if (cGal && typeof cGal.stopVoice === 'function') cGal.stopVoice();
      return;
    } else {
      this.activeChoice = null;
    }

    this.runLineFx(row, rows[this.currentLine + 1]);

    if (row[2]) {
      pushBacklog({
        id: this.currentLine,
        chapter: formatChapter(row[7] || getChapterByLine(this.currentLine)),
        speaker: row[1] || '',
        text: row[2] || '',
        voice: row[3] || null,
        bgm: row[5] || null
      });
    }

    var G = getGal();
    var voiceFile = row[3];
    var bgmFile = row[5];

    if (G) {
      if (playAudio && voiceFile) {
        if (this.currentBgm) {
          if (typeof G.stopBgm === 'function') G.stopBgm();
          this.bgmSuspendedForVoice = true;
        }
        if (typeof G.stopVoice === 'function') G.stopVoice();
        if (typeof G.playVoice === 'function') G.playVoice(voicePath(voiceFile), 1.0);
        this.hasVoice = true;
        this.startVoiceWatcher();
      } else {
        this.hasVoice = false;
        this.clearVoiceWatcher();
        if (typeof G.stopVoice === 'function') G.stopVoice();

        if (bgmFile && bgmFile !== this.currentBgm) {
          this.currentBgm = bgmFile;
          this.bgmSuspendedForVoice = false;
          var bgmSettings = getBgmPlaybackSettings();
          if (bgmSettings.enabled && typeof G.playBgm === 'function') {
            G.playBgm(bgmPath(bgmFile), true, bgmSettings.volume);
          }
        } else if (this.bgmSuspendedForVoice && this.currentBgm) {
          this.bgmSuspendedForVoice = false;
          var resumeSettings = getBgmPlaybackSettings();
          if (resumeSettings.enabled && typeof G.playBgm === 'function') {
            G.playBgm(bgmPath(this.currentBgm), true, resumeSettings.volume);
          }
        }
      }
    }

    if (this.autoPlay) {
      this.scheduleAutoNext(row[2], row[3]);
    } else if (this.skipMode) {
      this.scheduleSkipNext();
    }
  },

  startVoiceWatcher: function () {
    this.clearVoiceWatcher();
    var self = this;
    var checkCount = 0;
    this._voiceWatchTimer = setInterval(function () {
      checkCount++;
      var G = getGal();
      if (!G) {
        self.clearVoiceWatcher();
        return;
      }
      var st = G.status ? G.status() : null;
      if (st && !st.voice && checkCount >= 2) {
        self.clearVoiceWatcher();
        self.onVoicePlaybackEnded();
      } else if (checkCount > 300) {
        self.clearVoiceWatcher();
      }
    }, 200);
  },

  onVoicePlaybackEnded: function () {
    if (this.bgmSuspendedForVoice && this.currentBgm && this.view === 'game') {
      this.bgmSuspendedForVoice = false;
      var G = getGal();
      var playback = getBgmPlaybackSettings();
      if (G && playback.enabled && typeof G.playBgm === 'function') {
        G.playBgm(bgmPath(this.currentBgm), true, playback.volume);
      }
    }
    if (this.autoPlay && this.view === 'game' && !this.modalType && !this.confirmModal && !this.activeChoice) {
      var self = this;
      this.clearAutoTimer();
      this.autoTimer = setTimeout(function () {
        if (self.autoPlay && self.view === 'game' && !self.modalType && !self.confirmModal && !self.activeChoice) {
          self.nextLine();
        }
      }, 300);
    }
  },

  scheduleAutoNext: function (text, voice) {
    this.clearAutoTimer();
    if (voice) return;
    var self = this;
    this.autoTimer = setTimeout(function () {
      if (self.autoPlay && self.view === 'game' && !self.modalType && !self.confirmModal && !self.activeChoice) {
        self.nextLine();
      }
    }, 5000);
  },

  scheduleSkipNext: function () {
    this.clearAutoTimer();
    var self = this;
    this.autoTimer = setTimeout(function () {
      if (self.skipMode && self.view === 'game' && !self.modalType && !self.confirmModal) {
        self.nextLine();
      }
    }, 180);
  },

  nextLine: function () {
    if (this.activeChoice || this.modalType || this.confirmModal) return;
    if (this.normalEnd) return;
    var rows = this.currentScenarioData || SCENARIOS[this.currentScenario || 'main'] || [];
    var nextIndex = this.currentLine + 1;

    // 分支合流跳过栈检查
    if (this.pendingSkipStack && this.pendingSkipStack.length) {
      for (var sIdx = this.pendingSkipStack.length - 1; sIdx >= 0; sIdx--) {
        var skip = this.pendingSkipStack[sIdx];
        if (this.currentLine === skip.skipAfterLine) {
          nextIndex = skip.skipToLine;
          this.pendingSkipStack.splice(sIdx, 1);
          break;
        }
      }
    }

    // 共通线主分支检查
    var branchRoute = this.resolveRouteBranchAt(this.currentLine);
    if (branchRoute) {
      this.enterRoute(branchRoute);
      return;
    }

    if (nextIndex >= rows.length) {
      this.markRouteCleared();
      this.normalEnd = true;
      this.autoPlay = false;
      this.skipMode = false;
      this.clearAutoTimer();
      return;
    }

    this.currentLine = nextIndex;
    this.applyCurrentLine(true);
  },

  prevLine: function () {
    this.menuNotice = '';
    if (this.normalEnd) this.normalEnd = false;
    var line = this.currentLine || 0;
    if (line <= 0) {
      this.menuNotice = '已经是第一句';
      return false;
    }
    this.modalType = '';
    this.confirmModal = null;
    this.autoPlay = false;
    this.skipMode = false;
    this.clearAutoTimer();
    this.activeChoice = null;
    this.currentLine = line - 1;
    var backChoice = findChoiceForLine(this.currentLine, this.currentScenario);
    if (backChoice && this.choiceSelections) {
      delete this.choiceSelections[backChoice.id];
    }
    this.rebuildChoiceSkips();
    this.applyCurrentLine(false);
    return true;
  },

  nextChoiceLine: function (scenario, afterLine) {
    var key = scenario || 'main';
    var byLine = CHOICE_BY_SCENARIO[key] || {};
    var lines = Object.keys(byLine).map(Number).sort(function (a, b) { return a - b; });
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (l >= afterLine) {
        return l;
      }
    }
    return null;
  },

  firstUnselectedChoiceLine: function (scenario, afterLine) {
    return this.nextChoiceLine(scenario, afterLine);
  },

  jumpToNextChoice: function () {
    var scenario = this.currentScenario || 'main';
    var line = this.currentLine || 0;
    this.menuNotice = '';
    var target = this.nextChoiceLine(scenario, line + 1);
    if (target === null) {
      this.menuNotice = '后方暂无未决选项';
      return false;
    }
    var targetChoice = findChoiceForLine(target, scenario);
    if (targetChoice && this.choiceSelections) {
      delete this.choiceSelections[targetChoice.id];
    }
    this.activeChoice = null;
    this.modalType = '';
    this.confirmModal = null;
    this.autoPlay = false;
    this.skipMode = false;
    this.clearAutoTimer();
    this.currentLine = target;
    this.rebuildChoiceSkips();
    this.applyCurrentLine(false);
    return true;
  },

  rebuildChoiceSkips: function () {
    this.pendingSkipStack = [];
    var scenario = this.currentScenario || 'main';
    var byLine = CHOICE_BY_SCENARIO[scenario] || {};
    var curLine = this.currentLine || 0;
    for (var l in byLine) {
      if (!Object.prototype.hasOwnProperty.call(byLine, l)) continue;
      var c = byLine[l];
      if (Number(l) <= curLine && this.choiceSelections && this.choiceSelections[c.id] !== undefined) {
        var optIdx = this.choiceSelections[c.id];
        var opt = c.options && c.options[optIdx - 1];
        if (opt && opt.skipAfterLine !== undefined && opt.skipToLine !== undefined) {
          if (curLine <= opt.skipAfterLine) {
            this.pendingSkipStack.push({
              id: c.id,
              skipAfterLine: opt.skipAfterLine,
              skipToLine: opt.skipToLine
            });
          }
        }
      }
    }
  },

  handleChoiceSelect: function (choice, option) {
    if (!choice || !option) return;
    var targetLine = resolveChoiceOptionLine(option);
    if (targetLine === null) return;
    this.modalType = '';
    this.confirmModal = null;
    this.activeChoice = null;
    if (!this.choiceSelections) this.choiceSelections = {};
    if (!this.choiceFlags) this.choiceFlags = {};
    this.choiceSelections[choice.id] = option.index;
    if (option.flagGain && option.flagGain.flag) {
      this.choiceFlags[option.flagGain.flag] = (this.choiceFlags[option.flagGain.flag] || 0) + (option.flagGain.points || 1);
    }
    if (typeof option.skipAfterLine === 'number' && typeof option.skipToLine === 'number') {
      if (!this.pendingSkipStack) this.pendingSkipStack = [];
      this.pendingSkipStack.push({
        id: choice.id,
        skipAfterLine: option.skipAfterLine,
        skipToLine: option.skipToLine
      });
    }
    this.currentLine = targetLine;
    this.currentBgm = '';
    this.bgmSuspendedForVoice = false;
    this.applyCurrentLine(true);
  },

  toggleAutoPlay: function () {
    if (this.activeChoice) return;
    this.skipMode = false;
    this.autoPlay = !this.autoPlay;
    if (this.autoPlay) {
      var rows = this.currentScenarioData || SCENARIOS[this.currentScenario || 'main'] || [];
      var row = rows[this.currentLine || 0];
      if (row) {
        this.scheduleAutoNext(row[2], row[3]);
      }
    } else {
      this.clearAutoTimer();
    }
  },

  toggleSkipMode: function () {
    if (this.activeChoice) return;
    this.autoPlay = false;
    this.skipMode = !this.skipMode;
    if (this.skipMode) {
      this.scheduleSkipNext();
    } else {
      this.clearAutoTimer();
    }
  },

  replayVoice: function () {
    var rows = this.currentScenarioData || SCENARIOS[this.currentScenario || 'main'] || [];
    var row = rows[this.currentLine];
    if (row && row[3]) {
      var G = getGal();
      if (G && typeof G.playVoice === 'function') {
        G.playVoice(voicePath(row[3]), 1.0);
        if (typeof G.stopBgm === 'function') G.stopBgm();
      }
    }
  },

  openBacklog: function () {
    this.modalType = 'history';
    this.historyList = getBacklog();
    this.historyFocusIndex = Math.max(0, this.historyList.length - 1);
  },

  openSaveModal: function () {
    this.modalType = 'save';
    this.savePage = 0;
    this.selectedSlot = 1;
    this.saveNotice = '';
    this.modalSaves = readAllSaves() || {};
  },

  openLoadModal: function () {
    this.modalType = 'load';
    this.savePage = 0;
    this.selectedSlot = 1;
    this.saveNotice = '';
    this.modalSaves = readAllSaves() || {};
  },

  openMenuModal: function () {
    this.modalType = 'menu';
  },

  closeModal: function () {
    this.modalType = '';
    this.confirmModal = null;
  },

  exitToTitle: function () {
    var G = getGal();
    if (G) {
      G.stopVoice();
      G.stopBgm();
    }
    this.autoPlay = false;
    this.skipMode = false;
    this.clearAutoTimer();
    this.modalType = '';
    this.confirmModal = null;
    this.view = 'title';
    if (typeof this.initTitle === 'function') this.initTitle();
  },

  changeSavePage: function (delta) {
    var next = (this.savePage || 0) + delta;
    if (next < 0) next = 0;
    if (next > 4) next = 4;
    this.savePage = next;
    this.selectedSlot = next * 6 + 1;
  },

  selectSlotItem: function (slotNum) {
    this.selectedSlot = slotNum;
    if (this.modalType === 'save') {
      this.executeSave(slotNum);
    } else if (this.modalType === 'load') {
      this.executeLoad(slotNum);
    }
  },

  executeSave: function (slotNum) {
    var rows = this.currentScenarioData || SCENARIOS[this.currentScenario || 'main'] || [];
    var row = rows[this.currentLine] || [];
    var record = {
      scenario: this.currentScenario || 'main',
      line: this.currentLine,
      chapter: formatChapter(row[7]),
      speaker: row[1] || '',
      text: row[2] || '',
      bg: row[4] || '',
      cg: row.length > 8 ? (row[8] || '') : '',
      sd: row.length > 9 ? (row[9] || '') : '',
      bgm: row[5] || '',
      character: row[6] || null,
      extra: {
        choices: Object.assign({}, this.choiceSelections || {}),
        flags: Object.assign({}, this.choiceFlags || {})
      }
    };
    saveSlotRecord(slotNum, record);
    this.selectedSlot = slotNum;
    this.modalSaves = readAllSaves() || {};
    this.saveNotice = '已保存到槽位 ' + slotNum;
  },

  executeLoad: function (slotNum) {
    var record = loadSlotRecord(slotNum);
    if (!record) {
      this.saveNotice = '槽位 ' + slotNum + ' 为空';
      return;
    }
    var extra = record.extra || {};
    this.choiceSelections = Object.assign({}, extra.choices || {});
    this.choiceFlags = Object.assign({}, extra.flags || {});
    this.modalType = '';
    this.initGame(record.scenario || 'main', record.line || 0);
  },

  toggleZoom: function () {
    this.zoomMode = !this.zoomMode;
    if (this.zoomMode) {
      this.gameZoomIndex = 0;
      this.gameImgPanX = 0;
      this.gameImgPanY = 0;
    }
  },

  cycleZoomScale: function () {
    this.gameZoomIndex = ((this.gameZoomIndex || 0) + 1) % GAME_ZOOM_LEVELS.length;
  },

  zoomInGameImg: function () {
    this.gameZoomIndex = Math.min((this.gameZoomIndex || 0) + 1, GAME_ZOOM_LEVELS.length - 1);
  },

  zoomOutGameImg: function () {
    this.gameZoomIndex = Math.max((this.gameZoomIndex || 0) - 1, 0);
  },

  resetGameZoom: function () {
    this.gameZoomIndex = 0;
    this.gameImgPanX = 0;
    this.gameImgPanY = 0;
  },

  onStageTouchStart: function (e) {
    if (e && e.changedTouches && e.changedTouches[0]) {
      var t = e.changedTouches[0];
      this._sStartX = t.pageX || t.clientX || 0;
      this._sStartY = t.pageY || t.clientY || 0;
      this._sStartPanX = this.gameImgPanX || 0;
      this._sStartPanY = this.gameImgPanY || 0;
      this._sMoved = false;
    }
  },

  onStageTouchMove: function (e) {
    if (e && e.changedTouches && e.changedTouches[0]) {
      var t = e.changedTouches[0];
      var dx = (t.pageX || t.clientX || 0) - this._sStartX;
      var dy = (t.pageY || t.clientY || 0) - this._sStartY;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) this._sMoved = true;
      this.gameImgPanX = this._sStartPanX + dx;
      this.gameImgPanY = this._sStartPanY + dy;
    }
  },

  onStageTouchEnd: function () {
    // 拖动结束
  }
};

export function renderGame(vm, h) {
  var rows = vm.currentScenarioData || SCENARIOS[vm.currentScenario || 'main'] || [];
  var row = rows[vm.currentLine] || [0, '', '', null, '', null, null, '--', '', ''];
  var totalLines = rows.length;

  var speaker = row[1] || '';
  var text = row[2] || '';
  var bg = row[4] || '';
  var charInfo = row[6];
  var chapter = formatChapter(row[7] || '--');
  var cg = row.length > 8 ? row[8] : '';
  var sd = row.length > 9 ? row[9] : '';

  var cgSrc = cg ? cgUrl(cg) : '';
  var sdSrc = cg ? '' : (sd ? sdUrl(sd) : '');
  var bgSrc = (!cg && !isBlackBg(bg)) ? bgUrl(bg) : '';
  var fgSrc = (!cg && !sd && charInfo) ? getSpriteUrl(charInfo) : '';

  var zoom = GAME_ZOOM_LEVELS[vm.gameZoomIndex || 0] || GAME_ZOOM_LEVELS[0];

  // 1. 左侧舞台区 (390x220)
  var stageChildren = [];
  if (bgSrc) {
    stageChildren.push(h('image', {
      staticStyle: S('game-stage-img', {
        position: 'absolute',
        left: (vm.gameImgPanX || 0) + 'px',
        top: (vm.gameImgPanY || 0) + 'px',
        width: zoom.w + 'px',
        height: zoom.h + 'px'
      }),
      attrs: { src: bgSrc, resize: 'cover' }
    }));
  }
  if (cgSrc) {
    stageChildren.push(h('image', {
      staticStyle: S('game-stage-img', {
        position: 'absolute',
        left: 0,
        top: 0,
        width: 390,
        height: 220
      }),
      attrs: { src: cgSrc, resize: 'contain' }
    }));
  } else if (sdSrc) {
    stageChildren.push(h('image', {
      staticStyle: S('game-stage-img', {
        position: 'absolute',
        left: 0,
        top: 0,
        width: 390,
        height: 220
      }),
      attrs: { src: sdSrc, resize: 'contain' }
    }));
  } else if (fgSrc) {
    stageChildren.push(h('image', {
      staticStyle: S('game-stage-char', {
        position: 'absolute',
        left: (vm.gameImgPanX || 0) + 'px',
        top: (vm.gameImgPanY || 0) + 'px',
        width: zoom.w + 'px',
        height: zoom.h + 'px'
      }),
      attrs: { src: fgSrc, resize: 'contain' }
    }));
  }

  var blackOpacity = Number(vm.fxBlack) || 0;
  if (blackOpacity < 0) blackOpacity = 0;
  if (blackOpacity > 1) blackOpacity = 1;
  if (blackOpacity > 0.01) {
    stageChildren.push(h('div', {
      staticStyle: S('game-stage-fx-black', {
        position: 'absolute',
        left: 0,
        top: 0,
        width: 390,
        height: 220,
        backgroundColor: '#000000',
        opacity: blackOpacity
      })
    }));
  }

  var whiteOpacity = Number(vm.fxWhite) || 0;
  if (whiteOpacity < 0) whiteOpacity = 0;
  if (whiteOpacity > 1) whiteOpacity = 1;
  if (whiteOpacity > 0.01) {
    stageChildren.push(h('div', {
      staticStyle: S('game-stage-fx-white', {
        position: 'absolute',
        left: 0,
        top: 0,
        width: 390,
        height: 220,
        backgroundColor: '#ffffff',
        opacity: whiteOpacity
      })
    }));
  }

  if (vm.fxOverlaySrc) {
    stageChildren.push(h('image', {
      attrs: { src: vm.fxOverlaySrc, resize: 'contain' },
      staticStyle: S('game-fx-overlay', {
        position: 'absolute',
        left: 0,
        top: 0,
        width: 390,
        height: 220
      })
    }));
  }

  var stagePane = h('div', {
    staticStyle: S('game-stage-pane'),
    on: {
      click: function () { vm.toggleZoom(); },
      touchstart: function (e) { vm.onStageTouchStart(e); },
      touchmove: function (e) { vm.onStageTouchMove(e); },
      touchend: function () { vm.onStageTouchEnd(); }
    }
  }, stageChildren);

  // 2. 中间对话区 (322x220)
  var dialoguePane = h('div', {
    staticStyle: S('game-dialog-pane'),
    on: { click: function () { vm.nextLine(); } }
  }, [
    speaker ? h('div', { staticStyle: S('game-speaker-badge') }, [
      h('text', { staticStyle: S('game-speaker-name') }, speaker)
    ]) : null,
    h('div', { staticStyle: S('game-dialog-body') }, [
      h('text', { staticStyle: S('game-dialog-text') }, text)
    ]),
    h('div', { staticStyle: S('game-dialog-footer') }, [
      h('text', { staticStyle: S('game-sub-chapter-text') }, chapter),
      h('text', { staticStyle: S('game-dialog-progress') }, (vm.currentLine + 1) + ' / ' + totalLines)
    ])
  ]);

  // 3. 右侧快捷操作栏 (88x220)：只保留四个核心操作，避免 8 个按钮挤爆
  var quickBar = h('div', { staticStyle: S('game-ctrl-pane') }, [
    h('div', {
      staticStyle: S('game-ctrl-btn'),
      on: { click: function () { vm.replayVoice(); } }
    }, [
      h('text', { staticStyle: S('game-ctrl-btn-title') }, '重听'),
      h('text', { staticStyle: S('game-ctrl-btn-sub') }, 'VOICE')
    ]),
    h('div', {
      staticStyle: vm.autoPlay ? S('game-ctrl-btn game-ctrl-btn-active') : S('game-ctrl-btn'),
      on: { click: function () { vm.toggleAutoPlay(); } }
    }, [
      h('text', { staticStyle: S('game-ctrl-btn-title') }, vm.autoPlay ? '停止' : '自动'),
      h('text', { staticStyle: vm.autoPlay ? S('game-ctrl-btn-sub-active') : S('game-ctrl-btn-sub') }, 'AUTO')
    ]),
    h('div', {
      staticStyle: vm.skipMode ? S('game-ctrl-btn game-ctrl-btn-active') : S('game-ctrl-btn'),
      on: { click: function () { vm.toggleSkipMode(); } }
    }, [
      h('text', { staticStyle: S('game-ctrl-btn-title') }, vm.skipMode ? '停止' : '快进'),
      h('text', { staticStyle: vm.skipMode ? S('game-ctrl-btn-sub-active') : S('game-ctrl-btn-sub') }, 'SKIP')
    ]),
    h('div', {
      staticStyle: S('game-ctrl-btn'),
      on: { click: function () { vm.openMenuModal(); } }
    }, [
      h('text', { staticStyle: S('game-ctrl-btn-title') }, '菜单'),
      h('text', { staticStyle: S('game-ctrl-btn-sub') }, 'MENU')
    ])
  ]);

  var mainView = h('div', {
    staticStyle: S('game-main-layout', {
      position: 'relative',
      left: (vm.fxShakeX || 0) + 'px',
      top: (vm.fxShakeY || 0) + 'px',
      width: 800,
      height: 220,
      display: 'flex',
      flexDirection: 'row'
    })
  }, [stagePane, dialoguePane, quickBar]);

  var rootChildren = [mainView];

  // 历史对话（Backlog）
  if (vm.modalType === 'history') {
    var history = vm.historyList || [];
    var start = Math.max(0, history.length - 3);
    var end = Math.max(0, history.length - 1);
    var historyItems = [];
    for (var hi = start; hi <= end; hi++) {
      (function (item, idx) {
        if (!item) return;
        historyItems.push(h('div', { key: 'history_' + idx, staticStyle: S('game-history-item' + (idx === end ? ' game-history-item-latest' : '')) }, [
          h('div', { staticStyle: S('game-history-main') }, [
            h('div', { staticStyle: S('game-history-item-head') }, [
              h('text', { staticStyle: S('game-history-speaker') }, item.speaker || '【独白】'),
              h('text', { staticStyle: S('game-history-line-num') }, '#' + (idx + 1))
            ]),
            h('text', { staticStyle: S('game-history-text') }, item.text || '')
          ])
        ]));
      })(history[hi], hi);
    }
    rootChildren.push(h('div', { staticStyle: S('game-modal-mask') }, [
      h('div', { staticStyle: S('game-history-card') }, [
        h('div', { staticStyle: S('game-history-header') }, [
          h('text', { staticStyle: S('game-history-title') }, '历史对话 BACKLOG'),
          h('div', { staticStyle: S('game-modal-close-btn'), on: { click: function () { vm.closeModal(); } } }, [
            h('text', { staticStyle: S('game-modal-close-text') }, '关闭')
          ])
        ]),
        h('div', { staticStyle: S('game-history-viewport') }, [
          h('div', { staticStyle: S('game-history-list') }, historyItems.length ? historyItems : [
            h('text', { staticStyle: S('game-history-tip') }, '还没有可回顾的台词')
          ])
        ]),
        h('div', { staticStyle: S('game-history-footer') }, [
          h('text', { staticStyle: S('game-history-tip') }, '轻触关闭返回剧情')
        ])
      ])
    ]));
  }

  // 存档 / 读档
  if (vm.modalType === 'save' || vm.modalType === 'load') {
    var isSave = vm.modalType === 'save';
    var page = vm.savePage || 0;
    var pageStr = '00' + (page + 1) + ' / 0005';
    var saves = vm.modalSaves || {};
    var selSlot = vm.selectedSlot || (page * 6 + 1);
    var selItem = saves['slot' + selSlot];
    var selBg = resolveSlotThumbnail(selItem);
    var selDate = selItem && selItem.time ? selItem.time : '——';
    var selChapter = formatChapter(selItem && selItem.chapter);
    var selComment = selItem ? (selItem.speaker ? '【' + selItem.speaker + '】' : '') + (selItem.text || '') : 'NO DATA';
    var slotCards = [];
    var startNum = page * 6 + 1;
    for (var si = 0; si < 6; si++) {
      (function (slotNum) {
        var item = saves['slot' + slotNum];
        var code = 's000' + (page + 1) + '-' + (slotNum < 10 ? '0' + slotNum : '' + slotNum);
        var thumb = resolveSlotThumbnail(item);
        var desc = item ? (item.speaker ? '【' + item.speaker + '】' : '') + (item.text || '') : 'NO DATA';
        var cardClass = 'saveload-slot-card' + (selSlot === slotNum ? ' saveload-slot-card-active' : '') + (item ? ' saveload-slot-card-hasdata' : '');
        slotCards.push(h('div', { key: 'slot' + slotNum, staticStyle: S(cardClass), on: { click: function () { vm.selectSlotItem(slotNum); } } }, [
          h('div', { staticStyle: S('saveload-slot-header') }, [
            h('text', { staticStyle: S('saveload-slot-code') }, code),
            h('text', { staticStyle: S('saveload-slot-time') }, item && item.time ? item.time : '')
          ]),
          h('div', { staticStyle: S('saveload-slot-body') }, [
            thumb ? h('image', { staticStyle: S('saveload-slot-body-img'), attrs: { src: thumb, resize: 'contain' } }) : h('text', { staticStyle: S('saveload-slot-noimage') }, 'NO IMAGE')
          ]),
          h('div', { staticStyle: S('saveload-slot-footer') }, [
            h('text', { staticStyle: S('saveload-slot-desc') }, desc.substring(0, 16))
          ])
        ]));
      })(startNum + si);
    }
    rootChildren.push(h('div', { staticStyle: S('saveload-root') }, [
      h('div', { staticStyle: S('saveload-header') }, [
        h('div', { staticStyle: S('saveload-title-box') }, [
          h('text', { staticStyle: S('saveload-title-text') }, isSave ? 'DATA SAVE' : 'DATA LOAD')
        ]),
        h('div', { staticStyle: S('saveload-header-right') }, [
          h('div', { staticStyle: S('saveload-mode-tabs') }, [
            h('div', { staticStyle: S('saveload-mode-tab saveload-mode-tab-active') }, [
              h('div', { staticStyle: S('saveload-mode-dot') }),
              h('text', { staticStyle: S('saveload-mode-text-active') }, isSave ? '保存物语' : '读取物语')
            ])
          ]),
          h('div', { staticStyle: S('saveload-pager') }, [
            h('div', { staticStyle: S('saveload-pager-btn'), on: { click: function () { vm.changeSavePage(-1); } } }, [h('text', { staticStyle: S('saveload-pager-btn-text') }, '‹')]),
            h('text', { staticStyle: S('saveload-pager-text') }, pageStr),
            h('div', { staticStyle: S('saveload-pager-btn'), on: { click: function () { vm.changeSavePage(1); } } }, [h('text', { staticStyle: S('saveload-pager-btn-text') }, '›')])
          ]),
          h('div', { staticStyle: S('saveload-header-close-btn'), on: { click: function () { vm.closeModal(); } } }, [
            h('text', { staticStyle: S('saveload-header-close-text') }, '返回游戏')
          ])
        ])
      ]),
      h('div', { staticStyle: S('saveload-body') }, [
        h('div', { staticStyle: S('saveload-left-pane') }, [
          h('div', { staticStyle: S('saveload-preview-box') }, [
            selBg ? h('image', { staticStyle: S('saveload-preview-img'), attrs: { src: selBg, resize: 'contain' } }) : h('text', { staticStyle: S('saveload-preview-noimage') }, 'NO IMAGE')
          ]),
          h('div', { staticStyle: S('saveload-info-card') }, [
            h('div', { staticStyle: S('saveload-info-row') }, [h('text', { staticStyle: S('saveload-info-label') }, 'DATE:'), h('text', { staticStyle: S('saveload-info-val') }, selDate)]),
            h('div', { staticStyle: S('saveload-info-row') }, [h('text', { staticStyle: S('saveload-info-label') }, 'CHAPTER:'), h('text', { staticStyle: S('saveload-info-val') }, selChapter)]),
            h('div', { staticStyle: S('saveload-info-row') }, [h('text', { staticStyle: S('saveload-info-label') }, 'COMMENT:'), h('text', { staticStyle: S('saveload-info-val') }, selComment.substring(0, 18))])
          ])
        ]),
        h('div', { staticStyle: S('saveload-right-grid') }, slotCards)
      ]),
      h('div', { staticStyle: S('saveload-bottom-bar') }, [
        h('text', { staticStyle: S('saveload-bottom-tip') }, vm.saveNotice || (isSave ? '轻触槽位保存当前进度' : '轻触有记录的槽位载入游戏'))
      ])
    ]));
  }

  // 全屏舞台特写：点击舞台后必须有可见的缩放界面
  if (vm.zoomMode) {
    var z = GAME_ZOOM_LEVELS[vm.gameZoomIndex || 0] || GAME_ZOOM_LEVELS[0];
    var zLeft = Math.round((664 - z.w) / 2 + (vm.gameImgPanX || 0));
    var zTop = Math.round((220 - z.h) / 2 + (vm.gameImgPanY || 0));
    var zoomImages = [];
    if (bgSrc || cgSrc || sdSrc) {
      zoomImages.push(h('image', {
        staticStyle: S('game-zoom-img', { left: zLeft + 'px', top: zTop + 'px', width: z.w + 'px', height: z.h + 'px' }),
        attrs: { src: bgSrc || cgSrc || sdSrc, resize: 'contain' }
      }));
    }
    if (fgSrc) {
      zoomImages.push(h('image', {
        staticStyle: S('game-zoom-char', { left: zLeft + 'px', top: zTop + 'px', width: z.w + 'px', height: z.h + 'px' }),
        attrs: { src: fgSrc, resize: 'contain' }
      }));
    }
    rootChildren.push(h('div', { staticStyle: S('game-zoom-overlay') }, [
      h('div', { staticStyle: S('game-zoom-left-wing') }, [
        h('div', { staticStyle: S('game-zoom-wing-btn-exit'), on: { click: function () { vm.toggleZoom(); } } }, [
          h('text', { staticStyle: S('game-zoom-wing-btn-text') }, '退出特写')
        ])
      ]),
      h('div', { staticStyle: S('game-zoom-viewport'), on: { click: function () { vm.cycleZoomScale(); } } }, zoomImages.concat([
        h('div', { staticStyle: S('game-zoom-header') }, [
          h('text', { staticStyle: S('game-zoom-header-text') }, '舞台特写 · ' + chapter)
        ])
      ])),
      h('div', { staticStyle: S('game-zoom-right-wing') }, [
        h('div', { staticStyle: S('game-zoom-wing-btn'), on: { click: function () { vm.zoomInGameImg(); } } }, [
          h('text', { staticStyle: S('game-zoom-wing-btn-text') }, '+ 放大')
        ]),
        h('div', { staticStyle: S('game-zoom-wing-badge') }, [
          h('text', { staticStyle: S('game-zoom-wing-badge-text') }, z.label)
        ]),
        h('div', { staticStyle: S('game-zoom-wing-btn'), on: { click: function () { vm.zoomOutGameImg(); } } }, [
          h('text', { staticStyle: S('game-zoom-wing-btn-text') }, '- 缩小')
        ]),
        h('div', { staticStyle: S('game-zoom-wing-btn'), on: { click: function () { vm.resetGameZoom(); } } }, [
          h('text', { staticStyle: S('game-zoom-wing-btn-text') }, '重置')
        ])
      ])
    ]));
  }

  // 分支选择弹层
  if (vm.activeChoice && vm.activeChoice.options) {
    var optionButtons = vm.activeChoice.options.map(function (opt) {
      return h('div', {
        key: opt.index,
        staticStyle: S('game-choice-option'),
        on: { click: function () { vm.handleChoiceSelect(vm.activeChoice, opt); } }
      }, [
        h('text', { staticStyle: S('game-choice-option-text') }, opt.text)
      ]);
    });
    rootChildren.push(h('div', { staticStyle: S('game-modal-mask') }, [
      h('div', { staticStyle: S('game-choice-panel') }, [
        h('text', { staticStyle: S('game-choice-prompt') }, vm.choiceNotice || '请选择分支'),
        h('div', { staticStyle: S('game-choice-options') }, optionButtons)
      ])
    ]));
  }

  // 结局展示弹层
  if (vm.normalEnd) {
    rootChildren.push(h('div', { staticStyle: S('game-modal-mask') }, [
      h('div', { staticStyle: S('game-normal-end') }, [
        h('text', { staticStyle: S('game-normal-end-title') }, 'NORMAL END'),
        h('text', { staticStyle: S('game-normal-end-sub') }, '本线已通关，相关结局与素材已解锁'),
        h('div', {
          staticStyle: S('game-normal-end-btn'),
          on: { click: function () { vm.exitToTitle(); } }
        }, [
          h('text', { staticStyle: S('game-normal-end-btn-text') }, '返回标题')
        ])
      ])
    ]));
  }

  // 菜单弹层：复用引擎已有的 modal / menu-action 样式
  if (vm.modalType === 'menu') {
    function menuBtn(title, sub, action) {
      return h('div', {
        staticStyle: S('game-menu-action-btn'),
        on: { click: action }
      }, [
        h('text', { staticStyle: S('game-menu-action-title') }, title),
        h('text', { staticStyle: S('game-menu-action-sub') }, sub)
      ]);
    }
    rootChildren.push(h('div', { staticStyle: S('game-modal-mask') }, [
      h('div', { staticStyle: S('game-modal-card') }, [
        h('div', { staticStyle: S('game-modal-header') }, [
          h('text', { staticStyle: S('game-modal-title') }, '快捷菜单'),
          h('div', {
            staticStyle: S('game-modal-close-btn'),
            on: { click: function () { vm.closeModal(); } }
          }, [h('text', { staticStyle: S('game-modal-close-text') }, '关闭')])
        ]),
        h('div', { staticStyle: S('game-menu-grid') }, [
          h('div', { staticStyle: S('game-menu-row') }, [
            menuBtn('保存进度', 'SAVE', function () { vm.openSaveModal(); }),
            menuBtn('读取进度', 'LOAD', function () { vm.openLoadModal(); }),
            menuBtn('历史对话', 'BACKLOG', function () { vm.openBacklog(); })
          ]),
          h('div', { staticStyle: S('game-menu-row') }, [
            menuBtn('返回标题', 'TITLE', function () { vm.exitToTitle(); }),
            menuBtn('继续游玩', 'RESUME', function () { vm.closeModal(); })
          ]),
          h('text', { staticStyle: S('game-menu-notice') }, vm.menuNotice || '轻触操作继续剧情')
        ])
      ])
    ]));
  }

  return h('div', { staticStyle: S('game-root') }, rootChildren);
}
