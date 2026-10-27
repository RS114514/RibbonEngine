// pages/flowchart/flowchart.js —— 由拓扑数据驱动的局部流程图
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
var FC_ROUTE_SCENARIO = flowchart_data.routeScenario || {};
var FC_CHAPTER_START = flowchart_data.chapterStart || {};
var FC_EMA = flowchart_data.routeArt || {};

var allNodes = flowchart_data.nodes || [];
var allChoices = flowchart_data.choices || [];

for (var fc_i = 0; fc_i < allNodes.length; fc_i++) {
  FC_NODE_MAP[allNodes[fc_i].id] = allNodes[fc_i];
}
for (var fc_j = 0; fc_j < allChoices.length; fc_j++) {
  FC_CHOICE_MAP[allChoices[fc_j].id] = allChoices[fc_j];
}

function fcRawNext(node) {
  if (!node) return [];
  var chain = (flowchart_data.chain || {})[node.id];
  if (chain !== undefined) return Array.isArray(chain) ? chain : (chain ? [chain] : []);
  if (node.next) return Array.isArray(node.next) ? node.next : [node.next];
  return [];
}

// 选项与分支节点精简展示，避免在 800x220 小屏幕上密集堆叠普通台词节点
var FC_DISPLAY_NODES = [];
var FC_DISPLAY_MAP = {};
function addFcDisplayNode(node) {
  if (!node || FC_DISPLAY_MAP[node.id]) return;
  FC_DISPLAY_MAP[node.id] = true;
  FC_DISPLAY_NODES.push(node);
}

for (var fcDispI = 0; fcDispI < allNodes.length; fcDispI++) {
  var fcDispNode = allNodes[fcDispI];
  if (fcDispNode.type === 'select' || fcDispNode.type === 'branch' || fcDispNode.type === 'warp') {
    addFcDisplayNode(fcDispNode);
    if (fcDispNode.type === 'select') {
      var fcDispNext = fcRawNext(fcDispNode);
      for (var fcDispJ = 0; fcDispJ < fcDispNext.length; fcDispJ++) {
        var fcOptionNode = FC_NODE_MAP[fcDispNext[fcDispJ]];
        if (fcOptionNode && fcOptionNode.type === 'section') addFcDisplayNode(fcOptionNode);
      }
    }
  }
}

// 若无特定分支节点（例如测试或纯线性剧本），回退至展示全部节点
if (!FC_DISPLAY_NODES.length) {
  FC_DISPLAY_NODES = allNodes;
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
  for (var i = 0; i < FC_DISPLAY_NODES.length; i++) {
    var node = FC_DISPLAY_NODES[i];
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
    var fromNode = nodes[i];
    var nextIds = fcNextList(fromNode);
    for (j = 0; j < nextIds.length; j++) {
      var targetId = nextIds[j];
      if (local[targetId]) {
        edges.push({ from: fromNode.id, to: targetId });
        var nextDepth = depths[fromNode.id] + 1;
        if (nextDepth > depths[targetId]) depths[targetId] = nextDepth;
      }
    }
  }

  var levels = {};
  for (i = 0; i < nodes.length; i++) {
    var depth = depths[nodes[i].id] || 0;
    if (!levels[depth]) levels[depth] = [];
    levels[depth].push(nodes[i]);
  }

  var pos = {};
  var maxDepth = 0;
  var maxLane = 0;
  for (var d in levels) {
    if (!Object.prototype.hasOwnProperty.call(levels, d)) continue;
    var depthInt = parseInt(d, 10);
    if (depthInt > maxDepth) maxDepth = depthInt;
    var list = levels[d];
    for (var l = 0; l < list.length; l++) {
      if (l > maxLane) maxLane = l;
      pos[list[l].id] = {
        x: depthInt * FC_STEP_X,
        y: l * FC_STEP_Y
      };
    }
  }

  var totalW = Math.max(FC_VIEW_WIDTH, (maxDepth + 1) * FC_STEP_X + 24);
  var totalH = Math.max(FC_VIEW_HEIGHT, (maxLane + 1) * FC_STEP_Y + 16);

  var edgeLines = [];
  for (i = 0; i < edges.length; i++) {
    var pFrom = pos[edges[i].from];
    var pTo = pos[edges[i].to];
    if (!pFrom || !pTo) continue;
    var x1 = pFrom.x + FC_CARD_WIDTH;
    var y1 = pFrom.y + Math.floor(FC_CARD_HEIGHT / 2);
    var x2 = pTo.x;
    var y2 = pTo.y + Math.floor(FC_CARD_HEIGHT / 2);
    if (x2 <= x1) x2 = x1 + 16;
    edgeLines.push({
      key: edges[i].from + '_' + edges[i].to,
      x: x1,
      y: Math.min(y1, y2),
      w: Math.max(16, x2 - x1),
      h: Math.max(2, Math.abs(y2 - y1) + 2)
    });
  }

  return { pos: pos, edges: edgeLines, w: totalW, h: totalH };
}

