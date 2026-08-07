# Rules Extraction — Findings Log

A running record of what has actually been tried against real rulebook PDFs,
what happened, and what was concluded. Chunking and extraction are expected
to need several iterations; this file exists so each one starts from the last
one's evidence instead of re-deriving it.

**Relationship to the other documents.** `docs/rules-ingestion.md` is the
design intent. `ingestion/README.md` is the operational how-to. This file is
the empirical record, and where it contradicts the design doc, this file
describes reality — see [Corrections owed to `docs/rules-ingestion.md`](#corrections-owed-to-docsrules-ingestionmd).

**How to add to this file.** Append a new dated session under
[Sessions](#sessions) with the commands you ran and the raw numbers you got.
Promote anything durable into [Standing conclusions](#standing-conclusions)
and anything disproved into [Dead ends](#dead-ends). Do not silently edit an
old session's numbers — supersede them with a new entry, so a wrong earlier
reading stays visible as something that was once believed.

**One exception: the preamble is maintained, not appended.**
[If you're new to this problem](#if-youre-new-to-this-problem) is a summary
of current state written for someone arriving cold, and it is the one
section that should be edited in place to stay true. The append-only rule
above protects *evidence* — what was run and what came back. The preamble is
orientation, and orientation that describes a state the project has left is
worse than none, because it is the first thing a newcomer reads and the last
thing anyone remembers to update. Its "planned chunking approach" and "what
has and hasn't been measured" subsections are the two most likely to rot;
check them whenever you add a session.

**On quoted material.** This file quotes structural metadata only — chapter
names, page numbers, heading counts, block-type tallies. It does not
reproduce rules text. Same posture as the fixup files per
`docs/rules-ingestion.md § Licensing Posture`.

---

## If you're new to this problem

Orientation for someone joining to think about chunking or retrieval, so the
rest of this file reads as evidence rather than trivia. Everything below is
summary — the linked documents are authoritative.

### What the index is for

A Warden (the AI game master) is running a Mothership session. Mid-turn it
can call a `rules_lookup` tool with a free-text query. The backend embeds the
query, runs cosine similarity against `rules_chunk` in pgvector filtered to
the active game system, and returns the top matches. The Warden reads them
and adjudicates.

The consumer's constraints, all of which shape what a good chunk is:

- **Top 3 by default, 5 maximum** (`rulesLookupInputSchema`,
  `apps/zoltar-be/src/session/session.schema.ts`). Three chunks is the real
  budget.
- **Each result is `{text, source, similarity}`.** `section_path` is stored
  on the row but never surfaced, so **`source` is the only citation the
  Warden or the player ever sees.**
- **There is no similarity floor.** The query is `ORDER BY … LIMIT n` with no
  threshold, so on a populated index the Warden receives three chunks for
  every question, including questions this book cannot answer. Whether to add
  a floor is an open decision (`docs/specs/zoltar/013-m7.5-rules-retrieval-quality.md § Part 4`).
- **Empty results are a supported outcome.** The Warden falls back to a
  best-effort ruling and notes the miss. Returning nothing is safe;
  returning something confidently wrong is not.

### What the Warden actually asks

The most useful single input here, and easy to guess wrong. These are the
only real `rules_lookup` queries ever recorded — from playtests that all ran
against an empty index:

```
"perception check looking around environment, noticing details"
"saving throws stats how to roll checks"
"skill checks INT intellect saves diagnosis repair"
```

Keyword-stuffed and fuzzy, not crisp questions. Any chunking idea optimized
for "what happens on a panic check?" is being tuned against a query
distribution the Warden does not actually produce. Both styles matter; do not
assume the tidy one.

**These three are the only queries recorded from *play*, but they are no longer
the only ones recorded.** The `unicorn-artifacts` repository holds **5,139
`rules_lookup` invocations across 596 distinct query strings**, all from eval
runs ([S8](#s8--2026-08-06--the-real-query-distribution-596-queries-not-3)).
The three above turned out to be broadly representative on vocabulary — but
the large sample is skewed by fixture design (heavy combat), so use it for
distributional questions and these three for "what does real play look like."

### The book

Mothership Player's Survival Guide 1e. 44 pages, zine format, heavy display
type, multi-column, art-dense — a designed object rather than a reference
manual. 27 chapters (listed in [S1.8](#18-the-running-footer-is-the-reliable-provenance-source)),
32 tables, and content that ranges from procedural rules to stat blocks to
example-of-play dialogue to reference cards that duplicate body rules.

Its visual design is the root cause of most of this file: every structural
signal the extraction tool emits is derived from font size and reading order,
and both are unreliable here.

### The chunking approach, as built

**Shipped 2026-08-06** — this describes code, not a proposal. Source of truth
is `ingestion/pipeline/chunk.py`; `ingestion/README.md` is the operational
guide.

Extract typed blocks from marker's `chunks` output. **Sort them into reading
order** with a column-aware geometric pass (full-width blocks flush the
current band; the rest are banded by vertical position and split left/right
at the page midline). Attach the printed page number and chapter name from
the PDF's running footer. Then merge — `Text`/`Table`/`ListGroup` only —
toward a ~400-token target with 50–100 tokens of overlap. Chapter changes
force a boundary. Tables are never split. Every chunk opens with a breadcrumb
line naming its chapter.

The sort was **not** in the original design and is the one structural thing
that changed: without it, merging concatenates roughly half the body pages
backwards ([S6.2](#62-new-finding--reading-order-scrambling-is-pervasive-not-localised),
[S7](#s7--2026-08-06--column-aware-block-sort-feasibility-probe),
[S10](#s10--2026-08-06--column-aware-sort-implemented-and-re-scored)).

**On the real book:** 66 chunks, 26 of 28 chapters, 36 of 44 pages resolving a
chapter. The `###`-heading design this replaced would have produced about ten.

**The 400-token target and the 50–100 overlap band are still inherited
heuristics.** They shipped unvalidated and remain so — no sweep has been run
against them. They are lever 1 on M7.5's list, and `task eval:retrieval` is
now the instrument for it.

**Two gaps ship with it**, both known and neither resolved: 14 of 32 `Table`
blocks extract empty, taking printed pages 12–13 out of the index entirely
([S3.2](#32-new-finding--14-of-32-table-blocks-carry-no-text)); and five pages
resolve no chapter and carry a page citation with no breadcrumb.

### Hard constraints

Ideas that violate these need a decision, not just an implementation:

- **No rules text ships.** Extracted Markdown, chunk text, and vector indexes
  for non-SRD systems cannot live in this repository or be distributed
  (`docs/rules-ingestion.md § Licensing Posture`). Users run the pipeline
  against a PDF they own. This is why there are no sample chunks in this file.
- **`rules_chunk.embedding` is `vector(1024)`**, and the ingestion model must
  be the *same model* as the runtime query model, not merely one of equal
  width.
- **Ingestion is offline, Python, and currently makes no LLM calls** — Voyage
  embeddings only.
- **Query time sits in the GM turn hot path**, budgeted at ~100–200 ms
  (`docs/rules-ingestion.md § Query Time`).

`docs/specs/zoltar/013-m7.5-rules-retrieval-quality.md § 2.1` has a triage
table for which kinds of ideas cross these lines. Worth reading as a
*second-pass filter* on ideas rather than a first-pass frame — it is written
to constrain, and constraint-first framing tends to narrow a brainstorm.

### What has and hasn't been measured

**Retrieval quality now has a number.** As of 2026-08-06, against the shipped
index and a 49-fixture labelled set: **recall@3 94.6%, MRR 0.811** over 37
answerable queries, with 12 deliberately-unanswerable ones excluded from the
denominator. Split by phrasing: **authored 100.0%, warden-observed 91.3%**
(MRR 1.000 vs 0.696). Full detail and method in
[S15](#s15--2026-08-06--first-measured-retrieval-baseline-df-trimming-has-no-useful-setting);
reproduce with `task eval:retrieval`.

Read that number with three caveats attached:

- **It measures whether the right *page* came back, not whether the returned
  text was sufficient to adjudicate.** For chunk-size and boundary changes the
  two move together, so it is a fair proxy. For anything that changes what a
  correct result *is* — summarised chunks, parent-child retrieval — they come
  apart and the metric has to be rethought first.
- **recall@3 is stable run to run; MRR is not.** Identical configurations vary
  by up to ~0.03 MRR on borderline rank swaps
  ([S15.7](#157-run-to-run-variance--recall-is-stable-mrr-is-not)).
- **A label fix is not an improvement.** Recall moved 91.9% → 94.6% during a
  review pass that changed only the fixture labels, not the index
  ([S15.6](#156-labels-corrected-during-review--and-why-recall-went-up)).

**Two things measured along the way, both negative and both useful.**
Document-frequency query trimming has no useful setting on this corpus —
every threshold that drops anything costs recall, every threshold that
doesn't costs nothing because it drops nothing
([S15.3](#153-document-frequency-trimming-makes-retrieval-worse-at-every-setting-that-does-anything)).
And **no similarity floor separates answerable from unanswerable queries** at
current quality: the distributions overlap, with unanswerable topping out
around 0.416, above the answerable minimum
([S15.4](#154-no-similarity-floor-separates-answerable-from-unanswerable--in-either-configuration)).

The earlier qualitative work still stands and explains *why* the
warden-observed set lags. [S3](#s3--2026-08-05--postgres-fts-gut-check-on-page-granular-text)
and [S4](#s4--2026-08-05--vocabulary-vs-verbosity-isolated) were hand-judged
gut-checks over three recorded queries — evidence about FTS and query shape,
not a metric. [S5](#s5--2026-08-05--voyagepgvector-dense-retrieval-same-corpus-and-queries)
closed the backend question: dense retrieval is sensitive to the same
verbosity and vocabulary axes, better than FTS but not immune.

Practical consequence for brainstorming: an idea's cost is mostly "can we
score it with the existing fixtures?" Ideas that change what a *correct*
result means need the metric rethought before they can be judged, and that is
the expensive category.

### Where the evidence lives

Two repositories, and S1–S7 only searched one of them:

- **This repo** — the design docs, the pipeline, and this file.
- **`unicorn-artifacts`** (sibling checkout) — eval runs, playtests, and
  transcripts. This is where the 596 recorded `rules_lookup` queries are
  ([S8](#s8--2026-08-06--the-real-query-distribution-596-queries-not-3)).
  **Search it before concluding that evidence does not exist**; S3–S5 built
  distributional arguments on three queries while 596 sat one directory away.
- Neither holds the extracted rulebook output — see below.

### To see the actual extracted output

It is not in this repository and cannot be. Run the pipeline yourself per
`ingestion/README.md`, or look at a previous extraction on Alex's machine.
Reasoning about chunking without looking at a few real pages of marker output
is not recommended — the failures in [S1.5](#15-markdown-heading-levels-are-visual-not-semantic)
and [S1.7](#17-section_hierarchy-is-not-true-ancestry) are much more obvious
on sight than in summary.

---

## Standing conclusions

Current as of 2026-08-05. Each links to the session that established it.

1. **Run marker with `--disable_ocr` on text-layer PDFs.** The default path
   fails outright on this machine and is ~3× slower even where it works.
   ([S1.2](#12-marker-default-path-fails-llama-server), [S1.3](#13-marker-with---disable_ocr-succeeds))
2. **Use `--output_format chunks`, not `markdown`.** The Markdown output
   discards page attribution and block typing, and its heading levels are
   unusable. ([S1.5](#15-markdown-heading-levels-are-visual-not-semantic), [S1.6](#16-chunks-output-format-carries-typed-blocks))
3. **Page number = physical page index + 1**, for this edition. Derived and
   verified from the running footer, not from any marker field.
   ([S1.8](#18-the-running-footer-is-the-reliable-provenance-source))
4. **Chapter name comes from the running footer**, read via `pypdfium2`
   directly — not from marker's `section_hierarchy` and not from Markdown
   heading levels. Resolves on 36/44 pages. ([S1.8](#18-the-running-footer-is-the-reliable-provenance-source))
5. **The PSG's visual design defeats structural heading extraction.** It is
   a multi-column, art-dense zine-format book; every heading signal marker
   emits is derived from font size and reading order, both of which are
   unreliable here. Treat any future rulebook of similar design the same way.
   ([S1.5](#15-markdown-heading-levels-are-visual-not-semantic), [S1.7](#17-section_hierarchy-is-not-true-ancestry))
6. **No table in the PSG spans a page break; at least one non-table spread
   does, and it's out of scope anyway.** The character-creation flowchart
   (physical pp. 4–5) spans a page break, but character creation is
   structurally unreachable by the Warden — confirmed via tool-array and
   query-log inspection — so its extraction quality doesn't bear on
   retrieval design. ([S2](#s2--2026-08-05--character-creation-is-unreachable-to-the-warden))
7. **`Table` blocks are typed and positioned but often empty.** 14 of 32
   carry no text at all, emitted as `<p></p>`. Physical pages 11 and 12 are
   lost entirely as a result. Block counts are not a proxy for extracted
   content — check text length, not block presence.
   ([S3.2](#32-new-finding--14-of-32-table-blocks-carry-no-text))
8. **The Warden queries in generic-TTRPG vocabulary, not the book's.**
   `perception`, `diagnosis`, and `INT` appear on zero pages. Any retrieval
   design that assumes query terms occur in the corpus is assuming something
   false for this query distribution.
   ([S3.6](#36-term-coverage--the-wardens-vocabulary-is-not-the-books))
9. **Query verbosity hurts lexical retrieval more than vocabulary
   mismatch does.** With 5–7 terms the high-frequency tail dominates
   `ts_rank_cd` and buries the distinctive terms; cutting to 2–3 terms puts
   the target page at position 1–2. Vocabulary matters absolutely under AND
   (one out-of-corpus term returns zero rows) and barely at all under OR.
   The two are separable and both need handling.
   ([S4.3](#43-the-two-factors-are-separable-and-both-are-necessary))
10. **Query shape is a bigger lever than backend choice.** Both FTS and
    Voyage/pgvector fail the same recorded query in the same direction, and
    both put the target at rank 1 once the query is cut to its distinctive
    terms. Dense retrieval is the better default — it ranks on meaning and
    beat FTS by 15 positions on that query — but it does not absorb
    verbosity or vocabulary drift for free.
    ([S5.3](#53-dense-retrieval-is-sensitive-to-both-axes--it-does-not-absorb-them))
11. **Marker's emitted block order is not reading order on multi-column
    pages.** 8 of the 16 pages carrying two or more numbered section headers
    emit them out of order, including full reversals; the true rate is higher,
    since the measurement can't see unnumbered headings. Single-column pages
    are reliable. **Anything that treats block order as reading order — the
    M7.2 block-merge chunker above all — needs an explicit sort first.**
    A column-aware sort over the `bbox` every block already carries recovers
    15 of 16 measurable pages ([S7](#s7--2026-08-06--column-aware-block-sort-feasibility-probe)).
    **Shipped** in `ingestion/pipeline/chunk.py` and re-scored at the same
    15/16 with nothing regressed
    ([S10.2](#102-the-oracle-re-scored-on-the-shipped-code)).
    ([S6.2](#62-new-finding--reading-order-scrambling-is-pervasive-not-localised))
13. **The PSG is a ~20,000-token book, and a ~400-token target yields ~65
    chunks — not the 100–400 the spec expects.** The two numbers are
    arithmetically incompatible; the chunk-count guess is the unvalidated one.
    Chunk size is an M7.5 lever and should be tuned against the retrieval
    harness, not against a docstring.
    ([S11.1](#111-result--65-chunks-not-100400))
14. **A correct top hit does not score above 0.5 on this model and corpus.**
    Answerable queries top out at 0.527 and run as low as 0.355 while
    returning the right page; the spec's `> 0.5` sanity bar is an unmeasured
    guess. Answerable and unanswerable distributions do separate, but they
    overlap between 0.355 and 0.380 — enough to be encouraging about a
    similarity floor, nowhere near enough to set one.
    ([S12.2](#122-the-similarity-distribution--11-queries), [S12.3](#123-the-two-distributions-do-separate--narrowly))
15. **Automated document-frequency trimming has no useful setting on this
    corpus — measured.** Every threshold that drops anything hurts recall
    (0.4: −10.8 pp, 0.55: −8.1 pp against no preprocessing), and every
    threshold that doesn't hurt (0.65+) drops nothing at all, because the
    measured frequencies cluster at 47–64% with no gap between filler and
    topic vocabulary. S4's hand-authored trimming helped; the automated
    ceiling is a different intervention and discards the word that names the
    mechanic. ([S15.3](#153-document-frequency-trimming-makes-retrieval-worse-at-every-setting-that-does-anything))
16. **Retrieval baseline: recall@3 94.6%, MRR 0.811, with an 8.7-point gap
    between query styles** (authored 100.0%, warden-observed 91.3% — and 0.30
    of MRR between them). Measuring on authored questions alone would report a
    perfect score the Warden's real queries never see. recall@3 is stable
    run-to-run; MRR moves by up to 0.03 on noise alone.
    ([S15.2](#152-baseline--the-number-m75s-bar-is-set-against), [S15.7](#157-run-to-run-variance--recall-is-stable-mrr-is-not))
17. **No similarity floor separates answerable from unanswerable at current
    retrieval quality.** On 49 labelled fixtures the distributions overlap in
    both configurations, with unanswerable topping out around 0.416 — above
    the answerable minimum either way. Any floor excluding the worst
    unanswerable query would discard correct answers.
    ([S15.4](#154-no-similarity-floor-separates-answerable-from-unanswerable--in-either-configuration))
18. **A vector index built by migration must not be ivfflat.** ivfflat derives
    its centroids from the rows present at build time, and migrations run
    against empty tables; the resulting index silently returned 1 row for
    `LIMIT 2`. `REINDEX` cannot fix it and no `lists` value chosen against
    zero rows can either. **Fixed** in `V18__rules_chunk_hnsw_index.sql` by
    switching to hnsw, which builds incrementally and needs no per-corpus
    tuning. ([S13.7](#137-incidental--the-ivfflat-index-under-returns-at-small-limit), [S14](#s14--2026-08-06--the-vector-index-swapped-to-hnsw-under-return-fixed))
19. **The sort's one residual failure is invisible to the corpus — for now.**
    Page 17's misordering is confined to a `SectionHeader` block, and
    `SectionHeader` is dropped before chunking; its content blocks sort
    correctly. Two M7.5 levers (breadcrumb composition, `SectionHeader` as
    indexable content) would make it a live defect again and re-owe S7.3's
    refinement. ([S10.3](#103-new-finding--page-17s-residual-defect-never-reaches-a-chunk))
12. **The `rules_lookup` latency budget is entirely the embedding API call.**
    ~124–148 ms end to end, of which the Voyage round trip is ~98% and the
    pgvector scan 1–3 ms. Index choice is not the lever for query latency at
    this corpus size, and a second network hop in the lookup path (a
    reranker) does not fit the stated budget.
    ([S5.4](#54-latency--the-api-call-is-the-entire-budget))

---

## Dead ends

Things that were tried and do not work. **Do not retry these without new
information** — each cost real time.

| Approach | Why it fails | Session |
|---|---|---|
| `marker_single` with default flags | `surya.inference.backends.spawn.SpawnError: llama-server binary not found`. Surya 0.22 routes full-page OCR through llama.cpp. | [S1.2](#12-marker-default-path-fails-llama-server) |
| `marker_single ... --langs English` (per `docs/rules-ingestion.md § Step 1`) | Flag does not exist in marker 2.0. | [S1.1](#11-environment-and-install) |
| Chunking on `###` boundaries (per `docs/rules-ingestion.md § Step 4`) | Only 10 `###` headings exist in the whole 44-page book; would yield ~10 chunks against a 100–400 target. | [S1.5](#15-markdown-heading-levels-are-visual-not-semantic) |
| Markdown heading levels as hierarchy | Assigned by font size. `#### ARMOR` and `# 14 ARMOR` are the same book section at different levels. | [S1.5](#15-markdown-heading-levels-are-visual-not-semantic) |
| `blocks[].page` from the chunks JSON as a page number | It is an internal id, not a page label. Physical 0→`7`, 1→`512`, 2→`75`. **Looks plausible, is meaningless** — the exact failure mode worth guarding against. | [S1.6](#16-chunks-output-format-carries-typed-blocks) |
| `<span id="page-N-M">` anchors in the Markdown | Sparse: 16 anchors covering 16 of 44 pages, scattered. | [S1.4](#14-markdown-output-has-no-usable-page-markers) |
| `_meta.json` → `table_of_contents[].heading_level` | `None` for all 169 entries. The field exists and is always empty. | [S1.4](#14-markdown-output-has-no-usable-page-markers) |
| `section_hierarchy` as semantic ancestry | It is "last header seen at each visual level," so siblings become parents: `STEP 5. GAIN STRESS > STEP 6. NOTE TRAUMA RESPONSE`. | [S1.7](#17-section_hierarchy-is-not-true-ancestry) |
| Reading printed page numbers from marker's `PageFooter` blocks | Marker detects them (11 blocks) but emits empty `html` — it strips footers as noise. Read them from `pypdfium2` instead. | [S1.8](#18-the-running-footer-is-the-reliable-provenance-source) |
| `websearch_to_tsquery`/`plainto_tsquery` output used unmodified | Both AND unquoted terms. The recorded queries run 5–7 content words deep, so requiring one page to carry all of them returned **0 hits on all three**. Any FTS design must OR the terms or otherwise relax this. | [S3.5](#35-the-and-trap-is-real--0-hits-on-all-three-queries) |
| `ts_rank_cd` normalization flag `32` as a ranking fix | `rank/(rank+1)` is monotonic, so it cannot reorder results. Identical ranking to the default on every query. Flag `2` (document length) does change ordering. | [S3.8](#38-ranking-normalization-diagnostic-beyond-the-brief) |
| FTS over page-granular text as a *replacement* for embedding retrieval | 0 of 3 recorded queries returned an acceptable top 3; the decisive failure is vocabulary the book does not contain, which no tuning fixes. Not ruled out as a *supplement*. | [S3.9](#39-conclusion--unconvincing-as-a-replacement-on-this-evidence) |

---

## Open questions

- **Fallback chapter for the remaining 5 footer-less pages** (physical 0,
  1, 2, 10, 43 — down from 8: page 4 and its duplicates 41–42 are dropped
  outright, not resolved, per [S2](#s2--2026-08-05--character-creation-is-unreachable-to-the-warden)).
  Page 10 (equipment continuation) is body content the Warden would
  plausibly query and is the one that most needs an answer. Pages 1 and 43
  (armor/weapons and back-cover reference cards) duplicate live body rules
  rather than unreachable content, so they likely need one too. Pages 0 and
  2 (cover, credits) are candidates to drop the same way page 4 was — not
  yet checked with the same rigor. Options for whichever pages stay: fall
  back to marker's nearest `SectionHeader`, or attribute to a synthetic
  `"Reference Cards"` chapter. Not yet decided. ([S1.8](#18-the-running-footer-is-the-reliable-provenance-source))
- **Duplicate reference spreads.** Resolved for pages 41/42: both are
  byte-identical duplicates of physical page 4's character-creation spread,
  and page 4 is now dropped as unreachable, so 41–42 drop with it — no dedup
  logic needed for this pair. **Still open** for page 1 and page 43, which
  duplicate live, reachable body rules (armor/weapons stats) as reference
  cards rather than unreachable content. If both the reference card and the
  body page it duplicates stay in the index, near-duplicate chunks compete
  with each other in cosine ranking — whether to dedupe before embedding is
  still undecided for this pair.
- **Does the footer heuristic generalize?** Verified only against the PSG 1e.
  The `printed = physical + 1` offset is certainly edition-specific and
  probably printing-specific. Any second Mothership book (Warden's Operations
  Manual, Shipbreaker's Toolkit) needs its own check before ingestion.
- **Is `tiktoken` a good enough proxy for Voyage's tokenizer here?** Not yet
  measured. Accepted as a heuristic per `docs/specs/zoltar/012-m7.2-rules-ingestion.md § Part 3`.
- **~~Should FTS replace or precede embedding-based retrieval?~~ Answered
  2026-08-05 — no, not as a replacement.** See
  [S3](#s3--2026-08-05--postgres-fts-gut-check-on-page-granular-text). The
  premise behind the proposal was that the recorded queries are keyword-heavy;
  S3.6 found they are keyword-heavy *in vocabulary the book does not use*,
  which is the opposite of the condition the external evidence
  (alexgs.me/posts/fts-is-the-workhorse) relies on. **FTS as a supplement to
  embeddings remains untested and is not ruled out** by that session.
- **Does the Warden's query vocabulary match the book's?** No, and this is
  unaddressed on both retrieval paths. Two of the three recorded queries lean
  on terms absent from the PSG (`perception`, `diagnosis`, `INT`), because
  the Warden writes generic-TTRPG rather than Mothership vocabulary
  ([S3.6](#36-term-coverage--the-wardens-vocabulary-is-not-the-books)).
  **Measured 2026-08-05 ([S5.3](#53-dense-retrieval-is-sensitive-to-both-axes--it-does-not-absorb-them)):
  embeddings bridge it partially, not fully.** Substituting book vocabulary
  moved Q1 from 9th to 4th and Q3 from 3rd to 1st under dense retrieval — real
  improvements, so the gap is not absorbed for free, but far less brittle than
  FTS, where an out-of-corpus term zeroes an AND query outright. Still open:
  *what to do about it.* Options are a system-specific synonym/thesaurus layer
  or prompt-side guidance steering the Warden toward book vocabulary; the
  latter is free, since the Warden's prompt is ours to write. **The
  no-LLM-calls constraint rules out query rewriting by a model**
  ([S4.4](#44-what-this-changes-about-s39)).
  **Split in two by [S8.3](#83-new-finding--most-of-the-gap-is-missing-concepts-not-wrong-words),
  measured over 596 queries:** roughly half the mismatch is genuine wrong-word
  (initiative → turn order, stealth → sneak) and a synonym layer would fix it;
  the rest is the Warden asking about mechanics the PSG does not have at all
  (suppressive fire, flanking, opposed rolls, difficulty numbers), where no
  mapping can help and the correct answer is an empty result. Treat these as
  separate work items. **Ratio measured in [S9.4](#94-query-level-roll-up):**
  of the 344 queries carrying an out-of-corpus term, 157 (45.6%) are
  wrong-word-only and fixable by a vocabulary layer; 130 (37.8%) contain at
  least one absent mechanic and are unreachable by one.
- **Should the corpus include `SectionHeader` blocks?** Every session from S3
  onward measured against a corpus filtered to `Text`/`Table`/`ListGroup`,
  which drops all 169 section headings — 2,632 characters of topic labels
  ([S9.1](#91-two-corrections-to-s8s-method)). Section titles are the
  highest-signal terms in a rulebook and the likeliest match for a
  keyword-heavy query, so their absence is an unexamined confound in S3–S5's
  retrieval numbers. Cheap to test: rebuild the corpus with headings included
  and re-run S5's ranking. Note the headings also carry the section numbering
  the S6.2/S7 ordering work depends on.
- **~~Is a similarity floor now load-bearing rather than optional?~~ Load-bearing,
  and not yet derivable — measured 2026-08-06.** On 49 labelled fixtures the
  answerable and unanswerable top-1 distributions **overlap**, with unanswerable
  reaching ~0.416 against an answerable minimum of ~0.342
  ([S15.4](#154-no-similarity-floor-separates-answerable-from-unanswerable--in-either-configuration)).
  No threshold separates them without discarding correct answers, in either
  preprocessing configuration. The stakes below are unchanged and the question
  moves to M7.5 as "improve retrieval until a floor becomes derivable, or record
  that none is." Original framing:
  `docs/specs/zoltar/013-m7.5-rules-retrieval-quality.md § Part 4` leaves it
  open and there is currently no threshold at all, so the Warden receives three
  chunks for every question including unanswerable ones.
  [S8.3](#83-new-finding--most-of-the-gap-is-missing-concepts-not-wrong-words)
  raises the stakes: a substantial share of real queries ask about mechanics
  this book does not contain, so "return nothing" is the *correct* answer far
  more often than assumed. [S5.5](#55-incidental--a-similarity-floor-may-be-derivable-after-all)
  showed top-1 cosine distance separating answerable from unanswerable on three
  points; with 596 queries available that separation can now actually be
  measured.
- **The D&D-5e-bias hypothesis: is the vocabulary gap generic-TTRPG drift,
  or specifically D&D 5e's lexicon?** All three recorded queries'
  out-of-corpus terms have a plausible match in D&D 5e's own vocabulary
  rather than TTRPG-generic phrasing: `perception` is 5e's actual skill name
  (Wisdom (Perception)); `INT` is 5e's exact ability-score abbreviation —
  and Mothership has the same underlying stat under a different name
  (`Intellect`), so this reads as a translation error (wrong system's label
  for the right concept), not an imprecision error; `diagnosis` is a softer
  match, echoing 5e's Medicine-skill flavor text rather than naming a
  mechanic. **Untested beyond pattern-matching on n=3 — no session behind
  this yet.** If it holds, the fix is more tractable than a generic
  synonym layer: the source vocabulary is bounded, public, and already
  licensed (`docs/zoltar-design-doc.md § Supported Systems` — D&D 5e SRD
  5.1, CC-BY 4.0), unlike "map whatever an LLM might drift toward." It also
  predicts uneven cost across future systems — OSE, a D&D retroclone, may
  need little or no correction, while UVG and Feng Shui 2 don't share 5e's
  lexicon and would need their own check. Cheapest next step: cross-reference
  the recorded/plausible query terms against the 5e SRD's own skill and
  ability-score list directly — public text, no spike infrastructure needed.
- **Should `rules_lookup` preprocess the query before retrieval?** Raised by
  [S4](#s4--2026-08-05--vocabulary-vs-verbosity-isolated), which found
  verbosity to be the larger of the two failure drivers. Dropping
  low-information terms is mechanical — a stopword list, or a
  document-frequency ceiling computed from the index itself — and moved the
  target page from unranked to position 1–2 on all three recorded queries.
  **Now tested against embedding retrieval too
  ([S5.3](#53-dense-retrieval-is-sensitive-to-both-axes--it-does-not-absorb-them)),
  and the effect is the same direction, not reversed:** core-only queries hit
  rank 1 on all three, including the Q1 that nothing else on either backend
  has retrieved. This is the largest effect measured anywhere in S3–S5, which
  promotes it from an optimisation to **critical path**. Worth settling
  **before** the M7.2 eval harness is built, since it changes what the harness
  should be measuring — and note the harness cannot detect this class of
  problem at all if its fixture queries are written in book vocabulary by
  hand rather than sampled from real Warden output.
  **Answered 2026-08-06 — it should not, at least not this way.** Document-frequency
  trimming shipped and was swept against the labelled fixture set: every ceiling
  that drops anything costs recall, every ceiling that does not drops nothing
  ([S15.3](#153-document-frequency-trimming-makes-retrieval-worse-at-every-setting-that-does-anything)).
  The default is now deliberately inert. S4's effect was real but hand-authored
  by someone who knew the target page; the automated proxy does not inherit that
  evidence. The *verbosity* diagnosis stands — what is refuted is the frequency
  ceiling as its remedy.
- **~~How should block reading order be recovered?~~ Answered 2026-08-06 — a
  column-aware geometric sort works.** [S7](#s7--2026-08-06--column-aware-block-sort-feasibility-probe)
  took the measurable set from 8/16 to **15/16** with ~25 lines and no new
  dependency, regressing nothing. Still open, but as implementation rather
  than research: (a) the boxed-callout case on physical 17, where a heading
  narrower than its full-width body escapes the band break; (b) validating the
  28 pages the numbered-header oracle cannot see, for which the
  [S6](#s6--2026-08-06--llm-assisted-fixup-discrepancy-flagging) flagging pass
  is the available instrument. **The sort must stay deterministic** — the LLM
  validates it, never performs it.
- **~~Do the `Table` blocks that extract empty need fixing before M7.2 ships?~~
  No — M7.2 shipped without them, deliberately.** The gap is recorded in
  `ingestion/README.md § Known limitations` and tracked on `roadmap.md` M7.2 as
  unresolved-by-design, so equipment queries miss rather than silently
  returning something wrong. Still open as *work*, just not as a release
  blocker. 14 of 32 carry no text ([S3.2](#32-new-finding--14-of-32-table-blocks-carry-no-text)),
  taking physical pages 11 and 12 (`FIREARMS`, `INDUSTRIAL EQUIPMENT`) out of
  the index entirely. Equipment stats are plausible Warden queries, so this
  is probably a fixup-file case (`docs/rules-ingestion.md § Step 2`) or an
  argument for a second extraction pass on table regions. Not yet scoped.
- **Is physical page 3 also unreachable?** [S2](#s2--2026-08-05--character-creation-is-unreachable-to-the-warden)
  dropped pages 4, 41, 42 as character-creation content. Page 3 is the
  character-profile sheet and appears to be the same category, but was not
  covered by S2's analysis. It ranked in the top 3 for two of three queries in
  S3.7 purely on stat-name density — so if it is unreachable, excluding it is
  a free precision win on either retrieval path.
---

## Corrections owed to `docs/rules-ingestion.md` — discharged 2026-08-07

**All four are corrected; this section is kept as a record, not a to-do.**
The design doc predated any real extraction run, and these were wrong rather
than merely imprecise. Each is now fixed in `docs/rules-ingestion.md`, and the
implementation matches:

| Was wrong | Now |
|---|---|
| **§ Step 1** — `marker_single rulebook.pdf output/ --langs English`: a flag marker 2.0 does not have, and no `--disable_ocr`, without which the command fails outright | Step 1 shows the real invocation, `--output_format chunks --disable_ocr --disable_image_extraction`, and `extract.py` runs exactly that |
| **§ Step 4** — "each `###` section is a candidate chunk", not implementable against marker's output | Step 4 is block-based (4a sort, 4b merge, 4c attribute), matching `chunk.py` |
| **§ Step 4** — `source` described without saying where the page number comes from, when every intuitive candidate is wrong | Step 4c names the running footer as the source and marks the alternatives as rejected |
| **§ Step 2** — the `{section, contains}` fixup matcher, which cannot express either confirmed defect | Step 2 matches on block `id`; `fixup.py` rejects the old schema loudly rather than matching nothing |

---

## Sessions

### S1 — 2026-08-04 · First extraction of the Mothership PSG 1e

Context: M7.2 implementation plan Part 1 review gate. Goal was only to prove
marker installs and runs; it surfaced blocking problems for Parts 2 and 3.

**Environment.** macOS 15.7.7, arm64 (Apple Silicon, MPS). Python 3.12.12.
`ingestion/.venv`, 1.3 GB resolved. marker-pdf 2.0.0, surya-ocr 0.22.1,
torch 2.13.0, pypdfium2 5.10.1, pdftext 0.7.1, voyageai 0.5.0, psycopg 3.3.4,
tiktoken 0.13.0, pytest 9.1.1.

**Source document.** Mothership Player's Survival Guide 1e, 44 pages, 11 MB,
file dated 2024-11-08. Alex's copy; not in version control.

#### 1.1 Environment and install

`pip install -r requirements.txt` succeeded unmodified. Install is dominated
by torch and surya's model weights.

Marker 2.0's CLI differs from the design doc's sketch: no `--langs`; it takes
`marker_single FPATH --output_dir DIR --output_format [markdown|json|html|chunks]`.

#### 1.2 Marker default path fails (llama-server)

```
ingestion/.venv/bin/marker_single "<psg>.pdf" --output_dir <out> --output_format markdown
```

Failed after ~48s:

```
surya.inference.backends.spawn.SpawnError: llama-server binary not found. Install with:
  macOS:  brew install llama.cpp
```

Surya 0.22 runs full-page OCR through a llama.cpp backend (`--ocr_full_page`
defaults to `True`). The suggested remedy — `brew install llama.cpp` — would
add a non-Python system dependency to the self-hosted install story. Not
pursued, because the PSG does not need OCR at all (next).

*Caution when reproducing:* piping marker to `tail` makes `$?` report the
pipe's exit status, not marker's. The first run appeared to exit 0 while
actually failing.

#### 1.3 Marker with `--disable_ocr` succeeds

The PSG has a clean embedded text layer — sampled pages returned 460–3708
chars of well-formed text via `pypdfium2`, so OCR is pure cost.

```
ingestion/.venv/bin/marker_single "<psg>.pdf" --output_dir <out> \
  --output_format markdown --disable_ocr
```

Exit 0 in **16.5 s**. `Table processing stats: {'tables_pdftext': 18, 'tables_total': 33}`.
Output: 1549-line / 113 KB Markdown plus 42 extracted images.

#### 1.4 Markdown output has no usable page markers

Zero page delimiters of any conventional form. The only page signal is
`<span id="page-N-M"></span>` anchors: **16 of them**, covering physical pages
6, 7, 13, 17–21, 23, 25, 27–29, 31, 33, 38 — i.e. 16 of 44, scattered.

`_meta.json` carries `table_of_contents` with 169 entries, each
`{title, heading_level, page_id, polygon}`. `page_id` is populated and
correct; **`heading_level` is `None` on every entry.**

#### 1.5 Markdown heading levels are visual, not semantic

Heading histogram for the whole book:

| Level | Count |
|---|---|
| `#` | 84 |
| `##` | 3 |
| `###` | 10 |
| `####` | 55 |

This kills the design doc's `###`-boundary algorithm on arithmetic alone: 10
candidate chunks against a 100–400 target.

It is also wrong in kind, not just in calibration:

- `#### ARMOR` (line 3) and `# 14 ARMOR` (line 515) are the same book section
  at two different levels.
- `# 4 HOW TO MAKE YOUR CHARACTER` (a chapter) sits at the same level as
  `# STEP 5. GAIN STRESS` (one of its steps).
- `# STEP 3. CHOOSE YOUR CLASS` appears at line 129, **before**
  `# STEP 1. ROLL STATS` at line 144 — reading order scrambles across the
  multi-column character-creation spread.

Levels track font size. In a zine-format book with heavy display type, font
size does not track hierarchy.

#### 1.6 `chunks` output format carries typed blocks

```
ingestion/.venv/bin/marker_single "<psg>.pdf" --output_dir <out> \
  --output_format chunks --disable_ocr --disable_image_extraction
```

674 blocks, each `{id, block_type, html, page, polygon, bbox, section_hierarchy, images}`.

| block_type | n |  | block_type | n |
|---|---|---|---|---|
| Text | 354 | | PageFooter | 11 |
| SectionHeader | 169 | | Caption | 3 |
| Picture | 41 | | Form | 1 |
| PageHeader | 39 | | PictureGroup | 1 |
| Table | 32 | | | |
| ListGroup | 23 | | **content blocks** | **409** |

409 content blocks (Text + Table + ListGroup) merging toward ~400-token
chunks lands plausibly inside the spec's 100–400 expectation.

**The `page` field is not a page number.** Physical page 0 → `'7'`, 1 →
`'512'`, 2 → `'75'`. It is an internal identifier. The usable physical index
is the `/page/N/` prefix of `id` (e.g. `/page/0/SectionHeader/0`).

Tables survive as HTML rather than being flattened, which is the main
substantive advantage over the Markdown output for a rules book.

#### 1.7 `section_hierarchy` is not true ancestry

Every block carries `section_hierarchy`, a `{level: block_id}` map. Level
combinations observed:

```
('1',): 387   ('1','4'): 125   ('1','2','4'): 57   ('1','2'): 41
('1','3'): 41   ('2',): 15   ('1','2','3'): 4   ('2','4'): 2   ('1','3','4'): 2
```

Structurally complete — better than the Markdown — but semantically it is
"the last header seen at each visual level," which on scrambled multi-column
spreads makes siblings into parents. Resolved examples:

- `STEP 5. GAIN STRESS > STEP 6. NOTE TRAUMA RESPONSE` (siblings)
- `STEP 7. CHOOSE SKILLS > STEP 8. ROLL LOADOUT, TRINKET, AND PATCH` (siblings)
- `6.1 STARTING CREDITS > D100 TRINKETS` (wrong parent)

**Consequence for chunking:** a breadcrumb prefix built from this would inject
actively wrong context into the embedded text. Prefer the footer chapter.

#### 1.8 The running footer *is* the reliable provenance source

The PDF prints a running footer on body pages: page number followed by
chapter name. Physical page 20's text stream ends `… |21 |PANIC CHECKS`;
page 30 ends `… |31 |RANGE & DISTANCE`.

Marker detects these (11 `PageFooter` blocks) but emits **empty `html`** — it
correctly strips them as noise. So they must be read from `pypdfium2`
directly, in a pass alongside marker rather than from marker's output.

Parsing the first two and last two non-empty lines of each page for
`[<digits>, <CHAPTER>]` where `<digits> == physical_index + 1`:

- Tail only: **34/44** pages.
- Head **or** tail: **36/44** pages. (Pages 13 and 14 carry the marker at the
  head of the text stream — footer position alternates verso/recto.)
- The `printed == physical + 1` relation held on **every** page that parsed.
  No counterexamples.

Chapter names recovered this way are the real book structure, and are exactly
what a citation wants: `HOW TO MAKE YOUR CHARACTER`, `CREDITS`, `LOADOUTS`,
`TRINKETS`, `PATCHES`, `EQUIPMENT`, `FIREARMS`, `INDUSTRIAL EQUIPMENT`,
`SAFETY INSTRUCTIONS`, `HOW TO PLAY`, `STAT CHECKS & SAVES`, `MODIFYING STAT
CHECKS & SAVES`, `STRESS`, `PANIC CHECKS`, `SKILLS`, `SKILL TRAINING`,
`VIOLENT ENCOUNTERS`, `WHAT CAN I DO?`, `ATTACK & DEFENSE`, `WOUNDS & DEATH`,
`RANGE & DISTANCE`, `SURVIVAL`, `MEDICAL CARE`, `EXAMPLE OF PLAY`, `PORTS`,
`SHORE LEAVE`, `CONTRACTORS`.

The 8 unresolved pages carry 19,061 chars (**18%** of the book's text):

| Physical | What it is |
|---|---|
| 0 | Cover (23 chars) |
| 1 | Inside-cover armor/weapons reference card |
| 2 | Credits and content warning |
| 4 | Character-creation spread |
| 10 | Equipment continuation — a genuine body page with no footer |
| 41, 42 | Back-matter duplicates of the p4 spread (byte-identical to each other) |
| 43 | Back-cover rules reference card |

#### 1.9 Incidental observation — the panic mechanic is d20, not d100

Physical page 20 is headed `D20 PANIC EFFECT`. The M7.2 spec's suggested
sanity query ("what happens on a panic check of 73", Done When 3) describes
a d100 panic table, which is the **0e** mechanic. The 1e PSG uses a d20 table.

Not a pipeline defect, but the Part 4 sanity query has to be a question this
edition can actually answer, or a correct index will look broken. Alex's
`0e/` directory does contain a `Player's Survival Guide 0e.pdf`, so the two
editions are both on disk and easy to confuse.


### S2 — 2026-08-05 · Character creation is unreachable to the Warden

Context: a retrieval-design discussion raised page-spanning content as a
robustness question for both table extraction and prose windowing. Checked
against the real book and the real codebase rather than assumed.

**Tables do not span page breaks in the PSG.** Checked against the marker
`chunks` output from S1 — none of the 32 `Table` blocks has a page-adjacent
sibling with a matching column signature. No page-break handling is needed
for table atomicity.

**The character-creation flowchart (physical pp. 4–5) does span a page
break**, and its content — box labels and conditional branches — likely
doesn't survive text extraction at all, independent of the page break: it's
exactly the kind of visual/spatial structure S1.5 and S1.7 already found
marker cannot recover (`STEP 3` before `STEP 1`, siblings misread as
parent/child).

Rather than solve that extraction problem, checked whether it needs solving.
Grepped every recorded `rules_lookup` query and enumerated the tool arrays
of both Claude-calling modules:

- The only three `rules_lookup` queries ever recorded (preserved in
  `apps/zoltar-be/playtest-reports/` after the dev DB was wiped) are all
  mid-play resolution mechanics — perception, saves, skill checks — and all
  three returned 0 results against the empty index. No eval fixture or
  playtest transcript contains a `rules_lookup` call touching character
  creation.
- `rules_lookup` appears in exactly one tool array: `session.tools.ts`, the
  play loop. Character creation (`apps/zoltar-be/src/character/`) is a
  deterministic controller/service/repository behind
  `CharacterCreate.svelte` and makes no Anthropic calls at all. `synthesis`
  (campaign creation), the other Claude-calling module, exposes only
  `submit_gm_context` and `report_coherence` — no `rules_lookup`.

**Conclusion: this is a structural guarantee, not an absence-of-evidence
argument.** The Warden has no code path to character-creation content,
mid-play or at synthesis. Page 4's poor extraction quality and its
page-break-spanning flowchart don't need to be fixed — the content is
unreachable regardless of extraction fidelity.

**Consequence for open questions:** physical page 4 (one of the 8
footer-less pages) and pages 41–42 (its byte-identical back-matter
duplicates) can be dropped from the index outright rather than resolved.
See updated Open questions below.


### S3 — 2026-08-05 · Postgres FTS gut-check on page-granular text

Context: the Open questions bullet proposing FTS as a `rules_lookup`
mechanism had no session behind it. This is the qualitative gut-check that
gives it one — deliberately *not* the recall@3/@5/MRR harness M7.2 has
planned, which still needs page-labeled fixtures that do not exist.

**What this is not.** Not a head-to-head against Voyage/pgvector — that index
is empty, and populating it to compare would defeat the point of deciding
before that work happens. No number here is a retrieval metric. No LLM calls
were made at ingestion or query time; the query text goes straight into
`websearch_to_tsquery`.

**Deliberate simplifications.** One row per physical page (no block merging,
no chunking of any kind). Table HTML flattened to plain text, structure
discarded. Chapter attribution not carried on the row — resolved separately,
read-only, only to describe results below. These are spike shortcuts, not
proposals.

#### 3.1 Corpus construction

Source: the S1 marker `chunks` artifact, read from a local path outside the
repository. Content blocks only (`Text`/`Table`/`ListGroup`), the same filter
S1.6 validated. Physical pages 4, 41, 42 excluded per [S2](#s2--2026-08-05--character-creation-is-unreachable-to-the-warden).
Page index taken from the `/page/N/` prefix of each block's `id`, never from
the `page` field (a Dead end).

| Quantity | n |
|---|---|
| Blocks in artifact | 674 |
| Content blocks | 409 |
| Content blocks after S2 exclusions | 334 |
| Content blocks contributing text | 321 |
| **Pages loaded** | **38** |
| Total characters | 76,803 |
| Lexemes per page (avg / min / max) | 151 / 38 / 395 |

`page_number` holds the **physical** index; printed page = physical + 1
(standing conclusion 3). Both are given for every result below.

#### 3.2 New finding — 14 of 32 `Table` blocks carry no text

38 pages loaded, not the 41 that 44 − 3 exclusions implies. Three pages
contribute nothing at all, because every content block on them flattens to
the empty string:

| Physical | Printed | Chapter | Why empty |
|---|---|---|---|
| 0 | 1 | — (cover) | 3 `Text` blocks, all `<p block-type="Text"></p>` |
| 11 | 12 | `FIREARMS` | 7 `Table` blocks, all `<p></p>` |
| 12 | 13 | `INDUSTRIAL EQUIPMENT` | 6 `Table` blocks, all `<p></p>` |

Book-wide, **14 of 32 `Table` blocks (44%) have empty text**, on physical
pages 11, 12, and 32. Page 32 (`SURVIVAL`) survives because it has other
content; 11 and 12 do not.

This is the same failure mode S1.8 found for `PageFooter` — marker emits the
block with a detected type and bounding box, but no content — except that
here it is silent data loss on body pages rather than deliberate noise
stripping. S1.6's "409 content blocks" is an accurate count of blocks and an
overcount of blocks carrying text; the real figure is 395 book-wide.

**This is not an FTS finding.** It is upstream of retrieval entirely and hits
the embedding approach identically: the two pages of equipment stat tables a
Warden would most plausibly query for gear are absent from any index built on
this artifact, by either method. It supersedes nothing in S1.6 — the block
counts there are correct — but it does mean table extraction is a live
problem independent of chunking strategy, and it is a stronger argument for
the S1.6 note that "tables survive as HTML" needing qualification.

#### 3.3 Scratch schema

Created directly in the dev Postgres (`unicorn-db-1`, pgvector/pg16), not via
a Flyway migration, and dropped at the end of the session (3.10).

```sql
CREATE TABLE spike_fts_page (
  page_number int PRIMARY KEY,
  page_text   text NOT NULL,
  tsv         tsvector GENERATED ALWAYS AS
                (to_tsvector('english', page_text)) STORED
);
```

No GIN index, deliberately: 38 rows is a sequential scan either way, and an
index would imply a performance claim this session is not making. Nothing
here touches `rules_chunk`, `session.schema.ts`, or any production path.

#### 3.4 Queries run

The three recorded `rules_lookup` queries, unmodified. No synthetic queries
were added.

```sql
-- AND form (websearch_to_tsquery's default behaviour)
SELECT page_number,
       round(ts_rank_cd(tsv, q)::numeric, 5) AS rank,
       ts_headline('english', page_text, q,
                   'MaxFragments=2,MaxWords=18,MinWords=8') AS snippet
FROM spike_fts_page,
     LATERAL (SELECT websearch_to_tsquery('english', $1)) AS t(q)
WHERE tsv @@ q
ORDER BY rank DESC, page_number
LIMIT 3;
```

```sql
-- OR form: identical, with only the operator swapped. Reusing
-- websearch_to_tsquery's own output keeps stemming and stopword handling
-- byte-identical between the two forms.
LATERAL (SELECT replace(websearch_to_tsquery('english', $1)::text,
                        ' & ', ' | ')::tsquery) AS t(q)
```

`ts_headline` output was read at the terminal to make the relevance calls in
3.5 and is deliberately not reproduced here, per this file's posture on
quoted material.

#### 3.5 The AND trap is real — 0 hits on all three queries

| Query | Terms after stemming | AND hits | OR hits |
|---|---|---|---|
| Q1 perception/noticing | 7 | **0** | 3 |
| Q2 saves/stats/rolling | 5 | **0** | 3 |
| Q3 skills/INT/repair | 7 | **0** | 3 |

Parsed tsqueries (lexemes only, no rules text):

```
Q1  'percept' & 'check' & 'look' & 'around' & 'environ' & 'notic' & 'detail'
Q2  'save' & 'throw' & 'stat' & 'roll' & 'check'
Q3  'skill' & 'check' & 'int' & 'intellect' & 'save' & 'diagnosi' & 'repair'
```

Three for three. The brief's warning was not hypothetical: requiring one page
to carry all 5–7 content words of a keyword-stuffed query is a far stricter
bar than the Warden is asking for. **Any FTS design here must not use
`websearch_to_tsquery`/`plainto_tsquery` output unmodified.** All results
below are the OR form.

#### 3.6 Term coverage — the Warden's vocabulary is not the book's

Document frequency per lexeme across the 38 loaded pages, which turns out to
explain most of the ranking behaviour:

| Lexeme | Pages | Lexeme | Pages |
|---|---|---|---|
| `percept` | **0** | `save` | 24 |
| `diagnosi` | **0** | `roll` | 24 |
| `int` | **0** | `check` | 22 |
| `notic` | 2 | `stat` | 15 |
| `around` | 1 | `skill` | 8 |
| `throw` | 3 | `repair` | 7 |
| `detail` | 3 | `intellect` | 5 |
| `environ` | 5 | `look` | 9 |

Three of the queries' most distinctive terms — `perception`, `diagnosis`, and
the abbreviation `INT` — **appear nowhere in the book.** The book writes
`Intellect`, and has no perception concept at all. What remains after those
drop out is the generic tail (`check`, `save`, `roll`, `stat`), which is
spread across 15–24 of 38 pages and therefore carries almost no
discriminating power.

This is the single most important observation in the session, and it is not
really about FTS. The recorded queries are written in generic-TTRPG
vocabulary — `perception check`, `saving throw`, `INT` — while the book uses
its own. A lexical matcher cannot bridge that gap by construction. This is
precisely the case an embedding model is supposed to handle, and it accounts
for 1 of the 3 real queries outright.

#### 3.7 Per-query results and hand judgement

Chapter names come from a read-only `pypdfium2` footer pass (S1.8's method,
35/44 pages resolved). They are a description aid only — chapter was not
stored on the row and not used in matching.

**Q1 — "perception check looking around environment, noticing details"**

| # | Physical | Printed | Rank | Chapter |
|---|---|---|---|---|
| 1 | 20 | 21 | 1.00 | `PANIC CHECKS` |
| 2 | 18 | 19 | 0.80 | `MODIFYING STAT CHECKS & SAVES` |
| 3 | 16 | 17 | 0.60 | `HOW TO PLAY` |

**Judgement: wrong.** The top hit is the panic table, which has nothing to do
with observing an environment; it wins because `check` recurs on it more than
anywhere else. Result 2 matches on an example-of-play exchange rather than on
rules. The page a Warden should have received — `STAT CHECKS & SAVES`
(physical 17), where an awareness ruling would resolve — does not appear
anywhere in the top 8. Per 3.6 this is not recoverable by ranking: the
query's distinctive term is absent from the corpus.

**Q2 — "saving throws stats how to roll checks"**

| # | Physical | Printed | Rank | Chapter |
|---|---|---|---|---|
| 1 | 3 | 4 | 2.80 | `HOW TO MAKE YOUR CHARACTER` |
| 2 | 18 | 19 | 2.80 | `MODIFYING STAT CHECKS & SAVES` |
| 3 | 16 | 17 | 2.60 | `HOW TO PLAY` |

**Judgement: partial, with a wrong result in first place.** Results 2 and 3
are defensible — both are core resolution-mechanics pages. Result 1 is the
character-profile sheet: it ranks first because stat names and roll
instructions are printed densely on a form, not because it explains anything.
`STAT CHECKS & SAVES` (physical 17), the single most on-target page in the
book for this query, ranked **7th**.

Note also that physical page 3 is character-creation content, which
[S2](#s2--2026-08-05--character-creation-is-unreachable-to-the-warden)
established the Warden cannot reach. Only pages 4, 41, 42 were excluded here;
page 3 is a further under-exclusion this session did not anticipate.

**Q3 — "skill checks INT intellect saves diagnosis repair"**

| # | Physical | Printed | Rank | Chapter |
|---|---|---|---|---|
| 1 | 18 | 19 | 1.80 | `MODIFYING STAT CHECKS & SAVES` |
| 2 | 3 | 4 | 1.60 | `HOW TO MAKE YOUR CHARACTER` |
| 3 | 28 | 29 | 1.50 | `WOUNDS & DEATH` |

**Judgement: mostly wrong.** Only result 1 is defensible. Result 2 is the
character sheet again. Result 3 matches on `save` in the death-save sense — a
homonym collision with the query's `saves`, and exactly the kind of
confidently-wrong result that is worse than an empty response. The two
chapters the query all but names — `SKILLS` (physical 21) and `SKILL
TRAINING` (physical 23) — ranked **5th and 8th**, despite both containing
`skill` and `repair`.

**Tally: 0 of 3 queries returned a top-3 a Warden should have received.** One
(Q2) was partially useful. Two put a character sheet in the top 3.

#### 3.8 Ranking normalization diagnostic (beyond the brief)

Because the failures in 3.7 looked like a ranking artifact rather than a
matching one — long, term-dense pages beating short on-topic ones — the same
queries were re-run with `ts_rank_cd`'s normalization flag. Cheap, and it
distinguishes "FTS does not work here" from "the default ranking is
untuned," which are different decisions.

| Flag | Effect | Q1 | Q2 | Q3 |
|---|---|---|---|---|
| `0` (default) | none | target absent | target #7 | targets #5, #8 |
| `32` | `rank/(rank+1)` | identical order | identical order | identical order |
| `2` | divide by document length | target absent | **target #3** | **`SKILL TRAINING` #2** |

`32` is a monotonic transform of `0` and therefore cannot reorder anything —
recorded so nobody tries it again as a fix.

`2` is a real improvement on the two queries that have a lexically reachable
answer: `STAT CHECKS & SAVES` rises 7th → 3rd on Q2, and `SKILL TRAINING`
rises 8th → 2nd on Q3. The character sheet drops to 6th and 8th respectively.
It makes Q1 worse — a 476-character `ARMOR` page takes first place purely for
being short, the opposite failure mode.

So the default ranking is genuinely under-tuned, and roughly half the
observed failure is fixable configuration. The other half — Q1 entirely — is
not.

#### 3.9 Conclusion — unconvincing as a replacement, on this evidence

**FTS alone is not promising enough to relax or replace M7.2's chunking
design. M7.2 continues as planned.**

The reasoning, so this does not get re-litigated without new evidence:

1. **It failed the only test available.** Zero of three real queries produced
   a top-3 a Warden should have received. Two of three put a character sheet
   — content [S2](#s2--2026-08-05--character-creation-is-unreachable-to-the-warden)
   established is unreachable — in the top 3.
2. **The decisive failure is not fixable by tuning.** Q1's distinctive term
   does not occur in the book. Neither `websearch_to_tsquery` configuration,
   rank normalization, nor any chunking strategy recovers a page that shares
   no vocabulary with the query. Lexical matching is structurally blind to
   this, and it is 1 of the 3 real queries.
3. **The blog result does not transfer as assumed.** The FTS-beats-semantic
   case (`alexgs.me/posts/fts-is-the-workhorse`) rests on queries that are
   keyword-anchored *in the corpus's own vocabulary*. The recorded Warden
   queries are keyword-stuffed in **generic TTRPG vocabulary** — `perception
   check`, `saving throw`, `INT` — against a book that uses none of those
   terms. Keyword-heavy and lexically-matchable are not the same property,
   and the Open questions bullet conflated them.

**What would change this call.** The evidence is thin in a specific,
recoverable way: three queries, 38 pages, no comparison against the thing it
would replace. Any of the following is new evidence — (a) the same three
queries run against a populated pgvector index, showing embeddings do or do
not clear the Q1 vocabulary gap; (b) a larger recorded query sample, since
three is a weak basis for a distributional claim and two of them contain
out-of-corpus terms; (c) FTS as a *supplement* rather than a replacement,
which this session did not test at all and which its results do not argue
against; (d) the same three queries reformulated into the book's own
vocabulary — tests whether the failure is FTS-as-a-mechanism or the query's
vocabulary, since 3.6 found `perception`/`diagnosis`/`INT` occur zero times
in the corpus regardless of matching method. Untested here; ties to the open
question above on Warden query vocabulary.

**What this session does not show.** It does not show the block-merge chunker
is *right* — that remains unvalidated, per the preamble. It shows only that
FTS on page-granular text is not good enough to justify dropping it. Nor
does it show FTS is worthless: with length normalization it put the correct
page in the top 3 for both queries that had a lexically reachable answer.

**Two findings that outlive the FTS question**, both affecting the embedding
path identically:

- **14 of 32 `Table` blocks carry no text** (3.2), costing two body pages
  entirely. No chunking or retrieval strategy compensates for content that is
  absent from the extraction.
- **Warden query vocabulary diverges from book vocabulary** (3.6). This is a
  retrieval-design problem, not an FTS problem, and it is currently
  unaddressed on either path. It deserves its own open question.

#### 3.10 Teardown

```sql
DROP TABLE IF EXISTS spike_fts_page;
```

Verified gone from `pg_tables`; `flyway_schema_history` shows 0 failed
migrations, i.e. the scratch table left no trace on migration state. No
production code path, schema, or migration was touched at any point.

The spike scripts were not committed — they are throwaway JSON-shuffling, and
the schema and both query forms are reproduced above in full, which is what
this session needs to be repeatable. The marker artifact remains outside the
repository per `docs/rules-ingestion.md § Licensing Posture`.


### S4 — 2026-08-05 · Vocabulary vs. verbosity, isolated

Context: [S3.9](#39-conclusion--unconvincing-as-a-replacement-on-this-evidence)
listed as evidence (d) "the same three queries reformulated into the book's
own vocabulary." This session runs it. The scratch table was rebuilt from the
same artifact and reproduced S3's corpus exactly — 38 rows, 76,803
characters — so S4 numbers are directly comparable to S3's.

**S4 qualifies S3.9's reasoning but does not overturn its verdict.** Read
3.9's item 2 alongside 4.4 below.

#### 4.1 Method

Three variants per query, to separate two confounded factors:

- **original** — verbatim, as recorded.
- **vocab-swapped** — only zero-occurrence terms replaced, everything else
  left alone. Length essentially unchanged.
- **core-only** — the distinctive terms alone, noise words dropped. Length
  cut to 2–3 terms.

Substitutions, each verified against corpus document frequency before use:

| Query | Out-of-corpus term | Replacement | Pages |
|---|---|---|---|
| Q1 | `perception` (0) | `intellect` | 5 |
| Q2 | `saving throw` (`throw` occurs only in the physical sense) | `saves` | 24 |
| Q3 | `INT` (0) | dropped — redundant with `intellect` | — |
| Q3 | `diagnosis` (0) | `pathology` | 1 |

Candidate replacements were screened by probing document frequency for ~40
plausible terms; `perception`, `observe`, `sensor`, `sight`, `diagnosis`, and
`technician` all occur on **zero** pages, which constrained the choices.

Each variant was run in four configurations (AND/OR × normalization 0/2), and
scored by **the rank position of the target page(s)** — the pages S3.7 judged
a Warden should have received. Targets: Q1 → physical 17; Q2 → 17, 18;
Q3 → 21–24.

#### 4.2 Results — position of the best target page

`—` means the query returned no rows at all.

| Query | Variant | AND n=0 | AND n=2 | OR n=0 | OR n=2 |
|---|---|---|---|---|---|
| Q1 | original | — | — | 24 | 24 |
| Q1 | vocab-swapped | — | — | 18 | 19 |
| Q1 | core-only | **2** | **2** | 13 | 11 |
| Q2 | original | — | — | **2** | **1** |
| Q2 | vocab-swapped | **1** | **2** | **2** | **1** |
| Q2 | core-only | **2** | **2** | **2** | **1** |
| Q3 | original | — | — | 5 | **2** |
| Q3 | vocab-swapped | — | — | 5 | **2** |
| Q3 | core-only | **1** | **1** | **1** | **1** |

**Vocabulary substitution alone accomplished almost nothing.** Q3's
vocab-swapped row is identical to its original row in every configuration.
Q2's OR columns are unchanged. Q1 improved from 24th to 18th — still nowhere
near the top 3.

**Shortening the query did nearly all the work.** Under core-only, the target
reaches position 1 or 2 under AND for all three queries.

#### 4.3 The two factors are separable, and both are necessary

Holding length short and varying only vocabulary isolates them cleanly:

| Query | Short query, original vocab | AND | OR | Short query, swapped vocab | AND | OR |
|---|---|---|---|---|---|---|
| Q1 | `perception check` | 0 hits | 17 | `intellect check` | **2** | 13 |
| Q2 | `saving throw stat check` | 0 hits | **2** | `stat check save` | **2** | **2** |
| Q3 | `skill diagnosis repair` | 0 hits | **1** | `skill pathology repair` | **1** | **1** |

The pattern is consistent across all three:

1. **A single out-of-corpus term zeroes an AND query outright**, regardless of
   how short or well-formed the rest is. All three original-vocab AND cells
   return no rows.
2. **Verbosity is what destroys OR ranking.** With 5–7 terms, the
   high-frequency tail (`check` on 22 pages, `save` on 24, `roll` on 24)
   dominates `ts_rank_cd` and buries the distinctive terms. Cutting to 2–3
   terms fixes Q2 and Q3 under OR without touching vocabulary at all.
3. **Correct vocabulary + short query + AND puts the target at position 1–2
   on every query tested.** That is the only configuration that worked
   across the board.

So the failure in S3 was not FTS-as-a-mechanism. It was the query.

#### 4.4 What this changes about S3.9

**The verdict stands: FTS is still not a drop-in replacement.** Nothing here
shows the Warden's actual queries work — they don't, in any configuration
tested. What changed is the *diagnosis*, and therefore what a fix would cost.

[S3.9](#39-conclusion--unconvincing-as-a-replacement-on-this-evidence) item 2
claimed the decisive failure was vocabulary and was "not fixable by tuning."
That is half right and, as stated, misleading:

- Correct that no *rank* tuning fixes it — 3.8's normalization sweep was the
  wrong lever, and S4 confirms it.
- **Wrong that vocabulary is the decisive factor.** Verbosity is the larger
  effect of the two. Vocabulary matters absolutely under AND (one bad term →
  zero rows) but barely at all under OR.
- Consequently the failure **is** fixable — by query preprocessing, not by
  ranking. Two transforms are needed: drop low-information terms, and map
  out-of-corpus vocabulary to the book's.

That second transform is the expensive one. Term-dropping is mechanical (a
stopword list, or a document-frequency ceiling computed from the index
itself). Vocabulary mapping is not: it needs a per-system synonym table, and
the **no-LLM-calls constraint rules out the obvious alternative** of asking a
model to rewrite the query. This is the same open question S3 raised about
Warden vocabulary, now with a measured cost attached.

#### 4.5 Caveats — read before citing this

- **The reformulations were written by someone who knew the target pages.**
  This is the generous case, and it is an upper bound on what query
  preprocessing could achieve, not an estimate of it. A real preprocessing
  layer has no answer key.
- **`core-only` is the most generous variant of all.** `intellect check`
  essentially names the mechanic. That it reaches position 2 rather than 1 is
  itself worth noting.
- Still three queries and 38 pages. Still no comparison against embeddings —
  evidence (a) in 3.9 remains the most valuable untested item, and S4 raises
  its value, since the whole question is now whether embeddings absorb
  verbosity and vocabulary drift for free.

#### 4.6 Teardown

`DROP TABLE IF EXISTS spike_fts_page;` — verified gone, migration state
untouched, as in 3.10.


### S5 — 2026-08-05 · Voyage/pgvector dense retrieval, same corpus and queries

Context: [S3.9](#39-conclusion--unconvincing-as-a-replacement-on-this-evidence)
listed as evidence (a) "the same three queries run against a populated
pgvector index." [S4](#s4--2026-08-05--vocabulary-vs-verbosity-isolated) raised
its value by leaving a fork open: is the verbosity/vocabulary problem a
property of *lexical matching*, or of the Warden's *queries*, inherited by any
backend? This session answers that.

**Headline: the problem is the queries, not the backend.** Dense retrieval
beats FTS substantially on the decisive query and still misses it. Shortening
the query fixes all three on both backends.

#### 5.1 Setup

Corpus reconstructed from the same S1 artifact and hard-asserted against
S3.1's numbers before anything ran — **38 pages / 76,803 characters, exact
match**. The script exits rather than proceed on drift, since a silently
different corpus would invalidate the whole comparison. Pages 11/12 remain
absent per [S3.2](#32-new-finding--14-of-32-table-blocks-carry-no-text); fixing
that is deliberately out of scope here.

```sql
CREATE TABLE spike_embed_page (
  page_number int PRIMARY KEY,
  page_text   text NOT NULL,
  embedding   vector(1024)
);
```

No IVFFlat/HNSW index — same reasoning as [S3.3](#33-scratch-schema)'s no-GIN
call, plus an approximate index would add an accuracy confound.

Embeddings came from the production `VoyageService`
(`apps/zoltar-be/src/voyage/voyage.service.ts`), not a reimplementation, so
`input_type` is production's: `document` for the 38 pages, `query` for each
query string. Model `voyage-4-lite` per `docs/decisions.md § Embedding model`;
returned dimension asserted at **1024**, matching the column. Ranking is
plain cosine distance over the full corpus:

```sql
SELECT page_number, embedding <=> $1::vector AS distance
FROM spike_embed_page ORDER BY distance;
```

Targets are S4.1's, unchanged: Q1 → 17; Q2 → 17, 18; Q3 → 21–24.

#### 5.2 Primary result — the three real queries, unmodified

Rank position of the best target page, out of 38. FTS columns are the *best
result across every configuration S3/S4 tried*, which is generous to FTS.

| Query | FTS best (S3/S4, any config) | **Dense (unmodified query)** | Top 3? |
|---|---|---|---|
| Q1 perception/noticing | 24th original, 18th vocab-swapped | **9th** | no |
| Q2 saves/stats/rolling | 1st (OR n=2) | **1st** | yes |
| Q3 skills/INT/repair | 2nd (OR n=2) | **3rd** | yes |

Dense retrieval's top 3 for Q1 were `EXAMPLE OF PLAY`, `RANGE & DISTANCE`, and
`PANIC CHECKS` — thematically in the neighbourhood of moving through and
observing an environment, but not the page that adjudicates it.

**Q1 does not clear the top 3.** It improves markedly over FTS — 24th to 9th,
and it is at least ranking on *meaning* rather than on `check` frequency — but
9 of 38 is not close to a top-3 budget. Per the brief's decision criteria this
is the second branch, not the first.

#### 5.3 Dense retrieval is sensitive to both axes — it does not absorb them

Repeating S4's three variants against the dense index:

| Query | original | vocab-swapped | core-only |
|---|---|---|---|
| Q1 | 9th | 4th | **1st** |
| Q2 | 1st | 1st | **1st** |
| Q3 | 3rd | 1st | **1st** |

Monotonic improvement on both axes, for every query. This contradicts an
assumption the preamble and Open questions had been carrying:

- **Embeddings do not fully bridge the vocabulary gap.** Swapping
  `perception`→`intellect` moved Q1 from 9th to 4th, and
  `diagnosis`→`pathology` moved Q3 from 3rd to 1st. If dense retrieval were
  vocabulary-agnostic, those swaps would be no-ops. They are not. It bridges
  the gap *partially* — much better than FTS, which is structurally blind to
  it, but not for free.
- **Verbosity hurts dense retrieval too.** Cutting to 2–3 distinctive terms
  put the target at rank 1 for all three queries, including the Q1 that no
  other configuration on either backend has ever retrieved.

Compare against S4.2's FTS table and the shape is the same on both backends:
**short and on-vocabulary wins; long and off-vocabulary loses.** FTS is more
brittle (an out-of-corpus term zeroes an AND query outright; verbosity buries
the signal under high-frequency terms), but the direction of every effect is
identical. That is the fork S4 left open, closed: this is a property of the
Warden's queries, not of lexical matching.

#### 5.4 Latency — the API call is the entire budget

Measured per query, warm:

| Component | Time |
|---|---|
| `VoyageService.embed(..., 'query')` | 122–145 ms |
| pgvector scan + `ORDER BY` (38 rows, no index) | 1–3 ms |
| **Total** | **124–148 ms** |

Inside `docs/rules-ingestion.md § Query Time`'s ~100–200 ms budget, but with
little headroom, and **the Voyage round trip is ~98% of it**. The vector scan
is free at this scale. Two consequences worth carrying forward: index choice
is not the lever for query latency at anything like this corpus size, and any
design that adds a *second* network round trip to the lookup path (a reranker,
say) does not fit the stated budget without revisiting it.

Corpus embedding cost, for planning: 38 documents at concurrency 4.

#### 5.5 Incidental — a similarity floor may be derivable after all

`docs/specs/zoltar/013-m7.5-rules-retrieval-quality.md § Part 4` leaves the
similarity floor open, and the preamble notes there is currently no threshold
at all. The top-1 cosine distances here separate more cleanly than expected:

| Query | Top-1 distance | Is it answerable by this book? |
|---|---|---|
| Q2 | 0.459 | yes — and correct at rank 1 |
| Q3 | 0.582 | yes — correct page at rank 3 |
| Q1 | 0.671 | the book has no `perception` concept at all |

The query the book cannot really answer has a visibly worse best match.
Three data points is not a threshold, and this was not what the session set
out to measure — but it suggests the floor question is answerable from data
rather than by guessing, and that the fixture set should deliberately include
unanswerable questions when it is built.

#### 5.6 Conclusion

**This supports the brief's second outcome.** Q1 still misses, so the fix was
never primarily about which retrieval backend to pick. Both backends fail the
same query in the same direction, and both recover completely when the query
is shortened to its distinctive terms.

What that implies, in order of confidence:

1. **Query formation is on the critical path, not a nice-to-have.** A
   preprocessing step — drop low-information terms, and map vocabulary — moved
   every query to rank 1 on dense retrieval. Nothing else tested in S3–S5 comes
   close to that effect size.
2. **Dense retrieval is still the better default**, and M7.2's core bet is not
   undermined: it beat FTS on the query that mattered by 15 positions, degrades
   gracefully rather than returning nothing, and needs no per-system synonym
   table to be useful. It just is not sufficient on its own.
3. **The cheapest half of the fix has no LLM-call problem.** Term-dropping is
   mechanical. Vocabulary mapping is the part that needs either a per-system
   synonym table or prompt-side guidance steering the Warden toward book
   vocabulary — and the latter is free, since the Warden's prompt is ours to
   write.

**What this does not show.** Still three queries and 38 pages, still
page-granular rather than the planned chunker, still one book. The variant
queries were written by someone who knew the answers
([S4.5](#45-caveats--read-before-citing-this)'s caveat applies unchanged and
is the main reason not to read the "rank 1 everywhere" column as a promise).
Nothing here evaluates chunking, which remains unvalidated.

#### 5.7 Teardown

`DROP TABLE IF EXISTS spike_embed_page;` — verified gone from `pg_tables`,
`flyway_schema_history` unchanged, as in 3.10 and 4.6. Scripts not committed;
the schema, the ranking query, and the `VoyageService` call path named above
are what make this reproducible.


### S6 — 2026-08-06 · LLM-assisted fixup discrepancy flagging

Context: whether an LLM comparing marker's block output against the source page
image can do useful triage for authoring `fixups.json`, instead of unaided
page-by-page review of all 44 pages. Pre-registered brief fixed the question,
method, and decision criteria before the run.

**The headline is not the flagging result.** Building the test set surfaced a
pervasive extraction defect that S1–S5 had only seen in one place, and which
bears directly on M7.2's chunker. That is 6.2; read it first.

**Scope.** No database objects, no production paths. This is an offline
*authoring* tool, outside `ingest.py`'s no-LLM-calls constraint — it runs once
per PDF edition, never per ingestion run.

#### 6.1 The negative control did not exist where the brief expected it

The brief nominated `STRESS` or `SKILLS` as clean-extraction controls, on the
reasoning that pages with no `Table` blocks should extract cleanly. Checking
before trusting them — the one step the brief flagged as mandatory — found
that absence of tables does not imply clean extraction:

| Physical | Printed | Chapter | Emitted order |
|---|---|---|---|
| 17 | 18 | `STAT CHECKS & SAVES` | sections **18.3 → 18.2 → 18.1**, chapter title last |
| 19 | 20 | `STRESS` | sidebars emitted before the chapter intro |
| 25 | 26 | `VIOLENT ENCOUNTERS` | sidebar emitted before the chapter intro |

Physical page 17 was confirmed against the rendered image: the page prints a
chapter banner, then 18.1 and 18.2 in two columns, then a boxed 18.3 at the
bottom. Marker emits that sequence **exactly reversed**, with the chapter
title last. It is the single highest-value page in the book by S3–S5's
measurements — the hand-judged target for both Q1 and Q2 — and its extracted
reading order is backwards.

A genuinely clean control was eventually found at physical 39 (printed 40,
`CONTRACTORS`): single-column, and its emitted order matches the printed order
exactly. That single/multi-column split is the likely mechanism, consistent
with [S1.5](#15-markdown-heading-levels-are-visual-not-semantic).

#### 6.2 New finding — reading-order scrambling is pervasive, not localised

[S1.5](#15-markdown-heading-levels-are-visual-not-semantic) and
[S1.7](#17-section_hierarchy-is-not-true-ancestry) found scrambled reading
order on the character-creation spread and treated it as a property of that
spread. It is not. Measuring objectively — pages carrying two or more numbered
section headers (`18.1`, `18.2`, …), checking whether marker emits them in
ascending order:

| | n |
|---|---|
| Pages with 2+ numbered section headers | 16 |
| Emitted in correct order | 8 |
| **Emitted out of order** | **8** |

The affected pages, with the emitted sequence:

| Physical | Printed | Chapter | Emitted |
|---|---|---|---|
| 10 | 11 | — | 11.2, 11.1 |
| 17 | 18 | `STAT CHECKS & SAVES` | 18.3, 18.2, 18.1 |
| 21 | 22 | `SKILLS` | 22.2, 22.1 |
| 22 | 23 | `SKILLS` | 23.2, 23.1 |
| 28 | 29 | `WOUNDS & DEATH` | 29.2, 29.1 |
| 30 | 31 | `RANGE & DISTANCE` | 31.3, 31.2, 31.1 |
| 31 | 32 | `SURVIVAL` | 32.4, 32.5, 32.1, 32.2, 32.3 |
| 32 | 33 | `SURVIVAL` | 33.2, 33.3, 33.4, 33.1 |

**This is a lower bound.** The heuristic only sees pages with two or more
*numbered* headers. Pages 19 and 25 are also scrambled but their sidebars carry
unnumbered headings, so they score as clean. The true rate across body pages is
higher than 8/16.

Every affected chapter is mid-play resolution content — precisely the
[query distribution](#what-the-warden-actually-asks) the Warden produces.

**Why S3–S5 did not catch this.** Those sessions built a page-granular corpus
and used bag-of-words FTS and mean-pooled embeddings, both of which are
order-insensitive at page scale. Block order was never load-bearing, so the
defect was invisible. It is invisible at page granularity and **fatal at chunk
granularity**: M7.2's design merges blocks *in emitted order* toward a
~400-token target
(`docs/plans/012-m7.2-rules-ingestion-implementation-plan.md § Part 2`). On
half the measurable pages that merge would concatenate sections backwards,
producing chunks that interleave unrelated material and open with the wrong
breadcrumb. The chunker cannot be built on this block order without an
intervening sort.

This supersedes nothing — S1.5 and S1.7 are accurate about what they examined.
It establishes that their finding generalises far beyond the spread they
examined.

#### 6.3 Method

Pages rasterized from the local PDF with `pypdfium2` (an existing pipeline
dependency) at 1424×2200 px — under the 2576 px high-resolution vision limit,
so nothing is downscaled server-side. Each call sends one page image plus that
page's block list (`id`, `block_type`, extracted text) and asks for a verdict.

Model `claude-opus-5`. The classification is enforced by a **structured-output
JSON schema** rather than requested in prose, so `discrepancy` is a validated
enum (`none | empty | garbled_table | reordered_text | missing_content`) and a
malformed flag cannot pass silently. Each verdict also carries `confidence`,
`severity`, `affected_block_ids`, and a structure-only `proposed_structure`.

Value-free discipline was instructed at the prompt level: describe
discrepancies structurally, refer to blocks by id and headings by numbering,
and for reconstructions give column headers and row labels only — never
values. It held on every call; no rules text appeared in any verdict.

Test set, five pages:

| Role | Physical (printed) | Basis |
|---|---|---|
| Positive — emptiness | 11 (12), 12 (13) | 13 empty `Table` blocks ([S3.2](#32-new-finding--14-of-32-table-blocks-carry-no-text)) |
| Positive — reordering | 17 (18) | Reversal confirmed against image (6.1) |
| Positive — reordering | 3 (4) | Character-creation spread ([S1.5](#15-markdown-heading-levels-are-visual-not-semantic)) |
| Negative — clean | 39 (40) | Single-column, order verified against image (6.1) |

The brief's optional "short but non-empty table" stretch case **does not exist
in this corpus**: the 18 non-empty `Table` blocks run 177–3618 characters, with
nothing between empty and substantial. Dropped rather than hunted for.

#### 6.4 Results — and three scoping errors before a clean read

Four runs. The first three differ only in which block types were sent; the
model's behaviour was consistent throughout, and every "failure" was an
artifact of the input, not the model.

| Run | Blocks sent | Control (phys 39) verdict | Severity |
|---|---|---|---|
| 1 | everything | `empty` — `PageHeader`/`PageFooter` carry no text | medium |
| 2 | `Text`/`Table`/`ListGroup` only | `missing_content` — headings absent | medium |
| 3 | all except `PageHeader`/`PageFooter` | `missing_content` — banner/footer absent | **low** |
| 4 | run 3 + scope stated in prompt | **`none`** | none |

Each verdict was *correct for the input given*. Run 1 flagged genuinely empty
header/footer blocks — true, but
[S1.8](#18-the-running-footer-is-the-reliable-provenance-source) established
marker strips those deliberately. Run 2 flagged missing headings — true,
because the pipeline's `Text`/`Table`/`ListGroup` filter drops `SectionHeader`,
which is real page content. Run 3 flagged the banner and footer callout as
having no block — true, because they had been excluded. Run 4 states the
exclusion in the prompt, and the control goes silent.

**The model never produced a false observation.** Every flag pointed at a real
difference between the image and the block list supplied. Precision was a
function of whether the block list matched the contract being audited — which
is a specification problem, not a model-capability one.

Run 4, the defensible configuration:

| Physical | Printed | Role | Verdict | Confidence | Severity |
|---|---|---|---|---|---|
| 39 | 40 | negative | `none` | high | none |
| 11 | 12 | positive | `empty` | high | high |
| 12 | 13 | positive | `empty` | high | high |
| 3 | 4 | positive | `reordered_text` | high | high |
| 17 | 18 | positive | `reordered_text` | high | high |

Four of four defects flagged with the correct class; the clean control silent.

Two qualitative observations worth more than the tally. On pages 11 and 12 the
pass reported the empty tables as dominant and **also** noted the emitted order
did not follow the printed arrangement — catching the 6.2 defect unprompted,
on pages where it was not the test target. And on page 3 it identified that
three class-modifier boxes each omit one printed line: a `missing_content`
defect nothing in S1–S5 had noticed, and precisely the "extracted as
plausible-looking but wrong" class the brief said had no documented instance.

**Severity ranked correctly at every stage.** Even in run 3, where the control
still fired, it fired at `low` against `high` for all four real defects. A
reviewer sorting by severity gets a usable worklist in every configuration
tested — which matters more than the binary flag, since the tool's job is to
shrink what a human reads, not to be right unaided.

Cost: ~33.6K input and ~3.8K output tokens per run over five pages, about
**$0.26**. A full 44-page pass is roughly **$2.30**. Cheap enough that the
brief's decision to skip a heuristic pre-filter is right.

#### 6.5 The fixup schema cannot express the defect it exists for

`ingestion/mothership/fixups.json` is `[]` — never populated. The schema in
`docs/rules-ingestion.md § Step 2` identifies a chunk by content:

```json
"match": { "section": ["Combat", "Panic"], "contains": "1-10Roll" }
```

Both keys fail against the confirmed defects. `contains` needs text to match
on, and the 14 defective `Table` blocks contain exactly `<p></p>` — there is
nothing to match. `section` derives from `section_hierarchy`, which
[S1.7](#17-section_hierarchy-is-not-true-ancestry) established is not real
ancestry and is already a Dead end. So the only documented mechanism for
correcting extraction cannot address the only confirmed extraction defects.

The fix is available and already load-bearing everywhere else in this work:
match on the **block `id`** (`/page/11/Table/5`), which is stable, unique, and
is the identifier [S1.6](#16-chunks-output-format-carries-typed-blocks) fell
back to when the `page` field proved meaningless. Recorded under Corrections
owed.

#### 6.6 Conclusion

**Decision criterion 1 is met: proceed to a full 44-page run.** The pass flags
known defects with correct classification and stays silent on a verified-clean
page, at a cost that makes a heuristic pre-filter unnecessary.

Three caveats on that result:

1. **It took three scoping corrections to get there.** The tool audits the
   block list against the image, so it can only be as precise as the contract
   it is told to audit. A production version needs the exclusion rules stated
   explicitly, and the *first* output of any new configuration should be
   treated as a check on the input, not on the model.
2. **One clean control is not a false-positive rate.** Five pages cannot
   measure precision. The meaningful number is the flag rate across all 44,
   and the disqualifying outcome is uniform high-severity flags — an
   unrankable worklist — not any individual flag on a clean page.
3. **The reconstruction output is not validated.** `proposed_structure` held
   the value-free line, but nothing here checked whether a proposed structure
   is *correct*. That needs its own pass before anything is promoted into
   `fixups.json`.

**The reordering finding (6.2) outranks all of this** and does not depend on
the flagging tool at all. It is a blocking input to the M7.2 chunker design,
not a fixup-authoring concern.

#### 6.7 Teardown

No database objects created; nothing to drop. Page images and the flags report
stayed in scratch and are not in the repository; the marker artifact remains
outside it per `docs/rules-ingestion.md § Licensing Posture`. Scripts not
committed — the schema, model, block scope, and prompt constraints recorded
above are what make this reproducible. No production path, schema, or
migration was touched.


### S7 — 2026-08-06 · Column-aware block sort: feasibility probe

Context: [S6.2](#62-new-finding--reading-order-scrambling-is-pervasive-not-localised)
established that marker's emitted block order is not reading order on
multi-column pages, and left the fix as a blocking open question with a
geometric sort as the untested candidate. This is that test. It is a
feasibility probe, not an implementation.

**Result: the candidate works. This does not need a spike — it needs
implementing against a test that already exists.**

#### 7.1 Why this is measurable without hand judgement

Unlike retrieval quality (S3–S5) and flagging quality (S6), block ordering has
ground truth already in the corpus: pages carrying two or more numbered
section headers (`18.1`, `18.2`, …) have an objectively knowable correct order.
That makes the S6.2 detector a **pass/fail oracle**, and any proposed sort
scoreable without a human in the loop.

#### 7.2 The sort

Every block carries a populated `bbox` (`[x0, y0, x1, y1]`), and
`page_info[N].bbox` gives page dimensions (396×612 pt for this book), so no new
dependency or data is needed. The candidate is ~25 lines:

1. Treat a block as **full-width** when its width ≥ 60% of page width.
2. Walk blocks in `y0` order. A full-width block flushes the current band and
   is emitted on its own; everything else accumulates into the current band.
3. Within a band, split by bbox x-centre against the page midline, then emit
   the left column top-to-bottom followed by the right column top-to-bottom.

#### 7.3 Result — 8/16 to 15/16, nothing regressed

| | Pages correct |
|---|---|
| Marker's emitted order | 8 / 16 |
| **After the sort** | **15 / 16** |

Fixed: physical 10, 21, 22, 28, 30, 31, 32 — i.e. `SKILLS` (both pages),
`WOUNDS & DEATH`, `RANGE & DISTANCE`, and `SURVIVAL` (both pages). **No page
that was already correct was broken.**

The single remaining failure is physical 17 (`STAT CHECKS & SAVES`), and it is
the boxed-callout case S6 predicted would be the hard one:

| Block | Width | % of page |
|---|---|---|
| `SectionHeader/13` (the `18.3` heading) | 163 pt | 41% |
| `Text/14` (its body) | 352 pt | 89% |

The boxed callout spans both columns, but only its *body* clears the
full-width threshold. The body therefore triggers a band break and the heading
does not, so the heading is bucketed into the left column and sorted between
18.1 and 18.2 — yielding `18.1, 18.3, 18.2`. Understood and local: bind a
`SectionHeader` to the block it introduces before banding, or detect the
enclosing box, then re-score.

#### 7.4 The oracle's coverage gap, and what closes it

**The numbered-header test sees only 16 of 44 pages.** The other 28 carry
unnumbered headings, and S6.1 already found two pages — physical 19 (`STRESS`)
and 25 (`VIOLENT ENCOUNTERS`) — that are demonstrably scrambled while scoring
as *clean* under this test, because their sidebar headings are unnumbered. A
green regression suite is therefore necessary but not sufficient.

[S6](#s6--2026-08-06--llm-assisted-fixup-discrepancy-flagging)'s flagging pass
closes that gap: it judges against the page image, so unnumbered headings are
no obstacle, and it already demonstrated the capability — correct
`reordered_text` on both reordering pages, plus unprompted secondary ordering
flags on physical 11 and 12 where ordering was not the test target. Suggested
division of labour:

| Layer | Cost | Coverage | When |
|---|---|---|---|
| Column-aware sort | — | the fix itself | in the pipeline |
| Numbered-header check | free | 16 pages | every commit |
| S6 flagging pass | ~$2.30 | all 44 | once per sort revision |

**Boundary worth keeping firm: the LLM validates the sort, it must not perform
it.** Ordering has to be recovered deterministically in `ingest.py`, which
makes no LLM calls. If some page genuinely defeats the geometry, the escape
hatch is an LLM-proposed ordering recorded once per edition as a `fixups.json`
entry keyed on block `id` and applied deterministically at run time — the same
positional matcher [S6.5](#65-the-fixup-schema-cannot-express-the-defect-it-exists-for)
already says the schema needs. Treat that as a fallback: hand-blessed orderings
do not generalise to the next book.

#### 7.5 Teardown

Read-only probe. No database objects, no production paths, no repository
artifacts. The sort is reproduced in prose above rather than committed, since
it belongs in the pipeline as real code rather than as a scratch script.


### S8 — 2026-08-06 · The real query distribution: 596 queries, not 3

Context: S3–S5 rest on **three** recorded `rules_lookup` queries, and
[S3.9](#39-conclusion--unconvincing-as-a-replacement-on-this-evidence) named "a
larger recorded query sample" as evidence item (b) — the second-most valuable
untested item. That sample exists. It is in the `unicorn-artifacts` repository,
which none of S1–S7 searched.

**This supersedes the sample, not the finding.** S3.6's vocabulary observation
survives at scale. What changes is the *diagnosis*, and therefore the fix.

#### 8.1 What is actually recorded

Extracted every `tool_use` block named `rules_lookup` carrying an
`input.query`, across all JSON/JSONL/Markdown in the artifacts repo. Tool
*definitions* (an `input_schema` with a `query` property) are excluded.

| | n |
|---|---|
| Files scanned | 739 |
| **Invocations** | **5,139** |
| **Distinct query strings** | **596** |

**Provenance caveat, and it matters.** All 5,139 come from `zoltar/eval-runs`
— none from playtests. The Warden still writes the query text, so these are
genuine Warden query *formation*; what is authored is the situation, not the
wording. But coverage reflects whatever the eval fixtures exercise, and
repetition reflects reps × models rather than independent asks (one query
string appears 181 times). **Read the distinct-query figures, not the
invocation-weighted ones** — the latter are dominated by fixture design. Both
are given below so the gap is visible.

The preamble's ["What the Warden actually asks"](#what-the-warden-actually-asks)
still shows only the three playtest queries. Those remain the only queries
recorded from *play*; these 596 are the only ones recorded at *scale*. Neither
set supersedes the other.

#### 8.2 The vocabulary finding holds — and the three-query sample was representative

Term coverage measured exactly as in [S3.6](#36-term-coverage--the-wardens-vocabulary-is-not-the-books):
`websearch_to_tsquery` lexemes, checked for presence anywhere in the same
38-page corpus.

The three original queries:

| Query | Terms in corpus |
|---|---|
| Q1 perception/noticing | 6 / 7 |
| Q2 saves/stats/rolling | 5 / 5 |
| Q3 skills/INT/repair | 5 / 7 |

Two of three carry at least one absent term — 67%. Against the 596:

| | Distinct | Invocation-weighted |
|---|---|---|
| Every term present in corpus | 252 (42.3%) | 2,455 (47.8%) |
| **≥1 term absent from corpus** | **344 (57.7%)** | 2,684 (52.2%) |
| No term present at all | 0 | 0 |

**58% against the small sample's 67%.** The three-query sample was not the
freak draw it might have been; S3.6 and
[S5.3](#53-dense-retrieval-is-sensitive-to-both-axes--it-does-not-absorb-them)
generalise. Note also that **no query is entirely out-of-corpus** — every one
of the 596 has some lexical purchase, which is why FTS never returned zero
under OR semantics.

#### 8.3 New finding — most of the gap is missing *concepts*, not wrong *words*

S3.6 framed the gap as vocabulary mismatch: the Warden says `perception`, the
book says `Intellect`. At scale that framing is only partly right. The most
frequent absent terms:

| Absent lexeme | Invocations |
|---|---|
| `suppress` | 848 |
| `stealth` | 366 |
| `initi` (initiative) | 231 |
| `threshold` | 174 |
| `difficulti` | 149 |
| `shutdown` | 116 |
| `npc` | 107 |
| `percept` | 87 |
| `flank` | 45 |
| `oppos` (opposed) | 44 |

Probing the corpus for book-side equivalents separates two classes that need
different fixes:

| Warden concept | Book-side evidence | Class |
|---|---|---|
| initiative | `initi`=0, but `turn`=5, `order`=5, `round`=7 — and the book prints a `26.1 TURN ORDER` section | **wrong word** |
| stealth | `stealth`=0, but `sneak`=1, `hide`=3, `hidden`=1, `quiet`=1 | **wrong word**, thin coverage |
| cover | `cover`=7 | present |
| android | `android`=8, but `shutdown`=0 | partly present |
| suppressive fire | `suppress`=0, `autofir`=0, `burst`=0; only `spray`=2, `automat`=2 | **concept absent** |
| flanking | `flank`, `surround`, `behind`, `position` all 0 | **concept absent** |
| opposed rolls | `oppos`, `contest`, `versus` all 0 | **concept absent** |
| difficulty numbers | `difficulti`, `threshold`, `target`, `dc` all 0 | **concept absent** |

The last four are not synonym problems. The PSG resolves everything by rolling
under a stat, so "difficulty number", "DC", and "threshold" have no referent in
it; flanking and opposed rolls are not mechanics it has. The Warden is
importing a d20-shaped mental model — the same class of error
[S1.9](#19-incidental-observation--the-panic-mechanic-is-d20-not-d100) caught
when the spec assumed a d100 panic table.

**A synonym or thesaurus layer cannot fix the second class.** No mapping
retrieves a rule the book does not contain. That splits the open question
[S5.3](#53-dense-retrieval-is-sensitive-to-both-axes--it-does-not-absorb-them)
left behind into two problems with different answers:

1. **Wrong word** (initiative → turn order, stealth → sneak) — a per-system
   synonym table or prompt-side vocabulary guidance, as previously proposed.
2. **Absent concept** (suppressive fire, flanking, opposed rolls, difficulty
   numbers) — no retrieval fix exists. The correct behaviour is to return
   *nothing*, which the design already supports: "empty results are a supported
   outcome… returning something confidently wrong is not." That makes
   [S5.5](#55-incidental--a-similarity-floor-may-be-derivable-after-all)'s
   similarity-floor hint substantially more important than it looked — it is
   the mechanism for roughly half the query distribution.

Some absent terms also point outside this book: `shutdown` against `android`=8
suggests Warden's Operations Manual content, not a PSG gap.

#### 8.4 What this does and does not change

**Unchanged:** S3–S5's conclusions. Dense retrieval still beats FTS, query
shape is still the largest lever ([S4.3](#43-the-two-factors-are-separable-and-both-are-necessary),
[S5.3](#53-dense-retrieval-is-sensitive-to-both-axes--it-does-not-absorb-them)),
and the ordering work (S6–S7) is untouched. Nothing here was measured against
retrieval quality — this is a property of the *queries*, measured against the
corpus, with no retrieval run.

**Changed:** the sample size behind every vocabulary claim, and the diagnosis
of what the mismatch is.

**Now available and not yet done:** the 596 queries make the M7.2 eval harness
tractable in a way it was not before. Its fixtures no longer have to be
hand-authored — they can be *sampled from real Warden output*, which
[S5.3](#53-dense-retrieval-is-sensitive-to-both-axes--it-does-not-absorb-them)
specifically warned is the only way the harness can detect this class of
problem at all. They still need page labels, which do not exist. The eval-run
skew is a real limitation for that use: fixtures sampled from these would
inherit the fixtures' combat bias.

#### 8.5 Teardown

The scratch FTS table was rebuilt to reuse S3's exact coverage method and
dropped again; verified gone from `pg_tables`, `flyway_schema_history`
unchanged. No artifacts-repo content is reproduced here beyond query strings
and lexeme counts — the queries are Warden-generated text, not rulebook
content, and the corpus side is reported as counts only.


### S9 — 2026-08-06 · Wrong-word vs concept-absent, across all 596 queries

Context: [S8.3](#83-new-finding--most-of-the-gap-is-missing-concepts-not-wrong-words)
split the vocabulary gap into two classes by eye, on six illustrative terms.
This measures the ratio across the whole set, to decide whether the
vocabulary-mapping work or the mechanical-primer/similarity-floor work is the
higher-priority build. Extends S8's method; same corpus, same 596 queries.

**Headline: neither dominates, and they are not substitutes for each other.**
Of the 344 queries carrying an out-of-corpus term, **45.6% are fixable by a
vocabulary layer alone** and **37.8% contain at least one mechanic the book
does not have**, where no retrieval fix exists.

#### 9.1 Two corrections to S8's method

**A double-stemming bug.** S8 checked term presence with
`to_tsquery('english', lexeme)` on lexemes that `websearch_to_tsquery` had
*already* stemmed. Postgres stems them a second time — `surpris` → `surpri`,
`oppos` → `oppo` — so a term could fail to match its own tsvector entry. The
correct check is `to_tsquery('simple', …)`, or comparing lexeme sets directly.

Impact is small: **3 of 100** flagged terms (`decis`, `increas`, `explos`) were
false absents, and the headline query count moves from 344 to 343 of 596 —
57.7% to 57.6%. **S8's conclusion is unaffected.** Recorded because the bug is
easy to reintroduce, and because it silently understates corpus coverage.

**Section headings are not in the corpus.** The S3 corpus filters to
`Text`/`Table`/`ListGroup` ([S1.6](#16-chunks-output-format-carries-typed-blocks)),
which excludes all 169 `SectionHeader` blocks — 130 in scope after the S2 page
exclusions, 2,632 characters of section titles. Every session from S3 onward
has measured against a corpus with **no section titles in it**.

The term that exposed this was `surpris` (10 distinct queries, 65
invocations). The PSG prints a `26.2 SURPRISE` section, so the book plainly has
a surprise rule — but the words live only in a heading, so the corpus has no
lexical trace and every check since S3 has scored it absent.

Only **1 of the 100** terms is recovered by adding headings back, so this
changes no count materially. The implication for *retrieval* is larger and is
untested: section titles are the highest-signal topic labels in a rulebook and
are exactly what a keyword-heavy query is likeliest to match. That they were
absent from the corpus S3–S5 measured is a confound none of those sessions
knew about. Filed under Open questions.

#### 9.2 The term list

100 distinct out-of-corpus terms across the 344 queries — the hand-audit the
brief anticipated, and small enough to do exhaustively. Removing the 3 false
absents and the 1 heading-only case leaves **96 terms genuinely absent from the
whole book**.

#### 9.3 Three buckets, not two

The brief specifies wrong-word vs concept-absent. A third is unavoidable:
proper nouns, scenario fiction, and generic English carry no mechanical
referent at all. `alvarez`, `lieuten`, `mycotoxin`, `npc`, `layout`, `calcul`
are not rules the book is missing. Counting them as concept-absent would doom
every query that names an NPC, which would corrupt the roll-up in exactly the
direction that matters. **They are excluded from the roll-up** — they neither
help nor doom a query.

| Bucket | Terms | Basis |
|---|---|---|
| **wrong-word** | 25 | an in-corpus term carries the same mechanic |
| **concept-absent** | 33 | no in-corpus vocabulary expresses it |
| **not-a-rules-term** | 38 | no mechanical referent at all |

Every wrong-word call names the in-corpus substitute that justifies it, and all
25 were verified present at runtime — none rested on an assumed synonym:

| Term | Invocations | In-corpus substitute |
|---|---|---|
| `stealth` | 366 | `sneak`, `hide`, `hidden`, `quiet` |
| `initi` | 231 | `turn`, `order`, `round` — the book prints `26.1 TURN ORDER` |
| `threshold` | 174 | `stat`, `save` |
| `difficulti` | 149 | `stat`, `save`, `advantage` |
| `percept` | 87 | `intellect`, `sanity`, `notice` |
| `hp` | 40 | `health`, `wound` |
| `armour` | 14 | `armor` — a spelling variant, not a concept gap |
| `dc` | 5 | `stat`, `save` |

The concept-absent bucket is dominated by mechanics from other systems:
`suppress` (848 invocations), `autofir`, `burst`, `firefight`, `crossfir`;
`flank`, `surround`, `outnumb`; `oppos`, `contest`, `versus`; `grappl`,
`wrestl`; `opportun`, `margin`. The PSG resolves everything by rolling under a
stat, so there is no difficulty number, no opposed roll, no flanking bonus, and
no suppressive-fire rule for a mapping to point at. `shutdown` (116
invocations, against `android`=8 pages) points outside this book entirely —
Warden's Operations Manual content, not a PSG gap.

#### 9.4 Query-level roll-up

Per the brief, the worst case governs: one concept-absent term dooms a query
for a vocabulary layer regardless of what else is in it. Percentages are of the
**344**, not the full 596 — the 42.3% with no out-of-corpus term are not part
of this question.

| Bucket | Distinct queries | % of 344 | Invocations | % |
|---|---|---|---|---|
| **wrong-word only** | **157** | **45.6%** | 951 | 35.4% |
| **≥1 concept-absent** | **130** | **37.8%** | 1,416 | 52.8% |
| only non-rules terms absent | 57 | 16.6% | 317 | 11.8% |

**The two views disagree, and the distinct-query one is the honest one.**
Concept-absent is the minority by distinct query (37.8%) and the majority by
invocation (52.8%), because a single suppressive-fire fixture repeats across
reps and models — the fixture-design skew [S8.1](#81-what-is-actually-recorded)
warned about, showing up exactly where it was predicted.

Characteristic examples, by bucket:

- **concept-absent** — queries asking for suppressive fire, autofire, or android
  remote-shutdown mechanics. Nothing in the PSG answers these.
- **wrong-word** — queries pairing `stealth` with `initiative order`, or asking
  for "difficulty numbers" for skill checks. Every element maps onto a real PSG
  mechanic under different vocabulary.
- **non-rules only** — queries whose sole out-of-corpus term is `npc`, `ally`,
  or `trigger`. These are already answerable; the flag was noise.

#### 9.5 What this feeds

Read as a build-order input, with the caveat that this is a findings session
and not itself a decision:

- **The vocabulary layer addresses the largest single bucket** — 157 of 344
  queries, versus 130 needing the primer/floor. It is also the cheaper build:
  a per-system synonym table against ~25 identified terms, most of them
  high-frequency (`stealth`, `initiative`, `difficulty`, `perception` alone
  account for 833 invocations).
- **But it cannot substitute for the floor.** No mapping retrieves a rule the
  book does not contain, so 130 queries are unreachable by vocabulary work at
  any quality. For those, the correct behaviour is an empty result — which the
  design already calls a supported outcome, and which currently cannot happen
  because there is no threshold.
- **They are complementary, not competing.** Sequencing the vocabulary layer
  first is defensible on addressable-query count and cost; shipping it *without*
  a floor leaves a third of the flagged queries receiving three confidently
  wrong chunks.

**Caveats.** The term classification is a single-pass judgement call with no
second rater; the wrong-word/concept-absent boundary is genuinely fuzzy for a
handful (`defens`, `evas`, `passiv`, `exceed`). All queries remain eval-run
sourced, so the invocation weighting reflects fixture design. And nothing here
was measured against retrieval — this is a property of queries versus corpus.

#### 9.6 Teardown

Scratch FTS and header tables rebuilt to reuse S3's method and dropped again;
verified gone from `pg_tables`, `flyway_schema_history` unchanged. No
production path touched. No rulebook text reproduced — corpus evidence is
lexemes and counts only.


### S10 — 2026-08-06 · Column-aware sort implemented and re-scored

Context: [S7](#s7--2026-08-06--column-aware-block-sort-feasibility-probe) was a
feasibility probe that reproduced its sort in prose rather than committing it.
This is the implementation, in `ingestion/pipeline/chunk.py`, scored against
the same oracle. **No new algorithm** — S7's three rules, unchanged.

#### 10.1 Extraction reproduced

```
ingestion/.venv/bin/marker_single "<psg>.pdf" --output_dir <tmp> \
  --output_format chunks --disable_ocr --disable_image_extraction
```

17.1 s. 674 blocks, block-type tally identical to
[S1.6](#16-chunks-output-format-carries-typed-blocks) — Text 354,
SectionHeader 169, Picture 41, PageHeader 39, Table 32, ListGroup 23,
PageFooter 11, Caption 3, Form 1, PictureGroup 1. `page_info` carries
`bbox` `[0, 0, 396, 612]` per page, so page width needs no new source.
Marker 2.0.0 is reproducible across runs on this input.

#### 10.2 The oracle, re-scored on the shipped code

| | Pages correct |
|---|---|
| Marker's emitted order | 8 / 16 |
| **After `sort_reading_order`** | **15 / 16** |

Identical to S7.3, including which pages moved (10, 21, 22, 28, 30, 31, 32)
and which single page did not (17). **Nothing regressed.**

#### 10.3 New finding — page 17's residual defect never reaches a chunk

S7.3 left the one failure as understood-but-owed work: "bind a
`SectionHeader` to the block it introduces before banding, or detect the
enclosing box, then re-score." **That work is not owed, because the defect is
confined to a block type the pipeline drops.**

Page 17's sorted *content* blocks (`Text`, `Table`, `ListGroup` — the three
types that become chunks) come out in correct reading order:

| Order | Block | Belongs to |
|---|---|---|
| 1–3 | `Text/6`, `Text/9`, `ListGroup/12` | 18.1 STAT CHECKS |
| 4–6 | `Text/5`, `Text/10`, `ListGroup/11` | 18.2 SAVES |
| 7 | `Text/14` | 18.3 WHAT IS YOUR HIGH SCORE? |

The only misplaced block is `SectionHeader/13` (the `18.3` heading, 41% of
page width against its body's 89%), which lands between 18.1's column and
18.2's column. `SectionHeader` is dropped before chunking, so the oracle —
which measures *heading* order — reports a defect that the corpus cannot
contain.

**This is contingent, not permanent.** `roadmap.md` M7.5 carries two levers
that would put `SectionHeader` text back into play: breadcrumb composition
(appending marker's immediate `SectionHeader` to the footer chapter) and
`SectionHeader` blocks as indexable content in their own right. **Either one
makes page 17 a live defect again**, and the S7.3 refinement becomes owed
work at that point. Re-score this page before adopting either.

#### 10.4 Coverage caveat, unchanged

The numbered-header oracle still sees only 16 of 44 pages
([S7.4](#74-the-oracles-coverage-gap-and-what-closes-it)). Pages 19 and 25
score clean here and are known scrambled via unnumbered sidebar headings
([S6.1](#61-the-negative-control-did-not-exist-where-the-brief-expected-it)).
A green oracle remains necessary and not sufficient; the S6 flagging pass at
44-page scope is still the instrument that would close the gap, and is still
unrun at that scope.

#### 10.5 Teardown

Extraction written to a scratch directory outside the repository and left
there; no rulebook text, extracted output, or chunk content committed. The
sort and the footer parser ship as `ingestion/pipeline/chunk.py` with
`ingestion/tests/test_chunk.py` covering them (25 assertions, stdlib-only,
verified green in a venv containing nothing but `pytest`).


### S11 — 2026-08-06 · Block merge implemented; the 100–400 chunk expectation is wrong

Context: [S10](#s10--2026-08-06--column-aware-sort-implemented-and-re-scored)
shipped the sort. This is the merge — `chunk_blocks` in
`ingestion/pipeline/chunk.py` — run end to end over the same extraction, with
footer chapters from `pypdfium2` and the parameters
`docs/rules-ingestion.md § Step 4` specifies (~400-token target, 50–100 token
overlap, tables never split, chapter change forces a boundary).

#### 11.1 Result — 65 chunks, not 100–400

| | |
|---|---|
| Content blocks (`Text`/`Table`/`ListGroup`) carrying text | 371 of 409 |
| **Total content tokens in the book** | **20,353** (`cl100k_base`) |
| **Chunks produced** | **65** |
| Token distribution | min 39, median 340, mean 340, max 924 |
| Chunks over 400 tokens | 14 |
| Chunks spanning more than one page | 6 |
| Chunks with a breadcrumb and no body | 0 |

**The spec's Done When 2 ("expect 100–400 chunks for the PSG 1e") is not
reachable from the spec's own ~400-token target.** The two numbers were
written independently and are arithmetically incompatible: 20,353 tokens
against a 400-token target is a ceiling of ~50 chunks before overlap, and 65
with it. Landing inside 100–400 would require a target of **~200 tokens or
less** — a chunking change nobody has argued for, on a book that turns out to
be about a quarter the size the chunk-count guess implied.

[S1.6](#16-chunks-output-format-carries-typed-blocks) propagated the error
("409 content blocks … lands plausibly inside the spec's 100–400
expectation"). That inference silently equated *block* count with *chunk*
count; merging 409 blocks toward 400 tokens produces far fewer chunks than
blocks, not a comparable number.

**Recommendation: correct the expectation, not the target.** The 400-token
target is a stated retrieval heuristic with a rationale; the 100–400 chunk
count is an unvalidated guess with none. Chunk size is an explicit M7.5 lever
(`roadmap.md` M7.5, lever 1) and belongs there, tuned against
`task eval:retrieval` rather than against a number chosen to match a
docstring.

#### 11.2 What the oversized chunks are

All 14 chunks over 400 tokens are tables or table-adjacent, as designed —
"a `Table` that alone exceeds the target becomes its own chunk and is allowed
to be over." The three largest are the d100 trinket table (842 tokens), the
d100 patch table (843), and the equipment cost table (876), each intact.

**All 18 `Table` blocks that carry text appear whole, in exactly one chunk.**
Zero split, zero duplicated.

#### 11.3 FIREARMS and INDUSTRIAL EQUIPMENT produce zero chunks

[S3.2](#32-new-finding--14-of-32-table-blocks-carry-no-text) predicted this
from block-level evidence; it is now confirmed at chunk level. Physical pages
11 and 12 resolve chapters from their footers, but their block inventory is
`PageHeader` + `SectionHeader` + `Table` + `Picture` and **every one of their
13 `Table` blocks extracts with no text**, so nothing survives the content
whitelist:

| Chapter | Physical page | Content blocks with text |
|---|---|---|
| `FIREARMS` | 11 | 0 of 7 |
| `INDUSTRIAL EQUIPMENT` | 12 | 0 of 6 |

26 of the book's 28 chapters are represented in the index. These are the two
that are not. Equipment stats are a plausible Warden query, so this stays a
real gap — tracked, unscoped, and shipping absent per the spec's deferral.

38 content blocks book-wide carry no text, spread across 13 pages; pages 11
and 12 are the only ones where the loss is total.

#### 11.4 Correction to S1.8 — the chapter list omits `ARMOR`

The footer parse resolves **28** distinct chapter names, not the 27
[S1.8](#18-the-running-footer-is-the-reliable-provenance-source) enumerates.
Every name in that list is found; `ARMOR` (physical pages 13–14, printed
14–15) is additionally found and was missing from it. Chapter resolution
still covers 36 of 44 pages, and the 8 unresolved pages are exactly the set
S1.8 named (physical 0, 1, 2, 4, 10, 41, 42, 43). An enumeration slip, not a
parsing difference.

#### 11.5 Reading order holds through the merge

Spot-read two pages the sort fixed, end to end, at chunk level: physical 21
(`SKILLS`) and physical 30 (`RANGE & DISTANCE`). Both read forwards —
`SKILLS` runs definition → acquisition → cross-reference → caveat, and
`RANGE & DISTANCE` runs the band intro → Adjacent → the band list →
Close/Long/Extreme. The sort's benefit survives merging; it is not undone by
chunk boundaries.

#### 11.6 Teardown

Extraction and chunk output stayed in a scratch directory outside the
repository. No rulebook text, extracted output, or chunk content committed —
the numbers above are counts and structural metadata only.


### S12 — 2026-08-06 · First populated index; the `> 0.5` similarity bar is a bad guess

Context: the pipeline now runs end to end. `rules_chunk` holds 66 rows for
`mothership`, embedded with `voyage-4-lite` at 1024 dimensions. This session
records the first retrieval measurements taken against a **real populated
index** — the first in this log that are not scratch-table reconstructions.

#### 12.1 The run

`python ingest.py --system mothership --pdf <psg>` — exit 0, ~29 s wall clock
(marker ~23 s of it), 66 chunks, 0 NULL embeddings, 26 chapters, embedding
dimension 1024 checked against `game_system.embedding_dim` **before** the
`DELETE`. Re-running is idempotent: "replaced 66 existing rows with 66 new
rows," count unchanged.

**Six citations verified mechanically**, not by eye: a distinctive prose run
from each of six randomly-drawn chunks was searched for in the `pypdfium2`
text of the printed page its `source` cites. **6 of 6 found on the cited
page.**

Two initially read as failures and both were artifacts of the *check*, worth
recording because anyone re-running this verification will hit them:
marker and pypdfium2 disagree on typography. Marker renders the soft
hyphen in "coffin-like" as nothing (`coffinlike`); pypdfium2 renders it as
`\x02`. Apostrophes differ likewise (`'` vs `’`). Fold typographic
punctuation and strip control characters on **both** sides before comparing.
No control characters reach the index — 0 of 66 chunks contain one.

#### 12.2 The similarity distribution — 11 queries

Top-1 cosine similarity, `voyage-4-lite`, against the 66-chunk index. The
three `warden-observed` queries are the real recorded ones from
[S3.6](#36-term-coverage--the-wardens-vocabulary-is-not-the-books); the
unanswerable set is drawn from the concept-absent bucket
[S9.3](#93-three-buckets-not-two) identified.

| Class | Query | Top-1 | Top hit |
|---|---|---|---|
| authored | what happens when a character panics | **0.456** | p.21 PANIC CHECKS ✓ |
| authored | how do I make a stat check | 0.362 | p.18 STAT CHECKS & SAVES ✓ |
| authored | what are the range bands | 0.375 | pp.30-31 RANGE & DISTANCE ✓ |
| authored | how does armor work | 0.441 | p.28 |
| warden-observed | perception check looking around environment, noticing details | 0.355 | p.37 |
| warden-observed | saving throws stats how to roll checks | **0.527** | p.18 STAT CHECKS & SAVES ✓ |
| warden-observed | skill checks INT intellect saves diagnosis repair | 0.430 | p.18 |
| unanswerable | suppressive fire autofire rules | 0.226 | p.27 |
| unanswerable | flanking bonus when surrounding an enemy | 0.318 | p.27 |
| unanswerable | opposed roll contest between two characters | 0.380 | p.42 |
| unanswerable | android remote shutdown command | 0.246 | p.7 |

**The spec's Done When 3 bar — top result > 0.5 — is not a property this
model and corpus have.** One of seven answerable queries clears it, and the
one that does is not the one whose retrieval is most obviously correct.
Meanwhile the query the spec names as its own example ("panic check") returns
the correct page at ranks 1 *and* 2 while scoring 0.456. **Retrieval being
right and the score clearing 0.5 are close to unrelated here.** Like the
100–400 chunk count ([S11.1](#111-result--65-chunks-not-100400)), 0.5 was
written before anything was measured.

#### 12.3 The two distributions do separate — narrowly

| | n | min | max |
|---|---|---|---|
| answerable | 7 | 0.355 | 0.527 |
| unanswerable | 4 | 0.226 | 0.380 |

Encouraging for the floor question [S5.5](#55-incidental--a-similarity-floor-may-be-derivable-after-all)
raised, and **not yet sufficient to set one**. The bands overlap between
0.355 and 0.380: an answerable query sits at 0.355 and an unanswerable one at
0.380, so any threshold that excludes the worst unanswerable also excludes
two correct answerable queries. A floor near 0.32 would cut half the
unanswerable set while keeping every answerable one — but on eleven
hand-picked points that is a hypothesis, not a derivation.

This is exactly what the M7.2 retrieval harness exists to turn into a real
sample, and setting a floor from these eleven points would be the mistake the
harness was specified to prevent. **The floor stays M7.5's, unset.**

#### 12.4 Early signal on query style — do not over-read it

The one answerable query whose top hit is plainly wrong (`perception check…`
-> p.37) is the same query S3–S5 identified as the hard one, failing the same
way for the same reason: `perception` occurs on zero pages. Dense retrieval
over the real chunked index reproduces the finding the scratch page-granular
corpus produced. Four points per style is far too few for a rate, but the
qualitative story is unchanged, and the per-`queryStyle` split the harness
carries is the right instrument.

#### 12.5 Teardown

The index is left populated — it is the artifact this milestone exists to
produce. Provenance for it is in `ingestion/.ingest-manifest.json`
(gitignored): marker 2.0.0, `voyage-4-lite`, 1024 dimensions, 66 chunks,
400-token target, 50-100 token overlap, PDF SHA-256 recorded. No rulebook
text committed.


### S13 — 2026-08-06 · Query preprocessing shipped; it moves the wrong distribution

Context: document-frequency term-dropping now runs before every
`rules_lookup` embedding call (`apps/zoltar-be/src/rules/query-preprocess.ts`),
at the spec's proposed 40% ceiling with a 2-word floor. This is the first
measurement of the **automated** trimming. [S4](#s4--2026-08-05--vocabulary-vs-verbosity-isolated)
measured **hand-authored** trimming by someone who already knew the target
page, and [S4.5](#45-caveats--read-before-citing-this) flagged that as an
upper bound. This session is what the automated approximation actually does.

#### 13.1 The mechanism works as specified

Against the real 66-chunk index, document frequencies come out as expected —
`check` 47%, `saving` 58%, `roll` 61%, `saves` 58%, `character` 64%, against
`perception` 0%, `INT` 0%, `diagnosis` 0%, `intellect` 9%, `panics` 24%.

High-frequency terms are dropped and distinctive ones survive; an
all-high-frequency query (`the character makes a check roll`, every term
47-64%) still embeds `makes check` rather than an empty string. Spec Done
When 11 is satisfied in both halves.

#### 13.2 But the effect on retrieval is not the expected one

| Query | Before | After | Embedded as |
|---|---|---|---|
| perception check looking around environment… | 0.355 p.37 | 0.351 p.31 | perception looking around environment noticing details |
| saving throws stats how to roll checks | 0.527 **p.18** | 0.291 **p.18** | throws stats |
| skill checks INT intellect saves diagnosis repair | 0.430 p.18 | 0.348 p.35 (p.18 → rank 3) | skill INT intellect diagnosis repair |
| what happens when a character panics | 0.456 **p.21** | 0.340 **p.21** | happens panics |

The two queries whose correct page is known (`p.18` STAT CHECKS & SAVES,
`p.21` PANIC CHECKS) **keep their correct top hit**. The other two move
between pages whose correctness is not established, which is precisely the
gap the labeled fixture set exists to close — do not read them as either
improvement or regression.

**Similarity drops on every one.** Shorter queries embed to lower cosine
similarity. That much is unambiguous across all four.

#### 13.3 The structural problem — it shortens answerable queries and not unanswerable ones

Running the same four unanswerable queries from
[S12.2](#122-the-similarity-distribution--11-queries):

| Query | Before | After | Preprocessing |
|---|---|---|---|
| suppressive fire autofire rules | 0.226 | 0.226 | no change |
| flanking bonus when surrounding an enemy | 0.318 | 0.318 | no change |
| opposed roll contest between two characters | 0.380 | 0.195 | trimmed |
| android remote shutdown command | 0.246 | 0.245 | no change |

**Three of four are untouched**, and the reason is structural rather than
incidental: a query about a mechanic the book does not contain is built from
terms the book does not contain, so none of them clears a document-frequency
ceiling. Preprocessing fires on *answerable* queries almost exclusively,
because those are the ones whose vocabulary the corpus actually shares.

The consequence for the floor question:

| | Before | After |
|---|---|---|
| answerable | 0.355 – 0.527 | 0.291 – 0.351 |
| unanswerable | 0.226 – 0.380 | 0.195 – 0.318 |
| overlap | 0.355 – 0.380 | 0.291 – 0.318 |

The bands were already overlapping; they still are, and the answerable band
has been compressed down into the unanswerable one rather than pulled away
from it. **Preprocessing pushes down exactly the distribution a similarity
floor needs to stay high.** Any floor derived without preprocessing in its
final configuration will be derived against numbers that no longer exist.

#### 13.4 Why a document-frequency ceiling struggles on a single-book corpus

In a 66-chunk corpus covering one slim rulebook, the *topic* words are also
the *frequent* words. `saves`, `check`, `roll`, `stress` are boilerplate and
they are the mechanics being asked about. A frequency ceiling cannot separate
"frequent because it is filler" from "frequent because this book is about
it," so `saving throws stats how to roll checks` trims to `throws stats` —
discarding the word that names the mechanic. S4's hand-authored trim kept the
topic word and dropped the filler, which is the distinction the automated
version has no signal for.

This is a hypothesis about mechanism, consistent with four queries. It is not
a measurement, and it should not be treated as one.

#### 13.5 What this does and does not change

**Does not change:** the mechanism ships as specified. The 40% ceiling is
explicitly a proposed starting value in
`docs/specs/zoltar/012-m7.2-rules-ingestion.md § Part 7.3`, the harness is
the tool specified to sweep it, and eleven unlabeled queries are not grounds
for overriding a decided design.

**Does change** what the sweep is for. The threshold was expected to be tuned
for retrieval quality; it now also has to be evaluated for what it does to the
answerable/unanswerable separation, because those are not the same objective
and this data suggests they may pull in opposite directions. A higher ceiling
(60-70%), which would drop only genuine filler, is the obvious first sweep
point.

**Sequencing consequence:** the floor must be derived *after* the threshold is
settled, not alongside it. `roadmap.md` M7.5 lists both; this is evidence they
are ordered rather than parallel.

#### 13.7 Incidental — the ivfflat index under-returns at small `LIMIT`

Found while checking that `--limit` reached the repository. It is a
**pre-existing M7 defect**, unrelated to preprocessing, surfaced now because
this is the first time anything exercised a `limit` other than the default 3.

```
limit 1 -> 1 hit    limit 2 -> 1 hit    limit 3 -> 3 hits    limit 5 -> 5 hits
```

`EXPLAIN ANALYZE` names it exactly:

| LIMIT | Plan | Rows |
|---|---|---|
| 2 | `Index Scan using rules_chunk_embedding_idx` | **1** |
| 3 | `Seq Scan` + top-N heapsort over 66 rows | 3 |

`rules_chunk_embedding_idx` is `ivfflat (embedding vector_cosine_ops) WITH
(lists = 100)`, created in `V7__rules_index.sql` against an empty table. With
66 rows across 100 lists most lists are empty, and a default single-probe
index scan finds about one row. The planner picks the index at `LIMIT` ≤ 2 and
a sequential scan above it, so the defect appears and disappears with the
requested limit.

**`REINDEX` does not fix this** — it rebuilds with the same `lists = 100`.
pgvector's guidance is `lists ≈ rows/1000` with a minimum of 1; at this corpus
size the honest answer may be that the index should not exist at all, since
[S5.4](#54-latency--the-api-call-is-the-entire-budget) measured the sequential
scan at 1-3 ms.

**Impact today is narrow but the latent risk is not.** `rules_lookup` defaults
to `limit: 3` and its schema permits 1-5, so only an explicit `limit: 2`
misbehaves right now. But the plan/limit boundary is a cost-estimate artifact:
as the corpus grows the planner may choose the index at `limit: 3` too, and
the Warden would silently receive one chunk having asked for three. Fixing it
needs either a migration (declared out of scope for M7.2) or the ingestion
pipeline taking ownership of index DDL — a real decision, not yet made.

#### 13.6 Teardown

No schema change, no migration, no index rebuild. Measurements are query
strings, similarity scores, and page citations — no rulebook text.


### S14 — 2026-08-06 · The vector index swapped to hnsw; under-return fixed

Resolves the open decision in [S13.7](#137-incidental--the-ivfflat-index-under-returns-at-small-limit).
Decided with Alex: fix it with a migration rather than defer.

#### 14.1 What shipped

`V18__rules_chunk_hnsw_index.sql` drops `rules_chunk_embedding_idx` and
recreates it as `USING hnsw (embedding vector_cosine_ops)` with default
parameters. pgvector 0.8.5, Postgres 16.14.

**hnsw rather than a corrected `lists` value, because the `lists` value was
never the root cause.** ivfflat derives its cluster centroids from the rows
present when the index is built, and a migration builds it against an empty
table — so any `lists` chosen there is chosen against zero rows and needs
revisiting every time the corpus changes size, which M7.5's chunking iteration
is about to do repeatedly. hnsw builds incrementally and needs no per-corpus
tuning. `docs/schema.md` had already named hnsw as the intended escalation,
though for retrieval quality at scale rather than for this.

#### 14.2 Verification — row counts and exactness

Forcing the index path (`enable_seqscan = off`) and comparing against a
sequential scan forced the other way (`enable_indexscan = off`), same query
vector, for every limit `rules_lookup` permits:

| LIMIT | rows returned | identical to the exact answer |
|---|---|---|
| 1 | 1 | yes |
| 2 | **2** (was 1) | yes |
| 3 | 3 | yes |
| 4 | 4 | yes |
| 5 | 5 | yes |

Confirmed through the runtime path too — the probe returns *n* hits for
`--limit n`, 1 through 5.

#### 14.3 The index is not actually used at this corpus size, and that is fine

At 66 rows the planner chooses a sequential scan at every limit, and does so
even with `enable_seqscan = off` (it prefers a bitmap scan on
`rules_chunk_system_idx` plus a top-N heapsort over the HNSW scan). Execution
time 0.6 ms, consistent with [S5.4](#54-latency--the-api-call-is-the-entire-budget)'s
1-3 ms measurement.

So the practical fix is that **the pathological index is gone**, not that a
better one is now in use. Results are exact because nothing approximate runs.
The hnsw index is there for when the corpus is large enough that the planner
wants it, at which point it returns correct counts — `hnsw.ef_search` defaults
to 40, far above the tool's maximum limit of 5.

#### 14.4 Consequence for `store.py`

The post-ingestion `REINDEX` stays, with a different justification. It was
load-bearing for ivfflat (stale centroids after a full-corpus replace); for
hnsw it is graph compaction after `DELETE` + `INSERT` leaves entries for every
removed row. Cheap, offline, no reason to skip — but no longer a correctness
requirement.

#### 14.5 Teardown

Migration applied to the dev database and left applied; the index is a
permanent part of the schema. `docs/schema.md` updated to match, including
why the swap happened. No rulebook text.


### S15 — 2026-08-06 · First measured retrieval baseline; DF trimming has no useful setting

The M7.2 retrieval harness (`task eval:retrieval`) run against a labelled
fixture set for the first time. **This is the baseline M7.5's quality bar is
set against**, and the first retrieval-quality number this project has ever
had.

#### 15.1 The fixture set

49 fixtures: **37 answerable, 12 unanswerable; 25 warden-observed, 24
authored.**

The 25 warden-observed queries were sampled from real recorded `rules_lookup`
calls in `unicorn-artifacts` (`§ S8`), capped at 5 per M7.4 failure-mode tag
and then pruned — see 15.5 for why pruning was needed. The 14 authored
queries cover one or two per major chapter. The 12 unanswerable ones are the
concept-absent bucket `§ S9.3` identified.

**Labelling basis, stated because it determines what the numbers mean.**
Pages come from the book, never from the index: the chapter→page map is the
PDF's own running footer, and every "unanswerable" label was verified by
confirming the mechanic's vocabulary appears on **zero** pages — `suppressive`,
`flank`, `opposed`, `difficulty`, `grappl`, `opportunit`, `spell`, `magic`,
`starship combat`, `shutdown`, `autofire` all check out. `expectedPages` lists
every page that would legitimately answer, not only the best one; labelling
narrowly would manufacture false misses.

Two labels are worth flagging as judgement calls rather than lookups. The
`Instinct save` queries are **answerable** — `Instinct` is real, but it is the
Contractor/NPC catchall Stat (p.40), not a player Stat, and the "difficulty
threshold" half of those queries is concept-absent. And `ammo tracking weapon
fire rate` is labelled to pp.12/17 even though **p.12 is absent from the index
entirely** (all its `Table` blocks extract empty, `§ S3.2`), so a miss there
measures the known extraction gap rather than a chunking failure.

#### 15.2 Baseline — the number M7.5's bar is set against

| Group | recall@3 | MRR | n |
|---|---|---|---|
| **all** | **94.6%** | 0.811 | 37 |
| authored | 100.0% | 1.000 | 14 |
| warden-observed | 91.3% | 0.696 | 23 |

These are the numbers at the shipped default after the review pass described
in 15.6 — i.e. with preprocessing effectively inert. The weakest tags are
`UNSURFACED-CHECK` (50.0%, n=2) and `OVER-RESOLUTION` (66.7%, n=3); both are
too small to read as rates, and both contain the exploration/perception
family `§ S3`–`§ S5` have flagged throughout.

**The style gap is 8.7 percentage points on recall and 0.30 on MRR**, which is
the finding the `queryStyle` split was added to make visible. Authored
questions score a perfect 100%; the Warden's own keyword-stuffed phrasing does
not, and it lands its hits lower in the ranking. An index measured only on
tidy questions would report a quality the Warden's real queries never see.

#### 15.3 Document-frequency trimming makes retrieval worse, at every setting that does anything

| `--df-threshold` | recall@3 | MRR | vs. off |
|---|---|---|---|
| 0.40 (shipped default) | 81.1% | 0.685 | **−10.8 pp** |
| 0.55 | 83.8% | 0.716 | −8.1 pp |
| 0.65 | 91.9% | 0.784 | — |
| 0.80 | 91.9% | 0.784 | — |
| **off (`--no-preprocess`)** | **91.9%** | **0.784** | baseline |

Per style, off vs. the 0.4 default: authored **100.0%** vs. 92.9%,
warden-observed **87.0%** vs. 73.9%.

**0.65 and 0.80 reproduce "off" exactly** — at those ceilings the mechanism
drops nothing, because the measured document frequencies cluster at 47–64%
(`check` 47%, `makes` 56%, `saves`/`saving` 58%, `roll` 61%, `character` 64%).
There is no gap between "filler" and "topic vocabulary" to put a threshold in.

So the range is not narrow, as [S13.4](#134-why-a-document-frequency-ceiling-struggles-on-a-single-book-corpus)
guessed — **it is empty**. Every setting is either harmful or inert. This
supersedes S13's "unproven, with a known structural downside": it is now
measured, on 37 labelled answerable queries, and the direction is negative.

The mechanism is not absurd — [S4](#s4--2026-08-05--vocabulary-vs-verbosity-isolated)'s
trimming really did help. But S4 trimmed by hand, knowing the target page, and
[S4.5](#45-caveats--read-before-citing-this) flagged that as an upper bound.
The automated ceiling picks different words: it turns `saving throws stats how
to roll checks` into `throws stats`, discarding the word that names the
mechanic, because in a one-book corpus `saving` is frequent *precisely because
the book is about saves*.

#### 15.4 No similarity floor separates answerable from unanswerable — in either configuration

| | answerable, correct hit | unanswerable | overlap |
|---|---|---|---|
| shipped default (inert) | 0.342 – 0.601 (n=35) | 0.270 – 0.416 (n=12) | 0.342 – 0.416 |
| trimming at 0.4 | 0.296 – 0.600 (n=30) | 0.196 – 0.416 (n=12) | 0.296 – 0.416 |

**Both overlap, and neither admits an honest threshold.** The unanswerable
maximum sits at ~0.416 either way, above the answerable minimum in both
configurations. Any floor that excluded the worst unanswerable query would
also discard correct answers.

This is the sample [S5.5](#55-incidental--a-similarity-floor-may-be-derivable-after-all)
wanted and [S12.3](#123-the-two-distributions-do-separate--narrowly) could only
gesture at with eleven hand-picked points. On 49 labelled fixtures the answer
is: **not yet.** Retrieval quality has to improve before a floor is worth
adding — which is a finding M7.5 can act on, not a gap in the measurement.

#### 15.5 Incidental — the sampler clusters near-duplicates

`sample-retrieval-fixtures.ts` sorts distinct queries alphabetically and caps
per tag. On this corpus that draws adjacent near-duplicates: eight variants of
`armor damage reduction…` across five tags, five of `Instinct save
difficulty…`, and two one-word queries (`Mothership`, `Combat`) carrying no
information. 45 stubs pruned to 25 usable.

Deterministic sampling is right — re-running must not churn a half-labelled
set — but the ordering key is wrong. Deduplicating by normalised token set
before capping would fix it. Not changed here: the pruning is a one-time cost
already paid, and changing the sampler now would renumber a fixture set that
is about to be frozen for M7.5's iteration.

#### 15.6 Labels corrected during review — and why recall went *up*

Three labels changed under review, and the direction of the change is worth
recording because it is counter-intuitive.

- `rq-006` and `rq-025` narrowed from `[18, 22, 23]` to `[18, 22]`. p.23 is
  `23.1 EXPERT SKILLS (+15)` / `23.2 MASTER SKILLS (+20)` — skill lists with no
  check mechanics on the page, and no listed skill bearing on the queries.
  p.22 was kept: it carries `22.1 NO SKILL (+0)` / `22.2 TRAINED SKILLS (+10)`
  and the "add your Skill Bonus … to roll under" rule, so it is mechanics plus
  a list rather than a list alone.
- `rq-003` corrected from `[14, 15, 29]` to `[28, 29]`. pp.14-15 are the ARMOR
  *equipment* chapter (items and their AP values); the mechanic for how armor
  applies to incoming damage is on p.28, `ATTACK & DEFENSE`.

**The criterion these settle on:** a page belongs in `expectedPages` if a
chunk from it would let the Warden *adjudicate* the query — not if it merely
mentions the topic. Too-broad labels convert near-misses into passes and
inflate recall; too-narrow ones manufacture misses. This is the rule to apply
when the set is extended.

Recall rose from 91.9% to 94.6% across this pass. Narrowing a label can only
ever turn a hit into a miss, so the rise came entirely from the `rq-003`
correction: retrieval had been returning p.28 for that query all along and the
old label scored it wrong. **The index did not change; the ruler did.** Worth
remembering when reading round-over-round comparisons in M7.5 — a label fix is
not an improvement.

#### 15.7 Run-to-run variance — recall is stable, MRR is not

Three consecutive runs at an identical configuration: recall@3 was 94.6% every
time, while MRR read 0.797, 0.824, 0.797. The 0.027 spread is exactly two
fixtures swapping ranks 1 and 2 (2 × 0.5/37), i.e. borderline-similarity
reordering between runs rather than any change in what was retrieved.

**Consequence for M7.5's method.** Its iteration is "change one thing, re-score,
compare." On a 37-fixture answerable set, a recall@3 movement of one fixture is
2.7 pp and appears stable; an MRR movement under ~0.03 is within observed
noise and should not be read as an effect. Either repeat runs before believing
a small MRR delta, or read recall@3 as the primary signal.

#### 15.8 Teardown

Fixtures committed (queries and page numbers, no rules text). Run artifacts —
which include returned chunk pages — go to
`$ZOLTAR_EVAL_ROOT/retrieval-runs/`, outside this repository. Index unchanged:
66 chunks, marker 2.0.0, `voyage-4-lite`, 400-token target.
