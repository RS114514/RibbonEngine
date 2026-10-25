import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD_DATA = ROOT / "tools" / "build_data.py"
IMPORT_ASSETS = ROOT / "tools" / "import_assets.py"
ICON = ROOT / "app" / "app_icon.png"


def run(args, **kwargs):
    return subprocess.run(
        [sys.executable] + [str(arg) for arg in args],
        cwd=ROOT,
        capture_output=True,
        text=True,
        **kwargs
    )


def write_jsonl(path: Path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")


class BuildDataTests(unittest.TestCase):
    def make_source(self, tmp: Path, bad_row=False):
        src = tmp / "data_src"
        rows = [
            [0, "speaker_a", "line one", "voice_0001", "bg_room", "bgm_01",
             {"char": "char_a", "dress": "default", "face": "01"}, "CHAPTER 1-1"],
            [1, "", "line two", None, "bg_room", "bgm_01", None, "CHAPTER 1-1"],
        ]
        if bad_row:
            rows[1][4] = "../../evil"
        write_jsonl(src / "main.jsonl", rows)
        write_jsonl(src / "after" / "heroine_a.jsonl", [
            [0, "speaker_a", "after line", "after_voice", "ema/ema_01.png", "bgm_02", None, "AFTER 1"]
        ])
        (src / "afterstory.json").write_text(json.dumps([
            {
                "key": "heroine_a",
                "name": "Heroine A",
                "chapter": "AFTER 1",
                "title": "After Story A",
                "voice": "after_voice",
                "cover": "ema/ema_01.png"
            }
        ], ensure_ascii=False), encoding="utf-8")
        (src / "flowchart.json").write_text(json.dumps({
            "routes": ["route_a"],
            "nodes": [
                {
                    "id": "node_1",
                    "type": "chapter",
                    "route": "route_a",
                    "chapter": "CHAPTER 1-1",
                    "title": "Node 1",
                    "targetLine": 0,
                    "next": "node_2"
                },
                {
                    "id": "node_2",
                    "type": "section",
                    "route": "route_a",
                    "chapter": "CHAPTER 1-1",
                    "title": "Node 2",
                    "targetLine": 1,
                    "next": None
                }
            ],
            "choices": [],
            "chain": {"node_1": "node_2"},
            "routeArt": {"route_a": "ema/ema_01.png"}
        }, ensure_ascii=False), encoding="utf-8")
        (src / "gallery.json").write_text(json.dumps({
            "cg": [{"id": "cg_1", "code": "CG01", "role": "category", "file": "cg_0001"}],
            "bgm": [{"id": "bgm_1", "code": "BGM01", "file": "bgm_01.opus"}]
        }, ensure_ascii=False), encoding="utf-8")
        return src

    def test_build_data_generates_all_modules_and_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            src = self.make_source(tmp)
            out = tmp / "out"
            result = run([BUILD_DATA, "--src", src, "--out", out])
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            for name in ("story_data.js", "flowchart_data.js", "gallery_data.js"):
                self.assertTrue((out / name).is_file(), name)
                self.assertIn("export var", (out / name).read_text(encoding="utf-8"))
            manifest = json.loads((out / ".data_manifest.json").read_text(encoding="utf-8"))
            self.assertIn("bg_room", manifest["backgrounds"])
            self.assertIn("char_a_default_01", manifest["sprites"])
            self.assertIn("voice_0001", manifest["voices"])
            self.assertIn("bgm_01", manifest["bgms"])
            self.assertIn("ema/ema_01.png", manifest["covers"])
            self.assertIn("cg_0001", manifest["cg"])

    def test_build_data_rejects_path_traversal(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            src = self.make_source(tmp, bad_row=True)
            result = run([BUILD_DATA, "--src", src, "--out", tmp / "out", "--check"])
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("..", result.stderr)

    def test_import_assets_copies_and_checks_refs(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            src = self.make_source(tmp)
            out = tmp / "out"
            self.assertEqual(run([BUILD_DATA, "--src", src, "--out", out]).returncode, 0)

            assets = tmp / "assets"
            for rel in (
                "bg/title_bg.png", "bg/bg_room.png", "fg/char_a_default_01.png",
                "ema/ema_01.png", "cg/cg_0001.png"
            ):
                target = assets / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(ICON.read_bytes())
            (assets / "bgm").mkdir()
            (assets / "bgm" / "bgm_01.opus").write_bytes(b"test")
            (assets / "bgm" / "bgm_02.opus").write_bytes(b"test")
            (assets / "voice").mkdir()
            (assets / "voice" / "voice_0001.ogg").write_bytes(b"test")
            (assets / "voice" / "after_voice.ogg").write_bytes(b"test")

            stage = tmp / "stage"
            result = run([
                IMPORT_ASSETS, "--source", assets, "--stage", stage,
                "--refs", out / ".data_manifest.json", "--hash"
            ])
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertTrue((stage / "bg" / "title_bg.png").is_file())
            self.assertTrue((stage / "bg" / "ema" / "ema_01.png").is_file())
            self.assertTrue((stage / "fg" / "char_a_default_01.png").is_file())
            self.assertTrue((stage / "voice" / "voice_0001.ogg").is_file())


if __name__ == "__main__":
    unittest.main()
