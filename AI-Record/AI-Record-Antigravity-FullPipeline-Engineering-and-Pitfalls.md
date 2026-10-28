# 有道词典笔《千恋＊万花》全流程移植、解包流水线与核心避坑实战录

- **作者代号 / Agent 标识**：`Antigravity-Pipeline-Engineer`（反重力平台·工程流水线与资产架构代理）
- **会话唯一标识 (Conversation ID)**：`35b3c1b9-5520-4af1-b6a7-e9405b5f1214`
- **执行时间跨度**：2026-10-24 ~ 2026-10-27
- **归档路径**：`/Volumes/500GB/Ydpen/senren-banka-ydpen-port/AI-Record/AI-Record-Antigravity-FullPipeline-Engineering-and-Pitfalls.md`
- **目标设备**：网易有道词典笔 X6 Pro（型号：YDPX6-2 / 瑞芯微 Rockchip RK3562 / aarch64 Linux 5.10 / Weston Wayland / 物理分辨率 960×266 / Falcon 逻辑视口 800×220 / 业务 AppID `8002026102400099`）
- **项目定位**：基于词典笔通用底层引擎（`gal-dictionary-pen-engine`），实现《千恋＊万花》全角色线路、双轨混音与高清视觉适配的独立开源移植工程（`senren-banka-ydpen-port`）及自动化资产转换流水线。

---

## 一、 项目背景与搞机摸排历程

在本次长对话会话周期中，整个工程经历了从底层视频播放器探索到完整 Galgame 移植的演进过程：

1. **底层探索阶段（步骤 0 ~ 520）**：
   - 最早针对词典笔 YDPX6-2 的显示子系统（Wayland-Weston）、触摸设备（`/dev/input/event1`）和底层图形输出进行了逆向与调优；
   - 验证了通过交叉编译原生 C 动态库（如 `player_gs.c`）结合 Falcon 小程序前端实现硬件交互的可行性。

2. **千恋万花可行性评估与规划（步骤 523 ~ 627）**：
   - 用户提出在词典笔上移植运行《千恋＊万花》PC 电脑版的需求，要求针对 960×266 极端长宽比（3.61:1）超宽带鱼屏进行重新设计与触控适配；
   - 评估了原版 Steam 加密资源（`PackinOne.dll` 结合 ChaCha 流密码）与移动端免加密资源的解包差异；
   - 确立了“本地内置磁盘零污染、所有运算与大文件完全依托外部 500GB 硬盘”的操作铁律。

3. **前端 GUI 与和风交互实现（步骤 919 ~ 3130）**：
   - 基于 QuickJS 与 Falcon 框架重构全套游戏 UI，严格还原柚子社（Yuzusoft）日式和风美学；
   - 实现了主界面、剧情对话框、Log 履历回溯、存读档系统及二级确认交互。

4. **剧本、立绘与多媒体全量推进（步骤 3131 ~ 6300）**：
   - 接入 92 篇官方完整剧本，构建包含 51 个选择支与合流逻辑的分支树流程图；
   - 搭建角色立绘多图层差分多核合成系统，解决视口比例与裁切异常；
   - 编写原生软件混音库解决声卡独占冲突，实现 BGM 与 Voice 并发播放及语音避让；
   - 深度挖掘全量全屏 CG（含无修正名场面）与 SD Q 版二头身素材。

5. **独立开源仓库解耦与三端协同（步骤 6318 ~ 6600）**：
   - 独立解耦出《千恋＊万花》移植仓库（`senren-banka-ydpen-port`），将通用视觉小说底层抽离至 `gal-dictionary-pen-engine`，并更新主开发仓库 `ydpen-hacking`；
   - 研发一键全自动转换工具 `import_and_install.py` 与防遗漏对账看门狗 `audit_assets.py`，完成三仓库全量公开推送。

---

## 二、 对该项目所做的具体工作与功能实现

针对本项目的移植工作涵盖了从资产提取、格式转换、渲染合成到真机部署的完整闭环，具体工作如下：

