---
id: ADR-0006
title: No event sourcing
area: architecture-backend
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

ES is a natural fit for games in theory but awkward with an AI GM layer — Claude's responses aren't deterministic, so replaying events doesn't reproduce the same narrative. The message log plus state snapshot approach provides most of the practical ES benefits (audit trail, session reconstruction, correction without deletion) without the full ceremony.
