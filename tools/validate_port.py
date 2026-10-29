#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""validate_port.py —— 移植数据与素材的发布前对账器。

它检查的不是“数据文件是否存在”，而是“游戏里引用的每个文件、每个行号、
每个选择支是否真的能工作”。AI 移植时最容易出现的空舞台、空白 CG、
错误路线和存档 undefined，都应该在构建前被这个脚本挡住。

用法：
    python3 tools/validate_port.py --data app/data --assets build/device_assets
    python3 tools/validate_port.py --data app/data --assets build/device_assets --strict

无 --assets 时只检查数据结构和跳转；有 --assets 时检查实际文件。
退出码：0 通过（可有 warning），1 有 error。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp")
VOICE_EXTS = (".ogg", ".opus", ".wav")
BGM_EXTS = (".opus", ".ogg", ".mp3", ".wav")
SAFE_PATH = re.compile(r"^[^/\\\x00]+$")


class Report:
    def __init__(self, strict=False):
        self.errors = []
        self.warnings = []
        self.strict = strict
        self.stats = {}

    def error(self, message):
        self.errors.append(message)

    def warn(self, message):
        self.warnings.append(message)

    def done(self):
        print("[validate] %s" % ", ".join("%s=%s" % item for item in sorted(self.stats.items())))
        for message in self.warnings:
            print("[warn] %s" % message)
        for message in self.errors:
            print("[x] %s" % message)
        if self.errors or (self.strict and self.warnings):
            print("[x] 移植校验失败：%d errors, %d warnings" % (len(self.errors), len(self.warnings)))
            return 1
        print("[ok] 移植数据与素材引用对账通过。")
        return 0


def load_export(path: Path, name: str):
    try:
        text = path.read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        raise ValueError("缺少数据文件: %s" % path)
    marker = "export var %s = " % name
    at = text.find(marker)
    if at < 0:
        raise ValueError("%s 缺少 %r" % (path, marker))
    try:
        value, _ = json.JSONDecoder().raw_decode(text[at + len(marker):])
        return value
    except json.JSONDecodeError as exc:
        raise ValueError("%s 的 %s 不是可解析的 JSON: %s" % (path, name, exc))


def safe_relative(value, field, report):
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        report.error("%s 必须是字符串" % field)
        return None
    value = value.strip()
    if "\\" in value or "\x00" in value or value.startswith("/"):
        report.error("%s 路径非法: %r" % (field, value))
        return None
    parts = [part for part in value.split("/") if part]
    if not parts or any(part in (".", "..") for part in parts):
        report.error("%s 路径非法: %r" % (field, value))
        return None
    return value


def find_asset(root: Path | None, kind: str, value, exts, field, report):
    value = safe_relative(value, field, report)
    if root is None or value is None:
        return True
    base = root / kind / value
    if base.suffix.lower() in exts and base.is_file():
        return True
    for ext in exts:
        candidate = base if base.suffix else base.with_suffix(ext)
        if candidate.is_file():
            return True
    report.error("%s 引用缺失: %s/%s{%s}" % (field, kind, value, "|".join(exts)))
    return False


def valid_line(value, length):
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value < length


def normalize_scenarios(story):
    result = {"main": story.get("main") or []}
    for key, rows in (story.get("routes") or {}).items():
        result[key] = rows if isinstance(rows, list) else []
    for key, rows in (story.get("after") or {}).items():
        result["after_" + key] = rows if isinstance(rows, list) else []
    return result


