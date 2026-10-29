import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("validate_port", ROOT / "tools" / "validate_port.py")
VALIDATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VALIDATOR)


def write_export(path, name, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("export var %s = %s;\n" % (name, json.dumps(value, ensure_ascii=False)), encoding="utf-8")


class PortValidatorTests(unittest.TestCase):
    def make_fixture(self):
        tmp = tempfile.TemporaryDirectory()
        root = Path(tmp.name)
        data = root / "data"
        assets = root / "assets"
        for kind in ("bg", "fg", "cg", "sd", "bgm", "voice"):
            (assets / kind).mkdir(parents=True, exist_ok=True)
        (assets / "bg" / "title_bg.png").write_bytes(b"png")
        (assets / "bg" / "bg_room.png").write_bytes(b"png")
        (assets / "fg" / "hero_default_01.png").write_bytes(b"png")
        (assets / "cg" / "cg1.png").write_bytes(b"png")
        (assets / "sd" / "sd1.png").write_bytes(b"png")
        (assets / "bgm" / "bgm01.opus").write_bytes(b"opus")
        (assets / "voice" / "v1.ogg").write_bytes(b"ogg")
        story = {
            "main": [[0, "Hero", "Line", "v1", "bg_room", "bgm01",
                      {"char": "hero", "dress": "default", "face": "01"},
                      "chapter　1-1", "cg1", "sd1"]],
            "routes": {},
            "after": {},
            "choices": [],
            "meta": {"gameId": "fixture"},
        }
        flow = {
            "routes": ["main"],
            "nodes": [
                {"id": "n1", "route": "main", "chapter": "1-1", "title": "Start", "targetLine": 0, "next": "n2"},
                {"id": "n2", "route": "main", "chapter": "1-1", "title": "Next", "targetLine": 0},
            ],
            "choices": [],
        }
        gallery = {
            "cgGroups": [{"key": "main", "name": "Main"}],
            "cg": [{"id": "cg1", "group": "main", "file": "cg1"}],
            "sceneGroups": [],
            "scenes": [],
            "standChars": [],
            "bgm": [{"id": "bgm01", "file": "bgm01.opus"}],
        }
        write_export(data / "story_data.js", "STORY", story)
        write_export(data / "flowchart_data.js", "FLOWCHART", flow)
        write_export(data / "gallery_data.js", "GALLERY", gallery)
        return tmp, data, assets

    def validate(self, data, assets, strict=False):
        return VALIDATOR.validate_port(data, assets, strict=strict)

    def test_valid_fixture_passes_with_warning_for_raw_chapter(self):
        tmp, data, assets = self.make_fixture()
        with tmp:
            report = self.validate(data, assets)
            self.assertEqual([], report.errors)
            self.assertTrue(any("chapter" in warning for warning in report.warnings))

    def test_missing_sprite_is_an_error(self):
        tmp, data, assets = self.make_fixture()
        with tmp:
            (assets / "fg" / "hero_default_01.png").unlink()
            report = self.validate(data, assets)
            self.assertTrue(any("fg/hero_default_01" in error for error in report.errors))

    def test_empty_cg_group_and_duplicate_choice_id_are_errors(self):
        tmp, data, assets = self.make_fixture()
        with tmp:
            gallery = json.loads((data / "gallery_data.js").read_text(encoding="utf-8").split(" = ", 1)[1].rstrip(";\n"))
            gallery["cgGroups"].append({"key": "empty", "name": "空分类"})
            write_export(data / "gallery_data.js", "GALLERY", gallery)
            story = json.loads((data / "story_data.js").read_text(encoding="utf-8").split(" = ", 1)[1].rstrip(";\n"))
            choice = {"id": "same", "scenario": "main", "line": 0,
                      "options": [{"index": 1, "text": "A", "targetLine": 0},
                                  {"index": 2, "text": "B", "targetLine": 0}]}
            story["choices"] = [choice, dict(choice)]
            write_export(data / "story_data.js", "STORY", story)
            report = self.validate(data, assets)
            self.assertTrue(any("empty" in error for error in report.errors))
            self.assertTrue(any("choice id 重复" in error for error in report.errors))

    def test_macos_metadata_is_an_error(self):
        tmp, data, assets = self.make_fixture()
        with tmp:
            (assets / "fg" / "._bad.png").write_bytes(b"metadata")
            report = self.validate(data, assets)
            self.assertTrue(any("._*" in error for error in report.errors))

    def test_strict_promotes_raw_chapter_warning(self):
        tmp, data, assets = self.make_fixture()
        with tmp:
            self.assertEqual([], self.validate(data, assets).errors)
            strict = self.validate(data, assets, strict=True)
            self.assertTrue(strict.errors == [] and strict.warnings)
            self.assertNotEqual(0, strict.done())


if __name__ == "__main__":
    unittest.main()
