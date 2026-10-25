// pages/flowchart/flowchart.js —— 由真实拓扑数据驱动的章节局部流程图
import { S, log } from '../../common.js';
import { FLOWCHART as flowchart_data } from '../../data/flowchart_data.js';
import { coverUrl, titleBgUrl } from '../../media.js';

var FC_VIEW_WIDTH = 688;
var FC_VIEW_HEIGHT = 128;
var FC_CARD_WIDTH = 148;
var FC_CARD_HEIGHT = 48;
var FC_STEP_X = 174;
var FC_STEP_Y = 58;
var FC_NODE_MAP = {};
var FC_CHOICE_MAP = {};
var FC_ROUTES = flowchart_data.routes || [];

for (var fc_i = 0; fc_i < flowchart_data.nodes.length; fc_i++) {
  FC_NODE_MAP[flowchart_data.nodes[fc_i].id] = flowchart_data.nodes[fc_i];
}
for (var fc_j = 0; fc_j < flowchart_data.choices.length; fc_j++) {
  FC_CHOICE_MAP[flowchart_data.choices[fc_j].id] = flowchart_data.choices[fc_j];
}

function fcValidLine(line) {
  return typeof line === 'number' && isFinite(line) && line >= 0 && Math.floor(line) === line;
}

function fcClamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function fcNextList(node) {
  var next = (flowchart_data.chain || {})[node.id];
  if (next === undefined) next = node.next;
  if (!next) return [];
  return Array.isArray(next) ? next : [next];
}

function fcChapters(route) {
  var chapters = [];
  var seen = {};
  for (var i = 0; i < flowchart_data.nodes.length; i++) {
    var node = flowchart_data.nodes[i];
    if (node.route === route && node.chapter && !seen[node.chapter]) {
      seen[node.chapter] = true;
      chapters.push(node.chapter);
    }
  }
  return chapters;
}

function fcLayout(nodes) {
  var local = {};
  var depths = {};
  var edges = [];
  var i;
  var j;
  for (i = 0; i < nodes.length; i++) {
    local[nodes[i].id] = true;
    depths[nodes[i].id] = 0;
  }
  for (i = 0; i < nodes.length; i++) {
    var next = fcNextList(nodes[i]);
    for (j = 0; j < next.length; j++) {
      if (local[next[j]]) edges.push({ from: nodes[i].id, to: next[j] });
    }
  }
  // 有向边松弛得到 DAG 层级；上限防止异常环导致死循环。
  for (i = 0; i < nodes.length; i++) {
    for (j = 0; j < edges.length; j++) {
      var candidate = depths[edges[j].from] + 1;
      if (candidate > depths[edges[j].to]) depths[edges[j].to] = candidate;
    }
  }
  var rows = {};
  var placed = {};
  var maxDepth = 0;
  var maxRows = 1;
  for (i = 0; i < nodes.length; i++) {
    var depth = depths[nodes[i].id];
    var row = rows[depth] || 0;
    rows[depth] = row + 1;
    placed[nodes[i].id] = {
      node: nodes[i],
      depth: depth,
      row: row,
      x: 12 + depth * FC_STEP_X,
      y: 10 + row * FC_STEP_Y
    };
    if (depth > maxDepth) maxDepth = depth;
    if (row + 1 > maxRows) maxRows = row + 1;
  }
  for (i = 0; i < edges.length; i++) {
    edges[i].source = placed[edges[i].from];
    edges[i].target = placed[edges[i].to];
    var chainCondition = (flowchart_data.chain || {})[edges[i].from + ':' + edges[i].to];
    if (chainCondition && chainCondition[0] === 'branch') {
      edges[i].label = chainCondition[1] || '分歧';
    }
  }
  var choiceMap = {};
  for (i = 0; i < nodes.length; i++) {
    if (nodes[i].type === 'select' && FC_CHOICE_MAP[nodes[i].id]) {
      var options = FC_CHOICE_MAP[nodes[i].id].options;
      for (j = 0; j < options.length; j++) choiceMap[options[j].targetNode] = options[j];
    }
  }
  for (i = 0; i < edges.length; i++) {
    var option = choiceMap[edges[i].to];
    var choice = FC_CHOICE_MAP[edges[i].source.node.id];
    if (option && choice && choice.id === edges[i].source.node.id) {
      edges[i].label = option.index + '. ' + option.text;
    }
  }
  return {
    placed: placed,
    edges: edges,
    width: 24 + (maxDepth + 1) * FC_STEP_X,
    height: 20 + maxRows * FC_STEP_Y
  };
}

