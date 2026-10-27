#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build.py —— 词典笔 Falcon / QuickJS miniapp 构建脚本

流程：
1) 校验 app/data 下由用户生成的数据模块是否存在；缺失时给出可读提示
2) 把 pages/*/*.css 转成 Styles.js，并校验 height <= 220px / width <= 800px
3) 源码扁平化与依赖改写
4) 通过词典笔上的 jsfmc 编译成 .js.bin
5) 随附 native/prebuilt/libjsapi_gal.so 打包 .amr
6) 可选 --install 安装到设备

本仓库不包含任何游戏资源。资源放在设备的 /userdisk/gal_data/ 下，
不会被写进 .amr；.amr 只包含代码、图标和原生插件。
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.join(HERE, "app")
DATA_DIR = os.path.join(APP_DIR, "data")
PACKER = os.path.join(HERE, "tools", "pack_amr.py")
NATIVE_SO = os.path.join(HERE, "native", "prebuilt", "libjsapi_gal.so")

DEFAULT_APPID = "8002026102400099"
DEFAULT_NAME = "RibbonEngine"
DEFAULT_VERSION = "1.0.0"
PEN_LIB = os.environ.get("PEN_LIB", "/oem/YoudaoDictPen/output/libs:/usr/lib:/lib")
DEFAULT_JSFMC = os.environ.get("PEN_JSFMC", "/userdisk/skip_re/tools/jsfmc")
MAX_H, MAX_W = 220, 800
SERIAL = None

if "/opt/homebrew/bin" not in os.environ.get("PATH", ""):
    os.environ["PATH"] = os.environ.get("PATH", "") + ":/opt/homebrew/bin:/usr/local/bin"

STYLE_PAGES = ("title", "game", "gallery", "flowchart", "afterstory")

MODULES = [
    ("media.js", ["Media.js"]),
    ("common.js", ["Common.js"]),
    ("storage.js", ["Storage.js"]),
    ("data/story_data.js", ["StoryData.js"]),
    ("data/flowchart_data.js", ["FlowchartData.js"]),
    ("data/gallery_data.js", ["GalleryData.js"]),
    ("pages/title/title.js", ["TitleView.js"]),
    ("pages/game/game.js", ["GameView.js"]),
    ("pages/gallery/gallery.js", ["GalleryView.js"]),
    ("pages/flowchart/flowchart.js", ["FlowchartView.js"]),
    ("pages/afterstory/afterstory.js", ["AfterstoryView.js"]),
    ("root.js", ["Component.js"]),
    ("base-page.js", ["BasePage.js"]),
    ("page-entry.js", ["index.js", "shell.js"]),
    ("app.js", ["app.js"]),
]

IMPORT_MAP = {
    "../../media.js": "./Media.js",
    "./media.js": "./Media.js",
    "../../common.js": "./Common.js",
    "./common.js": "./Common.js",
    "../../storage.js": "./Storage.js",
    "./storage.js": "./Storage.js",
    "../../data/story_data.js": "./StoryData.js",
    "./data/story_data.js": "./StoryData.js",
    "../../data/flowchart_data.js": "./FlowchartData.js",
    "./data/flowchart_data.js": "./FlowchartData.js",
    "../../data/gallery_data.js": "./GalleryData.js",
    "./data/gallery_data.js": "./GalleryData.js",
    "./pages/title/title.js": "./TitleView.js",
    "./pages/game/game.js": "./GameView.js",
    "./pages/gallery/gallery.js": "./GalleryView.js",
    "./pages/flowchart/flowchart.js": "./FlowchartView.js",
    "./pages/afterstory/afterstory.js": "./AfterstoryView.js",
}

REQUIRED_DATA = (
    ("data/story_data.js", "export var STORY"),
    ("data/flowchart_data.js", "export var FLOWCHART"),
    ("data/gallery_data.js", "export var GALLERY"),
)


def die(message, code=1):
    print("[x] " + message)
    sys.exit(code)


def run(cmd, **kw):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore", **kw)
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except FileNotFoundError:
        return 127, "command not found: %s" % " ".join(cmd)


def adb(*args, timeout=180):
    cmd = ["adb"]
    if SERIAL:
        cmd += ["-s", SERIAL]
    cmd += list(args)
    return run(cmd, timeout=timeout)[1]


def list_adb_devices():
    ret, out = run(["adb", "devices"])
    if ret != 0:
        die("adb 不可用：\n%s" % out.strip())
    devices = []
    for line in out.splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 2 and parts[1] == "device":
            devices.append(parts[0])
    return devices


def resolve_serial(explicit=None):
    if explicit:
        return explicit
    env = os.environ.get("PEN_SERIAL")
    if env:
        return env
    devices = list_adb_devices()
    if len(devices) == 1:
        return devices[0]
    if not devices:
        die("没有检测到 adb 设备。请连接词典笔，或设置 PEN_SERIAL / --serial。")
    die("检测到多台 adb 设备：%s\n请用 PEN_SERIAL 或 --serial 指定一台。" % ", ".join(devices))


def check_inputs(icon_path, native_so):
    if not os.path.isdir(APP_DIR):
        die("app/ 目录不存在: %s" % APP_DIR)
    if not os.path.isfile(PACKER):
        die("缺少打包器: %s" % PACKER)
    if not os.path.isfile(icon_path):
        die("缺少应用图标: %s" % icon_path)
    if not os.path.isfile(native_so):
        die("缺少原生插件: %s" % native_so)

    missing = []
    for rel, marker in REQUIRED_DATA:
        path = os.path.join(APP_DIR, rel)
        if not os.path.isfile(path) or os.path.getsize(path) < 80:
            missing.append(rel)
            continue
        try:
            text = open(path, encoding="utf-8").read(200)
        except OSError:
            text = ""
        if marker not in text:
            die("%s 存在但内容不完整（未找到 %r）。请重新生成数据。" % (path, marker))
    if missing:
        print("[x] 未找到剧本数据模块：")
        for rel in missing:
            print("    - app/%s" % rel)
        print("")
        print("本仓库不附带任何游戏剧本或资源。请先按以下步骤生成：")
        print("  1. 阅读 app/data/README.md，准备 data_src/")
        print("  2. python3 tools/build_data.py --src data_src --out app/data")
        print("  3. 重新运行 python3 build.py")
        sys.exit(2)


def px(v):
    m = re.fullmatch(r"(-?\d+(?:\.\d+)?)px", v.strip())
    return float(m.group(1)) if m else None


def css_to_obj(path):
    with open(path, encoding="utf-8") as f:
        txt = re.sub(r"/\*.*?\*/", "", f.read(), flags=re.S)
    rules = {}
    for sel_group, body in re.findall(r"([^{}]+)\{([^}]*)\}", txt):
        obj = {}
        for decl in body.split(";"):
            if ":" not in decl:
                continue
            k, v = decl.split(":", 1)
            k = re.sub(r"-([a-z])", lambda m: m.group(1).upper(), k.strip())
            v = v.strip().replace(", ", ",")
            obj[k] = int(v) if re.fullmatch(r"\d+", v) else v
        # 逗号分隔的选择器组：每个 class 各得一份样式；
        # 复合/后代选择器落到最末 class（修饰态），运行时由 S() 按 class 顺序叠加。
        for sel in sel_group.split(","):
            parts = sel.split()
            if not parts or any(not re.fullmatch(r"(?:\.[A-Za-z0-9_-]+)+", p) for p in parts):
                continue
            rules[re.findall(r"\.([A-Za-z0-9_-]+)", parts[-1])[-1]] = obj
    return rules


