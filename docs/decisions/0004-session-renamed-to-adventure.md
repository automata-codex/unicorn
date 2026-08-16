---
id: ADR-0004
title: "`session` renamed to `adventure`"
area: architecture-backend
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

The domain concept is an adventure, not a session. Sessions in the traditional sense are a social scheduling artifact that dissolves in solo async play. Adventures are the first-class domain concept — they own the GM context, messages, and game events. The table is named `adventure` rather than `session` throughout.