function fcRefreshLayout(vm) {
  var nodes = vm.getFcChapterNodes();
  var layout = fcLayout(nodes);
  vm._fcLayout = layout;
  vm.flowPanMaxX = Math.max(0, layout.width - FC_VIEW_WIDTH);
  vm.flowPanMaxY = Math.max(0, layout.height - FC_VIEW_HEIGHT);
  vm.flowPanX = fcClamp(Number(vm.flowPanX) || 0, -vm.flowPanMaxX, 0);
  vm.flowPanY = fcClamp(Number(vm.flowPanY) || 0, -vm.flowPanMaxY, 0);
}

function fcEnsure(vm) {
  if (FC_ROUTES.indexOf(vm.flowRoute) < 0) vm.flowRoute = FC_ROUTES[0] || '';
  var chapters = fcChapters(vm.flowRoute);
  vm.flowChapterIndex = fcClamp(Number(vm.flowChapterIndex) || 0, 0, Math.max(0, chapters.length - 1));
  if (typeof vm.flowNotice !== 'string') vm.flowNotice = '轻触节点跳转；无行号节点仅查看详情';
}

function fcShortChapter(chapter) {
  if (chapter === 'EPILOGUE') return '尾声';
  return chapter.replace('CHAPTER ', '');
}

function fcRouteArt(vm) {
  var art = flowchart_data.routeArt && flowchart_data.routeArt[vm.flowRoute];
  return art ? coverUrl(art) : '';
}

function fcTypeName(type) {
  if (type === 'select') return '选项';
  if (type === 'branch') return '条件';
  if (type === 'warp') return '跳转';
  if (type === 'chapter') return '章节';
  return '剧情';
}

export var flowchartMethods = {
  initFlowchart: function () {
    this.flowPanX = 0;
    this.flowPanY = 0;
    this.flowRoute = FC_ROUTES[0] || '';
    this.flowChapterIndex = 0;
    this.flowSelectedNodeId = null;
    this.flowNotice = '轻触节点跳转；无行号节点仅查看详情';
    this._fcStartX = 0;
    this._fcStartY = 0;
    this._fcStartPanX = 0;
    this._fcStartPanY = 0;
    this._fcMoved = false;
    fcRefreshLayout(this);
  },
  getFcChapters: function () {
    fcEnsure(this);
    return fcChapters(this.flowRoute);
  },
  getFcChapterNodes: function () {
    fcEnsure(this);
    var chapter = fcChapters(this.flowRoute)[this.flowChapterIndex];
    var nodes = [];
    for (var i = 0; i < flowchart_data.nodes.length; i++) {
      var node = flowchart_data.nodes[i];
      if (node.route === this.flowRoute && node.chapter === chapter) nodes.push(node);
    }
    return nodes;
  },
  selectFcRoute: function (route) {
    if (FC_ROUTES.indexOf(route) < 0) return;
    this.flowRoute = route;
    this.flowChapterIndex = 0;
    this.flowSelectedNodeId = null;
    this.flowNotice = route + '线 · 请选择章节或节点';
    this.resetFcPan();
    fcRefreshLayout(this);
  },
  setFcChapter: function (index) {
    fcEnsure(this);
    var count = fcChapters(this.flowRoute).length;
    this.flowChapterIndex = fcClamp(Number(index) || 0, 0, Math.max(0, count - 1));
    this.flowSelectedNodeId = null;
    this.flowNotice = '章节 ' + fcChapters(this.flowRoute)[this.flowChapterIndex];
    this.resetFcPan();
    fcRefreshLayout(this);
  },
  selectFcChapter: function (chapter) {
    var index = this.getFcChapters().indexOf(chapter);
    if (index >= 0) this.setFcChapter(index);
  },
  prevFcChapter: function () {
    this.setFcChapter(this.flowChapterIndex - 1);
  },
  nextFcChapter: function () {
    this.setFcChapter(this.flowChapterIndex + 1);
  },
  activateFcNode: function (node) {
    if (!node || this._fcMoved) return;
    this.flowSelectedNodeId = node.id;
    if (fcValidLine(node.targetLine)) {
      this.jumpFromFlowchart(node.targetLine);
      return;
    }
    this.flowNotice = '章节详情 · ' + node.title + ' · 无有效行号，不可跳转';
  },
  onFcTouchStart: function (e) {
    if (e && e.changedTouches && e.changedTouches[0]) {
      var t = e.changedTouches[0];
      this._fcStartX = typeof t.pageX === 'number' ? t.pageX : (t.clientX || 0);
      this._fcStartY = typeof t.pageY === 'number' ? t.pageY : (t.clientY || 0);
      this._fcStartPanX = this.flowPanX || 0;
      this._fcStartPanY = this.flowPanY || 0;
      this._fcMoved = false;
    }
  },
  onFcTouchMove: function (e) {
    if (e && e.changedTouches && e.changedTouches[0]) {
      var t = e.changedTouches[0];
      var cx = typeof t.pageX === 'number' ? t.pageX : (t.clientX || 0);
      var cy = typeof t.pageY === 'number' ? t.pageY : (t.clientY || 0);
      var dx = cx - this._fcStartX;
      var dy = cy - this._fcStartY;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) this._fcMoved = true;
      this.flowPanX = fcClamp(this._fcStartPanX + dx, -(this.flowPanMaxX || 0), 0);
      this.flowPanY = fcClamp(this._fcStartPanY + dy, -(this.flowPanMaxY || 0), 0);
    }
  },
  onFcTouchEnd: function () {
    var self = this;
    setTimeout(function () { self._fcMoved = false; }, 120);
  },
  panFcBy: function (dx, dy) {
    this.flowPanX = fcClamp((this.flowPanX || 0) + dx, -(this.flowPanMaxX || 0), 0);
    this.flowPanY = fcClamp((this.flowPanY || 0) + dy, -(this.flowPanMaxY || 0), 0);
  },
  resetFcPan: function () {
    this.flowPanX = 0;
    this.flowPanY = 0;
  },
  jumpFromFlowchart: function (line) {
    if (this._fcMoved || !fcValidLine(line)) return;
    log('jump from flowchart to line ' + line);
    this.currentScenario = 'main';
    this.currentScenarioData = null;
    this.view = 'game';
    if (typeof this.initGame === 'function') this.initGame('main', line);
  },
  returnToTitleFromFc: function () {
    this.view = 'title';
    if (typeof this.initTitle === 'function') this.initTitle();
  }
};

