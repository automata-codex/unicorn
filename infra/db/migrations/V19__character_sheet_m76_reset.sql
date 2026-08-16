-- M7.6 — reset character sheets and campaign state to the new shapes.
--
-- Drop and recreate rather than transform. Confirmed 2026-08-14: no
-- `character_sheet` row exists that matters — local dev is empty, the eval
-- droplet runs the harness only (which seeds its own rows per run), and no
-- eval fixture carries sheet data. A defensive transform would be code written
-- for data that does not exist, and it could not produce the missing values in
-- any case: the new sheet requires `creationRolls`, and there is no way to
-- recover what the dice showed from a stored total.
--
-- Both tables, not just `character_sheet`. `campaign_state.data.resourcePools`
-- changed shape in the same milestone (flat `{entity_id}_{pool_name}` keys to
-- nested `resourcePools[owner][poolName]`), and a sheet reset that left the old
-- pools behind would leave a campaign whose pools no reader can address.
--
-- `schemaVersion` deliberately stays at 1 rather than bumping: there is no row
-- to distinguish, and a bump would make `synthesis.write.ts`'s parse reject
-- exactly the rows this file deletes.
--
-- This migration is disposable. The pre-v0.1.0 Flyway consolidation pass will
-- collapse V1–Vn into a single baseline and discard it, so the reasoning above
-- is preserved in `docs/decisions.md` rather than living only here.

DELETE FROM campaign_state;
DELETE FROM character_sheet;
