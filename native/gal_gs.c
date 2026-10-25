/*
 * gal_gs.c —— 词典笔 Galgame 引擎原生 C 插件
 *
 * 运行目标：网易有道词典笔 X6 Pro（RK3562 / aarch64 Linux 5.10 / Weston Wayland）
 * 功能支持：
 *   1. 多轨音频混音：BGM（支持循环与独立音量）、Voice（单句语音，自动打断上一句）、SE（音效）
 *   2. 硬件加速视频渲染：基于 GStreamer mppvideodec + waylandsink，居中等比无绿边
 *   3. 状态轮询：查询当前 BGM / Voice 播放进度与状态
 *   4. 本地存读档与数据透传：readText / writeText / probe
 */

#define _GNU_SOURCE 1

#include <quickjs.h>

#include <errno.h>
#include <pthread.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

extern void registerCModuleLoader(const char *name,
                                 JSModuleDef *(*loader)(JSContext *ctx, const char *module_name));

/* ------------------------------------------------------------------ GStreamer 自声明原型 */
extern void gst_init(int *argc, char ***argv);
extern void *gst_parse_launch(const char *pipeline_description, void **error);
extern int gst_element_set_state(void *element, int state);
extern int gst_element_get_state(void *element, int *state, int *pending, unsigned long long timeout);
extern int gst_element_seek_simple(void *element, int format, int seek_flags, long long seek_pos);
extern int gst_element_query_position(void *element, int format, long long *cur);
extern int gst_element_query_duration(void *element, int format, long long *cur);
extern void *gst_element_get_bus(void *element);
extern void *gst_bus_pop_filtered(void *bus, int types);
extern void gst_object_unref(void *object);
extern void gst_message_unref(void *message);
extern void gst_message_parse_error(void *message, void **gerror, char **debug);
extern void g_error_free(void *error);
extern void g_free(void *mem);
extern void *gst_bin_get_by_name(void *bin, const char *name);
extern void g_object_set(void *obj, const char *first_property_name, ...);

#define GST_STATE_NULL 1
#define GST_STATE_READY 2
#define GST_STATE_PAUSED 3
#define GST_STATE_PLAYING 4
#define GST_FORMAT_TIME 3
#define GST_SEEK_FLAG_FLUSH 1
#define GST_SEEK_FLAG_KEY_UNIT 4
#define GST_MSG_EOS 1
#define GST_MSG_ERROR 2

#define NS_PER_MS 1000000LL

/* ------------------------------------------------------------------ 会话全局状态 */
static pthread_mutex_t g_mutex = PTHREAD_MUTEX_INITIALIZER;
static int g_gst_inited = 0;

/* BGM 管道 */
static void *g_bgm_pipeline = NULL;
static char g_bgm_path[512] = {0};
static int g_bgm_loop = 1;
static double g_bgm_volume = 0.8;

/* 语音 Voice 管道 */
static void *g_voice_pipeline = NULL;
static char g_voice_path[512] = {0};
static double g_voice_volume = 1.0;

/* SE 音效管道 */
static void *g_se_pipeline = NULL;

/* 视频 Video 管道 */
static void *g_video_pipeline = NULL;
static int g_video_playing = 0;

static void ensure_gst(void)
{
    if (!g_gst_inited) {
        gst_init(NULL, NULL);
        g_gst_inited = 1;
    }
}

/* ------------------------------------------------------------------ 音频管线辅助 */
static void stop_pipeline_locked(void **pp)
{
    if (*pp) {
        gst_element_set_state(*pp, GST_STATE_NULL);
        gst_object_unref(*pp);
        *pp = NULL;
    }
}