function fcText(h, style, value) {
  return h('text', { staticStyle: S(style) }, value);
}

function fcButton(h, style, label, action) {
  return h('div', { staticStyle: S(style), on: { click: action } }, [fcText(h, style + '-text', label)]);
}

function fcRenderEdge(vm, h, edge) {
  if (!edge.source || !edge.target || edge.target.depth <= edge.source.depth) return null;
  var x1 = edge.source.x + FC_CARD_WIDTH;
  var x2 = edge.target.x;
  var y1 = edge.source.y + FC_CARD_HEIGHT / 2;
  var y2 = edge.target.y + FC_CARD_HEIGHT / 2;
  var middle = x1 + (x2 - x1) / 2;
  var children = [
    h('div', { staticStyle: S('fc-edge-h', { left: x1 + 'px', top: y1 + 'px', width: (middle - x1) + 'px' }) }),
    h('div', { staticStyle: S('fc-edge-v', { left: middle + 'px', top: Math.min(y1, y2) + 'px', height: Math.max(1, Math.abs(y2 - y1)) + 'px' }) }),
    h('div', { staticStyle: S('fc-edge-h', { left: middle + 'px', top: y2 + 'px', width: (x2 - middle) + 'px' }) }),
    h('text', { staticStyle: S('fc-arrow', { left: (x2 - 7) + 'px', top: (y2 - 8) + 'px' }) }, '›')
  ];
  if (edge.label) {
    children.push(h('text', {
      staticStyle: S('fc-edge-label', { left: (x1 - 42) + 'px', top: (Math.min(y1, y2) - 13) + 'px' })
    }, edge.label));
  }
  return h('div', { staticStyle: S('fc-edge') }, children);
}

function fcRenderNode(vm, h, placed) {
  var node = placed.node;
  var selected = vm.flowSelectedNodeId === node.id;
  var style = 'fc-node fc-node-' + node.type + (selected ? ' fc-node-selected' : '');
  var line = fcValidLine(node.targetLine) ? ('第 ' + node.targetLine + ' 句') : '仅详情 · 禁跳';
  return h('div', {
    staticStyle: S(style, { left: placed.x + 'px', top: placed.y + 'px' }),
    on: { click: function () { vm.activateFcNode(node); } }
  }, [
    h('div', { staticStyle: S('fc-node-top') }, [
      fcText(h, 'fc-node-type', fcTypeName(node.type)),
      fcText(h, 'fc-node-line', line)
    ]),
    fcText(h, 'fc-node-title', node.title || node.id)
  ]);
}

