# Qoder 主代理：《千恋＊万花》词典笔移植、解包接线与测试修复全过程

- **作者代号 / Agent 标识**：`Qoder-Main-Agent`
- **会话唯一标识 (Conversation ID)**：`a53aebc9-1525-43bd-b0cb-71a7de4f56d8`
- **执行时间跨度**：2026-10-25 ~ 2026-10-27
- **归档路径**：`/Volumes/500GB/Ydpen/senren-banka-ydpen-port/AI-Record/AI-Record-Qoder-Main-Porting-Testing.md`
- **目标设备**：网易有道词典笔 X6 Pro（Rockchip RK3562 / aarch64 Linux 5.10 / Weston Wayland / 物理 960×266 / Falcon 逻辑 800×220 / AppID `8002026102400099`）
- **上下文说明**：本会话多次被压缩。为写这份记录，我重新读取了原始对话 JSONL（约 17 MB、7881 行），并核对了工程目录、测试输出与最终 Windows 包。

---

## 一、我在项目里的角色变化

一开始用户给我的定位是“协作者 B”，负责后日谈系统接入、语音/绘马资源部署，主代理 A 负责主线剧本、立绘与流程图。后来项目推进过程中，我实际变成了主工程接线与验收代理，负责：

1. 把各条线产出的数据真正接进 Falcon/JQuick 引擎；
2. 修复剧情选择支、路线分歧、后日谈、流程图、音频、CG/SD/FX、鉴赏页等跨模块问题；
3. 维护 `tools/` 离线测试与构建脚本；
4. 与资源 Agent / 外部试玩 Agent 通过 `AGENT_COMM.md` 协同；
5. 最后生成学校 Windows 离线安装/更新包。

我最重要的一条经验：**“资源存在”不等于“引擎能用到”**。很多严重问题不是缺文件，而是数据字段、行号、路由、显示层没有接上。

---

## 二、环境与硬性约束

- 工程根目录：`/Volumes/500GB/Ydpen/senren_banka`
- 缓存/产物目录：`/Volumes/500GB/qoder_cache/senren_banka`
- 原版资源库：`/Volumes/500GB/千恋万花_移植资源库/assets_ready`
- 原版游戏盘：`/Volumes/500GB/G/千恋万花Senren Banka Steam Edition`
- Windows 离线包：`/Volumes/500GB/Ydpen/senren_banka_windows_update`
- 外部试玩报告：`/Volumes/500GB/Ydpen/试玩报告`
- 协同文档：`/Volumes/500GB/Ydpen/senren_banka/AGENT_COMM.md`
- 所有大文件、缓存、临时产物必须放 500GB 外置盘，不能写 Mac 主硬盘。
- 夜间/用户不在时不能调大硬件音量；音频测试以 ALSA 状态、fd、日志为准。
- GitHub 公开仓库只允许引擎、工具、文档，不允许上传游戏资源、剧本、语音、CG、立绘。
- 外部试玩 Agent 跑真机时，主代理不要同时操作词典笔。

---

## 三、我实际做过的工作

### 1. 后日谈系统与独立游玩链路

最初任务是把 6 位女主角后日谈从“展示页”变成真正可进入、可推进、可退出、可读档的独立剧本。

主要改动：

- `app/data/after_*.js` 接入 6 条后日谈剧本。
- `app/pages/afterstory/afterstory.js` 重构后日谈选择页，移除之前 Agent 编造的假内容，改为真实角色、真实台词、真实语音播报。
- `app/pages/game/game.js` 增加 `currentScenario`，支持 `after_*` 作为独立剧本。
- `app/storage.js` 与存档链路补齐 `scenario` 字段，避免从后日谈读档后跳回主线。
- `tools/test_afterstory.mjs`、`tools/test_storage_scenario.mjs` 验证后日谈选择、播报、存档 scenario 持久化。

踩过的坑：

- 后日谈剧本最初只有 9 列，主线后来扩展到 10 列（新增 `cg`、`sd`），导致 `applyCurrentLine` 取 `row[9]` 时 undefined。修复方式是统一转码 10 列。
- 存档只保存 `line` 不保存 `scenario`，读档会串剧本。必须在 `executeLoadFromSlot` 中恢复 `this.currentScenario = data.scenario || 'main'`。

### 2. 流程图重构与章节跳转

用户明确指出旧流程图“太烂”，要求重构。我重写了流程图的数据契约和渲染逻辑：

- `app/pages/flowchart/flowchart.js`
- `app/data/flowchart_data.js`
- `tools/test_flowchart.mjs`

