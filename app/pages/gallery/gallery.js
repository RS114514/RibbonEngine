// pages/gallery/gallery.js —— CG / BGM 鉴赏页（横向滑动选择与大图手势交互）
import { S, log, getGal } from '../../common.js';
import { readSettings } from '../../storage.js';

import { GALLERY } from '../../data/gallery_data.js';
import { cgUrl, bgmPath, titleBgUrl } from '../../media.js';

// CG / BGM 清单完全来自用户生成的 gallery_data.js，仓库不内置任何作品资源。
var CG_LIST = (GALLERY.cg || []).map(function (item, idx) {
  return {
    id: item.id || ('cg_' + idx),
    code: item.code || item.id || ('CG' + (idx + 1)),
    role: item.role || '',
    file: item.file || '',
    idx: idx,
    src: item.file ? cgUrl(item.file) : ''
  };
});

var BGM_TRACKS = (GALLERY.bgm || []).map(function (item, idx) {
  return {
    id: item.id || ('bgm_' + idx),
    file: item.file || '',
    code: item.code || item.file || ('BGM' + (idx + 1)),
    idx: idx
  };
});

// 横向画廊布局：CG 卡 176×154（16:9 图片 176×99 + 信息条 55），卡间距 10。
var GALLERY_VIEW_W = 800;
var CG_CARD_W = 176;
var CG_CARD_GAP = 10;
var CG_CONTENT_W = CG_LIST.length * (CG_CARD_W + CG_CARD_GAP) + CG_CARD_GAP;
var CG_MAX_PAN = Math.max(0, CG_CONTENT_W - GALLERY_VIEW_W);

// 缩放档位（16:9等比）
var ZOOM_LEVELS = [
  { scale: 1.0, w: 391, h: 220, label: '1.0x' },
  { scale: 1.5, w: 587, h: 330, label: '1.5x' },
  { scale: 2.0, w: 782, h: 440, label: '2.0x' },
  { scale: 2.5, w: 978, h: 550, label: '2.5x' }
];

// 读取持久化音频设置：关闭开关则禁止播放，音量强制归一到 0..1
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

