"""Prepare V2 client settings and recoverable backups without starting OpenCode."""

import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

import json5
import jsonschema


def read(path):
    return json5.loads(path.read_text()) if path.is_file() else {}


def prepare(config, state, schema_path, keybind_path, output):
    schema = json.loads(schema_path.read_text())
    cli = config / "cli.json"
    if cli.exists() or cli.is_symlink():
        existing = read(cli)
        jsonschema.validate(existing, schema)
        if "./tui-plugins/btw.tsx" in existing.get("plugins", []):
            existing["plugins"] = [
                item for item in existing["plugins"] if item != "./tui-plugins/btw.tsx"
            ]
            existing["plugins"].extend(["-opencode.btw", "./tui-plugins/btw-v2.tsx"])
            jsonschema.validate(existing, schema)
            output.write_text(json.dumps(existing, indent=2) + "\n")
            print("Replacing the bundled V1 BTW plugin reference in existing cli.json")
            return
        print(f"Preserving existing {cli}")
        return

    legacy_path = config / "tui.json"
    if not legacy_path.exists():
        legacy_path = config / "tui.jsonc"
    legacy = read(legacy_path)
    kv = read(state / "kv.json")
    if not legacy and not kv:
        example = (
            Path(__file__).resolve().parent.parent
            / "config/.config/opencode/cli.json.example"
        )
        result = read(example)
        jsonschema.validate(result, schema)
        output.write_text(json.dumps(result, indent=2) + "\n")
        return
    # Use upstream's command map, filtered against the published V2 schema.
    source = (
        keybind_path.read_text()
        .split("export const CommandMap = {", 1)[1]
        .split("} satisfies", 1)[0]
    )
    mapping = dict(re.findall(r'(\w+):\s*"([^"]+)"', source))
    valid_keys = schema["properties"]["keybinds"]["anyOf"][0]["properties"]
    result = {"$schema": "https://opencode.ai/v2/cli.json"}
    theme = legacy.get("theme", kv.get("theme"))
    if theme is not None:
        result["theme"] = {"name": theme}
    if "theme_mode_lock" in kv:
        result.setdefault("theme", {})["mode"] = kv["theme_mode_lock"]
    if "leader_timeout" in legacy:
        result["leader"] = {"timeout": legacy["leader_timeout"]}
    keys = {}
    for key, value in legacy.get("keybinds", {}).items():
        target = mapping.get(key, key)
        if target in valid_keys:
            keys[target] = value
        else:
            print(f"V1 keybind {key!r} has no V2 equivalent; retained in {legacy_path}")
    if keys:
        result["keybinds"] = keys
    scroll = {}
    if "scroll_speed" in legacy:
        scroll["speed"] = legacy["scroll_speed"]
    if "enabled" in legacy.get("scroll_acceleration", {}):
        scroll["acceleration"] = legacy["scroll_acceleration"]["enabled"]
    if scroll:
        result["scroll"] = scroll
    for key in ("mouse", "cursor"):
        if key in legacy:
            result[key] = legacy[key]
    attention = {
        key: value
        for key, value in legacy.get("attention", {}).items()
        if key != "enabled"
    }
    if legacy.get("attention", {}).get("enabled") is False:
        attention.update(notifications=False, sound=False)
    if "attention_sound_pack" in kv:
        attention["sound_pack"] = kv["attention_sound_pack"]
    if attention:
        result["attention"] = attention
    groups = {
        "diffs": {
            "diff_wrap_mode": "wrap",
            "diff_viewer_show_file_tree": "tree",
            "diff_viewer_single_patch": "single",
            "diff_viewer_view": "view",
        },
        "terminal": {"terminal_title_enabled": "title"},
        "prompt": {"file_context_enabled": "editor"},
        "session": {
            "sidebar": "sidebar",
            "scrollbar_visible": "scrollbar",
            "thinking_mode": "thinking",
        },
    }
    for group, fields in groups.items():
        values = {target: kv[key] for key, target in fields.items() if key in kv}
        if values:
            result[group] = values
    if "view" not in result.get("diffs", {}) and "diff_style" in legacy:
        result.setdefault("diffs", {})["view"] = (
            "unified" if legacy["diff_style"] == "stacked" else legacy["diff_style"]
        )
    if "thinking_mode" not in kv and "thinking_visibility" in kv:
        result.setdefault("session", {})["thinking"] = (
            "show" if kv["thinking_visibility"] else "hide"
        )
    if "exploration_grouping" in kv:
        result.setdefault("session", {})["grouping"] = (
            "auto" if kv["exploration_grouping"] else "none"
        )
    if "paste_summary_enabled" in kv:
        result.setdefault("prompt", {})["paste"] = (
            "compact" if kv["paste_summary_enabled"] else "full"
        )
    if "animations_enabled" in kv:
        result["animations"] = kv["animations_enabled"]
    plugins = []
    for entry in legacy.get("plugin", []):
        package = entry if isinstance(entry, str) else entry[0]
        if package == "./tui-plugins/btw.tsx":
            plugins.extend(["-opencode.btw", "./tui-plugins/btw-v2.tsx"])
        else:
            print(
                f"V1 plugin {package!r} needs a V2 implementation; retained in {legacy_path}"
            )
    if plugins:
        result["plugins"] = plugins
    jsonschema.validate(result, schema)
    output.write_text(json.dumps(result, indent=2) + "\n")
    print(f"Prepared V2 client settings from {legacy_path} and persisted preferences")


def backup(config, state, data, binary):
    parent = state / "dotfiles-backups"
    parent.mkdir(parents=True, exist_ok=True)
    destination = Path(tempfile.mkdtemp(prefix="opencode-", dir=parent))
    os.chmod(destination, 0o700)
    if config.exists():
        shutil.copytree(
            config,
            destination / "config",
            symlinks=True,
            ignore=shutil.ignore_patterns("node_modules", ".git"),
        )
        # Stow-managed files must be snapshots, not links to mutable repo files.
        for path in (destination / "config").rglob("*"):
            if path.is_symlink():
                original = config / path.relative_to(destination / "config")
                if original.is_file():
                    path.unlink()
                    shutil.copy2(original, path)
    if binary.is_file():
        shutil.copy2(binary, destination / "opencode")
    for source, name in (
        (data / "auth.json", "auth.json"),
        (state / "kv.json", "kv.json"),
        (Path.home() / ".zshrc", "zshrc"),
    ):
        if source.is_file():
            shutil.copy2(source, destination / name)
    database = Path(os.environ.get("OPENCODE_DB", data / "opencode.db"))
    if not database.is_absolute():
        database = data / database
    if database.is_file():
        with (
            sqlite3.connect(
                database.resolve().as_uri() + "?mode=ro", uri=True
            ) as source,
            sqlite3.connect(destination / "opencode.db") as target,
        ):
            source.backup(target)
    print(f"OpenCode pre-migration backup: {destination}")


if __name__ == "__main__":
    try:
        action, *arguments = sys.argv[1:]
        {"prepare": prepare, "backup": backup}[action](
            *(Path(arg) for arg in arguments)
        )
    except (
        OSError,
        ValueError,
        KeyError,
        IndexError,
        TypeError,
        sqlite3.Error,
        jsonschema.ValidationError,
    ) as error:
        print(f"OpenCode migration failed: {error}", file=sys.stderr)
        sys.exit(1)