def check_bounds(name, r):
    errs = []

    def g(k):
        v = r.get(k)
        return px(v) if isinstance(v, str) else None

    h, w, t, l = g("height"), g("width"), g("top"), g("left")
    if h is not None and h > MAX_H:
        errs.append("height %s > %d" % (h, MAX_H))
    if w is not None and w > MAX_W:
        errs.append("width %s > %d" % (w, MAX_W))
    if h is not None and t is not None and h + t > MAX_H:
        errs.append("top+height %s > %d" % (h + t, MAX_H))
    if w is not None and l is not None and w + l > MAX_W:
        errs.append("left+width %s > %d" % (w + l, MAX_W))
    return ["  .%s: %s" % (name, e) for e in errs]


def build_styles(out_dir):
    styles, errs = {}, []
    for page in STYLE_PAGES:
        css = os.path.join(APP_DIR, "pages", page, "%s.css" % page)
        if not os.path.isfile(css):
            die("缺少样式文件: %s" % css)
        rules = css_to_obj(css)
        for n, r in rules.items():
            errs += check_bounds(n, r)
        styles.update(rules)
    if errs:
        print("[x] CSS 尺寸越界:\n" + "\n".join(errs))
        sys.exit(1)
    src = "// 由 build.py 从 CSS 生成，勿手改\nvar ST = %s;\nexport default ST;\n" % json.dumps(
        styles, ensure_ascii=False, indent=1)
    with open(os.path.join(out_dir, "Styles.js"), "w", encoding="utf-8", newline="\n") as f:
        f.write(src)
    print("[1/4] CSS 校验通过，%d 个样式类 -> Styles.js" % len(styles))


def flatten(src):
    for a, b in IMPORT_MAP.items():
        src = src.replace("'%s'" % a, "'%s'" % b).replace('"%s"' % a, '"%s"' % b)
    return src.replace("\r\n", "\n")