def validate_story(story, assets: Path | None, report: Report):
    if not isinstance(story, dict):
        report.error("STORY 必须是对象")
        return {}
    scenarios = normalize_scenarios(story)
    if not scenarios.get("main"):
        report.error("STORY.main 不能为空")
    total = 0
    for scenario, rows in scenarios.items():
        if not isinstance(rows, list):
            report.error("剧本 %s 不是数组" % scenario)
            continue
        report.stats["rows:" + scenario] = len(rows)
        ids = set()
        for i, row in enumerate(rows):
            total += 1
            if not isinstance(row, (list, tuple)) or not 8 <= len(row) <= 10:
                report.error("%s:%d 台词行应为 8~10 列，实际 %r" % (scenario, i, type(row).__name__))
                continue
            if row[0] is not None:
                if not isinstance(row[0], int) or isinstance(row[0], bool):
                    report.error("%s:%d lineId 必须是整数" % (scenario, i))
                elif row[0] in ids:
                    report.error("%s:%d lineId 重复: %r" % (scenario, i, row[0]))
                else:
                    ids.add(row[0])
            if not isinstance(row[2], str):
                report.error("%s:%d text 必须是字符串" % (scenario, i))
            chapter = row[7]
            if not isinstance(chapter, str) or not chapter.strip():
                report.error("%s:%d chapter 为空；运行时标题栏会显示 --" % (scenario, i))
            elif re.match(r"^chapter[\s\u3000]*", chapter, re.I) or "\u3000" in chapter:
                report.warn("%s:%d chapter 未规范化: %r（建议在转码时去掉前缀和全角空格）" % (scenario, i, chapter))
            find_asset(assets, "bg", row[4], IMAGE_EXTS, "%s:%d bg" % (scenario, i), report)
            find_asset(assets, "bgm", row[5], BGM_EXTS, "%s:%d bgm" % (scenario, i), report)
            find_asset(assets, "voice", row[3], VOICE_EXTS, "%s:%d voice" % (scenario, i), report)
            if len(row) > 8:
                find_asset(assets, "cg", row[8], IMAGE_EXTS, "%s:%d cg" % (scenario, i), report)
            if len(row) > 9:
                find_asset(assets, "sd", row[9], IMAGE_EXTS, "%s:%d sd" % (scenario, i), report)
            char = row[6]
            if isinstance(char, dict):
                if char.get("sprite"):
                    find_asset(assets, "fg", char["sprite"], IMAGE_EXTS, "%s:%d sprite" % (scenario, i), report)
                elif char.get("char"):
                    dress = char.get("dress") or "default"
                    face = char.get("face") or "01"
                    if isinstance(face, int):
                        face = "%02d" % face
                    name = "%s_%s_%s" % (char["char"], dress, face)
                    find_asset(assets, "fg", name, IMAGE_EXTS, "%s:%d character" % (scenario, i), report)
                else:
                    report.error("%s:%d character 既没有 sprite 也没有 char" % (scenario, i))
            elif char is not None:
                report.error("%s:%d character 必须是对象或 null" % (scenario, i))

    choices = story.get("choices") or []
    if not isinstance(choices, list):
        report.error("STORY.choices 必须是数组")
        choices = []
    report.stats["choices"] = len(choices)
    choice_ids = set()
    for ci, choice in enumerate(choices):
        if not isinstance(choice, dict):
            report.error("choice[%d] 必须是对象" % ci)
            continue
        cid = choice.get("id")
        if not isinstance(cid, str) or not cid:
            report.error("choice[%d] 缺少唯一 id；引擎按 id 记录已选状态" % ci)
        elif cid in choice_ids:
            report.error("choice id 重复: %s；请使用 route:line 或唯一前缀" % cid)
        else:
            choice_ids.add(cid)
        scenario = choice.get("scenario") or "main"
        rows = scenarios.get(scenario)
        line = choice.get("line", choice.get("targetLine"))
        if rows is None:
            report.error("choice %s 指向未知 scenario: %s" % (cid, scenario))
        elif not valid_line(line, len(rows)):
            report.error("choice %s 行号越界: %r (0..%d)" % (cid, line, len(rows) - 1))
        options = choice.get("options")
        if not isinstance(options, list) or len(options) < 2:
            report.error("choice %s 至少需要两个 option" % cid)
            continue
        seen_index = set()
        for oi, option in enumerate(options):
            if not isinstance(option, dict):
                report.error("choice %s option[%d] 必须是对象" % (cid, oi))
                continue
            if option.get("index") in seen_index:
                report.error("choice %s option index 重复: %r" % (cid, option.get("index")))
            seen_index.add(option.get("index"))
            if not isinstance(option.get("text"), str) or not option["text"].strip():
                report.error("choice %s option[%d] text 为空" % (cid, oi))
            target_line = option.get("targetLine")
            if target_line is not None and not valid_line(target_line, len(rows or [])):
                report.error("choice %s option[%d] targetLine 越界: %r" % (cid, oi, target_line))
            if target_line is None and not option.get("targetNode"):
                report.error("choice %s option[%d] 没有 targetLine 或 targetNode" % (cid, oi))
    for rule in story.get("branchRules") or []:
        scenario = rule.get("targetScenario")
        if scenario and scenario not in scenarios:
            report.error("branchRules 指向未知 scenario: %s" % scenario)
    return {"scenarios": scenarios, "choices": choices}