### 1. 原版 XP3 全量解包与 8 大类资产分类整理
编写了原生 Python 解包工具 [`tools/unpack_xp3.py`](file:///Volumes/500GB/Ydpen/senren-banka-ydpen-port/tools/unpack_xp3.py)，直接解析免加密版 XP3 归档索引表，并将资产自动分类至 `/Volumes/500GB/千恋万花_移植资源库/assets_ready/`：
- **`characters/fgimage/`**：1,793 个文件，涵盖 芳乃、茉子、ムラサメ、レナ、小春、芦花、みづは、廉太郎、玄十郎、安晴、比奈実、心子 等 12 个角色的分层素材；
- **`bg/bgimage/`**：97 张原版游戏场景背景；
- **`cg/evimage/` & `other/`**：101 套核心全屏名场面 CG 及去修资源；
- **`cg/evimage/SD/`**：359 张 Q 版二头身角色小人图；
- **`audio/voice/`**：35,268 条角色台词语音（Ogg/Opus）；
- **`audio/bgm/`**：103 首背景音乐曲目；
- **`audio/se/`**：407 个环境与动作音效；
- **`scenario/`**：313 个剧本文件（包含 92 篇 `.scn` 核心章节）；
- **`ui/` & `system/`**：313 项界面图标、缩略图与转场特效定义。

### 2. 角色立绘多图层差分多核合成流水线
原版游戏在 XP3 中不存储整张现成的人物立绘，只有身体素体、面部五官表情、前发遮罩及服装等独立图层碎片。为此开发了：
- [`tools/composite_all_fgs.py`](file:///Volumes/500GB/Ydpen/senren-banka-ydpen-port/tools/composite_all_fgs.py) 与 [`tools/composite.swift`](file:///Volumes/500GB/Ydpen/senren-banka-ydpen-port/tools/composite.swift)；
- 解析官方 `_info.txt` 与 `_0.txt` 的图层坐标偏移 `(x, y, w, h)`；
- 采用 CoreGraphics 并行绘制，自底向上严格按 PSD 层级合成，并统一输出为 **780×440（Retina 2x 舞台画布）透明底 PNG**，总计导出 **1,274 张立绘差分**；
- 支持游戏前端在 800×220 视口下根据台词情绪动态切换表情。

### 3. 场景背景高清重制与全屏 CG 转换
- **背景重制**（[`tools/convert_all_bgs.py`](file:///Volumes/500GB/Ydpen/senren-banka-ydpen-port/tools/convert_all_bgs.py)）：解决官方文件 WebP 伪装成 PNG 的问题，使用 Lanczos 算法重采样统一转换为 **960×540（16:9 标准尺寸）**，消除词典笔端的拉伸锯齿；
- **全屏 CG 转换**（[`tools/convert_all_cgs.py`](file:///Volumes/500GB/Ydpen/senren-banka-ydpen-port/tools/convert_all_cgs.py)）：调用 FreeMote 与图像转换工具，将 PIMG/TLG 格式转码为 **944×532** 高清 PNG，包含 6 位女主角专属剧情 CG 及去码版本；
- **SD 小人转码**（[`tools/convert_all_sds.py`](file:///Volumes/500GB/Ydpen/senren-banka-ydpen-port/tools/convert_all_sds.py)）：提取 359 张二头身素材，输出为带 Alpha 透明通道的真 RGBA PNG（944×566）。

### 4. 官方 92 篇剧本反编译与 Miniapp 驱动数据转码
编写 [`tools/convert_scenario.py`](file:///Volumes/500GB/Ydpen/senren-banka-ydpen-port/tools/convert_scenario.py)，将原版 `.scn` 脚本转码为词典笔前端数据：
- `app/data/chapter_all.js`：共通线全量 9,155 句主线台词与演出标记；
- `app/data/scn_*.js`：6 位女主角个人线独立剧本；
- `app/data/choices_all.js`：51 个选择支及分支合流跳过栈逻辑；
- `app/data/fx_events.js`：转场白闪、画面震动等事件触发定义。

### 5. 原生 C 软件混音库与音频矩阵部署
针对词典笔硬件声卡缺乏硬件混音的问题，编写并集成了原生动态库 `libjsapi_gal.so`：
- 以单音频句柄独占声卡设备，在用户态实现双声道 PCM 软件混音；
- 原生支持 BGM 与台词 Voice 并发回放；
- 实现 Voice Ducking 机制，在台词播放期间自动平滑压低 BGM 音量，台词播毕恢复；
- 编写 [`tools/sync_all_audio.py`](file:///Volumes/500GB/Ydpen/senren-banka-ydpen-port/tools/sync_all_audio.py) 将全量 35,268 条语音、103 首 BGM 与 407 个音效同步至设备 `/userdisk/SenrenBanka/audio/`。

### 6. 资产完整性对账看门狗（Zero-Missing Audit）
编写 [`tools/audit_assets.py`](file:///Volumes/500GB/Ydpen/senren-banka-ydpen-port/tools/audit_assets.py)：
- 自动遍历前端剧本中所有调用的立绘名、背景名、CG 编号和语音文件名；
- 与实际转换产物目录进行 1:1 比对校验，杜绝漏提素材引发的黑屏或 404 故障。

### 7. 独立开源仓库发布与 GitHub 三端同步
- 建立独立仓库 [`senren-banka-ydpen-port`](https://github.com/RS114514/senren-banka-ydpen-port)；
- 提供一键全自动管线 [`import_and_install.py`](file:///Volumes/500GB/Ydpen/senren-banka-ydpen-port/import_and_install.py)；
- 将底层通用逻辑抽离至 [`gal-dictionary-pen-engine`](https://github.com/RS114514/gal-dictionary-pen-engine)；
- 在主开发仓库 [`ydpen-hacking`](https://github.com/RS114514/ydpen-hacking) 的 README 中设立专题引流入口，完成多仓库公开推送。

---

## 三、 容易踩的坑（Pitfalls）与犯过的错误（Mistakes）复盘

在整个研发和移植过程中，遇到并纠正了多项典型问题与技术陷阱，具体整理如下：

### 坑一：玄十郎立绘头部被切掉（“头都没了”）——统一裁切高度引发的坐标偏移
- **问题现象**：真机运行主线第 388 句时，玄十郎登场立绘的头部、银发与额头完全消失，脖子以上被直接切平（用户反馈：“你要不要看看，头都没了”）。
- **原因剖析**：
  - 编写多图层合成脚本时，为了图省事，给所有角色套用了同一套基于女性角色的视口裁切参数（`cropY = 700+`）；
  - 芳乃、丛雨、小春、茉子等女性角色身材娇小，头部处于画布中间偏下区域；而玄十郎是成年男性角色，身材高大，面部与发型图层集中在整张原画的上半部分（Y 坐标在 490 附近）；
  - 通用的 Y 坐标直接穿过了玄十郎的下巴，导致头部整体位于视口外部，被 CoreGraphics 裁切丢弃。
- **纠正措施**：
  - 放弃全局统一切割坐标，在 `CHARACTER_CONFIGS` 中为每个角色建立专属的视口测量数据；
  - 将玄十郎的 `cropY` 修正为 **490.0**，同时适当加大视口高度与宽度，完整保留其银发、面部表情与双肩轮廓。

### 坑二：舞台视口人物被拉伸压扁变形——非等比缩放的几何失真
- **问题现象**：在全景舞台特写模式下，人物立绘被横向压扁或拉长成细长条，体态严重失调。
- **原因剖析**：
  - 词典笔逻辑视口比例为 800×220（约 3.64:1），属于极端的横向带鱼屏；
  - 前端早期代码在切换舞台模式时，直接给立绘容器赋予了固定百分比的高宽，浏览器引擎执行了填充拉伸（Stretch），破坏了原本的宽高比。
- **纠正措施**：
  - 确立 **780×440（Retina 2x 舞台画布，等比居中渲染）** 规范；
  - 绘制时强制维持原画宽高比（保持 Scale 一致），计算水平居中偏移量 `(Double(stageW) - drawW) / 2.0`，在透明画布两侧留白，杜绝非等比拉伸。

### 坑三：章节标题与 UI 文本自行捏造（“乱搞乱加名字”）——脱离原版数据的教训
- **问题现象**：早期版本在剧本转换与界面显示中，出现了“第 1 章（001・序章拔刀）”、“第 2 章（002・祟神真相）”、“第 3 章（003・巫女秘密）”等富有文学修饰但完全凭空捏造的章节名称；此外将官方菜单的“鉴赏”写成了“鉴赏之室”，并曲解了“日后谈”的逻辑定义。
- **原因剖析**：
  - 早期开发型 AI 为了让界面看起来“丰富”，未查阅官方源文件中的真实命名，而是根据剧情主观想象编造了修饰性标题；
  - 这种脱离事实的主观发挥严重破坏了移植版对原作的还原度，遭到了用户的严厉批评。
- **纠正措施**：
  - 彻底清理所有捏造的文本，严格以官方剧本元数据与脚本文件为唯一准绳；
  - 恢复官方章节规范，统一显示为 `CHAPTER 1-1`、`CHAPTER 1-2` 等纯正格式；
  - 纠正菜单文本为“鉴赏”，并依据剧本文件逻辑规范重新梳理 6 位女主角在通关后的“日后谈”独立入口。

### 坑四：主菜单界面遮挡千恋万花 Logo 与多余的音乐状态指示器
- **问题现象**：主菜单布局在居中排列按钮时，遮挡了背景壁纸正中央的“千恋＊万花”标题书法字体；右上角常驻了“音乐演奏中”字样，视觉突兀。
- **原因剖析**：
  - 界面排版没有充分考虑超宽屏幕横向空间的分布特征，盲目采用常规居中对齐，覆盖了核心美术资产；
  - 加入了多余且非原版存在的状态标签。
- **纠正措施**：
  - 调整主菜单控件布局，将按钮分散至屏幕两侧及底部空隙区域，避开正中 Logo；
  - 移除右上角的音乐文字指示器，还原清爽纯粹的和风主界面。

### 坑五：Linux ALSA 声卡独占冲突与 GStreamer 插件缺失陷阱
- **问题现象**：游戏进入剧情后完全没有声音，或者仅有 BGM 而所有角色没有语音；系统日志显示 `/dev/snd/pcmC0D0p: Device or resource busy`。
- **原因剖析**：
  - 词典笔 Linux 系统底层的 ALSA 驱动未配置软件混音器（dmix），处于排他性独占状态；
  - 精简版系统固件中缺失了 GStreamer 的 `audiomixer` 与 `adder` 等多流混音插件，无法依靠命令行管道混流；
  - 前端若同时通过两个独立实例播放音频，后打开的实例会因声卡被锁而静音或报错。
- **纠正措施**：
  - 不依赖系统上层多媒体插件，由单一句柄接管底层 PCM 输出；
  - 开发专用的原生 C 软件混音库 `libjsapi_gal.so`，在内存中动态叠加 BGM 与 Voice 的 PCM 采样点，并实现 Voice Ducking（语音播放时平滑降低 BGM 增益）。

### 坑六：素材提取偷工减料与逐批修补遗漏（“每次漏一点”）的顽疾
- **问题现象**：在过往开发中，多次出现“跑通第一章后，进入新章节就黑屏或立绘 404”的情况，导致每次发现缺素材就让 AI 临时补提几张，反复折腾；在向用户汇报时又习惯性地把复杂的全量流水线压缩为几个简单步骤。
- **原因剖析**：
  - 前期处理缺乏全局视角，仅针对当前测试断点进行局部提取，未在项目初期进行全量剧本静态依赖分析；
  - 依赖关系未形成自动化核验机制，人工巡检必然存在疏漏。
- **纠正措施**：
  - 开发静态依赖分析工具 `audit_assets.py`，全量扫描 92 篇剧本，提取 24,861 条台词语音、148 处 CG、89 处背景，与磁盘实际文件建立 1:1 对账矩阵；
  - 编写涵盖 10 大环节的一键全自动流水线 `import_and_install.py`，确保解包即全量、转换即全量。

### 坑七：Mac 本地磁盘空间耗尽风险与 500GB 硬盘的路径重定向
- **问题现象**：开发宿主机 Mac 内置固态硬盘可用空间极度吃紧（一度仅剩不足 6GB），而原版游戏、中间解包 TLG 图层与转换产物多达数十 GB。
- **原因剖析**：
  - 若 Python 脚本随意使用临时目录（如 `/tmp`、当前工程目录或系统缓存目录），会迅速撑爆本地系统盘，引发系统级写入崩溃。
- **纠正措施**：
  - 确立存储铁律：所有解包输出、中间缓存与最终媒体产物一律强制写入外置 500GB 硬盘（`/Volumes/500GB/`）；
  - 脚本中严格通过绝对路径重定向，禁止在项目根目录与系统盘生成未压缩的庞大图像与音频缓存。

### 坑八：ClashX 代理漏网之鱼与 Git 大包推送 RPC 缓存中断
- **问题现象**：
  1. 向 GitHub 推送时频繁抛出 `LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to github.com:443`；
  2. 仓库包含 FreeMote 和预编译库（7.7MB+）时，推送报 `error: RPC failed; curl 56 Recv failure: Connection reset by peer`。
- **原因剖析**：
  1. 本地 ClashX Meta 的路由规则中，`🐟 漏网之鱼` 默认走了 DIRECT（直连），导致 GitHub 443 连接被大陆运营商网络阻断；
  2. Git 默认的 HTTP postBuffer 过小，无法一次性发送大体积 Commit 数据包。
- **纠正措施**：
  1. 通过 Clash 外部控制器 RESTful API 将漏网之鱼规则临时切换为代理节点选择；
  2. 执行 `git config http.postBuffer 524288000` 将单次推送缓存扩容至 500MB，彻底消除 RPC 失败。

### 坑九：词典笔 ADB 调试官方密码授权机制
- **注意事项**：
  - 网易有道词典笔官方固件在出厂时对 ADB 接口施加了密码验证与设备签名保护；
  - 第三方使用者无法直接通过 `adb shell` 连入，必须在文档与说明中如实提醒：使用者需通过硬件串口引出或社区公开的提权方式自行获取 ADB 授权后，方可使用自动化安装与素材推送功能。

---

## 四、 核心工具脚本清单

| 脚本文件 | 功能说明 | 对应资产类型 |
| :--- | :--- | :--- |
| `import_and_install.py` | 全自动一键解包、转码、对账、构建与真机部署总控入口 | 全量资产 |
| `tools/unpack_xp3.py` | 纯 Python 实现的无加密 XP3 原生解包与多层归档分类器 | 原版 XP3 归档 |
| `tools/composite_all_fgs.py` | 角色立绘差分分层多核合成调度器（Retina 2x 780×440 画布） | 1,274 张角色立绘 |
| `tools/composite.swift` | 基于 CoreGraphics 的高性能多图层并行合成与视口裁切程序 | 立绘 TLG 图层 |
| `tools/convert_all_bgs.py` | WebP 伪装解码与 Lanczos 高保真场景背景缩放器 (960×540) | 97 张场景背景 |
| `tools/convert_all_cgs.py` | PIMG 反编译与全量全屏名场面/去码 CG 转换器 (944×532) | 101 套全屏 CG |
| `tools/convert_all_sds.py` | SD 二头身 Q 版角色小人真 RGBA 透明通道转换器 (944×566) | 359 张 Q 版素材 |
| `tools/convert_scenario.py` | 官方 92 篇 `.scn` 剧本转译与 51 个选择支/合流栈生成器 | 剧本与分支数据 |
| `tools/sync_all_audio.py` | 35,268 条语音、103 首 BGM 与 407 个音效设备同步工具 | 全量音频矩阵 |
| `tools/audit_assets.py` | 剧本资产静态调用 1:1 完整性审计对账看门狗 | 全量依赖完整性 |
| `build.py` | 词典笔 Miniapp 打包、签名与 ADB 自动化安装脚本 | `.amr` 应用包 |
