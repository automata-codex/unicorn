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

  **Why this is not just `drop_pages`.** The two keys answer different questions.
  `drop_pages` says *this content should not be findable* — it is unreachable,
  or actively harmful to ranking. `chapterless_pages` says *this content is
  findable and has no chapter*. The cards are retrieved and useful: printed p.2
  and p.44 both appear in top-3 results across the fixture set. Dropping them to
  avoid an attribution question would discard content to tidy up metadata.

**On naming each footer-less page's chapter in config instead** — rejected, though **not** because it is per-page manual data that goes stale, which is exactly what `chapterless_pages` is. What separates them is what each asserts: a chapter name is a positive claim that must track the book's contents, while non-membership is a negative one that survives reorganization. The volume argument was carrying nothing either — inheritance serves exactly one page.
- **Physical 10** — equipment continuation, printed p.11. Genuine body content
  mid-chapter that happens to have lost its running footer, and reachable
  content the Warden queries. **Inherits the preceding page's chapter**, which
  resolves `EQUIPMENT` on physical 9.

**Blank stays a signal; inherited is a claim.** The reason `chapterless_pages` is
an explicit list rather than "inherit everywhere" is that a future footer-parsing
regression should present as a gap, not as plausible-looking wrong attributions.
`read_page_chapters` logs the resolved count before filling — 36 of 44 on this
edition — because taken after filling that number would read a clean 44 of 44 on
a book whose footers had stopped parsing entirely.

**That diagnostic needed hardening, and this is the change review forced.** Once
pages inherit, the index no longer shows the gap and the log is the only place it
survives — so the log's threshold has to be worth something. It was "warn below
half", which on a 44-page book tolerates 36 resolving pages falling to 22 without
a word. `expected_chapter_pages` now pins the count per edition beside the PDF
hash, and any deviation warns. The old fraction remains as the fallback for a
system that has not pinned one, and says so.

**Enumeration rather than derivation, and this is settled rather than open.** The
obvious alternative — classify front and back matter by position — is the same
shape as trusting a block's page attribute: plausible, wrong on the next book,
and silent about being wrong. It is not even coextensive, since an errata insert
or fold-out plate is chapterless mid-book while front matter can sit inside
chapter 1. An explicit list fails visibly, which is the property being bought. A
book with no such pages carries an empty key, and that is the correct cost.

**Honest scope: inheritance serves exactly one page today.** Of the eight
footer-less pages, five are dropped and two are the cards, leaving physical 10.
The rule is still the right one — it is the general answer to "a body page lost
its footer" — but it should not be read as covering a class.

**A chapterless page is skipped, not a barrier.** It takes no chapter itself and
does not reset the carry.

*This entry originally said the opposite — that a chapterless page stops the
carry — and was corrected on review the same day.* The argument that killed it:
a chapterless page either sits at a chapter boundary, where the next page
resolves its own footer and stopping changes nothing, or it sits mid-chapter —
an errata insert, a fold-out plate — where stopping strips a correct attribution
off the next page. **No-op or wrong, with no third case.** The justification
offered here (*"the back-cover card cannot hand the last chapter to anything
following it"*) described a situation that cannot arise: nothing follows the back
cover. Simulated across all 44 PSG pages, the two behaviours differ on **zero**
pages — the original rule was unfalsifiable against the only book we have, which
is precisely why it survived authoring.

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

**The mechanism was confirmed separately, and it had to be.** Identical
aggregates are also what a silently no-op'd inheritance would produce, so the
scores alone cannot tell "worked and cost nothing" from "did nothing". The dry
run reports which pages carry no chapter by name: it listed **printed p.2 and
p.44 only** — the two reference cards — with printed p.11 absent, which is
physical 10 having inherited `EQUIPMENT`. That is the pass condition, and it is
why `print_dry_run` names the pages rather than counting them.

**The similarity distributions still overlap** — answerable-correct-hit
0.330–0.601 against unanswerable 0.271–0.426 — so [[0020-no-similarity-floor-for-rules-lookup-the-distributions-overl]]
is unchanged by this.
