// pages/gallery/gallery.js —— 多合一鉴赏收藏馆（CG/场景/立绘/音乐）
import { S, log, getGal } from '../../common.js';
import { readSettings } from '../../storage.js';
import { GALLERY } from '../../data/gallery_data.js';
import { cgUrl, bgmPath, titleBgUrl, sceneVariantUrl, coverUrl, fgUrl } from '../../media.js';

var CG_GROUPS = GALLERY.cgGroups || [];
var CG_LIST = (GALLERY.cg || []).map(function (item, idx) {
  return {
    id: item.id || ('cg_' + idx),
    code: item.code || item.id || ('CG' + (idx + 1)),
    group: item.group || item.role || '',
    role: item.role || '',
    file: item.file || item.id || '',
    idx: idx,
    src: item.src || (item.file ? cgUrl(item.file) : (item.id ? cgUrl(item.id) : ''))
  };
});

var CG_GROUP_LISTS = {};
for (var cgg = 0; cgg < CG_GROUPS.length; cgg++) {
  var groupKey = CG_GROUPS[cgg].key;
  var grouped = [];
  for (var cgl = 0; cgl < CG_LIST.length; cgl++) {
    if (CG_LIST[cgl].group === groupKey) grouped.push(CG_LIST[cgl]);
  }
  for (var cgx = 0; cgx < grouped.length; cgx++) grouped[cgx].idx = cgx;
  CG_GROUP_LISTS[groupKey] = grouped;
}

var SCENE_GROUPS = GALLERY.sceneGroups || [];
var SCENE_LIST = (GALLERY.scenes || []).map(function (item, idx) {
  return Object.assign({}, item, { idx: idx });
});
var SCENE_GROUP_LISTS = {};
for (var scg = 0; scg < SCENE_GROUPS.length; scg++) {
  var sceneGroupKey = SCENE_GROUPS[scg].key;
  var sceneGrouped = [];
  for (var scl = 0; scl < SCENE_LIST.length; scl++) {
    if (SCENE_LIST[scl].group === sceneGroupKey || SCENE_LIST[scl].route === sceneGroupKey) {
      sceneGrouped.push(SCENE_LIST[scl]);
    }
  }
  for (var scx = 0; scx < sceneGrouped.length; scx++) sceneGrouped[scx].idx = scx;
  SCENE_GROUP_LISTS[sceneGroupKey] = sceneGrouped;
}

function activeSceneList(vm) {
  return (vm && vm.gallerySceneGroup && SCENE_GROUP_LISTS[vm.gallerySceneGroup]) || SCENE_LIST;
}

function sceneVariantCount(scene) {
  return (scene && scene.variants && scene.variants.length) || 1;
}

function sceneVariantSrc(scene, index) {
  if (!scene) return '';
  var variants = scene.variants || [];
  var file = variants[index] || variants[0];
  if (file) return sceneVariantUrl(file);
  if (scene.cover) return cgUrl(scene.cover);
  return '';
}

function sceneGroupMaxPan(vm) {
  var list = (vm && vm.gallerySceneGroup && SCENE_GROUP_LISTS[vm.gallerySceneGroup]) || [];
  var width = list.length * (176 + 10) + 10;
  return Math.max(0, width - 800);
}

var STAND_CHARS = GALLERY.standChars || GALLERY.stands || [];
function standMeta(key) {
  for (var i = 0; i < STAND_CHARS.length; i++) {
    if (STAND_CHARS[i].key === key) return STAND_CHARS[i];
  }
  return null;
}

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

function standSrc(meta, dressIndex, faceIndex) {
  if (!meta) return '';
  var dress = (meta.dresses && meta.dresses[dressIndex || 0]) || 'default';
  var maxFaces = typeof meta.faces === 'number' ? meta.faces : 1;
  var face = ((faceIndex || 0) % maxFaces) + 1;
  return fgUrl(meta.char + '_' + dress + '_' + pad2(face));
}

