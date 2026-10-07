"""Run with uv run --with json5 --with jsonschema python tests/opencode_migration.py.

Set OPENCODE_TEST_SCHEMA and OPENCODE_TEST_KEYBINDS to downloaded upstream files.
"""

import importlib.util
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location(
    "migration", ROOT / "install/opencode-migrate.py"
)
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)
credential_spec = importlib.util.spec_from_file_location(
    "credentials", ROOT / "install/opencode-credentials.py"
)
credentials = importlib.util.module_from_spec(credential_spec)
credential_spec.loader.exec_module(credentials)


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.config = self.root / "config"
        self.state = self.root / "state"
        self.config.mkdir()
        self.state.mkdir()
        self.schema = Path(os.environ["OPENCODE_TEST_SCHEMA"])
        self.keys = Path(os.environ["OPENCODE_TEST_KEYBINDS"])
        self.output = self.root / "cli.json"

    def prepare(self):
        migration.prepare(self.config, self.state, self.schema, self.keys, self.output)

    def test_v1_settings_and_preferences_migrate_without_changing_sources(self):
        legacy = self.root / "repo-tui.json"
        legacy.write_text(
            json.dumps(
                {
                    "theme": "opencode",
                    "leader_timeout": 2000,
                    "keybinds": {"leader": "ctrl+x", "command_list": "ctrl+p"},
                    "attention": {"enabled": False, "volume": 0.4},
                    "plugin": ["./tui-plugins/btw.tsx", "old-plugin"],
                }
            )
        )
        (self.config / "tui.json").symlink_to(legacy)
        before = legacy.read_bytes()
        (self.state / "kv.json").write_text(
            '{"theme_mode_lock":"dark","sidebar":"hide","paste_summary_enabled":false}'
        )
        self.prepare()
        result = json.loads(self.output.read_text())
        self.assertEqual(result["theme"], {"name": "opencode", "mode": "dark"})
        self.assertEqual(result["keybinds"]["command.palette.show"], "ctrl+p")
        self.assertFalse(result["attention"]["notifications"])
        self.assertFalse(result["attention"]["sound"])
        self.assertEqual(result["session"]["sidebar"], "hide")
        self.assertEqual(result["prompt"]["paste"], "full")
        self.assertEqual(
            result["plugins"], ["-opencode.btw", "./tui-plugins/btw-v2.tsx"]
        )
        self.assertEqual(legacy.read_bytes(), before)
        self.assertTrue((self.config / "tui.json").is_symlink())

    def test_existing_v2_settings_are_preserved_on_rerun(self):
        cli = self.config / "cli.json"
        cli.write_text('{"theme":{"name":"custom"},"tabs":{"mode":"off"}}\n')
        before = cli.read_bytes()
        self.prepare()
        self.assertEqual(cli.read_bytes(), before)
        self.assertFalse(self.output.exists())

    def test_auto_migrated_btw_reference_is_ported_without_losing_v2_preferences(self):
        cli = self.config / "cli.json"
        cli.write_text(
            '{"theme":{"name":"custom"},"plugins":["./tui-plugins/btw.tsx","v2-plugin"]}'
        )
        before = cli.read_bytes()
        self.prepare()
        result = json.loads(self.output.read_text())
        self.assertEqual(result["theme"], {"name": "custom"})
        self.assertEqual(
            result["plugins"],
            ["v2-plugin", "-opencode.btw", "./tui-plugins/btw-v2.tsx"],
        )
        self.assertEqual(cli.read_bytes(), before)

    def test_malformed_legacy_settings_fail_before_producing_configuration(self):
        (self.config / "tui.json").write_text('{"keybinds":')
        with self.assertRaises(ValueError):
            self.prepare()
        self.assertFalse(self.output.exists())

    def test_fresh_install_gets_v2_defaults_without_v1_plugin(self):
        self.prepare()
        result = json.loads(self.output.read_text())
        self.assertEqual(result["keybinds"]["command.palette.show"], "ctrl+p")
        self.assertIn("./tui-plugins/btw-v2.tsx", result["plugins"])
        self.assertNotIn("./tui-plugins/btw.tsx", result["plugins"])

    def test_backup_captures_wal_and_symlink_content_for_rollback(self):
        data = self.root / "data"
        data.mkdir()
        original = self.root / "repo-tui.json"
        original.write_text('{"theme":"original"}')
        (self.config / "tui.json").symlink_to(original)
        binary = self.root / "opencode"
        binary.write_bytes(b"old executable")
        db = sqlite3.connect(data / "opencode.db")
        self.addCleanup(db.close)
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("CREATE TABLE sessions (title TEXT)")
        db.execute("INSERT INTO sessions VALUES ('keep me')")
        db.commit()
        migration.backup(self.config, self.state, data, binary)
        destination = next((self.state / "dotfiles-backups").iterdir())
        original.write_text('{"theme":"changed"}')
        self.assertEqual(
            (destination / "config/tui.json").read_text(), '{"theme":"original"}'
        )
        self.assertFalse((destination / "config/tui.json").is_symlink())
        self.assertEqual((destination / "opencode").read_bytes(), b"old executable")
        self.assertEqual(destination.stat().st_mode & 0o777, 0o700)
        with sqlite3.connect(destination / "opencode.db") as restored:
            self.assertEqual(
                restored.execute("SELECT title FROM sessions").fetchall(),
                [("keep me",)],
            )

    def test_azure_form_metadata_is_removed_from_request_and_preserves_explicit_resource(
        self,
    ):
        # Regression: upstream #53443 makes every migrated Azure request fail.
        value = {
            "type": "key",
            "key": "test-key",
            "metadata": {"resourceName": "old"},
            "configuration": {"resourceName": "explicit"},
        }
        corrected = credentials.corrected_azure_value(value)
        self.assertEqual(corrected["key"], "test-key")
        self.assertNotIn("metadata", corrected)
        self.assertEqual(corrected["configuration"], {"resourceName": "explicit"})
        self.assertIsNone(credentials.corrected_azure_value(corrected))
        self.assertEqual(value["metadata"], {"resourceName": "old"})

    def test_unrelated_credential_metadata_is_not_rewritten(self):
        for value in (
            {"type": "oauth", "metadata": {"resourceName": "test"}},
            {
                "type": "key",
                "key": "test",
                "metadata": {"resourceName": "test", "plugin": "state"},
            },
        ):
            with self.subTest(value=value):
                self.assertIsNone(credentials.corrected_azure_value(value))


if __name__ == "__main__":
    unittest.main()
