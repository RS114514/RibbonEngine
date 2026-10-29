# 视觉小说游戏级 Node VM 自动化测试套件模板 (Game-Level Test Templates)

本目录包含从《魔女的夜宴》移植实战中提炼沉淀的 6 套高质量游戏逻辑与 UI 单元自测脚本（基于 Node.js 内置 test runner 与 vm modules）。

## 包含的测试用例

1. **`test_choices_ui.mjs`**：
   - 测试选择支双栏两步确认机制（选中高亮、确定生效）；
   - 测试改选逻辑（反向扣除旧好感、累加新好感、动态重算路线）；
   - 测试流程图重入选择支弹窗与状态恢复；
   - 验证路线专属选择支与共有线跳过逻辑。

2. **`test_core_ui.mjs`**：
   - 验证标题画面、游玩主界面、存读档界面的数据流动与响应式状态；
   - 验证文本框、快捷操作栏、历史记录（Backlog）真实访问队列。

3. **`test_flowchart_ui.mjs`**：
   - 验证流程图节点生成、已读状态判定、节点连线逻辑；
   - 验证从流程图直接跳转到目标行号及环境上下文初始化。

4. **`test_gallery_ui.mjs`**：
   - 验证鉴赏四 Tab（CG、场景回顾、立绘、音乐）数据绑定；
   - 验证 CG 解锁判定与 16:9 画廊特写背景样式；
   - 验证 BGM 试听与播放控制逻辑。

5. **`test_afterstory_ui.mjs`**：
   - 验证后日谈/个人线入口卡片生成与启动流程；
   - 验证独立剧本与专属存档上下文的隔离机制。

6. **`test_nene_restart.mjs`**：
   - 验证通关后主界面“二周目独立重启入口”（如魔女夜宴宁宁线重启仪式）；
   - 验证通常周目开始与二周目重启的隔离与标志位清理。

## 如何在新游戏移植中使用

当转换工具生成了目标游戏的 `app/data/story_data.js`、`choices_all.js`、`flowchart_data.js` 并执行 `python3 build.py` 生成了前端包之后：

1. 将本目录下的测试用例复制到目标移植工程的 `tools/` 目录下；
2. 根据目标游戏的路线名称、分支行号调整具体的测试参数；
3. 执行以下命令运行测试：
   ```bash
   node --experimental-vm-modules tools/test_choices_ui.mjs
   node --experimental-vm-modules tools/test_flowchart_ui.mjs
   node --experimental-vm-modules tools/test_gallery_ui.mjs
   node --experimental-vm-modules tools/test_afterstory_ui.mjs
   node --experimental-vm-modules tools/test_core_ui.mjs
   node --experimental-vm-modules tools/test_nene_restart.mjs
   ```
