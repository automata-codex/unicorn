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

**A caveat this section cannot give you, but the next one can:** S3 found that
extraction loses 14 of 32 tables outright, and that recorded Warden queries
use vocabulary the book does not contain. Both problems sit upstream of
chunking and are untouched by anything described above.

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

The one exception is [S3](#s3--2026-08-05--postgres-fts-gut-check-on-page-granular-text),
a deliberately qualitative gut-check: Postgres FTS over page-granular text,
judged by hand against the three recorded Warden queries. It is evidence
about *FTS*, not about the planned chunker, and three hand-judged queries is
not a metric. Treat it as a disqualifying result for one alternative, not as
a measurement of the design in place.

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
  Whether embeddings actually bridge this is assumed, not shown — the obvious
  next measurement, and cheap once any index is populated. Options if they
  do not: a system-specific synonym/thesaurus layer, or prompt-side guidance
  steering the Warden toward book vocabulary.
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
a Flyway migration, and dropped at the end of the session (3.9).

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
against.

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
