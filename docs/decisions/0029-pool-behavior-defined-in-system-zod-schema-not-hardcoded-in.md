---
id: ADR-0029
title: Pool behavior defined in system Zod schema, not hardcoded in validator
area: claude-tool-schemas-state
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

Each pool definition in the system Zod schema carries `min`, `max`, and `thresholds` metadata. The validator reads this rather than hardcoding HP-specific or system-specific logic. A pool with `min: null` can go negative; `min: 0` is floored at zero. This keeps the validator generic and system-agnostic.
