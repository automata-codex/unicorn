---
id: ADR-0015
title: Reading order requires an explicit column-aware sort; an LLM may validate it, never perform it
area: rules-ingestion
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

Marker's emitted block order is not reading order on multi-column pages. Of the 16 pages carrying two or more numbered section headers, 8 emit them out of order, including full reversals (`docs/rules-extraction-findings.md § S6.2`); the true rate is plausibly higher since that test can't see unnumbered headings. A chunker that merges blocks in emitted order — the design doc's implicit assumption — would concatenate roughly half the book's body pages backwards.

Two approaches were on the table: an LLM pass that reads the page image and proposes correct ordering, or a deterministic geometric sort using the bbox coordinates every block already carries. LLM-assisted flagging was piloted first for a different purpose (auditing extraction defects generally) and, as a side effect, demonstrated it could recover correct order by eye — but that's the wrong place for the capability to live: routing per-page ordering through an LLM call at ingestion time would make a Python-only, no-LLM-calls pipeline (`docs/rules-ingestion.md`, hard constraint) depend on a model call for every multi-column page, forever, on every re-ingestion.

**Decided:** a ~25-line deterministic sort. Full-width blocks (≥60% of page width) flush the current column band and stand alone; everything else is banded by `y0` position and split left/right by bbox x-centre against the page midline (`docs/rules-extraction-findings.md § S7.2`). This recovered 15 of 16 measurable pages with nothing regressed. The one residual failure (physical page 17, a boxed callout whose heading is narrower than its full-width body) is understood and local, not a case against the approach.

**The boundary that follows from this:** the sort must be deterministic and live in `ingest.py`. An LLM may validate the result — flagging pages where the sort still looks wrong, informed by the page image rather than geometry alone — but must never perform the reordering itself. Where geometry genuinely can't resolve a page, the escape hatch is a hand-blessed ordering recorded once per edition in `fixups.json`, keyed on block `id`; that's an explicit, reviewed exception, not a runtime dependency.

**Coverage caveat carried forward, not resolved here.** The numbered-header test that validates the sort only sees 16 of 44 pages. The LLM-flagging pass is the intended instrument for validating the other 28 (unnumbered headings), not yet run at that scope.
