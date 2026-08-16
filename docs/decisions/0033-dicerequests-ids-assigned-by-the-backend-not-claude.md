---
id: ADR-0033
title: "`diceRequests` IDs assigned by the backend, not Claude"
area: claude-tool-schemas-state
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

An earlier design had Claude generate UUIDs for dice request entries. Claude doesn't generate UUIDs reliably. The backend assigns IDs after receiving `submit_gm_response` and returns them in the action response. Claude omits the ID field entirely.
