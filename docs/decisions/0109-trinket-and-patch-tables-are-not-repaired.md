---
id: ADR-0109
title: The garbled trinket and patch tables are not repaired — nothing queries them
area: rules-ingestion
status: accepted
milestone: M7.7
superseded_by: null
summary: null
---

**Found 2026-08-20, not fixed by decision the same day.**

An audit of the printed-p.7 loadout tables for the wide-table truncation signature
(`docs/rules-extraction-findings.md § S27.4`) came back clean — 40 of 40 rows present across
four class tables × `00`–`09`. The defect turned up one page over instead. `TRINKETS`
(printed p.8) has 4 orphan continuation rows and 2 comma-terminated ones; `PATCHES`
(printed p.9) has 6 orphans.

**All 100 indices survive in each, so this is reassembly damage rather than loss.** Both are
three-column tables, and extraction interleaves the columns across lines. Nothing is missing;
the rows are assembled wrongly.

**`§ S11.2` calls these tables "intact", which is true at the token level and wrong at the
row level.** That is worth correcting in the findings document even though no repair follows
from it.

**No fixup entry, by decision.** Character creation rolls the number and the player enters
the result from their own copy of the book. Nothing in the app resolves a d100 against these
tables, and the character sheet schema itself records both as *"narrative, never mechanical"*
(`character-sheet.schema.ts:132-135`). A garbled table nobody queries costs nothing, and the
fixup mechanism exists for defects that reach a reader.

**Revisit only if** something starts resolving trinkets or patches mechanically.
