// Run: node --experimental-vm-modules --test tools/test_gallery_ui.mjs
// Real gallery, media, storage and data modules; only the native common.js boundary is replaced.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const cssText = await readFile(new URL('app/pages/gallery/gallery.css', root), 'utf8');
const source = await readFile(new URL('app/pages/gallery/gallery.js', root), 'utf8');
const styles = {};
const camel = key => key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
for (const rule of cssText.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const declarations = {};
  for (const declaration of rule[2].split(';')) {
    const colon = declaration.indexOf(':');
    if (colon >= 0) declarations[camel(declaration.slice(0, colon).trim())] = declaration.slice(colon + 1).trim();
  }
  for (const selector of rule[1].split(',')) {
    const match = selector.trim().match(/^\.([\w-]+)$/);
    if (match) styles[match[1]] = { ...styles[match[1]], ...declarations };
  }
}
const classes = new WeakMap();
function S(names, extra) {
  const result = Object.assign({}, ...names.split(/\s+/).map(name => styles[name] || {}), extra);
  classes.set(result, names.split(/\s+/));
  return result;
}
let settings = {};
let calls = [];
const device = {
  readText() { return JSON.stringify(settings); },
  playBgm(path, loop, volume) { calls.push({ path, loop, volume }); },
  stopBgm() { calls.push({ stop: true }); }
};
const context = createContext({ console, setTimeout, clearTimeout });
const cache = new Map();
const commonUrl = new URL('app/common.js', root).href;
cache.set(commonUrl, new SyntheticModule(['S', 'log', 'getGal'], function () {
  this.setExport('S', S);
  this.setExport('log', () => {});
  this.setExport('getGal', () => device);
}, { context, identifier: commonUrl }));
async function load(url) {
  if (!cache.has(url)) cache.set(url, new SourceTextModule(await readFile(new URL(url), 'utf8'), { context, identifier: url }));
  return cache.get(url);
}
const entry = await load(new URL('app/pages/gallery/gallery.js', root).href);
await entry.link((specifier, parent) => load(new URL(specifier, parent.identifier).href));
await entry.evaluate();
const mediaModule = await load(new URL('app/media.js', root).href);
if (mediaModule.status === 'unlinked') await mediaModule.link(() => { throw new Error('Unexpected media dependency'); });
if (mediaModule.status === 'linked') await mediaModule.evaluate();
const { galleryMethods, renderGallery } = entry.namespace;
const { bgmPath, cgUrl, characterAssetName } = mediaModule.namespace;
const cgs = cache.get(new URL('app/data/gallery_cgs.js', root).href).namespace.gallery_cgs;
const scenes = cache.get(new URL('app/data/gallery_scenes.js', root).href).namespace.gallery_scenes;
const data = cache.get(new URL('app/data/gallery_data.js', root).href).namespace.GALLERY;
const heroes = ['nene', 'meguru', 'tsumugi', 'touko', 'wakana'];

function makeVm() {
  settings = { bgmEnabled: true, bgmVolume: 0.37 };
  calls = [];
  const vm = Object.assign(Object.create(galleryMethods), { view: 'gallery', updates: 0, $forceUpdate() { this.updates++; } });
  vm.initGallery();
  return vm;
}
function h(tag, props = {}, children = []) {
  return { tag, props, style: props.staticStyle || {}, children: (Array.isArray(children) ? children : [children]).filter(item => item != null) };
}
function walk(node) { return typeof node === 'object' ? [node, ...node.children.flatMap(walk)] : []; }
function has(node, name) { return (classes.get(node.style) || []).includes(name); }
function nodes(tree, name) { return walk(tree).filter(node => has(node, name)); }
function one(tree, name) { const found = nodes(tree, name); assert.equal(found.length, 1, `one ${name}`); return found[0]; }
function text(node) { return typeof node === 'string' ? node : node.children.map(text).join(''); }
function click(node) { assert.equal(typeof node?.props.on?.click, 'function', 'rendered click handler exists'); node.props.on.click(); }
function clickText(tree, label) {
  const node = walk(tree).find(node => node.props.on?.click && text(node) === label);
  assert.ok(node, `visible control: ${label}`);
  click(node);
}
const touch = (x, y = 100) => ({ changedTouches: [{ pageX: x, pageY: y }] });
function drag(node, from, to) {
  assert.equal(typeof node.props.on?.touchstart, 'function', 'touch start is connected');
  assert.equal(typeof node.props.on?.touchmove, 'function', 'touch move is connected');
  node.props.on.touchstart(touch(...from));
  node.props.on.touchmove(touch(...to));
  node.props.on.touchend?.();
}
const px = value => parseFloat(value) || 0;
const label = node => (classes.get(node.style) || [node.tag]).join(' ');

