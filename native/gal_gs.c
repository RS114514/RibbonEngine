/*
 * gal_gs.c —— 词典笔视觉小说（Galgame）纯净 Galgame 引擎原生 C 插件
 *
 * 运行目标：网易有道词典笔 X6 Pro（RK3562 / aarch64 Linux 5.10 / Weston Wayland）
 *
 * 功能支持：
 *   1. 单进程软件 PCM 混音：BGM / Voice / SE 各自解码为 S16LE/48k/2ch，
 *      在 C 线程内逐样本混音后通过唯一 appsrc -> alsasink 输出。
 *      不依赖固件缺失的 audiomixer / adder，也不依赖 ALSA dmix。
 *   2. 硬件加速视频渲染：基于 GStreamer mppvideodec + waylandsink（保持原实现）
 *   3. 状态轮询：查询当前 BGM / Voice 播放状态与语音进度
 *   4. 本地存读档与数据透传：readText / writeText / probe
 *
 * ---------------------------------------------------------------------------
 * 音频架构（2026-10 真机插件可用性修正）
 * ---------------------------------------------------------------------------
 *
 *   设备固件 /usr/lib/gstreamer-1.0 内只有 audioconvert / audioresample /
 *   audiotestsrc / alsa / app / ogg / opus 等插件，没有 libgstaudiomixer.so，
 *   也没有 libgstadder.so。因此不能再使用 mixer 元素，改为：
 *
 *   [BGM   branch]  filesrc ! decodebin ! audioconvert ! audioresample ! capsfilter ! appsink ┐
 *   [Voice branch]  filesrc ! decodebin ! audioconvert ! audioresample ! capsfilter ! appsink ┤
 *   [SE    branch]  filesrc ! decodebin ! audioconvert ! audioresample ! capsfilter ! appsink ┤
 *                                                                                            │
 *                        mixer 线程用 gst_app_sink_try_pull_sample() 取 PCM，逐样本相加      │
 *                                                                                            ▼
 *                        appsrc ! queue ! audioconvert ! audioresample ! capsfilter ! alsasink
 *
 * 关键设计：
 *   - 每个声部独立 pipeline，互不影响；停止一路只销毁自己的 pipeline。
 *   - 所有声部统一解码成 S16LE/48k/2ch，混音就是 int32 累加 + 饱和截断。
 *   - BGM 音量与语音 ducking 在 C 混音循环中实时计算，无需 volume 元素。
 *   - 输出端只有一个 alsasink；空闲 3s 后销毁输出 pipeline 释放声卡。
 *   - 语音结束由 appsink EOS 检测；先播完 pending PCM 再回收，避免尾音被截断。
 *   - BGM 循环采用 EOS 后重建分支（行为确定，循环点有极短间隙）。
 *   - Voice Ducking 兼容：stopBgm() 保留 150ms 延迟窗口；窗口内 playVoice()
 *     到达则取消停止，BGM 继续原位播放并压低到 45%。
 *
 * 线程模型：
 *   - JS 调用线程与 mixer 线程共享 g_mutex；GStreamer 流线程只执行 pad-added
 *     链接回调，分支销毁时先 set_state(NULL) 等流线程退出。
 *   - mixer 线程每 20ms 锁定一次，拉取解码数据、混音并推入 appsrc。
 *
 * 注意：本文件只自声明所需的 GStreamer / GObject C API，不依赖开发头文件。
 */

#define _GNU_SOURCE 1

#include <quickjs.h>

#include <errno.h>
#include <pthread.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

extern void registerCModuleLoader(const char *name,
                                 JSModuleDef *(*loader)(JSContext *ctx, const char *module_name));

/* ------------------------------------------------------------------ GStreamer 自声明原型 */
/* 全部符号位于设备上的 libgstreamer-1.0.so.0 / libgobject-2.0.so.0 /
 * libgstapp-1.0.so.0。构建时链接设备库以写入正确的 DT_NEEDED。 */
extern void gst_init(int *argc, char ***argv);
extern void *gst_parse_launch(const char *pipeline_description, void **error);

extern void *gst_pipeline_new(const char *name);
extern int gst_bin_add(void *bin, void *element);
extern void *gst_element_factory_make(const char *factoryname, const char *name);

extern int gst_element_set_state(void *element, int state);
extern int gst_element_get_state(void *element, int *state, int *pending, unsigned long long timeout);
extern int gst_element_link_many(void *element_1, ...);

extern void *gst_element_get_static_pad(void *element, const char *name);
extern int gst_pad_link(void *srcpad, void *sinkpad);
extern void *gst_pad_get_current_caps(void *pad);

extern int gst_element_seek_simple(void *element, int format, int seek_flags, long long seek_pos);
extern int gst_element_query_duration(void *element, int format, long long *cur);

extern void *gst_element_get_bus(void *element);
extern void *gst_bus_pop_filtered(void *bus, int types);
extern void gst_message_unref(void *message);
extern void gst_message_parse_error(void *message, void **gerror, char **debug);

extern void *gst_caps_from_string(const char *string);
extern void *gst_caps_get_structure(void *caps, unsigned int index);
extern const char *gst_structure_get_name(void *structure);
extern void gst_caps_unref(void *caps);

extern void *gst_object_ref_sink(void *object);
extern void gst_object_unref(void *object);

extern void g_object_set(void *obj, const char *first_property_name, ...);
extern void *g_object_class_find_property(void *oclass, const char *property_name);
extern unsigned long g_signal_connect_data(void *instance, const char *detailed_signal,
                                           void *c_handler, void *data,
                                           void *destroy_data, int connect_flags);
extern void g_signal_handler_disconnect(void *instance, unsigned long handler_id);

extern void g_error_free(void *error);
extern void g_free(void *mem);

/* GstApp / GstBuffer：设备 libgstapp-1.0.so.0 / libgstreamer-1.0.so.0 */
extern void gst_app_sink_set_max_buffers(void *appsink, unsigned int max);
extern void gst_app_sink_set_drop(void *appsink, int drop);
extern void *gst_app_sink_try_pull_sample(void *appsink, unsigned long long timeout);
extern int gst_app_sink_is_eos(void *appsink);

extern void gst_app_src_set_caps(void *appsrc, void *caps);
extern void gst_app_src_set_stream_type(void *appsrc, int type);
extern int gst_app_src_push_buffer(void *appsrc, void *buffer);

extern void *gst_buffer_new_allocate(void *allocator, size_t size, void *params);
extern size_t gst_buffer_fill(void *buffer, size_t offset, const void *src, size_t size);
extern size_t gst_buffer_get_size(void *buffer);
extern size_t gst_buffer_extract(void *buffer, size_t offset, void *dest, size_t size);
extern void gst_buffer_unref(void *buffer);

extern void *gst_sample_get_buffer(void *sample);
extern void gst_sample_unref(void *sample);

