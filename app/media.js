// media.js —— 词典笔本地资源路径解析
// 默认所有资源位于 /userdisk/gal_data/ 下；支持自定义根目录。
// 数据文件只保存“资源基名”或“相对路径”，扩展名与根路径在这里统一处理。

export var ASSET_ROOT = '/userdisk/gal_data';

export function setAssetRoot(path) {
  if (path && typeof path === 'string') {
    ASSET_ROOT = path.replace(/\/+$/, '');
  }
}

var IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];
var VOICE_EXTS = ['.ogg', '.opus', '.wav'];
var BGM_EXTS = ['.opus', '.ogg', '.mp3', '.wav'];

function hasAnyExt(name, exts) {
  var lower = String(name || '').toLowerCase();
  for (var i = 0; i < exts.length; i++) {
    if (lower.slice(-exts[i].length) === exts[i]) return true;
  }
  return false;
}

function safeRelative(value) {
  var text = String(value || '').trim();
  if (!text || text.charAt(0) === '/' || text.indexOf('\0') >= 0 || text.indexOf('\\') >= 0) {
    return '';
  }
  var parts = text.split('/');
  for (var i = 0; i < parts.length; i++) {
    if (!parts[i] || parts[i] === '.' || parts[i] === '..') return '';
  }
  return text;
}

function withExt(name, defaultExt, exts) {
  var value = safeRelative(name);
  if (!value) return '';
  var list = exts || [defaultExt];
  return hasAnyExt(value, list) ? value : value + defaultExt;
}

export function fileUrl(path) {
  return 'file://' + path;
}

export function assetPath(kind, name, defaultExt) {
  var file = withExt(name, defaultExt || '.png', IMAGE_EXTS);
  return file ? ASSET_ROOT + '/' + kind + '/' + file : '';
}

export function bgPath(name) {
  return assetPath('bg', name, '.png');
}

export function bgmPath(name) {
  var file = withExt(name, '.opus', BGM_EXTS);
  return file ? ASSET_ROOT + '/bgm/' + file : '';
}

export function voicePath(name) {
  var file = withExt(name, '.ogg', VOICE_EXTS);
  return file ? ASSET_ROOT + '/voice/' + file : '';
}

export function cgPath(name) {
  return assetPath('cg', name, '.png');
}

export function fgPath(name) {
  return assetPath('fg', name, '.png');
}

export function sdPath(name) {
  return assetPath('sd', name, '.png');
}

export function fxPath(name) {
  return assetPath('fx', name, '.png');
}

export function sceneVariantPath(name) {
  return assetPath('scene', name, '.png');
}

// 封面/绘马插图路径
export function coverPath(name) {
  return assetPath('bg', name, '.jpg');
}

export function bgUrl(name) {
  var path = bgPath(name);
  return path ? fileUrl(path) : '';
}

export function bgmUrl(name) {
  var path = bgmPath(name);
  return path ? fileUrl(path) : '';
}

export function voiceUrl(name) {
  var path = voicePath(name);
  return path ? fileUrl(path) : '';
}

export function cgUrl(name) {
  var path = cgPath(name);
  return path ? fileUrl(path) : '';
}

export function fgUrl(name) {
  var path = fgPath(name);
  return path ? fileUrl(path) : '';
}

export function standPath(name) {
  return assetPath('stand', name, '.png');
}

export function standUrl(name) {
  var path = standPath(name);
  return path ? fileUrl(path) : '';
}

export function sdUrl(name) {
  var path = sdPath(name);
  return path ? fileUrl(path) : '';
}

export function fxUrl(name) {
  var path = fxPath(name);
  return path ? fileUrl(path) : '';
}

export function sceneVariantUrl(name) {
  var path = sceneVariantPath(name);
  return path ? fileUrl(path) : '';
}

export function coverUrl(name) {
  var path = coverPath(name);
  return path ? fileUrl(path) : '';
}

export function titleBgUrl() {
  return bgUrl('title_bg');
}

// 空值或黑屏标记不渲染背景
export function isBlackBg(name) {
  return !name || name === '__black__' || name === '画面_黒' || name === 'black';
}