export var galleryMethods = {
  initGallery: function () {
    this.galleryTab = this.galleryTab || 'cg';
    this.galleryPanX = 0;
    this._gStartX = 0;
    this._gStartPanX = 0;
    this._gMoved = false;
    this.galleryCgFullscreen = false;

    // 大图交互状态
    this.galleryZoomIndex = 0;
    this.galleryImgPanX = 0;
    this.galleryImgPanY = 0;
    this._imgTouchStartX = 0;
    this._imgTouchStartY = 0;
    this._imgStartPanX = 0;
    this._imgStartPanY = 0;
  },

  setGalleryTab: function (tab) {
    this.galleryTab = tab;
    this.galleryPanX = 0;
  },

  // 画廊滑动选择手势（类似日后谈）
  onGalleryTouchStart: function (e) {
    if (e && e.changedTouches && e.changedTouches[0]) {
      var t = e.changedTouches[0];
      this._gStartX = t.pageX || t.clientX || 0;
      this._gStartPanX = this.galleryPanX || 0;
      this._gMoved = false;
    }
  },

  onGalleryTouchMove: function (e) {
    if (e && e.changedTouches && e.changedTouches[0]) {
      var t = e.changedTouches[0];
      var cx = t.pageX || t.clientX || 0;
      var dx = cx - this._gStartX;
      if (Math.abs(dx) > 6) {
        this._gMoved = true;
      }
      var newX = this._gStartPanX + dx;
      if (newX > 0) newX = 0;
      var maxPan = this.galleryTab === 'cg' ? -CG_MAX_PAN : -(BGM_TRACKS.length * 130 - 700);
      if (maxPan > 0) maxPan = 0;
      if (newX < maxPan) newX = maxPan;
      this.galleryPanX = newX;
    }
  },

  onGalleryTouchEnd: function () {
    var self = this;
    setTimeout(function () {
      self._gMoved = false;
    }, 120);
  },

  // 全屏大图交互
  openFullscreenCg: function (idx) {
    if (this._gMoved || !CG_LIST.length) return;
    this.galleryCgFullscreen = true;
    this.galleryCgIndex = idx;
    this.resetImgZoom();
  },

  exitFullscreenCg: function () {
    this.galleryCgFullscreen = false;
  },

  prevFullscreenCg: function () {
    if (!CG_LIST.length) return;
    var idx = (this.galleryCgIndex || 0) - 1;
    if (idx < 0) idx = CG_LIST.length - 1;
    this.galleryCgIndex = idx;
    this.resetImgZoom();
  },

  nextFullscreenCg: function () {
    if (!CG_LIST.length) return;
    var idx = (this.galleryCgIndex || 0) + 1;
    if (idx >= CG_LIST.length) idx = 0;
    this.galleryCgIndex = idx;
    this.resetImgZoom();
  },

  resetImgZoom: function () {
    this.galleryZoomIndex = 0;
    var z = ZOOM_LEVELS[0];
    this.galleryImgPanX = Math.round((664 - z.w) / 2);
    this.galleryImgPanY = Math.round((220 - z.h) / 2);
    if (typeof this.$forceUpdate === 'function') this.$forceUpdate();
  },

  zoomInImg: function () {
    var cur = this.galleryZoomIndex || 0;
    if (cur < ZOOM_LEVELS.length - 1) {
      this.galleryZoomIndex = cur + 1;
      this.clampImgPan();
      if (typeof this.$forceUpdate === 'function') this.$forceUpdate();
    }
  },

  zoomOutImg: function () {
    var cur = this.galleryZoomIndex || 0;
    if (cur > 0) {
      this.galleryZoomIndex = cur - 1;
      this.clampImgPan();
      if (typeof this.$forceUpdate === 'function') this.$forceUpdate();
    }
  },

  clampImgPan: function () {
    var z = ZOOM_LEVELS[this.galleryZoomIndex || 0];
    // 水平拖动边界（视口宽 664px）
    if (z.w <= 664) {
      this.galleryImgPanX = Math.round((664 - z.w) / 2);
    } else {
      var minX = 664 - z.w;
      if (this.galleryImgPanX < minX) this.galleryImgPanX = minX;
      if (this.galleryImgPanX > 0) this.galleryImgPanX = 0;
    }
    // 垂直拖动边界（视口高 220px）
    if (z.h <= 220) {
      this.galleryImgPanY = Math.round((220 - z.h) / 2);
    } else {
      var minY = 220 - z.h;
      if (this.galleryImgPanY < minY) this.galleryImgPanY = minY;
      if (this.galleryImgPanY > 0) this.galleryImgPanY = 0;
    }
  },

  onImgTouchStart: function (e) {
    if (e && e.changedTouches && e.changedTouches[0]) {
      var t = e.changedTouches[0];
      this._imgTouchStartX = t.pageX || t.clientX || 0;
      this._imgTouchStartY = t.pageY || t.clientY || 0;
      this._imgStartPanX = this.galleryImgPanX || 0;
      this._imgStartPanY = this.galleryImgPanY || 0;
    }
  },

  onImgTouchMove: function (e) {
    if (e && e.changedTouches && e.changedTouches[0]) {
      var t = e.changedTouches[0];
      var cx = t.pageX || t.clientX || 0;
      var cy = t.pageY || t.clientY || 0;
      var dx = cx - this._imgTouchStartX;
      var dy = cy - this._imgTouchStartY;

      var z = ZOOM_LEVELS[this.galleryZoomIndex || 0];
      if (z.w > 664) {
        var nx = this._imgStartPanX + dx;
        var minX = 664 - z.w;
        if (nx < minX - 40) nx = minX - 40;
        if (nx > 40) nx = 40;
        this.galleryImgPanX = nx;
      }
      if (z.h > 220) {
        var ny = this._imgStartPanY + dy;
        var minY = 220 - z.h;
        if (ny < minY - 30) ny = minY - 30;
        if (ny > 30) ny = 30;
        this.galleryImgPanY = ny;
      }
    }
  },

  onImgTouchEnd: function () {
    this.clampImgPan();
  },

  // 音乐播放
  playGalleryBgm: function (index) {
    if (this._gMoved) return;
    var t = BGM_TRACKS[index];
    if (!t) return;
    this.galleryBgmIndex = index;
    if (this.galleryPlayingBgm === t.file) {
      this.galleryPlayingBgm = '';
      var currentGal = getGal();
      if (currentGal) currentGal.stopBgm();
      return;
    }
    var playback = getBgmPlaybackSettings();
    var G = getGal();
    if (!playback.enabled) {
      this.galleryPlayingBgm = '';
      if (G) G.stopBgm();
      return;
    }
    this.galleryPlayingBgm = t.file;
    if (G) {
      G.playBgm(bgmPath(t.file), true, playback.volume);
    }
  },

  toggleGalleryBgmState: function () {
    var G = getGal();
    if (!G) return;
    if (this.galleryPlayingBgm) {
      G.stopBgm();
      this.galleryPlayingBgm = '';
    } else {
      var playback = getBgmPlaybackSettings();
      if (!playback.enabled) {
        this.galleryPlayingBgm = '';
        G.stopBgm();
        return;
      }
      var t = BGM_TRACKS[this.galleryBgmIndex || 0];
      if (t) {
        this.galleryPlayingBgm = t.file;
        G.playBgm(bgmPath(t.file), true, playback.volume);
      }
    }
  },

  goBackTitle: function () {
    this.stopGalleryBgm();
    this.view = 'title';
    if (typeof this.initTitle === 'function') {
      this.initTitle();
    }
  },

  stopGalleryBgm: function () {
    var G = getGal();
    if (G) {
      G.stopBgm();
    }
    this.galleryPlayingBgm = '';
  }
};