核心工作：

- 路线 tab：共通、芳乃、茉子、ムラサメ、レナ、サブ。
- 每个节点通过 `fcNodeTarget(node)` 返回 `{scenario, line}`。
- 个人线 CHAPTER 起始行用 `FC_CHAPTER_START` 表，避免从节点标题猜行号。
- 分支节点、warp 节点、507 小春/芦花分流单独用特例表处理。
- 回归了“レナ CHAPTER 3-6 误跳共通线 8212”的问题。

后期用户又要求流程图只显示“有选项/分支的位置”，不要 CHAPTER 2-2、2-3 这种普通剧情节点。我改成：

- 从 `flowchart_data.nodes` 中只保留 `select`、`branch`、`warp`；
- 对 `select` 额外保留其直接 option 目标节点；
- 从 `choices_all.js` 动态生成个人线选择节点和 option 节点；
- 用 `chapter_all` 行数据和 `FC_CHAPTER_START` 推导章节；
- 给生成节点加 `scenario` 与 `exact` 字段，保证跳转精确行号；
- 对显示节点按路线、章节、行号排序；
- 测试确认无选项章节不再出现。

流程图踩坑：

- 个人线 `choices_all` 行号与共通线行号大量重合，如果不带 `scenario`，会误弹共通选择支。
- `route_roka` 在流程图路线里仍显示为 `サブ`，不能只靠 route 名反推 scenario，必须给节点带 `scenario`。
- 一开始把 `branch/warp` 的 next section 也加入显示，导致 `s015*com_part_end` 这种普通 END 节点又混进来。后来只保留 `select` 的直接 option 节点。
- 生成节点和原 `flowchart_data` 节点 id 重复时，不能再生成一套 `opt_...` 节点，否则布局里出现没有边的“普通 section”。

### 3. 剧情完整性审计：真正缺的不是台词

用户怀疑“剧情有没有少”。我写了只读审计脚本：

- `/Volumes/500GB/qoder_cache/senren_banka/scripts_story/dump.mjs`
- `audit2.py`
- `branches.py`
- `choices.py`
- `story_audit.md`
- `story_audit.json`

结论：

- 92 个源剧本、55,726 行台词全部接入，逐行命中，文本缺失为 0。
- 真正的问题是选择支没有全部接入，以及分支正文会串播。
- 原版 48 个选择场景中，最初只接了 9 个；其余个人线/后日谈选择支没有 UI，也没有跳过逻辑。
- 共通线路线分歧阈值与原版一致：`len==2`、`yos==2`、`mak==2`、`mur==2`、`sub==2 && anyClear`。

我后续补了：

- `app/data/choices_all.js`：51 个选择支，含目标行、合流跳过区间。
- `game.js` 的 `CHOICE_BY_SCENARIO`、`findChoiceForLine`、`chooseChoice`、`_routeSkips`。
- NORMAL END 处理。
- 508b 芦花专属块在小春路径中跳过。
- 读档后重建 skip stack。

选择支踩坑：

- 只设置 `currentLine = targetLine` 不够，必须记录 `skipAfterLine/skipToLine`，否则选 A 还会播 B。
- 嵌套选择支需要栈，不能只有一个全局 skip。比如 010 的钓鱼/挖野菜/单独行动里有内层选择。
- 选择旗标必须幂等，读档/重复进入不能把 `+1` 重复累加。
- 共通线选择支和个人线选择支行号可能相同，必须按 scenario 隔离。

### 4. 原生音频混音：从“电音卡顿”到单声柄 PCM 混音

外部试玩报告 P0：语音与 BGM 冲突、电音、响一下停一下。根因：

- 固件 GStreamer 没有 `audiomixer`，也没有 `adder`。
- 内核 ALSA 没有可用 dmix timer。
- BGM 和 voice 各自 `alsasink` 会争抢 `/dev/snd/pcmC1D0p`。
- 旧实现优先 `audiomixer`，回退 `adder`，但设备上两者都不可用。

解决方案：

- `native/gal_gs.c` 改成用户态软件 PCM 混音。
- 每个声部：`filesrc ! decodebin ! audioconvert ! audioresample ! capsfilter ! appsink`。
- C 线程每 20ms 拉 S16LE/48k/2ch PCM 混音。
- 唯一输出：`appsrc ! queue ! audioconvert ! audioresample ! capsfilter ! alsasink`。
- BGM ducking、循环、空闲释放、`status()` 契约在原生层完成。
- JS 层仍保留 `playBgm/stopBgm/playVoice` 序列。

