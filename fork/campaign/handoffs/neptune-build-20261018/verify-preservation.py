#!/usr/bin/env python3
"""Verify a private migration file manifest without changing its contents."""
import argparse
import hashlib
import json
from pathlib import Path
import stat
import sys


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()
    doc = json.loads(args.manifest.read_text())
    root = args.root.resolve()
    expected = set()
    checked = 0
    representation_differences = []
    for item in doc["entries"]:
        relative = Path(item["path"])
        assert not relative.is_absolute() and ".." not in relative.parts
        path = root / relative
        expected.add(str(relative))
        mode = path.lstat().st_mode
        actual_mode = stat.S_IMODE(mode)
        if actual_mode != item["mode"] and item["kind"] == "symlink" and sys.platform.startswith("linux"):
            # Linux symlink modes cannot represent the archived macOS link mode.
            # Preserve the expected mode in the manifest and original tar/ZIP.
            representation_differences.append({"path": str(relative), "kind": "linux_symlink_mode",
                                               "source": item["mode"], "destination": actual_mode})
        else:
            assert actual_mode == item["mode"], str(relative) + " mode mismatch"
        if item["kind"] == "symlink":
            assert path.is_symlink() and str(path.readlink()) == item["target"], str(relative)
        elif item["kind"] == "directory":
            assert stat.S_ISDIR(mode), str(relative)
        else:
            assert stat.S_ISREG(mode), str(relative)
            assert path.stat().st_size == item["bytes"] and digest(path) == item["sha256"], str(relative)
            checked += 1
    actual = set()
    for subtree in doc["complete_subtrees"]:
        base = root / subtree
        actual.add(subtree)
        actual.update(str(p.relative_to(root)) for p in base.rglob("*"))
    scoped_expected = {p for p in expected if any(p == s or p.startswith(s + "/") for s in doc["complete_subtrees"])}
    assert actual == scoped_expected, "Unexpected or missing entries: " + repr(sorted(actual ^ scoped_expected))
    print(json.dumps({"result": "PASS", "entries": len(expected), "regular_files": checked,
                      "manifest_sha256": digest(args.manifest), "complete_subtrees": doc["complete_subtrees"],
                      "representation_differences": representation_differences}))


if __name__ == "__main__":
    main()
