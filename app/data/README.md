# app/data 数据契约

本目录**不附带任何游戏剧本、角色名、章节名或资源清单**。除本 README 外，`app/data/` 下的
`story_data.js`、`flowchart_data.js`、`gallery_data.js` 都应由使用者用自己合法持有的游戏数据生成，
并且已被 `.gitignore` 忽略，不应提交到公开仓库。

生成工具：`tools/build_data.py`。完整流程见仓库根目录 `README.md`。

输入可以是：

```text
data_src/
├── story.json          # 或 main.jsonl + after/*.jsonl + afterstory.json
├── flowchart.json
└── gallery.json
```

也可以拆成：

```text
data_src/
├── main.jsonl
├── after/<key>.jsonl
├── afterstory.json
├── flowchart.json
└── gallery.json
```

`story.json` 的结构与下面第 2 节的 `STORY` 相同。生成的 `app/data/*.js`
已被 `.gitignore` 忽略，不应提交。

---

## 1. 当前范围

默认契约与页面覆盖：

- 共通线主剧本（`story_data.js` 的 `main` 数组）；
- 6 个后日谈（`story_data.js` 的 `after` 与 `afterMeta`）；
- 可选流程图拓扑（`flowchart_data.js`）；
- 可选鉴赏清单（`gallery_data.js`）。

**不包含各女主角个人线的全量剧本。** 个人线需要自己扩展 `main`/`after` 数据与流程图数据；
本仓库不会因为数据里出现更多剧本而自动变成“全量个人线”。

---

## 2. `story_data.js`

生成后的文件只导出两个变量：

```js
export var STORY = {
  main: [ /* 台词行数组 */ ],
  after: { /* key -> 台词行数组 */ },
  afterMeta: [ /* 后日谈卡片元数据 */ ],
  meta: { /* 引擎可选的全局元数据 */ }
};
```

### 2.1 台词行

每一行是长度 8 的数组：

```js
[
  lineId,     // number：建议严格等于数组下标，存档按数组下标恢复
  speaker,    // string：说话人；空字符串表示独白
  text,       // string：台词正文（由使用者从自己的正版数据中生成）
  voice,      // string|null：语音基名，不含路径，例如 "voice_0001"
  bg,         // string|null：背景基名，不含扩展名，例如 "bg_room_day"
  bgm,        // string|null：BGM 基名，不含路径，例如 "bgm_01"
  character,  // object|null：立绘信息，见下
  chapter     // string：章节标签，例如 "CHAPTER 1-1" 或 "AFTER 1"
]
```

约束：

- `text` 不得为空时建议保留占位；引擎会原样显示。
- `voice`、`bg`、`bgm` 只能是**基名/相对名**，不能包含 `/`、`\`、`..`、绝对路径或空字节。
- `voice` 最终解析为 `/userdisk/SenrenBanka/voice/<voice>.ogg`（也兼容 `.opus`/`.wav`）。
- `bg` 最终解析为 `/userdisk/SenrenBanka/bg/<bg>.png`。
- `bgm` 最终解析为 `/userdisk/SenrenBanka/bgm/<bgm>.opus`（也兼容 `.ogg`/`.mp3`/`.wav`）。
- 背景保留名 `__black__` 表示黑屏（也兼容旧数据的 `画面_黒`）；也可以直接写空字符串。
- `chapter` 会显示在对话框底部；缺失时显示 `--`。

### 2.2 `character` 立绘对象

两种写法，任选其一：

```js
{ "sprite": "sprite_0001" }
```

或：

```js
{ "char": "char_a", "dress": "dress_a", "face": "01" }
```

- `sprite` 存在时，引擎直接解析 `/userdisk/SenrenBanka/fg/<sprite>.png`。
- 否则引擎拼接 `<char>_<dress>_<face>.png`；`dress` 缺省为 `default`，`face` 缺省为 `01`。
- 引擎**不内置任何角色表、表情数量或文件名映射**，全部由数据决定。
- `sprite`/`char`/`dress`/`face` 均不得包含路径分隔符或 `..`。

### 2.3 `afterMeta`

```js
[
  {
    "key": "heroine_a",          // 必填；对应 STORY.after.heroine_a
    "name": "角色显示名",         // 卡片标题
    "chapter": "AFTER 1",        // 角标
    "title": "后日谈标题",        // 卡片副标题
    "voice": "after_a",          // 可选：播报语音基名
    "cover": "ema/ema_01.jpg"    // 可选：相对 /userdisk/SenrenBanka/bg/ 的路径
  }
]
```

- `key` 只能由字母、数字、下划线组成；引擎会拼成存档场景名 `after_<key>`。
- `cover` 可带 `.jpg`/`.png` 扩展名；不带扩展名时按 `.jpg` 处理。
- 没有 `afterMeta` 时后日谈页面会显示可读的“未找到数据”提示，而不是伪造内容。

### 2.4 `meta`

可选字段：

```js
{
  "titleBgm": "bgm_title" // 标题页 BGM 基名；不填则标题页不播放 BGM
}
```

---

## 3. `flowchart_data.js`

```js
export var FLOWCHART = {
  routes: ["route_a", "route_b"],
  nodes: [
    {
      "id": "node_1",
      "type": "chapter",        // chapter | section | select | branch | warp | 任意自定义
      "route": "route_a",
      "chapter": "CHAPTER 1-1",
      "title": "节点标题",
      "targetLine": 0,          // number|null；null 表示只展示、不可跳转
      "next": "node_2"          // string | string[] | null
    }
  ],
  choices: [
    {
      "id": "node_1",
      "prompt": "选择提示",
      "targetLine": 10,
      "options": [
        {
          "index": 1,
          "text": "选项文本",
          "targetNode": "node_2",
          "targetLine": 20,
          "flagGain": { "flag": "route_a", "points": 1 }
        }
      ]
    }
  ],
  chain: {
    "node_1": "node_2",
    "node_1:node_2": ["branch", "条件说明"]
  },
  routeArt: {
    "route_a": "ema/ema_01.jpg"
  }
};
```

- `routes` 至少一项；为空时流程图页显示可读提示。
- `nodes[].route` 必须出现在 `routes` 中；`id` 必须唯一。
- `targetLine` 必须是大于等于 0 的整数或 `null`。
- `choices` 与 `nodes` 的 `id` 对应；`targetNode` 必须存在，或直接给 `targetLine`。
- `routeArt` 可选，路径相对 `/userdisk/SenrenBanka/bg/`。

---

## 4. `gallery_data.js`

```js
export var GALLERY = {
  cg: [
    { "id": "cg_1", "code": "CG01", "role": "分类", "file": "cg_0001" }
  ],
  bgm: [
    { "id": "bgm_1", "code": "BGM01", "file": "bgm_01" }
  ]
};
```

- `cg[].file` 解析为 `/userdisk/SenrenBanka/cg/<file>.png`（也兼容 `.jpg`/`.webp`）。
- `bgm[].file` 解析为 `/userdisk/SenrenBanka/bgm/<file>.opus`（也兼容 `.ogg`/`.mp3`/`.wav`）。
- 两个数组都可以为空；页面会显示可读的空状态提示。

---

## 5. 安全与工程约束

- 所有数据必须是 UTF-8 文本。
- 不允许绝对路径、`..`、Windows 盘符、反斜杠路径或空字节。
- 不要把生成后的 `.js` 提交到仓库；`.gitignore` 已忽略 `app/data/*.js`。
- 生成工具会在 `app/data/.data_manifest.json` 写出资源引用清单，供
  `tools/import_assets.py --refs` 做资源完整性检查；该文件同样不提交。