/* 检查管道中的 EOS 事件 */
static void poll_audio_events_locked(void)
{
    if (g_bgm_pipeline) {
        void *bus = gst_element_get_bus(g_bgm_pipeline);
        if (bus) {
            void *msg = gst_bus_pop_filtered(bus, GST_MSG_EOS | GST_MSG_ERROR);
            if (msg) {
                if (g_bgm_loop) {
                    /* 循环播放：seek 回起点 */
                    gst_element_seek_simple(g_bgm_pipeline, GST_FORMAT_TIME,
                                            GST_SEEK_FLAG_FLUSH | GST_SEEK_FLAG_KEY_UNIT, 0);
                } else {
                    stop_pipeline_locked(&g_bgm_pipeline);
                }
                gst_message_unref(msg);
            }
            gst_object_unref(bus);
        }
    }

    if (g_voice_pipeline) {
        void *bus = gst_element_get_bus(g_voice_pipeline);
        if (bus) {
            void *msg = gst_bus_pop_filtered(bus, GST_MSG_EOS | GST_MSG_ERROR);
            if (msg) {
                stop_pipeline_locked(&g_voice_pipeline);
                gst_message_unref(msg);
            }
            gst_object_unref(bus);
        }
    }
}

/* ------------------------------------------------------------------ JSAPI 实现 */

/* gal.playBgm(path, loop = 1, volume = 0.8) */
static JSValue js_play_bgm(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    if (argc < 1) return JS_ThrowTypeError(ctx, "path required");
    const char *path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_EXCEPTION;

    int loop = 1;
    if (argc >= 2 && !JS_IsUndefined(argv[1])) {
        loop = JS_ToBool(ctx, argv[1]);
    }
    double volume = 0.8;
    if (argc >= 3 && !JS_IsUndefined(argv[2])) {
        JS_ToFloat64(ctx, &volume, argv[2]);
    }

    pthread_mutex_lock(&g_mutex);
    ensure_gst();

    /* 若已在播放相同文件，仅更新循环与音量 */
    if (g_bgm_pipeline && strcmp(g_bgm_path, path) == 0) {
        g_bgm_loop = loop;
        g_bgm_volume = volume;
        void *vol_elem = gst_bin_get_by_name(g_bgm_pipeline, "bgmvol");
        if (vol_elem) {
            g_object_set(vol_elem, "volume", volume, NULL);
            gst_object_unref(vol_elem);
        }
        pthread_mutex_unlock(&g_mutex);
        JS_FreeCString(ctx, path);
        return JS_NewBool(ctx, 1);
    }

    stop_pipeline_locked(&g_bgm_pipeline);
    strncpy(g_bgm_path, path, sizeof(g_bgm_path) - 1);
    g_bgm_loop = loop;
    g_bgm_volume = volume;

    char pipe_desc[1024];
    snprintf(pipe_desc, sizeof(pipe_desc),
             "filesrc location=\"%s\" ! decodebin ! audioconvert ! audioresample ! "
             "volume name=bgmvol volume=%.2f ! alsasink",
             path, volume);

    void *err = NULL;
    g_bgm_pipeline = gst_parse_launch(pipe_desc, &err);
    if (!g_bgm_pipeline) {
        pthread_mutex_unlock(&g_mutex);
        JS_FreeCString(ctx, path);
        return JS_NewBool(ctx, 0);
    }

    gst_element_set_state(g_bgm_pipeline, GST_STATE_PLAYING);
    pthread_mutex_unlock(&g_mutex);

    JS_FreeCString(ctx, path);
    return JS_NewBool(ctx, 1);
}

/* gal.stopBgm() */
static JSValue js_stop_bgm(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    pthread_mutex_lock(&g_mutex);
    stop_pipeline_locked(&g_bgm_pipeline);
    g_bgm_path[0] = '\0';
    pthread_mutex_unlock(&g_mutex);
    return JS_NewBool(ctx, 1);
}

