---
id: ADR-0024
title: Tool use over prompt instructions for structured output
area: claude-tool-schemas-state
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

Claude is required to call `submit_gm_response` and `submit_gm_context` rather than producing structured JSON in plain text. Tool use enforces the schema at the API level and eliminates a whole category of malformed response runtime errors. Prompt instructions alone are not sufficient for this guarantee.
