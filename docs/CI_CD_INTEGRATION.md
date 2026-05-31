# CI/CD Integration

Agent-X can be used in CI/CD pipelines for automated code review, testing, and refactoring.

## Usage

```
agentx --non-interactive --prompt "Review this PR for bugs and style issues"
agentx --json --prompt "Run tests and fix any failures" --allow-all-tools
```

## Flags

| Flag | Description |
|------|-------------|
| `--non-interactive` | No TUI, output to stdout |
| `--json` | JSON output (`{status, output, tokensUsed, totalCost}`) |
| `--allow-all-tools` | Bypass all permission prompts |
| `--prompt <text>` | Task description |
| `--voice` | Record and transcribe voice input before processing |
| `--output-format <format>` | Output format (text/json) |

## Exit codes

- `0` — Success
- `1` — Error

## Examples

### GitHub Actions

```yaml
name: AI Code Review
on: [pull_request]
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm install -g agentx
      - run: agentx --non-interactive --prompt "Review the diff in this PR" --allow-all-tools
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

### GitLab CI

```yaml
ai-review:
  stage: test
  script:
    - agentx --json --prompt "Check for security issues" --allow-all-tools
  only:
    - merge_requests
```

### Pre-commit hook

```bash
#!/bin/bash
agentx --non-interactive --prompt "Review staged changes for bugs" --allow-all-tools
```
