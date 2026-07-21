#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "jedi>=0.19",
# ]
# ///
"""Resolve the parent-class definition of the method under the cursor.

Usage: goto-super.py <file> <line> <column>

<line> and <column> are 1-based (as provided by Helix's %{cursor_line} and
%{cursor_column} expansions). Prints "<path>:<line>:<column>" for the nearest
ancestor class that defines the same method, suitable for Helix's
`:open <path>:<line>:<column>`. If nothing is found the original location is
printed, so the editor stays put.

This gives Helix a "go to super-method" jump for Python, which the LSP type
hierarchy (supertypes) would normally provide but Helix does not yet expose.
"""

from __future__ import annotations

import ast
import sys
from collections import deque
from pathlib import Path

import jedi


def read(path: Path) -> str:
    """Read a file as UTF-8 text."""
    return path.read_text(encoding="utf-8")


def find_environment(start: Path) -> jedi.api.environment.Environment | None:
    """Locate the project's virtualenv so Jedi can resolve third-party imports.

    The script itself runs in an isolated, jedi-only environment (its PEP 723
    deps), which cannot see the project's packages. Pointing Jedi at the
    nearest `.venv` (walking up from the target file) lets it resolve base
    classes that live in dependencies (e.g. `rich`) or in sibling workspace
    packages. Returns None if no venv is found, in which case Jedi falls back
    to its own env (intra-project inheritance still resolves via the smart sys
    path).

    `$VIRTUAL_ENV` is deliberately ignored: `uv run --script` overrides it with
    the isolated per-script environment, so it never points at the project.
    """
    base = start if start.is_dir() else start.parent
    for directory in [base, *base.parents]:
        candidate = directory / ".venv"
        if (candidate / "bin" / "python").exists():
            try:
                return jedi.create_environment(str(candidate), safe=False)
            except Exception:
                return None
    return None


def enclosing_class_and_method(source: str, line: int) -> tuple[ast.ClassDef, str] | None:
    """Return the innermost (ClassDef, method_name) whose body spans `line`."""
    tree = ast.parse(source)
    best_class: ast.ClassDef | None = None
    best_method: str | None = None
    method_span: int | None = None

    for node in ast.walk(tree):
        start = getattr(node, "lineno", None)
        end = getattr(node, "end_lineno", None)
        if start is None or end is None or not (start <= line <= end):
            continue
        if isinstance(node, ast.ClassDef):
            if best_class is None or start > best_class.lineno:
                best_class = node
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            span = end - start
            if method_span is None or span < method_span:
                method_span = span
                best_method = node.name

    if best_class is None or best_method is None:
        return None
    return best_class, best_method


def base_name_node(node: ast.expr) -> ast.expr:
    """Strip subscription so `Task[FileTrace]` resolves to the class `Task`.

    A subscripted generic base is a `Subscript` whose `.value` is the class
    name; its last character is `]`, which Jedi infers to the type *argument*
    (`FileTrace`) rather than the base class. Unwrapping reaches the name.
    """
    while isinstance(node, ast.Subscript):
        node = node.value
    return node


def infer_bases(script: jedi.Script, class_node: ast.ClassDef) -> list[jedi.api.classes.Name]:
    """Resolve the AST base-class expressions of a class to Jedi class Names."""
    out: list[jedi.api.classes.Name] = []
    for base in class_node.bases:
        # Point Jedi at the last character of the base *name*, using 0-based
        # columns. Handles `Base`, dotted `pkg.mod.Base`, and generic
        # `Base[T]` (via base_name_node).
        name_node = base_name_node(base)
        for definition in script.infer(name_node.end_lineno, name_node.end_col_offset - 1):
            if definition.type == "class":
                out.append(definition)
    return out


def bases_of(
    cls: jedi.api.classes.Name, environment: jedi.api.environment.Environment | None
) -> list[jedi.api.classes.Name]:
    """Return Jedi class Names for the direct base classes of a class Name."""
    path = cls.module_path
    if path is None:
        return []
    source = read(Path(path))
    target: ast.ClassDef | None = None
    for node in ast.walk(ast.parse(source)):
        if (
            isinstance(node, ast.ClassDef)
            and node.name == cls.name
            and (target is None or abs(node.lineno - cls.line) < abs(target.lineno - cls.line))
        ):
            target = node
    if target is None:
        return []
    return infer_bases(jedi.Script(source, path=str(path), environment=environment), target)


def find_super_method(
    start_node: ast.ClassDef,
    source: str,
    path: Path,
    method: str,
    environment: jedi.api.environment.Environment | None,
) -> jedi.api.classes.Name | None:
    """Breadth-first walk up the base classes for the first one defining `method`."""
    script = jedi.Script(source, path=str(path), environment=environment)
    queue: deque[jedi.api.classes.Name] = deque(infer_bases(script, start_node))
    seen: set[tuple[str, str, int]] = set()
    while queue:
        cls = queue.popleft()
        key = (str(cls.module_path), cls.name, cls.line)
        if key in seen:
            continue
        seen.add(key)

        for sub in cls.defined_names():
            if sub.name == method and sub.type in ("function", "property"):
                return sub
        queue.extend(bases_of(cls, environment))
    return None


def main() -> int:
    """Print the parent-class method location for the cursor, or the fallback."""
    if len(sys.argv) != 4:
        print("usage: goto-super.py <file> <line> <column>", file=sys.stderr)
        return 2

    path = Path(sys.argv[1]).resolve()
    line = int(sys.argv[2])
    column = int(sys.argv[3])
    fallback = f"{path}:{line}:{column}"

    try:
        source = read(path)
        found = enclosing_class_and_method(source, line)
        if found is None:
            print("not inside a method", file=sys.stderr)
            print(fallback, end="")
            return 1

        class_node, method = found
        environment = find_environment(path)
        target = find_super_method(class_node, source, path, method, environment)
        if target is None or target.module_path is None:
            print(f"no super-method found for '{method}'", file=sys.stderr)
            print(fallback, end="")
            return 1

        # Jedi columns are 0-based; Helix's :open expects 1-based.
        print(f"{target.module_path}:{target.line}:{target.column + 1}", end="")
        return 0
    except Exception as exc:  # never break the editor on a bad parse or lookup
        print(f"goto-super error: {exc}", file=sys.stderr)
        print(fallback, end="")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
