"""Skill creator meta-skill — returns authoring checklist."""

from __future__ import annotations

from typing import Any


def run(args: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": True,
        "steps": [
            "Create folder under .agent-x/skills/<name>/",
            "Add SKILL.md with YAML frontmatter",
            "Add run.py with run(args) returning JSON-serializable data",
            "Test with executable_skill_run",
        ],
        "args_received": args,
    }
