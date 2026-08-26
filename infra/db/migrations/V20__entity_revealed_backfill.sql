-- ADR-0101 — split `visible` into line of sight and discovery.
--
-- `campaign_state.data.entities.*` gains a required `revealed` boolean. Rows
-- written before it have exactly one signal about discovery, and it is the
-- overloaded field: an entity currently visible is one the players know about,
-- and a hidden one is the case that needs `revealed: false`. So the back-fill
-- rule is `revealed := visible`.
--
-- Required rather than defaulted in the Zod schema, deliberately. A default
-- would let every caller — `ASSEMBLY_PROBE` most of all — acquire a value
-- nobody chose, which is the exact failure `revealed` exists to correct: a
-- field whose meaning nothing ever stated.
--
-- Entities already carrying `revealed` are left alone, so this is safe to run
-- against a database that has seen a post-ADR-0101 synthesis.
--
-- This migration is disposable. The pre-v0.1.0 Flyway consolidation pass will
-- discard it (`docs/roadmap.md § M9`, which names this file), because a fresh
-- installation creates these rows with `revealed` already set and has no
-- reason to replay a back-fill. The note lives on that bullet as well as here,
-- since a note that lives only in the file being deleted disappears with it.

UPDATE campaign_state
SET data = jsonb_set(
      data,
      '{entities}',
      (
        SELECT COALESCE(jsonb_object_agg(
                 e.key,
                 CASE
                   WHEN e.value ? 'revealed' THEN e.value
                   ELSE e.value || jsonb_build_object('revealed', COALESCE((e.value->>'visible')::boolean, true))
                 END
               ), '{}'::jsonb)
        FROM jsonb_each(data->'entities') e
      )
    )
WHERE data ? 'entities'
  AND EXISTS (
    SELECT 1 FROM jsonb_each(data->'entities') e
    WHERE NOT (e.value ? 'revealed')
  );