export function fcNodeTarget(node) {
  if (!node) return null;
  var scenario = node.scenario || FC_ROUTE_SCENARIO[node.route] || 'main';
  var line = node.targetLine;
  if (!fcValidLine(line) && FC_CHAPTER_START[scenario] && node.chapter) {
    var mapped = FC_CHAPTER_START[scenario][node.chapter];
    if (fcValidLine(mapped)) line = mapped;
  }
  if (!fcValidLine(line)) return null;
  return { scenario: scenario, line: line };
}

export var flowchartMethods = {
  initFlowchart: function () {
    this.flowPanX = 0;
    this.flowPanY = 0;
    this.flowPanMaxX = 0;
    this.flowPanMaxY = 0;
    this.flowNotice = '';
    this._fcStartX = 0;
    this._fcStartY = 0;
    this._fcStartPanX = 0;
    this._fcStartPanY = 0;
    this._fcMoved = false;
    if (!this.flowRoute || FC_ROUTES.indexOf(this.flowRoute) < 0) {
      this.flowRoute = FC_ROUTES.length ? FC_ROUTES[0] : '';
    }
    var chapters = fcChapters(this.flowRoute);
    if (this.flowChapterIndex >= chapters.length) {
      this.flowChapterIndex = 0;
    }
    this.updateFlowPanMax();
  },

  updateFlowPanMax: function () {
    var nodes = this.currentChapterNodes();
    var layout = fcLayout(nodes);
    this.flowPanMaxX = Math.max(0, layout.w - FC_VIEW_WIDTH);
    this.flowPanMaxY = Math.max(0, layout.h - FC_VIEW_HEIGHT);
    this.flowPanX = fcClamp(this.flowPanX || 0, -this.flowPanMaxX, 0);
    this.flowPanY = fcClamp(this.flowPanY || 0, -this.flowPanMaxY, 0);
  },

  currentChapterNodes: function () {
    var chapters = fcChapters(this.flowRoute);
    if (!chapters.length) return [];
    var ch = chapters[this.flowChapterIndex] || chapters[0];
    var out = [];
    for (var i = 0; i < FC_DISPLAY_NODES.length; i++) {
      var n = FC_DISPLAY_NODES[i];
      if (n.route === this.flowRoute && n.chapter === ch) out.push(n);
    }
    return out;
  },

  selectRoute: function (route) {
    if (FC_ROUTES.indexOf(route) < 0) return;
    this.flowRoute = route;
    this.flowChapterIndex = 0;
    this.flowPanX = 0;
    this.flowPanY = 0;
    this.flowSelectedNodeId = null;
    this.flowNotice = '';
    this.updateFlowPanMax();
  },

  prevChapter: function () {
    var chapters = fcChapters(this.flowRoute);
    if (!chapters.length) return;
    this.flowChapterIndex = (this.flowChapterIndex - 1 + chapters.length) % chapters.length;
    this.flowPanX = 0;
    this.flowPanY = 0;
    this.flowSelectedNodeId = null;
    this.flowNotice = '';
    this.updateFlowPanMax();
  },

  nextChapter: function () {
    var chapters = fcChapters(this.flowRoute);
    if (!chapters.length) return;
    this.flowChapterIndex = (this.flowChapterIndex + 1) % chapters.length;
    this.flowPanX = 0;
    this.flowPanY = 0;
    this.flowSelectedNodeId = null;
    this.flowNotice = '';
    this.updateFlowPanMax();
  },

  panFlow: function (dx, dy) {
    this.flowPanX = fcClamp((this.flowPanX || 0) + dx, -this.flowPanMaxX, 0);
    this.flowPanY = fcClamp((this.flowPanY || 0) + dy, -this.flowPanMaxY, 0);
  },

  jumpFromFlowchart: function (targetLine) {
    if (!fcValidLine(targetLine)) {
      this.flowNotice = '该节点未配置有效行号，无法跳转';
      return;
    }
    var target = null;
    if (this.flowSelectedNodeId && FC_NODE_MAP[this.flowSelectedNodeId]) {
      target = fcNodeTarget(FC_NODE_MAP[this.flowSelectedNodeId]);
    }
    var scenario = target ? target.scenario : (FC_ROUTE_SCENARIO[this.flowRoute] || 'main');
    var line = target ? target.line : targetLine;
    this.view = 'game';
    if (typeof this.initGame === 'function') {
      this.initGame(scenario, line);
    }
  },

  onFcCardClick: function (node) {
    if (this._fcMoved) return;
    this.flowSelectedNodeId = node.id;
    var target = fcNodeTarget(node);
    if (target) {
      this.flowNotice = '目标行：' + target.line + '（' + target.scenario + '）· 轻触底部即可跳转';
    } else {
      this.flowNotice = node.title + ' · 当前无跳转行号';
    }
  },

  onFcTouchStart: function (e) {
    if (e && e.changedTouches && e.changedTouches[0]) {
      var t = e.changedTouches[0];
      this._fcStartX = t.pageX || t.clientX || 0;
      this._fcStartY = t.pageY || t.clientY || 0;
      this._fcStartPanX = this.flowPanX || 0;
      this._fcStartPanY = this.flowPanY || 0;
      this._fcMoved = false;
    }
  },

  onFcTouchMove: function (e) {
    if (e && e.changedTouches && e.changedTouches[0]) {
      var t = e.changedTouches[0];
      var cx = t.pageX || t.clientX || 0;
      var cy = t.pageY || t.clientY || 0;
      var dx = cx - this._fcStartX;
      var dy = cy - this._fcStartY;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
        this._fcMoved = true;
      }
      this.flowPanX = fcClamp(this._fcStartPanX + dx, -this.flowPanMaxX, 0);
      this.flowPanY = fcClamp(this._fcStartPanY + dy, -this.flowPanMaxY, 0);
    }
  },

  onFcTouchEnd: function () {
    // 手势结束，状态自然保持
  }
};