/* ------------------------------------------------------------------ GStreamer 常量 */
#define GST_STATE_NULL 1
#define GST_STATE_READY 2
#define GST_STATE_PAUSED 3
#define GST_STATE_PLAYING 4
#define GST_FORMAT_TIME 3
#define GST_SEEK_FLAG_FLUSH 1
#define GST_SEEK_FLAG_KEY_UNIT 4

#define GST_STATE_CHANGE_FAILURE 0
#define GST_MSG_EOS 1
#define GST_MSG_ERROR 2

#define GST_PAD_LINK_OK 0
#define GST_FLOW_OK 0

#define GST_CLOCK_TIME_NONE 0xffffffffffffffffULL

#define NS_PER_MS 1000000LL
#define NS_PER_SEC 1000000000LL

/* ------------------------------------------------------------------ 混音调参 */
#define GAL_BGM_DUCK_FACTOR 0.45
#define GAL_BGM_STOP_GRACE_MS 150
#define GAL_BRANCH_STALL_MS 2500
#define GAL_BGM_MAX_RESTARTS 5
#define GAL_BGM_RESTART_RESET_MS 10000
#define GAL_TICK_MS 20
#define GAL_IDLE_RELEASE_MS 3000

#define GAL_RATE 48000
#define GAL_CHANNELS 2
#define GAL_FRAME_BYTES 4
#define GAL_BLOCK_FRAMES 960
#define GAL_BLOCK_BYTES (GAL_BLOCK_FRAMES * GAL_FRAME_BYTES)
#define GAL_MAX_PCM_BYTES (4 * 1024 * 1024)
#define GAL_PCM_CAPS "audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved"

/* ------------------------------------------------------------------ 声部定义 */
enum {
    GAL_BGM = 0,
    GAL_VOICE = 1,
    GAL_SE = 2,
    GAL_KIND_COUNT = 3
};

typedef struct audio_branch {
    int kind;
    volatile int active;

    void *pipeline;     /* GstPipeline，本分支独立 pipeline */
    void *src;          /* filesrc */
    void *decode;       /* decodebin */
    void *conv;         /* audioconvert */
    void *res;          /* audioresample */
    void *capsfilter;   /* capsfilter */
    void *appsink;      /* appsink */
    void *bus;          /* pipeline bus（持有引用） */
    void *link_pad;     /* conv:sink，pad-added 链接目标（持有引用） */
    unsigned long pad_added_id;

    unsigned char *pcm; /* 已解码待混音的 PCM */
    size_t pcm_len;
    size_t pcm_pos;
    size_t pcm_cap;

    char path[512];
    int loop;
    int restarts;
    double volume;

    volatile int app_eos;          /* appsink 已到 EOS */
    volatile int eos;              /* pending PCM 也已播完 */
    volatile int failed;           /* pipeline/bus 错误 */
    volatile long long last_buffer_ms;
    volatile int linked;
    long long started_ms;
    unsigned long long played_frames;
} audio_branch;

/* ------------------------------------------------------------------ 会话全局状态 */
static pthread_mutex_t g_mutex = PTHREAD_MUTEX_INITIALIZER;
static int g_gst_inited = 0;

/* 唯一输出 pipeline（按需创建，空闲时销毁） */
static void *g_out_pipeline = NULL;
static void *g_out_appsrc = NULL;
static void *g_out_bus = NULL;
static int g_out_playing = 0;

static int g_mixer_started = 0;
static pthread_t g_mixer_tid;
static volatile int g_shutdown = 0;
static long long g_last_user_audio_ms = 0;

static audio_branch g_branches[GAL_KIND_COUNT];

/* BGM 参数与延迟停止状态 */
static int g_bgm_loop = 1;
static double g_bgm_volume = 0.8;
static int g_bgm_stop_pending = 0;
static long long g_bgm_stop_deadline_ms = 0;

/* 混音工作缓冲：960 帧 = 20ms */
static int16_t g_mix_out[GAL_BLOCK_FRAMES * GAL_CHANNELS];
static int32_t g_mix_acc[GAL_BLOCK_FRAMES * GAL_CHANNELS];

/* 视频仍使用独立 pipeline（保持原有行为） */
static void *g_video_pipeline = NULL;
static int g_video_playing = 0;

