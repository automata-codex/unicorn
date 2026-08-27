---
id: ADR-0014
title: Chunk extraction is block-based with footer-derived provenance, not markdown headings
area: rules-ingestion
status: accepted
superseded_by: null
milestone: unknown
summary: >-
  Why ingestion chunks marker's typed blocks rather than Markdown headings — the PSG's
  heading histogram kills that premise on arithmetic alone — and where provenance
  actually comes from, since `blocks[].page` is an internal id that looks like a page
  number and is not. Verified against the PSG 1e only; a second book needs its own
  check.
---

The design doc's chunking premise — treat each `###` Markdown heading as a candidate chunk boundary — does not survive contact with the actual extraction output. The PSG's whole-book heading histogram is 84 `#`, 3 `##`, 10 `###`, 55 `####` (`docs/rules-extraction-findings.md § S1.5`): 10 `###` headings against a 100–400-chunk target kills the approach on arithmetic alone, and the levels are assigned by font size rather than document structure — `#### ARMOR` and `# 14 ARMOR` are the same section at different levels, and reading order scrambles across the character-creation spread. Markdown output is also the wrong extraction format independent of the heading problem: it discards page attribution entirely, and the only page-marker mechanism it carries (`<span id="page-N-M">` anchors) covers 16 of 44 pages.

**Decided:** ingestion runs marker with `--output_format chunks`, not `markdown` — typed blocks (`Text`/`Table`/`ListGroup`, dropping headers/footers/pictures) carrying page and bbox metadata, merged toward a ~400-token chunk target with 50–100 tokens of overlap (`docs/rules-extraction-findings.md § S1.6`). Chapter boundaries force a chunk break.

Provenance is derived, not read from any marker field. `blocks[].page` is an internal id, not a page number (physical page 0 → `'7'`, 1 → `'512'` — plausible-looking and wrong, the exact failure mode worth guarding against in any future extraction work). The physical page number comes from the `/page/N/` prefix on each block's `id`; the printed page number and chapter name are read from the PDF's running footer via `pypdfium2` directly, which resolves chapter on 36 of 44 pages (`docs/rules-extraction-findings.md § S1.8`). `section_hierarchy`, marker's own structural field, was tested and rejected as a breadcrumb source — it records the last header seen at each visual level, which turns siblings into parents on scrambled multi-column pages (`STEP 5. GAIN STRESS > STEP 6. NOTE TRAUMA RESPONSE`).

**Edition-specific, not general.** The `printed page = physical page + 1` offset and the footer-parsing approach are verified only against the PSG 1e. Any second Mothership book needs its own check before ingestion (`docs/rules-extraction-findings.md § Open questions`).