后续“电音卡顿”的根因不是混音器本身，而是混音块处理：

- 旧代码如果某个 branch 不足一个 20ms block，就整块跳过。
- 解码/重采样输出块长不一定是 960 帧，整块跳过会周期性丢音。
- 修复：不足一块时按实际可用数据混音，剩余补静音。
- 混音线程从固定 `sleep(20ms)` 改为绝对 deadline 追赶，减少漂移。

音频踩坑：

- 宿主机 macOS 没有 `clock_nanosleep` 的 TIMER_ABSTIME 可用路径，最初交叉编译/主机检查失败。改成 `clock_gettime + nanosleep` 计算剩余时间。
- 真机检查不能只听声音，必须看：
  - `/proc/asound/card1/pcm0p/sub0/status`
  - `/proc/$(pidof miniapp)/fd` 是否只有一个 `pcmC1D0p`
  - `/tmp/gal_gs_mixer.log`
- 外部试玩 Agent 跑真机时，主代理不要同时安装/点击，否则音频状态会被干扰。

### 5. 背景、立绘、CG、SD、FX 资源接线

用户反馈画质糊、CG 不全、SD 二头身没有、转场特效没有。我做了：

- 背景：从 2220×1280 原画生成 960×540 真 PNG，推送到 `/userdisk/SenrenBanka/bg/`。
- 立绘：通过 Swift/CoreGraphics 合成 780×440 差分，推送到 `/userdisk/SenrenBanka/fg/`。
- CG：协调资源 Agent 盘点并转换 101 张 CG，合入 `tools/cg_available.txt` 与剧情 `cg` 字段。
- SD：资源 Agent 转码 359 张 SD 素材，设备包 `sd_device.tar` 295 张，接入 `row[9]`。
- FX：从原版 `lines` 操作流提取 `fx_events.js`，接入 `game.js` 的 F/f/W/S/T/O/M/G 事件。

CG/SD 踩坑：

- 很多 `.png` 实际是 WebP 伪装，`sips` 不指定 `-s format png` 会失败或生成错误文件。
- exFAT/NFC/NFD 文件名差异导致 42 张背景“看起来缺了”。必须用 Python `tarfile` 写 NFC arcname。
- exFAT 上 `chmod 644` 是 no-op，只能在 tar header 里设置 mode。
- SD 是叠加画面，不是全幅替换背景。最初我理解成全屏铺满，用户纠正：原版二头身图是叠在画面上，四周还能看到一点场景。最终使用 `resize:'contain'`，并隐藏正常立绘。
- CG 比例错误时不能简单 `cover`，舞台区应 `contain`，否则人物被拉伸/裁切。

### 6. 场景鉴赏：从原版分层 `.pimg` 合成 24 个场景表情差分

用户要求查原版 Extra。最终确认原版 Extra 是：

- CG 鉴赏
- 音乐鉴赏
- 场景鉴赏
- 立绘鉴赏

其中“CD 鉴赏”是口误，应为 CG 鉴赏。

我找到原版 `cglist_0.csv`、`scenemode.ks`、`!scnlist_98.txt`、`!scnlist_99.txt`，并确认场景鉴赏是 24 个原版 H 场景：

- 芳乃 4
- 茉子 6
- 丛雨 4
- 蕾娜 4
- 小春 3
- 芦花 3

关键发现：原版全屏 CG 的 `.pimg` 是分层 PSB，里面不是单张图，而是姿势/表情图层。例如：

- `Aa` 是完整底图；
- `Ab`、`Ac` 等是同一姿势下的脸部/表情覆盖层；
- 通过底图 + 覆盖层合成，就能还原原版场景差分。

我写了：

- `tools/build_scene_gallery.py`：从 24 个场景封面 CG 的 `.pimg` 合成表情差分。
- `tools/gen_gallery_scenes.py`：生成 `app/data/gallery_scenes.js`。
- `/Volumes/500GB/qoder_cache/senren_banka/scene_variants.tar`：182 张表情差分 PNG，944×532。

接入：

- `app/data/gallery_scenes.js`
- `app/pages/gallery/gallery.js` 新增“场景鉴赏”tab。
- 女主选择 → 场景滑动列表 → 全屏“表情 + / -”。
- 设备路径：`/userdisk/SenrenBanka/scene/`。

场景鉴赏踩坑：

