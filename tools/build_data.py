#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build_data.py —— 把用户自行准备的剧本/拓扑数据转换为引擎模块。

本工具不包含、不下载、不解析任何游戏原始资源。输入必须是使用者自己整理好的
JSON / JSONL；输出为 app/data/story_data.js、flowchart_data.js、gallery_data.js。

用法：
    python3 tools/build_data.py --src data_src --out app/data
    python3 tools/build_data.py --src data_src --out app/data --check
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path, PurePosixPath

IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp")
VOICE_EXTS = (".ogg", ".opus", ".wav")
BGM_EXTS = (".opus", ".ogg", ".mp3", ".wav")
SAFE_KEY = re.compile(r"^[A-Za-z0-9_]+$")


class DataError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise DataError(message)


def warn(message: str, warnings: list[str]) -> None:
    warnings.append(message)


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        fail("缺少文件: %s" % path)
    except json.JSONDecodeError as exc:
        fail("%s JSON 解析失败: %s" % (path, exc))


def read_jsonl(path: Path) -> list:
    rows = []
    try:
        text = path.read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        fail("缺少文件: %s" % path)
    for lineno, line in enumerate(text.splitlines(), 1):
        stripped = line.strip()
        if not stripped:
            continue
        try:
            rows.append(json.loads(stripped))
        except json.JSONDecodeError as exc:
            fail("%s 第 %d 行不是合法 JSON: %s" % (path, lineno, exc))
    if not rows:
        fail("%s 为空" % path)
    return rows


def safe_name(value, field: str, allow_subpath: bool = False):
    if value is None:
        return None
    if not isinstance(value, str):
        fail("%s 必须是字符串或 null" % field)
    value = value.strip()
    if not value:
        return None
    if "\x00" in value or "\\" in value:
        fail("%s 含非法字符: %r" % (field, value))
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts:
        fail("%s 不能是绝对路径或包含 ..: %r" % (field, value))
    if not allow_subpath and len(path.parts) != 1:
        fail("%s 不能包含子目录: %r" % (field, value))
    return value


def normalize_asset(value, field: str, exts, allow_subpath: bool = False):
    value = safe_name(value, field, allow_subpath=allow_subpath)
    if value is None:
        return None
    lower = value.lower()
    for ext in exts:
        if lower.endswith(ext):
            return value
    if "." in PurePosixPath(value).name:
        fail("%s 扩展名不在允许范围 %s: %r" % (field, ",".join(exts), value))
    return value


def normalize_character(value, field: str):
    if value is None:
        return None
    if not isinstance(value, dict):
        fail("%s 必须是对象或 null" % field)
    sprite = safe_name(value.get("sprite"), field + ".sprite")
    if sprite:
        return {"sprite": sprite}
    char = safe_name(value.get("char"), field + ".char")
    if not char:
        fail("%s 需要 sprite 或 char 字段" % field)
    result = {"char": char}
    for key in ("dress", "face"):
        item = safe_name(value.get(key), field + "." + key)
        if item:
            result[key] = item
    return result


def row_from_object(obj: dict) -> list:
    return [
        obj.get("id"),
        obj.get("speaker", ""),
        obj.get("text", ""),
        obj.get("voice"),
        obj.get("bg"),
        obj.get("bgm"),
        obj.get("character"),
        obj.get("chapter"),
        obj.get("cg"),
        obj.get("sd"),
    ]