/* ------------------------------------------------------------------ 通用工具 */
static long long monotonic_ms(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (long long)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

static double clamp_volume(double v)
{
    if (!(v > 0.0)) return 0.0;   /* 同时挡住 NaN */
    if (v > 1.0) return 1.0;
    return v;
}

/* 只写 /tmp，便于真机排查；不参与 JS 契约。 */
static void gal_log(const char *fmt, ...)
{
    FILE *f = fopen("/tmp/gal_gs_mixer.log", "a");
    struct timespec ts;
    va_list ap;

    if (!f) return;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    fprintf(f, "[%lld.%03ld] ", (long long)ts.tv_sec, (long)ts.tv_nsec / 1000000);
    va_start(ap, fmt);
    vfprintf(f, fmt, ap);
    va_end(ap);
    fputc('\n', f);
    fclose(f);
}

static void ensure_gst(void)
{
    if (!g_gst_inited) {
        gst_init(NULL, NULL);
        g_gst_inited = 1;
    }
}

/* GObject 实例首字段是 GTypeInstance.g_class（ABI 稳定），用于探测可选属性。 */
static int object_has_property(void *obj, const char *name)
{
    void *klass = NULL;
    if (!obj) return 0;
    memcpy(&klass, obj, sizeof(klass));
    if (!klass) return 0;
    return g_object_class_find_property(klass, name) != NULL;
}

static const char *branch_name(int kind)
{
    switch (kind) {
    case GAL_BGM: return "gal_bgm_src";
    case GAL_VOICE: return "gal_voice_src";
    case GAL_SE: return "gal_se_src";
    default: return "gal_audio_src";
    }
}

/* ------------------------------------------------------------------ 前向声明 */
static int output_ensure_locked(void);
static void output_stop_locked(void);
static void ensure_mixer_thread_locked(void);
static void branch_stop_locked(audio_branch *b);
static int branch_start_locked(audio_branch *b, int kind, const char *path,
                               int loop, double volume);
static void audio_service_locked(long long now);
static void restart_bgm_locked(audio_branch *b, const char *reason);

/* ------------------------------------------------------------------ PCM 缓冲 */
static void branch_pcm_clear(audio_branch *b)
{
    free(b->pcm);
    b->pcm = NULL;
    b->pcm_len = 0;
    b->pcm_pos = 0;
    b->pcm_cap = 0;
}

static size_t branch_pcm_avail(const audio_branch *b)
{
    return b->pcm_len - b->pcm_pos;
}

static int branch_pcm_reserve(audio_branch *b, size_t extra)
{
    size_t need, cap;
    unsigned char *p;

    if (!b || extra > GAL_MAX_PCM_BYTES) return 0;

    /* 搬移未消费数据到缓冲区头部，避免 pos 长期增长。 */
    if (b->pcm_pos > 0) {
        if (b->pcm_pos >= b->pcm_len) {
            b->pcm_len = 0;
            b->pcm_pos = 0;
        } else {
            memmove(b->pcm, b->pcm + b->pcm_pos, b->pcm_len - b->pcm_pos);
            b->pcm_len -= b->pcm_pos;
            b->pcm_pos = 0;
        }
    }

    need = b->pcm_len + extra;
    if (need > GAL_MAX_PCM_BYTES) return 0;
    if (need <= b->pcm_cap) return 1;

    cap = b->pcm_cap ? b->pcm_cap : 16384;
    while (cap < need) {
        if (cap > GAL_MAX_PCM_BYTES / 2) {
            cap = need;
            break;
        }
        cap *= 2;
    }
    p = (unsigned char *)realloc(b->pcm, cap);
    if (!p) return 0;
    b->pcm = p;
    b->pcm_cap = cap;
    return 1;
}

/* ------------------------------------------------------------------ 流线程回调（不取 g_mutex） */
static void on_decode_pad_added(void *element, void *pad, void *user_data)
{
    audio_branch *b = (audio_branch *)user_data;
    void *caps;
    int is_audio = 1;

    (void)element;
    if (!b || !b->active || b->linked || !b->link_pad) return;

    caps = gst_pad_get_current_caps(pad);
    if (caps) {
        void *st = gst_caps_get_structure(caps, 0);
        const char *name = st ? gst_structure_get_name(st) : NULL;
        is_audio = (name && strncmp(name, "audio/", 6) == 0) ? 1 : 0;
        gst_caps_unref(caps);
    }
    if (!is_audio) return;

    if (gst_pad_link(pad, b->link_pad) == GST_PAD_LINK_OK) {
        b->linked = 1;
    } else {
        gal_log("branch %d: decodebin pad link failed", b->kind);
    }
}

/* ------------------------------------------------------------------ 分支销毁 */
static void branch_stop_locked(audio_branch *b)
{
    if (!b) return;

    b->active = 0;
    if (b->pipeline) {
        /* 先让流线程停止，保证在飞的 pad-added 回调已经返回。 */
        gst_element_set_state(b->pipeline, GST_STATE_NULL);

        if (b->decode && b->pad_added_id) {
            g_signal_handler_disconnect(b->decode, b->pad_added_id);
        }
        b->pad_added_id = 0;

        if (b->link_pad) {
            gst_object_unref(b->link_pad);
            b->link_pad = NULL;
        }
        if (b->bus) {
            gst_object_unref(b->bus);
            b->bus = NULL;
        }
        gst_object_unref(b->pipeline);
        b->pipeline = NULL;
    }

    b->src = NULL;
    b->decode = NULL;
    b->conv = NULL;
    b->res = NULL;
    b->capsfilter = NULL;
    b->appsink = NULL;
    b->linked = 0;
    b->app_eos = 0;
    b->eos = 0;
    b->failed = 0;
    b->last_buffer_ms = 0;
    b->started_ms = 0;
    b->played_frames = 0;
    b->path[0] = '\0';
    branch_pcm_clear(b);
}

/* ------------------------------------------------------------------ 输出 pipeline */
static int output_ensure_locked(void)
{
    void *pipe = NULL;
    void *appsrc = NULL;
    void *queue = NULL;
    void *conv = NULL;
    void *res = NULL;
    void *capsfilter = NULL;
    void *sink = NULL;
    void *caps = NULL;

    if (g_out_pipeline) return 1;
    ensure_gst();

    pipe = gst_pipeline_new("gal_out_pipe");
    if (!pipe) {
        gal_log("output: gst_pipeline_new failed");
        return 0;
    }
    gst_object_ref_sink(pipe);   /* 新建 pipeline 是浮动引用，转为自己的强引用 */

    appsrc = gst_element_factory_make("appsrc", "src");
    queue = gst_element_factory_make("queue", "q");
    conv = gst_element_factory_make("audioconvert", "conv");
    res = gst_element_factory_make("audioresample", "res");
    capsfilter = gst_element_factory_make("capsfilter", "caps");
    sink = gst_element_factory_make("alsasink", "sink");
    if (!appsrc || !queue || !conv || !res || !capsfilter || !sink) {
        gal_log("output: missing element (appsrc=%p queue=%p conv=%p res=%p caps=%p alsasink=%p)",
                appsrc, queue, conv, res, capsfilter, sink);
        gst_object_unref(pipe);
        return 0;
    }

    gst_bin_add(pipe, appsrc);
    gst_bin_add(pipe, queue);
    gst_bin_add(pipe, conv);
    gst_bin_add(pipe, res);
    gst_bin_add(pipe, capsfilter);
    gst_bin_add(pipe, sink);

    caps = gst_caps_from_string(GAL_PCM_CAPS);
    if (!caps) {
        gal_log("output: caps parse failed");
        gst_object_unref(pipe);
        return 0;
    }
    gst_app_src_set_caps(appsrc, caps);
    g_object_set(capsfilter, "caps", caps, NULL);
    gst_caps_unref(caps);

    g_object_set(appsrc, "format", GST_FORMAT_TIME, "stream-type", 0, NULL);
    if (object_has_property(appsrc, "is-live"))
        g_object_set(appsrc, "is-live", 1, NULL);
    if (object_has_property(appsrc, "do-timestamp"))
        g_object_set(appsrc, "do-timestamp", 1, NULL);
    if (object_has_property(appsrc, "max-bytes"))
        g_object_set(appsrc, "max-bytes", (unsigned long long)200000, NULL);

    /* 限制软件队列深度，避免与 ALSA 硬件缓冲叠加出可感知延迟。 */
    g_object_set(queue, "max-size-time", (unsigned long long)100000000,
                 "max-size-buffers", 0, "max-size-bytes", 0, NULL);
    /* ALSA 自身按硬件速率消费；mixer 线程负责按 20ms 节拍推流。 */
    g_object_set(sink, "sync", 0, NULL);

    if (!gst_element_link_many(appsrc, queue, conv, res, capsfilter, sink, NULL)) {
        gal_log("output: link failed");
        gst_object_unref(pipe);
        return 0;
    }

    g_out_pipeline = pipe;
    g_out_appsrc = appsrc;
    g_out_bus = gst_element_get_bus(pipe);

    if (gst_element_set_state(pipe, GST_STATE_PLAYING) == GST_STATE_CHANGE_FAILURE) {
        gal_log("output: refused PLAYING");
        g_out_pipeline = pipe;
        g_out_appsrc = appsrc;
        output_stop_locked();
        return 0;
    }
    g_out_playing = 1;

    ensure_mixer_thread_locked();
    gal_log("output pipeline ready (appsrc/appsink software mixer)");
    return 1;
}

static void output_stop_locked(void)
{
    if (g_out_pipeline) {
        gst_element_set_state(g_out_pipeline, GST_STATE_NULL);
        gst_object_unref(g_out_pipeline);
    }
    g_out_pipeline = NULL;
    g_out_appsrc = NULL;
    if (g_out_bus) {
        gst_object_unref(g_out_bus);
        g_out_bus = NULL;
    }
    g_out_playing = 0;
}

/* ------------------------------------------------------------------ 分支创建 */
static int branch_start_locked(audio_branch *b, int kind, const char *path,
                               int loop, double volume)
{
    void *pipe = NULL;
    void *src = NULL;
    void *dec = NULL;
    void *conv = NULL;
    void *res = NULL;
    void *capsfilter = NULL;
    void *sink = NULL;
    void *caps = NULL;

    if (!b) return 0;
    if (!output_ensure_locked()) return 0;

    branch_stop_locked(b);

    b->kind = kind;
    b->active = 1;
    b->loop = loop;
    b->volume = clamp_volume(volume);
    b->app_eos = 0;
    b->eos = 0;
    b->failed = 0;
    b->linked = 0;
    b->last_buffer_ms = 0;
    b->started_ms = monotonic_ms();
    b->played_frames = 0;
    b->path[0] = '\0';
    if (path) {
        strncpy(b->path, path, sizeof(b->path) - 1);
        b->path[sizeof(b->path) - 1] = '\0';
    }

    pipe = gst_pipeline_new(branch_name(kind));
    if (!pipe) {
        gal_log("branch %d: pipeline_new failed", kind);
        goto fail;
    }
    gst_object_ref_sink(pipe);   /* 新建 pipeline 是浮动引用，转为自己的强引用 */

    src = gst_element_factory_make("filesrc", "src");
    dec = gst_element_factory_make("decodebin", "dec");
    conv = gst_element_factory_make("audioconvert", "conv");
    res = gst_element_factory_make("audioresample", "res");
    capsfilter = gst_element_factory_make("capsfilter", "caps");
    sink = gst_element_factory_make("appsink", "sink");
    if (!src || !dec || !conv || !res || !capsfilter || !sink) {
        gal_log("branch %d: missing element (filesrc=%p decodebin=%p conv=%p res=%p caps=%p appsink=%p)",
                kind, src, dec, conv, res, capsfilter, sink);
        goto fail;
    }

    gst_bin_add(pipe, src);
    gst_bin_add(pipe, dec);
    gst_bin_add(pipe, conv);
    gst_bin_add(pipe, res);
    gst_bin_add(pipe, capsfilter);
    gst_bin_add(pipe, sink);

    g_object_set(src, "location", b->path, NULL);

    caps = gst_caps_from_string(GAL_PCM_CAPS);
    if (!caps) {
        gal_log("branch %d: caps parse failed", kind);
        goto fail;
    }
    g_object_set(capsfilter, "caps", caps, NULL);
    gst_caps_unref(caps);
    caps = NULL;

    gst_app_sink_set_max_buffers(sink, 16);
    gst_app_sink_set_drop(sink, 0);
    g_object_set(sink, "sync", 0, NULL);
    if (object_has_property(sink, "emit-signals"))
        g_object_set(sink, "emit-signals", 0, NULL);

    if (!gst_element_link_many(src, dec, NULL)) {
        gal_log("branch %d: filesrc->decodebin link failed", kind);
        goto fail;
    }
    if (!gst_element_link_many(conv, res, capsfilter, sink, NULL)) {
        gal_log("branch %d: decode chain link failed", kind);
        goto fail;
    }

    b->link_pad = gst_element_get_static_pad(conv, "sink");
    if (!b->link_pad) {
        gal_log("branch %d: conv sink pad missing", kind);
        goto fail;
    }
    b->pad_added_id = g_signal_connect_data(dec, "pad-added",
                                            (void *)on_decode_pad_added, b, NULL, 0);

    b->pipeline = pipe;
    b->src = src;
    b->decode = dec;
    b->conv = conv;
    b->res = res;
    b->capsfilter = capsfilter;
    b->appsink = sink;
    b->bus = gst_element_get_bus(pipe);

    if (gst_element_set_state(pipe, GST_STATE_PLAYING) == GST_STATE_CHANGE_FAILURE) {
        gal_log("branch %d: refused PLAYING", kind);
        goto fail;
    }

    g_last_user_audio_ms = monotonic_ms();
    gal_log("branch %d started path=%s", kind, b->path[0] ? b->path : "(none)");
    return 1;

fail:
    if (caps) gst_caps_unref(caps);
    if (b->pad_added_id && b->decode) {
        g_signal_handler_disconnect(b->decode, b->pad_added_id);
        b->pad_added_id = 0;
    }
    if (b->link_pad) {
        gst_object_unref(b->link_pad);
        b->link_pad = NULL;
    }
    if (b->bus) {
        gst_object_unref(b->bus);
        b->bus = NULL;
    }
    if (pipe) {
        gst_element_set_state(pipe, GST_STATE_NULL);
        gst_object_unref(pipe);
    }
    b->pipeline = NULL;
    b->src = NULL;
    b->decode = NULL;
    b->conv = NULL;
    b->res = NULL;
    b->capsfilter = NULL;
    b->appsink = NULL;
    b->active = 0;
    b->app_eos = 0;
    b->eos = 0;
    b->linked = 0;
    b->last_buffer_ms = 0;
    b->started_ms = 0;
    b->played_frames = 0;
    branch_pcm_clear(b);
    return 0;
}

/* ------------------------------------------------------------------ bus / 服务 */
static int drain_bus_locked(void *bus, const char *tag)
{
    int failed = 0;

    if (!bus) return 0;

    for (;;) {
        void *msg = gst_bus_pop_filtered(bus, GST_MSG_ERROR);
        void *gerr = NULL;
        char *dbg = NULL;
        if (!msg) break;
        gst_message_parse_error(msg, &gerr, &dbg);
        gal_log("%s bus error: %s", tag, dbg ? dbg : "(no debug)");
        if (dbg) g_free(dbg);
        if (gerr) g_error_free(gerr);
        gst_message_unref(msg);
        failed = 1;
    }

    /* 排空其余消息（EOS 由 appsink 的 is_eos 判定），避免 bus 无界增长。 */
    for (;;) {
        void *msg = gst_bus_pop_filtered(bus, -1);
        if (!msg) break;
        gst_message_unref(msg);
    }
    return failed;
}

static void restart_bgm_locked(audio_branch *b, const char *reason)
{
    char path[512];
    int loop, restarts;
    double vol;

    if (!b || !b->pipeline) return;

    if (monotonic_ms() - b->started_ms > GAL_BGM_RESTART_RESET_MS) b->restarts = 0;
    restarts = b->restarts + 1;
    snprintf(path, sizeof(path), "%s", b->path);
    loop = b->loop;
    vol = b->volume;

    branch_stop_locked(b);
    if (restarts <= GAL_BGM_MAX_RESTARTS &&
        branch_start_locked(b, GAL_BGM, path, loop, vol)) {
        b->restarts = restarts;
        gal_log("bgm restart #%d (%s)", restarts, reason);
    } else {
        gal_log("bgm restart failed (%s)", reason);
    }
}

static void handle_branch_failure_locked(audio_branch *b, int kind, const char *reason)
{
    gal_log("branch %d failed (%s)", kind, reason);
    if (kind == GAL_BGM && b->loop) {
        restart_bgm_locked(b, reason);
    } else {
        branch_stop_locked(b);
    }
}

static void audio_service_locked(long long now)
{
    int k;
    int out_failed = 0;

    if (g_out_bus && drain_bus_locked(g_out_bus, "output")) out_failed = 1;
    if (g_out_pipeline && g_out_playing) {
        int pst = 0, ppend = 0;
        if (gst_element_get_state(g_out_pipeline, &pst, &ppend, 0) == GST_STATE_CHANGE_FAILURE) {
            out_failed = 1;
        }
    }
    if (out_failed) {
        gal_log("output pipeline failure -> stop all audio");
        for (k = 0; k < GAL_KIND_COUNT; k++) branch_stop_locked(&g_branches[k]);
        output_stop_locked();
        g_bgm_stop_pending = 0;
        return;
    }

    /* 延迟停止窗口到期：真正停止 BGM。 */
    if (g_bgm_stop_pending && now >= g_bgm_stop_deadline_ms) {
        gal_log("bgm stop (deferred)");
        branch_stop_locked(&g_branches[GAL_BGM]);
        g_bgm_stop_pending = 0;
    }

    for (k = 0; k < GAL_KIND_COUNT; k++) {
        audio_branch *b = &g_branches[k];
        int st = 0, pending = 0;
        long long ref;

        if (!b->pipeline) continue;

        if (b->bus && drain_bus_locked(b->bus, "branch")) b->failed = 1;
        if (b->failed) {
            handle_branch_failure_locked(b, k, "bus");
            continue;
        }

        if (b->eos) {
            if (k == GAL_BGM && b->loop) {
                restart_bgm_locked(b, "eos");
            } else {
                gal_log("branch %d eos", k);
                branch_stop_locked(b);
            }
            continue;
        }

        if (gst_element_get_state(b->pipeline, &st, &pending, 0) == GST_STATE_CHANGE_FAILURE) {
            handle_branch_failure_locked(b, k, "state");
            continue;
        }

        ref = b->last_buffer_ms ? b->last_buffer_ms : b->started_ms;
        if (!b->app_eos && ref > 0 && now - ref > GAL_BRANCH_STALL_MS) {
            handle_branch_failure_locked(b, k, "stall");
        }
    }

    /* 没有任何业务声部时释放 ALSA 句柄，让系统提示音 / 其它应用可用。 */
    if (!g_branches[GAL_BGM].pipeline && !g_branches[GAL_VOICE].pipeline &&
        !g_branches[GAL_SE].pipeline) {
        if (g_out_pipeline && now - g_last_user_audio_ms > GAL_IDLE_RELEASE_MS) {
            gal_log("output idle -> release ALSA");
            output_stop_locked();
        }
    }
}

/* ------------------------------------------------------------------ 混音 */
static void branch_pull_locked(audio_branch *b, size_t need)
{
    if (!b || !b->pipeline || !b->appsink) return;

    while (branch_pcm_avail(b) < need) {
        void *sample;
        void *buf;
        size_t sz, got;
        int ok = 1;

        if (b->app_eos) break;
        sample = gst_app_sink_try_pull_sample(b->appsink, 0);
        if (!sample) break;

        buf = gst_sample_get_buffer(sample);
        if (buf) {
            sz = gst_buffer_get_size(buf);
            if (sz > 0) {
                if (!branch_pcm_reserve(b, sz)) {
                    gal_log("branch %d: pcm buffer full", b->kind);
                    ok = 0;
                } else {
                    got = gst_buffer_extract(buf, 0, b->pcm + b->pcm_len, sz);
                    if (got) {
                        b->pcm_len += got;
                        b->last_buffer_ms = monotonic_ms();
                    }
                }
            }
        }
        gst_sample_unref(sample);
        if (!ok) break;
    }

    if (gst_app_sink_is_eos(b->appsink)) b->app_eos = 1;
}

static void mix_block_locked(void)
{
    int k, i;
    int voice_active = (g_branches[GAL_VOICE].pipeline != NULL) &&
                       !g_branches[GAL_VOICE].eos;

    memset(g_mix_acc, 0, sizeof(g_mix_acc));

    for (k = 0; k < GAL_KIND_COUNT; k++) {
        audio_branch *b = &g_branches[k];
        size_t avail, take, samples;
        double vol;
        int16_t *src;

        if (!b->pipeline) continue;

        avail = branch_pcm_avail(b);
        if (avail == 0) {
            if (b->app_eos) b->eos = 1;
            continue;
        }

        /* 不足一个 20ms 块时，按实际可用数据混音，剩余补静音。
         * 不能整块跳过：解码/重采样输出的块长不一定是 960 帧，跳过会周期性丢音，
         * 听感就是“响一下停一下”的电音。 */
        take = avail < GAL_BLOCK_BYTES ? avail : GAL_BLOCK_BYTES;
        take &= ~((size_t)1);
        if (take == 0) continue;

        if (k == GAL_BGM) {
            vol = g_bgm_volume * (voice_active ? GAL_BGM_DUCK_FACTOR : 1.0);
        } else {
            vol = b->volume;
        }
        vol = clamp_volume(vol);

        src = (int16_t *)(b->pcm + b->pcm_pos);
        samples = take / 2;
        for (i = 0; i < (int)samples; i++) {
            g_mix_acc[i] += (int32_t)((double)src[i] * vol);
        }

        b->pcm_pos += take;
        b->played_frames += take / GAL_FRAME_BYTES;
        if (b->pcm_pos >= b->pcm_len) {
            b->pcm_pos = 0;
            b->pcm_len = 0;
        }
        if (b->app_eos && b->pcm_len == 0) b->eos = 1;
    }

    for (i = 0; i < GAL_BLOCK_FRAMES * GAL_CHANNELS; i++) {
        int32_t v = g_mix_acc[i];
        if (v > 32767) v = 32767;
        else if (v < -32768) v = -32768;
        g_mix_out[i] = (int16_t)v;
    }
}

static void push_block_locked(void)
{
    void *buf;
    int ret;

    if (!g_out_appsrc) return;

    buf = gst_buffer_new_allocate(NULL, GAL_BLOCK_BYTES, NULL);
    if (!buf) return;
    if (gst_buffer_fill(buf, 0, g_mix_out, GAL_BLOCK_BYTES) != GAL_BLOCK_BYTES) {
        gst_buffer_unref(buf);
        return;
    }

    ret = gst_app_src_push_buffer(g_out_appsrc, buf);
    if (ret != GST_FLOW_OK) {
        gal_log("appsrc push failed: %d", ret);
        gst_buffer_unref(buf);
    }
}

static void mixer_tick_locked(void)
{
    long long now = monotonic_ms();
    int k;

    audio_service_locked(now);
    if (!g_out_pipeline) return;

    for (k = 0; k < GAL_KIND_COUNT; k++) {
        audio_branch *b = &g_branches[k];
        if (b->pipeline) branch_pull_locked(b, GAL_BLOCK_BYTES);
    }

    mix_block_locked();
    push_block_locked();

    /* 处理本块刚播完的声部：BGM 循环 / Voice、SE 回收。 */
    audio_service_locked(now);
}

static void *mixer_thread_main(void *arg)
{
    struct timespec next;

    (void)arg;
    clock_gettime(CLOCK_MONOTONIC, &next);
    while (!g_shutdown) {
        pthread_mutex_lock(&g_mutex);
        mixer_tick_locked();
        pthread_mutex_unlock(&g_mutex);

        /* 绝对时钟节拍：固定睡 20ms 会让实际周期变成 20ms + 处理耗时，
         * 长时间播放必然落后于 ALSA 消费，产生周期性断音。 */
        next.tv_nsec += (long)GAL_TICK_MS * 1000000L;
        while (next.tv_nsec >= 1000000000L) {
            next.tv_sec += 1;
            next.tv_nsec -= 1000000000L;
        }
        {
            struct timespec now_ts;
            long long delta_ns;
            clock_gettime(CLOCK_MONOTONIC, &now_ts);
            delta_ns = (long long)(next.tv_sec - now_ts.tv_sec) * 1000000000LL +
                       (long long)(next.tv_nsec - now_ts.tv_nsec);
            if (delta_ns > 0) {
                struct timespec wait_ts;
                wait_ts.tv_sec = (time_t)(delta_ns / 1000000000LL);
                wait_ts.tv_nsec = (long)(delta_ns % 1000000000LL);
                while (nanosleep(&wait_ts, &wait_ts) == -1 && errno == EINTR) {
                    /* 被信号打断时继续等到同一个绝对截止点。 */
                }
            }
        }
    }
    return NULL;
}

static void ensure_mixer_thread_locked(void)
{
    if (g_mixer_started) return;
    if (pthread_create(&g_mixer_tid, NULL, mixer_thread_main, NULL) == 0) {
        g_mixer_started = 1;
    } else {
        gal_log("mixer thread create failed");
    }
}

/* ------------------------------------------------------------------ 卸载清理 */
__attribute__((destructor)) static void gal_native_fini(void)
{
    int k;

    if (g_mixer_started) {
        g_shutdown = 1;
        pthread_join(g_mixer_tid, NULL);
        g_mixer_started = 0;
    }

    if (pthread_mutex_trylock(&g_mutex) != 0) return;

    for (k = 0; k < GAL_KIND_COUNT; k++) {
        branch_stop_locked(&g_branches[k]);
    }
    output_stop_locked();
    g_bgm_stop_pending = 0;

    pthread_mutex_unlock(&g_mutex);
}

/* ------------------------------------------------------------------ JSAPI：BGM */
/* gal.playBgm(path, loop = true, volume = 0.8) */
static JSValue js_play_bgm(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    const char *path;
    int loop = 1, ok = 0;
    double volume = 0.8;
    long long now;

    (void)this_val;
    if (argc < 1) return JS_ThrowTypeError(ctx, "path required");
    path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_EXCEPTION;

    if (argc >= 2 && !JS_IsUndefined(argv[1])) {
        loop = JS_ToBool(ctx, argv[1]) != 0;
    }
    if (argc >= 3 && !JS_IsUndefined(argv[2])) {
        JS_ToFloat64(ctx, &volume, argv[2]);
    }
    volume = clamp_volume(volume);

    pthread_mutex_lock(&g_mutex);
    now = monotonic_ms();
    audio_service_locked(now);

    if (access(path, R_OK) != 0) {
        gal_log("playBgm: cannot read %s", path);
        pthread_mutex_unlock(&g_mutex);
        JS_FreeCString(ctx, path);
        return JS_NewBool(ctx, 0);
    }

    /* 同一路径：不重启，只更新循环与音量。语音结束后的 playBgm 回填即走这里，
     * BGM 因此不会回到开头。 */
    if (g_branches[GAL_BGM].pipeline &&
        strcmp(g_branches[GAL_BGM].path, path) == 0) {
        g_bgm_stop_pending = 0;
        g_bgm_loop = loop;
        g_bgm_volume = volume;
        g_branches[GAL_BGM].loop = loop;
        g_branches[GAL_BGM].volume = volume;
        g_last_user_audio_ms = now;
        pthread_mutex_unlock(&g_mutex);
        JS_FreeCString(ctx, path);
        return JS_NewBool(ctx, 1);
    }

    /* 换曲：立即替换旧 BGM，不等延迟停止窗口。 */
    if (g_branches[GAL_BGM].pipeline) branch_stop_locked(&g_branches[GAL_BGM]);
    g_bgm_stop_pending = 0;
    g_bgm_loop = loop;
    g_bgm_volume = volume;

    ensure_mixer_thread_locked();
    ok = branch_start_locked(&g_branches[GAL_BGM], GAL_BGM, path, loop, volume);
    if (ok) g_branches[GAL_BGM].restarts = 0;

    pthread_mutex_unlock(&g_mutex);
    JS_FreeCString(ctx, path);
    return JS_NewBool(ctx, ok);
}

/* gal.stopBgm()
 *
 * 为了兼容现有 JS 的 Voice Ducking 序列（stopBgm 后紧接 playVoice），
 * 这里不是立刻销毁，而是给一个 GAL_BGM_STOP_GRACE_MS 的宽限窗口：
 *   - 窗口内 playVoice / 再次 playBgm(同路径) => 取消停止，BGM 继续原位播放
 *   - 窗口内没有后续调用 => 由 mixer 线程真正停止
 *   - 连续第二次 stopBgm => 立即停止
 */
static JSValue js_stop_bgm(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    (void)this_val;
    (void)argc;
    (void)argv;

    pthread_mutex_lock(&g_mutex);
    audio_service_locked(monotonic_ms());

    if (g_branches[GAL_BGM].pipeline) {
        if (g_bgm_stop_pending) {
            gal_log("bgm stop (explicit)");
            branch_stop_locked(&g_branches[GAL_BGM]);
            g_bgm_stop_pending = 0;
        } else {
            g_bgm_stop_pending = 1;
            g_bgm_stop_deadline_ms = monotonic_ms() + GAL_BGM_STOP_GRACE_MS;
        }
    } else {
        g_bgm_stop_pending = 0;
    }

    pthread_mutex_unlock(&g_mutex);
    return JS_NewBool(ctx, 1);
}

/* gal.setBgmVolume(volume) */
static JSValue js_set_bgm_volume(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    double volume = 0.8;

    (void)this_val;
    if (argc < 1) return JS_ThrowTypeError(ctx, "volume required");
    JS_ToFloat64(ctx, &volume, argv[0]);

    pthread_mutex_lock(&g_mutex);
    g_bgm_volume = clamp_volume(volume);
    pthread_mutex_unlock(&g_mutex);
    return JS_NewBool(ctx, 1);
}

/* ------------------------------------------------------------------ JSAPI：Voice / SE */
/* gal.playVoice(path, volume = 1.0) */
static JSValue js_play_voice(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    const char *path;
    int ok = 0;
    double volume = 1.0;
    long long now;

    (void)this_val;
    if (argc < 1) return JS_ThrowTypeError(ctx, "path required");
    path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_EXCEPTION;

    if (argc >= 2 && !JS_IsUndefined(argv[1])) {
        JS_ToFloat64(ctx, &volume, argv[1]);
    }
    volume = clamp_volume(volume);

    pthread_mutex_lock(&g_mutex);
    now = monotonic_ms();
    audio_service_locked(now);

    if (access(path, R_OK) != 0) {
        gal_log("playVoice: cannot read %s", path);
        pthread_mutex_unlock(&g_mutex);
        JS_FreeCString(ctx, path);
        return JS_NewBool(ctx, 0);
    }

    /* 语音避让兼容：取消仍在宽限窗口内的 BGM 停止请求，让 BGM 与语音混音。 */
    if (g_bgm_stop_pending && now <= g_bgm_stop_deadline_ms) {
        g_bgm_stop_pending = 0;
        gal_log("bgm stop cancelled by voice (duck-mix)");
    }

    ensure_mixer_thread_locked();
    ok = branch_start_locked(&g_branches[GAL_VOICE], GAL_VOICE, path, 0, volume);

    pthread_mutex_unlock(&g_mutex);
    JS_FreeCString(ctx, path);
    return JS_NewBool(ctx, ok);
}

/* gal.stopVoice() */
static JSValue js_stop_voice(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    (void)this_val;
    (void)argc;
    (void)argv;

    pthread_mutex_lock(&g_mutex);
    audio_service_locked(monotonic_ms());
    branch_stop_locked(&g_branches[GAL_VOICE]);
    pthread_mutex_unlock(&g_mutex);
    return JS_NewBool(ctx, 1);
}

/* gal.playSe(path, volume = 1.0) */
static JSValue js_play_se(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    const char *path;
    int ok = 0;
    double volume = 1.0;

    (void)this_val;
    if (argc < 1) return JS_ThrowTypeError(ctx, "path required");
    path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_EXCEPTION;

    if (argc >= 2 && !JS_IsUndefined(argv[1])) {
        JS_ToFloat64(ctx, &volume, argv[1]);
    }
    volume = clamp_volume(volume);

    pthread_mutex_lock(&g_mutex);
    audio_service_locked(monotonic_ms());

    if (access(path, R_OK) != 0) {
        gal_log("playSe: cannot read %s", path);
        pthread_mutex_unlock(&g_mutex);
        JS_FreeCString(ctx, path);
        return JS_NewBool(ctx, 0);
    }

    ensure_mixer_thread_locked();
    ok = branch_start_locked(&g_branches[GAL_SE], GAL_SE, path, 0, volume);

    pthread_mutex_unlock(&g_mutex);
    JS_FreeCString(ctx, path);
    return JS_NewBool(ctx, ok);
}

/* gal.status() -> { bgm, voice, voicePosMs, voiceDurMs } */
static JSValue js_status(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    int bgm_active, voice_active;
    long long pos_ms = 0, dur_ms = 0;
    JSValue obj;

    (void)this_val;
    (void)argc;
    (void)argv;

    pthread_mutex_lock(&g_mutex);
    audio_service_locked(monotonic_ms());

    bgm_active = (g_branches[GAL_BGM].pipeline != NULL) && !g_bgm_stop_pending;
    voice_active = (g_branches[GAL_VOICE].pipeline != NULL) && !g_branches[GAL_VOICE].eos;

    if (g_branches[GAL_VOICE].pipeline) {
        long long ns = 0;
        pos_ms = (long long)(g_branches[GAL_VOICE].played_frames * 1000ULL / GAL_RATE);
        if (gst_element_query_duration(g_branches[GAL_VOICE].pipeline,
                                       GST_FORMAT_TIME, &ns) && ns > 0) {
            dur_ms = ns / NS_PER_MS;
        }
    }
    pthread_mutex_unlock(&g_mutex);

    obj = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, obj, "bgm", JS_NewBool(ctx, bgm_active));
    JS_SetPropertyStr(ctx, obj, "voice", JS_NewBool(ctx, voice_active));
    JS_SetPropertyStr(ctx, obj, "voicePosMs", JS_NewInt64(ctx, pos_ms));
    JS_SetPropertyStr(ctx, obj, "voiceDurMs", JS_NewInt64(ctx, dur_ms));
    return obj;
}