- 一开始误以为要整段场景回放。用户描述的是“一堆图片，上面的表情会变”，所以我做的是图片差分鉴赏，不做 H 场景语音回放。
- 有些 CG 组表情差分很细微，肉眼在缩略图上不明显，但像素 diff 能证明图层确实变化。
- 有些 `.pimg` 的 pose 数量不同（4/6/8/9），不能硬编码 8 张，必须按图层动态生成。
- macOS 会在 exFAT 上生成 `._*` AppleDouble，打 tar 和 AMR 时必须过滤。

### 7. 立绘鉴赏

用户指出原版 Extra 还有“立绘鉴赏”，之前没加。我补了：

- `app/pages/gallery/gallery.js` 新增“立绘鉴赏”tab。
- 7 名角色：芳乃、茉子、丛雨、蕾娜、小春、芦花、玄十郎。
- 服装切换：复用剧情端已生成的 `fg` 差分。
- 表情切换：芳乃/茉子/丛雨/蕾娜/小春/芦花 20 个表情，玄十郎 19 个。
- 设备路径：`file:///userdisk/SenrenBanka/fg/<角色>_<服装>_<表情>.png`。
- 布局：左侧 390×182 立绘舞台，右侧服装按钮 + 表情 prev/next。
- 测试：`tools/test_gallery_layout.mjs` 验证 7 张角色卡、服装切换、表情循环、800×220 适配。

立绘鉴赏踩坑：

- 剧情里的 `dress` 可能有日文/中文别名，如 `寝间着` / `寝間着`、`剑道` / `剣道`，鉴赏页必须用设备端实际存在的服装名。
- 透明立绘不能 `cover` 到小卡片，否则头/衣服被裁；卡片和舞台都用 `contain`。
- 表情编号必须补零：`01`、`02`，不是 `1`、`2`。

### 8. 游玩菜单：回退上一句、跳至下一选项

用户要求菜单里加两个按钮：

- 回退上一句话；
- 跳转至下一选项，快进中间剧情。

实现：

- `game.js` 新增 `prevLine()`。
- `game.js` 新增 `jumpToNextChoice()`。
- 新增 `firstUnselectedChoiceLine(scenario, startLine)`，扫描 `CHOICE_BY_SCENARIO`、`FLOW_CHOICES` 和 507 特殊选择。
- 菜单改成 2 行 3 列：
  - 回退上一句 / 跳至选项 / 历史对话
  - 保存进度 / 读取进度 / 返回标题
- 新增 `menuNotice` 状态，无后续选项或已经是第一句时给提示。
- 跳转后 `rebuildChoiceSkips()`，保证分支跳过栈与当前选择一致。
- 小春/芦花线特殊处理：如果 `rok==1` 且已经过 507，跳转下一选项会进入 `route_roka` 的第一个未选选择，而不是误跳小春分支。

菜单踩坑：

- “下一个选择支”不能简单找 `choices_all` 里行号大于当前行的第一个，否则在 サブ线芦花分支会跳到小春分支后面的选择。
- 回退上一句不应该重播语音，`applyCurrentLine(false)` 更稳。
- 菜单按钮从 4 个变 6 个后，旧 CSS 一行 4 个会挤爆，必须改成两行。

### 9. 特效黑屏与持续时间修复

用户反馈：所有特效（转场、人物震动等）持续时间不对；特效会变成黑屏，点一下才恢复。

我定位到几个问题：

1. 旧 `fxTween` / `fxShake` 依赖 `Date.now()`，设备端时间接口或精度异常时，进度可能停在初始值。
2. 旧 `runLineFx` 每句都 `clearFx()`，把黑屏状态直接清掉；但又会在转场事件里把 `fxBlack` 设成 1/0.85/0.7。如果动画没有正常推进，就会卡黑屏。
3. 黑/白覆盖层用 `opacity` 数字动态变化，设备端渲染可能不如 `backgroundColor: rgba(...)` 稳。
4. 默认背景切换也做黑屏淡入，容易把普通剧情推进也变成黑屏。

修复：

- 改成 tick 驱动：`_fxAnim.segments`，每 33ms 推进，不依赖 `Date.now()`。
- `fxTicks(ms)` 对 `NaN`、负数、非数字做兜底，避免 `a.end=NaN` 导致定时器永远不清。
- 无显式 F/f/T 事件时，不再做默认黑屏动画，只直接同步黑屏状态。
- `dur <= 0` 的事件直接赋值，不创建 interval。
- 黑屏/白闪渲染改为 `rgba(0,0,0,op)` / `rgba(255,255,255,op)`。
- 转场 `T` 用“黑屏下潜再恢复”的近似动画，避免卡在黑屏。
- 每次新句只清 transient 特效，保留必要黑屏状态；如果当前行有可见背景/CG，则把黑屏拉回 0。
- 增加测试，避免 Node 测试进程因 interval 不退出而卡住。

