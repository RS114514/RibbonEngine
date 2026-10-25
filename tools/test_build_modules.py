import contextlib
import io
import json
import re
import runpy
import tempfile
import unittest
from pathlib import Path

BUILD_PY = Path(__file__).resolve().parents[1] / "build.py"
STYLE_PAGES = ("title", "game", "gallery", "flowchart", "afterstory")


class BuildModuleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.build = runpy.run_path(str(BUILD_PY))

    def test_registers_generated_data_modules_and_imports(self):
        expected = {
            "story_data": "StoryData.js",
            "flowchart_data": "FlowchartData.js",
            "gallery_data": "GalleryData.js",
        }
        modules = dict(self.build["MODULES"])
        imports = self.build["IMPORT_MAP"]
        for source, output in expected.items():
            relative = f"data/{source}.js"
            with self.subTest(source=source):
                self.assertEqual(modules.get(relative), [output])
                self.assertEqual(imports.get(f"../../{relative}"), f"./{output}")
        self.assertEqual(modules.get("media.js"), ["Media.js"])
        self.assertEqual(imports.get("../../media.js"), "./Media.js")


class CssParsingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ns = runpy.run_path(str(BUILD_PY))

    def parse_css(self, css):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "probe.css"
            path.write_text(css, encoding="utf-8")
            return self.ns["css_to_obj"](str(path))

    def test_comma_separated_selector_applies_to_every_class(self):
        rules = self.parse_css(
            ".fc-node-branch,\n"
            ".fc-node-warp {\n"
            "  background-color: #e8e0ed;\n"
            "  border-color: #9673a4;\n"
            "}\n"
        )
        expected = {"backgroundColor": "#e8e0ed", "borderColor": "#9673a4"}
        self.assertEqual(expected, rules.get("fc-node-branch"))
        self.assertEqual(expected, rules.get("fc-node-warp"))

    def test_compound_selector_keeps_modifier_style_separate_from_base(self):
        rules = self.parse_css(
            ".g-bgm-card-state {\n"
            "  color: #8c6a84;\n"
            "}\n"
            ".g-bgm-card-state.active {\n"
            "  color: #81c784;\n"
            "  font-weight: bold;\n"
            "}\n"
        )
        # 基础类不应被复合规则污染，复合样式落在修饰类上，由 S() 按 class 顺序叠加
        self.assertEqual({"color": "#8c6a84"}, rules.get("g-bgm-card-state"))
        self.assertEqual({"color": "#81c784", "fontWeight": "bold"}, rules.get("active"))

    def test_mixed_selector_group_handles_compound_and_plain(self):
        rules = self.parse_css(
            ".a, .b.active, .c { color: #fff; }\n"
            ".b { color: #000; }\n"
        )
        self.assertEqual({"color": "#fff"}, rules.get("a"))
        self.assertEqual({"color": "#fff"}, rules.get("c"))
        self.assertEqual({"color": "#fff"}, rules.get("active"))
        self.assertEqual({"color": "#000"}, rules.get("b"))

    def test_check_bounds_accepts_limit_and_rejects_oversize(self):
        check_bounds = self.ns["check_bounds"]
        self.assertEqual([], check_bounds("ok", {"height": "220px", "width": "800px"}))
        errors = check_bounds("big", {"height": "221px", "width": "801px"})
        self.assertEqual(
            ["  .big: height 221.0 > 220", "  .big: width 801.0 > 800"], errors
        )

    def test_check_bounds_rejects_position_offset_overflow(self):
        errors = self.ns["check_bounds"](
            "offset", {"height": "220px", "top": "1px", "width": "700px", "left": "101px"}
        )
        self.assertEqual(
            ["  .offset: top+height 221.0 > 220", "  .offset: left+width 801.0 > 800"],
            errors,
        )

    def test_build_styles_writes_styles_and_enforces_bounds(self):
        ns = self.ns
        with tempfile.TemporaryDirectory() as tmp:
            app = Path(tmp) / "app"
            stage = Path(tmp) / "stage"
            stage.mkdir()
            for page in STYLE_PAGES:
                (app / "pages" / page).mkdir(parents=True, exist_ok=True)
            good = ".fc-node-branch,\n.fc-node-warp {\n  color: #fff;\n}\n"
            for page in STYLE_PAGES:
                (app / "pages" / page / f"{page}.css").write_text(good, encoding="utf-8")

            globals_ = ns["build_styles"].__globals__
            old_app_dir = globals_["APP_DIR"]
            globals_["APP_DIR"] = str(app)
            try:
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    ns["build_styles"](str(stage))
                self.assertIn("CSS 校验通过", out.getvalue())
                src = (stage / "Styles.js").read_text(encoding="utf-8")
                match = re.fullmatch(
                    r"// [^\n]+\nvar ST = (.+);\nexport default ST;\n", src, re.S
                )
                self.assertIsNotNone(match)
                styles = json.loads(match.group(1))
                self.assertIn("fc-node-branch", styles)
                self.assertIn("fc-node-warp", styles)

                (stage / "Styles.js").unlink()
                (app / "pages" / "game" / "game.css").write_text(
                    ".huge { height: 300px; width: 900px; }\n", encoding="utf-8"
                )
                out = io.StringIO()
                with contextlib.redirect_stdout(out), self.assertRaises(SystemExit):
                    ns["build_styles"](str(stage))
                self.assertIn(".huge: height 300.0 > 220", out.getvalue())
                self.assertIn(".huge: width 900.0 > 800", out.getvalue())
                self.assertFalse((stage / "Styles.js").exists())
            finally:
                globals_["APP_DIR"] = old_app_dir

    def test_real_css_parses_combo_and_compound_selectors(self):
        ns = self.ns
        with tempfile.TemporaryDirectory() as tmp:
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                ns["build_styles"](tmp)
            src = (Path(tmp) / "Styles.js").read_text(encoding="utf-8")
            styles = json.loads(re.search(r"var ST = (.+?);\nexport default ST;", src, re.S).group(1))
            self.assertGreaterEqual(len(styles), 341)
            self.assertEqual(
                {"backgroundColor": "#e8e0ed", "borderColor": "#9673a4"},
                styles["fc-node-branch"],
            )
            self.assertEqual(styles["fc-node-branch"], styles["fc-node-warp"])
            self.assertEqual(
                {"color": "#81c784", "fontWeight": "bold"}, styles["active"]
            )


if __name__ == "__main__":
    unittest.main()