function activeCgList(vm) {
  return (vm && vm.galleryCgGroup && CG_GROUP_LISTS[vm.galleryCgGroup]) || CG_LIST;
}

var CG_PAGE_SIZE = 4;
var SCENE_PAGE_SIZE = 4;

function cgGroupMaxPan(vm) {
  var list = (vm && vm.galleryCgGroup && CG_GROUP_LISTS[vm.galleryCgGroup]) || [];
  var width = list.length * (176 + 10) + 10;
  return Math.max(0, width - 800);
}

var BGM_TRACKS = (GALLERY.bgm || []).map(function (item, idx) {
  return {
    id: item.id || ('bgm_' + idx),
    file: item.file || '',
    code: item.code || item.file || ('BGM' + (idx + 1)),
    title: item.title || item.name || item.code || ('BGM ' + (idx + 1)),
    idx: idx
  };
});

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
    this.galleryCgFullscreen = false;
    this.galleryCgGroup = this.galleryCgGroup || '';
    this.galleryCgPage = this.galleryCgPage || 0;
    this.gallerySceneGroup = this.gallerySceneGroup || '';
    this.galleryScenePage = this.galleryScenePage || 0;
    this.gallerySceneIndex = this.gallerySceneIndex || 0;
    this.gallerySceneExpr = 0;
    this.gallerySceneFullscreen = false;
    this.galleryStandChar = this.galleryStandChar || '';
    this.galleryStandDress = 0;
    this.galleryStandFace = 0;
    this._gStartX = 0;
    this._gStartPanX = 0;
    this._gMoved = false;
  },

  selectCgGroup: function (key) {
    this.galleryCgGroup = key;
    this.galleryCgPage = 0;
    this.galleryPanX = 0;
  },

  backToCgGroups: function () {
    this.galleryCgGroup = '';
    this.galleryCgPage = 0;
    this.galleryPanX = 0;
  },

  setCgPage: function (delta) {
    var list = CG_GROUP_LISTS[this.galleryCgGroup] || [];
    var pages = Math.max(1, Math.ceil(list.length / CG_PAGE_SIZE));
    var page = (this.galleryCgPage || 0) + delta;
    if (page < 0) page = 0;
    if (page >= pages) page = pages - 1;
    this.galleryCgPage = page;
    var maxPan = cgGroupMaxPan(this);
    var target = -page * CG_PAGE_SIZE * (176 + 10);
    if (target < -maxPan) target = -maxPan;
    this.galleryPanX = target;
  },

  openFullscreenCg: function (idx) {
    if (this._gMoved) return;
    this.galleryCgFullscreen = true;
    this.galleryCgIndex = idx;
    if (typeof this.$forceUpdate === 'function') this.$forceUpdate();
  },

  exitFullscreenCg: function () {
    this.galleryCgFullscreen = false;
  },

  prevFullscreenCg: function () {
    var list = activeCgList(this);
    var idx = (this.galleryCgIndex || 0) - 1;
    if (idx < 0) idx = list.length - 1;
    this.galleryCgIndex = idx;
  },

  nextFullscreenCg: function () {
    var list = activeCgList(this);
    var idx = (this.galleryCgIndex || 0) + 1;
    if (idx >= list.length) idx = 0;
    this.galleryCgIndex = idx;
  },

  selectSceneGroup: function (key) {
    this.gallerySceneGroup = key;
    this.galleryScenePage = 0;
    this.gallerySceneIndex = 0;
    this.gallerySceneExpr = 0;
    this.galleryPanX = 0;
  },

  backToSceneGroups: function () {
    this.gallerySceneGroup = '';
    this.galleryScenePage = 0;
    this.gallerySceneIndex = 0;
    this.gallerySceneExpr = 0;
    this.galleryPanX = 0;
  },

  setScenePage: function (delta) {
    var list = SCENE_GROUP_LISTS[this.gallerySceneGroup] || [];
    var pages = Math.max(1, Math.ceil(list.length / SCENE_PAGE_SIZE));
    var page = (this.galleryScenePage || 0) + delta;
    if (page < 0) page = 0;
    if (page >= pages) page = pages - 1;
    this.galleryScenePage = page;
    var maxPan = sceneGroupMaxPan(this);
    var target = -page * SCENE_PAGE_SIZE * (176 + 10);
    if (target < -maxPan) target = -maxPan;
    this.galleryPanX = target;
  },

  openFullscreenScene: function (idx) {
    if (this._gMoved) return;
    this.gallerySceneFullscreen = true;
    this.gallerySceneIndex = idx;
    this.gallerySceneExpr = 0;
    if (typeof this.$forceUpdate === 'function') this.$forceUpdate();
  },

  exitFullscreenScene: function () {
    this.gallerySceneFullscreen = false;
  },

  prevFullscreenScene: function () {
    var list = activeSceneList(this);
    var idx = (this.gallerySceneIndex || 0) - 1;
    if (idx < 0) idx = list.length - 1;
    this.gallerySceneIndex = idx;
    this.gallerySceneExpr = 0;
  },

  nextFullscreenScene: function () {
    var list = activeSceneList(this);
    var idx = (this.gallerySceneIndex || 0) + 1;
    if (idx >= list.length) idx = 0;
    this.gallerySceneIndex = idx;
    this.gallerySceneExpr = 0;
  },

  changeSceneExpr: function (delta) {
    var list = activeSceneList(this);
    var scene = list[this.gallerySceneIndex || 0];
    var count = sceneVariantCount(scene);
    var expr = (this.gallerySceneExpr || 0) + delta;
    if (expr < 0) expr = count - 1;
    if (expr >= count) expr = 0;
    this.gallerySceneExpr = expr;
  },

  selectStandChar: function (key) {
    if (!standMeta(key)) return;
    this.galleryStandChar = key;
    this.galleryStandDress = 0;
    this.galleryStandFace = 0;
  },

  backToStandChars: function () {
    this.galleryStandChar = '';
    this.galleryStandDress = 0;
    this.galleryStandFace = 0;
  },

  setStandDress: function (index) {
    var meta = standMeta(this.galleryStandChar);
    if (!meta || !meta.dresses || !meta.dresses[index]) return;
    this.galleryStandDress = index;
  },

  changeStandFace: function (delta) {
    var meta = standMeta(this.galleryStandChar);
    if (!meta) return;
    var maxFaces = typeof meta.faces === 'number' ? meta.faces : 1;
    var face = (this.galleryStandFace || 0) + delta;
    if (face < 0) face = maxFaces - 1;
    if (face >= maxFaces) face = 0;
    this.galleryStandFace = face;
  },

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
      var maxPan = 0;
      if (this.galleryTab === 'cg') {
        if (CG_GROUPS.length && !this.galleryCgGroup) { this.galleryPanX = 0; return; }
        maxPan = -cgGroupMaxPan(this);
      } else if (this.galleryTab === 'scene') {
        if (SCENE_GROUPS.length && !this.gallerySceneGroup) { this.galleryPanX = 0; return; }
        maxPan = -sceneGroupMaxPan(this);
      } else if (this.galleryTab === 'bgm') {
        var totalBgmW = BGM_TRACKS.length * 130 + 40;
        maxPan = -(Math.max(0, totalBgmW - 800));
      }
      if (newX < maxPan) newX = maxPan;
      this.galleryPanX = newX;
    }
  },

  onGalleryTouchEnd: function () {
    // 手势结束，状态自然保持
  },

  playGalleryBgm: function (index) {
    var it = BGM_TRACKS[index];
    if (!it) return;
    this.galleryBgmIndex = index;
    var G = getGal();
    if (this.galleryPlayingBgm === it.file) {
      if (G && typeof G.stopBgm === 'function') G.stopBgm();
      this.galleryPlayingBgm = '';
      return;
    }
    var playback = getBgmPlaybackSettings();
    if (!playback.enabled) {
      this.galleryPlayingBgm = '';
      if (G && typeof G.stopBgm === 'function') G.stopBgm();
      return;
    }
    this.galleryPlayingBgm = it.file;
    if (G && typeof G.playBgm === 'function') {
      G.playBgm(bgmPath(it.file), true, playback.volume);
    }
  },

  toggleGalleryBgmState: function () {
    var G = getGal();
    if (!G) return;
    if (this.galleryPlayingBgm) {
      if (typeof G.stopBgm === 'function') G.stopBgm();
      this.galleryPlayingBgm = '';
    } else {
      var playback = getBgmPlaybackSettings();
      if (!playback.enabled) {
        this.galleryPlayingBgm = '';
        if (typeof G.stopBgm === 'function') G.stopBgm();
        return;
      }
      var track = BGM_TRACKS[this.galleryBgmIndex || 0] || BGM_TRACKS[0];
      if (!track) return;
      this.galleryPlayingBgm = track.file;
      if (typeof G.playBgm === 'function') {
        G.playBgm(bgmPath(track.file), true, playback.volume);
      }
    }
  },

  stopGalleryAudio: function () {
    var G = getGal();
    if (G && typeof G.stopBgm === 'function') G.stopBgm();
    this.galleryPlayingBgm = '';
  }
};

