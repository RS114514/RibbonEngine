// pages/afterstory/afterstory.js —— 后日谈卡片与物语入口（数据驱动）
import { S, log, getGal } from '../../common.js';
import { STORY } from '../../data/story_data.js';
import { coverUrl, titleBgUrl, voicePath } from '../../media.js';

var HEROINES = (STORY.afterMeta || []).map(function (meta) {
  var lines = (STORY.after && STORY.after[meta.key]) || [];
  return {
    key: meta.key,
    chapter: meta.chapter || '',
    title: meta.title || meta.name || meta.key,
    name: meta.name || meta.key,
    voice: meta.voice || '',
    bg: meta.cover ? coverUrl(meta.cover) : '',
    lines: lines,
    lineCount: lines.length,
    voiceCount: lines.filter(function (line) { return !!line[3]; }).length
  };
});

var AS_VIEWPORT_WIDTH = 800;
var AS_VIEWPORT_HEIGHT = 192;
var AS_CARD_WIDTH = 180;
var AS_CARD_GAP = 12;
var AS_LIST_PADDING = 12;
var AS_CONTENT_WIDTH = HEROINES.length * (AS_CARD_WIDTH + AS_CARD_GAP) + AS_LIST_PADDING * 2;
var AS_MIN_PAN = Math.min(0, AS_VIEWPORT_WIDTH - AS_CONTENT_WIDTH);

function findHeroine(key) {
  for (var i = 0; i < HEROINES.length; i++) {
    if (HEROINES[i].key === key) return HEROINES[i];
  }
  return null;
}

export var afterstoryMethods = {
  initAfterStory: function () {
    this.afterPanX = 0;
    this._asStartX = 0;
    this._asStartPanX = 0;
    this._asMoved = false;
    if (!findHeroine(this.selectedAfterHeroine)) {
      this.selectedAfterHeroine = HEROINES.length ? HEROINES[0].key : '';
    }
    // 词典笔没有 ALSA dmix：先释放标题 BGM 独占的声卡，播报语音才能打开设备。
    var G = getGal();
    if (G && typeof G.stopBgm === 'function') {
      G.stopBgm();
    }
  },
  onAsTouchStart: function (e) {
    if (e && e.changedTouches && e.changedTouches[0]) {
      var t = e.changedTouches[0];
      this._asStartX = t.pageX || t.clientX || 0;
      this._asStartPanX = this.afterPanX || 0;
      this._asMoved = false;
    }
  },
  onAsTouchMove: function (e) {
    if (e && e.changedTouches && e.changedTouches[0]) {
      var t = e.changedTouches[0];
      var cx = t.pageX || t.clientX || 0;
      var dx = cx - this._asStartX;
      if (Math.abs(dx) > 6) {
        this._asMoved = true;
      }
      var newX = this._asStartPanX + dx;
      if (newX > 0) newX = 0;
      if (newX < AS_MIN_PAN) newX = AS_MIN_PAN;
      this.afterPanX = newX;
    }
  },
  onAsTouchEnd: function () {
    var self = this;
    setTimeout(function () {
      self._asMoved = false;
    }, 120);
  },
  selectAfterHeroine: function (heroine) {
    if (this._asMoved || !heroine) return;
    this.selectedAfterHeroine = heroine.key;
    this.playHeroineVoice(heroine.voice);
  },
  playHeroineVoice: function (voiceFile) {
    if (this._asMoved || !voiceFile) return;
    log('play heroine voice: ' + voiceFile);
    var G = getGal();
    if (G) {
      // 先停 BGM 释放独占声卡，再切换播报语音，避免 Device busy 无声。
      if (typeof G.stopBgm === 'function') {
        G.stopBgm();
      }
      G.stopVoice();
      G.playVoice(voicePath(voiceFile), 1.0);
    }
  },
  startHeroineStory: function (heroine) {
    if (this._asMoved || !heroine) return;
    log('start heroine story: after_' + heroine.key);
    var G = getGal();
    if (G) {
      G.stopVoice();
    }
    this.selectedAfterHeroine = heroine.key;
    this.view = 'game';
    if (typeof this.initGame === 'function') {
      this.initGame('after_' + heroine.key, 0);
    }
  },
  returnToTitleFromAs: function () {
    var G = getGal();
    if (G) {
      G.stopVoice();
    }
    this.view = 'title';
    if (typeof this.initTitle === 'function') {
      this.initTitle();
    }
  }
};