def compile_all(stage, bins, jsfmc):
    print("[2/4] 用词典笔上的 jsfmc 编译 .js.bin")
    adb("shell", "mkdir -p /userdisk/skip_re/tools /tmp/gal_b")
    mods = [("Styles.js", os.path.join(stage, "Styles.js"))]
    for srcrel, names in MODULES:
        path = os.path.join(APP_DIR, srcrel)
        if not os.path.isfile(path):
            die("缺少源文件: %s" % path)
        s = flatten(open(path, encoding="utf-8").read())
        for n in names:
            p = os.path.join(stage, "src_" + n)
            open(p, "w", encoding="utf-8", newline="\n").write(s)
            mods.append((n, p))
    for mod, local in mods:
        stem = mod[:-3]
        adb("push", local, "/tmp/gal_b/%s.js" % stem)
        out = adb("shell", "export LD_LIBRARY_PATH=%s; %s -o /tmp/gal_b/%s.bin -n %s /tmp/gal_b/%s.js" % (
            PEN_LIB, jsfmc, stem, mod, stem))
        line = [l for l in out.splitlines() if "源码)" in l]
        if not line:
            die("编译 %s 失败:\n%s" % (mod, out.strip()[:800]))
        dst = os.path.join(bins, mod + ".bin")
        adb("pull", "/tmp/gal_b/%s.bin" % stem, dst)
        print("      %-18s %s" % (mod, line[0].strip()))

    for n in ("index.js.bin", "shell.js.bin"):
        for sub in STYLE_PAGES:
            os.makedirs(os.path.join(bins, "pages", sub), exist_ok=True)
            shutil.copy(os.path.join(bins, n), os.path.join(bins, "pages", sub, n))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--install", action="store_true", help="打包后安装并启动")
    ap.add_argument("--check", action="store_true", help="只校验数据/CSS/依赖，不连接设备")
    ap.add_argument("--serial", default=None, help="adb 设备序列号；也可用 PEN_SERIAL")
    ap.add_argument("--jsfmc", default=DEFAULT_JSFMC, help="设备上的 jsfmc 路径")
    ap.add_argument("--appid", default=DEFAULT_APPID)
    ap.add_argument("--name", default=DEFAULT_NAME)
    ap.add_argument("--version", default=DEFAULT_VERSION)
    ap.add_argument("--icon", default=os.path.join(APP_DIR, "app_icon.png"))
    ap.add_argument("--native", default=NATIVE_SO)
    args = ap.parse_args()

    icon_path = os.path.abspath(args.icon)
    native_so = os.path.abspath(args.native)
    check_inputs(icon_path, native_so)

    build = os.path.join(HERE, "build")
    stage, bins = os.path.join(build, "stage"), os.path.join(build, "bins")
    for d in (stage, bins):
        shutil.rmtree(d, ignore_errors=True)
        os.makedirs(d, exist_ok=True)

    build_styles(stage)

    if args.check:
        print("[ok] 数据模块、CSS、图标、原生插件、打包器均就绪。")
        print("     --check 未连接设备；实际构建需要 adb 与设备上的 jsfmc。")
        return

    global SERIAL
    SERIAL = resolve_serial(args.serial)
    compile_all(stage, bins, args.jsfmc)

    print("[3/4] 组装 .amr 目录")
    amr_dir = os.path.join(build, "amr")
    shutil.rmtree(amr_dir, ignore_errors=True)
    shutil.copytree(bins, amr_dir)

    for f in ("manifest.json", "app.json", "app_icon.png"):
        src = os.path.join(APP_DIR, f)
        if os.path.exists(src):
            shutil.copy(src, amr_dir)

    for page in STYLE_PAGES:
        src_json = os.path.join(APP_DIR, "pages", page, "%s.json" % page)
        dst_dir = os.path.join(amr_dir, "pages", page)
        os.makedirs(dst_dir, exist_ok=True)
        if os.path.exists(src_json):
            shutil.copy(src_json, dst_dir)

    for sub in ("arm64", "arm64-orange"):
        d = os.path.join(amr_dir, "libs", sub)
        os.makedirs(d, exist_ok=True)
        shutil.copy(native_so, d)

    print("[4/4] 打包 .amr")
    dist = os.path.join(HERE, "dist")
    os.makedirs(dist, exist_ok=True)
    amr_path = os.path.join(dist, "gal-engine-%s.amr" % args.version)

    ret, out = run([
        sys.executable, PACKER,
        "--src", bins,
        "--out", amr_path,
        "--appid", args.appid,
        "--name", args.name,
        "--version", args.version,
        "--icon", icon_path,
        "--lib", "arm64=" + native_so,
        "--lib", "arm64-orange=" + native_so,
    ])
    if ret != 0:
        die("pack_amr.py 失败:\n%s" % out)
    sz = os.path.getsize(amr_path)
    print("      已生成 %s (%.1f KB)" % (amr_path, sz / 1024))
    print("      注意：.amr 只含代码/图标/原生插件，不含游戏资源。")

    if args.install:
        print("[+] 安装到词典笔 (appid=%s)" % args.appid)
        adb("push", amr_path, "/tmp/gal-engine.amr")
        adb("shell", "miniapp_cli uninstall %s >/dev/null 2>&1" % args.appid)
        time.sleep(1)
        res_inst = adb("shell", "miniapp_cli install /tmp/gal-engine.amr")
        print("      " + res_inst.strip())
        time.sleep(1)
        print("[+] 启动应用...")
        out_start = adb("shell", "miniapp_cli start %s" % args.appid)
        print("      " + out_start.strip())


if __name__ == "__main__":
    main()