// Small fixed-pixel flex/absolute layout checker, not a browser/Falcon emulator.
// Content-box accounting is conservative: padding/borders must not enlarge a control past its clip.
function measure(node) {
  const s = node.style;
  const font = px(s.fontSize) || 12;
  const w = s.width !== undefined ? px(s.width) : (node.tag === 'text' ? text(node).length * font : 0);
  const ht = s.height !== undefined ? px(s.height) : (node.tag === 'text' ? font + 2 : 0);
  return { w: w + px(s.paddingLeft) + px(s.paddingRight) + px(s.borderLeftWidth) + px(s.borderRightWidth),
    h: ht + px(s.paddingTop) + px(s.paddingBottom) + px(s.borderTopWidth) + px(s.borderBottomWidth) };
}
function intersect(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) };
}
function layout(tree) {
  const boxes = new Map();
  function place(node, x, y, clip) {
    const s = node.style, size = measure(node), box = { x, y, ...size };
    boxes.set(node, { ...box, visible: intersect(box, clip) });
    const nextClip = s.overflow === 'hidden' ? intersect(clip, box) : clip;
    const children = node.children.filter(item => typeof item === 'object');
    const row = s.flexDirection === 'row';
    const flow = children.filter(child => child.style.position !== 'absolute');
    const innerW = px(s.width), innerH = px(s.height);
    const used = flow.reduce((sum, child) => sum + measure(child)[row ? 'w' : 'h'] + px(child.style[row ? 'marginLeft' : 'marginTop']) + px(child.style[row ? 'marginRight' : 'marginBottom']), 0);
    const free = Math.max(0, (row ? innerW : innerH) - used);
    const gap = s.justifyContent === 'space-between' && flow.length > 1 ? free / (flow.length - 1) : s.justifyContent === 'space-around' && flow.length ? free / flow.length : 0;
    let cursor = s.justifyContent === 'center' ? free / 2 : s.justifyContent === 'space-around' ? gap / 2 : 0;
    for (const child of children) {
      const cs = child.style, m = measure(child);
      let cx, cy;
      if (cs.position === 'absolute') {
        cx = cs.left !== undefined ? px(cs.left) : cs.right !== undefined ? size.w - px(cs.right) - m.w : 0;
        cy = cs.top !== undefined ? px(cs.top) : cs.bottom !== undefined ? size.h - px(cs.bottom) - m.h : 0;
      } else {
        cursor += px(cs[row ? 'marginLeft' : 'marginTop']);
        const cross = s.alignItems === 'center' ? ((row ? innerH : innerW) - m[row ? 'h' : 'w']) / 2 : 0;
        cx = row ? cursor : cross + px(cs.marginLeft);
        cy = row ? cross + px(cs.marginTop) : cursor;
        cursor += m[row ? 'w' : 'h'] + px(cs[row ? 'marginRight' : 'marginBottom']) + gap;
      }
      place(child, x + px(s.paddingLeft) + px(s.borderLeftWidth) + cx, y + px(s.paddingTop) + px(s.borderTopWidth) + cy, nextClip);
    }
  }
  place(tree, 0, 0, { x: 0, y: 0, w: 800, h: 220 });
  return boxes;
}
function checkLayout(tree, partialCards = false) {
  const boxes = layout(tree);
  assert.equal(px(tree.style.width), 800);
  assert.equal(px(tree.style.height), 220);
  assert.equal(tree.style.overflow, 'hidden', 'root clips to the screen');
  const clickable = [];
  for (const node of walk(tree)) {
    const b = boxes.get(node);
    for (const name of classes.get(node.style) || []) assert.ok(styles[name], `missing CSS: ${name}`);
    if (node.tag === 'div') {
      assert.equal(node.style.display, 'flex', `${label(node)} explicit flex`);
      assert.ok(['row', 'column'].includes(node.style.flexDirection), `${label(node)} explicit direction`);
      assert.ok(b.w > 0 && b.h > 0 && b.w <= 800 && b.h <= 220, `${label(node)} bounded container ${b.w}x${b.h}`);
    }
    if (node.props.on?.click) {
      if (!(partialCards && /g-(cg|bgm)-card/.test(label(node)))) {
        assert.ok(Math.abs(b.w - b.visible.w) < 0.01 && Math.abs(b.h - b.visible.h) < 0.01, `${label(node)} control clipped at ${b.x},${b.y} ${b.w}x${b.h}`);
      }
      if (b.visible.w && b.visible.h) clickable.push([node, b.visible]);
    }
  }
  for (let i = 0; i < clickable.length; i++) for (let j = i + 1; j < clickable.length; j++) {
    const overlap = intersect(clickable[i][1], clickable[j][1]);
    assert.ok(!overlap.w || !overlap.h, `controls overlap: ${label(clickable[i][0])} / ${label(clickable[j][0])}`);
  }
  return boxes;
}
function render(vm) { return renderGallery(vm, h); }
function imageIn(viewport) { return walk(viewport).find(node => node.tag === 'image'); }
function checkImagePan(vm, viewportName, zoomLabel, imageWidth, imageHeight) {
  let tree = render(vm), viewport = one(tree, viewportName), image = imageIn(viewport);
  assert.equal(px(image.style.left), Math.round((px(viewport.style.width) - imageWidth) / 2), `${zoomLabel}: centered in actual viewport`);
  assert.equal(px(image.style.top), Math.round((220 - imageHeight) / 2));
  assert.equal(px(image.style.width), imageWidth);
  assert.equal(px(image.style.height), imageHeight);
  checkLayout(tree);
  drag(viewport, [300, 100], [-5000, -5000]);
  image = imageIn(one(render(vm), viewportName));
  assert.equal(px(image.style.left), imageWidth > px(viewport.style.width) ? px(viewport.style.width) - imageWidth : Math.round((px(viewport.style.width) - imageWidth) / 2));
  assert.equal(px(image.style.top), Math.min(0, 220 - imageHeight));
  drag(one(render(vm), viewportName), [300, 100], [5000, 5000]);
  image = imageIn(one(render(vm), viewportName));
  assert.equal(px(image.style.left), imageWidth > px(viewport.style.width) ? 0 : Math.round((px(viewport.style.width) - imageWidth) / 2));
  assert.equal(px(image.style.top), 0);
}