def validate_flowchart(flow, story_info, report: Report):
    if not isinstance(flow, dict):
        report.error("FLOWCHART 必须是对象")
        return
    routes = flow.get("routes") or []
    if not isinstance(routes, list) or not routes:
        report.error("FLOWCHART.routes 必须是非空数组")
        routes = []
    route_set = set(routes)
    nodes = flow.get("nodes") or []
    if not isinstance(nodes, list) or not nodes:
        report.error("FLOWCHART.nodes 必须是非空数组")
        nodes = []
    node_map = {}
    for i, node in enumerate(nodes):
        if not isinstance(node, dict) or not isinstance(node.get("id"), str):
            report.error("flowchart.nodes[%d] 缺少 id" % i)
            continue
        if node["id"] in node_map:
            report.error("flowchart node id 重复: %s" % node["id"])
        node_map[node["id"]] = node
        if route_set and node.get("route") not in route_set:
            report.error("node %s 的 route=%r 不在 routes 中" % (node["id"], node.get("route")))
        scenario = node.get("scenario") or flow.get("routeScenario", {}).get(node.get("route"), node.get("route"))
        rows = story_info["scenarios"].get(scenario)
        line = node.get("targetLine")
        if line is not None and rows is not None and not valid_line(line, len(rows)):
            report.error("node %s targetLine 越界: %r" % (node["id"], line))
    for i, node in enumerate(nodes):
        if not isinstance(node, dict) or node.get("id") not in node_map:
            continue
        nexts = flow.get("chain", {}).get(node["id"], node.get("next"))
        if nexts is None:
            continue
        if not isinstance(nexts, list):
            nexts = [nexts]
        for target in nexts:
            if target not in node_map:
                report.error("node %s 的 next/chain 指向不存在的节点: %s" % (node["id"], target))
    for route in routes:
        count = sum(1 for node in nodes if isinstance(node, dict) and node.get("route") == route)
        report.stats["flow:" + route] = count
        if count == 0:
            report.error("流程图路线 %s 没有任何节点" % route)
        elif count == 1:
            report.warn("流程图路线 %s 只有 1 个节点，无法形成可读 DAG" % route)
    return node_map


