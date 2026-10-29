# app/data 数据契约

本目录**不附带任何特定游戏的剧本、角色名、章节名或商业资源清单**。除本说明文档外，`app/data/` 目录下的
`story_data.js`、`flowchart_data.js`、`gallery_data.js` 均应由开发者使用自身合法持有的游戏数据转码生成。这些生成文件已被 `.gitignore` 忽略，严禁提交到公开仓库中。

转换构建工具：`tools/build_data.py`。生成后必须运行：

```bash
python3 tools/validate_port.py --data app/data --assets build/device_assets --strict
```

完整流程见仓库根目录 `README.md` 与 `AI_PORTING_PROMPT.md`。

---

## 1. 结构概览

```text
data_src/
├── story.json          # 核心剧情数据（包含主线、分支、后日谈等）
├── flowchart.json      # 流程图与分支拓扑
└── gallery.json        # 4 Tab 鉴赏数据（CG、场景、立绘、BGM）
```

---

## 2. `story_data.js` 规范

导出的标准数据接口：

```js
export var STORY = {
  main: [ /* 主线台词行数组 */ ],
  routes: { /* routeKey -> 个人线台词行数组 */ },
  after: { /* afterKey -> 后日谈台词行数组 */ },
  afterMeta: [ /* 后日谈卡片元数据 */ ],
  choices: [ /* 交互选择支配置数组 */ ],
  fxEvents: { /* 可选：剧本行演出特效事件表，key 为 scenario */ },
  meta: {
    gameId: "my_game",
    titleBgm: "bgm_title"
  }
};
```

### 2.1 台词行契约（10 列规范数组，兼容 8 列）

每一行台词建议使用定长数组表示，索引严格对齐当前剧本行号：

```js
[
  lineId,     // 0: number：剧本行索引（0, 1, 2...），存档与跳转均以此为基准
  speaker,    // 1: string：说话人姓名；空字符串表示独白/旁白
  text,       // 2: string：台词正文文本
  voice,      // 3: string|null：语音文件名基名（如 "v001" 或 "v001.ogg"）
  bg,         // 4: string|null：背景图片基名（如 "bg_room" 或 "bg_room.png"）
  bgm,        // 5: string|null：BGM 音频基名（如 "bgm01" 或 "bgm01.opus"）
  character,  // 6: object|null：舞台立绘数据对象，见下文
  chapter,    // 7: string：章节或场景提示（如 "第1章"、"AFTER 1"），缺省时显示 "--"
  cg,         // 8: string|null：事件 CG 基名（如 "ev101a"），优先于背景/立绘
  sd          // 9: string|null：SD/Q版舞台图片基名（如 "sd_happy"），等比居中渲染
]
```

> 注意：第 9 列是 **CG**，第 10 列是 **SD**。这是引擎 `game.js` 的实际读取顺序；旧版文档曾把两者写反。
> 演出事件不属于台词 10 列，统一通过 `STORY.fxEvents` / 转码器生成的 fx 表提供。

#### 资源路径解析规则（由 `app/media.js` 统一调度）
- `voice` 解析为：`/userdisk/gal_data/<game_id>/voice/<voice>.ogg`（兼容 `.opus`/`.wav`）。
- `bg` 解析为：`/userdisk/gal_data/<game_id>/bg/<bg>.png`（背景特殊关键字 `__black__` 或 `画面_黒` 渲染为全黑层）。
- `bgm` 解析为：`/userdisk/gal_data/<game_id>/bgm/<bgm>.opus`（兼容 `.ogg`/`.mp3`）。
- `cg` 解析为：`/userdisk/gal_data/<game_id>/cg/<cg>.png`（事件 CG，优先于背景/立绘）。
- `sd` 解析为：`/userdisk/gal_data/<game_id>/sd/<sd>.png`。
- `character.sprite` 解析为：`/userdisk/gal_data/<game_id>/fg/<sprite>.png`。
- `character.char + dress + face` 解析为：`/userdisk/gal_data/<game_id>/fg/<char>_<dress>_<face>.png`；素材必须使用实际文件名，不能假设中文名会自动映射到日文名。

### 2.2 `character` 立绘字段

立绘字段支持多种表示法：

1. **单图平铺模式**（推荐，预先合成好的带表情差分整图）：
```js
{ "sprite": "char_a_happy" }
```

