---
name: Tool Request
about: Suggest a new tool for Agent-X's tool library
title: '[Tool] '
labels: tool
assignees: ''
---

**Tool name**
What should the tool be called? (e.g. `file_compress`, `db_backup`)

**Category**
Which category does it belong to? (e.g. filesystem, database, web_network, code_intelligence)

**Description**
What should this tool do? Describe its behavior and use case.

**Proposed schema**
What parameters should the tool accept? (JSON Schema format preferred)

```json
{
  "type": "object",
  "properties": {
    "example_param": { "type": "string", "description": "..." }
  },
  "required": ["example_param"]
}
```

**Expected output**
What should the tool return on success/failure?

**Why is this tool valuable?**
How does it help the AI agent or end user?

**Additional context**
Add any other context or references here.
