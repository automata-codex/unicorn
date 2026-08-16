---
id: ADR-0025
title: HP and all numeric resources in `resourcePools`, not a separate `entities.hp` field
area: claude-tool-schemas-state
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

An earlier design gave entities a special `hp` field alongside `resourcePools`. Folded into `resourcePools` for consistency — HP is a resource pool mechanically, and the threshold behavior (death, unconscious) is handled by the validator reading pool definitions from the system Zod schema, not by special-casing field names. This keeps the schema extensible across systems that track hit points differently.
