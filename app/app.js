// app.js —— 应用入口
import PageIndex from './index.js';
import PageShell from './shell.js';
import Component from './Component.js';
import { BasePage } from './BasePage.js';

function __loadModuleDefault(m) { return (m && typeof m === 'object' && m.default !== undefined) ? m.default : m; }
globalThis.__loadModuleDefault = __loadModuleDefault;
function vlog(m) { try { console.warn('[gal] App: ' + m); } catch (e) {} }
var __pages = {
  title: Component,
  game: Component,
  gallery: Component,
  flowchart: Component,
  afterstory: Component
};
class App extends $falcon.App {
  constructor() { super(); vlog('ctor'); }
  onLaunch(o) {
    super.onLaunch(o || {});
    this.setViewPort(800);
    $falcon.useDefaultBasePageClass(BasePage);
    vlog('onLaunch ok, viewport=800');
  }
  onShow() { super.onShow(); vlog('onShow'); }
  onHide() { super.onHide(); vlog('onHide'); }
  onDestroy() { super.onDestroy(); vlog('onDestroy'); }
}
App.meta = {
  name: 'GAL Dictionary Pen Engine', version: '1.0.0', isSingleJsBundle: false,
  pages: {
    title: 'pages/title/title.vue',
    game: 'pages/game/game.vue',
    gallery: 'pages/gallery/gallery.vue',
    flowchart: 'pages/flowchart/flowchart.vue',
    afterstory: 'pages/afterstory/afterstory.vue'
  },
  options: { style: { lessPaths: ['styles'] } },
};
$falcon.__pages = __pages;
$falcon.__loadModuleDefault = __loadModuleDefault;
$falcon.__KEYFRAMES = $falcon.__KEYFRAMES || {};
$falcon.__AppClazz = App;
vlog('registered');
export default App;
