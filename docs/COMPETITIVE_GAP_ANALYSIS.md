# Agent-X TUI/Web-UI Competitive Gap Analysis

**Date**: 2026-05-30
**Status**: Living document — update as gaps are closed

---

## Methodology

This analysis was performed by:
1. **Full codebase audit**: Read every TUI component (34 files), every web-api route (1292 lines), every engine subsystem, and all shared types
2. **Competitor research**: Analyzed 10 competing AI agent CLI/TUI tools (Claude Code, Cursor, Windsurf, GitHub Copilot CLI, Open Interpreter, Aider, Continue.dev, CodeGPT, Goose, Fabric) — their feature sets, UX patterns, and architectural decisions
3. **Gap categorization**: Each missing feature is rated as:
   - **🔴 Mandatory** — Essential for a competitive AI agent CLI in 2026; missing is a dealbreaker
   - **🟡 Good to have** — Significant UX improvement; expected but not blocking
   - **🔵 Competitor feature** — Differentiator present in some competitors; worth tracking for roadmap

---

## 🔴 Mandatory Gaps

### 1. MCP Support (Model Context Protocol)

| | |
|---|---|
| **What** | Industry-standard protocol for agent-tool communication. 10,000+ public MCP servers available. Adopted by every major competitor (Claude Code, Cursor, Windsurf, Copilot CLI, Continue, Goose, Grok Build, etc.). |
| **Current state** | Zero MCP support. Agent-X has 7 built-in plugins plus a PluginRegistry, but no way to load or communicate with MCP servers. |
| **Impact** | Cannot access the 10K+ MCP ecosystem — database browsers, web scrapers, API integrations, file systems, cloud services. Massive capability gap. |
| **Implementation** | Add MCP client to engine (SSE, Streamable HTTP, stdio transports), MCP server config in PluginRegistry, tool execution bridge to route MCP tools into agent's tool loop. |
| **Files affected** | `packages/engine/src/plugin/` — new `MCPClient.ts`, `MCPLoader.ts`; `packages/engine/src/tools/` — bridge; `packages/shared/src/types/` — MCP types |
| **Competitors** | All major competitors |

### 2. Agent-Native Shell/Bash Execution in TUI

