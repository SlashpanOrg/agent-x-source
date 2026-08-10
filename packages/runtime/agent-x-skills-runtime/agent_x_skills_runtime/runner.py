"""Run an executable skill package's run() entrypoint with JSON args."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType
from typing import Any


def _load_run_module(skill_dir: Path, entrypoint: str) -> ModuleType:
    entry = Path(entrypoint)
    if not entry.is_absolute():
        entry = skill_dir / entry
    if entry.suffix != ".py":
        entry = entry.with_suffix(".py")
    if not entry.exists():
        raise FileNotFoundError(f"Skill entrypoint not found: {entry}")
    spec = importlib.util.spec_from_file_location("agentx_skill_entry", str(entry))
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load skill module from {entry}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_skill(skill_path: str, args: dict[str, Any], entrypoint: str = "run.py") -> Any:
    skill_dir = Path(skill_path).resolve()
    module = _load_run_module(skill_dir, entrypoint)
    run_fn = getattr(module, "run", None)
    if run_fn is None:
        raise AttributeError("Skill module must define run(args) function")
    return run_fn(args or {})


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Run an Agent-X executable skill")
    parser.add_argument("--skill-path", required=True)
    parser.add_argument("--args-json", default="{}")
    parser.add_argument("--entrypoint", default="run.py")
    ns = parser.parse_args()
    args = json.loads(ns.args_json or "{}")
    result = run_skill(ns.skill_path, args, ns.entrypoint)
    print(json.dumps(result if result is not None else {"ok": True}))


if __name__ == "__main__":
    main()
