# Tool Plugin Architecture — Analysis & Roadmap

**Date**: 2026-05-26
**Status**: Analysis — not yet implemented

---

## Current State

Agent-X has **80+ builtin tools** that are **monolithically hardcoded**:

- All tool definitions live in a single static array `CORE_TOOLS` in `packages/engine/src/tools/toolkit.ts`
- All handler registrations are explicit one-by-one calls in the same file
- No dynamic discovery, no plugin directory, no runtime extensibility
- No tool install/uninstall/search mechanism

### What Exists (The Foundation)

| Component | File | Notes |
|-----------|------|-------|
| `ToolDefinition` type | `packages/shared/src/types/tool.ts` | Already has `source: 'builtin' \| 'plugin' \| 'mcp'` |
| `ToolRegistry` | `packages/engine/src/tools/ToolRegistry.ts` | Generic `Map<string, ToolDefinition>` — plugin-ready |
| `ToolExecutor` | `packages/engine/src/tools/ToolExecutor.ts` | Generic dispatch with permission/scope system — plugin-ready |
| `Agent` injection | `packages/engine/src/agent/Agent.ts:72-80` | Accepts `toolExecutor`/`toolRegistry` via `AgentOptions` |
| Permission system | `packages/engine/src/tools/ToolExecutor.ts` | Works on any tool ID, no hardcoding needed |

### What Is Planned But Not Built

| Component | Spec Reference | Status |
|-----------|---------------|--------|
| `ToolLoader` | Task T177 | Not implemented |
| `PluginLoader` | Task T180 | Not implemented |
| `MCPBridge` | Task T181 | Not implemented |
| Plugin directory (`~/.config/agentx/plugins/`) | spec.md FR-019b | Does not exist |
| `ProviderRegistry` | — | Not implemented |

---

## What a Community Tool Ecosystem Requires

### Infrastructure

| Component | Purpose |
|-----------|---------|
| **ToolLoader** | Scan `~/.config/agentx/tools/` for plugin modules; each exports `ToolDefinition[]` + handlers |
| **PluginLoader** | Load npm-installed packages (`@agentx/tool-xyz`), validate interface, register in ToolRegistry |
| **MCPBridge** (upgrade) | Auto-discover MCP servers from config and dynamically register their tools |
| **Tool CLI** | `agentx tool install <name>`, `agentx tool list`, `agentx tool remove`, `agentx tool search` |
| **Plugin config** | Add `tools: { enabled: string[], disabled: string[], plugins: PluginConfig[] }` to `AgentXConfig` |

### Architecture Change

```
Current:
  toolkit.ts (hardcoded) → ToolRegistry ← Agent

Future:
  toolkit.ts (builtin only)
  + ToolLoader (scans plugins/)
  + PluginLoader (loads npm packages)
  → ToolRegistry (unified, source-tracked)
  ← Agent
```

### Files to Create

| File | Purpose |
|------|---------|
| `packages/engine/src/tools/ToolLoader.ts` | Filesystem discovery of plugin modules |
| `packages/engine/src/tools/plugins/PluginLoader.ts` | Load/validate npm or JS plugin packages |
| `packages/engine/src/tools/plugins/MCPBridge.ts` | Auto-discover MCP server tools |
| `packages/engine/src/commands/builtin/tool-plugin.ts` | CLI commands for tool lifecycle |

### Files to Modify

| File | Change |
|------|--------|
| `packages/engine/src/tools/toolkit.ts` | Split builtin registration from plugin discovery |
| `packages/engine/src/agent/Agent.ts` | Wire ToolLoader into tool initialization |
| `packages/shared/src/types/config.ts` | Add tool plugin configuration types |
| `packages/engine/src/config/ConfigSchema.ts` | Add Zod schemas for plugin config |
| `packages/tui/src/hooks/useSession.ts` | Pass plugin-injected tools to Agent |

---

## Key Design Decisions Needed

1. **Plugin format** — Plain JS files exporting `definitions` + `handlers`? npm packages? Both?
2. **Install mechanism** — `npm install` under the hood? URL downloads? Git clone?
3. **Security model** — Sandboxing? Code signing? Permission scoping per-plugin?
4. **Marketplace** — Central registry (npm org) vs. distributed URLs vs. both?
5. **Versioning** — Semver? Lockfile? Update mechanism?
