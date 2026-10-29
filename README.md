# RibbonEngine (丝带引擎)

> **The Ultrawide Visual Novel Engine for Embedded Devices**  
> 专为嵌入式带鱼屏与有道词典笔量身打造的轻量级通用 Galgame / 视觉小说运行时容器。
> 物理屏 960×266，Falcon/JQuick 逻辑视口固定 800×220。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-RK3562%20%7C%20Linux%204.19-green.svg)](#)
[![Display](https://img.shields.io/badge/Display-800x220%20Logical-orange.svg)](#)
[![Tests](https://img.shields.io/badge/Tests-Offline%20Suite%20PASS-brightgreen.svg)](#)

---

### 🎀 为什么命名为 RibbonEngine？

1. **带鱼屏的形态美学**：设备逻辑视口 800×220，显示比接近 4:1，极宽且极窄，如同一条舒展的宽幅**丝带（Ribbon）**。引擎将三栏布局与横卷画轴完美融合于这根“丝带”之中。
2. **视觉小说的情感纽带**：在 Galgame 的意象中，丝带（Ribbon）既是经典的少女发饰，也是象征命运牵引与故事分支的纽带。
3. **轻快与纯粹**：单 C 原生混音插件配合轻量微前端，追求如丝带般丝滑流畅的运行体验。

---

这是一个面向**网易有道词典笔（Rockchip RK3562 / Falcon/JQuick + QuickJS 微前端）**的**通用纯净视觉小说（Galgame）运行时引擎**。
本仓库定位为**通用底层引擎骨架与跨平台移植容器**，专供开发者移植任意商业或同人 GalGame 游戏。

> ⚠️ **纯净声明与免责**：
> 本仓库**不包含任何特定游戏的商业剧本、台词、角色名、图片（立绘/背景/CG）、音频（语音/BGM）或字体资产**。使用者必须合法持有目标游戏正版资产，并在本地通过数据转换工具生成对应数据。

---

## 一、引擎核心能力与架构

引擎经过深度重构，具备以下核心能力：

1. **超宽带鱼屏黄金分割布局（800 × 220）**：
   - **390px 舞台区**：支持背景图自适应、人物立绘差分、SD 演出小人、全屏 CG 浏览，并支持 1.0x ~ 2.5x 特写缩放与手势拖动。
   - **322px 文本区**：姓名标牌、打字机推进、历史回溯 Backlog、章节提示。
   - **88px 侧边栏**：快捷功能区（菜单、自动 Auto、快进 Skip、语音重播）。
2. **高效 10 列台词契约**：
   - 台词行采用紧凑定长数组格式：`[lineId, speaker, text, voice, bg, bgm, character, chapter, cg, sd]`，兼具极端低内存占用与高扩展性；演出事件走独立 fx 表。
3. **原生软混音架构（`libjsapi_gal.so`）**：
   - 针对 RK3562 嵌入式单声卡（`/dev/snd/pcmC1D0p`）独占限制，自研了基于 GStreamer `appsrc`/`appsink` 的双声道 PCM 软件累加与饱和截断（saturation clipping）混音引擎，实现 BGM 与语音真正混音播放，彻底杜绝声卡被占死锁断流。
4. **4-Tab 鉴赏系统（`app/pages/gallery/`）**：
   - **CG 鉴赏**：多分组展示、解锁状态管理、全屏等比缩放浏览。
   - **场景回忆**：名场面片段快速回放、表情差分实时切换。
   - **立绘鉴赏**：支持场景背景自由循环切换（告别纯黑死底）、全身立绘（`/userdisk/gal_data/<game_id>/stand/`）与半身胸像（`/userdisk/gal_data/<game_id>/fg/`）一键切换、点击立绘进入全屏大图特写，支持 1.0x ~ 2.2x 缩放与触控手势滑动平移。
   - **音乐盒**：BGM 列表播放、状态记忆、音量跟随。
5. **FX 演出时间线与分支合流跳过栈**：
   - 内置白闪、黑幕渐变、震屏等演出时间线调度器（原生支持十六进制底色配合 `opacity`，采用盒模型 `left`/`top` 位移解决 `transform` 兼容限制）。
   - 具备分支合流跳过栈（Branch Skip Stack），彻底解决分支剧情跳转与跨路线行号冲突问题；跳转选项时主动重置目标选择记录，确保每次跳转都能重新触发选项弹出。
6. **系统设置与数据安全管理（`app/pages/title/`）**：
   - 支持 BGM 开关与精确音量调节（即时写入持久化存储）。
   - 新增「清除所有数据」功能，具备红色高危二次确认防误触弹窗，可安全清空全部存档槽位、历史回顾队列与已解锁标记。
7. **路线级流程图（`app/pages/flowchart/`）**：
   - 整条路线一次展示，章节只作为节点标签；支持拖动/方向键平移、跨线桥接和行号跳转，不再把每一章切成独立孤岛。

---

## 二、AI 移植助手与实战复盘指南

为了让广大开发者（或开发者的 AI 编程助手）能够零门槛将任意游戏移植到本引擎，我们提供了全套指引与踩坑复盘：

### 1. AI 移植 Master Prompt
我们准备了修订版的移植契约：[`AI_PORTING_PROMPT.md`](AI_PORTING_PROMPT.md)。
它不再承诺“一键全自动”，而是要求 AI 按 Phase A 样本、真实资源清单、validator、真机截图逐阶段交付；其中包含实际数据字段、CG 分组、立绘命名、章节规范化、流程图和常见故障速查。请把该文件连同目标游戏的样本资源清单一并交给 AI。

### 2. 真实移植实战工程与深度复盘（必读）
本引擎是从《千恋＊万花》词典笔完整移植项目中提炼而来的纯净核心。如果你想了解移植全流程、解包转码实战以及各种嵌入式硬件踩坑经验，请参考：
- **本仓库实录归档**：[`AI-Record/` 目录](AI-Record/)
  - [`AI-Record-Antigravity-FullPipeline-Engineering-and-Pitfalls.md`](AI-Record/AI-Record-Antigravity-FullPipeline-Engineering-and-Pitfalls.md)：全流程工程实践与深度避坑指南
  - [`AI-Record-Antigravity-SenrenCore.md`](AI-Record/AI-Record-Antigravity-SenrenCore.md)：三栏布局与数据驱动引擎架构
  - [`AI-Record-Qoder-Main-Porting-Testing.md`](AI-Record/AI-Record-Qoder-Main-Porting-Testing.md)：剧本解析与选择支跳转实录
  - [`AI-Record-Antigravity-Playtester-Kanna.md`](AI-Record/AI-Record-Antigravity-Playtester-Kanna.md)：真机实测体验与触控调优
- **实战移植工程仓库**：[senren-banka-ydpen-port](https://github.com/RS114514/senren-banka-ydpen-port)
- **开发与踩坑记录**：
  - macOS AppleDouble `._*` 隐藏文件导致 4KB 文件损坏白屏的排查；
  - ALSA 单声卡冲突与 GStreamer 软混音器的诞生史；
  - 嵌套选择支与个人线行号冲突对账机制；
  - 动态样式透明度 `opacity` 与盒模型震屏位移实现；
  - 带鱼屏触控热区防误触调优。

---

## 三、资源放置规范

解包与转码后的素材统一存放在词典笔的存储路径：
`/userdisk/gal_data/<game_id>/`（或 `/userdisk/gal_data/`）

```text
/userdisk/gal_data/<game_id>/
├── bg/          # 背景图片（960×540 或 16:9 PNG/JPG）
│   └── title_bg.png # 必需：主标题背景
├── fg/          # 对话框半身胸像立绘（780×440 或 944×566 透明底 PNG）
├── stand/       # 立绘鉴赏模式全身立绘（780×440 或 2:1 高清透明底 PNG，支持全屏大图特写）
├── cg/          # 事件 CG（PNG/JPG/WebP）
├── sd/          # SD Q版演出小图（PNG，居中 contain 渲染）
├── bgm/         # 背景音乐（OPUS 编码优先，或 48000Hz OGG）
├── voice/       # 角色配音（单声道 OGG 或 OPUS）
└── fx/          # 特效演出/转场贴图（PNG）
```

> **注意**：绝对不要将任何图片和音频打包进 `.amr` 安装包中！`.amr` 仅用于安装 JS 逻辑代码与原生插件。

---

## 四、项目结构

```text
.
├── AI_PORTING_PROMPT.md             # 面向 AI 的移植系统提示词（核心移植指南）
├── AI-Record/                       # 核心架构与实战避坑复盘全记录
│   ├── AI-Record-Antigravity-FullPipeline-Engineering-and-Pitfalls.md
│   ├── AI-Record-Antigravity-SenrenCore.md
│   ├── AI-Record-Qoder-Main-Porting-Testing.md
│   └── AI-Record-Antigravity-Playtester-Kanna.md
├── app/
│   ├── app.js / app.json / manifest.json
│   ├── common.js / storage.js / media.js
│   ├── root.js / base-page.js / page-entry.js
│   ├── app_icon.png                 # 原创图标
│   ├── pages/
│   │   ├── title/                   # 主菜单与系统设置（支持清除数据）
│   │   ├── game/                    # 视觉小说主引擎（三栏布局/FX/分支合流）
│   │   ├── gallery/                 # 4-Tab 鉴赏（CG/场景/立绘全屏特写/音乐盒）
│   │   ├── flowchart/               # 分支决策流程图
│   │   └── afterstory/              # 后日谈/短篇剧本
│   └── data/
│       └── README.md                # 10 列剧本数据契约详细说明
├── tools/
│   ├── build_data.py                # 转换生成 story_data / flowchart_data / gallery_data（含四 Tab 鉴赏字段）
│   ├── validate_port.py             # 数据/行号/跳转/资源引用对账器（发布前必跑）
│   ├── import_assets.py             # 资源规范检查与推送脚本（bg/fg/stand/sd/cg/bgm/voice/fx）
│   ├── pack_amr.py                  # .amr 打包器
│   └── test_*.mjs / test_*.py       # 离线全量单测套件
├── native/
│   ├── gal_gs.c                     # GStreamer 软混音原生插件源码
│   ├── MIXER_NOTES.md               # 软混音器真机实测笔记
│   └── prebuilt/libjsapi_gal.so     # aarch64 交叉编译产物（内置软混音）
├── build.py                         # 一键打包与安装脚本
├── LICENSE                          # MIT 开源协议
├── SECURITY.md                      # 免责与安全说明
└── README.md
```

---

## 五、快速开始与构建

### 1. 准备剧本数据
按照 [`app/data/README.md`](app/data/README.md) 的说明，在本地准备 `data_src/story.json`、`data_src/flowchart.json`、`data_src/gallery.json`，然后执行转换：

```bash
python3 tools/build_data.py --src data_src --out app/data
```

### 2. 检查与推送资源
先运行数据/素材对账器，再推送资源：

```bash
python3 tools/validate_port.py \
  --data app/data \
  --assets build/device_assets \
  --strict
```

使用 `tools/import_assets.py` 进行资源整理与 ADB 脚本生成：

```bash
python3 tools/import_assets.py \
  --source assets_src \
  --stage build/device_assets \
  --refs app/data/.data_manifest.json \
  --deploy-script build/deploy_assets.sh

# 执行推送（推送前务必删除 macOS 隐藏文件）
find build/device_assets -name "._*" -delete
export PEN_SERIAL=<你的词典笔序列号>
bash build/deploy_assets.sh
```

### 3. 构建并安装应用
连接词典笔 ADB，执行一键构建与安装：

```bash
# 静态检查
python3 build.py --check

# 安装并启动
export PEN_SERIAL=<你的词典笔序列号>
python3 build.py --install
```

---

## 六、离线测试套件

本仓库包含完整的离线测试用例，无需硬件连接即可在本地验证核心逻辑：

```bash
# 发布前先对账真实数据与素材引用
python3 tools/validate_port.py --data app/data --assets build/device_assets --strict

# 运行全部离线单元测试
node tools/test_storage_scenario.mjs
node tools/test_reactive_state.mjs
node tools/test_title.mjs
node tools/test_audio_settings.mjs
node tools/test_engine_render.mjs
python3 -m unittest discover -s tools -p 'test_*.py'
```

---

## 七、界面换肤与样式定制

如果你希望更换游戏的主题色彩、字体与按钮质感，可以直接修改以下样式文件：
- 主游戏界面：`app/pages/game/game.css`（文本框透明度、姓名标签阴影、按钮边框）
- 主标题画面：`app/pages/title/title.css`（标题菜单对齐方式与文字渐变）
- 鉴赏中心：`app/pages/gallery/gallery.css`（Tab 切换栏颜色与卡片间距）

> **排版约束**：词典笔逻辑屏幕严格限制为宽 800px、高 220px。严禁在根容器设置超出 220px 的高度，以保证微前端容器稳定渲染。

---

## 八、开源协议

- 本仓库原创代码与构建工具均遵循 [MIT 许可证](LICENSE)。
- 原生音频扩展动态链接了 GStreamer（LGPL-2.1+）与 QuickJS（MIT）。
- 本项目不包含任何商业游戏受版权保护的内容。
