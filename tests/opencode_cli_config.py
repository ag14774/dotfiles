"""Run with uv run --with json5 --with jsonschema python tests/opencode_cli_config.py.

Set OPENCODE_TEST_SCHEMA to a downloaded https://opencode.ai/v2/cli.json to
validate against OpenCode's schema; without it, a stand-in schema is used.
"""

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location(
    "cli_config", ROOT / "install/opencode-cli-config.py"
)
cli_config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli_config)

STAND_IN_SCHEMA = {
    "type": "object",
    "properties": {"plugins": {"type": "array"}, "theme": {"type": "object"}},
}


class CliConfigTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.config = self.root / "config"
        self.config.mkdir()
        self.cli = self.config / "cli.json"
        self.output = self.root / "cli.json"
        if os.environ.get("OPENCODE_TEST_SCHEMA"):
            self.schema = Path(os.environ["OPENCODE_TEST_SCHEMA"])
        else:
            self.schema = self.root / "schema.json"
            self.schema.write_text(json.dumps(STAND_IN_SCHEMA))

    def prepare(self):
        cli_config.prepare(self.config, self.schema, self.output)

    def test_a_missing_cli_json_gets_the_example(self):
        self.prepare()
        result = json.loads(self.output.read_text())
        example = json.loads(
            (ROOT / "config/.config/opencode/cli.json.example").read_text()
        )
        self.assertEqual(result, example)
        self.assertIn("-opencode.notifications", result["plugins"])

    def test_existing_settings_are_preserved_on_rerun(self):
        self.cli.write_text(
            '{"theme":{"name":"custom"},"plugins":["-opencode.btw","./tui-plugins/btw-v2","-opencode.notifications"]}\n'
        )
        before = self.cli.read_bytes()
        self.prepare()
        self.assertEqual(self.cli.read_bytes(), before)
        self.assertFalse(self.output.exists())

    def test_existing_settings_get_the_status_plugin_sounds_once(self):
        self.cli.write_text(
            '// comments are allowed\n{"theme":{"name":"custom"},"plugins":["-opencode.btw","./tui-plugins/btw-v2",],}\n'
        )
        before = self.cli.read_bytes()
        self.prepare()
        result = json.loads(self.output.read_text())
        self.assertEqual(result["theme"], {"name": "custom"})
        self.assertEqual(
            result["plugins"],
            ["-opencode.btw", "./tui-plugins/btw-v2", "-opencode.notifications"],
        )
        self.assertEqual(self.cli.read_bytes(), before)
        self.cli.write_text(self.output.read_text())
        self.output.unlink()
        self.prepare()
        self.assertFalse(self.output.exists())

    def test_settings_that_bring_the_built_in_sounds_back_are_kept(self):
        for entry in (
            "opencode.notifications",
            "opencode.notifications@2.2.5",
            {"package": "opencode.notifications"},
        ):
            with self.subTest(entry=entry):
                self.cli.write_text(json.dumps({"plugins": ["-opencode.btw", entry]}))
                self.prepare()
                self.assertFalse(self.output.exists())

    def test_malformed_settings_fail_without_writing(self):
        self.cli.write_text('{"plugins":')
        with self.assertRaises(ValueError):
            self.prepare()
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
