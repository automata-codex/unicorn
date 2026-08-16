---
id: ADR-0039
title: The M7.6 migration drops and recreates rather than transforming
area: claude-tool-schemas-state
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

**Confirmed 2026-08-14, built 2026-08-15.** `V19__character_sheet_m76_reset.sql`
deletes every `character_sheet` and `campaign_state` row rather than migrating
them.

Recorded here because **the migration file is disposable and this reasoning is
not.** The pre-`v0.1.0` Flyway consolidation pass collapses V1–Vn into a single
baseline and discards the file, taking its comments with it.

Three facts made the call safe: local dev was empty, the eval droplet runs only
the harness (which seeds its own rows per run), and no eval fixture carries
sheet data.

**A defensive transform could not have worked in any case.** The reduced sheet
requires `creationRolls`, and there is no way to recover what the dice showed
from a stored total — the old sheet held sums and derived values, never the
rolls. Any transform would have had to invent them.

Both tables, not just `character_sheet`: `campaign_state.data.resourcePools`
changed shape in the same milestone, and a sheet reset that left the old pools
behind leaves a campaign whose pools no reader can address.

**`schema_version` deliberately stays at 1.** There is no row to distinguish,
and a bump would make `synthesis.write.ts`'s parse reject exactly the rows this
migration removes.
