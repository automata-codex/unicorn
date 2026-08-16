---
id: ADR-0003
title: No circular FK between `adventure` and `gm_context`
area: architecture-backend
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

An earlier design put `gm_context_id` on `adventure` as well as `adventure_id` on `gm_context`, creating a circular FK that required a nullable column and a three-step insert (adventure → gm_context → update adventure). Dropped in favour of a unidirectional reference: `gm_context.adventure_id` with a unique index. Lookup in either direction is a single indexed query.
