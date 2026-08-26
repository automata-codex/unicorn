---
id: ADR-0111
title: Footer-less pages inherit the preceding chapter; reference cards carry none by design
area: rules-ingestion
status: accepted
milestone: M7.2
superseded_by: null
summary: null
---

**Decided 2026-08-26, closing the last open question M7.2 shipped with.**

Chapter attribution is read from the PSG's running footer
(`footer_format: "page-number-then-chapter"`). Eight of 44 physical pages carry
no parseable footer, and M7.2 shipped a placeholder policy — page citation, no
chapter breadcrumb — while the real answer was deferred. Three of the eight were
already resolved by dropping them
([[0016-character-creation-content-is-excluded-from-the-rules-index]]). This
settles the remaining five.

**They are not one problem, and the whole decision is in separating them.**

- **Physical 0 and 2** — the cover (23 chars) and the credits / content-warning
  page. No rules content. **Dropped**, the same way page 4 was.
- **Physical 1 and 43** — the inside-cover and back-cover reference cards. These
  belong to no chapter *in the printed book*. Their footer is not missing; there
  is nothing for it to say. **They carry no chapter, by design**, recorded as
  `chapterless_pages` in `ingestion/mothership/system.json`. They stay in the
  index per [[0107-reference-cards-stay-in-the-rules-index]].
- **Physical 10** — equipment continuation, printed p.11. Genuine body content
  mid-chapter that happens to have lost its running footer, and reachable
  content the Warden queries. **Inherits the preceding page's chapter**, which
  resolves `EQUIPMENT` on physical 9.

**Blank stays a signal; inherited is a claim.** The reason `chapterless_pages` is
an explicit list rather than "inherit everywhere" is that a future footer-parsing
regression should present as a gap, not as plausible-looking wrong attributions.
`read_page_chapters` logs the resolved count before filling — 36 of 44 on this
edition — and warns below half. Taken after filling, that number would read a
clean 44 of 44 on a book whose footers had stopped parsing entirely.

**A chapterless page also stops the carry**, so the back-cover card cannot hand
the last chapter of the book to anything following it.

**Implementation.** `fill_chapter_gaps` in `ingestion/pipeline/extract.py`, pure
and unit-tested without a PDF; called from `read_page_chapters` so the document
is opened once.

**This is a lever, not a metadata tidy-up, and the manifest says so.**
`chunk_blocks` prefixes each chunk with its chapter breadcrumb, so attribution
changes the indexed text. `chapterlessPages` joins `droppedPages`,
`targetTokens`, `overlapTokens` and `includeSectionHeaders` in the ingest
manifest — a retrieval score is only comparable against a build with the same
value.

**Physical 11 and 12 are dropped in the same change, for an unrelated reason.**
`FIREARMS` and `INDUSTRIAL EQUIPMENT` restate the inside-cover reference card in
a different format — confirmed against the printed book by the maintainer, not
inferred from the extraction. Their `Table` blocks all extract empty
(`docs/rules-extraction-findings.md § S3.2`), so today they contribute nothing;
dropping them also stops `--include-section-headers` resurrecting them as bare
topic labels with no table body, which is the false-positive shape
[[0016-character-creation-content-is-excluded-from-the-rules-index]]'s addendum
describes for physical page 3. This closes M7.2's other known gap.

**Cost, and what it turned out to be.** Re-ingested and re-measured 2026-08-26
(`mothership__2026-08-26T13-46-20Z`). The caution written here in advance — that
`drop_pages` going from 4 pages to 8, plus a breadcrumb on every physical-10
chunk, would leave the M7.5 baseline measuring an index that no longer exists —
was worth stating and did not come true.

**Every aggregate reproduced the baseline exactly:** `recall@3` 97.3%,
`recall@5` 97.3%, MRR 0.883, `authored` 100.0%, `warden-observed` 95.7%. Not one
rank moved — an identical MRR to three decimals across 37 answerable queries is
what no rank changing looks like. The corpus went 61 → 60 chunks.

**That is the result the change was designed to have, and it is worth saying why
rather than filing it as luck.** The four newly dropped pages were a 23-character
cover, a credits page, and two pages whose `Table` blocks all extract empty — they
were contributing nothing to drop. The breadcrumb added to physical 10 is a short
prefix on a ~400-token chunk, and no fixture's expected page is printed p.11. So
the attribution gap closed at zero retrieval cost, and `§ S28`'s figures stand
rather than being superseded.

**The similarity distributions still overlap** — answerable-correct-hit
0.330–0.601 against unanswerable 0.271–0.426 — so [[0020-no-similarity-floor-for-rules-lookup-the-distributions-overl]]
is unchanged by this.
