"""Run with python3 tests/zellij_sync_bars.py.

zellij-sync-bars gives saved Zellij sessions the top bar from dev.kdl. The
command runs against a fake cache with a stand-in zellij that reports which
sessions are running.
"""

import importlib.machinery
import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parent.parent
COMMAND = ROOT / "config/.local/bin/zellij-sync-bars"
loader = importlib.machinery.SourceFileLoader("sync_bars", str(COMMAND))
spec = importlib.util.spec_from_loader("sync_bars", loader)
bars = importlib.util.module_from_spec(spec)
loader.exec_module(bars)

OLD = "https://example.com/v1/zjstatus.wasm"
# A session name no real session has: tests that act "inside" a session use it.
TEST_SESSION = f"zellij-sync-bars-test-{os.getpid()}"
DEV = bars.dev_bar((ROOT / "config/.config/zellij/layouts/dev.kdl").read_text("utf-8"))
SAVED = f"""layout {{
    tab name="\U000f051f dotfiles" focus=true {{
        pane size=1 borderless=true {{
            plugin location="{OLD}" {{
                format_left "old"
                tab_normal "{{name}}"
            }}
        }}
        pane command="hx"
        pane size=1 borderless=true {{
            plugin location="zellij:status-bar"
        }}
    }}
    new_tab_template {{
        pane size=1 borderless=true {{
            plugin location="{OLD}" {{
            }}
        }}
    }}
}}
"""


class RewriteTests(unittest.TestCase):
    def test_bars_take_dev_kdl_url_and_options(self):
        url, options = DEV
        after = bars.with_bar(SAVED, url, options)
        self.assertNotIn(OLD, after)
        self.assertEqual(after.count(f'plugin location="{url}"'), 2)
        self.assertNotIn('format_left "old"', after)
        self.assertIn("                " + options[0], after)
        self.assertRegex(after, r'tab_groups\s+"true"')
        self.assertIn('plugin location="zellij:status-bar"', after)

    def test_template_bar_without_options_keeps_none(self):
        after = bars.with_bar(SAVED, *DEV)
        template = after[after.index("new_tab_template") :]
        self.assertIn(f'plugin location="{DEV[0]}" {{\n            }}', template)

    def test_old_status_icons_leave_tab_names(self):
        self.assertIn('tab name="dotfiles"', bars.with_bar(SAVED, *DEV))

    def test_a_second_run_changes_nothing(self):
        once = bars.with_bar(SAVED, *DEV)
        self.assertEqual(bars.with_bar(once, *DEV), once)

    def test_dev_kdl_bar_has_no_comments(self):
        url, options = DEV
        self.assertTrue(url.endswith("/zjstatus.wasm"))
        self.assertFalse(any(line.startswith("//") for line in options))


class CommandTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.home = Path(temp.name)
        self.cache = (
            self.home
            / "Library/Caches/org.Zellij-Contributors.Zellij/contract_version_1/session_info"
        )
        self.bin = self.home / "bin"
        self.bin.mkdir()
        self.running = self.home / "running"
        self.running.write_text("")
        # Like Zellij, it calls the session named by ZELLIJ_SESSION_NAME
        # "(current)", even when it has quit.
        zellij = self.bin / "zellij"
        zellij.write_text(
            "#!/bin/sh\n"
            '[ "$1" = list-sessions ] || exit 0\n'
            'if [ -n "$ZELLIJ_SESSION_NAME" ]; then\n'
            '  echo "$ZELLIJ_SESSION_NAME [Created 1m ago] (current)"\n'
            f'else cat "{self.running}"; fi\n'
        )
        zellij.chmod(0o755)

    def save(self, name, layout=SAVED):
        folder = self.cache / name
        folder.mkdir(parents=True)
        (folder / "session-layout.kdl").write_text(layout, "utf-8")
        (folder / "session-metadata.kdl").write_text(f'name "{name}"\n', "utf-8")
        return folder / "session-layout.kdl"

    def run_command(self, *args, inside=None):
        # Never the Zellij session this test runs in: --restart would quit it.
        env = {k: v for k, v in os.environ.items() if not k.startswith("ZELLIJ")}
        env.update(HOME=str(self.home), PATH=f"{self.bin}:{os.environ['PATH']}")
        if inside:
            env.update(ZELLIJ="0", ZELLIJ_SESSION_NAME=inside)
        env.pop("XDG_CACHE_HOME", None)
        return subprocess.run(
            [sys.executable, str(COMMAND), *args],
            env=env,
            capture_output=True,
            text=True,
        )

    def test_check_then_sync_then_check(self):
        layout = self.save("main")
        first = self.run_command("--check")
        self.assertEqual(first.returncode, 1)
        self.assertIn("main: its saved tabs have an older bar", first.stdout)
        synced = self.run_command()
        self.assertEqual(synced.returncode, 0, synced.stderr)
        self.assertIn(f'plugin location="{DEV[0]}"', layout.read_text("utf-8"))
        self.assertEqual(
            layout.with_name("session-layout.kdl.before-bar").read_text("utf-8"), SAVED
        )
        self.assertEqual(self.run_command("--check").returncode, 0)
        self.assertIn("already has the bar", self.run_command().stdout)

    def test_a_running_session_is_left_alone(self):
        layout = self.save("main")
        self.running.write_text("main [Created 1m ago] (current)\n")
        named = self.run_command("main")
        self.assertEqual(named.returncode, 1)
        self.assertIn("running, so left alone", named.stdout)
        self.assertEqual(layout.read_text("utf-8"), SAVED)

    def test_an_ended_session_is_updated(self):
        layout = self.save("main")
        self.running.write_text(
            "main [Created 1m ago] (EXITED - attach to resurrect)\n"
        )
        self.assertEqual(self.run_command("main").returncode, 0)
        self.assertNotIn(OLD, layout.read_text("utf-8"))

    def test_an_unknown_session_is_an_error(self):
        result = self.run_command("nope")
        self.assertEqual(result.returncode, 1)
        self.assertIn("No saved Zellij session named nope", result.stderr)

    def test_running_is_judged_from_outside_the_session(self):
        layout = self.save(TEST_SESSION)
        self.running.write_text(
            f"{TEST_SESSION} [Created 1m ago] (EXITED - attach to resurrect)\n"
        )
        result = self.run_command(TEST_SESSION, inside=TEST_SESSION)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertNotIn(OLD, layout.read_text("utf-8"))

    def test_restart_refuses_without_a_terminal(self):
        # Inside a session but not from a terminal (a script, a test, an
        # agent): it must refuse before quitting anything. The stand-in
        # zellij records any call other than list-sessions.
        calls = self.home / "calls"
        zellij = self.bin / "zellij"
        zellij.write_text(
            f'#!/bin/sh\n[ "$1" = list-sessions ] || echo "$@" >> "{calls}"\n'
        )
        result = self.run_command("--restart", inside=TEST_SESSION)
        self.assertEqual(result.returncode, 1)
        self.assertIn("runs only from a terminal", result.stderr)
        self.assertFalse(calls.exists())

    def test_restart_needs_zellij(self):
        env_less = self.run_command("--restart")
        self.assertEqual(env_less.returncode, 1)
        self.assertIn("runs inside the Zellij session", env_less.stderr)


if __name__ == "__main__":
    unittest.main()
