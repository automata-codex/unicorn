---
id: ADR-0062
title: "Oracle filtering UI: activate/deactivate only, no range controls in Phase 1"
area: oracle-tables
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

The oracle filtering UI exposes entry-level activation toggles, select all/deselect all per category, and a submission gate requiring at least one active entry per category. Range dial controls are out of scope for Phase 1. The data model supports variable counts from day one, but the UI will default to picking exactly one entry per category until range controls are designed and built. This keeps the MVP UI simple and avoids designing a UX pattern before there is a concrete use case to design against.
