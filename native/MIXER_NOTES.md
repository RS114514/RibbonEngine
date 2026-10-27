# 原生软件 PCM 混音说明（native/gal_gs.c）

> 状态（2026-10-26）：**已交叉编译、已安装到真机、BGM 管线与语音解码/混音冒烟验证通过**。
> 受用户“不外放”约束，验证时 BGM 音量临时置 0；实际听感（语音+BGM 同时外放）仍待用户清醒后确认。

---

## 1. 为什么改成软件混音

设备（有道词典笔 X6 Pro / RK3562 / Linux 5.10）的真机固件：

- `/usr/lib/gstreamer-1.0/` **没有** `libgstaudiomixer.so`，也 **没有** `libgstadder.so`；
  `gst-inspect-1.0 audiomixer` 返回 `No such element or plugin 'audiomixer'`。
- ALSA dmix 也不可用（内核缺少 dmix 需要的硬件 timer）。

因此旧方案（BGM/Voice/SE 各自 `alsasink`，或使用 mixer 元素）都会失败：

- 各自 `alsasink` 会争抢 `/dev/snd/pcmC1D0p`，后播放者报 `Device 'default' is busy`；
- `audiomixer`/`adder` 回退都不存在，混音 pipeline 根本建不起来，声卡始终 `closed`。

新方案只在 C 层做软件混音，GStreamer 只负责解码和最终 ALSA 输出。

---

## 2. 架构

```
[BGM   branch]  filesrc ! decodebin ! audioconvert ! audioresample ! capsfilter ! appsink ┐
[Voice branch]  filesrc ! decodebin ! audioconvert ! audioresample ! capsfilter ! appsink ┤
[SE    branch]  filesrc ! decodebin ! audioconvert ! audioresample ! capsfilter ! appsink ┤
                                                                                          │
                     mixer 线程每 20ms 用 gst_app_sink_try_pull_sample() 取 PCM，          │
                     int32 累加 + 饱和截断，BGM 音量/ducking 在 C 层计算                    │
                                                                                          ▼
                     appsrc ! queue ! audioconvert ! audioresample ! capsfilter ! alsasink
```

- 每个声部是**独立 GstPipeline**；停止一路只销毁自己的 pipeline，不影响其它声部。
- 所有声部统一输出 `audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved`。
- 输出端只有**一个** `alsasink`；空闲 3s 后销毁输出 pipeline，释放独占声卡。
- 视频仍保留旧的独立 pipeline（`openVideo`），未接入混音器；视频音轨与混音器同时使用
  可能争用 ALSA，这是已知限制（当前 JS 未调用 `openVideo`）。

---

## 3. 关键实现

### 3.1 声部分支

`audio_branch` 持有：

- `pipeline` / `src` / `decode` / `conv` / `res` / `capsfilter` / `appsink` / `bus`；
- `link_pad`（`conv:sink`），用于 `decodebin` 的 `pad-added` 动态链接；
- PCM pending 缓冲（`pcm/pcm_len/pcm_pos/pcm_cap`，上限 4 MiB）；
- `app_eos`（appsink 已 EOS）、`eos`（pending PCM 也播完）、`failed`、`last_buffer_ms`；
- `loop` / `restarts` / `volume` / `played_frames`。

创建顺序：

1. `gst_pipeline_new` + `gst_object_ref_sink`（新建 pipeline 是浮动引用）；
2. 创建 `filesrc / decodebin / audioconvert / audioresample / capsfilter / appsink`；
3. `filesrc ! decodebin`，`audioconvert ! audioresample ! capsfilter ! appsink`；
4. `decodebin` 的 `pad-added` 在启动前连接，只接 `audio/` 前缀 pad；
5. appsink：`max-buffers=16`、`drop=false`、`sync=false`、`emit-signals=false`；
6. `set_state(PLAYING)`。

销毁顺序：`active=0` → `set_state(NULL)`（等待流线程退出）→ 断开信号 → unref pad/bus →
unref pipeline → 清 PCM。

### 3.2 mixer 线程

