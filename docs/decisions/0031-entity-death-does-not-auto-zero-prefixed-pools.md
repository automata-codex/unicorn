---
id: ADR-0031
title: Entity death does not auto-zero prefixed pools
area: claude-tool-schemas-state
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

When an entity's `status` flips to `'dead'`, the validator does not automatically zero resource pools whose keys are prefixed with that entity's id. Claude must send explicit pool deltas alongside the status change. An earlier playtest-tool prototype auto-zeroed to work around Claude forgetting; M6 opts for explicit behavior to keep the correction mechanism as the single channel for state-change feedback. Revisit if playtest data shows the omission happens often enough to cause drift.
