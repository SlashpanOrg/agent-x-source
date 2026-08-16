---
name: login-and-debug
description: >-
  Start debugging against the live local Agent-X app. Login only — then inspect
  whatever the current task needs. Use when the user asks to debug a session,
  stored data, the live UI, or any other running-app data.
---

# Login and debug

Do not spawn a second Agent-X. The live app is `/Applications/Agent-X.app` at `http://127.0.0.1:3333`. If that port is down, report it — do not start a new process.

## Start

| Field | Value |
|-------|--------|
| Username | `root` |
| Password | `Test@123` |
| Base URL | `http://127.0.0.1:3333` |

1. Confirm the app is up:

```bash
curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:3333/api/health
```

2. Login and keep the token:

```bash
TOKEN=$(curl -sS -X POST http://127.0.0.1:3333/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"root","password":"Test@123"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')
```

Use `Authorization: Bearer $TOKEN` on later API calls. Cookie `agentx_session` is set if you keep `-c` / `-b` jar files. For a visual bug, open the live UI and login with the same credentials.

Then inspect the thing the user asked about. Do not commit unless asked. Do not start Agent-X.
