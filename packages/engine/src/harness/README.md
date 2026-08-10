# Harness module

Continual harness stores supplemental prompt/memory/skill metadata outside the immutable base system prompt.

## Ordering

1. Refinement (`HarnessService.refine`) acquires a per-session lock.
2. Compaction checks `isRefineInFlight` and skips while refine runs.
3. Apply uses plan/apply split: `planRefinement` → `applyRefinementProposal`.

## Storage

- File: `{sessionDir}/harness/harness_state.json`, global `~/.agent-x/harness/`
- Postgres: `harness_entries`, `harness_refinements` (dual-write when DB pool available)

## Interaction

No slash commands — use REST, UI, natural language, or `Agent.refineHarness()`.