/* ------------------------------------------------------------------ 视频管线支持 */
static void stop_pipeline_locked(void **pp)
{
    if (*pp) {
        gst_element_set_state(*pp, GST_STATE_NULL);
        gst_object_unref(*pp);
        *pp = NULL;
    }
}

/* gal.openVideo(path, startMs, x, y, w, h) */
static JSValue js_open_video(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    const char *path;
    int64_t start_ms = 0;
    int x = 0, y = 0, w = 472, h = 266;
    char pipe_desc[1024];

    (void)this_val;
    if (argc < 6) return JS_ThrowTypeError(ctx, "path, startMs, x, y, w, h required");
    path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_EXCEPTION;

    JS_ToInt64(ctx, &start_ms, argv[1]);
    JS_ToInt32(ctx, &x, argv[2]);
    JS_ToInt32(ctx, &y, argv[3]);
    JS_ToInt32(ctx, &w, argv[4]);
    JS_ToInt32(ctx, &h, argv[5]);

    pthread_mutex_lock(&g_mutex);
    ensure_gst();
    stop_pipeline_locked(&g_video_pipeline);

    /* 采用验证过的等比缩放硬解配置，杜绝绿边。
     * 视频音频仍是独立 alsasink；与常驻输出 pipeline 同时使用时可能争用声卡。 */
    snprintf(pipe_desc, sizeof(pipe_desc),
             "filesrc location=\"%s\" ! qtdemux name=dmx "
             "dmx.video_0 ! h264parse ! mppvideodec ! "
             "videoscale ! video/x-raw,width=%d,height=%d,pixel-aspect-ratio=1/1 ! "
             "waylandsink name=wsink "
             "dmx.audio_0 ! aacparse ! faad ! audioconvert ! audioresample ! alsasink",
             path, w, h);

    void *err = NULL;
    g_video_pipeline = gst_parse_launch(pipe_desc, &err);
    if (!g_video_pipeline) {
        pthread_mutex_unlock(&g_mutex);
        JS_FreeCString(ctx, path);
        return JS_NewBool(ctx, 0);
    }

    gst_element_set_state(g_video_pipeline, GST_STATE_PLAYING);
    if (start_ms > 0) {
        gst_element_seek_simple(g_video_pipeline, GST_FORMAT_TIME,
                                GST_SEEK_FLAG_FLUSH | GST_SEEK_FLAG_KEY_UNIT,
                                (long long)start_ms * NS_PER_MS);
    }
    g_video_playing = 1;
    pthread_mutex_unlock(&g_mutex);

    JS_FreeCString(ctx, path);
    return JS_NewBool(ctx, 1);
}