export function renderFlowchart(vm, h) {
  var chapters = fcChapters(vm.flowRoute);
  var curChapter = chapters[vm.flowChapterIndex] || chapters[0] || 'CHAPTER --';
  var nodes = vm.currentChapterNodes();
  var layout = fcLayout(nodes);

  var emaList = FC_EMA[vm.flowRoute] || [];
  var emaIdx = vm.flowChapterIndex % Math.max(1, emaList.length);
  var emaArt = emaList.length ? coverUrl('ema/ema_' + emaList[emaIdx] + '.jpg') : titleBgUrl();

  var routeTabs = FC_ROUTES.map(function (r) {
    var active = r === vm.flowRoute;
    return h('div', {
      key: r,
      staticStyle: active ? S('fc-route-tab fc-route-tab-active') : S('fc-route-tab'),
      on: { click: function () { vm.selectRoute(r); } }
    }, [
      h('text', { staticStyle: S('fc-route-tab-text') }, r)
    ]);
  });

  var chapterIndicator = chapters.map(function (ch, idx) {
    var active = idx === vm.flowChapterIndex;
    return h('div', {
      key: ch + '_' + idx,
      staticStyle: active ? S('fc-dot fc-dot-active') : S('fc-dot'),
      on: { click: function () { vm.flowChapterIndex = idx; vm.updateFlowPanMax(); } }
    });
  });

  var edges = layout.edges.map(function (ed) {
    return h('div', {
      key: ed.key,
      staticStyle: S('fc-edge', {
        position: 'absolute',
        left: ed.x + 'px',
        top: ed.y + 'px',
        width: ed.w + 'px',
        height: ed.h + 'px',
        borderBottomWidth: '2px',
        borderBottomStyle: 'solid',
        borderBottomColor: '#d4af37'
      })
    });
  });

  var nodeCards = nodes.map(function (n) {
    var p = layout.pos[n.id] || { x: 0, y: 0 };
    var selected = vm.flowSelectedNodeId === n.id;
    var target = fcNodeTarget(n);
    var hasTarget = !!target;
    var cardClass = selected
      ? 'fc-card fc-card-active'
      : (hasTarget ? 'fc-card' : 'fc-card fc-card-disabled');

    return h('div', {
      key: n.id,
      staticStyle: S(cardClass, {
        position: 'absolute',
        left: p.x + 'px',
        top: p.y + 'px',
        width: FC_CARD_WIDTH + 'px',
        height: FC_CARD_HEIGHT + 'px'
      }),
      on: { click: function () { vm.onFcCardClick(n); } }
    }, [
      h('text', { staticStyle: S('fc-card-title') }, n.title || n.id),
      h('text', { staticStyle: S('fc-card-sub') }, hasTarget ? ('第 ' + target.line + ' 句') : '详情')
    ]);
  });

  var selectedNode = vm.flowSelectedNodeId ? FC_NODE_MAP[vm.flowSelectedNodeId] : null;
  var selectedTarget = selectedNode ? fcNodeTarget(selectedNode) : null;

  return h('div', { staticStyle: S('fc-root') }, [
    h('image', {
      staticStyle: S('fc-bg-img'),
      attrs: { src: emaArt, resize: 'cover' }
    }),
    h('div', { staticStyle: S('fc-header') }, [
      h('div', {
        staticStyle: S('fc-back-btn'),
        on: { click: function () { vm.view = 'title'; } }
      }, [
        h('text', { staticStyle: S('fc-back-btn-text') }, '‹ 返回主菜单')
      ]),
      h('div', { staticStyle: S('fc-nav-row') }, [
        h('div', {
          staticStyle: S('fc-page-btn'),
          on: { click: function () { vm.prevChapter(); } }
        }, [
          h('text', { staticStyle: S('fc-page-btn-text') }, '‹ 上一章')
        ]),
        h('text', { staticStyle: S('fc-chapter-title') }, curChapter),
        h('div', {
          staticStyle: S('fc-page-btn'),
          on: { click: function () { vm.nextChapter(); } }
        }, [
          h('text', { staticStyle: S('fc-page-btn-text') }, '下一章 ›')
        ])
      ]),
      h('div', { staticStyle: S('fc-dots-row') }, chapterIndicator)
    ]),

    h('div', { staticStyle: S('fc-body') }, [
      h('div', {
        staticStyle: S('fc-viewport'),
        on: {
          touchstart: function (e) { vm.onFcTouchStart(e); },
          touchmove: function (e) { vm.onFcTouchMove(e); },
          touchend: function () { vm.onFcTouchEnd(); }
        }
      }, [
        h('div', {
          staticStyle: S('fc-canvas', {
            left: (vm.flowPanX || 0) + 'px',
            top: (vm.flowPanY || 0) + 'px',
            width: layout.w + 'px',
            height: layout.h + 'px'
          })
        }, edges.concat(nodeCards))
      ]),
      h('div', { staticStyle: S('fc-routes-col') }, routeTabs)
    ]),

    h('div', { staticStyle: S('fc-footer') }, [
      h('text', { staticStyle: S('fc-footer-notice') }, vm.flowNotice || '轻触节点查看详情，轻触右侧按钮可直接跳转进入剧情'),
      selectedTarget ? h('div', {
        staticStyle: S('fc-jump-btn'),
        on: { click: function () { vm.jumpFromFlowchart(selectedTarget.line); } }
      }, [
        h('text', { staticStyle: S('fc-jump-btn-text') }, '跳转至本节 ›')
      ]) : null
    ])
  ]);
}
