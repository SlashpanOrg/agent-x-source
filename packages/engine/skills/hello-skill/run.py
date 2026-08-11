"""Sample executable skill — returns a JSON-serializable greeting."""

from __future__ import annotations

from typing import Any


def run(args: dict[str, Any]) -> dict[str, Any]:
    name = str(args.get("name") or "world")
    return {"greeting": f"Hello, {name}!", "skill": "hello-skill"}