/* gal.stopVideo() */
static JSValue js_stop_video(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    (void)this_val;
    (void)argc;
    (void)argv;

    pthread_mutex_lock(&g_mutex);
    stop_pipeline_locked(&g_video_pipeline);
    g_video_playing = 0;
    pthread_mutex_unlock(&g_mutex);
    return JS_NewBool(ctx, 1);
}

/* ------------------------------------------------------------------ 文件与探测工具 */
/* gal.readText(path) */
static JSValue js_read_text(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    const char *path;
    FILE *f;
    long sz;
    char *buf;
    size_t rd;
    JSValue ret;

    (void)this_val;
    if (argc < 1) return JS_ThrowTypeError(ctx, "path required");
    path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_EXCEPTION;

    f = fopen(path, "rb");
    JS_FreeCString(ctx, path);
    if (!f) return JS_NULL;

    fseek(f, 0, SEEK_END);
    sz = ftell(f);
    fseek(f, 0, SEEK_SET);

    if (sz <= 0 || sz > 16 * 1024 * 1024) {
        fclose(f);
        return JS_NULL;
    }

    buf = malloc((size_t)sz + 1);
    if (!buf) { fclose(f); return JS_NULL; }
    rd = fread(buf, 1, (size_t)sz, f);
    fclose(f);
    buf[rd] = '\0';

    ret = JS_NewString(ctx, buf);
    free(buf);
    return ret;
}