test('all rendered style names exist and Falcon spacing/borders use longhand', () => {
  const missing = new Set();
  for (const match of source.matchAll(/\bS\('([^']+)'/g)) for (const name of match[1].split(/\s+/)) if (!styles[name]) missing.add(name);
  assert.deepEqual([...missing], [], 'JS/CSS contract');
  for (const [name, style] of Object.entries(styles)) for (const property of Object.keys(style)) {
    assert.ok(!/^(padding|margin|border|borderWidth|borderColor|borderStyle|borderTop|borderBottom|borderLeft|borderRight)$/.test(property), `${name}: unsupported shorthand ${property}`);
  }
});

test('all extracted CG families are grouped by their real route', () => {
  const counts = Object.fromEntries(heroes.map(key => [key, cgs.filter(c => c.group === key).length]));
  Object.assign(counts, { common: cgs.filter(c => c.group === 'main').length });
  assert.deepEqual(counts, { nene: 25, meguru: 18, tsumugi: 18, touko: 18, wakana: 9, common: 4 });
  assert.equal(cgs.length, 92);
  assert.equal(new Set(cgs.map(c => c.file)).size, cgs.length);
});

test('four tabs, all subgroups and stand controls stay visible without overlap', () => {
  const vm = makeVm();
  for (const [tab, title] of [['cg', 'CG 鉴赏'], ['scene', '场景回忆'], ['stand', '立绘鉴赏'], ['bgm', '音乐盒']]) {
    clickText(render(vm), title);
    assert.equal(vm.galleryTab, tab);
    checkLayout(render(vm));
    if (tab === 'cg' || tab === 'scene') {
      for (const key of tab === 'cg' ? [...heroes, 'common'] : heroes) {
        click(nodes(render(vm), 'g-group-card').find(node => node.props.key === key));
        assert.equal(vm[tab === 'cg' ? 'galleryCgGroup' : 'gallerySceneGroup'], key);
        checkLayout(render(vm));
        clickText(render(vm), '‹ 返回分类');
      }
    }
  }
});

test('CG paging and drag render bounded containers and preserve the selected real image', async () => {
  const vm = makeVm();
  vm.selectCgGroup('nene');
  const real = cgs.filter(item => item.group === 'nene');
  const seen = new Set();
  for (let page = 0; page < Math.ceil(real.length / 4); page++) {
    const tree = render(vm);
    checkLayout(tree);
    const cards = nodes(tree, 'g-cg-card');
    assert.deepEqual(cards.map(node => node.props.key), Array.from(real.slice(page * 4, page * 4 + 4), item => item.id));
    for (const card of cards) seen.add(card.props.key);
    if (cards.length) {
      click(cards[0]);
      assert.equal(imageIn(one(render(vm), 'gallery-fs-viewport')).props.attrs.src, cgUrl(real[page * 4].file));
      clickText(render(vm), '✕ 关闭');
    }
    clickText(render(vm), '▶');
  }
  assert.equal(seen.size, real.length);
  vm.setCgPage(-100);
  drag(one(render(vm), 'g-cg-scroll-viewport'), [700, 100], [300, 100]);
  checkLayout(render(vm), true);
  vm.openFullscreenCg(0);
  assert.equal(vm.galleryCgFullscreen, false, 'a drag is not a tap');
  await new Promise(resolve => setTimeout(resolve, 140));
  vm.onGalleryTouchStart(touch(100));
  vm.openFullscreenCg(0);
  assert.equal(vm.galleryCgFullscreen, true, 'the next deliberate tap opens');
});

test('CG zoom and pan use the real full-screen viewport, navigation resets and close returns', () => {
  const vm = makeVm();
  vm.selectCgGroup('nene');
  vm.openFullscreenCg(0);
  for (const [width, height, label] of [[391, 220, '1.0x'], [587, 330, '1.5x'], [782, 440, '2.0x'], [978, 550, '2.5x']]) {
    checkImagePan(vm, 'gallery-fs-viewport', label, width, height);
    clickText(render(vm), label);
  }
  clickText(render(vm), '›');
  assert.equal(vm.galleryCgIndex, 1);
  assert.equal(vm.galleryZoomIndex, 0);
  clickText(render(vm), '‹');
  assert.equal(vm.galleryCgIndex, 0);
  clickText(render(vm), '✕ 关闭');
  assert.equal(vm.galleryCgFullscreen, false);
  assert.equal(vm.galleryCgGroup, 'nene');
});

test('scene viewer supports zoom/drag, real variants, navigation and exit', () => {
  const vm = makeVm();
  vm.setGalleryTab('scene');
  vm.selectSceneGroup('nene');
  click(nodes(render(vm), 'g-cg-card')[0]);
  const real = scenes.filter(item => item.group === 'nene' || item.route === 'nene');
  assert.equal(imageIn(one(render(vm), 'gallery-fs-viewport')).props.attrs.src, cgUrl(real[0].variants[0]));
  clickText(render(vm), '1.0x');
  checkImagePan(vm, 'gallery-fs-viewport', 'scene 1.5x', 587, 330);
  vm.changeSceneExpr(1);
  assert.equal(vm.gallerySceneExpr, 1 % real[0].variants.length);
  clickText(render(vm), '›');
  assert.equal(vm.gallerySceneIndex, 1);
  assert.equal(vm.galleryZoomIndex, 0);
  assert.equal(vm.gallerySceneExpr, 0);
  clickText(render(vm), '‹');
  assert.equal(vm.gallerySceneIndex, 0);
  clickText(render(vm), '✕ 关闭');
  assert.equal(vm.gallerySceneFullscreen, false);
  assert.equal(vm.gallerySceneGroup, 'nene');
});

test('empty CG/scene groups do not open fabricated viewers', () => {
  const vm = makeVm();
  for (const tab of ['cg', 'scene']) {
    vm.setGalleryTab(tab);
    for (const key of tab === 'cg' ? [...heroes, 'common'] : heroes) {
      const list = tab === 'cg' ? cgs.filter(item => item.group === key || (key === 'common' && (!item.group || item.group === 'main'))) : scenes.filter(item => item.group === key || item.route === key);
      if (list.length) continue;
      vm[tab === 'cg' ? 'selectCgGroup' : 'selectSceneGroup'](key);
      assert.equal(nodes(render(vm), 'g-cg-card').length, 0);
      assert.match(text(render(vm)), /暂无/);
      vm[tab === 'cg' ? 'openFullscreenCg' : 'openFullscreenScene'](0);
      assert.equal(vm[tab === 'cg' ? 'galleryCgFullscreen' : 'gallerySceneFullscreen'], false);
    }
  }
});

test('five heroines keep all costumes, face wrapping, body mode and bounded full-screen stand controls', () => {
  const vm = makeVm();
  vm.setGalleryTab('stand');
  for (const hero of data.standChars) {
    click(nodes(render(vm), 'g-group-card').find(node => node.props.key === hero.key));
    for (const dress of hero.dresses) {
      clickText(render(vm), dress);
      checkLayout(render(vm));
      assert.ok(one(render(vm), 'g-stand-img').props.attrs.src.endsWith('/' + characterAssetName(hero.char, dress, 1)), hero.key + ':' + dress);
    }
    clickText(render(vm), '‹ 上一表情');
    assert.equal(vm.galleryStandFace, hero.faces - 1);
    clickText(render(vm), '下一表情 ›');
    assert.equal(vm.galleryStandFace, 0);
    clickText(render(vm), '全身');
    assert.match(one(render(vm), 'g-stand-img').props.attrs.src, /\/fg\//);
    clickText(render(vm), '半身');
    click(one(render(vm), 'g-stand-stage'));
    const viewport = walk(render(vm)).find(node => node.props.on?.touchmove);
    const image = imageIn(viewport);
    assert.equal(px(image.style.left), Math.round((px(viewport.style.width) - 391) / 2), 'stand center uses its 664px viewport');
    checkLayout(render(vm));
    clickText(render(vm), '< 上角色');
    assert.notEqual(vm.galleryStandChar, hero.key);
    clickText(render(vm), '下角色 >');
    assert.equal(vm.galleryStandChar, hero.key);
    const oldBg = vm.galleryStandBgIndex;
    clickText(render(vm), '换背景');
    assert.equal(vm.galleryStandBgIndex, (oldBg + 1) % 6);
    clickText(render(vm), '切半身');
    assert.match(imageIn(walk(render(vm)).find(node => node.props.on?.touchmove)).props.attrs.src, /\/fg\//);
    clickText(render(vm), '切全身');
    for (let i = 0; i < 3; i++) clickText(render(vm), '放大 +');
    drag(walk(render(vm)).find(node => node.props.on?.touchmove), [400, 100], [-5000, -5000]);
    const zoomed = imageIn(walk(render(vm)).find(node => node.props.on?.touchmove));
    assert.equal(px(zoomed.style.left), px(viewport.style.width) - 860);
    assert.equal(px(zoomed.style.top), -264);
    checkLayout(render(vm));
    clickText(render(vm), '缩小 -');
    assert.equal(px(imageIn(walk(render(vm)).find(node => node.props.on?.touchmove)).style.width), 704);
    clickText(render(vm), '重置');
    assert.equal(vm.galleryStandZoomIndex, 0);
    const updates = vm.updates;
    clickText(render(vm), '退出');
    assert.equal(vm.galleryStandFullscreen, false);
    assert.ok(vm.updates > updates, 'undeclared Falcon/Vue full-screen state explicitly refreshes');
    clickText(render(vm), '‹ 选角色');
  }
});

test('music pages expose all tracks, drag does not play, and playback honors real stored settings', async () => {
  const vm = makeVm();
  vm.setGalleryTab('bgm');
  const seen = new Set();
  for (let page = 0; page < Math.ceil(data.bgm.length / 6); page++) {
    const tree = render(vm);
    checkLayout(tree);
    const cards = nodes(tree, 'g-bgm-card');
    assert.deepEqual(cards.map(node => node.props.key), Array.from(data.bgm.slice(page * 6, page * 6 + 6), item => item.id));
    for (const card of cards) seen.add(card.props.key);
    click(cards[0]);
    assert.equal(calls.at(-1).path, bgmPath(data.bgm[page * 6].file));
    assert.equal(calls.at(-1).volume, 0.37);
    assert.equal(calls.at(-1).loop, true);
    assert.equal(nodes(render(vm), 'g-bgm-card-playing').length, 1);
    clickText(render(vm), '▶');
  }
  assert.equal(seen.size, data.bgm.length);
  drag(one(render(vm), 'g-bgm-scroll-viewport'), [700, 100], [300, 100]);
  checkLayout(render(vm), true);
  const before = calls.length;
  vm.playGalleryBgm(0);
  assert.equal(calls.length, before, 'drag release never starts a track');
  await new Promise(resolve => setTimeout(resolve, 140));
  vm.playGalleryBgm(0);
  clickText(render(vm), '暂停播放');
  assert.equal(vm.galleryPlayingBgm, '');
  assert.deepEqual(calls.at(-1), { stop: true });
  settings.bgmVolume = 0.22;
  clickText(render(vm), '继续播放');
  assert.equal(calls.at(-1).volume, 0.22);
  settings.bgmEnabled = false;
  vm.playGalleryBgm(1);
  assert.equal(vm.galleryPlayingBgm, '');
  assert.deepEqual(calls.at(-1), { stop: true });
  clickText(render(vm), '返回标题');
  assert.equal(vm.view, 'title');
  assert.deepEqual(calls.at(-1), { stop: true });
});

console.log(`Gallery UI regression: ${fileURLToPath(new URL('app/pages/gallery/gallery.js', root))}`);