export function renderFlowchart(vm, h) {
  if (!FC_ROUTES.length || !(flowchart_data.nodes && flowchart_data.nodes.length)) {
    return h('div', { staticStyle: S('fc-root') }, [
      h('image', { staticStyle: S('fc-bg-img'), attrs: { src: titleBgUrl() } }),
      h('div', { staticStyle: S('fc-header') }, [
        fcText(h, 'fc-title', '剧情流程图'),
        fcButton(h, 'fc-back', '返回标题', function () { vm.returnToTitleFromFc(); })
      ]),
      h('div', { staticStyle: S('fc-notice') }, '未找到流程图数据，请先按 app/data/README.md 生成 flowchart_data.js')
    ]);
  }
  fcEnsure(vm);
  if (!vm._fcLayout) fcRefreshLayout(vm);
  var chapters = vm.getFcChapters();
  var chapter = chapters[vm.flowChapterIndex];
  var layout = vm._fcLayout;
  var progressChildren = [];
  var progressMax = Math.max(0, chapters.length * 60 - 672);
  var progressX = -fcClamp(vm.flowChapterIndex * 60 - 306, 0, progressMax);
  for (var i = 0; i < chapters.length; i++) {
    (function (name, index) {
      progressChildren.push(h('div', {
        staticStyle: S(index === vm.flowChapterIndex ? 'fc-progress fc-progress-active' : 'fc-progress', { left: (index * 60) + 'px' }),
        on: { click: function () { vm.selectFcChapter(name); } }
      }, [fcText(h, 'fc-progress-text', fcShortChapter(name))]));
    })(chapters[i], i);
  }

  var graphChildren = [];
  for (var e = 0; e < layout.edges.length; e++) {
    var edgeView = fcRenderEdge(vm, h, layout.edges[e]);
    if (edgeView) graphChildren.push(edgeView);
  }
  var nodes = vm.getFcChapterNodes();
  for (var n = 0; n < nodes.length; n++) graphChildren.push(fcRenderNode(vm, h, layout.placed[nodes[n].id]));

  var routeButtons = [];
  for (var r = 0; r < FC_ROUTES.length; r++) {
    (function (route) {
      routeButtons.push(h('div', {
        staticStyle: S(route === vm.flowRoute ? 'fc-route fc-route-active' : 'fc-route'),
        on: { click: function () { vm.selectFcRoute(route); } }
      }, [fcText(h, 'fc-route-text', route)]));
    })(FC_ROUTES[r]);
  }

  return h('div', { staticStyle: S('fc-root') }, [
    h('image', { staticStyle: S('fc-bg-img'), attrs: { src: titleBgUrl() } }),
    h('div', { staticStyle: S('fc-header') }, [
      fcText(h, 'fc-title', '剧情流程图'),
      fcText(h, 'fc-header-chapter', vm.flowRoute + ' · ' + chapter + ' · ' + (vm.flowChapterIndex + 1) + '/' + chapters.length),
      fcButton(h, 'fc-back', '返回标题', function () { vm.returnToTitleFromFc(); })
    ]),
    h('div', { staticStyle: S('fc-progress-viewport') }, [
      h('div', { staticStyle: S('fc-progress-canvas', { left: progressX + 'px', width: (chapters.length * 60) + 'px' }) }, progressChildren)
    ]),
    h('div', {
      staticStyle: S('fc-viewport'),
      on: {
        touchstart: function (event) { vm.onFcTouchStart(event); },
        touchmove: function (event) { vm.onFcTouchMove(event); },
        touchend: function () { vm.onFcTouchEnd(); }
      }
    }, [
      h('div', {
        staticStyle: S('fc-canvas', {
          left: (vm.flowPanX || 0) + 'px', top: (vm.flowPanY || 0) + 'px',
          width: layout.width + 'px', height: layout.height + 'px'
        })
      }, graphChildren)
    ]),
    h('div', { staticStyle: S('fc-toolbar') }, [
      fcButton(h, 'fc-chapter-button', '上一章', function () { vm.prevFcChapter(); }),
      fcButton(h, 'fc-chapter-button', '下一章', function () { vm.nextFcChapter(); }),
      fcText(h, 'fc-notice', vm.flowNotice),
      fcButton(h, 'fc-pan-button', '←', function () { vm.panFcBy(70, 0); }),
      fcButton(h, 'fc-pan-button', '→', function () { vm.panFcBy(-70, 0); }),
      fcButton(h, 'fc-pan-button', '↑', function () { vm.panFcBy(0, 45); }),
      fcButton(h, 'fc-pan-button', '↓', function () { vm.panFcBy(0, -45); }),
      fcButton(h, 'fc-reset', '复位', function () { vm.resetFcPan(); })
    ]),
    h('div', { staticStyle: S('fc-sidebar') }, [
      h('div', { staticStyle: S('fc-route-list') }, routeButtons),
      h('div', { staticStyle: S('fc-route-art') }, [
        fcRouteArt(vm) ? h('image', { staticStyle: S('fc-route-ema'), attrs: { src: fcRouteArt(vm) } }) : null,
        fcText(h, 'fc-route-caption', vm.flowRoute)
      ])
    ])
  ]);
}
