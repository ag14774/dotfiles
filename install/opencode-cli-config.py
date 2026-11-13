"""Set up the OpenCode app's settings (cli.json) without starting OpenCode.

    opencode-cli-config.py CONFIG_DIR SCHEMA OUTPUT

A missing cli.json gets cli.json.example. An existing one is kept; only
"-opencode.notifications" is added to its plugins when no entry names that
plugin. Whatever needs writing goes to OUTPUT (nothing is written otherwise),
validated against OpenCode's published SCHEMA.
"""

import json
import re
import sys
from pathlib import Path

import json5
import jsonschema

EXAMPLE = (
    Path(__file__).resolve().parent.parent / "config/.config/opencode/cli.json.example"
)

# OpenCode's built-in attention plugin plays every conversation's sounds in
# every OpenCode app on the service (one per tab); with it off, the status
# plugin (plugins/ade-status) plays them only in the app showing the
# conversation. Added once: an entry naming the plugin, with or without "-"
# (`"opencode.notifications"` brings the built-in back), is left as it is.
NOTIFICATIONS_OFF = "-opencode.notifications"


def names_notifications(entry):
    spec = entry.get("package") if isinstance(entry, dict) else entry
    return (
        isinstance(spec, str)
        and re.fullmatch(r"-?opencode\.notifications(@.*)?", spec) is not None
    )


def prepare(config, schema_path, output):
    schema = json.loads(schema_path.read_text())
    cli = config / "cli.json"
    if not (cli.exists() or cli.is_symlink()):
        result = json5.loads(EXAMPLE.read_text())
        jsonschema.validate(result, schema)
        output.write_text(json.dumps(result, indent=2) + "\n")
        print(f"Created {cli} from cli.json.example")
        return
    existing = json5.loads(cli.read_text())
    jsonschema.validate(existing, schema)
    plugins = list(existing.get("plugins", []))
    if any(names_notifications(item) for item in plugins):
        return
    existing["plugins"] = [*plugins, NOTIFICATIONS_OFF]
    jsonschema.validate(existing, schema)
    output.write_text(json.dumps(existing, indent=2) + "\n")
    print(
        f"Adding {NOTIFICATIONS_OFF}: plugins/ade-status plays each conversation's sounds once, in the app showing it"
    )


if __name__ == "__main__":
    try:
        config, schema, output = (Path(arg) for arg in sys.argv[1:])
        prepare(config, schema, output)
    except (OSError, ValueError, jsonschema.ValidationError) as error:
        print(f"OpenCode settings: {error}", file=sys.stderr)
        sys.exit(1)
