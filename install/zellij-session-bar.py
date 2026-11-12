"""Give the tabs of saved Zellij sessions the top bar from dev.kdl.

A resurrected session keeps the bar it was saved with: each tab's zjstatus
(its plugin URL and options) is part of the saved layout. After the bar in
dev.kdl changes, run this while the session is not running (a running session
saves its own bars again within a minute). It also takes the agent status
icons the ADE status plugin put in front of tab names before Zellij 0.46 out
of the saved names, since the bar draws them now:

    python3 install/zellij-session-bar.py [SESSION...]

Without names, every saved session that is not running. Each changed layout
keeps a copy next to it (session-layout.kdl.before-bar).
"""

import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from contextlib import closing
from pathlib import Path

DEV_KDL = (
    Path(__file__).resolve().parent.parent / "config/.config/zellij/layouts/dev.kdl"
)
CACHES = [
    Path.home() / "Library/Caches/org.Zellij-Contributors.Zellij",
    Path.home() / ".cache/zellij",
]
BAR = re.compile(r'plugin location="([^"]*/zjstatus\.wasm)" \{')
# A tab name starting with a status icon (bell, times-circle, check,
# timer-sand) and a space.
MARKED_TAB = re.compile('(tab name=")[\uf0f3\uf057\uf00c\U000f051f] ')
UTF8 = "utf-8"


def block_end(text, start):
    """The index just past the `}` closing the block whose `{` is at start."""
    depth, i = 0, start
    while i < len(text):
        c = text[i]
        if c == '"':
            i += 1
            while text[i] != '"':
                i += 2 if text[i] == "\\" else 1
        elif text.startswith("//", i):
            i = text.index("\n", i)
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    raise ValueError("unbalanced braces")


def dev_bar():
    """The bar's URL and its option lines (without indentation or comments)."""
    text = DEV_KDL.read_text(UTF8)
    match = BAR.search(text, text.index('pane_template name="zjbar"'))
    body = text[match.end() : block_end(text, match.end() - 1) - 1]
    lines = [line.strip() for line in body.splitlines()]
    return match.group(1), [
        line for line in lines if line and not line.startswith("//")
    ]


def with_bar(layout, url, options):
    """The layout with every zjstatus bar replaced by dev.kdl's. Bars saved
    without options (in the templates) keep none."""
    out, pos = [], 0
    for match in BAR.finditer(layout):
        if match.start() < pos:
            continue
        end = block_end(layout, match.end() - 1)
        indent = layout[layout.rindex("\n", 0, match.start()) + 1 : match.start()]
        saved = layout[match.end() : end - 1].strip()
        inner = "".join(f"{indent}    {line}\n" for line in options) if saved else ""
        out += [
            layout[pos : match.start()],
            f'plugin location="{url}" {{\n{inner}{indent}}}',
        ]
        pos = end
    return MARKED_TAB.sub(r"\1", "".join(out) + layout[pos:])


def indexed_names(folder):
    """Session ID -> name, from Zellij's session indexes (0.46), read from a
    copy so that the cache is never written."""
    names = {}
    for index in folder.glob("session_index*.sqlite"):
        with tempfile.TemporaryDirectory() as tmp:
            for part in folder.glob(index.name + "*"):
                shutil.copy(part, tmp)
            try:
                with closing(sqlite3.connect(Path(tmp) / index.name)) as db:
                    query = "SELECT id, name FROM sessions WHERE id IS NOT NULL"
                    names.update(db.execute(query).fetchall())
            except sqlite3.Error:
                pass
    return names


def saved_sessions():
    """Saved session name -> layout file. Since Zellij 0.46 the folder is
    named by an ID, and a session that has ended keeps no metadata, so its
    name comes from the session index."""
    found = {}
    for cache in CACHES:
        for folder in sorted(cache.glob("contract_version_*")):
            names = indexed_names(folder)
            for layout in sorted(folder.glob("session_info/*/session-layout.kdl")):
                metadata = layout.with_name("session-metadata.kdl")
                first = (
                    metadata.read_text(UTF8).split("\n", 1)[0]
                    if metadata.exists()
                    else ""
                )
                match = re.fullmatch(r'name "(.*)"', first)
                name = match.group(1) if match else names.get(layout.parent.name)
                found[name or layout.parent.name] = layout
    return found


def running_sessions():
    try:
        out = subprocess.run(
            ["zellij", "list-sessions", "--no-formatting"],
            capture_output=True,
            text=True,
        ).stdout
    except FileNotFoundError:
        return set()
    return {
        line.split(" ")[0] for line in out.splitlines() if line and "EXITED" not in line
    }


def main(names):
    url, options = dev_bar()
    saved, running = saved_sessions(), running_sessions()
    for name in names:
        if name not in saved:
            sys.exit(f"No saved Zellij session named {name}.")
    failed = False
    for name in names or sorted(saved):
        if name in running:
            print(f"{name}: running, so left alone (quit it first).")
            failed = failed or bool(names)
            continue
        layout = saved[name]
        before = layout.read_text(UTF8)
        after = with_bar(before, url, options)
        if after == before:
            print(f"{name}: already has the bar from dev.kdl.")
            continue
        layout.with_name(layout.name + ".before-bar").write_text(before, UTF8)
        layout.write_text(after, UTF8)
        print(f"{name}: bar updated ({layout}).")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main(sys.argv[1:])
