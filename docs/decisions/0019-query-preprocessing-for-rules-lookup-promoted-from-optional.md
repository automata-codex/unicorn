---
id: ADR-0019
title: Query preprocessing for `rules_lookup` promoted from optional to critical path
area: rules-retrieval
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

Shortening a `rules_lookup` query to its 2–3 distinctive terms puts the
correct page at rank 1 on *both* FTS and dense retrieval, for all three real
recorded queries — including the one query no other configuration on either
backend ever retrieved (`docs/rules-extraction-findings.md § S4`, `§ S5.3`).
This is the single largest effect measured across the whole retrieval
investigation, larger than the FTS-vs-embeddings choice itself (`docs/decisions.md
§ Rules retrieval mechanism`, above).

Two separable fixes, with different costs:

- ~~**Term-dropping is mechanical and has no open question attached.** A
  document-frequency ceiling computed from the index itself (drop query
  terms occurring on more than some threshold share of pages) requires no
  vocabulary knowledge and no LLM call. Proven on both backends. This is now
  M7.2/M7.5 scope, not a maybe.~~
  **Overturned by measurement, 2026-08-06.** The mechanism shipped in M7.2 and
  was then swept with `task eval:retrieval` against 37 labelled answerable
  queries. It has **no useful setting on this corpus**: every ceiling that
  drops anything costs recall (0.4 is −10.8 pp recall@3; 0.55 is −8.1 pp), and
  every ceiling that costs nothing (0.65 and above) drops nothing, because the
  measured document frequencies cluster at 47–64% with no gap between filler
  and topic vocabulary to place a threshold in
  (`docs/rules-extraction-findings.md § S15.3`).

  What went wrong in the reasoning above is the word *proven*. What S4 proved
  was that **hand-authored** trimming helps — by someone who already knew the
  target page, which `§ S4.5` flagged as an upper bound. A frequency ceiling is
  a different instrument, and on a single-book corpus it discards the word that
  names the mechanic, because `saving` is frequent precisely *because the book
  is about saves*. Assuming the automated proxy inherited the manual result's
  evidence was the error, and it is the one worth remembering.

  **Shipped state:** the mechanism, the `--df-threshold` flag, and the sweep
  all remain; `DEFAULT_DF_THRESHOLD` is 0.75, deliberately above every observed
  frequency, so the default costs nothing while a larger or multi-book corpus
  might yet admit a useful ceiling. The vocabulary half of this entry, below,
  is untouched and still open.
- **Vocabulary mapping is the part still open.** Substituting book
  vocabulary for generic-TTRPG terms (`perception` → `Intellect`) is a real,
  separate effect — moved the worst query from 9th to 4th under dense
  retrieval — but the reformulations tested were authored by someone who
  already knew the target page (`docs/rules-extraction-findings.md § S4.5`),
  so this is an upper bound, not a validated fix. Two candidate approaches,
  not yet chosen between: a per-system synonym/thesaurus table (real ongoing
  authoring cost, one per supported game system), or prompt-side guidance
  steering the Warden's own query phrasing toward book vocabulary. The
  latter is free — the Warden is already the LLM making the tool call, so
  shaping its query costs no additional latency or API call, unlike a
  dedicated query-rewriting model call, which the latency finding above
  rules out.

**Consequence for the M7.2 retrieval eval harness.** Fixtures written by
hand in tidy, correct-vocabulary phrasing cannot detect this failure mode at
all — the harness needs query fixtures that reflect real Warden output
(verbose, sometimes off-vocabulary), not idealized questions, or it will
report a retrieval quality bar the Warden's actual queries never clear.

**Not yet decided:** whether prompt-side guidance alone closes enough of the
vocabulary gap to skip a synonym table, or whether both are needed. Prompt
guidance is untested; only the oracle-authored upper bound has been
measured.

**Amendment — the vocabulary gap splits into two problems, not one, and the
floor is more load-bearing than it looked.** Measured against the 596 real
`rules_lookup` queries recorded in `unicorn-artifacts` (`docs/rules-extraction-findings.md
§ S8`), not just the original three. The "vocabulary mapping" fix above
assumed a single problem — the Warden's word, the book's word — but at scale
it splits into two with different fixes:

- **Wrong word** (`initiative`→`turn order`, `stealth`→`sneak`): the book has
  the concept under different vocabulary. A synonym table or prompt-side
  phrasing guidance genuinely fixes this. 157 of the 344 out-of-corpus-term
  queries (45.6%) fall here.
- **Concept absent** (suppressive fire, flanking, opposed rolls, difficulty
  numbers): the PSG resolves everything by rolling under a stat, so these
  mechanics have no referent in the book at all. No mapping — synonym table
  or otherwise — can retrieve a rule the book doesn't contain. 130 of 344
  (37.8%) fall here, and the correct behaviour is returning nothing, which
  the design already treats as a supported outcome (`docs/rules-extraction-findings.md
  § S8.3`, `§ S9`).

**Consequence:** the similarity floor (`docs/specs/zoltar/013-m7.5-rules-retrieval-quality.md
§ Part 4`, left open) is not an optional refinement alongside the vocabulary
work — it's the only mechanism that correctly handles over a third of real
queries, at a rate the original three-query sample gave no way to see. Both
fixes are now confirmed necessary and non-overlapping, not alternatives to
weigh against each other.