def validate_gallery(gallery, assets, report):
    if not isinstance(gallery, dict):
        report.error("GALLERY 必须是对象")
        return
    groups = gallery.get("cgGroups") or []
    cgs = gallery.get("cg") or []
    group_keys = {g.get("key") for g in groups if isinstance(g, dict)}
    counts = {key: 0 for key in group_keys}
    for i, cg in enumerate(cgs):
        if not isinstance(cg, dict):
            report.error("GALLERY.cg[%d] 必须是对象" % i)
            continue
        group = cg.get("group") or cg.get("role")
        if group not in group_keys:
            report.error("CG %s 的分组 %r 不在 cgGroups 中" % (cg.get("id", i), group))
        else:
            counts[group] += 1
        find_asset(assets, "cg", cg.get("file") or cg.get("id"), IMAGE_EXTS, "cg[%d] file" % i, report)
    for group, count in counts.items():
        if count == 0:
            report.error("CG 分组 %s 没有任何条目；界面会出现 0 张 CG" % group)
    report.stats["cg"] = len(cgs)
    scenes = gallery.get("scenes") or []
    for i, scene in enumerate(scenes):
        if not isinstance(scene, dict):
            report.error("GALLERY.scenes[%d] 必须是对象" % i)
            continue
        for j, variant in enumerate(scene.get("variants") or []):
            find_asset(assets, "cg", variant, IMAGE_EXTS, "scene[%d].variant[%d]" % (i, j), report)
        if not scene.get("variants") and scene.get("cover"):
            find_asset(assets, "cg", scene["cover"], IMAGE_EXTS, "scene[%d].cover" % i, report)
    stand_chars = gallery.get("standChars") or []
    for i, hero in enumerate(stand_chars):
        if not isinstance(hero, dict):
            report.error("GALLERY.standChars[%d] 必须是对象" % i)
            continue
        char = hero.get("char") or hero.get("key")
        dresses = hero.get("dresses") or []
        if not char or not dresses:
            report.error("standChars[%d] 缺 char 或 dresses" % i)
            continue
        face = 1
        expected = "%s_%s_%02d" % (char, dresses[0], face)
        fg_ok = find_asset(assets, "fg", expected, IMAGE_EXTS, "standChars[%d] fg" % i, report)
        stand_ok = find_asset(assets, "stand", expected, IMAGE_EXTS, "standChars[%d] stand" % i, report)
        if fg_ok and not stand_ok:
            report.warn("standChars[%d] 有 fg 但缺 stand/%s；全身鉴赏会退回空图" % (i, expected))
    report.stats["standChars"] = len(stand_chars)
    for i, track in enumerate(gallery.get("bgm") or []):
        if isinstance(track, dict):
            find_asset(assets, "bgm", track.get("file") or track.get("id"), BGM_EXTS, "bgm[%d]" % i, report)


def validate_assets(root: Path | None, report: Report):
    if root is None:
        return
    if not root.is_dir():
        report.error("资源目录不存在: %s" % root)
        return
    bad = [p for p in root.rglob("._*") if p.is_file()]
    if bad:
        report.error("资源目录包含 macOS 元数据文件 ._*（会导致设备白屏/崩溃），例如 %s" % bad[0])
    for kind in ("bg", "fg", "cg", "sd", "bgm", "voice", "stand"):
        directory = root / kind
        if not directory.is_dir():
            report.warn("资源目录缺少 %s/（对应功能可能为空）" % kind)
    title = root / "bg" / "title_bg.png"
    if not title.is_file():
        report.error("缺少 bg/title_bg.png（标题页必需）")


def validate_port(data_dir: Path, assets_dir: Path | None, strict=False):
    report = Report(strict=strict)
    try:
        story = load_export(data_dir / "story_data.js", "STORY")
        flow = load_export(data_dir / "flowchart_data.js", "FLOWCHART")
        gallery = load_export(data_dir / "gallery_data.js", "GALLERY")
    except ValueError as exc:
        report.error(str(exc))
        return report
    story_info = validate_story(story, assets_dir, report)
    validate_flowchart(flow, story_info, report)
    validate_gallery(gallery, assets_dir, report)
    validate_assets(assets_dir, report)
    return report


def main():
    parser = argparse.ArgumentParser(description="RibbonEngine 移植数据/素材发布前对账")
    parser.add_argument("--data", default="app/data", help="生成后的 app/data 目录")
    parser.add_argument("--assets", default=None, help="build/device_assets 等资源根目录")
    parser.add_argument("--strict", action="store_true", help="把 warning 也当作失败")
    args = parser.parse_args()
    report = validate_port(Path(args.data), Path(args.assets) if args.assets else None, args.strict)
    sys.exit(report.done())


if __name__ == "__main__":
    main()