- 每 `GAL_TICK_MS=20ms` 持 `g_mutex` 执行一次 `mixer_tick_locked()`：
  1. `audio_service_locked()`（延迟停止、bus error、EOS/失败、空闲释放）；
  2. 对每个声部 `branch_pull_locked(need=3840B)`；
  3. `mix_block_locked()`；
  4. `push_block_locked()` 推入 appsrc；
  5. 再 `audio_service_locked()` 处理本块刚播完的声部。
- 混音块：960 帧 × 2ch × S16 = 3840B（20ms）。
- 未到 EOS 时先攒满一个块再混，避免解码抖动造成逐块破音。
- PCM 累加用 `int32`，输出饱和到 `[-32768, 32767]`。
- BGM 音量 = `g_bgm_volume × (voice 活跃 ? GAL_BGM_DUCK_FACTOR : 1.0)`；
  Voice/SE 用各自 `volume`。

### 3.3 EOS、循环与空闲释放

- `gst_app_sink_is_eos()` 判定 appsink EOS；先播完 pending PCM，再置 `eos=1`。
- BGM `eos` 且 `loop`：`branch_stop + branch_start` 重建（循环点约几十~百毫秒间隙）；
  连续重建最多 5 次，播放超过 10s 后重置计数。
- Voice/SE `eos`：直接回收。
- 无任何业务声部且空闲 3s：销毁输出 pipeline，`alsasink` 关闭设备句柄；
  下一次 `playBgm/playVoice/playSe` 自动重建。
- 无业务声部但输出 pipeline 仍在时，mixer 继续推静音块，保持时钟/ALSA 连续。

### 3.4 Voice Ducking 兼容

现有 JS 在每句语音前执行 `stopBgm()`，再 `playVoice()`。原生 `stopBgm()`：

- 不立即销毁，设置 `g_bgm_stop_pending=1`，截止时间 `now+150ms`；
- 150ms 内 `playVoice()` 到达：取消停止，BGM 继续原位播放，混音时压到 45%；
- 150ms 内没有后续调用：mixer 线程真正停止 BGM；
- 连续第二次 `stopBgm()`：立即停止；
- 语音结束 JS 回填 `playBgm(同路径)`：命中“同路径不重启”，只更新 loop/volume。

### 3.5 status 契约

`gal.status()` 返回：

- `bgm`: BGM branch 存在且没有待停止请求；
- `voice`: Voice branch 存在且 `eos` 为 false；
- `voicePosMs`: 已混入输出的语音帧数 × 1000 / 48000；
- `voiceDurMs`: 对 Voice pipeline 查询 duration，失败返回 0。

JS 只用 `voice` 布尔值推进剧情；`voicePosMs/voiceDurMs` 仅作辅助。

---

## 4. 构建

设备运行库已拉到缓存盘用于链接期生成正确的 `DT_NEEDED`：

```
/Volumes/500GB/qoder_cache/senren_banka/native_libs/
  libgstapp-1.0.so.0
  libgstreamer-1.0.so.0
  libgobject-2.0.so.0
```

Zig 0.17 工具链在：

```
/Volumes/500GB/qoder_cache/senren_banka/zig_toolchain/ziglang/zig
```

编译命令：

```bash
cd /Volumes/500GB/Ydpen/senren_banka
ZIG=/Volumes/500GB/qoder_cache/senren_banka/zig_toolchain/ziglang/zig
LIBS=/Volumes/500GB/qoder_cache/senren_banka/native_libs
$ZIG cc -target aarch64-linux-gnu.2.29 -O2 -g0 -fPIC -shared -fvisibility=hidden -Wl,-s \
  -I /Volumes/500GB/Ydpen/ydpen-toolkit/assets/quickjs \
  -o libs/libjsapi_gal.so native/gal_gs.c \
  $LIBS/libgstapp-1.0.so.0 $LIBS/libgstreamer-1.0.so.0 $LIBS/libgobject-2.0.so.0 -lpthread
```

产物核对：

- `file libs/libjsapi_gal.so` → `ELF 64-bit LSB shared object, ARM aarch64`；
- `DT_NEEDED` 应包含 `libgstapp-1.0.so.0`、`libgstreamer-1.0.so.0`、`libgobject-2.0.so.0`；
- 导出 `custom_init_jsapis`（`nm -D` / ELF 动态符号表）。

`build.py` 会自动把 `libs/libjsapi_gal.so` 打进 `arm64` 与 `arm64-orange` 并打包 `.amr`。

