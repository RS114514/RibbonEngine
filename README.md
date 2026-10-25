# GAL Dictionary Pen Engine

一个面向**网易有道词典笔 X6 Pro** 的本地视觉小说（Galgame）miniapp 引擎。它只提供引擎、
构建/部署工具、原生插件源码与资源导入约定，**不附带任何游戏剧本、图片、音频或字体**。

> 目标设备：RK3562 / aarch64 / 4 核 A53 / Mali-G52 / Weston Wayland / 960×266 物理屏，
> 应用逻辑坐标 800×220。

---

## 1. 适用范围与法律声明

- 本项目是**非官方、非商业的爱好者工具**，与 Yuzusoft（柚子社）、网易有道均无隶属或授权关系。
- 《千恋＊万花》/ Senren Banka 及相关角色、商标、剧本、美术、音频的著作权归其权利人所有。
- **使用者必须自行购买并持有正版游戏。** 本仓库不提供、下载、托管、分发任何游戏资源。
- **严禁**把解包出的剧本、立绘、背景、CG、绘马、语音、BGM、字体或游戏数据包上传到本仓库、
  issue、网盘、社交平台或任何公开位置。
- 本项目不提供 DRM/加密/签名校验的规避工具，也不鼓励此类行为。请仅在法律允许的范围内，
  对自己合法持有的副本做个人备份与格式转换。
- 代码以 MIT 许可发布；MIT **只覆盖本仓库的原创代码**，不覆盖任何游戏内容或第三方平台组件。

---

## 2. 当前范围

当前数据契约与页面覆盖：

- **共通线主剧本**（`STORY.main`）；
- **6 个后日谈**（`STORY.after` + `STORY.afterMeta`）；
- 可选流程图拓扑；
- 可选 CG / BGM 鉴赏清单。

**不包含各女主角个人线的全量剧本。** 本仓库不会因为代码存在就自动拥有个人线内容；
个人线需要自己扩展数据与流程图，并自行承担相应的法律与版权责任。

本仓库的 `app/data/` 只保留 `README.md` 数据契约；任何剧本大数组文件都**不会被提交**，
只会在你本地按契约生成。

---

## 3. 已实现功能

- 800×220 三分栏视觉小说界面：左侧舞台 390×220、中间台词区、右侧快捷栏。
- 舞台背景 + 立绘叠加、1.0x / 1.5x / 2.0x / 2.5x 特写缩放与手势拖动。
- 台词推进、说话人/独白、章节角标、进度显示。
- 分支选择、选择标记与存档持久化。
- 30 个存档槽（5 页 × 6 槽）、覆盖/读档二次确认、跨剧本读档。
- 历史对话 Backlog、历史语音重听。
- 自动播放、快进、语音重播。
- 标题页 BGM 开关与音量持久化。
- 流程图页面：路线/章节切换、节点跳转、画布拖动。
- 后日谈卡片：角色/章节/台词数/语音数、播报语音、进入物语。
- CG / BGM 鉴赏页：横向滑动、大图缩放、BGM 播放。
- 语音避让：词典笔没有 ALSA dmix 时，播语音前先停 BGM，播完自动恢复。
- 数据驱动：角色立绘命名、章节、背景、语音、BGM、流程图、鉴赏清单均来自用户数据。

---

## 4. 依赖

### 宿主机

- Python 3.8+（只用标准库）。
- Node.js 18+（仅运行测试需要）。
- `adb`（Android platform-tools）。
- 可选：`ffmpeg`（转换音频/图片时使用）。
- 可选：你自行合法准备的解包/转换工具（本项目不附带）。

### 词典笔

- 已开启 adb 调试。
- Falcon / QuickJS miniapp 运行环境。
- 设备端编译器 `jsfmc`（默认 `/userdisk/skip_re/tools/jsfmc`）。
- `miniapp_cli`（安装/启动/截屏）。
- GStreamer 1.0 与 `alsasink` / `waylandsink`（原生插件使用）。
- 原生插件预编译版：`native/prebuilt/libjsapi_gal.so`（aarch64）。
  源码在 `native/gal_gs.c`；重新编译需要 QuickJS 头文件与 aarch64 工具链。

---

## 5. 目录结构

