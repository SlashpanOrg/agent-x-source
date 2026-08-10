---
name: skill-creator
description: Meta-skill template for authoring new executable Agent-X skills.
triggers: create skill, new skill, skill template
entrypoint: run.py
---

# Skill Creator

Use this template to author executable skills. Each skill is a folder with:

- `SKILL.md` — frontmatter (`name`, `description`, `triggers`, `entrypoint`) + instructions
- `run.py` — `def run(args: dict) -> dict` entrypoint

Install paths (precedence: project > global > bundled):

1. `{workspace}/.agent-x/skills/<skill-name>/`
2. `~/.agent-x/skills/<skill-name>/`
3. Bundled `engine/skills/<skill-name>/`

Run with `executable_skill_run` and load full docs with `executable_skill_load`.