| | |
|---|---|
| **What** | Users ask the agent to run shell commands — list files, execute scripts, install packages, manage processes. The primary interaction model for AI coding agents. |
| **Current state** | The TUI agent can **not** execute shell commands. The engine has Bash/PowerShell tool definitions in `packages/engine/src/tools/platform.js`, but they are not wired into the TUI agent's tool loop. The web-api has file upload, but no terminal execution. |
| **Impact** | The core agent capability (actually doing things on the user's machine) is missing from the primary interface. Agent-X TUI is limited to conversation. |
| **Implementation** | Wire existing `BashTool`/`PowerShellTool` into the agent's `ToolRegistry`. Route tool execution through `PermissionPrompt`. Show stdout/stderr in `MessageArea`. |
| **Files affected** | `packages/engine/src/agent/Agent.ts` — tool provisioning; `packages/tui/src/hooks/useSession.ts` — tool event wiring; `packages/tui/src/components/PermissionPrompt.tsx` — tool approval |
| **Competitors** | All competitors |

### 3. File Read/Edit/Write Operations in TUI

| | |
|---|---|
| **What** | Agent reads source files, edits code, creates new files — the fundamental capability of a coding agent. |
| **Current state** | No file operation tools are exposed in the TUI agent. The engine may have file operations defined but they are not wired into the agent loop shown to the user. |
| **Impact** | Cannot use Agent-X for actual coding tasks. The agent can talk about code but cannot read, edit, or create files. |
| **Implementation** | Add `Read`, `Edit`, `Write`, `Grep`, `Glob` tools to agent's tool registry. Wire into TUI permission/execution flow. Show diffs in TUI before applying. |
| **Files affected** | `packages/engine/src/tools/` — new file tool definitions; `packages/engine/src/agent/Agent.ts` — tool provisioning; `packages/tui/src/hooks/useSession.ts` — result handling |
| **Competitors** | All competitors |

### 4. Plan-then-Execute Workflow

| | |
|---|---|
| **What** | Before the agent takes actions (edits files, runs commands), it first produces a plan. The user reviews and approves the plan. Only then does execution begin. |
| **Current state** | Agent-X has no plan mode. The agent goes directly from user request to action (if tools were wired). No structured planning step, no plan review UI. |
| **Impact** | Major safety and trust gap. Users have no visibility into what the agent intends to do before it does it. Competitors make this their primary interaction pattern. |
| **Implementation** | Add plan mode state to Agent (analyze → plan → present → confirm → execute). Show plan in TUI as a structured list. Accept/reject/modify before execution. |
| **Files affected** | `packages/engine/src/agent/Agent.ts` — plan mode state machine; `packages/tui/src/screens/WelcomeScreen.tsx` — plan overlay; `packages/shared/src/types/events.ts` — plan events |
| **Competitors** | Claude Code (`EnterPlanMode`), Cursor (`--mode=plan`), Copilot CLI (Shift+Tab), Aider (Architect mode), Windsurf (Plan Mode), Grok Build |

### 5. Session Persistence & User-Facing Resume

| | |
|---|---|
| **What** | Users can name sessions, list past sessions, resume any session by name or ID. Session history persists across app restarts. |
| **Current state** | Agent-X has `SessionRestore` screen for crash recovery but no user-facing session management. Sessions are ephemeral — exit the TUI and the conversation is lost. No `--resume`, no session list, no session naming. |
| **Impact** | Cannot continue a conversation after accidentally exiting. No audit trail of past work. No way to revisit a previous session's context. |
| **Implementation** | Add session naming on create. Save conversation history to SessionStore. Add `--resume` CLI flag. Add `/sessions` command and session browser in TUI. |
| **Files affected** | `packages/tui/src/App.tsx` — --resume flag; `packages/tui/src/hooks/useSession.ts` — session persistence; `packages/tui/src/screens/SessionRestore.tsx` — enhanced UI; `packages/engine/src/session/SessionStore.ts` — message persistence |
| **Competitors** | All competitors |

### 6. Proper Error Recovery & Self-Healing

| | |
|---|---|
| **What** | When an error occurs, the agent should auto-retry transient failures, suggest remediation for persistent ones, gracefully degrade when a provider/model fails, and never leave the user stuck. |
| **Current state** | The engine has `toFriendlyError()` (401/429/404/402 classification) and remediation actions. ErrorBanner exists. But there is no retry logic, no fallback model chain, no graceful degradation. One error ends the conversation. |
| **Impact** | Frustrating UX. Network blips, rate limits, or provider outages kill the session. User must manually restart. |
| **Implementation** | Add retry with exponential backoff to Agent's completion loop. Add fallback model/provider chain. Auto-suggest remediation based on error type. |
| **Files affected** | `packages/engine/src/agent/Agent.ts` — retry logic; `packages/engine/src/provider/` — fallback chain; `packages/tui/src/components/ErrorBanner.tsx` — auto-suggest |
| **Competitors** | All competitors |

### 7. Auto-Scroll & Terminal Rendering Polish

| | |
|---|---|
| **What** | MessageArea should auto-scroll to the latest content. Streaming output should be smooth. Long outputs should be properly truncated. Terminal resize and signal handling should work. |
| **Current state** | MessageArea and streaming content don't auto-scroll. Long outputs can break terminal layout. SIGINT handling is minimal. |
| **Impact** | Messages scroll off-screen. Streaming content jumps around. Poor terminal rendering experience. |
| **Implementation** | Add auto-scroll ref to MessageArea. Implement proper truncation for long outputs. Handle SIGINT for clean abort. Fix Ink rendering of large content. |
| **Files affected** | `packages/tui/src/components/MessageArea.tsx` — auto-scroll; `packages/tui/src/screens/WelcomeScreen.tsx` — signal handling |
| **Competitors** | All competitors |

### 8. Permissions Actually Wired for Tool Execution

| | |
|---|---|
| **What** | When the agent wants to execute a tool (run a shell command, edit a file), it should request permission through the TUI's PermissionPrompt. The user can allow/deny/always-allow. |
| **Current state** | `PermissionPrompt` component exists. `PermissionManager` exists in engine. But they are **not wired together** — tools are not routed through the permission system in the TUI agent loop. |
| **Impact** | Safety mechanism exists but is not connected. There's no way for users to control what the agent does. |
| **Implementation** | Wire `PermissionManager.request()` into the agent's tool execution pipeline. Route decisions through TUI's `PermissionPrompt`. Implement `allow_once`/`allow_always`/`deny` flow. |
| **Files affected** | `packages/engine/src/agent/Agent.ts` — permission hook; `packages/tui/src/hooks/useSession.ts` — permission events; `packages/engine/src/tools/ToolExecutor.ts` — permission check |
| **Competitors** | All competitors |

---

## 🟡 Good to Have

### 9. Parallel Sub-Agents

| | |
|---|---|
| **What** | Spawn multiple sub-agents simultaneously for parallel task execution. Each sub-agent gets its own context window and works independently. |
| **Current state** | `SubAgentManager` exists in engine. `AgentProgress` component shows sub-agent status in TUI. But sub-agents are not user-invokable and have no parallel execution UI. |
| **Impact** | Cannot parallelize work (e.g., "review all 10 files at once"). |
| **Implementation** | Wire sub-agent spawning into the agent's tool set. Show parallel progress with results merging. Support up to 5-10 concurrent workers. |
| **Files affected** | `packages/engine/src/agent/SubAgentManager.ts` — parallel execution; `packages/tui/src/components/AgentProgress.tsx` — multi-agent display |
| **Competitors** | Cursor (10 workers), Windsurf Wave 13 (5 parallel), Grok Build (8 concurrent), Goose (subagent parallelism) |

### 10. Background Agent Execution

| | |
|---|---|
| **What** | Start an agent task in the background and continue working (chatting, doing other tasks) while it runs. Monitor progress in a sidebar/panel. |
| **Current state** | No background execution. Agent runs synchronously — user must wait for completion before doing anything else. |
| **Implementation** | Add agent queue system. Background tasks shown in `SessionPanel`. Notify user on completion. |
| **Files affected** | `packages/engine/src/agent/Agent.ts` — background mode; `packages/tui/src/components/SessionPanel.tsx` — background task display |
| **Competitors** | Claude Code (`--bg`), Copilot CLI (`&` prefix), Cursor (Cloud handoff) |

### 11. Git Integration

| | |
|---|---|
| **What** | Auto-commit changes with descriptive messages. Show diff of proposed changes. Review staged/unstaged changes. Create PRs from within the TUI. |
| **Current state** | Zero git integration. No git tools, no git commands, no diff display. |
| **Implementation** | Add git tools (commit, diff, status, log, push, PR) to engine toolset. Show inline diffs in TUI before applying changes. Add `/diff` and `/commit` commands. |
| **Files affected** | `packages/engine/src/tools/` — new git tools; `packages/tui/src/components/` — diff display |
| **Competitors** | Aider (auto-commit), Copilot CLI (`/diff`, `/review`), Claude Code (git-aware) |

### 12. Inline File Diff Display

| | |
|---|---|
| **What** | When files are modified, show a syntax-highlighted diff in the TUI before applying the change. Let the user review each hunk. |
| **Current state** | No diff display. No way to see what changed before accepting. |
| **Implementation** | Add unified diff parser. Display in TUI with added/removed line highlighting. Per-hunk accept/reject. |
| **Files affected** | `packages/tui/src/components/` — new DiffView component |
| **Competitors** | Copilot CLI (`/diff`), Cursor (diff view), Claude Code (edit display) |

### 13. Cost Tracking (USD)

| | |
|---|---|
| **What** | Display dollar cost of current session alongside token usage. Set budget limits. Show cost per-message. |
| **Current state** | Token tracking exists (`TokenTracker`, `TokenBar`) but no cost calculation. No dollar amounts. No budget limits. |
| **Implementation** | Map token usage to provider pricing. Add cost display to `SessionPanel` and `TokenBar`. Add `/cost` command. |
| **Files affected** | `packages/engine/src/session/TokenTracker.ts` — cost calculation; `packages/tui/src/components/TokenBar.tsx` — cost display; `packages/tui/src/components/SessionPanel.tsx` — cost row |
| **Competitors** | Claude Code (`--max-budget`), Open Interpreter (`--max-budget`), Aider (`/cost`, `/tokens`) |

### 14. Session Fork/Export/Share

| | |
|---|---|
| **What** | Fork a session into an independent new session. Export session as markdown/JSONL. Share sessions with others. |
| **Current state** | No session forking. No export. No share. |
| **Implementation** | Add `/fork` command. Add session export as markdown/JSONL. Add session file output. |
| **Files affected** | `packages/engine/src/session/SessionManager.ts` — fork; `packages/tui/src/` — /fork command |
| **Competitors** | Copilot CLI (`/fork`), Goose (session export), Claude Code (`/fork-session`) |

### 15. Custom Slash Commands

| | |
|---|---|
| **What** | Users define their own slash commands with custom prompts and behavior. Team-shareable command templates. |
| **Current state** | Slash commands are hardcoded in `CommandRegistry`. No user extensibility. |
| **Implementation** | Add user-defined command registry. Load commands from config file. Support prompt templates with variables. |
| **Files affected** | `packages/engine/src/command/CommandRegistry.ts` — dynamic registration; `packages/engine/src/config/` — command config |
| **Competitors** | Continue.dev (prompts key), Claude Code (Skills), Goose (Recipes), GitHub Copilot (custom agents) |

### 16. Watch Mode / Reactive File Watching

| | |
|---|---|
| **What** | Monitor files for changes and react automatically. Watch test output and auto-fix failures. Watch lint output and auto-correct. |
| **Current state** | No file watching. No reactive behavior. |
| **Implementation** | Add file watcher to engine (chokidar or similar). Event-driven re-analysis in TUI. Watch mode toggle. |
| **Files affected** | `packages/engine/src/` — new watcher service; `packages/tui/src/` — watch mode toggle |
| **Competitors** | Aider (AI!/AI? markers, watch mode), Claude Code (Monitor tool) |

### 17. Codebase Indexing / RAG in TUI

| | |
|---|---|
| **What** | Index the codebase for semantic search. Agent retrieves relevant code snippets automatically. User can search across the codebase. |
| **Current state** | Engine has `RAGEngine`, `MemoryVectorStore`, `LLMEmbeddingProvider`. Web-api has `/api/rag/*` routes. But the TUI has **no RAG interface** — no `/index`, no search, no status display. |
| **Implementation** | Add `/index` command to TUI. Add RAG status to Banner. Wire RAG results into agent's context. Add semantic search. |
| **Files affected** | `packages/tui/src/hooks/useSession.ts` — RAG context; `packages/tui/src/components/Banner.tsx` — RAG status |
| **Competitors** | Windsurf (Fast Context via SWE-grep), Continue (@codebase), Cursor (@Codebase) |

### 18. Voice Input

| | |
|---|---|
| **What** | Dictate prompts via microphone. Speech-to-text transcription of user's voice into messages. |
| **Current state** | No voice support. |
| **Implementation** | Add `/voice` command. Integrate platform speech-to-text (macOS NSSpeechRecognizer, Whisper API). |
| **Files affected** | `packages/tui/src/hooks/` — new useVoice hook; `packages/tui/src/components/InputField.tsx` — voice button |
| **Competitors** | Aider (`/voice`), Fabric (`--transcribe-file`), Claude Code (mobile voice) |

### 19. Session List & Restore UI

| | |
|---|---|
| **What** | Full-featured session browser with search, date range filter, pagination. Sessions listed by name, date, model, provider, message count. |
| **Current state** | `SessionRestore.tsx` exists but is basic — shows recent sessions with minimal info. No search, no filter, no pagination. |
| **Implementation** | Enhance `SessionRestore` with search bar, date filter, provider/model filter. Add session metadata display (cost, message count, duration). |
| **Files affected** | `packages/tui/src/screens/SessionRestore.tsx` — full rewrite |
| **Competitors** | Claude Code (`claude sessions`), Cursor (`agent ls`), Goose (`goose session list`) |

### 20. Model Routing (Per-Task)

| | |
|---|---|
| **What** | Different models for different tasks — fast model for simple edits, strong model for complex reasoning, cheap model for summarization. |
| **Current state** | One model for everything. No routing. |
| **Implementation** | Add model routing config. Per-task model override in Agent. Auto-selection heuristics based on task complexity. |
| **Files affected** | `packages/engine/src/agent/Agent.ts` — model routing; `packages/engine/src/config/` — routing config |
| **Competitors** | Continue.dev (per-role routing), Aider (3-tier model system), Cursor (Auto mode) |

### 21. Theme / Color Scheme Customization

| | |
|---|---|
| **What** | User-configurable color themes. Dark mode, light mode, high-contrast, colorblind-friendly. Custom accent colors. |
| **Current state** | Fixed `COLORS` object in `theme/colors.ts`. No customization. |
| **Implementation** | Add theme system. Load theme from config. Expose `/theme` command. Provide 5+ built-in themes. |
| **Files affected** | `packages/tui/src/theme/` — theme system; `packages/tui/src/components/` — use theme hook |
| **Competitors** | Claude Code (`/theme`), Goose (syntax themes), Aider (`--dark-mode`, `--light-mode`), Copilot CLI (`/theme`) |

### 22. Tool Browser in TUI

| | |
|---|---|
| **What** | Browse available tools with descriptions, categories, risk levels. Enable/disable tools per session. Search tools by name or category. |
| **Current state** | Web-api has `/api/tools` and `/api/tools/categories`. The TUI has no tool browser. Users can't see what tools the agent has. |
| **Implementation** | Add `/tools` command. Add tools screen with category grouping, search, enable/disable toggles. Show active tool count in Banner. |
| **Files affected** | `packages/tui/src/screens/` — new ToolsScreen; `packages/tui/src/components/Banner.tsx` — tool count |
| **Competitors** | Claude Code (tool list in permissions), Cursor (tool visibility) |

---

## 🔵 Competitor Features

These are differentiators present in some competitors. Worth tracking for strategic roadmap but not yet table stakes.

### 23. MCP First-Party Extensions Ecosystem

| | |
|---|---|
| **What** | Bundled first-party MCP extensions for common services (filesystem, database, browser, email, calendar, cloud). |
| **Who has it** | Goose (70+ first-party), Continue.dev (21+ OOTB integrations) |
| **Implementation** | After adding MCP support (#1), build and ship 10-20 first-party extensions. |

### 24. Cloud Agent Handoff

| | |
|---|---|
| **What** | Start a session locally, hand it off to a cloud agent that continues running in the background. Resume from another device. |
| **Who has it** | Claude Code (`--teleport`), Cursor (`&` prefix), Windsurf (Devin Cloud), Copilot CLI (`&`) |
| **Implementation** | Requires cloud infrastructure. Agent serialization and remote execution. |

### 25. Desktop / IDE Integration

| | |
|---|---|
| **What** | Desktop app (Electron/Tauri), VS Code extension, JetBrains plugin. Full IDE integration with editor-managed files. |
| **Who has it** | Claude Code (Desktop + VS Code + JetBrains), Cursor (VS Code fork), Windsurf (VS Code fork), Continue (VS Code extension), Goose (Desktop app), CodeGPT (extension) |
| **Implementation** | Major scope. New packages: `packages/desktop/`, `packages/vscode/`. |

### 26. CI/CD Non-Interactive Mode

| | |
|---|---|
| **What** | JSON output format, non-interactive flags, exit codes for scripting. Run agent in CI pipelines. |
| **Who has it** | All major competitors (`--json`, `--output-format json`, non-interactive mode) |
| **Implementation** | Add `--json` flag to TUI. Structured output for all operations. Exit codes for scripting. The web-api already covers this use case partially. |

### 27. Enterprise Policy Management

| | |
|---|---|
| **What** | SSO, managed config, tool allow/deny policies enforced across an organization. Admin-controlled model access. |
| **Who has it** | Goose (AAIF/Linux Foundation), Copilot (Enterprise managed settings), Claude Code (Managed settings) |
| **Implementation** | Enterprise-grade. Requires auth, policy engine, admin API. |

### 28. Adversarial Agent for Security

| | |
|---|---|
| **What** | A secondary agent that audits the primary agent's actions for prompt injection, unsafe commands, information leakage. |
| **Who has it** | Goose (built-in adversarial agent) |
| **Implementation** | Add safety auditor agent in engine. Runs in parallel, blocks suspicious actions. |

### 29. ACP (Agent Communication Protocol)

| | |
|---|---|
| **What** | Standardized protocol for inter-agent communication. Run Agent-X as an ACP server for other agents to use. |
| **Who has it** | Claude Code, Cursor, Goose (ACP support) |
| **Implementation** | Add ACP server to web-api. Support JSON-RPC over stdio. |

### 30. Scheduled Tasks in TUI

| | |
|---|---|
| **What** | Schedule recurring tasks from within the TUI. View, create, delete cron jobs. Get reminders and notifications. |
| **Who has it** | Claude Code (`/schedule`, `CronCreate`), Copilot (recurring tasks) |
| **Current state** | Scheduler exists in engine and web-api (`/api/scheduler/jobs`) but has **no TUI interface**. |
| **Implementation** | Add `/schedule` command. Wire existing Scheduler into TUI. Show scheduled jobs in SessionPanel. |

### 31. Recipe / Workflow Sharing

| | |
|---|---|
| **What** | Reusable, shareable, versionable workflow templates. Define multi-step processes as YAML/markdown. Share with team. |
| **Who has it** | Goose (Recipes YAML + Jinja2), Fabric (Patterns system, 200+ built-in), Claude Code (Skills + frontmatter) |
| **Implementation** | New subsystem: recipe engine with YAML parsing, parameter templating, sub-recipe composition. |

### 32. Remote Agent Tunneling

| | |
|---|---|
| **What** | Tunnel an agent session across machines. Start on laptop, resume on server. Remote agent execution. |
| **Who has it** | Continue (`--id`), Claude Code (`--teleport`) |
| **Implementation** | Requires WebSocket tunnel infrastructure. Agent state serialization. |

### 33. SWE-Bench Trained Model

| | |
|---|---|
| **What** | Proprietary model trained end-to-end on real software engineering tasks. 950 tok/s inference. |
| **Who has it** | Windsurf (SWE-1.6 on Cerebras) |
| **Implementation** | Model training effort, not a code gap. Could integrate SWE-1.6 as an available provider. |

### 34. OpenTelemetry / Observability

| | |
|---|---|
| **What** | Export traces, metrics, logs via OpenTelemetry standard. Integrate with Datadog, Grafana, New Relic. |
| **Who has it** | Goose (OpenTelemetry integration) |
| **Current state** | Agent-X has `DefaultTelemetryBus` but no OTEL export. |
| **Implementation** | Add OTEL exporter to telemetry bus. Export spans for LLM calls, tool executions, agent operations. |

---

## Summary: Priority Order for Closing Gaps

```
Priority  │ Gap                    │ Effort    │ Impact
──────────┼────────────────────────┼───────────┼─────────────────
P0        │ MCP support           │ 1-2 weeks │ 10K+ tools instantly available
P0        │ Shell/file operations  │ 1 week    │ Agent becomes useful
P0        │ Plan-then-execute      │ 1-2 weeks │ Trust & safety
P0        │ Session persistence    │ 3-5 days  │ Usability
P0        │ Error recovery         │ 3-5 days  │ Reliability
P0        │ Auto-scroll/rendering  │ 1-2 days  │ Polish
P0        │ Permissions wiring     │ 2-3 days  │ Safety
──────────┼────────────────────────┼───────────┼─────────────────
P1        │ Sub-agents             │ 1 week    │ Parallelism
P1        │ Git integration        │ 1 week    │ Workflow
P1        │ Cost tracking          │ 2-3 days  │ Transparency
P1        │ Session fork/export    │ 2-3 days  │ Workflow
P1        │ Codebase RAG in TUI    │ 1 week    │ Context
P1        │ Model routing          │ 3-5 days  │ Efficiency
P1        │ Theme customization    │ 2-3 days  │ UX
P1        │ Tool browser           │ 2-3 days  │ Discoverability
P1        │ Background agents      │ 1 week    │ Productivity
P1        │ Watch mode             │ 3-5 days  │ Automation
P1        │ Voice input            │ 3-5 days  │ Accessibility
P1        │ Custom commands        │ 2-3 days  │ Extensibility
P1        │ Inline diffs           │ 3-5 days  │ Transparency
P1        │ Session list UI        │ 2-3 days  │ Navigation
──────────┼────────────────────────┼───────────┼─────────────────
P2        │ Scheduled tasks TUI    │ 3-5 days  │ Automation
P2        │ CI/CD non-interactive  │ 2-3 days  │ Integration
P2        │ MCP extension ecosystem│ 2-4 weeks │ Ecosystem
P2        │ Cloud handoff          │ 4-8 weeks │ Mobility
P2        │ Desktop/IDE apps       │ 4-12 weeks│ Surfaces
P2        │ Enterprise policy      │ 4-8 weeks │ Enterprise
P2        │ Adversarial agent      │ 2-3 weeks │ Security
P2        │ ACP support            │ 1-2 weeks │ Interop
P2        │ Recipe system          │ 2-4 weeks │ Reusability
P2        │ Remote tunneling       │ 3-5 weeks │ Remote work
P2        │ SWE model              │ External  │ Performance
P2        │ OpenTelemetry          │ 1-2 weeks │ Observability
```

---

## References

- **Competitor analysis**: Claude Code, Cursor, Windsurf, GitHub Copilot CLI, Open Interpreter, Aider, Continue.dev, CodeGPT, Goose, Fabric — researched 2026-05-30
- **Current codebase**: Full audit of `packages/tui/`, `packages/web-api/`, `packages/engine/`, `packages/shared/`
- **See also**: `docs/TOOL_PLUGIN_ARCHITECTURE_ANALYSIS.md` — tool extensibility; `docs/INTEGRATION_MODULES_ROADMAP.md` — integration roadmap