```text
.
├── app/
│   ├── app.js / app.json / manifest.json
│   ├── common.js / storage.js / media.js
│   ├── root.js / base-page.js / page-entry.js
│   ├── app_icon.png                 # 本仓库原创图标
│   ├── pages/
│   │   ├── title/                   # 主菜单
│   │   ├── game/                    # 视觉小说主引擎
│   │   ├── gallery/                 # CG / BGM 鉴赏
│   │   ├── flowchart/               # 流程图
│   │   └── afterstory/              # 后日谈
│   └── data/
│       └── README.md                # 数据契约（生成后的 *.js 被 gitignore）
├── tools/
│   ├── build_data.py                # 生成 story_data / flowchart_data / gallery_data
│   ├── import_assets.py             # 校验并整理用户资源
│   ├── pack_amr.py                  # .amr 打包器
│   └── test_*.py / test_*.mjs       # 离线测试
├── native/
│   ├── gal_gs.c                     # 原生插件源码（GStreamer + QuickJS）
│   └── prebuilt/libjsapi_gal.so     # 原创引擎插件的 aarch64 构建产物
├── build.py                         # 构建 / 安装
├── LICENSE
├── SECURITY.md
└── README.md
```

被 `.gitignore` 忽略、**不应提交**的目录：

```text
data_src/          # 你整理的剧本 JSON/JSONL
assets_src/        # 你解包/转换后的资源
build/             # 构建中间产物
dist/              # .amr
app/data/*.js      # 生成的数据模块
```

---

## 6. 快速开始

### 6.1 准备正版资源（必须）

1. 购买并安装正版《千恋＊万花》。
2. 在你所在地区法律允许的范围内，自行准备适用于你购买版本的解包/转换工具。
   本项目**不提供**解包器、密钥、PSB/TLG 转换器或任何游戏资源下载。
3. 把转换后的资源整理成下面的目录（文件名由你自己决定，但必须与数据里的引用一致）：

```text
assets_src/
├── bg/
│   ├── title_bg.png          # 必需：标题背景
│   └── <背景名>.png
├── fg/
│   └── <立绘 sprite 名>.png
├── bgm/
│   └── <BGM 名>.opus         # 也支持 .ogg / .mp3 / .wav
├── voice/
│   └── <语音名>.ogg          # 也支持 .opus / .wav
├── ema/
│   └── <绘马名>.jpg          # 会部署到 bg/ema/
└── cg/
    └── <CG 名>.png
```

推荐规格：

| 类型 | 推荐尺寸/格式 | 设备路径 |
| --- | --- | --- |
| 背景 | 960×540 PNG（16:9） | `/userdisk/SenrenBanka/bg/` |
| 标题背景 | 960×540 PNG，文件名 `title_bg.png` | `/userdisk/SenrenBanka/bg/` |
| 立绘 | 780×440 PNG，透明底（390×220 舞台的 2x） | `/userdisk/SenrenBanka/fg/` |
| 绘马 | 16:9 JPG，放在 `ema/` 子目录 | `/userdisk/SenrenBanka/bg/ema/` |
| CG | PNG（也支持 JPG/WebP） | `/userdisk/SenrenBanka/cg/` |
| BGM | OPUS（也支持 OGG/MP3/WAV） | `/userdisk/SenrenBanka/bgm/` |
| 语音 | OGG（也支持 OPUS/WAV） | `/userdisk/SenrenBanka/voice/` |

> 引擎不会自动放大低清图。想要特写清晰，请自己提供 960×540 背景和 780×440 立绘。

### 6.2 生成剧本数据

数据契约全文见 [`app/data/README.md`](app/data/README.md)。最简输入：

```text
data_src/
├── main.jsonl                 # 共通线，每行一个 8 元数组
├── after/
│   ├── heroine_a.jsonl        # key = heroine_a
│   └── heroine_b.jsonl
├── afterstory.json            # 后日谈卡片元数据数组
├── flowchart.json             # 流程图拓扑
└── gallery.json               # 可选：CG / BGM 清单
```

也可以把 `main`、`after`、`afterMeta`、`meta` 合并成一个 `data_src/story.json`。

每行台词格式：

```json
[0, "说话人", "台词文本", "voice_0001", "bg_room", "bgm_01", null, "CHAPTER 1-1"]
```