export function renderAfterstory(vm, h) {
  var backButton = h('div', {
    staticStyle: S('as-btn-back'),
    on: { click: function () { vm.returnToTitleFromAs(); } }
  }, [
    h('text', { staticStyle: S('as-btn-back-text') }, '返回标题')
  ]);

  if (!HEROINES.length) {
    return h('div', { staticStyle: S('as-root') }, [
      h('image', { staticStyle: S('as-bg-img'), attrs: { src: titleBgUrl() } }),
      h('div', { staticStyle: S('as-bg-shade') }),
      h('div', { staticStyle: S('as-header') }, [
        h('div', { staticStyle: S('as-title-box') }, [
          h('text', { staticStyle: S('as-title-text') }, '◆ 日后谈 AFTER STORY ◆'),
          h('text', { staticStyle: S('as-subtitle') }, '未找到后日谈数据，请先按 app/data/README.md 生成 story_data.js')
        ]),
        backButton
      ])
    ]);
  }

  var cards = [];
  for (var i = 0; i < HEROINES.length; i++) {
    (function (heroine) {
      cards.push(
        h('div', {
          key: heroine.key,
          staticStyle: S(vm.selectedAfterHeroine === heroine.key ? 'as-card as-card-active' : 'as-card'),
          on: { click: function () { vm.selectAfterHeroine(heroine); } }
        }, [
          h('div', { staticStyle: S('as-card-cover') }, [
            heroine.bg ? h('image', {
              staticStyle: S('as-card-cover-img'),
              attrs: { src: heroine.bg }
            }) : null,
            h('div', { staticStyle: S('as-card-chapter-badge') }, [
              h('text', { staticStyle: S('as-card-chapter') }, heroine.chapter || heroine.title)
            ])
          ]),

          h('div', { staticStyle: S('as-card-info') }, [
            h('text', { staticStyle: S('as-card-name') }, heroine.name),
            h('text', {
              staticStyle: S('as-card-stats')
            }, heroine.lineCount + ' 句台词 · ' + heroine.voiceCount + ' 条语音'),

            h('div', { staticStyle: S('as-card-bottom-actions') }, [
              heroine.voice ? h('div', {
                staticStyle: S('as-btn-voice'),
                on: { click: function (e) {
                  if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
                  vm.selectAfterHeroine(heroine);
                } }
              }, [
                h('text', { staticStyle: S('as-btn-voice-text') }, '♪ 播报')
              ]) : null,
              h('div', {
                staticStyle: S('as-btn-play'),
                on: { click: function (e) {
                  if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
                  vm.startHeroineStory(heroine);
                } }
              }, [
                h('text', { staticStyle: S('as-btn-play-text') }, '▶ 进入后日谈物语')
              ])
            ])
          ])
        ])
      );
    })(HEROINES[i]);
  }

  return h('div', { staticStyle: S('as-root') }, [
    h('image', {
      staticStyle: S('as-bg-img'),
      attrs: { src: titleBgUrl() }
    }),
    h('div', { staticStyle: S('as-bg-shade') }),
    h('div', { staticStyle: S('as-header') }, [
      h('div', { staticStyle: S('as-title-box') }, [
        h('text', { staticStyle: S('as-title-text') }, '◆ 日后谈 AFTER STORY ◆'),
        h('text', { staticStyle: S('as-subtitle') }, HEROINES.length + ' 个追加物语 · 轻触按键播放播报语音')
      ]),
      backButton
    ]),
    h('div', {
      staticStyle: S('as-viewport'),
      on: {
        touchstart: function (e) { vm.onAsTouchStart(e); },
        touchmove: function (e) { vm.onAsTouchMove(e); },
        touchend: function () { vm.onAsTouchEnd(); }
      }
    }, [
      h('div', {
        staticStyle: S('as-card-list', {
          left: (vm.afterPanX || 0) + 'px',
          width: AS_CONTENT_WIDTH + 'px',
          height: AS_VIEWPORT_HEIGHT + 'px'
        })
      }, cards)
    ])
  ]);
}