def normalize_row(raw, index: int, default_chapter: str, where: str, warnings: list[str]):
    if isinstance(raw, dict):
        raw = row_from_object(raw)
    if not isinstance(raw, (list, tuple)):
        fail("%s 第 %d 行必须是数组或对象" % (where, index + 1))
    if len(raw) == 7:
        raw = list(raw) + [default_chapter]
    if len(raw) not in (8, 9, 10):
        fail("%s 第 %d 行需要 7~10 个字段，实际 %d 个" % (where, index + 1, len(raw)))
    line_id = raw[0]
    if line_id is None:
        line_id = index
    if isinstance(line_id, bool) or not isinstance(line_id, int):
        fail("%s 第 %d 行 lineId 必须是整数" % (where, index + 1))
    if line_id != index:
        warn("%s 第 %d 行 lineId=%d 与下标不一致（引擎按数组下标存档）" % (where, index + 1, line_id), warnings)
    speaker = raw[1]
    if speaker is None:
        speaker = ""
    if not isinstance(speaker, str):
        fail("%s 第 %d 行 speaker 必须是字符串" % (where, index + 1))
    text = raw[2]
    if text is None:
        text = ""
    if not isinstance(text, str):
        fail("%s 第 %d 行 text 必须是字符串" % (where, index + 1))
    voice = normalize_asset(raw[3], "%s 第 %d 行 voice" % (where, index + 1), VOICE_EXTS)
    bg = normalize_asset(raw[4], "%s 第 %d 行 bg" % (where, index + 1), IMAGE_EXTS, allow_subpath=True)
    bgm = normalize_asset(raw[5], "%s 第 %d 行 bgm" % (where, index + 1), BGM_EXTS)
    character = normalize_character(raw[6], "%s 第 %d 行 character" % (where, index + 1))
    chapter = raw[7]
    if chapter is None or chapter == "":
        chapter = default_chapter or "--"
    if not isinstance(chapter, str):
        fail("%s 第 %d 行 chapter 必须是字符串" % (where, index + 1))
    chapter = re.sub(r"^chapter[\s\u3000]*", "", chapter, flags=re.I).strip() or (default_chapter or "--")
    cg = normalize_asset(raw[8], "%s 第 %d 行 cg" % (where, index + 1),
                         IMAGE_EXTS, allow_subpath=True) if len(raw) > 8 else None
    sd = normalize_asset(raw[9], "%s 第 %d 行 sd" % (where, index + 1),
                         IMAGE_EXTS, allow_subpath=True) if len(raw) > 9 else None
    return [line_id, speaker, text, voice, bg, bgm, character, chapter.strip() or "--", cg, sd]


def normalize_story(rows, where: str, default_chapter: str, warnings: list[str]):
    if not isinstance(rows, list):
        fail("%s 必须是数组" % where)
    result = []
    for index, raw in enumerate(rows):
        result.append(normalize_row(raw, index, default_chapter, where, warnings))
    return result


def normalize_after_meta(raw, after: dict, warnings: list[str]):
    if not isinstance(raw, list):
        fail("afterMeta 必须是数组")
    result = []
    seen = set()
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            fail("afterMeta 第 %d 项必须是对象" % (index + 1))
        key = item.get("key")
        if not isinstance(key, str) or not SAFE_KEY.match(key):
            fail("afterMeta 第 %d 项 key 只能包含字母、数字、下划线" % (index + 1))
        if key in seen:
            fail("afterMeta key 重复: %s" % key)
        seen.add(key)
        if key not in after:
            fail("afterMeta key=%s 没有对应的 after 剧本" % key)
        entry = {
            "key": key,
            "name": str(item.get("name") or key),
            "chapter": str(item.get("chapter") or ""),
            "title": str(item.get("title") or item.get("name") or key),
            "voice": normalize_asset(item.get("voice"), "afterMeta.%s.voice" % key, VOICE_EXTS),
            "cover": safe_name(item.get("cover"), "afterMeta.%s.cover" % key, allow_subpath=True),
        }
        result.append(entry)
    for key in after:
        if key not in seen:
            fail("after 剧本 %s 缺少 afterMeta 条目" % key)
    return result