---

## 5. 真机验证记录（2026-10-26）

### 5.1 独立冒烟（不经过 miniapp）

设备端测试程序：

- 真实 `/userdisk/gal_data/voice/sample_voice.ogg` → 192000B PCM，非零样本 95756；
- 真实 `/userdisk/gal_data/bgm/sample_bgm.opus` → 192000B PCM，非零样本 95738；
- 软件混音输出非零样本 95907；
- `appsrc -> alsasink` 推 0.5s 静音时 `/proc/asound/card1/pcm0p/sub0/status` = `RUNNING`；
- 结束后声卡回到 `closed`。

结论：固件具备 `decodebin/ogg/opus/audioconvert/audioresample/appsrc/appsink/alsasink`，
不需要 `audiomixer`/`adder`。

### 5.2 安装后真机

- 日志 `/tmp/gal_gs_mixer.log`：
  - `output pipeline ready (appsrc/appsink software mixer)`
  - `branch 0 started path=/userdisk/gal_data/bgm/sample_bgm.opus`
  - 无 `bus error` / `state failure` / `stalled` / `missing` / `refused`；
  - BGM 约 11.6s 一次 `branch 0 started` + `bgm restart #1 (eos)`（正常循环重建）。
- `/proc/asound/card1/pcm0p/sub0/status` = `RUNNING`，`owner_pid` 为 miniapp。
- `/proc/$(pidof miniapp)/fd` 中只有一个 `/dev/snd/pcmC1D0p` 播放句柄（另有 controlC1）。
- 退出应用后 `bgm stop (deferred)` → `output idle -> release ALSA`，声卡 `closed`。

### 5.3 静音约束说明

验证期间临时把 `/userdisk/gal_data/my_game/settings.json` 的 `bgmVolume` 改为 0，
保证全程不外放；验证结束后已按原字节恢复（MD5 `c1f1fe71425b0d9f56c8d24d53e8c48b`），
应用退出，声卡释放。**没有修改用户存档或清除数据。**

---

## 6. 待确认 / 已知限制

1. **实际听感**：语音与 BGM 同时外放、BGM 压低/恢复、首字延迟尚未由人耳确认；
   用户清醒后读取第 60 句芦花存档即可验证。
2. **起播延迟/吞字**：若首字被吞，调整 `GAL_BLOCK_FRAMES`（增大块）或减小
   `queue max-size-time`；若语音慢半拍，检查 mixer 线程调度与 appsink `max-buffers`。
3. **BGM 循环间隙**：采用 EOS 重建，循环点有几十~百毫秒间隙；若要无缝，可改用 seek
   并重新校准时间戳。
4. **视频音频冲突**：`openVideo` 仍自带独立 `alsasink`，与混音器同时使用可能争用声卡；
   当前 JS 未调用。
5. **CPU/内存**：每声部 appsink + 20ms 混音，48kHz 立体声开销很小；PCM pending 上限 4 MiB/声部。
6. **stopBgm 延迟语义**：单次 stopBgm 会晚 150~230ms 生效；这是为兼容未改 JS 的
   Voice Ducking 序列而保留的有意设计。

---

## 7. 可调参数速查

| 宏 | 默认值 | 作用 |
| --- | --- | --- |
| `GAL_BGM_DUCK_FACTOR` | `0.45` | 语音期间 BGM 音量系数；1.0 关闭压低 |
| `GAL_BGM_STOP_GRACE_MS` | `150` | stopBgm 延迟停止窗口；0 = 立即停止 |
| `GAL_BRANCH_STALL_MS` | `2500` | 无 buffer 判定卡死的阈值 |
| `GAL_BGM_MAX_RESTARTS` | `5` | BGM 连续重建上限 |
| `GAL_BGM_RESTART_RESET_MS` | `10000` | 播放超过该时长后重置重建计数 |
| `GAL_TICK_MS` | `20` | mixer 线程周期 |
| `GAL_IDLE_RELEASE_MS` | `3000` | 无业务声部后释放 ALSA 的空闲时间 |
| `GAL_BLOCK_FRAMES` | `960` | 20ms 混音块帧数 |
| `GAL_PCM_CAPS` | S16LE/48k/2ch | 全链路 PCM 格式 |