/* gal.writeText(path, content) */
static JSValue js_write_text(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    const char *path;
    const char *content;
    FILE *f;
    int ok = 0;

    (void)this_val;
    if (argc < 2) return JS_ThrowTypeError(ctx, "path, content required");
    path = JS_ToCString(ctx, argv[0]);
    content = JS_ToCString(ctx, argv[1]);
    if (!path || !content) {
        if (path) JS_FreeCString(ctx, path);
        if (content) JS_FreeCString(ctx, content);
        return JS_EXCEPTION;
    }

    f = fopen(path, "wb");
    if (f) {
        size_t len = strlen(content);
        if (fwrite(content, 1, len, f) == len) {
            ok = 1;
        }
        fclose(f);
    }
    JS_FreeCString(ctx, path);
    JS_FreeCString(ctx, content);
    return JS_NewBool(ctx, ok);
}

/* gal.probe(path) -> { width, height, durationMs } */
static JSValue js_probe(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    const char *path;
    char cmd[1024];
    FILE *pipe;
    int width = 0, height = 0;
    double duration_sec = 0;
    char line[256];
    JSValue obj;

    (void)this_val;
    if (argc < 1) return JS_ThrowTypeError(ctx, "path required");
    path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_EXCEPTION;

    snprintf(cmd, sizeof(cmd),
             "ffprobe -v error -select_streams v:0 -show_entries "
             "stream=width,height,duration -of default=noprint_wrappers=1 \"%s\" 2>/dev/null",
             path);

    pipe = popen(cmd, "r");
    JS_FreeCString(ctx, path);
    if (!pipe) return JS_NULL;

    while (fgets(line, sizeof(line), pipe)) {
        if (strncmp(line, "width=", 6) == 0) {
            width = atoi(line + 6);
        } else if (strncmp(line, "height=", 7) == 0) {
            height = atoi(line + 7);
        } else if (strncmp(line, "duration=", 9) == 0) {
            duration_sec = atof(line + 9);
        }
    }
    pclose(pipe);

    obj = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, obj, "width", JS_NewInt32(ctx, width));
    JS_SetPropertyStr(ctx, obj, "height", JS_NewInt32(ctx, height));
    JS_SetPropertyStr(ctx, obj, "durationMs", JS_NewInt64(ctx, (int64_t)(duration_sec * 1000)));
    return obj;
}

