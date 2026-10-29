#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""import_assets.py —— 校验并整理用户自己解包/转换后的资源。

本工具只做本地文件校验与复制，不解包、不下载、不连接设备。
输入目录约定（缺省目录可以不存在）：

    <source>/bg/*.png           背景（必须包含 title_bg.png）
    <source>/fg/*.png           立绘
    <source>/bgm/*.opus|ogg|mp3  BGM
    <source>/voice/*.ogg        语音
    <source>/ema/*.jpg          绘马（会放到 bg/ema/）
    <source>/cg/*.png           CG
    <source>/title_bg.png       也可以把标题背景放在根目录

用法：
    python3 tools/import_assets.py --source assets_src --stage build/device_assets
    python3 tools/import_assets.py --source assets_src --stage build/device_assets --hash
    python3 tools/import_assets.py --source assets_src --refs app/data/.data_manifest.json
    python3 tools/import_assets.py --source assets_src --stage build/device_assets --print-adb
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import struct
import sys
from pathlib import Path, PurePosixPath

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}
BGM_EXTS = {".opus", ".ogg", ".mp3", ".wav"}
VOICE_EXTS = {".ogg", ".opus", ".wav"}

SOURCE_DIRS = {
    "bg": ("bg", IMAGE_EXTS),
    "fg": ("fg", IMAGE_EXTS),
    "stand": ("stand", IMAGE_EXTS),
    "sd": ("sd", IMAGE_EXTS),
    "bgm": ("bgm", BGM_EXTS),
    "voice": ("voice", VOICE_EXTS),
    "ema": ("bg/ema", IMAGE_EXTS),
    "cg": ("cg", IMAGE_EXTS),
    "fx": ("fx", IMAGE_EXTS),
}

RECOMMENDED = {
    "bg": (960, 540),
    "fg": (780, 440),
    "stand": (780, 440),
    "sd": (390, 220),
}


def fail(message: str) -> None:
    print("[x] %s" % message, file=sys.stderr)
    raise SystemExit(2)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def image_size(path: Path):
    try:
        with path.open("rb") as handle:
            header = handle.read(32)
            if header.startswith(b"\x89PNG\r\n\x1a\n") and len(header) >= 24:
                width, height = struct.unpack(">II", header[16:24])
                return int(width), int(height)
            if header.startswith(b"\xff\xd8"):
                handle.seek(2)
                while True:
                    marker = handle.read(2)
                    if len(marker) < 2:
                        return None
                    if marker[0] != 0xFF:
                        return None
                    code = marker[1]
                    if code in (0xD8, 0xD9):
                        continue
                    length_bytes = handle.read(2)
                    if len(length_bytes) < 2:
                        return None
                    length = struct.unpack(">H", length_bytes)[0]
                    if code in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                        data = handle.read(5)
                        if len(data) < 5:
                            return None
                        height, width = struct.unpack(">HH", data[1:5])
                        return int(width), int(height)
                    handle.seek(max(0, length - 2), 1)
    except OSError:
        return None
    return None


def safe_relative(path: Path, root: Path) -> PurePosixPath:
    rel = PurePosixPath(path.relative_to(root).as_posix())
    if rel.is_absolute() or ".." in rel.parts:
        fail("非法文件路径: %s" % path)
    if any(part.startswith("._") or part == ".DS_Store" for part in rel.parts):
        fail("请不要把 macOS 元数据文件放进资源目录: %s" % path)
    return rel


def collect(source: Path, stage: Path, do_hash: bool, strict_size: bool):
    if not source.is_dir():
        fail("资源目录不存在: %s" % source)
    entries = []
    counts = {}
    warnings = []

    for key, (dest_sub, exts) in SOURCE_DIRS.items():
        src_dir = source / key
        if not src_dir.is_dir():
            counts[key] = 0
            warnings.append("缺少目录 %s/（可为空，但对应功能可能无内容）" % key)
            continue
        files = []
        for path in sorted(src_dir.rglob("*")):
            if not path.is_file():
                continue
            rel = safe_relative(path, src_dir)
            if path.suffix.lower() not in exts:
                fail("%s 扩展名不在允许范围 %s" % (path, ",".join(sorted(exts))))
            files.append((path, rel))
        counts[key] = len(files)
        for path, rel in files:
            dest_rel = PurePosixPath(dest_sub) / rel
            size = path.stat().st_size
            if size <= 0:
                fail("空文件: %s" % path)
            width = height = None
            if path.suffix.lower() in IMAGE_EXTS:
                dims = image_size(path)
                if dims:
                    width, height = dims
                else:
                    warnings.append("无法读取图片尺寸: %s" % path)
                if strict_size and key in RECOMMENDED and (width, height) != RECOMMENDED[key]:
                    fail("%s 尺寸应为 %dx%d，实际 %sx%s" % (
                        path, RECOMMENDED[key][0], RECOMMENDED[key][1], width, height))
            entries.append({
                "source": str(path),
                "stage": dest_rel.as_posix(),
                "size": size,
                "width": width,
                "height": height,
                "sha256": sha256(path) if do_hash else None,
            })

    # 同一个 stage 路径可能同时来自 bg/ema 与 ema/，保留一个即可。
    deduped = {}
    for entry in entries:
        deduped[entry["stage"]] = entry
    entries = [deduped[key] for key in sorted(deduped)]

    # 允许 title_bg.png 直接放在 source 根目录。
    root_title = source / "title_bg.png"
    if root_title.is_file():
        entries.append({
            "source": str(root_title),
            "stage": "bg/title_bg.png",
            "size": root_title.stat().st_size,
            "width": (image_size(root_title) or (None, None))[0],
            "height": (image_size(root_title) or (None, None))[1],
            "sha256": sha256(root_title) if do_hash else None,
        })
        counts["bg"] = counts.get("bg", 0) + 1

    if not any(Path(entry["stage"]).name == "title_bg.png" for entry in entries):
        fail("缺少 title_bg.png（放在 source/bg/ 或 source/ 根目录）")

    if not counts.get("voice"):
        warnings.append("voice/ 为空：台词将没有语音")
    if not counts.get("bgm"):
        warnings.append("bgm/ 为空：不会播放 BGM")
    if not counts.get("fg"):
        warnings.append("fg/ 为空：不会显示立绘")

    return entries, counts, warnings


def copy_entries(entries, stage: Path):
    stage.mkdir(parents=True, exist_ok=True)
    for sub in ("bg", "bg/ema", "fg", "stand", "sd", "bgm", "voice", "cg", "fx"):
        (stage / sub).mkdir(parents=True, exist_ok=True)
    for entry in entries:
        src = Path(entry["source"])
        dest = stage / entry["stage"]
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)


def check_refs(refs_path: Path, root: Path):
    if not refs_path.is_file():
        fail("引用清单不存在: %s" % refs_path)
    refs = json.loads(refs_path.read_text(encoding="utf-8-sig"))
    missing = []

    def exists_variant(base: Path, exts):
        if base.is_file():
            return True
        for ext in exts:
            if base.with_suffix(ext).is_file():
                return True
        return False

    title_candidates = [root / "bg" / "title_bg.png", root / "title_bg.png"]
    if not any(candidate.is_file() for candidate in title_candidates):
        missing.append("bg/title_bg.png")

    def check_bg(name):
        # 源目录可以把绘马放在 ema/，部署时才放到 bg/ema/。
        candidates = [root / "bg" / name]
        if name.startswith("ema/"):
            candidates.append(root / name)
        return any(exists_variant(candidate, IMAGE_EXTS) for candidate in candidates)

    for name in refs.get("backgrounds", []):
        if not check_bg(name):
            missing.append("bg/%s" % name)
    for name in refs.get("sprites", []):
        if not exists_variant(root / "fg" / name, IMAGE_EXTS):
            missing.append("fg/%s" % name)
    for name in refs.get("stand", []):
        if not exists_variant(root / "stand" / name, IMAGE_EXTS):
            missing.append("stand/%s" % name)
    for name in refs.get("sd", []):
        if not exists_variant(root / "sd" / name, IMAGE_EXTS):
            missing.append("sd/%s" % name)
    for name in refs.get("fx", []):
        if not exists_variant(root / "fx" / name, IMAGE_EXTS):
            missing.append("fx/%s" % name)
    for name in refs.get("voices", []):
        if not exists_variant(root / "voice" / name, VOICE_EXTS):
            missing.append("voice/%s" % name)
    for name in refs.get("bgms", []):
        if not exists_variant(root / "bgm" / name, BGM_EXTS):
            missing.append("bgm/%s" % name)
    for name in refs.get("covers", []):
        if not check_bg(name):
            missing.append("bg/%s" % name)
    for name in refs.get("cg", []):
        if not exists_variant(root / "cg" / name, IMAGE_EXTS):
            missing.append("cg/%s" % name)

    if missing:
        print("[x] 资源引用缺失 %d 项：" % len(missing), file=sys.stderr)
        for item in missing[:80]:
            print("    - %s" % item, file=sys.stderr)
        if len(missing) > 80:
            print("    ... 其余 %d 项省略" % (len(missing) - 80), file=sys.stderr)
        raise SystemExit(1)
    print("[ok] 资源引用检查通过：%d 个引用全部存在" % (
        len(refs.get("backgrounds", [])) + len(refs.get("sprites", [])) +
        len(refs.get("voices", [])) + len(refs.get("bgms", [])) +
        len(refs.get("covers", [])) + len(refs.get("cg", [])) + 1
    ))


def deploy_commands(stage: Path, target_dir: str = "/userdisk/gal_data"):
    commands = [
        'adb -s "$PEN_SERIAL" shell "mkdir -p %s/bg %s/fg %s/bgm %s/voice %s/cg %s/sd %s/fx"' % (
            target_dir, target_dir, target_dir, target_dir, target_dir, target_dir, target_dir
        ),
        'adb -s "$PEN_SERIAL" push "%s/." "%s/bg/"' % (stage / "bg", target_dir),
        'adb -s "$PEN_SERIAL" push "%s/." "%s/fg/"' % (stage / "fg", target_dir),
        'adb -s "$PEN_SERIAL" push "%s/." "%s/bgm/"' % (stage / "bgm", target_dir),
        'adb -s "$PEN_SERIAL" push "%s/." "%s/voice/"' % (stage / "voice", target_dir),
        'adb -s "$PEN_SERIAL" push "%s/." "%s/cg/"' % (stage / "cg", target_dir),
    ]
    return commands


def main() -> int:
    parser = argparse.ArgumentParser(description="校验并整理词典笔本地资源")
    parser.add_argument("--source", required=True, help="用户解包/转换后的资源目录")
    parser.add_argument("--stage", default="build/device_assets", help="整理后的输出目录")
    parser.add_argument("--target-dir", default="/userdisk/gal_data", help="词典笔端目标根目录，默认 /userdisk/gal_data")
    parser.add_argument("--report", default=None, help="校验报告 JSON 路径")
    parser.add_argument("--refs", default=None, help="build_data.py 生成的 .data_manifest.json")
    parser.add_argument("--check", action="store_true", help="只校验，不复制")
    parser.add_argument("--hash", action="store_true", help="计算 sha256（大资源会慢）")
    parser.add_argument("--strict-size", action="store_true", help="严格检查 960x540 背景 / 780x440 立绘")
    parser.add_argument("--print-adb", action="store_true", help="打印部署到词典笔的 adb 命令")
    parser.add_argument("--deploy-script", default=None, help="把部署命令写成语义清晰的 shell 脚本")
    args = parser.parse_args()

    source = Path(args.source).resolve()
    stage = Path(args.stage).resolve()
    entries, counts, warnings = collect(source, stage, args.hash, args.strict_size)

    root_for_refs = stage if (stage / "bg" / "title_bg.png").is_file() else source
    if args.refs:
        check_refs(Path(args.refs), root_for_refs)

    if args.print_adb:
        for command in deploy_commands(stage, args.target_dir):
            print(command)

    if args.deploy_script:
        script = Path(args.deploy_script)
        script.parent.mkdir(parents=True, exist_ok=True)
        lines = ["#!/usr/bin/env bash", "set -euo pipefail", ': "${PEN_SERIAL:?set PEN_SERIAL first}"', ""]
        lines.extend(deploy_commands(stage, args.target_dir))
        with script.open("w", encoding="utf-8", newline="\n") as handle:
            handle.write("\n".join(lines) + "\n")
        script.chmod(0o755)
        print("[ok] 部署脚本: %s" % script)

    if not args.check:
        copy_entries(entries, stage)
        print("[ok] 已整理到 %s/" % stage)
    else:
        print("[ok] 校验通过（--check 未复制文件）")

    print("[ok] 文件统计: " + ", ".join("%s=%d" % (key, counts.get(key, 0)) for key in ("bg", "fg", "bgm", "voice", "ema", "cg")))
    for warning in warnings:
        print("[!] %s" % warning)

    report_path = Path(args.report) if args.report else (stage.parent / "asset_report.json")
    report = {
        "source": str(source),
        "stage": str(stage),
        "check": bool(args.check),
        "counts": counts,
        "warnings": warnings,
        "files": entries,
    }
    if not args.check:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        with report_path.open("w", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        print("[ok] 报告: %s" % report_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
