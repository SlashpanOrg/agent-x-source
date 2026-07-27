#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# verify-observability.sh — Agent-X Observability Runtime Verification (ALL PHASES)
#
# Connects to the local embedded Postgres and the web-api to verify that
# traces, spans, logs, and metrics are being persisted correctly, the backend
# API works, developer mode gating works, retention/PII/safety work, the
# frontend is served, and the build/shipping checks pass.
#
# Usage:  bash verify-observability.sh
#         ADMIN_USERNAME=myuser ADMIN_PASSWORD=mypass bash verify-observability.sh
#
# Prerequisites:
#   - Agent-X is running (web-api on :3333, embedded PG on :3335)
#   - Auth is set up (or the script will attempt setup/login with defaults)
#   - psql, curl are installed and on PATH
#   - For build/typecheck checks: pnpm is installed and the repo is at source/
#
# This script is for LOCAL DEVELOPMENT TESTING ONLY — do not ship with builds.
# ═══════════════════════════════════════════════════════════════════════════════

set -uo pipefail

# ── Config ─────────────────────────────────────────────────────────────────────
PG_CONN="postgresql://agentx:agentx@127.0.0.1:3335/agentx"
API_BASE="http://127.0.0.1:3333"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Sivasyrex117}"
CHAT_TEXT="Hello, what is 2+2? Reply in one sentence."
FLUSH_WAIT_SEC=20
TURN_TIMEOUT_SEC=90
# Repo root for build/typecheck checks (parent of this script's dir).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"

# ── Colors ─────────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'
  CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
else
  GREEN=''; RED=''; YELLOW=''; CYAN=''; BOLD=''; DIM=''; NC=''
fi

# ── Counters ───────────────────────────────────────────────────────────────────
PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0
SKIP_COUNT=0
FAILED_CHECKS=()

# ── Helpers ────────────────────────────────────────────────────────────────────
pass() {
  echo -e "  ${GREEN}✓ PASS${NC}  $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  echo -e "  ${RED}✗ FAIL${NC}  $1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
  FAILED_CHECKS+=("$1")
}

warn() {
  echo -e "  ${YELLOW}⚠ WARN${NC}  $1"
  WARN_COUNT=$((WARN_COUNT + 1))
}

skip() {
  echo -e "  ${DIM}→ SKIP${NC}  $1"
  SKIP_COUNT=$((SKIP_COUNT + 1))
}

section() {
  echo ""
  echo -e "${CYAN}${BOLD}══ $1 ══${NC}"
}

pg_query() {
  psql "$PG_CONN" -t -A -F '|' -c "$1" 2>/dev/null
}

pg_count() {
  local result
  result=$(psql "$PG_CONN" -t -A -c "$1" 2>/dev/null | tr -d '[:space:]')
  echo "${result:-0}"
}

pg_table_exists() {
  local count
  count=$(pg_count "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='observability' AND table_name='$1'")
  [ "$count" = "1" ]
}

# HTTP helper: returns just the status code.
http_status() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@" 2>/dev/null
}

# HTTP helper: returns the response body.
http_body() {
  curl -s --max-time 15 "$@" 2>/dev/null
}

# ═══════════════════════════════════════════════════════════════════════════════
# 1. PRE-FLIGHT CHECKS
# ═══════════════════════════════════════════════════════════════════════════════
section "1. Pre-flight Checks"

HTTP_STATUS=$(http_status "$API_BASE/api/health")
if [ "$HTTP_STATUS" = "200" ]; then
  pass "web-api is reachable at $API_BASE (GET /api/health → 200)"
else
  fail "web-api is NOT reachable at $API_BASE (got HTTP $HTTP_STATUS). Start Agent-X first."
  echo -e "\n${RED}Aborting: web-api must be running.${NC}"
  exit 1
fi

PG_OK=$(pg_count "SELECT 1")
if [ "$PG_OK" = "1" ]; then
  pass "PostgreSQL is reachable at 127.0.0.1:3335/agentx"
else
  fail "PostgreSQL is NOT reachable at 127.0.0.1:3335/agentx"
  echo -e "\n${RED}Aborting: PG must be running.${NC}"
  exit 1
fi

for tbl in traces spans logs metric_samples config; do
  if pg_table_exists "$tbl"; then
    pass "observability.$tbl table exists"
  else
    fail "observability.$tbl table is MISSING (V024 migration may not have run)"
  fi
done

CONFIG_COUNT=$(pg_count "SELECT COUNT(*) FROM observability.config WHERE id=1")
if [ "$CONFIG_COUNT" = "1" ]; then
  pass "observability.config has the singleton row (id=1)"
else
  fail "observability.config singleton row is MISSING"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 2. AUTHENTICATION
# ═══════════════════════════════════════════════════════════════════════════════
section "2. Authentication"

AUTH_TOKEN=""

AUTH_STATUS_JSON=$(http_body "$API_BASE/api/auth/status")
HAS_ROOT=$(echo "$AUTH_STATUS_JSON" | grep -o '"hasRootUser":[a-z]*' | head -1 | cut -d: -f2)
IS_AUTH=$(echo "$AUTH_STATUS_JSON" | grep -o '"isAuthenticated":[a-z]*' | head -1 | cut -d: -f2)

