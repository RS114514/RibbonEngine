// root.js —— 根组件（构建后为 Component.js.bin）
import { titleMethods, renderTitle } from './pages/title/title.js';
import { gameMethods, renderGame } from './pages/game/game.js';
import { galleryMethods, renderGallery } from './pages/gallery/gallery.js';
import { flowchartMethods, renderFlowchart } from './pages/flowchart/flowchart.js';
import { afterstoryMethods, renderAfterstory } from './pages/afterstory/afterstory.js';
import { getGal, log } from './common.js';

var methods = {
  onShow: function () {
    log('root onShow, view=' + this.view);
    if (this.view === 'title' && typeof this.initTitle === 'function') {
      this.initTitle();
    } else if (this.view === 'game' && typeof this.initGame === 'function') {
      this.initGame();
    } else if (this.view === 'flowchart' && typeof this.initFlowchart === 'function') {
      this.initFlowchart();
    } else if (this.view === 'afterstory' && typeof this.initAfterStory === 'function') {
      this.initAfterStory();
    }
  },
  onHide: function () {
    var G = getGal();
    if (G) {
      G.stopVoice();
    }
  },
  onUnload: function () {
    var G = getGal();
    if (G) {
      G.stopVoice();
      G.stopBgm();
      G.stopVideo();
    }
  }
};

var k;
for (k in titleMethods) methods[k] = titleMethods[k];
for (k in gameMethods) methods[k] = gameMethods[k];
for (k in galleryMethods) methods[k] = galleryMethods[k];
for (k in flowchartMethods) methods[k] = flowchartMethods[k];
for (k in afterstoryMethods) methods[k] = afterstoryMethods[k];

export default {
  name: 'index',
  data: function () {
    return {
      view: 'title', // 'title' | 'game' | 'gallery' | 'flowchart' | 'afterstory'
      bgmOn: true,
      bgmVolume: 0.8,
      titleModalType: '',
      titleSaves: {},
      currentScenario: 'main',
      currentScenarioData: null,
      currentLine: 0,
      currentBgm: '',
      bgmSuspendedForVoice: false,
      hasVoice: false,
      autoPlay: false,
      autoTimer: null,
      skipMode: false,
      zoomMode: false,
      gameZoomIndex: 0,
      gameImgPanX: 0,
      gameImgPanY: 0,
      historyFocusIndex: 0,
      modalType: '', // '' | 'save' | 'load' | 'menu' | 'history'
      modalSaves: {},
      savePage: 0,
      selectedSlot: 1,
      confirmModal: null,
      dataError: '',
      titleSavePage: 0,
      titleSelectedSlot: 1,
      titleConfirmModal: null,
      titleScrollY: 0,
      galleryTab: 'cg', // 'cg' | 'bgm'
      galleryPanX: 0,
      galleryCgFullscreen: false,
      galleryCgIndex: 0,
      galleryZoomIndex: 0,
      galleryImgPanX: 0,
      galleryImgPanY: 0,
      galleryPlayingBgm: '',
      galleryBgmIndex: 0,
      flowPanX: 0,
      flowPanY: 0,
      flowPanMaxX: 0,
      flowPanMaxY: 0,
      flowRoute: '',
      flowChapterIndex: 0,
      flowSelectedNodeId: null,
      flowNotice: '',
      activeChoice: null,
      choiceNotice: '',
      choiceSelections: {},
      choiceFlags: {},
      afterPanX: 0,
      selectedAfterHeroine: ''
    };
  },
  methods: methods,
  render: function (h) {
    if (this.view === 'game') {
      return renderGame(this, h);
    } else if (this.view === 'gallery') {
      return renderGallery(this, h);
    } else if (this.view === 'flowchart') {
      return renderFlowchart(this, h);
    } else if (this.view === 'afterstory') {
      return renderAfterstory(this, h);
    }
    return renderTitle(this, h);
  }
};