/* gal.setBgmVolume(volume) */
static JSValue js_set_bgm_volume(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    if (argc < 1) return JS_ThrowTypeError(ctx, "volume required");
    double volume = 0.8;
    JS_ToFloat64(ctx, &volume, argv[0]);

    pthread_mutex_lock(&g_mutex);
    g_bgm_volume = volume;
    if (g_bgm_pipeline) {
        void *vol_elem = gst_bin_get_by_name(g_bgm_pipeline, "bgmvol");
        if (vol_elem) {
            g_object_set(vol_elem, "volume", volume, NULL);
            gst_object_unref(vol_elem);
        }
    }
    pthread_mutex_unlock(&g_mutex);
    return JS_NewBool(ctx, 1);
}

/* gal.playVoice(path, volume = 1.0) */
static JSValue js_play_voice(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    if (argc < 1) return JS_ThrowTypeError(ctx, "path required");
    const char *path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_EXCEPTION;

    double volume = 1.0;
    if (argc >= 2 && !JS_IsUndefined(argv[1])) {
        JS_ToFloat64(ctx, &volume, argv[1]);
    }

    pthread_mutex_lock(&g_mutex);
    ensure_gst();

    /* 停止上一条正在播放的语音 */
    stop_pipeline_locked(&g_voice_pipeline);
    strncpy(g_voice_path, path, sizeof(g_voice_path) - 1);
    g_voice_volume = volume;

    char pipe_desc[1024];
    snprintf(pipe_desc, sizeof(pipe_desc),
             "filesrc location=\"%s\" ! decodebin ! audioconvert ! audioresample ! "
             "volume name=vcvol volume=%.2f ! alsasink",
             path, volume);

    void *err = NULL;
    g_voice_pipeline = gst_parse_launch(pipe_desc, &err);
    if (!g_voice_pipeline) {
        pthread_mutex_unlock(&g_mutex);
        JS_FreeCString(ctx, path);
        return JS_NewBool(ctx, 0);
    }

    gst_element_set_state(g_voice_pipeline, GST_STATE_PLAYING);
    pthread_mutex_unlock(&g_mutex);

    JS_FreeCString(ctx, path);
    return JS_NewBool(ctx, 1);
}

/* gal.stopVoice() */
static JSValue js_stop_voice(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    pthread_mutex_lock(&g_mutex);
    stop_pipeline_locked(&g_voice_pipeline);
    g_voice_path[0] = '\0';
    pthread_mutex_unlock(&g_mutex);
    return JS_NewBool(ctx, 1);
}

/* gal.playSe(path, volume = 1.0) */
static JSValue js_play_se(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    if (argc < 1) return JS_ThrowTypeError(ctx, "path required");
    const char *path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_EXCEPTION;

    double volume = 1.0;
    if (argc >= 2 && !JS_IsUndefined(argv[1])) {
        JS_ToFloat64(ctx, &volume, argv[1]);
    }

    pthread_mutex_lock(&g_mutex);
    ensure_gst();
    stop_pipeline_locked(&g_se_pipeline);

    char pipe_desc[1024];
    snprintf(pipe_desc, sizeof(pipe_desc),
             "filesrc location=\"%s\" ! decodebin ! audioconvert ! audioresample ! "
             "volume volume=%.2f ! alsasink",
             path, volume);

    void *err = NULL;
    g_se_pipeline = gst_parse_launch(pipe_desc, &err);
    if (g_se_pipeline) {
        gst_element_set_state(g_se_pipeline, GST_STATE_PLAYING);
    }
    pthread_mutex_unlock(&g_mutex);

    JS_FreeCString(ctx, path);
    return JS_NewBool(ctx, g_se_pipeline != NULL);
}