2. **部件分层拼接模式**：
```js
{ "char": "char_a", "dress": "school", "face": "01" }
```
引擎自动解析为 `<char>_<dress>_<face>.png`。

### 2.3 `afterMeta` 后日谈/短篇元数据

```js
[
  {
    "key": "heroine_a",          // 对应 STORY.after.heroine_a
    "name": "角色名称",           // 界面标题
    "chapter": "AFTER 1",        // 角标提示
    "title": "后日谈标题",        // 副标题描述
    "voice": "after_v01",        // 点击卡片时的播报语音基名
    "cover": "cover_a.jpg"       // 封面图相对 bg/ 路径
  }
]
```

---

## 3. `flowchart_data.js` 流程图与决策树

```js
export var FLOWCHART = {
  routes: ["main", "route_a", "route_b"],
  nodes: [
    {
      "id": "node_intro",
      "type": "chapter",        // chapter | select | branch | warp
      "route": "main",
      "chapter": "序章",
      "title": "命运的相遇",
      "targetLine": 0,          // 跳转行号；null 表示不可直接跳转
      "next": "node_choice_1"
    }
  ],
  choices: [
    {
      "id": "node_choice_1",
      "prompt": "在此处做出决定",
      "targetLine": 150,
      "options": [
        {
          "index": 1,
          "text": "向左走",
          "targetNode": "node_left",
          "targetLine": 151
        },
        {
          "index": 2,
          "text": "向右走",
          "targetNode": "node_right",
          "targetLine": 320
        }
      ]
    }
  ]
};
```

引擎流程图界面按**整条路线**展示 `select`、`branch`、`warp` 及它们对应的重要节点；章节只作为节点标签。不要给每个章节只生成一个节点，否则界面会退化成“一章一屏”。节点较多时用拖动/方向键平移，而不是把每个章节切成独立孤岛。

---

## 4. `gallery_data.js` 4 Tab 鉴赏数据

引擎内置完整的 4 Tab 鉴赏系统：

```js
export var GALLERY = {
  // 1. CG 鉴赏：group 列表与扁平的 cg 列表；引擎按 group 过滤 cg
  cgGroups: [
    { "key": "group_event", "name": "主线事件" },
    { "key": "heroine_a", "name": "女主角 A" }
  ],
  cg: [
    { "id": "cg_01", "code": "CG01", "group": "group_event",
      "role": "group_event", "file": "cg_001", "unlocked": true }
  ],
  // 2. 场景回忆
  sceneGroups: [
    { "key": "heroine_a", "name": "女主角 A 回忆" }
  ],
  scenes: [
    { "id": "scene_01", "title": "名场面", "group": "heroine_a",
      "route": "heroine_a", "cover": "cg_001",
      "variants": ["cg_001", "cg_002"] }
  ],
  // 3. 立绘差分鉴赏：char/dresses/faces 是引擎实际读取字段
  standChars: [
    { "key": "heroine_a", "name": "女主角 A", "char": "hero_a",
      "dresses": ["uniform", "casual"], "faces": 20 }
  ],
  // 立绘背景必须是不含人物的纯场景图；空 file 表示纯黑
  standBackgrounds: [
    { "name": "教室", "file": "classroom" },
    { "name": "纯黑", "file": "" }
  ],
  // 4. BGM 音乐盒
  bgm: [
    { "id": "bgm_01", "code": "BGM01", "title": "日常的晨光", "file": "bgm01" }
  ]
};
```

> 关键陷阱：引擎读取 `GALLERY.cg` 的扁平列表和 `cgGroups[].key`，**不是** `cgGroups[].items`。
> `standChars` 使用 `char` / `dresses` / `faces`，不是 `costumes` / `files`。每张 `cg.file` 必须存在，
> 每个 `cg.group` 必须对应一个 `cgGroups.key`，不要留下 0 张的分组。

---

## 5. 安全与规范约束

1. **路径合法性**：文件名必须使用合法字符，严禁携带 `..`、绝对路径 `/`、反斜杠 `\` 或空字符。
2. **离线与独立性**：不得在生成文件中引入网络请求或外部专有库依赖。
3. **音画尺寸建议**：背景图片 960×540（16:9，由引擎在 390×220 或全屏区域等比缩放）；立绘 780×440 或 944×566 透明底 PNG。
