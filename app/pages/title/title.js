// pages/title/title.js —— 主菜单与鉴赏/日后谈入口
import { S, getGal, log } from '../../common.js';
import { readAllSaves, readSettings, writeSettings, clearAllData } from '../../storage.js';
import { STORY } from '../../data/story_data.js';
import { bgmPath, bgUrl, isBlackBg, titleBgUrl } from '../../media.js';

function titleBgmName() {
  return (STORY.meta && STORY.meta.titleBgm) || '';
}

// 标题页读档/新游戏的安全场景解析：仅允许 main 与 after_* 剧本
function safeScenario(value) {
  if (typeof value === 'string' && (value === 'main' || /^after_[A-Za-z0-9_]+$/.test(value))) {
    return value;
  }
  return 'main';
}

function safeLine(value) {
  if (typeof value !== 'number' || !isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function applySavedChoiceState(vm, data) {
  var extra = data && data.extra ? data.extra : {};
  vm.choiceSelections = extra.choices || {};
  vm.choiceFlags = extra.flags || {};
  vm.activeChoice = null;
  vm.choiceNotice = '';
}

export var titleMethods = {
  initTitle: function () {
    this.titleModalType = '';
    var settings = readSettings() || {};
    this.bgmOn = settings.bgmEnabled !== false;
    this.bgmVolume = typeof settings.bgmVolume === 'number' ? settings.bgmVolume : 0.8;
    if (this.bgmVolume < 0) this.bgmVolume = 0;
    if (this.bgmVolume > 1) this.bgmVolume = 1;
    var G = getGal();
    if (G) {
      G.setBgmVolume(this.bgmVolume);
      if (this.bgmOn && titleBgmName()) {
        G.playBgm(bgmPath(titleBgmName()), true, this.bgmVolume);
      } else {
        G.stopBgm();
      }
    }
    this.titleConfirmModal = null;
    this._confirmExecuting = false;
  },
  startNewGame: function () {
    log('start new game');
    // 新游戏必须显式回到 main 剧本，清除日后谈等残留场景状态
    this.currentScenario = 'main';
    this.currentLine = 0;
    this.choiceSelections = {};
    this.choiceFlags = {};
    this.activeChoice = null;
    this.choiceNotice = '';
    this.view = 'game';
    if (typeof this.initGame === 'function') {
      this.initGame('main', 0);
    }
  },
  continueGame: function () {
    log('continue game');
    var saves = readAllSaves();
    var latestSlot = saves.latest || '1';
    var data = saves['slot' + latestSlot];
    var scenario = data ? safeScenario(data.scenario) : 'main';
    var line = data ? safeLine(data.line) : 0;
    this.currentScenario = scenario;
    this.currentLine = line;
    applySavedChoiceState(this, data);
    this.view = 'game';
    if (typeof this.initGame === 'function') {
      this.initGame(scenario, line);
    }
  },
  openTitleLoadModal: function () {
    this.titleModalType = 'load';
    this.titleConfirmModal = null;
    this.titleSaves = readAllSaves();
    this.titleSavePage = this.titleSavePage || 0;
    this.titleSelectedSlot = this.titleSelectedSlot || 1;
  },
  changeTitleSavePage: function (delta) {
    var p = (this.titleSavePage || 0) + delta;
    if (p < 0) p = 4;
    if (p > 4) p = 0;
    this.titleSavePage = p;
    this.titleSelectedSlot = p * 6 + 1;
    this.titleConfirmModal = null;
  },
  selectTitleSlotItem: function (slotNum) {
    if (this._confirmExecuting) return;
    this.titleSelectedSlot = slotNum;
    var saves = this.titleSaves || readAllSaves();
    var data = saves['slot' + slotNum];
    if (data && typeof data.line === 'number') {
      var pageStr = (this.titleSavePage || 0) + 1;
      var codeStr = 's000' + pageStr + '-' + (slotNum < 10 ? '0' + slotNum : '' + slotNum);
      this.titleConfirmModal = {
        slotNum: slotNum,
        title: '读取进度确认',
        subtitle: '载入目标：' + codeStr + '（' + (data.time || '——') + ' · ' + (data.chapter || '1-1') + '）',
        message: '是否确定载入该槽位的物语推进记录？',
        warn: '※ 提示：载入将直接跳转至目标物语进度，未保存进度将丢失'
      };
    }
  },
  confirmExecuteTitleLoad: function () {
    if (!this.titleConfirmModal || this._confirmExecuting) return;
    this._confirmExecuting = true;
    var slotNum = this.titleConfirmModal.slotNum;
    this.titleConfirmModal = null;
    var self = this;
    setTimeout(function () {
      self._confirmExecuting = false;
      self.loadSlotFromTitle(slotNum);
    }, 60);
  },
  cancelTitleConfirm: function () {
    this.titleConfirmModal = null;
    this._confirmExecuting = false;
  },
  promptClearAllData: function () {
    this.titleConfirmModal = {
      isClearData: true,
      title: '清除全部数据',
      subtitle: 'CLEAR ALL DATA',
      message: '确定要清除所有存档与游玩数据吗？\n所有存档、历史回顾与已解锁内容将被全部删除！',
      warn: '⚠️ 此操作不可撤销，请谨慎操作'
    };
  },
  confirmClearAllData: function () {
    clearAllData();
    this.titleConfirmModal = null;
    this.titleSaves = {};
    this.choiceSelections = {};
    this.choiceFlags = {};
    this.currentLine = 0;
    this.currentScenario = 'main';
    this.initTitle();
    this.closeTitleModal();
  },
  openFlowchartModal: function () {
    this.titleModalType = '';
    this.titleConfirmModal = null;
    this.view = 'flowchart';
    if (typeof this.initFlowchart === 'function') {
      this.initFlowchart();
    }
  },
  jumpFromFlowchart: function (line) {
    this.currentLine = line || 0;
    this.titleModalType = '';
    this.titleConfirmModal = null;
    this.view = 'game';
    if (typeof this.initGame === 'function') {
      this.initGame();
    }
  },
  openAfterModal: function () {
    this.titleModalType = '';
    this.titleConfirmModal = null;
    this.view = 'afterstory';
    if (typeof this.initAfterStory === 'function') {
      this.initAfterStory();
    }
  },
  closeTitleModal: function () {
    this.titleModalType = '';
    this.titleConfirmModal = null;
  },
  loadSlotFromTitle: function (slotNum) {
    var saves = this.titleSaves || readAllSaves();
    var data = saves['slot' + slotNum];
    if (data && typeof data.line === 'number') {
      var scenario = safeScenario(data.scenario);
      var line = safeLine(data.line);
      this.currentScenario = scenario;
      this.currentLine = line;
      applySavedChoiceState(this, data);
      this.titleModalType = '';
      this.titleConfirmModal = null;
      this.view = 'game';
      if (typeof this.initGame === 'function') {
        this.initGame(scenario, line);
      }
    }
  },
  openGallery: function () {
    log('open gallery');
    this.titleModalType = '';
    this.titleConfirmModal = null;
    this.galleryCgFullscreen = false;
    this.view = 'gallery';
    if (typeof this.initGallery === 'function') {
      this.initGallery();
    }
  },
  openTitleSettings: function () {
    var settings = readSettings() || {};
    this.bgmOn = settings.bgmEnabled !== false;
    this.bgmVolume = typeof settings.bgmVolume === 'number' ? settings.bgmVolume : 0.8;
    this.titleModalType = 'settings';
    this.titleConfirmModal = null;
  },
  toggleTitleBgm: function () {
    var G = getGal();
    this.bgmOn = !this.bgmOn;
    if (G) {
      if (this.bgmOn && titleBgmName()) {
        G.setBgmVolume(this.bgmVolume);
        G.playBgm(bgmPath(titleBgmName()), true, this.bgmVolume);
      } else {
        G.stopBgm();
      }
    }
    writeSettings({ bgmEnabled: this.bgmOn, bgmVolume: this.bgmVolume });
  },
  adjustTitleBgmVolume: function (delta) {
    var volume = Math.round((this.bgmVolume + delta) * 10) / 10;
    if (volume < 0) volume = 0;
    if (volume > 1) volume = 1;
    this.bgmVolume = volume;
    var G = getGal();
    if (G) G.setBgmVolume(volume);
    writeSettings({ bgmEnabled: this.bgmOn, bgmVolume: volume });
  },
  openTitleExitModal: function () {
    this.titleModalType = 'exit';
    this.titleConfirmModal = null;
  },
  cancelTitleExit: function () {
    this.titleModalType = '';
  },
  confirmTitleExit: function () {
    if (this.$page && typeof this.$page.finish === 'function') {
      this.$page.finish();
    }
  },
  onMenuTouchStart: function (e) {
    if (e && e.changedTouches && e.changedTouches[0]) {
      this._menuStartY = e.changedTouches[0].pageY || e.changedTouches[0].clientY || 0;
      this._menuStartScroll = this.titleScrollY || 0;
      this._menuMoved = false;
    }
  },
  onMenuTouchMove: function (e) {
    if (e && e.changedTouches && e.changedTouches[0]) {
      var y = e.changedTouches[0].pageY || e.changedTouches[0].clientY || 0;
      var dy = y - this._menuStartY;
      if (Math.abs(dy) > 5) {
        this._menuMoved = true;
      }
      var newY = this._menuStartScroll + dy;
      if (newY > 0) newY = 0;
      if (newY < -124) newY = -124;
      this.titleScrollY = newY;
    }
  },
  onMenuTouchEnd: function () {
    var self = this;
    setTimeout(function () {
      self._menuMoved = false;
    }, 120);
  },
  scrollMenuUp: function () {
    var y = (this.titleScrollY || 0) + 66;
    if (y > 0) y = 0;
    this.titleScrollY = y;
  },
  scrollMenuDown: function () {
    var y = (this.titleScrollY || 0) - 66;
    if (y < -124) y = -124;
    this.titleScrollY = y;
  }
};

export function renderTitle(vm, h) {
  // 左列 4 个核心游玩按钮
  var col1Buttons = [
    // (1) 新游戏
    h('div', {
      staticStyle: S('title-menu-btn title-btn-primary'),
      on: { click: function () { log('click new game'); vm.startNewGame(); } }
    }, [
      h('text', { staticStyle: S('title-btn-label') }, '新游戏'),
      h('text', { staticStyle: S('title-btn-sub-highlight') }, 'START')
    ]),
    // (2) 继续游戏
    h('div', {
      staticStyle: S('title-menu-btn'),
      on: { click: function () { log('click continue'); vm.continueGame(); } }
    }, [
      h('text', { staticStyle: S('title-btn-label') }, '继续游戏'),
      h('text', { staticStyle: S('title-btn-sub') }, 'CONTINUE')
    ]),
    // (3) 读取存档
    h('div', {
      staticStyle: S('title-menu-btn'),
      on: { click: function () { log('click load'); vm.openTitleLoadModal(); } }
    }, [
      h('text', { staticStyle: S('title-btn-label') }, '读取存档'),
      h('text', { staticStyle: S('title-btn-sub') }, 'LOAD')
    ]),
    // (4) 流程图
    h('div', {
      staticStyle: S('title-menu-btn'),
      on: { click: function () { log('click flowchart'); vm.openFlowchartModal(); } }
    }, [
      h('text', { staticStyle: S('title-btn-label') }, '流程图'),
      h('text', { staticStyle: S('title-btn-sub') }, 'CHART')
    ])
  ];

  // 右列 4 个鉴赏扩展按钮
  var col2Buttons = [
    // (5) 鉴赏 EXTRA
    h('div', {
      staticStyle: S('title-menu-btn'),
      on: { click: function () { log('click gallery'); vm.openGallery(); } }
    }, [
      h('text', { staticStyle: S('title-btn-label') }, '鉴赏'),
      h('text', { staticStyle: S('title-btn-sub') }, 'EXTRA')
    ]),
    // (6) 日后谈 AFTER
    h('div', {
      staticStyle: S('title-menu-btn'),
      on: { click: function () { log('click afterstory'); vm.openAfterModal(); } }
    }, [
      h('text', { staticStyle: S('title-btn-label') }, '日后谈'),
      h('text', { staticStyle: S('title-btn-sub') }, 'AFTER')
    ]),
    // (7) 系统设置 SYSTEM
    h('div', {
      staticStyle: S('title-menu-btn'),
      on: { click: function () { log('click system'); vm.openTitleSettings(); } }
    }, [
      h('text', { staticStyle: S('title-btn-label') }, '系统设置'),
      h('text', { staticStyle: S('title-btn-sub') }, 'SYSTEM')
    ]),
    // (8) 退出游戏 EXIT
    h('div', {
      staticStyle: S('title-menu-btn'),
      on: { click: function () { log('click exit'); vm.openTitleExitModal(); } }
    }, [
      h('text', { staticStyle: S('title-btn-label') }, '退出游戏'),
      h('text', { staticStyle: S('title-btn-sub') }, 'EXIT')
    ])
  ];

  var children = [
    // 1. 800x220 标题背景（由用户资源提供）
    h('image', {
      staticStyle: S('title-bg-img'),
      attrs: { src: titleBgUrl() }
    }),

    // 2. 双列 8 个主菜单按钮
    h('div', { staticStyle: S('title-menu-container') }, [
      h('div', { staticStyle: S('title-menu-col') }, col1Buttons),
      h('div', { staticStyle: S('title-menu-col') }, col2Buttons)
    ])
  ];

  // 弹窗浮层
  if (vm.titleModalType) {
    if (vm.titleModalType === 'settings') {
      children.push(
        h('div', { staticStyle: S('title-system-mask') }, [
          h('div', { staticStyle: S('title-system-box') }, [
            h('div', { staticStyle: S('title-system-header') }, [
              h('text', { staticStyle: S('title-system-title') }, '❖ 系统设置 SYSTEM ❖'),
              h('text', { staticStyle: S('title-system-subtitle') }, '音频设置将立即生效并保存')
            ]),
            h('div', { staticStyle: S('title-system-content') }, [
              h('div', { staticStyle: S('title-system-row') }, [
                h('text', { staticStyle: S('title-system-label') }, 'BGM 背景音乐'),
                h('div', {
                  staticStyle: S('title-system-btn title-system-switch'),
                  on: { click: function () { vm.toggleTitleBgm(); } }
                }, [
                  h('text', { staticStyle: S('title-system-btn-text') }, vm.bgmOn ? '开启 ON' : '关闭 OFF')
                ])
              ]),
              h('div', { staticStyle: S('title-system-row') }, [
                h('text', { staticStyle: S('title-system-label') }, 'BGM 音量'),
                h('div', { staticStyle: S('title-system-volume') }, [
                  h('div', {
                    staticStyle: S('title-system-btn title-system-volume-btn'),
                    on: { click: function () { vm.adjustTitleBgmVolume(-0.1); } }
                  }, [
                    h('text', { staticStyle: S('title-system-volume-text') }, '－')
                  ]),
                  h('text', { staticStyle: S('title-system-percent') }, Math.round(vm.bgmVolume * 100) + '%'),
                  h('div', {
                    staticStyle: S('title-system-btn title-system-volume-btn'),
                    on: { click: function () { vm.adjustTitleBgmVolume(0.1); } }
                  }, [
                    h('text', { staticStyle: S('title-system-volume-text') }, '＋')
                  ])
                ])
              ]),
              h('div', { staticStyle: S('title-system-row') }, [
                h('text', { staticStyle: S('title-system-label') }, '游玩数据'),
                h('div', {
                  staticStyle: S('title-system-btn title-system-clear-btn'),
                  on: { click: function () { vm.promptClearAllData(); } }
                }, [
                  h('text', { staticStyle: S('title-system-btn-text') }, '清除所有数据')
                ])
              ])
            ]),
            h('div', { staticStyle: S('title-system-footer') }, [
              h('div', {
                staticStyle: S('title-system-btn title-system-close'),
                on: { click: function () { vm.closeTitleModal(); } }
              }, [
                h('text', { staticStyle: S('title-system-btn-text') }, '返回标题')
              ])
            ])
          ])
        ])
      );
    } else if (vm.titleModalType === 'exit') {
      children.push(
        h('div', { staticStyle: S('title-system-mask') }, [
          h('div', { staticStyle: S('title-system-box title-exit-box') }, [
            h('div', { staticStyle: S('title-system-header') }, [
              h('text', { staticStyle: S('title-system-title') }, '❖ 退出游戏 EXIT ❖')
            ]),
            h('div', { staticStyle: S('title-exit-content') }, [
              h('text', { staticStyle: S('title-exit-message') }, '是否确定结束游戏并退出当前页面？'),
              h('text', { staticStyle: S('title-exit-warn') }, '未保存的物语进度将会丢失')
            ]),
            h('div', { staticStyle: S('title-system-footer title-exit-actions') }, [
              h('div', {
                staticStyle: S('title-system-btn title-system-confirm'),
                on: { click: function () { vm.confirmTitleExit(); } }
              }, [
                h('text', { staticStyle: S('title-system-btn-text') }, '确定退出')
              ]),
              h('div', {
                staticStyle: S('title-system-btn title-system-close'),
                on: { click: function () { vm.cancelTitleExit(); } }
              }, [
                h('text', { staticStyle: S('title-system-btn-text') }, '取消')
              ])
            ])
          ])
        ])
      );
    } else if (vm.titleModalType === 'load') {
      var page = vm.titleSavePage || 0;
      var totalPages = 5;
      var pageStr = '000' + (page + 1) + ' / 000' + totalPages;
      var tSaves = vm.titleSaves || {};
      var selSlot = vm.titleSelectedSlot || (page * 6 + 1);

      // 左侧选定槽位预览数据
      var selItem = tSaves['slot' + selSlot];
      var selBg = selItem && !isBlackBg(selItem.bg) ? bgUrl(selItem.bg) : '';
      var selDate = selItem && selItem.time ? selItem.time : '——';
      var selChapter = selItem && selItem.chapter ? selItem.chapter : '——';
      var selComment = selItem ? (selItem.speaker ? '【' + selItem.speaker + '】' : '') + selItem.text : 'NO DATA';

      // 右侧 6 个槽位卡片
      var slotCards = [];
      var startNum = page * 6 + 1;
      for (var i = 0; i < 6; i++) {
        (function (slotNum) {
          var it = tSaves['slot' + slotNum];
          var codeStr = 's000' + (page + 1) + '-' + (slotNum < 10 ? '0' + slotNum : '' + slotNum);
          var timeStr = it && it.time ? it.time : '';
          var bgPath = it && !isBlackBg(it.bg) ? bgUrl(it.bg) : '';
          var descStr = it ? (it.speaker ? '【' + it.speaker + '】' : '') + it.text : 'NO DATA';
          var isCurrentSelected = selSlot === slotNum;
          var cardClass = 'saveload-slot-card';
          if (isCurrentSelected) cardClass += ' saveload-slot-card-active';
          if (it) cardClass += ' saveload-slot-card-hasdata';

          slotCards.push(
            h('div', {
              staticStyle: S(cardClass),
              on: { click: function () { vm.selectTitleSlotItem(slotNum); } }
            }, [
              h('div', { staticStyle: S('saveload-slot-header') }, [
                h('text', { staticStyle: S('saveload-slot-code') }, codeStr),
                h('text', { staticStyle: S('saveload-slot-time') }, timeStr)
              ]),
              h('div', { staticStyle: S('saveload-slot-body') }, [
                bgPath ? h('image', {
                  staticStyle: S('saveload-slot-body-img'),
                  attrs: { src: bgPath }
                }) : h('text', { staticStyle: S('saveload-slot-noimage') }, 'NO IMAGE')
              ]),
              h('div', { staticStyle: S('saveload-slot-footer') }, [
                h('text', { staticStyle: S('saveload-slot-desc') }, descStr.substring(0, 16))
              ])
            ])
          );
        })(startNum + i);
      }

      children.push(
        h('div', { staticStyle: S('saveload-root') }, [
          // 1. 顶部 Header
          h('div', { staticStyle: S('saveload-header') }, [
            h('div', { staticStyle: S('saveload-title-box') }, [
              h('text', { staticStyle: S('saveload-title-cloud') }, '☁'),
              h('text', { staticStyle: S('saveload-title-text') }, 'DATA LOAD')
            ]),
            h('div', { staticStyle: S('saveload-header-right') }, [
              // 模式指示
              h('div', { staticStyle: S('saveload-mode-tabs') }, [
                h('div', { staticStyle: S('saveload-mode-tab saveload-mode-tab-active') }, [
                  h('div', { staticStyle: S('saveload-mode-dot') }),
                  h('text', { staticStyle: S('saveload-mode-text-active') }, '读取物语')
                ])
              ]),
              // 翻页控制器
              h('div', { staticStyle: S('saveload-pager') }, [
                h('div', {
                  staticStyle: S('saveload-pager-btn'),
                  on: { click: function () { vm.changeTitleSavePage(-1); } }
                }, [
                  h('text', { staticStyle: S('saveload-pager-btn-text') }, '‹')
                ]),
                h('text', { staticStyle: S('saveload-pager-text') }, pageStr),
                h('div', {
                  staticStyle: S('saveload-pager-btn'),
                  on: { click: function () { vm.changeTitleSavePage(1); } }
                }, [
                  h('text', { staticStyle: S('saveload-pager-btn-text') }, '›')
                ])
              ]),
              // 关闭按钮
              h('div', {
                staticStyle: S('saveload-header-close-btn'),
                on: { click: function () { vm.closeTitleModal(); } }
              }, [
                h('text', { staticStyle: S('saveload-header-close-text') }, '返回标题')
              ])
            ])
          ]),

          // 2. 主体区（左侧大预览 + 右侧槽位网格）
          h('div', { staticStyle: S('saveload-body') }, [
            // 左侧信息预览
            h('div', { staticStyle: S('saveload-left-pane') }, [
              h('div', { staticStyle: S('saveload-preview-box') }, [
                selBg ? h('image', {
                  staticStyle: S('saveload-preview-img'),
                  attrs: { src: selBg }
                }) : h('text', { staticStyle: S('saveload-preview-noimage') }, 'NO IMAGE')
              ]),
              h('div', { staticStyle: S('saveload-info-card') }, [
                h('div', { staticStyle: S('saveload-info-row') }, [
                  h('text', { staticStyle: S('saveload-info-label') }, 'DATE :'),
                  h('text', { staticStyle: S('saveload-info-val') }, selDate)
                ]),
                h('div', { staticStyle: S('saveload-info-row') }, [
                  h('text', { staticStyle: S('saveload-info-label') }, 'CHAPTER :'),
                  h('text', { staticStyle: S('saveload-info-val') }, selChapter)
                ]),
                h('div', { staticStyle: S('saveload-info-row') }, [
                  h('text', { staticStyle: S('saveload-info-label') }, 'COMMENT :'),
                  h('text', { staticStyle: S('saveload-info-val') }, selComment.substring(0, 18))
                ])
              ])
            ]),

            // 右侧 6 个槽位卡片网格
            h('div', { staticStyle: S('saveload-right-grid') }, slotCards)
          ]),

          // 3. 底部状态与操作条
          h('div', { staticStyle: S('saveload-bottom-bar') }, [
            h('text', { staticStyle: S('saveload-bottom-tip') }, '载入界面。轻触有数据的槽位弹出载入确认。'),
            h('div', { staticStyle: S('saveload-bottom-actions') }, [
              h('div', {
                staticStyle: S('saveload-bottom-btn'),
                on: { click: function () { vm.closeTitleModal(); } }
              }, [
                h('text', { staticStyle: S('saveload-bottom-btn-text') }, '返回标题')
              ])
            ])
          ])
        ])
      );
    }
  }

  // 读档二次确认弹窗
  if (vm.titleConfirmModal) {
    children.push(
      h('div', { staticStyle: S('confirm-mask') }, [
        h('div', { staticStyle: S('confirm-box') }, [
          // 顶部标题
          h('div', { staticStyle: S('confirm-header') }, [
            h('text', { staticStyle: S('confirm-title-icon') }, '❖'),
            h('text', { staticStyle: S('confirm-title-text') }, vm.titleConfirmModal.title),
            h('text', { staticStyle: S('confirm-title-icon') }, '❖')
          ]),
          // 中间提示与风险信息
          h('div', { staticStyle: S('confirm-content') }, [
            h('text', { staticStyle: S('confirm-slot-code') }, vm.titleConfirmModal.subtitle),
            h('text', { staticStyle: S('confirm-msg-text') }, vm.titleConfirmModal.message),
            vm.titleConfirmModal.warn ? h('text', { staticStyle: S('confirm-sub-warn') }, vm.titleConfirmModal.warn) : null
          ]),
          // 底部双按钮操作区
          h('div', { staticStyle: S('confirm-actions') }, vm.titleConfirmModal.isClearData ? [
            h('div', {
              staticStyle: S('confirm-btn confirm-btn-ok confirm-btn-danger'),
              on: { click: function () { vm.confirmClearAllData(); } }
            }, [
              h('text', { staticStyle: S('confirm-btn-ok-text') }, '确定清除')
            ]),
            h('div', {
              staticStyle: S('confirm-btn confirm-btn-cancel'),
              on: { click: function () { vm.cancelTitleConfirm(); } }
            }, [
              h('text', { staticStyle: S('confirm-btn-cancel-text') }, '取消')
            ])
          ] : [
            h('div', {
              staticStyle: S('confirm-btn confirm-btn-ok'),
              on: { click: function () { vm.confirmExecuteTitleLoad(); } }
            }, [
              h('text', { staticStyle: S('confirm-btn-ok-text') }, '确定载入')
            ]),
            h('div', {
              staticStyle: S('confirm-btn confirm-btn-cancel'),
              on: { click: function () { vm.cancelTitleConfirm(); } }
            }, [
              h('text', { staticStyle: S('confirm-btn-cancel-text') }, '取消')
            ])
          ])
        ])
      ])
    );
  }

  return h('div', { staticStyle: S('title-root') }, children);
}