字段含义、`character` 立绘对象、`afterMeta`、`flowchart`、`gallery` 的完整约束见
`app/data/README.md`。**不要**把任何示例台词或官方文本提交到仓库。

生成：

```bash
python3 tools/build_data.py --src data_src --out app/data
```

只校验、不写文件：

```bash
python3 tools/build_data.py --src data_src --out app/data --check
```

生成物：

```text
app/data/story_data.js
app/data/flowchart_data.js
app/data/gallery_data.js
app/data/.data_manifest.json
```

这些文件已被 `.gitignore` 忽略。`story_data.js` 只由你的数据生成，仓库里没有可用的默认剧本。

### 6.3 校验并整理资源

```bash
python3 tools/import_assets.py \
  --source assets_src \
  --stage build/device_assets \
  --report build/asset_report.json \
  --refs app/data/.data_manifest.json
```

- `--refs` 会检查 `story_data.js` 引用的背景、立绘、语音、BGM、绘马、CG 是否都存在。
- `--hash` 会额外计算 sha256（大资源会慢）。
- `--strict-size` 会强制背景 960×540、立绘 780×440。
- `--check` 只校验，不复制。
- 工具只做本地复制，不连接设备。

### 6.4 部署资源到词典笔

生成部署脚本（不会自动执行）：

```bash
python3 tools/import_assets.py \
  --source assets_src \
  --stage build/device_assets \
  --refs app/data/.data_manifest.json \
  --deploy-script build/deploy_assets.sh
```

然后：

```bash
export PEN_SERIAL=<你的设备序列号>
bash build/deploy_assets.sh
```

脚本会创建并推送：

```text
/userdisk/SenrenBanka/bg/
/userdisk/SenrenBanka/bg/ema/
/userdisk/SenrenBanka/fg/
/userdisk/SenrenBanka/bgm/
/userdisk/SenrenBanka/voice/
/userdisk/SenrenBanka/cg/
```

也可以只用 `--print-adb` 打印命令，手动执行。

### 6.5 构建

先做无设备静态检查：

```bash
python3 build.py --check
```

`--check` 会验证：

- `app/data/story_data.js`、`flowchart_data.js`、`gallery_data.js` 是否存在且非空；
- CSS 是否满足 800×220 边界；
- 图标、原生插件、打包器是否就绪。

实际构建需要连接词典笔，因为 QuickJS 字节码由设备端 `jsfmc` 生成：

```bash
export PEN_SERIAL=<你的设备序列号>
python3 build.py
```

或直接安装并启动：

```bash
python3 build.py --install
```

可选参数：

```bash
python3 build.py \
  --serial <序列号> \
  --jsfmc /userdisk/skip_re/tools/jsfmc \
  --appid 8002026102400099 \
  --name "GAL Dictionary Pen Engine" \
  --version 1.0.0
```

产物：`dist/gal-engine-<version>.amr`。

> `.amr` 只包含 JS 字节码、应用图标和 `libjsapi_gal.so`，**不包含**任何剧本、图片、音频。
> 资源必须单独按 6.4 放到设备上。

### 6.6 安装后的数据路径

- 存档：`/userdisk/gal_data/galgame/saves.json`
- 设置：`/userdisk/gal_data/galgame/settings.json`
- 兼容平铺路径：`/userdisk/gal_data/galgame_saves.json`

---

## 7. 资源导入/校验的工作方式

`tools/import_assets.py` 只做四件事：

1. 检查扩展名、空文件、路径穿越、macOS `._*` 元数据；
2. 读取 PNG/JPEG 头，报告尺寸；
3. 按设备目录结构复制到 `build/device_assets/`；
4. 可选地用 `app/data/.data_manifest.json` 反查所有引用是否齐全。

它**不会**：

- 解包游戏；
- 下载资源；
- 修改设备；
- 上传任何文件。

如果数据里引用了不存在的资源，构建仍可能成功，但运行时会缺图/无声。建议每次改数据后都跑一次
`--refs` 校验。

---

## 8. 测试

```bash
node tools/test_storage_scenario.mjs
node tools/test_reactive_state.mjs
node --test tools/test_title.mjs
node --test tools/test_audio_settings.mjs
node --test tools/test_engine_render.mjs
python3 -m unittest tools/test_build_modules.py
python3 -m unittest tools/test_data_tools.py
```