特效踩坑：

- 测试卡住比真机 bug 更早暴露了 `a.end=NaN` 的问题。`Math.max(1, NaN)` 仍是 `NaN`，必须显式 `isFinite`。
- 不能把“转场”简单理解成黑屏。原版有 wipe/rule 转场，但词典笔端没有完整 mask 渲染，只能做可接受的近似。
- 黑屏是跨句状态，但也不能无限保留；否则用户点一下才恢复，体验极差。

### 10. Windows 离线更新包

用户要求做一个能在学校离线 Windows 电脑上直接安装/更新词典笔的包。之前另一个 AI 做过一版，但没包含最新场景鉴赏、立绘、菜单、流程图、特效修复。

我检查并更新：

- `/Volumes/500GB/Ydpen/senren_banka_windows_update`
- 最终包：`/Volumes/500GB/Ydpen/senren_banka_windows_update_20261027_v3.zip`
- SHA256：`034667dfd97713f796bca0a88c5d2818c6ed9e50dbf9f171f060ae6c2186ccab`
- 大小：425,052,440 bytes

包内：

- Windows `adb.exe` + DLL。
- 嵌入式 Python 3.11。
- 31 个扁平化 JS 模块。
- 5 个资源 tar：
  - `cg_ext.tar` 101 张 CG
  - `scene_variants.tar` 182 张场景表情差分
  - `sd_device.tar` 295 张 SD
  - `fx_assets.tar` 16 张 FX
  - `monster_assets.tar` 1 张祟り神
- `scripts/installer.py`
- `scripts/pack_amr.py`
- `payload/jsfmc` 备用
- `payload/libs/libjsapi_gal.so`
- 中英文入口 bat。

安装器逻辑：

- `--assets-only`：只推资源。
- `--install-app --with-assets`：先推资源，再用笔上 jsfmc 编译 31 个模块，生成 `.amr`，备份存档，uninstall 旧版，install 新版，启动。
- 自动检测 USB/LAN ADB，支持输入 IP。
- 资源数量不足会停止，不会继续装 App。

Windows 包踩坑：

- 旧包只推资源不会让新功能出现，因为 App 还是旧版。README 必须强调要跑“一键更新 App 并推送资源”。
- 旧包 `payload/stage` 没有 `GalleryScenes.js`，`installer.py` 也只校验 4 个资源包。
- macOS 的 `._*` AppleDouble 会被 `pack_amr.py` 打进 AMR。修复：`pack_amr.py` 跳过 `._*` 和 `.DS_Store`。
- 嵌入式 Python 的 `_pth` 不能依赖系统 site-packages；脚本只用 stdlib。
- 真机编译依赖笔上 `jsfmc` 和 `libquickjs.so`。包内有备用 `payload/jsfmc`，但如果固件缺库仍会失败，需要保留 `install.log`。
- 500GB 盘曾在会话中掉线，最终包必须在掉线前完成校验；重新挂载后要再核对路径和 SHA256。

---

## 四、测试与验收

### 离线测试

当前全部 Node 测试通过：

- `test_afterstory.mjs` 19/19
- `test_audio_settings.mjs` 11/11
- `test_choices.mjs` 8/8
- `test_flowchart.mjs` 6/6
- `test_fx.mjs` 3/3
- `test_gallery_layout.mjs` 11/11
- `test_reactive_state.mjs` PASS
- `test_route_branch.mjs` 25/25
- `test_storage_scenario.mjs` PASS
- `test_title.mjs` 10/10

Python 测试：

- `python3 -m unittest discover -s tools -p 'test_*.py'` 通过。

Windows 包模拟：

- 用假 ADB 跑过 `--install-app --build-only`：
  - 31/31 模块“编译”成功；
  - AMR manifest/cert 校验通过；
  - `GalleryScenes.js.bin` 在包内。
- 用假 ADB 跑过 `--assets-only`，确认 5 个资源包流程会逐个推送/解压/计数。
- 真实 Windows + 词典笔尚未由我验证，需要用户/试玩 Agent 实测。

### 真机验收重点

后续真机必须验：