def normalize_flowchart(raw, warnings: list[str]):
    if not isinstance(raw, dict):
        fail("flowchart 必须是对象")
    routes = raw.get("routes")
    if not isinstance(routes, list) or not routes:
        fail("flowchart.routes 必须是非空数组")
    if any(not isinstance(route, str) or not route.strip() for route in routes):
        fail("flowchart.routes 每一项必须是非空字符串")
    nodes = raw.get("nodes")
    if not isinstance(nodes, list) or not nodes:
        fail("flowchart.nodes 必须是非空数组")
    node_ids = set()
    clean_nodes = []
    for index, node in enumerate(nodes):
        if not isinstance(node, dict):
            fail("flowchart.nodes 第 %d 项必须是对象" % (index + 1))
        node_id = node.get("id")
        if not isinstance(node_id, str) or not node_id:
            fail("flowchart.nodes 第 %d 项缺少 id" % (index + 1))
        if node_id in node_ids:
            fail("flowchart.nodes id 重复: %s" % node_id)
        node_ids.add(node_id)
        route = node.get("route")
        if route not in routes:
            fail("flowchart node %s 的 route 不在 routes 中" % node_id)
        target_line = node.get("targetLine")
        if target_line is not None and (isinstance(target_line, bool) or not isinstance(target_line, int) or target_line < 0):
            fail("flowchart node %s 的 targetLine 必须是 >=0 的整数或 null" % node_id)
        next_value = node.get("next")
        if isinstance(next_value, list):
            for item in next_value:
                if not isinstance(item, str):
                    fail("flowchart node %s 的 next 数组必须是字符串" % node_id)
        elif next_value is not None and not isinstance(next_value, str):
            fail("flowchart node %s 的 next 必须是字符串、字符串数组或 null" % node_id)
        clean_nodes.append({
            "id": node_id,
            "type": str(node.get("type") or "section"),
            "route": route,
            "chapter": str(node.get("chapter") or ""),
            "title": str(node.get("title") or node_id),
            "targetLine": target_line,
            "next": next_value,
        })
    choices = raw.get("choices") or []
    if not isinstance(choices, list):
        fail("flowchart.choices 必须是数组")
    clean_choices = []
    for index, choice in enumerate(choices):
        if not isinstance(choice, dict):
            fail("flowchart.choices 第 %d 项必须是对象" % (index + 1))
        choice_id = choice.get("id")
        if not isinstance(choice_id, str) or not choice_id:
            fail("flowchart.choices 第 %d 项缺少 id" % (index + 1))
        if choice_id not in node_ids:
            warn("flowchart choice id=%s 没有对应节点" % choice_id, warnings)
        target_line = choice.get("targetLine")
        if target_line is not None and (isinstance(target_line, bool) or not isinstance(target_line, int) or target_line < 0):
            fail("flowchart choice %s 的 targetLine 必须是 >=0 的整数或 null" % choice_id)
        options = choice.get("options")
        if not isinstance(options, list) or not options:
            fail("flowchart choice %s 的 options 必须是非空数组" % choice_id)
        clean_options = []
        for option in options:
            if not isinstance(option, dict):
                fail("flowchart choice %s 的 option 必须是对象" % choice_id)
            target_node = option.get("targetNode")
            if target_node is not None and target_node not in node_ids:
                fail("flowchart choice %s 的 targetNode 不存在: %s" % (choice_id, target_node))
            option_line = option.get("targetLine")
            if option_line is not None and (isinstance(option_line, bool) or not isinstance(option_line, int) or option_line < 0):
                fail("flowchart choice %s 的 option.targetLine 必须是 >=0 的整数或 null" % choice_id)
            if target_node is None and option_line is None:
                fail("flowchart choice %s 的 option 需要 targetNode 或 targetLine" % choice_id)
            clean_options.append({
                "index": int(option.get("index") or (len(clean_options) + 1)),
                "text": str(option.get("text") or ""),
                "targetNode": target_node,
                "targetLine": option_line,
                "flagGain": option.get("flagGain") if isinstance(option.get("flagGain"), dict) else None,
            })
        clean_choices.append({
            "id": choice_id,
            "prompt": str(choice.get("prompt") or ""),
            "targetLine": target_line,
            "options": clean_options,
        })
    chain = raw.get("chain") or {}
    if not isinstance(chain, dict):
        fail("flowchart.chain 必须是对象")
    route_art = raw.get("routeArt") or {}
    if not isinstance(route_art, dict):
        fail("flowchart.routeArt 必须是对象")
    clean_art = {}
    for route, value in route_art.items():
        if route not in routes:
            fail("flowchart.routeArt 的 route 不在 routes 中: %s" % route)
        clean_art[route] = safe_name(value, "flowchart.routeArt.%s" % route, allow_subpath=True)
    return {
        "routes": routes,
        "nodes": clean_nodes,
        "choices": clean_choices,
        "chain": chain,
        "routeArt": clean_art,
    }


