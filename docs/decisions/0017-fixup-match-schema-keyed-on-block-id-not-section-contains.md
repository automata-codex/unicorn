---
id: ADR-0017
title: Fixup match schema keyed on block `id`, not `{section, contains}`
area: rules-ingestion
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

`docs/rules-ingestion.md § Step 2` specifies fixup entries matched by `{section, contains}` — e.g. `{"section": ["Combat", "Panic"], "contains": "1-10Roll"}`. Neither key can express the confirmed extraction defects. `contains` needs text to match against, and the defect is 14 of 32 `Table` blocks extracting as empty (`<p></p>`) — there's nothing there to match on. `section` was meant to derive from `section_hierarchy`, already rejected above as unreliable ancestry.

**Decided:** match fixup entries on the block `id` (e.g. `/page/11/Table/5`) instead — stable, unique, and already the fallback every other part of this pipeline uses once `page` and `section_hierarchy` proved unreliable (`docs/rules-extraction-findings.md § S6.5`). `ingestion/mothership/fixups.json` remains empty pending the table-defect scoping decision in `roadmap.md` M7.2; this entry fixes the schema those fixups will eventually use, not the defects themselves.