/* gal.status() -> { bgm: bool, voice: bool, voicePosMs: number, voiceDurMs: number } */
static JSValue js_status(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    pthread_mutex_lock(&g_mutex);
    poll_audio_events_locked();

    int bgm_active = (g_bgm_pipeline != NULL);
    int voice_active = (g_voice_pipeline != NULL);
    long long pos_ms = 0;
    long long dur_ms = 0;

    if (g_voice_pipeline) {
        long long pos_ns = 0, dur_ns = 0;
        if (gst_element_query_position(g_voice_pipeline, GST_FORMAT_TIME, &pos_ns)) {
            pos_ms = pos_ns / NS_PER_MS;
        }
        if (gst_element_query_duration(g_voice_pipeline, GST_FORMAT_TIME, &dur_ns)) {
            dur_ms = dur_ns / NS_PER_MS;
        }
    }
    pthread_mutex_unlock(&g_mutex);

    JSValue obj = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, obj, "bgm", JS_NewBool(ctx, bgm_active));
    JS_SetPropertyStr(ctx, obj, "voice", JS_NewBool(ctx, voice_active));
    JS_SetPropertyStr(ctx, obj, "voicePosMs", JS_NewInt64(ctx, pos_ms));
    JS_SetPropertyStr(ctx, obj, "voiceDurMs", JS_NewInt64(ctx, dur_ms));
    return obj;
}

/* ------------------------------------------------------------------ 视频管线支持 */
/* gal.openVideo(path, startMs, x, y, w, h) */
static JSValue js_open_video(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    if (argc < 6) return JS_ThrowTypeError(ctx, "path, startMs, x, y, w, h required");
    const char *path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_EXCEPTION;

    int64_t start_ms = 0;
    JS_ToInt64(ctx, &start_ms, argv[1]);
    int x = 0, y = 0, w = 472, h = 266;
    JS_ToInt32(ctx, &x, argv[2]);
    JS_ToInt32(ctx, &y, argv[3]);
    JS_ToInt32(ctx, &w, argv[4]);
    JS_ToInt32(ctx, &h, argv[5]);

    pthread_mutex_lock(&g_mutex);
    ensure_gst();
    stop_pipeline_locked(&g_video_pipeline);

    char pipe_desc[1024];
    /* 采用验证过的等比缩放硬解配置，杜绝绿边 */
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
    if (argc < 1) return JS_ThrowTypeError(ctx, "path required");
    const char *path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_EXCEPTION;

    FILE *f = fopen(path, "rb");
    JS_FreeCString(ctx, path);
    if (!f) return JS_NULL;

    fseek(f, 0, SEEK_END);
    long sz = ftell(f);
    fseek(f, 0, SEEK_SET);

    if (sz <= 0 || sz > 16 * 1024 * 1024) {
        fclose(f);
        return JS_NULL;
    }

    char *buf = malloc(sz + 1);
    if (!buf) { fclose(f); return JS_NULL; }
    size_t rd = fread(buf, 1, sz, f);
    fclose(f);
    buf[rd] = '\0';

    JSValue ret = JS_NewString(ctx, buf);
    free(buf);
    return ret;
}

/* gal.writeText(path, content) */
static JSValue js_write_text(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    if (argc < 2) return JS_ThrowTypeError(ctx, "path, content required");
    const char *path = JS_ToCString(ctx, argv[0]);
    const char *content = JS_ToCString(ctx, argv[1]);
    if (!path || !content) {
        if (path) JS_FreeCString(ctx, path);
        if (content) JS_FreeCString(ctx, content);
        return JS_EXCEPTION;
    }

    FILE *f = fopen(path, "wb");
    int ok = 0;
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
    if (argc < 1) return JS_ThrowTypeError(ctx, "path required");
    const char *path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_EXCEPTION;

    char cmd[1024];
    snprintf(cmd, sizeof(cmd),
             "ffprobe -v error -select_streams v:0 -show_entries "
             "stream=width,height,duration -of default=noprint_wrappers=1 \"%s\" 2>/dev/null",
             path);

    FILE *pipe = popen(cmd, "r");
    JS_FreeCString(ctx, path);
    if (!pipe) return JS_NULL;

    int width = 0, height = 0;
    double duration_sec = 0;
    char line[256];
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

    JSValue obj = JS_NewObject(ctx);
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