def normalize_gallery(raw, warnings: list[str]):
    if raw is None:
        return {"cgGroups": [], "cg": [], "sceneGroups": [], "scenes": [],
                "standChars": [], "standBackgrounds": [], "bgm": []}
    if not isinstance(raw, dict):
        fail("gallery 必须是对象")
    cg_raw = raw.get("cg") or []
    bgm_raw = raw.get("bgm") or []
    if not isinstance(cg_raw, list) or not isinstance(bgm_raw, list):
        fail("gallery.cg / gallery.bgm 必须是数组")

    def key_of(item, field):
        value = item.get("key") or item.get("id")
        if not isinstance(value, str) or not SAFE_KEY.match(value):
            fail("%s 的 key 只能包含字母、数字、下划线: %r" % (field, value))
        return value

    cg_groups = []
    group_keys = set()
    for index, item in enumerate(raw.get("cgGroups") or []):
        if not isinstance(item, dict):
            fail("gallery.cgGroups 第 %d 项必须是对象" % (index + 1))
        key = key_of(item, "cgGroups[%d]" % index)
        if key in group_keys:
            fail("gallery.cgGroups key 重复: %s" % key)
        group_keys.add(key)
        cg_groups.append({"key": key, "name": str(item.get("name") or key)})

    cg = []
    for index, item in enumerate(cg_raw):
        if not isinstance(item, dict):
            fail("gallery.cg 第 %d 项必须是对象" % (index + 1))
        file_name = normalize_asset(item.get("file"), "gallery.cg[%d].file" % index, IMAGE_EXTS, allow_subpath=True)
        if not file_name:
            fail("gallery.cg 第 %d 项缺少 file" % (index + 1))
        group = str(item.get("group") or item.get("role") or "")
        if not group:
            fail("gallery.cg 第 %d 项缺少 group/role" % (index + 1))
        if group_keys and group not in group_keys:
            fail("gallery.cg 第 %d 项 group=%s 不在 cgGroups 中" % (index + 1, group))
        cg.append({
            "id": str(item.get("id") or ("cg_%d" % (index + 1))),
            "code": str(item.get("code") or ("CG%02d" % (index + 1))),
            "group": group,
            "role": str(item.get("role") or group),
            "file": file_name,
            "unlocked": bool(item.get("unlocked", True)),
        })
    if not cg_groups and cg:
        for group in sorted({item["group"] for item in cg}):
            cg_groups.append({"key": group, "name": group})

    scene_groups = []
    scene_keys = set()
    for index, item in enumerate(raw.get("sceneGroups") or []):
        if not isinstance(item, dict):
            fail("gallery.sceneGroups 第 %d 项必须是对象" % (index + 1))
        key = key_of(item, "sceneGroups[%d]" % index)
        scene_keys.add(key)
        scene_groups.append({"key": key, "name": str(item.get("name") or key)})

    scenes = []
    for index, item in enumerate(raw.get("scenes") or []):
        if not isinstance(item, dict):
            fail("gallery.scenes 第 %d 项必须是对象" % (index + 1))
        group = str(item.get("group") or item.get("route") or "")
        if scene_keys and group not in scene_keys:
            fail("gallery.scenes 第 %d 项 group=%s 不在 sceneGroups 中" % (index + 1, group))
        variants = item.get("variants") or ([item.get("cover")] if item.get("cover") else [])
        if not isinstance(variants, list):
            fail("gallery.scenes 第 %d 项 variants 必须是数组" % (index + 1))
        clean_variants = []
        for v in variants:
            value = normalize_asset(v, "gallery.scenes[%d].variants" % index, IMAGE_EXTS, allow_subpath=True)
            if value:
                clean_variants.append(value)
        scenes.append({
            "id": str(item.get("id") or ("scene_%d" % (index + 1))),
            "title": str(item.get("title") or item.get("name") or ""),
            "group": group,
            "route": str(item.get("route") or group),
            "cover": clean_variants[0] if clean_variants else "",
            "variants": clean_variants,
        })

    stand_chars = []
    for index, item in enumerate(raw.get("standChars") or []):
        if not isinstance(item, dict):
            fail("gallery.standChars 第 %d 项必须是对象" % (index + 1))
        char = item.get("char") or item.get("key")
        if not isinstance(char, str) or not char:
            fail("gallery.standChars 第 %d 项缺少 char/key" % (index + 1))
        dresses = item.get("dresses") or []
        if not isinstance(dresses, list) or not dresses:
            fail("gallery.standChars 第 %d 项 dresses 必须是非空数组" % (index + 1))
        stand_chars.append({
            "key": str(item.get("key") or char),
            "name": str(item.get("name") or char),
            "char": char,
            "dresses": [str(d) for d in dresses],
            "faces": max(1, int(item.get("faces") or 1)),
        })

    stand_backgrounds = []
    for index, item in enumerate(raw.get("standBackgrounds") or []):
        if not isinstance(item, dict):
            fail("gallery.standBackgrounds 第 %d 项必须是对象" % (index + 1))
        stand_backgrounds.append({
            "name": str(item.get("name") or ("背景 %d" % (index + 1))),
            "file": normalize_asset(item.get("file"), "gallery.standBackgrounds[%d].file" % index,
                                    IMAGE_EXTS, allow_subpath=True) or "",
        })

    bgm = []
    for index, item in enumerate(bgm_raw):
        if not isinstance(item, dict):
            fail("gallery.bgm 第 %d 项必须是对象" % (index + 1))
        file_name = normalize_asset(item.get("file"), "gallery.bgm[%d].file" % index, BGM_EXTS)
        if not file_name:
            fail("gallery.bgm 第 %d 项缺少 file" % (index + 1))
        bgm.append({
            "id": str(item.get("id") or ("bgm_%d" % (index + 1))),
            "code": str(item.get("code") or file_name),
            "title": str(item.get("title") or item.get("name") or ""),
            "file": file_name,
        })
    return {
        "cgGroups": cg_groups,
        "cg": cg,
        "sceneGroups": scene_groups,
        "scenes": scenes,
        "standChars": stand_chars,
        "standBackgrounds": stand_backgrounds,
        "bgm": bgm,
    }