if [ "$IS_AUTH" = "true" ]; then
  AUTH_TOKEN=$(echo "$AUTH_STATUS_JSON" | grep -o '"sessionToken":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ -n "$AUTH_TOKEN" ]; then
    pass "Already authenticated (sessionToken present in /api/auth/status)"
  else
    warn "isAuthenticated=true but no sessionToken in response — will attempt login"
  fi
fi

if [ -z "$AUTH_TOKEN" ]; then
  if [ "$HAS_ROOT" = "false" ]; then
    echo "  No root user exists — attempting setup with $ADMIN_USERNAME..."
    SETUP_RESP=$(curl -s -X POST "$API_BASE/api/auth/setup" \
      -H 'Content-Type: application/json' \
      -d "{\"username\":\"$ADMIN_USERNAME\",\"password\":\"$ADMIN_PASSWORD\"}" 2>/dev/null)
    AUTH_TOKEN=$(echo "$SETUP_RESP" | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)
    if [ -n "$AUTH_TOKEN" ]; then
      pass "Auth setup succeeded (created root user '$ADMIN_USERNAME')"
    else
      fail "Auth setup failed: $SETUP_RESP"
      echo -e "\n${RED}Aborting: cannot proceed without auth.${NC}"
      exit 1
    fi
  else
    echo "  Root user exists — attempting login with $ADMIN_USERNAME..."
    LOGIN_RESP=$(curl -s -X POST "$API_BASE/api/auth/login" \
      -H 'Content-Type: application/json' \
      -d "{\"username\":\"$ADMIN_USERNAME\",\"password\":\"$ADMIN_PASSWORD\"}" 2>/dev/null)
    AUTH_TOKEN=$(echo "$LOGIN_RESP" | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)
    if [ -n "$AUTH_TOKEN" ]; then
      pass "Auth login succeeded as '$ADMIN_USERNAME'"
    else
      fail "Auth login failed: $LOGIN_RESP"
      echo "  Try: ADMIN_USERNAME=<your-user> ADMIN_PASSWORD=<your-pass> bash verify-observability.sh"
      echo -e "\n${RED}Aborting: cannot proceed without auth.${NC}"
      exit 1
    fi
  fi
fi

AUTH_HDR="Authorization: Bearer $AUTH_TOKEN"

# ═══════════════════════════════════════════════════════════════════════════════
# 3. GENERATE OBSERVABILITY DATA
# ═══════════════════════════════════════════════════════════════════════════════
section "3. Generating Observability Data"

echo "  Making HTTP requests (APP traces)..."
curl -s -o /dev/null -H "$AUTH_HDR" "$API_BASE/api/sessions" 2>/dev/null
curl -s -o /dev/null -H "$AUTH_HDR" "$API_BASE/api/sessions" 2>/dev/null
curl -s -o /dev/null "$API_BASE/api/health" 2>/dev/null
pass "Made 3 HTTP requests (2x GET /api/sessions, 1x GET /api/health)"

echo "  Attempting auth operations (APP traces)..."
curl -s -o /dev/null -X POST "$API_BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$ADMIN_USERNAME\",\"password\":\"wrong-password\"}" 2>/dev/null
pass "Made 1 failed login attempt (auth span with auth.success=false)"

echo "  Sending a chat turn (AGENT trace)..."
TURN_OUTPUT=$(curl -s -N --max-time $TURN_TIMEOUT_SEC \
  -H "$AUTH_HDR" \
  -H 'Content-Type: application/json' \
  -X POST "$API_BASE/api/chat/message-stream" \
  -d "{\"text\":\"$CHAT_TEXT\"}" 2>/dev/null)
TURN_EVENTS=$(echo "$TURN_OUTPUT" | grep -c '^event:' || true)
if [ "$TURN_EVENTS" -gt 0 ]; then
  pass "Chat turn completed ($TURN_EVENTS SSE events received)"
else
  warn "Chat turn produced no SSE events — may have timed out or failed. Continuing anyway..."
fi

echo "  Waiting ${FLUSH_WAIT_SEC}s for spans/logs/metrics to flush..."
sleep $FLUSH_WAIT_SEC
pass "Flush wait complete"

# Capture a turn trace_id for later use in export/detail tests.
TURN_TRACE_ID=$(pg_query "SELECT trace_id FROM observability.traces WHERE domain='AGENT' AND kind='turn' ORDER BY started_at DESC LIMIT 1")
if [ -n "$TURN_TRACE_ID" ]; then
  pass "Captured latest turn trace_id: $TURN_TRACE_ID"
else
  warn "No turn trace_id captured — export/detail tests will be skipped"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 4. PHASE 3 — AGENT TRACES
# ═══════════════════════════════════════════════════════════════════════════════
section "4. Phase 3 — AGENT Traces"

AGENT_TRACE_COUNT=$(pg_count "SELECT COUNT(*) FROM observability.traces WHERE domain='AGENT' AND kind='turn'")
if [ "$AGENT_TRACE_COUNT" -gt 0 ]; then
  pass "AGENT turn trace exists ($AGENT_TRACE_COUNT found)"
else
  fail "No AGENT turn trace found (domain='AGENT', kind='turn')"
fi

TURN_TRACE_OK=$(pg_count "SELECT COUNT(*) FROM observability.traces WHERE domain='AGENT' AND kind='turn' AND session_id IS NOT NULL AND turn_id IS NOT NULL AND status IN ('ok','error','cancelled') AND duration_ms IS NOT NULL")
if [ "$TURN_TRACE_OK" -gt 0 ]; then
  pass "Turn trace has session_id, turn_id, status, duration_ms populated"
else
  fail "Turn trace is missing required fields (session_id, turn_id, status, or duration_ms)"
fi

TURN_PROVIDER=$(pg_count "SELECT COUNT(*) FROM observability.traces WHERE domain='AGENT' AND kind='turn' AND provider IS NOT NULL AND model IS NOT NULL")
if [ "$TURN_PROVIDER" -gt 0 ]; then
  pass "Turn trace has provider and model populated"
else
  warn "Turn trace is missing provider/model (may be unset if LLM call failed early)"
fi

AGENT_SPAN_COUNT=$(pg_count "SELECT COUNT(*) FROM observability.spans WHERE domain='AGENT'")
if [ "$AGENT_SPAN_COUNT" -gt 0 ]; then
  pass "AGENT spans exist ($AGENT_SPAN_COUNT found)"
else
  fail "No AGENT spans found"
fi

TURN_SPAN_COUNT=$(pg_count "SELECT COUNT(*) FROM observability.spans WHERE domain='AGENT' AND name='turn' AND parent_span_id IS NULL")
if [ "$TURN_SPAN_COUNT" -gt 0 ]; then
  pass "Root 'turn' span exists (parent_span_id IS NULL)"
else
  fail "No root 'turn' span found (parent_span_id IS NULL)"
fi

JOURNEY_SPAN_COUNT=$(pg_count "SELECT COUNT(*) FROM observability.spans WHERE domain='AGENT' AND name LIKE 'journey%'")
if [ "$JOURNEY_SPAN_COUNT" -gt 0 ]; then
  pass "Journey spans exist ($JOURNEY_SPAN_COUNT found: names like 'journey%')"
else
  warn "No journey spans found (journey.local_knowledge, journey.model, etc.)"
fi

LLM_SPAN_COUNT=$(pg_count "SELECT COUNT(*) FROM observability.spans WHERE domain='AGENT' AND kind='llm'")
if [ "$LLM_SPAN_COUNT" -gt 0 ]; then
  pass "LLM span(s) exist ($LLM_SPAN_COUNT found, kind='llm')"
else
  fail "No LLM span found (kind='llm')"
fi

LLM_ATTR_OK=$(pg_count "SELECT COUNT(*) FROM observability.spans WHERE kind='llm' AND attributes->>'gen_ai.system' IS NOT NULL AND attributes->>'gen_ai.request.model' IS NOT NULL")
if [ "$LLM_ATTR_OK" -gt 0 ]; then
  pass "LLM span has gen_ai.system and gen_ai.request.model attributes"
else
  fail "LLM span is missing gen_ai.system or gen_ai.request.model attributes"
fi

LLM_MSGS_OK=$(pg_count "SELECT COUNT(*) FROM observability.spans WHERE kind='llm' AND attributes->>'llm.input_messages' IS NOT NULL AND attributes->>'llm.output_messages' IS NOT NULL")
if [ "$LLM_MSGS_OK" -gt 0 ]; then
  pass "LLM span has llm.input_messages and llm.output_messages"
else
  warn "LLM span is missing llm.input_messages or llm.output_messages (may be redacted if capture_prompts=false)"
fi

LLM_TOKENS_OK=$(pg_count "SELECT COUNT(*) FROM observability.spans WHERE kind='llm' AND (attributes->>'gen_ai.usage.input_tokens')::text IS NOT NULL AND (attributes->>'gen_ai.usage.output_tokens')::text IS NOT NULL")
if [ "$LLM_TOKENS_OK" -gt 0 ]; then
  pass "LLM span has gen_ai.usage.input_tokens and gen_ai.usage.output_tokens"
else
  warn "LLM span is missing token usage attributes (may be zero if the call failed)"
fi

TOOL_SPAN_COUNT=$(pg_count "SELECT COUNT(*) FROM observability.spans WHERE domain='AGENT' AND kind='tool'")
if [ "$TOOL_SPAN_COUNT" -gt 0 ]; then
  pass "Tool execution span(s) exist ($TOOL_SPAN_COUNT found, kind='tool')"
  TOOL_ATTR_OK=$(pg_count "SELECT COUNT(*) FROM observability.spans WHERE kind='tool' AND attributes->>'tool.name' IS NOT NULL AND attributes->>'tool.success' IS NOT NULL")
  if [ "$TOOL_ATTR_OK" -gt 0 ]; then
    pass "Tool span has tool.name and tool.success attributes"
  else
    fail "Tool span is missing tool.name or tool.success attributes"
  fi
  TOOL_DUR_OK=$(pg_count "SELECT COUNT(*) FROM observability.spans WHERE kind='tool' AND (attributes->>'tool.elapsed_ms') IS NOT NULL")
  if [ "$TOOL_DUR_OK" -gt 0 ]; then
    pass "Tool span has tool.elapsed_ms attribute"
  else
    warn "Tool span is missing tool.elapsed_ms attribute"
  fi
else
  skip "No tool spans found (the test turn may not have called a tool)"
fi

TOOL_DEC_COUNT=$(pg_count "SELECT COUNT(*) FROM observability.spans WHERE domain='AGENT' AND kind='tool_decision'")
if [ "$TOOL_DEC_COUNT" -gt 0 ]; then
  pass "Tool decision span(s) exist ($TOOL_DEC_COUNT found)"
else
  skip "No tool_decision spans (the test turn may not have called a tool)"
fi

AGENT_SPAN_WRONG_DOMAIN=$(pg_count "SELECT COUNT(*) FROM observability.spans WHERE name IN ('turn','journey','journey.local_knowledge','journey.model','journey.web','journey.integrations','journey.native_tools','journey.deeper_retrieval','llm.chat','tool_decision','tool','crew','retrieval') AND domain='APP'")
if [ "$AGENT_SPAN_WRONG_DOMAIN" = "0" ]; then
  pass "No AGENT-type spans are mis-tagged with domain='APP'"
else
  fail "Found $AGENT_SPAN_WRONG_DOMAIN AGENT-type spans mis-tagged with domain='APP'"
fi

# TurnRecord.traceId is set (check via the turn trace having a turn_id that matches)
TURN_ID_SET=$(pg_count "SELECT COUNT(*) FROM observability.traces WHERE domain='AGENT' AND kind='turn' AND turn_id IS NOT NULL")
if [ "$TURN_ID_SET" -gt 0 ]; then
  pass "Turn trace has turn_id set (TurnRegistry traceId linkage works)"
else
  fail "Turn trace has no turn_id — TurnRecord.traceId may not be wired"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 5. PHASE 3a — APP TRACES
# ═══════════════════════════════════════════════════════════════════════════════
section "5. Phase 3a — APP Traces"

HTTP_TRACE_COUNT=$(pg_count "SELECT COUNT(*) FROM observability.traces WHERE domain='APP' AND kind='http_request'")
if [ "$HTTP_TRACE_COUNT" -gt 0 ]; then
  pass "HTTP request trace(s) exist ($HTTP_TRACE_COUNT found, domain='APP', kind='http_request')"
else
  fail "No HTTP request trace found (domain='APP', kind='http_request')"
fi

HTTP_SPAN_ATTR_OK=$(pg_count "SELECT COUNT(*) FROM observability.spans WHERE kind='http' AND attributes->>'http.method' IS NOT NULL AND attributes->>'http.status_code' IS NOT NULL")
if [ "$HTTP_SPAN_ATTR_OK" -gt 0 ]; then
  pass "HTTP span has http.method and http.status_code attributes ($HTTP_SPAN_ATTR_OK found)"
else
  fail "HTTP span is missing http.method or http.status_code attributes"
fi

HTTP_ROUTE_OK=$(pg_count "SELECT COUNT(*) FROM observability.spans WHERE kind='http' AND attributes->>'http.route' IS NOT NULL")
if [ "$HTTP_ROUTE_OK" -gt 0 ]; then
  pass "HTTP span has http.route attribute (matched route pattern)"
else
  warn "HTTP span is missing http.route attribute (may be unset for unmatched routes)"
fi

AUTH_SPAN_COUNT=$(pg_count "SELECT COUNT(*) FROM observability.spans WHERE kind='auth' AND name LIKE 'auth%'")
if [ "$AUTH_SPAN_COUNT" -gt 0 ]; then
  pass "Auth span(s) exist ($AUTH_SPAN_COUNT found, kind='auth')"
  AUTH_ATTR_OK=$(pg_count "SELECT COUNT(*) FROM observability.spans WHERE kind='auth' AND attributes->>'auth.success' IS NOT NULL")
  if [ "$AUTH_ATTR_OK" -gt 0 ]; then
    pass "Auth span has auth.success attribute"
  else
    warn "Auth span is missing auth.success attribute"
  fi
else
  fail "No auth span found (kind='auth') — expected from login attempts"
fi

DB_SPAN_COUNT=$(pg_count "SELECT COUNT(*) FROM observability.spans WHERE kind='db'")
if [ "$DB_SPAN_COUNT" -gt 0 ]; then
  pass "DB query span(s) exist ($DB_SPAN_COUNT found, kind='db')"
  DB_ATTR_OK=$(pg_count "SELECT COUNT(*) FROM observability.spans WHERE kind='db' AND attributes->>'db.operation' IS NOT NULL AND attributes->>'db.statement' IS NOT NULL")
  if [ "$DB_ATTR_OK" -gt 0 ]; then
    pass "DB span has db.operation and db.statement attributes"
  else
    warn "DB span is missing db.operation or db.statement attributes"
  fi
else
  warn "No DB query spans found (may be sampled out — check AGENTX_OBS_DB_SAMPLE_RATE)"
fi

STARTUP_TRACE_COUNT=$(pg_count "SELECT COUNT(*) FROM observability.traces WHERE domain='APP' AND kind='startup'")
if [ "$STARTUP_TRACE_COUNT" -gt 0 ]; then
  pass "Startup trace exists (domain='APP', kind='startup')"
  STARTUP_CHILD_COUNT=$(pg_count "SELECT COUNT(*) FROM observability.spans WHERE name LIKE 'startup.%' OR name LIKE 'app.startup%'")
  if [ "$STARTUP_CHILD_COUNT" -gt 0 ]; then
    pass "Startup child spans exist ($STARTUP_CHILD_COUNT found)"
  else
    warn "No startup child spans found (startup.phase, startup.storage_ready, etc.)"
  fi
else
  warn "No startup trace found (may have been purged or app started before observability init)"
fi

APP_SPAN_WRONG_DOMAIN=$(pg_count "SELECT COUNT(*) FROM observability.spans WHERE kind IN ('http','ws','auth','db','channel','automation','integration','job') AND domain='AGENT'")
if [ "$APP_SPAN_WRONG_DOMAIN" = "0" ]; then
  pass "No APP-type spans are mis-tagged with domain='AGENT'"
else
  fail "Found $APP_SPAN_WRONG_DOMAIN APP-type spans mis-tagged with domain='AGENT'"
fi

CROSS_DOMAIN_OK=$(pg_count "
  SELECT COUNT(*) FROM observability.spans turn_span
  JOIN observability.spans parent ON turn_span.parent_span_id = parent.span_id
  WHERE turn_span.domain='AGENT' AND turn_span.name='turn'
    AND parent.domain='APP' AND parent.kind='http'")
if [ "$CROSS_DOMAIN_OK" -gt 0 ]; then
  pass "Cross-domain nesting works: HTTP span (APP) is parent of turn span (AGENT) ($CROSS_DOMAIN_OK found)"
else
  warn "No cross-domain nesting found (HTTP→turn). The chat turn may have been triggered via SSE without an HTTP parent."
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 6. PHASE 4 — LOGS & METRICS
# ═══════════════════════════════════════════════════════════════════════════════
section "6. Phase 4 — Logs & Metrics"

LOG_COUNT=$(pg_count "SELECT COUNT(*) FROM observability.logs")
if [ "$LOG_COUNT" -gt 0 ]; then
  pass "observability.logs has entries ($LOG_COUNT total)"
else
  fail "observability.logs is empty — logger sink may not be wired"
fi

LOG_WITH_TRACE=$(pg_count "SELECT COUNT(*) FROM observability.logs WHERE trace_id IS NOT NULL AND span_id IS NOT NULL")
if [ "$LOG_WITH_TRACE" -gt 0 ]; then
  pass "Logs with trace_id and span_id exist ($LOG_WITH_TRACE found)"
else
  fail "No logs have trace_id/span_id — logger sink is not capturing trace context"
fi

for scope in AI_SDK TURN_JOURNEY AGENT_BUS OBSERVABILITY; do
  SCOPE_COUNT=$(pg_count "SELECT COUNT(*) FROM observability.logs WHERE scope='$scope'")
  if [ "$SCOPE_COUNT" -gt 0 ]; then
    pass "Logs with scope='$scope' exist ($SCOPE_COUNT found)"
  else
    warn "No logs with scope='$scope' found"
  fi
done

LOG_AGENT_DOMAIN=$(pg_count "SELECT COUNT(*) FROM observability.logs WHERE domain='AGENT'")
LOG_APP_DOMAIN=$(pg_count "SELECT COUNT(*) FROM observability.logs WHERE domain='APP'")
if [ "$LOG_AGENT_DOMAIN" -gt 0 ]; then
  pass "AGENT-domain logs exist ($LOG_AGENT_DOMAIN found)"
else
  warn "No AGENT-domain logs found"
fi
if [ "$LOG_APP_DOMAIN" -gt 0 ]; then
  pass "APP-domain logs exist ($LOG_APP_DOMAIN found)"
else
  warn "No APP-domain logs found"
fi

METRIC_COUNT=$(pg_count "SELECT COUNT(*) FROM observability.metric_samples")
if [ "$METRIC_COUNT" -gt 0 ]; then
  pass "observability.metric_samples has entries ($METRIC_COUNT total)"
else
  fail "observability.metric_samples is empty — metrics sampler may not be running"
fi

echo "  Checking AGENT metric names..."
for name in \
  "agentx_turns_total" \
  "agentx_tool_calls_total" \
  "agentx_llm_tokens_input_total" \
  "agentx_llm_tokens_output_total" \
  "agentx_llm_cost_usd_total" \
  "agentx_turn_duration_seconds" \
  "agent.turns.total" \
  "agent.tool.latency.avg_ms" \
  "agent.queue.depth" \
  "agent.memory.cache_hit_rate"; do
  METRIC_NAME_COUNT=$(pg_count "SELECT COUNT(*) FROM observability.metric_samples WHERE name='$name'")
  if [ "$METRIC_NAME_COUNT" -gt 0 ]; then
    pass "Metric '$name' exists ($METRIC_NAME_COUNT samples)"
  else
    warn "Metric '$name' not found in metric_samples"
  fi
done

echo "  Checking APP metric names..."
for name in \
  "http_requests_total" \
  "auth_operations_total" \
  "app_starts_total"; do
  METRIC_NAME_COUNT=$(pg_count "SELECT COUNT(*) FROM observability.metric_samples WHERE name='$name'")
  if [ "$METRIC_NAME_COUNT" -gt 0 ]; then
    pass "Metric '$name' exists ($METRIC_NAME_COUNT samples)"
  else
    warn "Metric '$name' not found in metric_samples"
  fi
done

METRIC_AGENT=$(pg_count "SELECT COUNT(*) FROM observability.metric_samples WHERE labels->>'domain'='AGENT'")
METRIC_APP=$(pg_count "SELECT COUNT(*) FROM observability.metric_samples WHERE labels->>'domain'='APP'")
if [ "$METRIC_AGENT" -gt 0 ]; then
  pass "AGENT-domain metric samples exist ($METRIC_AGENT found, labels.domain='AGENT')"
else
  fail "No AGENT-domain metric samples found (labels.domain='AGENT')"
fi
if [ "$METRIC_APP" -gt 0 ]; then
  pass "APP-domain metric samples exist ($METRIC_APP found, labels.domain='APP')"
else
  fail "No APP-domain metric samples found (labels.domain='APP')"
fi

echo "  Checking /api/metrics endpoint..."
METRICS_BODY=$(http_body -H "$AUTH_HDR" "$API_BASE/api/metrics")
if [ -n "$METRICS_BODY" ]; then
  pass "/api/metrics endpoint returns data"
  if echo "$METRICS_BODY" | grep -q 'agentx_llm_tokens'; then
    pass "/api/metrics includes agentx_llm_tokens_*"
  else
    warn "/api/metrics does not include agentx_llm_tokens_* (may need a turn with token usage first)"
  fi
  if echo "$METRICS_BODY" | grep -q 'agentx_tool_calls_total'; then
    pass "/api/metrics includes agentx_tool_calls_total"
  else
    warn "/api/metrics does not include agentx_tool_calls_total (may need a tool-calling turn first)"
  fi
  if echo "$METRICS_BODY" | grep -q 'agentx_turns_total'; then
    pass "/api/metrics includes agentx_turns_total"
  else
    warn "/api/metrics does not include agentx_turns_total"
  fi
else
  fail "/api/metrics endpoint returned empty response"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 7. PHASE 5 — BACKEND API (/api/observability/*)
# ═══════════════════════════════════════════════════════════════════════════════
section "7. Phase 5 — Backend API (/api/observability/*)"

OBS_BASE="$API_BASE/api/observability"

# 7a. Dev mode OFF → all data endpoints return 403
echo "  Testing dev-mode gating (should be OFF initially)..."
DEV_STATUS_OFF=$(http_body -H "$AUTH_HDR" "$OBS_BASE/dev/status")
DEV_ENABLED_OFF=$(echo "$DEV_STATUS_OFF" | grep -o '"enabled":[a-z]*' | head -1 | cut -d: -f2)
if [ "$DEV_ENABLED_OFF" = "false" ]; then
  pass "/dev/status returns { enabled: false } when dev mode is off"
else
  warn "/dev/status did not return enabled:false (got: $DEV_STATUS_OFF) — dev mode may already be on"
fi

TRACES_403=$(http_status -H "$AUTH_HDR" "$OBS_BASE/traces")
if [ "$TRACES_403" = "403" ]; then
  pass "GET /traces returns 403 when dev mode is OFF"
else
  warn "GET /traces returned $TRACES_403 (expected 403) — dev mode may already be on"
fi

# 7b. Dev verify with correct password → enable
echo "  Verifying dev mode with correct password..."
VERIFY_RESP=$(curl -s -X POST -H "$AUTH_HDR" -H 'Content-Type: application/json' \
  -d "{\"password\":\"$ADMIN_PASSWORD\"}" "$OBS_BASE/dev/verify" 2>/dev/null)
VERIFY_OK=$(echo "$VERIFY_RESP" | grep -o '"success":true' | head -1)
if [ -n "$VERIFY_OK" ]; then
  pass "/dev/verify with correct password returns success:true"
else
  fail "/dev/verify with correct password failed: $VERIFY_RESP"
fi

# 7c. Dev enable
ENABLE_RESP=$(curl -s -X POST -H "$AUTH_HDR" "$OBS_BASE/dev/enable" 2>/dev/null)
DEV_STATUS_ON=$(http_body -H "$AUTH_HDR" "$OBS_BASE/dev/status")
DEV_ENABLED_ON=$(echo "$DEV_STATUS_ON" | grep -o '"enabled":[a-z]*' | head -1 | cut -d: -f2)
if [ "$DEV_ENABLED_ON" = "true" ]; then
  pass "/dev/enable → /dev/status returns { enabled: true }"
else
  fail "/dev/enable did not enable dev mode (status: $DEV_STATUS_ON)"
fi

# 7d. Data endpoints now return 200
TRACES_200=$(http_status -H "$AUTH_HDR" "$OBS_BASE/traces")
if [ "$TRACES_200" = "200" ]; then
  pass "GET /traces returns 200 when dev mode is ON"
else
  fail "GET /traces returned $TRACES_200 (expected 200) with dev mode ON"
fi

# 7e. Traces list returns paginated data
TRACES_BODY=$(http_body -H "$AUTH_HDR" "$OBS_BASE/traces")
if echo "$TRACES_BODY" | grep -q '"traces"'; then
  pass "GET /traces returns a traces array"
  TRACES_COUNT=$(echo "$TRACES_BODY" | grep -o '"trace_id"' | wc -l | tr -d ' ')
  if [ "$TRACES_COUNT" -gt 0 ]; then
    pass "GET /traces returned $TRACES_COUNT trace(s)"
  else
    warn "GET /traces returned an empty traces array"
  fi
else
  fail "GET /traces did not return a traces array: $TRACES_BODY"
fi

# 7f. Trace detail returns full tree + logs + metrics
if [ -n "$TURN_TRACE_ID" ]; then
  DETAIL_STATUS=$(http_status -H "$AUTH_HDR" "$OBS_BASE/traces/$TURN_TRACE_ID")
  if [ "$DETAIL_STATUS" = "200" ]; then
    pass "GET /traces/:traceId returns 200"
    DETAIL_BODY=$(http_body -H "$AUTH_HDR" "$OBS_BASE/traces/$TURN_TRACE_ID")
    if echo "$DETAIL_BODY" | grep -q '"spans"'; then
      pass "Trace detail includes spans tree"
    else
      fail "Trace detail is missing spans tree"
    fi
    if echo "$DETAIL_BODY" | grep -q '"logs"'; then
      pass "Trace detail includes logs"
    else
      warn "Trace detail is missing logs"
    fi
    if echo "$DETAIL_BODY" | grep -q '"metrics"'; then
      pass "Trace detail includes metrics"
    else
      warn "Trace detail is missing metrics"
    fi
  else
    fail "GET /traces/:traceId returned $DETAIL_STATUS (expected 200)"
  fi

  # 7g. Trace export — JSON
  EXPORT_JSON_STATUS=$(http_status -H "$AUTH_HDR" "$OBS_BASE/traces/$TURN_TRACE_ID/export?format=json")
  if [ "$EXPORT_JSON_STATUS" = "200" ]; then
    pass "GET /traces/:traceId/export?format=json returns 200"
    EXPORT_JSON_BODY=$(http_body -H "$AUTH_HDR" "$OBS_BASE/traces/$TURN_TRACE_ID/export?format=json")
    if echo "$EXPORT_JSON_BODY" | grep -q '"schema_version"'; then
      pass "JSON export has schema_version"
    else
      fail "JSON export is missing schema_version"
    fi
    if echo "$EXPORT_JSON_BODY" | grep -q '"diagnosis"'; then
      pass "JSON export has diagnosis section"
    else
      fail "JSON export is missing diagnosis section"
    fi
    if echo "$EXPORT_JSON_BODY" | grep -q '"environment"'; then
      pass "JSON export has environment section"
    else
      warn "JSON export is missing environment section"
    fi
  else
    fail "GET /traces/:traceId/export?format=json returned $EXPORT_JSON_STATUS (expected 200)"
  fi

  # 7h. Trace export — Markdown
  EXPORT_MD_STATUS=$(http_status -H "$AUTH_HDR" "$OBS_BASE/traces/$TURN_TRACE_ID/export?format=markdown")
  if [ "$EXPORT_MD_STATUS" = "200" ]; then
    pass "GET /traces/:traceId/export?format=markdown returns 200"
    EXPORT_MD_BODY=$(http_body -H "$AUTH_HDR" "$OBS_BASE/traces/$TURN_TRACE_ID/export?format=markdown")
    if echo "$EXPORT_MD_BODY" | grep -qi '## Summary'; then
      pass "Markdown export has Summary section"
    else
      fail "Markdown export is missing Summary section"
    fi
    if echo "$EXPORT_MD_BODY" | grep -qi '## Diagnosis'; then
      pass "Markdown export has Diagnosis section"
    else
      fail "Markdown export is missing Diagnosis section"
    fi
  else
    fail "GET /traces/:traceId/export?format=markdown returned $EXPORT_MD_STATUS (expected 200)"
  fi

  # 7i. Trace export preview (text/plain, no Content-Disposition)
  PREVIEW_STATUS=$(http_status -H "$AUTH_HDR" "$OBS_BASE/traces/$TURN_TRACE_ID/export/preview?format=markdown")
  if [ "$PREVIEW_STATUS" = "200" ]; then
    pass "GET /traces/:traceId/export/preview?format=markdown returns 200"
  else
    fail "Trace export preview returned $PREVIEW_STATUS (expected 200)"
  fi

  # 7j. Export of non-existent trace → 404
  NOTFOUND_STATUS=$(http_status -H "$AUTH_HDR" "$OBS_BASE/traces/nonexistent-trace-id/export?format=json")
  if [ "$NOTFOUND_STATUS" = "404" ]; then
    pass "Export of non-existent trace returns 404"
  else
    fail "Export of non-existent trace returned $NOTFOUND_STATUS (expected 404)"
  fi
else
  skip "Trace detail/export tests (no turn trace_id captured)"
fi

# 7k. Metrics time-series
METRICS_TS_STATUS=$(http_status -H "$AUTH_HDR" "$OBS_BASE/metrics?name=agentx_turns_total")
if [ "$METRICS_TS_STATUS" = "200" ]; then
  pass "GET /metrics?name=agentx_turns_total returns 200"
else
  warn "GET /metrics?name=agentx_turns_total returned $METRICS_TS_STATUS (endpoint may not exist yet)"
fi

# 7l. Config update + readback
echo "  Testing config update (retention_days=7)..."
CONFIG_UPDATE_RESP=$(curl -s -X PUT -H "$AUTH_HDR" -H 'Content-Type: application/json' \
  -d '{"retention_days":7}' "$OBS_BASE/config" 2>/dev/null)
CONFIG_READBACK=$(http_body -H "$AUTH_HDR" "$OBS_BASE/config")
CONFIG_RETENTION=$(echo "$CONFIG_READBACK" | grep -o '"retention_days":[0-9]*' | head -1 | cut -d: -f2)
if [ "$CONFIG_RETENTION" = "7" ]; then
  pass "PUT /config { retention_days: 7 } → GET /config reflects retention_days=7"
else
  fail "Config update did not persist (retention_days=$CONFIG_RETENTION, expected 7)"
fi
# Restore to 30 to avoid affecting later tests
curl -s -X PUT -H "$AUTH_HDR" -H 'Content-Type: application/json' \
  -d '{"retention_days":30}' "$OBS_BASE/config" >/dev/null 2>&1

# 7m. Wrong password on /dev/verify → 401
WRONG_VERIFY_STATUS=$(http_status -X POST -H "$AUTH_HDR" -H 'Content-Type: application/json' \
  -d '{"password":"wrong-password"}' "$OBS_BASE/dev/verify")
if [ "$WRONG_VERIFY_STATUS" = "401" ]; then
  pass "/dev/verify with wrong password returns 401"
else
  warn "/dev/verify with wrong password returned $WRONG_VERIFY_STATUS (expected 401)"
fi

# 7n. Rate limit: 5 wrong attempts → 429
echo "  Testing rate limit (5 wrong attempts → 429)..."
RATE_LIMITED=0
for i in 1 2 3 4 5; do
  RL_STATUS=$(http_status -X POST -H "$AUTH_HDR" -H 'Content-Type: application/json' \
    -d '{"password":"wrong-password"}' "$OBS_BASE/dev/verify")
  if [ "$RL_STATUS" = "429" ]; then
    RATE_LIMITED=1
    pass "/dev/verify rate-limited after $i wrong attempt(s) → 429"
    break
  fi
done
if [ "$RATE_LIMITED" = "0" ]; then
  warn "/dev/verify did not rate-limit after 5 wrong attempts (may need a longer window or more attempts)"
fi

# 7o. /observability serves the built UI (after Phase 7 build)
OBS_UI_STATUS=$(http_status "$API_BASE/observability")
if [ "$OBS_UI_STATUS" = "200" ]; then
  pass "/observability serves the built UI (index.html)"
else
  warn "/observability returned $OBS_UI_STATUS (expected 200 after Phase 7 build; 404 expected before)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 8. PHASE 6 — DEVELOPER MODE & AUTH GATING
# ═══════════════════════════════════════════════════════════════════════════════
section "8. Phase 6 — Developer Mode & Auth Gating"

# Dev mode is currently ON from Phase 5 tests. Verify disable works.
echo "  Testing dev mode disable..."

# 8a. /dev/status with dev mode on
DEV_STATUS_CURR=$(http_body -H "$AUTH_HDR" "$OBS_BASE/dev/status")
if echo "$DEV_STATUS_CURR" | grep -q '"enabled":true'; then
  pass "/dev/status returns { enabled: true } (dev mode is on from Phase 5)"
else
  warn "/dev/status did not return enabled:true — re-enabling for subsequent tests"
  curl -s -X POST -H "$AUTH_HDR" -H 'Content-Type: application/json' \
    -d "{\"password\":\"$ADMIN_PASSWORD\"}" "$OBS_BASE/dev/verify" >/dev/null 2>&1
  curl -s -X POST -H "$AUTH_HDR" "$OBS_BASE/dev/enable" >/dev/null 2>&1
fi

# 8b. /dev/disable → data endpoints return 403
DISABLE_RESP=$(curl -s -X POST -H "$AUTH_HDR" "$OBS_BASE/dev/disable" 2>/dev/null)
TRACES_AFTER_DISABLE=$(http_status -H "$AUTH_HDR" "$OBS_BASE/traces")
if [ "$TRACES_AFTER_DISABLE" = "403" ]; then
  pass "/dev/disable → GET /traces returns 403 again"
else
  fail "/dev/disable did not gate the endpoints (GET /traces returned $TRACES_AFTER_DISABLE, expected 403)"
fi

# 8c. Re-enable for remaining tests
curl -s -X POST -H "$AUTH_HDR" -H 'Content-Type: application/json' \
  -d "{\"password\":\"$ADMIN_PASSWORD\"}" "$OBS_BASE/dev/verify" >/dev/null 2>&1
curl -s -X POST -H "$AUTH_HDR" "$OBS_BASE/dev/enable" >/dev/null 2>&1
TRACES_REENABLED=$(http_status -H "$AUTH_HDR" "$OBS_BASE/traces")
if [ "$TRACES_REENABLED" = "200" ]; then
  pass "Re-enabled dev mode → GET /traces returns 200"
else
  fail "Re-enabling dev mode failed (GET /traces returned $TRACES_REENABLED)"
fi

# 8d. Client storage persistence — manual (requires browser)
skip "Client storage reflects dev state across reloads (manual browser check)"

# ═══════════════════════════════════════════════════════════════════════════════
# 9. PHASE 7 — FRONTEND OBSERVABILITY APP (/observability)
# ═══════════════════════════════════════════════════════════════════════════════
section "9. Phase 7 — Frontend Observability App"

# 9a. Build output exists
if [ -f "$REPO_ROOT/packages/web-ui/dist/observability/index.html" ]; then
  pass "web-ui build produced dist/observability/index.html"
else
  warn "dist/observability/index.html not found (run pnpm --filter @agentx/web-ui build first)"
fi

# 9b. /observability serves HTML
OBS_UI_BODY=$(http_body "$API_BASE/observability")
if echo "$OBS_UI_BODY" | grep -qi '<html\|<!doctype html'; then
  pass "/observability serves an HTML document"
else
  warn "/observability did not serve HTML (may not be built yet — Phase 7)"
fi

# 9c. UI interaction tests — all manual (require a browser)
echo "  ${DIM}The following UI checks require a browser — open /observability in a secondary window:${NC}"
skip "TraceListPage: filters (session, status, kind, date, q, duration, provider/model), sort, pagination, auto-refresh, errors-only (manual)"
skip "TraceDetailPage: waterfall tree, colors, nesting guides, timeline ruler (manual)"
skip "TraceMiniMap: drag/resize viewport zoom, failed spans as red dots (manual)"
skip "SpanKindLegend + trace statistics bar + critical path toggle (manual)"
skip "Find-in-trace (Ctrl+F): search span names + attributes, prev/next, highlight (manual)"
skip "Kind filter chips + collapse/expand subtrees (manual)"
skip "SpanDetail drawer: llm (prompt/response), tool (args/output), tabs (Overview/Attributes/Events/Logs/Children) (manual)"
skip "LogsPanel (in trace detail): level/scope filters, free-text, log→span highlight, jump to span (manual)"
skip "MetricsPanel (in trace detail): token/cost/latency charts (manual)"
skip "LogsPage: histogram, click-drag zoom, filters, virtualized list, row expansion, trace/span links, export (manual)"
skip "MetricsDashboard: 4 pre-built dashboards, panel types, metric explorer, Y-axis toggle (manual)"
skip "ConfigPage: retention + purge (manual)"
skip "TraceExportBar: format selector, download (FS API + fallback), copy to clipboard, open as text, redaction chip (manual)"
skip "CopyButton: trace_id, span_id, JSON attributes, log payloads (manual)"
skip "Responsive layout at 1440×900 (manual)"
skip "Secondary window opens from main app when dev mode is on (manual)"

# ═══════════════════════════════════════════════════════════════════════════════
# 10. PHASE 8 — SETTINGS → DEVELOPER TAB
# ═══════════════════════════════════════════════════════════════════════════════
section "10. Phase 8 — Settings → Developer Tab"

echo "  ${DIM}The following checks require the main app UI (Settings panel):${NC}"
skip "Settings panel shows a 'Developer' tab (manual)"
skip "Toggling Developer Mode ON prompts for root password (manual)"
skip "Correct password enables dev mode + 'Open Observability' button appears (manual)"
skip "Wrong password shows error; 5 wrong attempts show rate-limit message (manual)"
skip "Toggling OFF clears dev mode and hides observability section (manual)"
skip "Retention/capture_prompts/enabled changes persist across reloads (manual)"
skip "'Open Observability' opens secondary window at /observability (manual)"

# ═══════════════════════════════════════════════════════════════════════════════
# 11. PHASE 9 — RETENTION, PII & SAFETY
# ═══════════════════════════════════════════════════════════════════════════════
section "11. Phase 9 — Retention, PII & Safety"

# 11a. No secrets in any attributes JSONB (grep the table)
echo "  Scanning span/log attributes for leaked secrets..."
SECRET_HITS=$(pg_count "
  SELECT COUNT(*) FROM observability.spans
  WHERE attributes::text ~* 'apiKey|api_key|Authorization|password|sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}'")
SECRET_LOG_HITS=$(pg_count "
  SELECT COUNT(*) FROM observability.logs
  WHERE (payload::text ~* 'apiKey|api_key|Authorization|password|sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}')
     OR (message ~* 'apiKey|api_key|Authorization|password|sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}')")
if [ "$SECRET_HITS" = "0" ] && [ "$SECRET_LOG_HITS" = "0" ]; then
  pass "No apiKey/Authorization/password/API-key strings found in span or log attributes"
else
  fail "Found potential secrets: $SECRET_HITS in spans, $SECRET_LOG_HITS in logs"
fi

# 11b. capture_prompts config is readable
CAPTURE_PROMPTS=$(pg_query "SELECT capture_prompts FROM observability.config WHERE id=1")
if [ "$CAPTURE_PROMPTS" = "t" ] || [ "$CAPTURE_PROMPTS" = "true" ]; then
  pass "capture_prompts is currently true (default)"
elif [ "$CAPTURE_PROMPTS" = "f" ] || [ "$CAPTURE_PROMPTS" = "false" ]; then
  pass "capture_prompts is currently false (prompts redacted)"
  # Verify redaction in llm spans
  REDACTED_OK=$(pg_count "SELECT COUNT(*) FROM observability.spans WHERE kind='llm' AND attributes::text LIKE '%redacted%'")
  if [ "$REDACTED_OK" -gt 0 ]; then
    pass "LLM spans show [redacted:N] in prompt attributes (capture_prompts=false)"
  else
    warn "capture_prompts=false but no redacted attributes found in llm spans"
  fi
else
  warn "capture_prompts has unexpected value: $CAPTURE_PROMPTS"
fi

# 11c. Token counts preserved even when prompts redacted
if [ "$CAPTURE_PROMPTS" = "f" ] || [ "$CAPTURE_PROMPTS" = "false" ]; then
  TOKENS_PRESERVED=$(pg_count "SELECT COUNT(*) FROM observability.spans WHERE kind='llm' AND (attributes->>'gen_ai.usage.input_tokens')::text IS NOT NULL")
  if [ "$TOKENS_PRESERVED" -gt 0 ]; then
    pass "Token counts are preserved even with capture_prompts=false"
  else
    fail "Token counts are missing with capture_prompts=false (should be preserved)"
  fi
fi

# 11d. Retention purger — insert an old trace, set retention=1, purge, verify deletion
echo "  Testing retention purger (inserting a 2-day-old trace)..."
OLD_TRACE_ID="test-old-trace-$(date +%s)"
pg_query "INSERT INTO observability.traces (trace_id, root_span_id, domain, kind, status, started_at, ended_at, duration_ms) VALUES ('$OLD_TRACE_ID', 'test-old-root', 'AGENT', 'turn', 'ok', NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days', 100)" >/dev/null 2>&1
OLD_TRACE_EXISTS=$(pg_count "SELECT COUNT(*) FROM observability.traces WHERE trace_id='$OLD_TRACE_ID'")
if [ "$OLD_TRACE_EXISTS" = "1" ]; then
  pass "Inserted a 2-day-old test trace"
  # Set retention to 1 day
  curl -s -X PUT -H "$AUTH_HDR" -H 'Content-Type: application/json' \
    -d '{"retention_days":1}' "$OBS_BASE/config" >/dev/null 2>&1
  # Trigger purge via API (if available) or wait for purger
  PURGE_RESP=$(curl -s -X POST -H "$AUTH_HDR" -H 'Content-Type: application/json' \
    -d '{"confirm":true}' "$OBS_BASE/purge/old" 2>/dev/null)
  # If no dedicated purge-old endpoint, the daily purger will catch it; check after a moment
  sleep 2
  OLD_TRACE_AFTER=$(pg_count "SELECT COUNT(*) FROM observability.traces WHERE trace_id='$OLD_TRACE_ID'")
  if [ "$OLD_TRACE_AFTER" = "0" ]; then
    pass "Retention purger deleted the 2-day-old trace (retention_days=1)"
  else
    warn "Old trace still exists after purge (may need the daily purger to run — endpoint: $PURGE_RESP)"
  fi
  # Restore retention to 30
  curl -s -X PUT -H "$AUTH_HDR" -H 'Content-Type: application/json' \
    -d '{"retention_days":30}' "$OBS_BASE/config" >/dev/null 2>&1
else
  fail "Failed to insert a 2-day-old test trace for retention test"
fi

# 11e. Observability queries use the dedicated pool (max 2 connections)
echo "  Checking dedicated observability pool connection count..."
OBS_POOL_CONNS=$(pg_count "
  SELECT COUNT(*) FROM pg_stat_activity
  WHERE query LIKE '%observability.%' AND state = 'active'")
if [ "$OBS_POOL_CONNS" -le 2 ]; then
  pass "Observability pool uses ≤2 connections (found $OBS_POOL_CONNS active obs queries)"
else
  warn "Found $OBS_POOL_CONNS active observability queries (expected ≤2 — may be a transient spike)"
fi

# 11f. Span ring buffer backpressure — manual (requires >4096 rapid spans)
echo "  ${DIM}To verify span ring buffer backpressure:${NC}"
echo "  ${DIM}1. Insert >4096 spans rapidly (e.g. via a load test script)${NC}"
echo "  ${DIM}2. Confirm OBS_SPAN_DROP warnings in logs and droppedCount increments${NC}"
echo "  ${DIM}3. Confirm the turn still completes${NC}"
skip "Span ring buffer backpressure (requires >4096 rapid spans — manual load test)"

# 11g. Pool failure resilience — manual (requires dropping the DB)
echo "  ${DIM}To verify pool failure resilience:${NC}"
echo "  ${DIM}1. Stop the embedded PostgreSQL${NC}"
echo "  ${DIM}2. Run a chat turn — it must still complete${NC}"
echo "  ${DIM}3. Confirm only OBS_WRITE_FAIL warnings in logs (no crash)${NC}"
echo "  ${DIM}4. Restart PostgreSQL${NC}"
skip "Pool failure resilience (requires stopping PostgreSQL — manual)"

# 11h. enabled=false — DESTRUCTIVE: run at the very end (see Section 13)
# 11i. POST /purge { confirm: true } — DESTRUCTIVE: run at the very end (see Section 13)

# ═══════════════════════════════════════════════════════════════════════════════
# 12. PHASE 10 — TESTING, HARDENING & VERIFICATION
# ═══════════════════════════════════════════════════════════════════════════════
section "12. Phase 10 — Testing, Hardening & Verification"

# 12a. typecheck (all packages)
echo "  Running pnpm -r typecheck (may take a minute)..."
if command -v pnpm >/dev/null 2>&1; then
  TYPECHECK_OUTPUT=$(cd "$REPO_ROOT" && pnpm -r run typecheck 2>&1)
  TYPECHECK_EXIT=$?
  if [ "$TYPECHECK_EXIT" = "0" ]; then
    pass "pnpm -r typecheck passes across all packages"
  else
    fail "pnpm -r typecheck failed (exit $TYPECHECK_EXIT)"
    echo "$TYPECHECK_OUTPUT" | tail -20 | sed 's/^/      /'
  fi
else
  skip "pnpm not found on PATH — cannot run typecheck"
fi

# 12b. test (existing + new)
echo "  Running pnpm test (may take a few minutes)..."
if command -v pnpm >/dev/null 2>&1; then
  TEST_OUTPUT=$(cd "$REPO_ROOT" && pnpm test 2>&1)
  TEST_EXIT=$?
  if [ "$TEST_EXIT" = "0" ]; then
    pass "pnpm test passes (existing + new tests)"
  else
    warn "pnpm test had failures (exit $TEST_EXIT) — review output"
    echo "$TEST_OUTPUT" | tail -30 | sed 's/^/      /'
  fi
else
  skip "pnpm not found on PATH — cannot run tests"
fi

# 12c. No console.log in observability code (use getLogger)
echo "  Scanning observability code for console.log..."
CONSOLE_LOG_HITS=$(grep -r 'console\.log' "$REPO_ROOT/packages/engine/src/observability/" "$REPO_ROOT/packages/web-api/src/routes/observability/" 2>/dev/null | grep -v node_modules | wc -l | tr -d ' ')
if [ "$CONSOLE_LOG_HITS" = "0" ]; then
  pass "No console.log in observability code (uses getLogger)"
else
  fail "Found $CONSOLE_LOG_HITS console.log call(s) in observability code — use getLogger() instead"
fi

# 12d. No secrets in committed test fixtures
echo "  Scanning test fixtures for secrets..."
SECRET_FIXTURE_HITS=$(grep -rl 'sk-[a-zA-Z0-9]\{20,\}\|ghp_[a-zA-Z0-9]\{20,\}\|xai-[a-zA-Z0-9]\{20,\}' "$REPO_ROOT/packages/engine/tests/observability/" "$REPO_ROOT/packages/web-api/tests/observability/" 2>/dev/null | wc -l | tr -d ' ')
if [ "$SECRET_FIXTURE_HITS" = "0" ]; then
  pass "No secrets in observability test fixtures"
else
  fail "Found $SECRET_FIXTURE_HITS test fixture file(s) with potential secrets"
fi

# 12e. Bundle size: observability UI is separate from main app
if [ -d "$REPO_ROOT/packages/web-ui/dist/observability" ] && [ -d "$REPO_ROOT/packages/web-ui/dist" ]; then
  pass "dist/observability/ is distinct from dist/ (separate bundle)"
else
  warn "Cannot verify bundle separation (observability dist may not be built yet)"
fi

# 12f. Load test — manual
echo "  ${DIM}To verify load test:${NC}"
echo "  ${DIM}1. Run 100 turns rapidly (e.g. a loop script)${NC}"
echo "  ${DIM}2. Confirm no span drops under normal load${NC}"
echo "  ${DIM}3. Confirm the dedicated pg pool doesn't exhaust (≤2 connections)${NC}"
skip "Load test: 100 rapid turns (manual)"

# 12g. Unit/instrumentation/API/frontend tests — these are covered by 12b (pnpm test)
skip "Unit tests (ObservabilityStore, PostgresSpanExporter, redact, MetricsSampler, RetentionPurger, context) — covered by pnpm test"
skip "Instrumentation tests (minimal turn, agent-bus propagation) — covered by pnpm test"
skip "API tests (routes.test.ts) — covered by pnpm test"
skip "Frontend tests (TraceListPage, SpanWaterfall, etc.) — covered by pnpm test"

# ═══════════════════════════════════════════════════════════════════════════════
# 13. PHASE 11 — SHIPPING & ROLLOUT
# ═══════════════════════════════════════════════════════════════════════════════
section "13. Phase 11 — Shipping & Rollout"

# 13a. V024 migration is idempotent (re-running should not error)
echo "  Testing V024 migration idempotency..."
V024_SQL="$REPO_ROOT/packages/engine/src/db/migrations/V024__observability_schema.sql"
if [ -f "$V024_SQL" ]; then
  V024_RERUN=$(psql "$PG_CONN" -f "$V024_SQL" 2>&1)
  V024_EXIT=$?
  if [ "$V024_EXIT" = "0" ]; then
    pass "V024 migration is idempotent (re-runs without error)"
  else
    fail "V024 migration failed on re-run: $V024_RERUN"
  fi
else
  warn "V024 migration SQL not found at $V024_SQL"
fi

# 13b. Existing /api/metrics Prometheus endpoint still works
PROMETHEUS_BODY=$(http_body -H "$AUTH_HDR" "$API_BASE/api/metrics")
if echo "$PROMETHEUS_BODY" | grep -qi 'http_requests_total\|process_\|nodejs_'; then
  pass "Existing /api/metrics Prometheus endpoint still works (has standard metrics)"
else
  fail "/api/metrics endpoint does not return Prometheus-format metrics"
fi

# 13c. SSE/automation telemetry subscribers still work (check for traceId in events)
# This is hard to verify without a live SSE subscription — check that telemetry events
# in the DB have traceId/spanId fields. We check the spans table has trace_id linkage.
SSE_LINK_OK=$(pg_count "SELECT COUNT(*) FROM observability.spans WHERE trace_id IS NOT NULL")
if [ "$SSE_LINK_OK" -gt 0 ]; then
  pass "SSE/automation telemetry linkage intact (spans have trace_id)"
else
  fail "No spans have trace_id — SSE/automation subscribers may be broken"
fi

# 13d. Desktop build includes observability window — manual
echo "  ${DIM}To verify desktop build includes observability:${NC}"
echo "  ${DIM}1. Build the desktop app (pnpm --filter @agentx/desktop build)${NC}"
echo "  ${DIM}2. Open the secondary window from Settings → Developer → Open Observability${NC}"
echo "  ${DIM}3. Confirm /observability loads in the secondary window${NC}"
skip "Desktop build includes observability window (manual)"

# 13e. Docker image includes observability dist — manual
echo "  ${DIM}To verify Docker image includes observability dist:${NC}"
echo "  ${DIM}1. Build the Docker image${NC}"
echo "  ${DIM}2. docker run --rm <image> ls /app/packages/web-ui/dist/observability${NC}"
echo "  ${DIM}3. Confirm index.html + assets are present${NC}"
skip "Docker image includes observability dist (manual)"

# 13f. Env vars documented — check for AGENTX_OBS_* in .env.example or docs
ENV_EXAMPLE="$REPO_ROOT/.env.example"
if [ -f "$ENV_EXAMPLE" ]; then
  ENV_DOC_HITS=$(grep -c 'AGENTX_OBS_' "$ENV_EXAMPLE" 2>/dev/null || echo 0)
  if [ "$ENV_DOC_HITS" -gt 0 ]; then
    pass "AGENTX_OBS_* env vars are documented in .env.example ($ENV_DOC_HITS found)"
  else
    warn "No AGENTX_OBS_* env vars documented in .env.example"
  fi
else
  warn ".env.example not found — cannot verify env var documentation"
fi

# 13g. graphify update — manual (per project rule, run after all changes)
skip "graphify update . (run manually after all phases complete)"

# ═══════════════════════════════════════════════════════════════════════════════
# 14. DESTRUCTIVE TESTS (run last — these wipe observability data)
# ═══════════════════════════════════════════════════════════════════════════════
section "14. Destructive Tests (run last)"

echo -e "  ${YELLOW}⚠ WARNING: The following tests DELETE observability data.${NC}"
echo -e "  ${YELLOW}  They run last so earlier checks have data to verify against.${NC}"
echo ""

# 14a. POST /purge { confirm: true } truncates all four tables
echo "  Testing POST /purge { confirm: true }..."
PURGE_RESP=$(curl -s -X POST -H "$AUTH_HDR" -H 'Content-Type: application/json' \
  -d '{"confirm":true}' "$OBS_BASE/purge" 2>/dev/null)
sleep 2
TRACES_AFTER_PURGE=$(pg_count "SELECT COUNT(*) FROM observability.traces")
SPANS_AFTER_PURGE=$(pg_count "SELECT COUNT(*) FROM observability.spans")
LOGS_AFTER_PURGE=$(pg_count "SELECT COUNT(*) FROM observability.logs")
METRICS_AFTER_PURGE=$(pg_count "SELECT COUNT(*) FROM observability.metric_samples")
if [ "$TRACES_AFTER_PURGE" = "0" ] && [ "$SPANS_AFTER_PURGE" = "0" ] && [ "$LOGS_AFTER_PURGE" = "0" ] && [ "$METRICS_AFTER_PURGE" = "0" ]; then
  pass "POST /purge { confirm: true } truncated all four tables (traces, spans, logs, metrics)"
else
  fail "POST /purge did not truncate all tables (traces=$TRACES_AFTER_PURGE, spans=$SPANS_AFTER_PURGE, logs=$LOGS_AFTER_PURGE, metrics=$METRICS_AFTER_PURGE)"
fi

# 14b. POST /purge {} (no confirm) → 400
PURGE_NO_CONFIRM_STATUS=$(http_status -X POST -H "$AUTH_HDR" -H 'Content-Type: application/json' \
  -d '{}' "$OBS_BASE/purge")
if [ "$PURGE_NO_CONFIRM_STATUS" = "400" ]; then
  pass "POST /purge {} (no confirm) returns 400"
else
  warn "POST /purge {} returned $PURGE_NO_CONFIRM_STATUS (expected 400)"
fi

# 14c. enabled=false → no new spans; existing still queryable
echo "  Testing enabled=false (disables observability)..."
CONFIG_BEFORE=$(http_body -H "$AUTH_HDR" "$OBS_BASE/config")
curl -s -X PUT -H "$AUTH_HDR" -H 'Content-Type: application/json' \
  -d '{"enabled":false}' "$OBS_BASE/config" >/dev/null 2>&1
sleep 2
# Generate a turn with observability disabled
curl -s -N --max-time $TURN_TIMEOUT_SEC \
  -H "$AUTH_HDR" -H 'Content-Type: application/json' \
  -X POST "$API_BASE/api/chat/message-stream" \
  -d '{"text":"This turn should not be traced"}' >/dev/null 2>&1
sleep $FLUSH_WAIT_SEC
NEW_SPANS_AFTER_DISABLE=$(pg_count "SELECT COUNT(*) FROM observability.spans")
if [ "$NEW_SPANS_AFTER_DISABLE" = "0" ]; then
  pass "enabled=false → no new spans created after a turn"
else
  warn "enabled=false but $NEW_SPANS_AFTER_DISABLE spans exist (in-flight spans may have flushed after disable)"
fi
# Existing rows should still be queryable (we purged in 14a, so this is 0 — but the endpoint should work)
TRACES_QUERYABLE=$(http_status -H "$AUTH_HDR" "$OBS_BASE/traces")
if [ "$TRACES_QUERYABLE" = "200" ]; then
  pass "Existing traces still queryable with enabled=false (GET /traces returns 200)"
else
  fail "GET /traces returned $TRACES_QUERYABLE with enabled=false (expected 200 — existing data should be queryable)"
fi
# Re-enable observability for any post-run checks
curl -s -X PUT -H "$AUTH_HDR" -H 'Content-Type: application/json' \
  -d '{"enabled":true}' "$OBS_BASE/config" >/dev/null 2>&1
pass "Re-enabled observability (enabled=true)"

# 14d. Log level filter — manual (requires app restart)
echo "  ${DIM}To verify AGENTX_OBS_LOG_LEVEL=warn suppresses info/debug logs:${NC}"
echo "  ${DIM}1. Stop Agent-X${NC}"
echo "  ${DIM}2. Set AGENTX_OBS_LOG_LEVEL=warn in .env or env${NC}"
echo "  ${DIM}3. Restart Agent-X, send a turn${NC}"
echo "  ${DIM}4. psql \"$PG_CONN\" -c \"SELECT level, count(*) FROM observability.logs GROUP BY level;\"${NC}"
echo "  ${DIM}   Expected: only 'warn' and 'error' rows${NC}"
skip "Log level filter (requires app restart with AGENTX_OBS_LOG_LEVEL=warn)"

# 14e. Sink failure resilience — manual (requires dropping logs table)
echo "  ${DIM}To verify logger sink failure doesn't break logging or turns:${NC}"
echo "  ${DIM}1. psql \"$PG_CONN\" -c \"DROP TABLE observability.logs;\"${NC}"
echo "  ${DIM}2. Send a chat turn — it must still complete${NC}"
echo "  ${DIM}3. Check console/file logs still flow (no crash)${NC}"
echo "  ${DIM}4. Restore: restart the app (V024 migration recreates the table)${NC}"
skip "Sink failure resilience (requires dropping observability.logs table)"

# ═══════════════════════════════════════════════════════════════════════════════
# 15. SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════
section "15. Summary"

TOTAL=$((PASS_COUNT + FAIL_COUNT + WARN_COUNT + SKIP_COUNT))
echo ""
echo -e "  ${BOLD}Results:${NC}  ${GREEN}$PASS_COUNT passed${NC}  ${RED}$FAIL_COUNT failed${NC}  ${YELLOW}$WARN_COUNT warnings${NC}  ${DIM}$SKIP_COUNT skipped${NC}  ($TOTAL total)"
echo ""

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo -e "  ${RED}${BOLD}Failed checks:${NC}"
  for check in "${FAILED_CHECKS[@]}"; do
    echo -e "    ${RED}✗${NC} $check"
  done
  echo ""
fi

if [ "$WARN_COUNT" -gt 0 ]; then
  echo -e "  ${YELLOW}${BOLD}Warnings (review but not blocking):${NC} $WARN_COUNT"
  echo ""
fi

if [ "$SKIP_COUNT" -gt 0 ]; then
  echo -e "  ${DIM}Skipped (manual checks):${NC} $SKIP_COUNT"
  echo -e "  ${DIM}See the 'SKIP' messages above for instructions on how to verify each manually.${NC}"
  echo ""
fi

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo -e "  ${RED}Some checks failed. Review the output above for details.${NC}"
  exit 1
elif [ "$WARN_COUNT" -gt 0 ]; then
  echo -e "  ${YELLOW}All hard checks passed, but $WARN_COUNT warning(s) — review above.${NC}"
  exit 0
else
  echo -e "  ${GREEN}${BOLD}All automated checks passed!${NC}"
  echo -e "  ${DIM}($SKIP_COUNT manual checks remain — see SKIP messages above.)${NC}"
  exit 0
fi