export function renderGallery(vm, h) {
  var tab = vm.galleryTab || 'cg';

  // 1. 全屏大图模式（16:9等比 + 缩放 + 手势拖动，双翼式布局：左侧翻页退出，右侧缩放重置）
  if (vm.galleryCgFullscreen) {
    var curCg = CG_LIST[vm.galleryCgIndex || 0] || CG_LIST[0];
    var z = ZOOM_LEVELS[vm.galleryZoomIndex || 0];
    var imgLeft = vm.galleryImgPanX !== undefined ? vm.galleryImgPanX : Math.round((664 - z.w) / 2);
    var imgTop = vm.galleryImgPanY !== undefined ? vm.galleryImgPanY : Math.round((220 - z.h) / 2);

    return h('div', { staticStyle: S('gallery-fs-root') }, [
      // 左翼控制栏 (宽 68px: 翻页与退出)
      h('div', { staticStyle: S('gallery-fs-left-wing') }, [
        h('div', {
          staticStyle: S('gallery-fs-wing-btn'),
          on: { click: function () { vm.prevFullscreenCg(); } }
        }, [
          h('text', {
            staticStyle: S('gallery-fs-wing-btn-text')
          }, '< 上张')
        ]),
        h('div', {
          staticStyle: S('gallery-fs-wing-btn'),
          on: { click: function () { vm.nextFullscreenCg(); } }
        }, [
          h('text', {
            staticStyle: S('gallery-fs-wing-btn-text')
          }, '下张 >')
        ]),
        h('div', {
          staticStyle: S('gallery-fs-wing-btn-exit'),
          on: { click: function () { vm.exitFullscreenCg(); } }
        }, [
          h('text', {
            staticStyle: S('gallery-fs-wing-btn-text')
          }, '退出')
        ])
      ]),

      // 中间大图视口 (宽 664px: 手势拖动)
      h('div', {
        staticStyle: S('gallery-fs-viewport'),
        on: {
          touchstart: function (e) { vm.onImgTouchStart(e); },
          touchmove: function (e) { vm.onImgTouchMove(e); },
          touchend: function () { vm.onImgTouchEnd(); }
        }
      }, [
        // 等比图片画布
        h('image', {
          staticStyle: S('gallery-fs-img', {
            left: imgLeft + 'px',
            top: imgTop + 'px',
            width: z.w + 'px',
            height: z.h + 'px'
          }),
          attrs: { src: curCg.src }
        }),

        // 顶部悬浮状态条（代号与序号）
        h('div', { staticStyle: S('gallery-fs-header') }, [
          h('text', { staticStyle: S('gallery-fs-header-text') }, (curCg.idx + 1) + '/' + CG_LIST.length + ' · ' + curCg.code + ' [' + curCg.role + ']')
        ])
      ]),

      // 右翼控制栏 (宽 68px: 缩放与重置)
      h('div', { staticStyle: S('gallery-fs-right-wing') }, [
        h('div', {
          staticStyle: S('gallery-fs-wing-btn'),
          on: { click: function () { vm.zoomInImg(); } }
        }, [
          h('text', {
            staticStyle: S('gallery-fs-wing-btn-text')
          }, '+ 放大')
        ]),
        h('div', { staticStyle: S('gallery-fs-wing-badge') }, [
          h('text', { staticStyle: S('gallery-fs-wing-badge-text') }, z.label)
        ]),
        h('div', {
          staticStyle: S('gallery-fs-wing-btn'),
          on: { click: function () { vm.zoomOutImg(); } }
        }, [
          h('text', {
            staticStyle: S('gallery-fs-wing-btn-text')
          }, '- 缩小')
        ]),
        h('div', {
          staticStyle: S('gallery-fs-wing-btn'),
          on: { click: function () { vm.resetImgZoom(); } }
        }, [
          h('text', {
            staticStyle: S('gallery-fs-wing-btn-text')
          }, '重置')
        ])
      ])
    ]);
  }

  // 2. 主画廊模式（顶部标签 + 横向滑动卡片列表，同日后谈）
  var topHeader = h('div', { staticStyle: S('gallery-header') }, [
    h('div', { staticStyle: S('gallery-title-box') }, [
      h('text', { staticStyle: S('gallery-title') }, '◆ 鉴赏 EXTRA ◆'),
      h('text', { staticStyle: S('gallery-subtitle') }, tab === 'cg'
        ? ('横向滑动浏览 ' + CG_LIST.length + ' 件 CG · 轻触进入大图')
        : ('横向滑动浏览 ' + BGM_TRACKS.length + ' 首 BGM · 轻触播放'))
    ]),
    h('div', { staticStyle: S('gallery-tabs') }, [
      h('div', {
        staticStyle: tab === 'cg' ? S('gallery-tab-item gallery-tab-active') : S('gallery-tab-item'),
        on: { click: function () { vm.setGalleryTab('cg'); } }
      }, [
        h('text', { staticStyle: S('gallery-tab-text') }, 'CG 鉴赏')
      ]),
      h('div', {
        staticStyle: tab === 'bgm' ? S('gallery-tab-item gallery-tab-active') : S('gallery-tab-item'),
        on: { click: function () { vm.setGalleryTab('bgm'); } }
      }, [
        h('text', { staticStyle: S('gallery-tab-text') }, '音乐鉴赏')
      ]),
      h('div', {
        staticStyle: S('gallery-back-btn'),
        on: { click: function () { vm.goBackTitle(); } }
      }, [
        h('text', { staticStyle: S('gallery-back-text') }, '‹ 返回标题')
      ])
    ])
  ]);

  var bodyContent = null;

  // TAB 1: CG 鉴赏（横向滑动卡片列表）
  if (tab === 'cg') {
    var cgCards = CG_LIST.map(function (it) {
      return h('div', {
        key: it.id,
        staticStyle: S('g-cg-card'),
        on: { click: function () { vm.openFullscreenCg(it.idx); } }
      }, [
        h('image', {
          staticStyle: S('g-cg-card-img'),
          attrs: { src: it.src }
        }),
        h('div', { staticStyle: S('g-cg-card-bar') }, [
          h('text', { staticStyle: S('g-cg-card-code') }, it.code),
          h('text', { staticStyle: S('g-cg-card-role') }, it.role)
        ])
      ]);
    });

    bodyContent = CG_LIST.length ? h('div', {
      staticStyle: S('g-scroll-viewport'),
      on: {
        touchstart: function (e) { vm.onGalleryTouchStart(e); },
        touchmove: function (e) { vm.onGalleryTouchMove(e); },
        touchend: function () { vm.onGalleryTouchEnd(); }
      }
    }, [
      h('div', {
        staticStyle: S('g-scroll-list', {
          left: (vm.galleryPanX || 0) + 'px',
          width: CG_CONTENT_W + 'px'
        })
      }, cgCards)
    ]) : h('div', { staticStyle: S('g-scroll-viewport') }, [
      h('text', { staticStyle: S('gallery-subtitle') }, '未找到 CG 清单，请先按 app/data/README.md 生成 gallery_data.js')
    ]);
  }

  // TAB 2: 音乐鉴赏（横向滑动列表）
  if (tab === 'bgm') {
    var bgmCards = BGM_TRACKS.map(function (it) {
      var isPlaying = vm.galleryPlayingBgm === it.file;
      return h('div', {
        key: it.id,
        staticStyle: isPlaying ? S('g-bgm-card g-bgm-card-active') : S('g-bgm-card'),
        on: { click: function () { vm.playGalleryBgm(it.idx); } }
      }, [
        h('div', { staticStyle: S('g-bgm-card-top') }, [
          h('text', { staticStyle: S('g-bgm-card-idx') }, '#' + (it.idx + 1 < 10 ? '0' + (it.idx + 1) : it.idx + 1)),
          h('text', { staticStyle: isPlaying ? S('g-bgm-card-state active') : S('g-bgm-card-state') }, isPlaying ? '▶ 播放中' : '♪')
        ]),
        h('text', { staticStyle: S('g-bgm-card-code') }, it.code),
        h('div', { staticStyle: S('g-bgm-card-btn') }, [
          h('text', { staticStyle: S('g-bgm-card-btn-text') }, isPlaying ? '暂停' : '播放')
        ])
      ]);
    });

    bodyContent = BGM_TRACKS.length ? h('div', {
      staticStyle: S('g-scroll-viewport'),
      on: {
        touchstart: function (e) { vm.onGalleryTouchStart(e); },
        touchmove: function (e) { vm.onGalleryTouchMove(e); },
        touchend: function () { vm.onGalleryTouchEnd(); }
      }
    }, [
      h('div', {
        staticStyle: S('g-scroll-list', {
          left: (vm.galleryPanX || 0) + 'px',
          width: (BGM_TRACKS.length * 130 + 40) + 'px'
        })
      }, bgmCards)
    ]) : h('div', { staticStyle: S('g-scroll-viewport') }, [
      h('text', { staticStyle: S('gallery-subtitle') }, '未找到 BGM 清单，请先按 app/data/README.md 生成 gallery_data.js')
    ]);
  }

  return h('div', { staticStyle: S('gallery-root') }, [
    h('image', {
      staticStyle: S('gallery-bg-img'),
      attrs: { src: titleBgUrl() }
    }),
    topHeader,
    bodyContent
  ]);
}
