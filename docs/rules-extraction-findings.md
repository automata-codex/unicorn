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

### The book

Mothership Player's Survival Guide 1e. 44 pages, zine format, heavy display
type, multi-column, art-dense — a designed object rather than a reference
manual. 27 chapters (listed in [S1.8](#18-the-running-footer-is-the-reliable-provenance-source)),
32 tables, and content that ranges from procedural rules to stat blocks to
example-of-play dialogue to reference cards that duplicate body rules.

Its visual design is the root cause of most of this file: every structural
signal the extraction tool emits is derived from font size and reading order,
and both are unreliable here.

### The planned chunking approach

**Not yet built** — this is the design as of 2026-08-04, not something with
results behind it. Extract typed blocks from marker's `chunks` output
(`Text`/`Table`/`ListGroup`, dropping headers/footers/pictures), attach the
printed page number and chapter name from the PDF's running footer, then
merge blocks in order toward a ~400-token target with 50–100 tokens of
overlap. Chapter changes force a chunk boundary. Tables are never split. Each
chunk's text opens with a breadcrumb line naming its chapter. Full contract
in `docs/plans/012-m7.2-rules-ingestion-implementation-plan.md § Part 2`.

The 400-token target and the 50–100 overlap band are inherited heuristics
from `docs/rules-ingestion.md § Step 4`. They have never been validated
against anything.

An FTS-based alternative to this whole approach was considered and tested on
2026-08-05. It did not pan out — see [S3](#s3--2026-08-05--postgres-fts-gut-check-on-page-granular-text).
This design stands, still unvalidated.

**Three caveats this section cannot give you.** S3 found that extraction loses
14 of 32 tables outright, and that recorded Warden queries use vocabulary the
book does not contain — both upstream of chunking and untouched by anything
above. More seriously, **[S6.2](#62-new-finding--reading-order-scrambling-is-pervasive-not-localised)
found that marker's block order is not reading order on multi-column pages**
(8 of 16 measurable pages emit numbered sections out of order, including full
reversals). Merging blocks "in order", as this design specifies, would
concatenate sections backwards on half the body pages. **The design above
cannot be implemented as written until block ordering is solved** — see the
first bullet under Open questions.

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

**Nothing about retrieval quality has been measured *numerically*.** There is
still no recall number, no MRR, no baseline. Most of this file is about
getting text out of a PDF, not about whether the resulting chunks retrieve
well.

The exceptions are [S3](#s3--2026-08-05--postgres-fts-gut-check-on-page-granular-text)
and [S4](#s4--2026-08-05--vocabulary-vs-verbosity-isolated), deliberately
qualitative gut-checks: Postgres FTS over page-granular text, judged by hand
against the three recorded Warden queries. They are evidence about *FTS and
about query shape*, not about the planned chunker, and three hand-judged
queries is not a metric. Treat them as a disqualifying result for one
alternative plus a diagnosis of why, not as a measurement of the design in
place.

S4's finding generalizes beyond FTS and is the more important of the two: the
Warden's queries are long and keyword-stuffed, and that verbosity — not just
vocabulary — is what buries the right page.

[S5](#s5--2026-08-05--voyagepgvector-dense-retrieval-same-corpus-and-queries)
then ran the real Voyage/pgvector path over the identical corpus and closed
that question: **dense retrieval is sensitive to the same two axes.** It is
better than FTS — markedly so on the one query that discriminates — but it
does not absorb verbosity or vocabulary drift for free, and it still misses
that query's target page. Shortening the query to its distinctive terms puts
the target at rank 1 on *both* backends. So the single largest lever measured
so far is the shape of the query, not the choice of retrieval mechanism.

The measurement is planned: page-labeled fixtures scored deterministically
for recall@3, recall@5, and MRR, with deliberately unanswerable questions
included to see whether a similarity floor is derivable
(`docs/plans/012-m7.2-rules-ingestion-implementation-plan.md § Part 5`).
Fixtures are labeled by **page**, not chunk id, so they survive re-chunking —
which is what makes iterating on chunking measurable at all.

Practical consequence for brainstorming: an idea's cost is mostly "can we
score it with the existing fixtures?" Ideas that change what a *correct*
result means need the metric rethought before they can be judged, and that is
the expensive category.

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
    ([S6.2](#62-new-finding--reading-order-scrambling-is-pervasive-not-localised))
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
- **How should block reading order be recovered?** Blocking for the M7.2
  chunker, which merges blocks in emitted order
  ([S6.2](#62-new-finding--reading-order-scrambling-is-pervasive-not-localised)).
  Each block carries `polygon`/`bbox`, so a column-aware geometric sort
  (cluster by x-range into columns, then order by y within each) is the
  obvious candidate and needs no new dependency — but it is unvalidated, and
  full-width elements spanning columns (banners, boxed callouts like 18.3) are
  the case it has to get right. Until this is settled, the block-merge design
  cannot be implemented as specified.
- **Do the `Table` blocks that extract empty need fixing before M7.2 ships?**
  14 of 32 carry no text ([S3.2](#32-new-finding--14-of-32-table-blocks-carry-no-text)),
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

## Corrections owed to `docs/rules-ingestion.md`

The design doc predates any real extraction run. These are wrong, not merely
imprecise, and should be corrected when Part 5 of the implementation plan
touches that file:

- **§ Step 1** — the sample invocation `marker_single rulebook.pdf output/
  --langs English` uses a flag that no longer exists, and omits
  `--disable_ocr`, without which the command fails on a stock macOS install.
- **§ Step 4** — "Each `###` section is a candidate chunk" is not
  implementable against marker's output. The whole heading-tree premise
  needs replacing with the block-based approach in
  [S1.6](#16-chunks-output-format-carries-typed-blocks)/[S1.8](#18-the-running-footer-is-the-reliable-provenance-source).
- **§ Step 4** — `source` is described as e.g. `"Mothership Player's Survival
  Guide p.34"`, which is achievable, but only via the footer-derived page
  number. Worth stating where the number comes from, since the obvious
  candidates are all wrong (see Dead ends).
- **§ Step 2** — the fixup `match` schema (`{section, contains}`) cannot
  express either confirmed extraction defect. `contains` needs text, and the
  14 defective `Table` blocks hold exactly `<p></p>`; `section` derives from
  `section_hierarchy`, a Dead end. The schema needs a positional matcher on
  the block `id` (`/page/11/Table/5`) alongside the content one.
  ([S6.5](#65-the-fixup-schema-cannot-express-the-defect-it-exists-for))

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
