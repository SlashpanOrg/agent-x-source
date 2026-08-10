# Agent-X engine — adoption dev notes

Harness and goals are configured via `config.json` → `adoption` (Settings → Adoption). No shell env toggles.

## Harness (continual refinement)

- Enable: `adoption.harness.enabled`
- API: `POST /api/sessions/:id/harness/refine` with optional `{ instructions, scope }`
- Rollback: `POST /api/sessions/:id/harness/rollback` with `{ refinementId }`
- Auto-refine: `adoption.harness.autoRefineOnCompaction`, `autoRefineIntervalTurns`

## Goals

- Enable: `adoption.goals.enabled`
- Activate: `POST /api/sessions/:id/goal` `{ objective, budget? }`
- Actions: `POST /api/sessions/:id/goal/pause|resume|complete|clear`

## Tests

```bash
cd source && pnpm test:adoption
```

See `docs/adoption/` for rollout, API appendix, and architecture.
