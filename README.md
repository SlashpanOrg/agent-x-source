# Agent-X

Your AI-powered terminal agent. Multi-provider, 80+ tools, session persistence, Telegram integration — all from your terminal.

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/SlashpanOrg/agentx-releases/main/install.sh | bash
```

**Prerequisites** (the installer checks these automatically):
- Node.js >= 20
- Git

The installer will handle pnpm and everything else.

After installation, start Agent-X:

```bash
agentx
```

A guided setup wizard walks you through provider selection, API key configuration, and preferences on first run.

## Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/SlashpanOrg/agentx-releases/main/uninstall.sh | bash
```

## Features

### Multi-Provider AI
Switch between providers on the fly:
- OpenAI (GPT-4o, o1, etc.)
- Anthropic (Claude 3.5/4)
- Google (Gemini)
- Ollama (local models)
- LM Studio (local models)

### 80+ Built-in Tools
- **Filesystem** — read, write, delete, move, list files/folders
- **Shell** — execute commands, background processes
- **Git** — status, diff, log, commit, branch, stash, blame
- **Code Intelligence** — search, definitions, symbols, replace, insert
- **Packages** — install, remove, list, outdated, run scripts
- **Testing** — run, watch, coverage, generate tests
- **Web/HTTP** — GET, POST, scrape, search
- **Browser Automation** — open pages, click, screenshot, evaluate JS
- **Containers** — Docker management, compose, logs
- **Database** — query, schema, export
- **GitHub** — issues, PRs, repos, workflows, releases
- **System** — info, disk, env, ports, security audit
- **MCP** — connect to Model Context Protocol servers

### Permission System
- Scope-based path validation
- Risk-level assessment per tool
- Interactive permission prompts (allow once / always / deny)

### Session Management
- Persistent sessions with auto-save
- Crash recovery
- Token tracking

### Telegram Integration
Interact with Agent-X remotely via a Telegram bot with shared session context.

### Sub-Agents
Delegate tasks to lightweight sub-agents with isolated tool access.

## Commands

All configuration and management is done inside the Agent-X terminal.

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/model <name>` | Switch AI model |
| `/provider <name>` | Switch provider |
| `/config` | Manage settings (keys, preferences) |
| `/session list` | List saved sessions |
| `/session restore <id>` | Restore a session |
| `/clear` | Clear message history |
| `/compact` | Summarize and compact context |
| `/permissions` | Manage tool permissions |
| `/telegram setup` | Configure Telegram bot |
| `/telegram status` | Show Telegram connection status |
| `/exit` | Exit Agent-X |

## License

MIT