def load_story(src: Path, warnings: list[str]):
    story_json = src / "story.json"
    if story_json.is_file():
        raw = read_json(story_json)
        if not isinstance(raw, dict):
            fail("story.json 必须是对象")
        main_raw = raw.get("main")
        if main_raw is None:
            fail("story.json 缺少 main")
        main = normalize_story(main_raw, "story.json.main", "", warnings)
        after_raw = raw.get("after") or {}
        if not isinstance(after_raw, dict):
            fail("story.json.after 必须是对象")
        after = {}
        for key, rows in after_raw.items():
            if not SAFE_KEY.match(str(key)):
                fail("after key 只能包含字母、数字、下划线: %r" % key)
            after[key] = normalize_story(rows, "story.json.after.%s" % key, "", warnings)
        after_meta_raw = raw.get("afterMeta") or []
        if after and not after_meta_raw:
            fail("story.json 有 after 剧本时必须提供 afterMeta")
        after_meta = normalize_after_meta(after_meta_raw, after, warnings) if after_meta_raw else []
        meta = raw.get("meta") or {}
        if not isinstance(meta, dict):
            fail("story.json.meta 必须是对象")
        return main, after, after_meta, meta
    main_path = src / "main.jsonl"
    main = normalize_story(read_jsonl(main_path), "main.jsonl", "", warnings)
    after = {}
    after_dir = src / "after"
    if after_dir.is_dir():
        for path in sorted(after_dir.glob("*.jsonl")):
            key = path.stem
            if not SAFE_KEY.match(key):
                fail("after 文件名只能包含字母、数字、下划线: %s" % path.name)
            after[key] = normalize_story(read_jsonl(path), str(path), "", warnings)
    after_meta = []
    if after:
        meta_path = src / "afterstory.json"
        if not meta_path.is_file():
            fail("存在 after/*.jsonl 时必须提供 afterstory.json")
        after_meta = normalize_after_meta(read_json(meta_path), after, warnings)
    return main, after, after_meta, {}


def load_flowchart(src: Path, warnings: list[str]):
    path = src / "flowchart.json"
    if not path.is_file():
        warn("未找到 flowchart.json，流程图页将为空", warnings)
        return {"routes": [], "nodes": [], "choices": [], "chain": {}, "routeArt": {}}
    return normalize_flowchart(read_json(path), warnings)


def load_gallery(src: Path, warnings: list[str]):
    path = src / "gallery.json"
    if not path.is_file():
        warn("未找到 gallery.json，鉴赏页将为空", warnings)
        return {"cg": [], "bgm": []}
    return normalize_gallery(read_json(path), warnings)


