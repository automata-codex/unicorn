---
id: ADR-0061
title: Oracle filtering data model includes count fields despite range UI being deferred
area: oracle-tables
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

Each oracle category preference record stores `count_min` and `count_max` fields (defaulting to `1/1`) even though the range dial UI is not built in Phase 1. The activate/deactivate pool and the pick-count concept are cleanly separable — the pool model is identical regardless of how many entries are drawn. Adding the fields now avoids a schema migration when variable counts are introduced. The UI commitment is deferred until there is a concrete scenario requiring it (likely Phase 2).
