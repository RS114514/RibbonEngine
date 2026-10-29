import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('miniapp_build', ROOT / 'build.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class StyleCompilerTests(unittest.TestCase):
    def parse(self, text):
        test_dir = ROOT / 'test_results'
        test_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=test_dir) as tmp:
            path = Path(tmp) / 'fixture.css'
            path.write_text(text)
            return build.css_to_obj(path)

    def test_rejects_orphan_declarations(self):
        with self.assertRaises((ValueError, SystemExit)):
            self.parse('.a { width: 10px; } height: 33px; }')

    def test_rejects_unclosed_rule(self):
        with self.assertRaises((ValueError, SystemExit)):
            self.parse('.a { width: 10px;')

    def test_rejects_unsupported_shorthand(self):
        with self.assertRaises((ValueError, SystemExit)):
            self.parse('.a { font: 12px sans-serif; }')

    def test_expands_border_shorthand(self):
        styles = self.parse('.a { border: 1px solid #fff; }')
        self.assertEqual(styles['a']['borderWidth'], '1px')
        self.assertEqual(styles['a']['borderStyle'], 'solid')
        self.assertEqual(styles['a']['borderColor'], '#fff')

    def test_preserves_cascade(self):
        styles = self.parse('.a { width: 10px; height: 20px; } .a { width: 15px; }')
        self.assertEqual(styles['a'], {'width': '15px', 'height': '20px'})

    def test_valid_simple_selectors(self):
        styles = self.parse('.a, .b { display: flex; border-width: 1px; border-style: solid; border-color: #fff; }')
        self.assertEqual(styles['a'], styles['b'])
        self.assertEqual(styles['a']['borderStyle'], 'solid')


if __name__ == '__main__':
    unittest.main()
