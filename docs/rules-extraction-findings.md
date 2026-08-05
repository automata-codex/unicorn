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

An FTS-based alternative to this whole approach is under consideration as of
2026-08-05 — see the last bullet under Open questions — and could relax the
block-merge requirement above if it pans out.

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

**Nothing about retrieval quality has been measured.** There is no recall
number, no baseline, no evidence any of this works. Everything in this file
so far is about getting text out of a PDF, not about whether the resulting
chunks retrieve well.

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
   retrieval design. ([S2](#s2--2026-08-05-character-creation-is-unreachable-to-the-warden))

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

---

## Open questions

- **Fallback chapter for the remaining 5 footer-less pages** (physical 0,
  1, 2, 10, 43 — down from 8: page 4 and its duplicates 41–42 are dropped
  outright, not resolved, per [S2](#s2--2026-08-05-character-creation-is-unreachable-to-the-warden)).
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
- **Should FTS (Postgres `tsvector`/`ts_rank`/`ts_headline`) replace or
  precede embedding-based retrieval as the primary `rules_lookup` mechanism?**
  Proposed 2026-08-05, on the strength of the recorded Warden queries being
  keyword-heavy rather than paraphrased ("What the Warden actually asks"
  above) and external evidence that FTS beats semantic search on
  keyword-anchored queries against a heterogeneous corpus
  (alexgs.me/posts/fts-is-the-workhorse). Not yet tested against this book
  or these queries — no session behind this bullet yet. If it holds up, it
  would relax rather than eliminate the chunking work: table atomicity and
  the S1.8 footer/chapter attribution stay necessary either way; the
  block-merge-toward-400-tokens design (the part [S1.5](#15-markdown-heading-levels-are-visual-not-semantic)–[S1.7](#17-section_hierarchy-is-not-true-ancestry)
  are currently blocking) would become optional rather than required.
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
