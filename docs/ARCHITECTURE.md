# Agent-X Architecture

## Runtime Model

```
┌─────────────────────────────────────────────────────────────┐
│  DAEMON (always running)                                      │
│  ├── Agent-X (Master Agent)                                   │
│  │   ├── CrewOrchestrator (multi-crew group chat)            │
│  │   ├── CrewManager (enabled/disabled crews)                │
│  │   └── SubAgentManager (parallel processing w/ limits)     │
│  ├── Channel Gateway                                          │
│  │   ├── Telegram Plugin (always connected)                   │
│  │   └── Future: Discord, Slack, etc.                        │
│  ├── Web API Server (port 3333)                              │
│  └── WebSocket Server (for TUI/Web-UI connection)            │
└─────────────────────────────────────────────────────────────┘
```

## Core Principles

1. **Daemon is the runtime** - always running, owns Agent-X and Channel Gateway
2. **TUI/Web-UI are interfaces** - connect to daemon via WebSocket, mutually exclusive
3. **Channel Gateway always active** - Telegram/Discord/etc. run with daemon
4. **Session = User + Agent-X + Active Crews** (group chat model)
5. **Agent-X orchestrates** - delegates to crews, spawns sub-agents

## Session Model

```
Session
├── User (human)
├── Agent-X (master agent)
│   ├── Crew: "Researcher" (enabled, @researcher)
│   ├── Crew: "Coder" (enabled, @coder)
│   └── Crew: "Reviewer" (disabled)
└── Sub-Agents (spawned by Agent-X, max 5 concurrent)
    ├── Sub-Agent 1: "Research task" (with tools)
    └── Sub-Agent 2: "Code task" (with tools)
```

## Crew Architecture

- **Multiple crews per session** (like a group chat)
- **User can talk to Agent-X OR specific crews** (@mention or picker)
- **Agent-X routes intelligently** - decides which crew to delegate to
- **Crews can be enabled/disabled** in settings per session
- **Agent-X can spawn sub-agents** for parallel processing with full tool support

## Sub-Agent Architecture

- **SmartSubAgent** - Full Agent instance with tool loop, memory, and event stream
- **Configurable limits** - `maxSubAgents` in config (default: 5, max: 20)
- **Resource monitoring** - Tracks CPU time, memory peak, and token usage
- **Tool support** - Sub-agents can use any tools specified in their mission
- **Parallel execution** - Multiple sub-agents run concurrently

## Interface Exclusivity

- **TUI and Web-UI cannot run simultaneously**
- When TUI starts:
  - Daemon always starts (if not running)
  - Check if Web-UI is active → prompt to close it
  - Connect to daemon via WebSocket
- When Web-UI starts:
  - Check if TUI is active → prompt to close it
  - Connect to daemon via WebSocket
- **Daemon/Channel Gateway are NOT affected** by UI changes

## Implementation Status

### ✅ Phase 1: Corrected Architecture (Complete)
- [x] Daemon always runs
- [x] TUI/Web-UI connect via WebSocket
- [x] Exclusive launch check with prompts
- [x] Channel Gateway always active

### ✅ Phase 2: Multi-Crew Architecture (Complete)
- [x] Enhanced Crew type with `enabled`, `expertise`, `traits`, `toolPreferences`
- [x] CrewOrchestrator wired into Agent
- [x] @mention routing for crew-specific messages
- [x] Multi-crew system prompt with group chat rules
- [x] Crew enable/disable commands (`/crew list`, `/crew enable <id>`, `/crew disable <id>`)

### ✅ Phase 3: Agent-X Orchestration (Complete)
- [x] Agent-X intelligent delegation via CrewOrchestrator
- [x] Crew routing based on @mentions and expertise
- [x] Session crew state persistence in SessionStore
- [x] Session restore with crew state

### ✅ Phase 4: Sub-Agent System (Complete)
- [x] Configurable sub-agent limits (`maxSubAgents` in config)
- [x] SubAgentManager enforces limits
- [x] SmartSubAgent integration for full tool support
- [x] Resource monitoring (cpuTime, memoryPeak, tokenUsage)
- [x] Parallel execution with `spawnParallel()`

### ✅ Phase 5: Session Management (Complete)
- [x] `session_crew_states` table in SessionStore
- [x] Save/load crew states per session
- [x] Session restore with crew state
- [x] Web-API endpoint for crew toggle (`POST /api/crew/toggle`)
- [x] TUI `setCrewEnabled` callback with persistence

## Key Files Modified

### Shared Package
- `types/crew.ts` - Enhanced Crew interface with enabled/expertise/traits
- `types/config.ts` - Added `maxSubAgents` config option

### Engine Package
- `secret-sauce/CrewManager.ts` - Multi-crew support, enable/disable methods
- `agent/Agent.ts` - CrewOrchestrator integration, @mention routing, crew management methods
- `agent/SubAgentManager.ts` - SmartSubAgent integration, resource monitoring, limit enforcement
- `agent/SmartSubAgent.ts` - Full Agent instance with tool support
- `session/SessionStore.ts` - `session_crew_states` table, save/load methods
- `session/SessionManager.ts` - Crew state save/restore methods
- `commands/builtin/crew.ts` - Enhanced /crew command with list/enable/disable

### CLI Package
- `index.ts` - Daemon-first TUI startup with Web-UI conflict check