def collect_manifest(main, after, after_meta, flow, gallery):
    backgrounds = set()
    voices = set()
    bgms = set()
    sprites = set()
    covers = set()
    cg_files = set()
    sd_files = set()

    def add_rows(rows):
        for row in rows:
            if row[3]:
                voices.add(row[3])
            if row[4]:
                backgrounds.add(row[4])
            if row[5]:
                bgms.add(row[5])
            character = row[6]
            if character:
                if character.get("sprite"):
                    sprites.add(character["sprite"])
                elif character.get("char"):
                    sprites.add("%s_%s_%s" % (
                        character["char"],
                        character.get("dress") or "default",
                        character.get("face") or "01",
                    ))
            if len(row) > 8 and row[8]:
                cg_files.add(row[8])
            if len(row) > 9 and row[9]:
                sd_files.add(row[9])

    add_rows(main)
    for rows in after.values():
        add_rows(rows)
    for meta in after_meta:
        if meta.get("cover"):
            covers.add(meta["cover"])
    for art in (flow.get("routeArt") or {}).values():
        if art:
            covers.add(art)
    for item in gallery.get("cg") or []:
        if item.get("file"):
            cg_files.add(item["file"])
    return {
        "titleBg": "title_bg",
        "backgrounds": sorted(backgrounds),
        "sprites": sorted(sprites),
        "voices": sorted(voices),
        "bgms": sorted(bgms),
        "covers": sorted(covers),
        "cg": sorted(cg_files),
        "sd": sorted(sd_files),
    }


def js_literal(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def write_js(path: Path, var_name: str, value) -> None:
    content = (
        "/* Generated by tools/build_data.py. Do not edit or commit. */\n"
        "export var %s = %s;\n" % (var_name, js_literal(value))
    )
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(content)


def main() -> int:
    parser = argparse.ArgumentParser(description="生成 GAL 词典笔引擎数据模块")
    parser.add_argument("--src", default="data_src", help="输入目录，默认 data_src")
    parser.add_argument("--out", default="app/data", help="输出目录，默认 app/data")
    parser.add_argument("--check", action="store_true", help="只校验，不写文件")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    src = Path(args.src)
    out = Path(args.out)
    if not src.is_dir():
        print("[x] 输入目录不存在: %s" % src, file=sys.stderr)
        print("    请按 app/data/README.md 准备 data_src/ 后重试。", file=sys.stderr)
        return 2

    warnings: list[str] = []
    try:
        main, after, after_meta, meta = load_story(src, warnings)
        flow = load_flowchart(src, warnings)
        gallery = load_gallery(src, warnings)
    except DataError as exc:
        print("[x] %s" % exc, file=sys.stderr)
        return 2

    story = {
        "main": main,
        "after": after,
        "afterMeta": after_meta,
        "meta": meta,
    }

    if not args.quiet:
        print("[ok] 主剧本: %d 句" % len(main))
        for key in after:
            print("[ok] after %-16s %d 句" % (key, len(after[key])))
        print("[ok] 后日谈卡片: %d 个" % len(after_meta))
        print("[ok] 流程图: %d 条路线 / %d 个节点 / %d 个选择" % (
            len(flow["routes"]), len(flow["nodes"]), len(flow["choices"])))
        print("[ok] 鉴赏清单: %d CG / %d BGM" % (len(gallery["cg"]), len(gallery["bgm"])))
        for message in warnings:
            print("[!] %s" % message)
        if args.check:
            print("[ok] 校验通过（--check 未写文件）")
            return 0
        out.mkdir(parents=True, exist_ok=True)
        write_js(out / "story_data.js", "STORY", story)
        write_js(out / "flowchart_data.js", "FLOWCHART", flow)
        write_js(out / "gallery_data.js", "GALLERY", gallery)
        manifest = collect_manifest(main, after, after_meta, flow, gallery)
        with (out / ".data_manifest.json").open("w", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        print("[ok] 已写入 %s/" % out)
        print("     story_data.js / flowchart_data.js / gallery_data.js / .data_manifest.json")
        print("     这些文件已被 .gitignore 忽略，不要提交。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