测试不读取真实游戏数据，全部使用临时目录或内存桩；不会把示例剧本写进仓库。

---

## 9. 故障排查

### `[x] 未找到剧本数据模块`

说明 `app/data/story_data.js` 等不存在。按 `app/data/README.md` 准备 `data_src/`，运行
`python3 tools/build_data.py --src data_src --out app/data`。

### `没有检测到 adb 设备` / 多台设备

```bash
adb devices
export PEN_SERIAL=<目标设备序列号>
```

代码中没有硬编码序列号。

### `jsfmc` 找不到

确认设备上存在 `/userdisk/skip_re/tools/jsfmc`，或用 `--jsfmc` / `PEN_JSFMC` 指定。
本仓库不包含 QuickJS 编译器。

### CSS 尺寸越界

`build.py` 会拒绝 `height > 220` 或 `width > 800`，以及 `top+height` / `left+width` 越界。
按报错调整 `app/pages/*/*.css`。

### 启动后黑屏 / 空白

- 先确认 `app/data/*.js` 已生成，且构建日志里没有编译失败。
- 检查 `adb logcat` 中 `[gal]` 前缀日志。
- 词典笔在 Wayland 下不能用 `screencap` 截屏；请用：
  ```bash
  adb shell "miniapp_cli capture /tmp/shot.png"
  adb pull /tmp/shot.png ./shot.png
  ```

### 语音没有声音 / `Device 'default' is busy`

词典笔系统没有启用 ALSA dmix，BGM 与语音不能同时占用声卡。本引擎在播语音前会自动
`stopBgm()`，播完再恢复。若仍无声：

- 确认语音文件在 `/userdisk/SenrenBanka/voice/` 且扩展名正确；
- 确认 `libjsapi_gal.so` 已随 `.amr` 安装；
- 用 `gst-launch-1.0` 单独测试一个 OGG 是否能播放；
- 不要同时开多个占用声卡的 app。

### 背景/立绘缺失

- 数据里的 `bg` 是基名，引擎会补 `.png`；
- 立绘 `sprite` 或 `char_dress_face` 必须与 `/userdisk/SenrenBanka/fg/` 下的文件名一致；
- 运行 `tools/import_assets.py --refs app/data/.data_manifest.json` 检查。

### 流程图/鉴赏为空

对应 `flowchart_data.js` / `gallery_data.js` 没有数据。补 `flowchart.json` / `gallery.json`
后重新生成。页面会显示可读空状态，不会崩溃。

### 安装失败

- 确认 appid 未被系统应用占用；
- `miniapp_cli uninstall <appid>` 后再装；
- 确认 `.amr` 里的 `manifest.json` 证书由 `pack_amr.py` 重新生成，不要手动改包内文件。

---

## 10. 已知限制

- 仅在网易有道词典笔 X6 Pro 上验证；其他型号的屏幕、声卡、Wayland 合成器可能不同。
- 当前范围是**共通线 + 6 个后日谈**，不含各女主角个人线全量剧本。
- 词典笔没有 ALSA dmix：语音播放时 BGM 会被停止，播完从头恢复，不能真正混音。
- 原生插件预编译为 aarch64；其他架构需要自行编译。
- 构建依赖设备端 `jsfmc`，没有纯离线 QuickJS 编译器。
- 不附带解包/转码流水线；资源规格与命名由使用者负责。
- 鉴赏页需要自己提供 CG/BGM 清单；不会自动扫描目录。
- 流程图需要自己提供拓扑；不会从剧本自动推导。
- 存档是明文 JSON，不做加密或云同步。
- 不包含字体；使用设备系统字体。
- 不提供视频转码；原生插件的视频接口仅在有合适编码文件时可用。

---

## 11. 许可与第三方

- 本仓库原创代码：MIT，见 [`LICENSE`](LICENSE)。
- 原生插件动态链接 GStreamer（LGPL-2.1+）与 QuickJS（MIT）；它们的许可归各自权利人。
- Falcon / JQuick / 词典笔系统组件为第三方专有平台，不在本仓库内分发。
- 游戏内容、角色、商标归 Yuzusoft 等权利人；本仓库不包含任何游戏资源。

如权利人认为本项目存在侵权内容，请通过仓库 issue 联系维护者删除相关代码；
本项目不会托管或分发任何游戏资源。