1. 标题页进入鉴赏，确认 4 个 tab：CG / 场景 / 立绘 / 音乐。
2. 场景鉴赏：6 个女主组、24 个场景、表情 prev/next 不卡黑屏。
3. 立绘鉴赏：7 个角色、服装按钮、表情循环。
4. 游玩菜单：
   - 回退上一句；
   - 跳至下一选项；
   - 在サブ线芦花分支不能误跳小春后续选择。
5. 流程图：
   - 共通线不出现 CHAPTER 2-2/2-3；
   - 个人线选择节点能跳到精确选择行。
6. 特效：
   - 转场不再点一下才恢复；
   - 震动/白闪持续时间接近原版；
   - 黑屏只在原版该黑的地方出现。
7. 音频：
   - BGM + voice 同时存在；
   - 只有一个 `pcmC1D0p`；
   - `/tmp/gal_gs_mixer.log` 无持续错误。

---

## 五、我犯过或差点踩到的错

1. **把“路径字符串能生成”当成“文件存在”**。早期立绘差分 100% 命中的说法不严谨，实际必须做存在性回退。
2. **一开始用裁剪后的剧本数据**，导致芳乃线行数从 9790 变成 8189。后来改用 `assets_ready/scenario` 全量 92 文件。
3. **选择支只跳转不跳过另一支**，导致分支串播。必须做 skip stack。
4. **后日谈数据列数没有跟主线一起升级**，导致 `row[9]` 越界。
5. **流程图只靠 CHAPTER 标题跳转**，个人线部分节点会跳错；必须 scenario + 行号表 + 特例节点。
6. **音频修复只改 JS 不够**，根因在原生 GStreamer/ALSA。
7. **SD 最初铺满舞台**，用户纠正后才改成叠加 contain，保留四周场景。
8. **Gallery 最初平铺 CG**，用户要求像后日谈一样可滑动 + 上一页/下一页。
9. **场景鉴赏最初以为要回放场景**，后来按用户描述实现为图片差分鉴赏。
10. **Windows 包不能只复制旧包**，必须重新生成 `payload/stage`、更新 installer、重算 checksums。
11. **macOS 元数据会污染包**：`._*`、`.DS_Store`、NFD 文件名、exFAT 权限都会造成“本地正常、设备/Windows 不正常”。
12. **子 Agent 会静默停止**。后来要求每个阶段写 progress log，主代理定时检查。
13. **上下文压缩后不能凭记忆写交付**。必须读 transcript、工程文件和测试输出。
14. **测试进程可能因 interval 不退出**。FX tick 的 `NaN` 会让 Node 测试卡住，必须兜底。
15. **不能在外部试玩 Agent 跑真机时同时安装/点击**，否则日志和声卡状态不可信。

---

## 六、当前交付状态

已完成并打包：

- 场景鉴赏：24 个原版场景，182 张表情差分。
- 立绘鉴赏：7 名角色，服装/表情差分。
- 菜单跳转/回退。
- 流程图只显示选项/分支节点。
- FX tick 驱动修复，降低黑屏卡住风险。
- Windows 离线 v3 包生成并通过模拟校验。

仍需真机确认：

- 设备端 FX 动画实际时长。
- 立绘差分是否全部存在（缺图时需回退）。
- 场景差分图片在 800×220 舞台里的观感。
- Windows USB ADB 驱动是否能识别；识别不了则用局域网 ADB。
- 真实 `jsfmc` 编译 31 个模块是否全部通过。

---

## 七、给后续 AI 的最低限度检查清单

1. 先读 `AGENT_COMM.md`，确认外部试玩/资源 Agent 是否正在操作设备。
2. 跑：
   ```bash
   cd /Volumes/500GB/Ydpen/senren_banka
   for f in tools/test_*.mjs; do node "$f"; done
   python3 -m unittest discover -s tools -p 'test_*.py'
   ```
3. 改任何 App 代码后，必须重新生成 Windows 包 stage：
   ```bash
   python3 build.py --stage-only
   rsync -a --delete build/stage/ /Volumes/500GB/Ydpen/senren_banka_windows_update/payload/stage/
   ```
4. 打 Windows 包前清理：
   ```bash
   find . -name '._*' -delete
   find . -name '.DS_Store' -delete
   rm -rf dist work
   ```
5. 资源 tar 必须过滤 AppleDouble，并设置 tar header mode 0644。
6. 真机验证只读优先，不要随意清 `/userdisk`。
7. 不要上传游戏资源到 GitHub。
8. 不要把“离线测试通过”说成“真机通过”。