export function renderGallery(vm, h) {
  var tab = vm.galleryTab || 'cg';

  // 全屏大图模式
  if (vm.galleryCgFullscreen) {
    var list = activeCgList(vm);
    var cur = list[vm.galleryCgIndex || 0] || list[0];
    return h('div', { staticStyle: S('gallery-root') }, [
      h('image', {
        staticStyle: S('gallery-fs-bg'),
        attrs: { src: titleBgUrl() }
      }),
      h('div', {
        staticStyle: S('gallery-fs-stage'),
        on: { click: function () { vm.exitFullscreenCg(); } }
      }, [
        h('image', {
          staticStyle: S('gallery-fs-img'),
          attrs: { src: cur ? cur.src : '', resize: 'contain' }
        })
      ]),
      h('div', {
        staticStyle: S('gallery-fs-wing-l'),
        on: { click: function () { vm.prevFullscreenCg(); } }
      }, [
        h('text', { staticStyle: S('gallery-fs-wing-icon') }, '‹')
      ]),
      h('div', {
        staticStyle: S('gallery-fs-wing-r'),
        on: { click: function () { vm.nextFullscreenCg(); } }
      }, [
        h('text', { staticStyle: S('gallery-fs-wing-icon') }, '›')
      ]),
      h('div', {
        staticStyle: S('gallery-fs-close-btn'),
        on: { click: function () { vm.exitFullscreenCg(); } }
      }, [
        h('text', { staticStyle: S('gallery-fs-close-text') }, '✕')
      ]),
      h('div', { staticStyle: S('gallery-fs-badge') }, [
        h('text', { staticStyle: S('gallery-fs-badge-text') },
          ((vm.galleryCgIndex || 0) + 1) + ' / ' + list.length + (cur ? (' · ' + (cur.code || cur.id)) : ''))
      ])
    ]);
  }

  // 全屏场景模式
  if (vm.gallerySceneFullscreen) {
    var sList = activeSceneList(vm);
    var curScene = sList[vm.gallerySceneIndex || 0] || sList[0];
    var exprCount = sceneVariantCount(curScene);
    var curExpr = vm.gallerySceneExpr || 0;
    var src = sceneVariantSrc(curScene, curExpr);
    return h('div', { staticStyle: S('gallery-root') }, [
      h('image', {
        staticStyle: S('gallery-fs-bg'),
        attrs: { src: titleBgUrl() }
      }),
      h('div', {
        staticStyle: S('gallery-fs-stage'),
        on: { click: function () { vm.exitFullscreenScene(); } }
      }, [
        h('image', {
          staticStyle: S('gallery-fs-img'),
          attrs: { src: src, resize: 'contain' }
        })
      ]),
      h('div', {
        staticStyle: S('gallery-fs-wing-l'),
        on: { click: function () { vm.prevFullscreenScene(); } }
      }, [
        h('text', { staticStyle: S('gallery-fs-wing-icon') }, '‹')
      ]),
      h('div', {
        staticStyle: S('gallery-fs-wing-r'),
        on: { click: function () { vm.nextFullscreenScene(); } }
      }, [
        h('text', { staticStyle: S('gallery-fs-wing-icon') }, '›')
      ]),
      h('div', {
        staticStyle: S('gallery-fs-close-btn'),
        on: { click: function () { vm.exitFullscreenScene(); } }
      }, [
        h('text', { staticStyle: S('gallery-fs-close-text') }, '✕')
      ]),
      exprCount > 1 ? h('div', {
        staticStyle: S('gallery-fs-expr-btn'),
        on: { click: function () { vm.changeSceneExpr(1); } }
      }, [
        h('text', { staticStyle: S('gallery-fs-expr-text') }, '表情 (' + (curExpr + 1) + '/' + exprCount + ')')
      ]) : null,
      h('div', { staticStyle: S('gallery-fs-badge') }, [
        h('text', { staticStyle: S('gallery-fs-badge-text') },
          ((vm.gallerySceneIndex || 0) + 1) + ' / ' + sList.length + (curScene ? (' · ' + (curScene.title || curScene.id)) : ''))
      ])
    ]);
  }

  // 顶部导航栏
  var tabButtons = [
    { key: 'cg', label: 'CG 鉴赏' },
    { key: 'scene', label: '场景鉴赏' },
    { key: 'stand', label: '立绘鉴赏' },
    { key: 'bgm', label: '音乐鉴赏' }
  ].map(function (b) {
    var active = tab === b.key;
    return h('div', {
      key: b.key,
      staticStyle: active ? S('g-tab-btn g-tab-btn-active') : S('g-tab-btn'),
      on: {
        click: function () {
          vm.galleryTab = b.key;
          vm.galleryPanX = 0;
        }
      }
    }, [
      h('text', { staticStyle: S('g-tab-btn-text') }, b.label)
    ]);
  });

  var topHeader = h('div', { staticStyle: S('g-header') }, [
    h('div', {
      staticStyle: S('g-back-btn'),
      on: {
        click: function () {
          vm.stopGalleryAudio();
          vm.view = 'title';
          if (typeof vm.initTitle === 'function') vm.initTitle();
        }
      }
    }, [
      h('text', { staticStyle: S('g-back-btn-text') }, '‹ 主菜单')
    ]),
    h('div', { staticStyle: S('g-tab-row') }, tabButtons)
  ]);

  var bodyContent = null;

  // TAB 1: CG 鉴赏
  if (tab === 'cg') {
    if (CG_GROUPS.length && !vm.galleryCgGroup) {
      var groupCards = CG_GROUPS.map(function (item) {
        var count = (CG_GROUP_LISTS[item.key] || []).length;
        var coverSrc = item.ema ? coverUrl('ema/' + item.ema) : titleBgUrl();
        return h('div', {
          key: item.key,
          staticStyle: S('g-group-card'),
          on: { click: function () { vm.selectCgGroup(item.key); } }
        }, [
          h('image', {
            staticStyle: S('g-group-card-img'),
            attrs: { src: coverSrc, resize: 'cover' }
          }),
          h('div', { staticStyle: S('g-group-info') }, [
            h('text', { staticStyle: S('g-group-name') }, item.name),
            h('text', { staticStyle: S('g-group-count') }, count + ' 张')
          ])
        ]);
      });
      bodyContent = h('div', { staticStyle: S('g-group-viewport') }, [
        h('text', { staticStyle: S('g-group-hint') }, '轻触分类卡片，进入专属 CG 网格浏览'),
        h('div', { staticStyle: S('g-group-row') }, groupCards)
      ]);
    } else {
      var currentList = activeCgList(vm);
      var cgCards = currentList.map(function (it) {
        return h('div', {
          key: it.id,
          staticStyle: S('g-cg-card'),
          on: { click: function () { vm.openFullscreenCg(it.idx); } }
        }, [
          h('image', {
            staticStyle: S('g-cg-card-img'),
            attrs: { src: it.src, resize: 'contain' }
          }),
          h('div', { staticStyle: S('g-cg-card-footer') }, [
            h('text', { staticStyle: S('g-cg-card-code') }, it.code || it.id)
          ])
        ]);
      });

      bodyContent = h('div', {
        staticStyle: S('g-scroll-viewport'),
        on: {
          touchstart: function (e) { vm.onGalleryTouchStart(e); },
          touchmove: function (e) { vm.onGalleryTouchMove(e); },
          touchend: function () { vm.onGalleryTouchEnd(); }
        }
      }, [
        CG_GROUPS.length ? h('div', {
          staticStyle: S('g-sub-nav'),
          on: { click: function () { vm.backToCgGroups(); } }
        }, [
          h('text', { staticStyle: S('g-sub-nav-text') }, '‹ 返回分类选择')
        ]) : null,
        h('div', {
          staticStyle: S('g-scroll-list', {
            left: (vm.galleryPanX || 0) + 'px',
            width: (currentList.length * 186 + 40) + 'px'
          })
        }, cgCards)
      ]);
    }
  }

  // TAB 2: 场景鉴赏
  if (tab === 'scene') {
    if (SCENE_GROUPS.length && !vm.gallerySceneGroup) {
      var sGroupCards = SCENE_GROUPS.map(function (item) {
        var count = (SCENE_GROUP_LISTS[item.key] || []).length;
        return h('div', {
          key: item.key,
          staticStyle: S('g-group-card'),
          on: { click: function () { vm.selectSceneGroup(item.key); } }
        }, [
          h('div', { staticStyle: S('g-group-info') }, [
            h('text', { staticStyle: S('g-group-name') }, item.name),
            h('text', { staticStyle: S('g-group-count') }, count + ' 个场景')
          ])
        ]);
      });
      bodyContent = h('div', { staticStyle: S('g-group-viewport') }, [
        h('text', { staticStyle: S('g-group-hint') }, '轻触分类卡片，进入场景鉴赏与差分切换'),
        h('div', { staticStyle: S('g-group-row') }, sGroupCards)
      ]);
    } else {
      var curScenes = activeSceneList(vm);
      if (!curScenes.length) {
        bodyContent = h('div', { staticStyle: S('g-empty-pane') }, [
          h('text', { staticStyle: S('g-empty-text') }, '暂无场景数据')
        ]);
      } else {
        var sCards = curScenes.map(function (sc) {
          return h('div', {
            key: sc.id,
            staticStyle: S('g-cg-card'),
            on: { click: function () { vm.openFullscreenScene(sc.idx); } }
          }, [
            h('image', {
              staticStyle: S('g-cg-card-img'),
              attrs: { src: sceneVariantSrc(sc, 0), resize: 'contain' }
            }),
            h('div', { staticStyle: S('g-cg-card-footer') }, [
              h('text', { staticStyle: S('g-cg-card-code') }, sc.title || sc.id)
            ])
          ]);
        });
        bodyContent = h('div', {
          staticStyle: S('g-scroll-viewport'),
          on: {
            touchstart: function (e) { vm.onGalleryTouchStart(e); },
            touchmove: function (e) { vm.onGalleryTouchMove(e); },
            touchend: function () { vm.onGalleryTouchEnd(); }
          }
        }, [
          SCENE_GROUPS.length ? h('div', {
            staticStyle: S('g-sub-nav'),
            on: { click: function () { vm.backToSceneGroups(); } }
          }, [
            h('text', { staticStyle: S('g-sub-nav-text') }, '‹ 返回分类选择')
          ]) : null,
          h('div', {
            staticStyle: S('g-scroll-list', {
              left: (vm.galleryPanX || 0) + 'px',
              width: (curScenes.length * 186 + 40) + 'px'
            })
          }, sCards)
        ]);
      }
    }
  }

  // TAB 3: 立绘鉴赏
  if (tab === 'stand') {
    if (!STAND_CHARS.length) {
      bodyContent = h('div', { staticStyle: S('g-empty-pane') }, [
        h('text', { staticStyle: S('g-empty-text') }, '暂无立绘数据')
      ]);
    } else if (!vm.galleryStandChar) {
      var standCards = STAND_CHARS.map(function (item) {
        return h('div', {
          key: item.key,
          staticStyle: S('g-group-card'),
          on: { click: function () { vm.selectStandChar(item.key); } }
        }, [
          h('image', {
            staticStyle: S('g-stand-group-img'),
            attrs: { src: standSrc(item, 0, 0), resize: 'contain' }
          }),
          h('div', { staticStyle: S('g-group-info') }, [
            h('text', { staticStyle: S('g-group-name') }, item.name || item.key),
            h('text', { staticStyle: S('g-group-count') }, (item.dresses ? item.dresses.length : 1) + ' 套服装')
          ])
        ]);
      });
      bodyContent = h('div', { staticStyle: S('g-group-viewport') }, [
        h('text', { staticStyle: S('g-group-hint') }, '轻触角色，进入服装与表情差分鉴赏'),
        h('div', { staticStyle: S('g-group-row') }, standCards)
      ]);
    } else {
      var standSelected = standMeta(vm.galleryStandChar);
      var dresses = (standSelected && standSelected.dresses) || ['default'];
      var dressButtons = dresses.map(function (dress, di) {
        var active = (vm.galleryStandDress || 0) === di;
        return h('div', {
          key: dress,
          staticStyle: active ? S('g-stand-dress-btn g-stand-dress-btn-active') : S('g-stand-dress-btn'),
          on: { click: function () { vm.setStandDress(di); } }
        }, [
          h('text', { staticStyle: S('g-stand-dress-text') }, dress)
        ]);
      });
      bodyContent = h('div', { staticStyle: S('g-stand-pane') }, [
        h('div', { staticStyle: S('g-stand-stage') }, [
          h('image', {
            staticStyle: S('g-stand-img'),
            attrs: { src: standSrc(standSelected, vm.galleryStandDress || 0, vm.galleryStandFace || 0), resize: 'contain' }
          })
        ]),
        h('div', { staticStyle: S('g-stand-controls') }, [
          h('div', { staticStyle: S('g-stand-nav') }, [
            h('div', {
              staticStyle: S('g-stand-back-btn'),
              on: { click: function () { vm.backToStandChars(); } }
            }, [
              h('text', { staticStyle: S('g-stand-back-text') }, '‹ 角色选择')
            ]),
            h('text', { staticStyle: S('g-stand-title') }, (standSelected ? standSelected.name : '') + ' · ' + dresses[vm.galleryStandDress || 0])
          ]),
          h('div', { staticStyle: S('g-stand-dress-row') }, dressButtons),
          h('div', { staticStyle: S('g-stand-face-row') }, [
            h('div', {
              staticStyle: S('g-stand-face-btn'),
              on: { click: function () { vm.changeStandFace(-1); } }
            }, [
              h('text', { staticStyle: S('g-stand-face-btn-text') }, '‹ 表情')
            ]),
            h('text', { staticStyle: S('g-stand-face-text') }, ((vm.galleryStandFace || 0) + 1) + ' / ' + ((standSelected && standSelected.faces) || 1)),
            h('div', {
              staticStyle: S('g-stand-face-btn'),
              on: { click: function () { vm.changeStandFace(1); } }
            }, [
              h('text', { staticStyle: S('g-stand-face-btn-text') }, '表情 ›')
            ])
          ])
        ])
      ]);
    }
  }

  // TAB 4: 音乐鉴赏
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

    bodyContent = h('div', {
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