### Web-API Package
- `index.ts` - Added `POST /api/crew/toggle` endpoint, webui-active endpoints

### TUI Package
- `hooks/useSession.ts` - WebSocket session sharing, crew state initialization/restoration, `setCrewEnabled` callback

### Web-UI Package
- `api.ts` - Added `webuiActive` and `gateway` API methods
- `pages/DockingStation.tsx` - Web-UI registration + TUI conflict check
- `pages/Console.tsx` - GatewayStatusBar integration
- `components/GatewayStatusBar.tsx` - Telegram + focus indicator with switcher

## API Endpoints

### Crew Management
- `GET /api/crew/current` - Get active crew
- `POST /api/crew/switch` - Switch active crew
- `POST /api/crew/toggle` - Enable/disable crew in session
- `POST /api/crews` - Create new crew

### Gateway & Focus
- `GET /api/gateway/status` - Get gateway status and focus
- `POST /api/gateway/focus` - Set focus channel
- `GET /api/gateway/focus` - Get current focus

### Interface Exclusivity
- `GET /api/tui-active` - Check if TUI is active
- `GET /api/webui-active` - Check if Web-UI is active
- `POST /api/webui-active` - Register Web-UI as active
- `DELETE /api/webui-active` - Unregister Web-UI

## Configuration

```typescript
interface AgentXConfig {
  provider: ProviderSettings;
  ui: UISettings;
  organization: OrganizationConfig | null;
  telemetry: boolean;
  timezone?: string;
  user?: UserConfig;
  setupComplete?: boolean;
  rag?: RAGConfig;
  maxSubAgents?: number; // Maximum concurrent sub-agents (default: 5, max: 20)
}
```

## Crew Type

```typescript
interface Crew {
  id: string;
  name: string;
  systemPrompt: string;
  emotion?: CrewEmotion;
  isDefault: boolean;
  enabled: boolean;
  expertise?: string[];
  traits?: string[];
  toolPreferences?: {
    enabled?: string[];
    disabled?: string[];
  };
  protocol?: CollaborationProtocol; // 'standard' | 'parallel' | 'sequential' | 'debate' | 'handoff'
  quotas?: CrewResourceQuota;       // maxTokensPerTurn, maxCpuTimeMs, maxMemoryBytes
  createdAt: string;
  updatedAt: string;
}
```

## Sub-Agent Task

```typescript
interface SubAgentTask {
  id: string;
  instruction: string;
  tools: string[];
  timeout: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  result?: string;
  startTime?: number;
  endTime?: number;
  abortController?: AbortController;
  workDir?: string;
  resourceUsage?: {
    cpuTime?: number; // milliseconds
    memoryPeak?: number; // bytes
    tokenUsage?: { input: number; output: number };
  };
}
```

## Usage Examples

### Enable/Disable Crews
```bash
/crew list                    # List all crews with status
/crew enable researcher       # Enable researcher crew
/crew disable reviewer        # Disable reviewer crew
/crew show coder              # Show coder crew details
```

### @mention Routing
```
User: @coder Write a function to sort an array
→ Routes to Coder crew

User: @researcher Find papers on machine learning
→ Routes to Researcher crew

User: Help me with this project
→ Routes to Agent-X (default)
```

### Sub-Agent Delegation
```
Agent-X automatically spawns sub-agents for complex tasks:
- Research task → SmartSubAgent with web_search, file_read tools
- Code task → SmartSubAgent with file_write, shell_exec tools
- Review task → SmartSubAgent with file_read, code_analysis tools
```

## Production Ready Features

✅ **Daemon Persistence** - Channels stay active regardless of UI  
✅ **Multi-Crew Support** - Multiple crews per session with group chat  
✅ **Intelligent Routing** - @mention and expertise-based routing  
✅ **Sub-Agent Tools** - Full tool support in sub-agents  
✅ **Resource Monitoring** - Track CPU, memory, and tokens  
✅ **Configurable Limits** - User-controlled sub-agent limits  
✅ **Session Persistence** - Crew states saved per session  
✅ **Session Restore** - Restore crew states on session load  
✅ **Exclusive UI** - TUI/Web-UI cannot run simultaneously  
✅ **WebSocket Sharing** - TUI connects to daemon for shared session  
✅ **@mention Autocomplete** - Crew @-mention dropdown with ↑↓⏎⭾⎋ in TUI and Web-UI  
✅ **Crew Management Panel** - Web-UI CrewsPanel with enable/disable toggles (CrewsPanel.tsx)  
✅ **Sub-Agent Status Display** - TUI AgentProgress and Web-UI SubAgentChip inline in messages  
✅ **Crew Collaboration Protocols** - parallel, sequential, debate, handoff protocols  
✅ **Resource Quotas per Crew** - token/CPU/memory limits per crew member  
✅ **Sub-Agent Result Caching** - SHA-256 keyed cache with TTL for repeated tasks  

## Future Enhancements (Optional)

- [x] Advanced: Crew collaboration protocols — parallel, sequential, debate, handoff with CrewOrchestrator
- [x] Advanced: Resource quotas per crew — maxTokensPerTurn/Session, maxCpuTimeMs, maxMemoryBytes on Crew type
- [x] Advanced: Sub-agent result caching — SubAgentCache with SHA-256 key derivation and configurable TTL