/* ------------------------------------------------------------------ 模块导出注册 */
struct method_entry {
    const char *name;
    JSCFunction *fn;
    int nargs;
};

static const struct method_entry g_methods[] = {
    {"playBgm", js_play_bgm, 1},
    {"stopBgm", js_stop_bgm, 0},
    {"setBgmVolume", js_set_bgm_volume, 1},
    {"playVoice", js_play_voice, 1},
    {"stopVoice", js_stop_voice, 0},
    {"playSe", js_play_se, 1},
    {"status", js_status, 0},
    {"openVideo", js_open_video, 6},
    {"stopVideo", js_stop_video, 0},
    {"readText", js_read_text, 1},
    {"writeText", js_write_text, 2},
    {"probe", js_probe, 1},
};
#define NMETHODS ((int)(sizeof(g_methods) / sizeof(g_methods[0])))

static int gal_module_init(JSContext *ctx, JSModuleDef *m)
{
    JSValue o = JS_NewObject(ctx);
    for (int i = 0; i < NMETHODS; i++) {
        JSValue f = JS_NewCFunction(ctx, g_methods[i].fn, g_methods[i].name, g_methods[i].nargs);
        JS_SetPropertyStr(ctx, o, g_methods[i].name, JS_DupValue(ctx, f));
        JS_SetModuleExport(ctx, m, g_methods[i].name, f);
    }
    JS_SetModuleExport(ctx, m, "default", o);
    return 0;
}

static JSModuleDef *loader(JSContext *ctx, const char *module_name)
{
    if (strcmp(module_name, "gal") != 0) return NULL;
    JSModuleDef *m = JS_NewCModule(ctx, module_name, gal_module_init);
    if (!m) return NULL;
    JS_AddModuleExport(ctx, m, "default");
    for (int i = 0; i < NMETHODS; i++) {
        JS_AddModuleExport(ctx, m, g_methods[i].name);
    }
    return m;
}

__attribute__((visibility("default"))) void custom_init_jsapis(void)
{
    registerCModuleLoader("gal", loader);
}
