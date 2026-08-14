---
name: release-to-launch
description: >-
  Ship a source-repo release: fix CI on main, open or update the main→launch PR,
  merge only when required checks are green, then watch release.yml until
  desktop/server artifacts publish. Use when a task is complete and we are ready
  for a new release, when PR CI to launch is red, when merging main into launch,
  or when release.yml / public GitHub releases fail.
---

# Release to launch

Git lives in `source/` (`that-rookie-dev/agent-x-source`). Public binaries publish to `that-rookie-dev/agent-x`.

- **PR CI** (`.github/workflows/ci.yml` + `security.yml`) runs on PRs **into `launch`**.
- **Release** (`.github/workflows/release.yml`) runs on **push to `launch`**, only if `packages/shared/src/constants/version.ts` is a tag that does not already exist on the public repo.

Do not spawn a second Agent-X app. Do not force-push `main` or `launch`. Do not skip hooks.

## Loop (every pass)

Refresh live state before acting. Never merge on stale checks.

1. Confirm the git root is `source/` and the working branch is `main` (or a dedicated fix branch that will PR into `main` if `main` is protected).
2. `gh pr view 183 --repo that-rookie-dev/agent-x-source` is the usual main→launch PR; if it is closed, open a new one: base `launch`, head `main`.
3. Work blockers in order: merge conflicts → failing **quality** / **build-and-test** / **audit** → version already released (bump) → release.yml failures.
4. After every push, watch checks to completion. Do not invent extra diffs while CI is still running.

## 1. Version bump (required for a real release)

Public tags already exist for older versions (example: `v0.9.18`). Merging `launch` with an already-published `VERSION` makes `check-version` skip all pack jobs. That is a green skip, **not** a release.

When the user wants a new release:

1. Read `packages/shared/src/constants/version.ts` (`VERSION` is the source of truth).
2. Confirm the tag is new: `gh release view vX.Y.Z --repo that-rookie-dev/agent-x` (failure = tag is free).
3. Bump the patch (or minor if the user said so) in `version.ts`.
4. Run `pnpm version:sync` from `source/` (updates root + desktop `package.json` and `../release/README.md` if present).
5. Run `pnpm version:check` and fix mismatches.

## 2. Fix CI on `main`

Quality job (`pnpm run lint` then `pnpm run typecheck`) is the usual blocker. ESLint **errors** fail the job; warnings do not.

Typical error classes:

- `no-useless-escape` — drop `\` inside character classes (`[:\-]` → `[:-]`) or replace the regex with `includes`.
- `prefer-const` — `let` that is never reassigned.

Reproduce before pushing:

```bash
pnpm run lint
# if quality also typechecks in CI:
pnpm run typecheck
```

If lint is too noisy to scan, grep the log for ` error ` (not `warning`). Fix only those files.

Do **not** weaken CI workflows to go green. Do **not** mass-autofix 1800 warnings.

`build-and-test` already compiles engine/web-api and runs tests on ubuntu/mac/windows. After a targeted lint/type fix, a scoped lint + the tests you touched is enough locally.

## 3. Push `main` and watch the launch PR

```bash
git status && git diff && git log -8 --oneline
# commit on main (user asked to ship)
git push -u origin main
gh pr checks <PR> --repo that-rookie-dev/agent-x-source --watch
```

Required green:

- CI / **quality**
- CI / **build-and-test** (`ubuntu-latest`, `macos-latest`, `windows-latest`)
- Security Audit / **audit**

If quality fails after the push, read the failed job log (`gh run view <id> --log-failed`), fix, commit, push `main` again. The same PR updates in place — do not open a duplicate while it is still open.

## 4. Merge main → launch

Only after a **fresh** `gh pr checks` shows all required checks passed and `mergeable` is `MERGEABLE`.

```bash
gh pr merge <PR> --repo that-rookie-dev/agent-x-source --merge
```

Prefer `--merge` (merge commit) unless the user asked for squash. Do not `--admin` unless the user explicitly said to bypass.

## 5. Watch `release.yml`

```bash
gh run list --repo that-rookie-dev/agent-x-source --branch launch --workflow release.yml --limit 3
gh run watch <id> --repo that-rookie-dev/agent-x-source
```

Jobs that must succeed for a real release (`should_release=true`):

| Job | What it proves |
|---|---|
| `check-version` | New public tag; `RELEASE_PAT` can query `that-rookie-dev/agent-x` |
| `build-core` | shared / engine / web-api / runtime / web-ui build |
| `build-pg-extensions` | pgvector artifacts (linux-x64/arm64, darwin-arm64/x64, windows-x64) |
| `build-macos` | arm64 + x64 dmg/zip |
| `build-linux` | x64 deb/AppImage + arm64 AppImage |
| `build-windows` | x64 exe |
| `build-server` | server tarballs + smoke (`smoke-server-pack.sh`) on linux/mac |
| `publish` | GitHub release on **public** `that-rookie-dev/agent-x` |

If `check-version` says the version was already released: bump (section 1), push `main`, new PR into `launch` if the previous one already merged, merge, watch again.

## 6. Release.yml failed — fix and re-PR

1. `gh run view <id> --log-failed` — read the actual job, not a guess.
2. Fix on `main` (or a short-lived `fix/release-*` branch if `main` cannot be pushed).
3. Push `main`.
4. If `launch` already contains the bad merge, open a **new** PR `main` → `launch` and wait for CI (section 3) before merging. Repeat until `release.yml` publish succeeds.
5. Confirm the public release: `gh release view vX.Y.Z --repo that-rookie-dev/agent-x`.

Never force-push `launch`. Never delete a public tag to “retry” unless the user explicitly requests it.

## 7. Graphify

After editing code under `source/`, run `graphify update .` from `source/` (AST-only). Do not skip because the files were “already known”.

## Commands cheat sheet

```bash
# PR into launch
gh pr list --repo that-rookie-dev/agent-x-source --base launch --head main
gh pr checks <n> --repo that-rookie-dev/agent-x-source --watch
gh pr merge <n> --repo that-rookie-dev/agent-x-source --merge

# Failed quality log
gh run list --repo that-rookie-dev/agent-x-source --branch <head> --limit 5
gh run view <run-id> --repo that-rookie-dev/agent-x-source --log-failed

# Public release
gh release list --repo that-rookie-dev/agent-x --limit 5
gh release view vX.Y.Z --repo that-rookie-dev/agent-x
```
