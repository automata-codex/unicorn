# Rules Ingestion Pipeline

Turns a rulebook PDF you own into the vector index that backs Zoltar's
`rules_lookup` tool. Offline, run by hand, one command.

This is the operational guide. `docs/rules-ingestion.md` is the design and
licensing reference; `docs/rules-extraction-findings.md` is the empirical
record of what was actually tried against real PDFs and what happened.

**You supply the PDF.** No rules text, extracted output, or pre-built index
for a non-SRD system ships in this repository, and none ever will — see
[Licensing](#licensing) below.

---

## Prerequisites

- **Python 3.11+** (3.12 is what CI runs).
- **PostgreSQL with `pgvector`**, already required by Zoltar itself. The
  `rules_chunk` table and its index come from the normal migrations; run
  `task flyway:migrate` if you haven't.
- **A Voyage AI API key.** Sign up at [voyageai.com](https://www.voyageai.com/),
  create a key, and export it as `VOYAGE_API_KEY`. Ingesting a 44-page book
  costs a fraction of a cent.
- **~1.2-1.3 GB of disk** for the virtualenv. `marker-pdf` pulls in torch and the
  surya model weights. Worth knowing before you run this on a small VPS.
- **A PDF with a real text layer.** Scanned books are not supported; see
  [Troubleshooting](#troubleshooting).

## Install

```bash
cd ingestion
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Versions are pinned. `marker-pdf` in particular is pinned deliberately:
extraction output varies between marker releases, and that variance changes
which fixup patches still apply. Bumping it is a decision to make on purpose,
not a routine refresh.

## Run it

```bash
export VOYAGE_API_KEY=<your key>
export DATABASE_URL="postgres://zoltar:zoltar@localhost:5432/zoltar"

python ingest.py --system mothership --pdf ~/books/players_survival_guide_1e.pdf
```

Or from the repository root, which reads `.env` for you:

```bash
task ingest -- --system mothership --pdf ~/books/players_survival_guide_1e.pdf
```

**Check your chunking for free first.** `--dry-run` extracts and chunks but
stops before spending anything:

```bash
task ingest -- --system mothership --pdf <path> --dry-run
```

It prints the chunk count, how many chunks resolved a chapter, and a preview
of the first chunk. On the Mothership PSG 1e expect **66 chunks across 26
chapters**, and extraction to take 20–30 seconds.

Re-running is safe and idempotent: the pipeline deletes the system's existing
rows and reinserts, so you never get duplicates.

## Flags

| Flag | Required | Meaning |
|---|---|---|
| `--system <slug>` | yes | Matches `game_system.slug`, and selects `ingestion/<slug>/` for this book's config, fixups, and hashes |
| `--pdf <path>` | yes† | The book |
| `--markdown <path>` | yes† | A hand-curated Markdown file instead of a PDF. Skips extraction, hash verification, and fixups — see [Curated Markdown input](#curated-markdown-input) |
| `--database-url <url>` | yes* | Postgres connection string. Defaults to `$DATABASE_URL`; not needed with `--dry-run` |
| `--voyage-api-key <key>` | yes* | Defaults to `$VOYAGE_API_KEY`; not needed with `--dry-run` |
| `--voyage-model <model>` | no | Default `voyage-4-lite`. **Must be the same model the backend uses** — see below |
| `--skip-hash-check` | no | Skip PDF verification entirely (it only ever warns) |
| `--dry-run` | no | Extract and chunk, print a summary, stop before embedding or inserting. Costs nothing |

\* Required for a real run, but each falls back to its environment variable.

† Exactly one of `--pdf` / `--markdown`. Supplying both, or neither, is an
argument error (exit 5).

### Chunking levers

Four flags change what lands in the index. Each overrides the same-named key
in `system.json`, which in turn overrides the built-in default.

| Flag | Default | Meaning |
|---|---|---|
| `--target-tokens <n>` | `400` | Approximate chunk size. An inherited heuristic, never validated — a sweep is cheap |
| `--overlap <min>,<max>` | `50,100` | Overlap band in tokens. Whole sentences from the end of the previous chunk, accumulated while they fit |
| `--drop-pages <n>[,<n>...]` | none | **Physical, 0-based** page indices to exclude from the index entirely — the same numbering `Block.page` uses, *not* the printed numbers in the footer |
| `--include-section-headers` | off | Index `SectionHeader` block text as content. Off by default: heading text is unreliable as *ancestry*, so the breadcrumb comes from the running footer instead |

**Config for decisions, flags for experiments.** A page exclusion that is a
settled property of the book belongs in `system.json` so it applies on every
run; a flag is for the one-off measurement you don't want to remember to
revert. That is the entire reason for the precedence order.

**Every one of these is recorded in `.ingest-manifest.json`**, and the
retrieval harness copies that into its report. A retrieval score compared
across two different chunking configurations is not a comparison — this is
the analogue of `corpusVersion` on the Warden eval side, and it is why the
manifest reports what actually ran rather than what the defaults say.

```bash
# Exclude the character-creation spread and index heading text, one run only
task ingest -- --system mothership --pdf <path> \
  --drop-pages 4,41,42 --include-section-headers --dry-run
```

`--drop-pages ''` explicitly means "drop nothing", which is how you turn off
a configured exclusion for a single measurement round.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | PDF not found or unreadable |
| `2` | Extraction failed, or produced too little text to be usable |
| `3` | Voyage API error, or an embedding whose width doesn't match `game_system.embedding_dim` |
| `4` | Database error |
| `5` | Invalid arguments |

### The embedding model must match the backend

`--voyage-model` has to be the **same model** as the backend's
`VOYAGE_EMBED_MODEL`, not merely one with the same output width. Two different
1024-dimension models produce similarity scores that look completely plausible
and mean nothing — the failure is silent, which is what makes it dangerous.
The pipeline checks the *width* against `game_system.embedding_dim` before it
writes anything, but nothing can check that you picked the same model.

## Adding a book

Each supported book is a directory under `ingestion/`:

```
ingestion/mothership/
  system.json      # edition-specific facts (below)
  fixups.json      # per-block corrections; currently []
  hashes/          # SHA-256 of known printings, one .txt each
  templates/       # replacement text referenced by fixups — GITIGNORED
```

`system.json` holds the facts that differ per edition and must not be
hardcoded in the pipeline:

```json
{
  "source_label": "Mothership Player's Survival Guide",
  "page_offset": 1,
  "footer_format": "page-number-then-chapter",

  "drop_pages": [4, 41, 42],
  "target_tokens": 400,
  "overlap_tokens": [50, 100],
  "include_section_headers": false
}
```

The first three keys are required. The last four are the chunking levers
documented above — all optional, and omitting one means the built-in default,
so a `system.json` written before they existed keeps producing exactly the
index it produced before.

`drop_pages` is where a *settled* exclusion lives. The Mothership entry above
carries physical pages 4, 41, and 42: the character-creation spread, which
`docs/decisions.md § Character-creation content is excluded from the rules
index` established the Warden structurally cannot reach — `rules_lookup` is
wired only into the play-loop tool array, and character creation makes no
Anthropic calls at all.

`page_offset` maps the physical page index to the printed page number
(`printed = physical + offset`). **Verify it for every new book.** It is the
single most likely thing to be silently wrong on a PDF that otherwise
extracts fine, and it corrupts every citation the Warden shows a player. Run
`--dry-run` and check the first chunk's `source` against the actual book.

### Recording a hash

```bash
# macOS
shasum -a 256 players_survival_guide_1e.pdf > ingestion/mothership/hashes/mothership-psg-1e.txt
# Linux
sha256sum players_survival_guide_1e.pdf > ingestion/mothership/hashes/mothership-psg-1e.txt
```

Strip any leading directory path so the file records a bare filename. Every
`.txt` in `hashes/` is checked, and a match against any one passes — so adding
your own printing is a one-file change.

A mismatch **warns and continues**. It usually means a different printing, not
a corrupt file, and with an empty `fixups.json` nothing is affected. Use
`--skip-hash-check` to silence it.

### Fixup patches

When extraction mangles a specific block, a fixup replaces it. Entries match
on the block's stable `id`:

```json
[
  {
    "description": "Panic table extracted with no text",
    "match": { "block_id": "/page/11/Table/5" },
    "replace_with_template": "panic_table.md"
  }
]
```

Templates live in `<system>/templates/` and hold whatever the mangled block
should have contained, which for a broken table is the table itself — book
text, transcribed by **you** from your own copy.

**`templates/*` is gitignored, and that is enforced rather than merely
intended.** `docs/rules-ingestion.md § What ships in the repository` says
extracted text does not ship, and a fixup template is extracted text that a
human retyped. An earlier version of this section claimed "no rules text is
authored or distributed here" while nothing stopped `git add` from committing
it; the ignore rule is what makes the claim true. `fixups.json` stays tracked —
block ids and template filenames carry no book text, the same posture as the
retrieval fixtures.

Consequence worth stating plainly: **your templates are not backed up by
anything in this repository.** They live on your disk, exactly as a curated
Markdown file does. `docs/rules-ingestion.md § Step 2` is the canonical spec.

#### Naming a template

Lowercase, underscores, `.md`, and named for **what the block contains, not
where it sits**: `armor_table.md`, `weapons_and_damage_table.md`.

Location-based names go stale. A block id is `/page/<n>/<Type>/<k>` where `k`
is an index into that page's blocks, so a marker upgrade that adds or drops a
block renumbers everything after it — and then `page_01_table_01.md` names a
block it no longer patches. `fixups.json` already carries the id-to-template
link, so the filename does not need to.

Avoid a bare page number for the same reason the rest of this pipeline does:
`armor_table_p2.md` does not say whether `2` is printed or physical, and that
ambiguity has caused real errors here. If you need to disambiguate two tables
of the same kind, spell it out — `armor_table_printed_p2.md`.

#### What goes inside a template

Whatever the block's text should have been. `apply_fixups` replaces the
block's `text` verbatim and keeps its `id`, type, page, and bbox.

For a `Table` block, write a real Markdown table — leading and trailing pipes,
separator row, title on its own line above it:

```
ARMOR
| ARMOR | COST | AP | O2 | SPEED | SPECIAL |
|---|---|---|---|---|---|
| Standard Crew Attire — Basic clothing. | 100cr | 1 | None | Normal | |
| Vaccsuit — Designed for outer space operations. | 10kcr | 3 | 12 hrs | [-] | Includes short-range comms… |
```

The extractor's own output for intact tables is looser than this — no
leading pipes, no separator. Matching it would buy consistency and nothing
else, because **nothing parses a template**: `apply_fixups` calls
`read_text().strip()` and stores the result. An aligned table with an explicit
separator is easier for the Warden to read back, which is the only consumer
that matters. The separator row costs ~30 characters of meaningless tokens in
the embedding, which is not measurable on a chunk this size.

**Do not use `#` heading markers.** A title goes on a bare line, as `ARMOR`
does above. This is the one place the two Markdown-ish inputs in this pipeline
genuinely diverge, and the failure is silent in opposite directions:

| | `templates/*.md` (fixups) | `--markdown` (curated input) |
|---|---|---|
| `### ARMOR` | literal text — the Warden sees `### ARMOR` | parsed as a `SectionHeader` block, which is **excluded from the corpus**, so the title vanishes |

So the same three characters are cosmetic noise in one file and delete your
title in the other. Templates are not documents; they are one block's text.

**Where a cell holds two lines in print**, join them with an em dash rather
than a space. `Standard Crew Attire Basic clothing.` reads as a garbled
phrase; `Standard Crew Attire — Basic clothing.` reads as a name and its
description, which is what the page shows.

Two things follow from `Table` blocks being atomic (`chunk.py` never splits
one): the whole template lands in a single chunk regardless of length, and
anything you omit is unreachable. Include the table's printed title if the
extraction lost it — `WEAPONS & DAMAGE` is absent from the corpus *and* from
the heading list, so nothing else will restore it.

**A missing template is a hard error, not a warning.** Adding an entry to
`fixups.json` before writing its template makes `ingest.py` fail with exit 5
until the file exists. That is deliberate — a fixup you meant to write and
forgot should stop the pipeline rather than quietly ingest the broken block —
but it does mean the two land together.

Matching is on block `id` rather than on content because the defect this
exists for is blocks that extract with *no text at all* — there is nothing
for a content matcher to match. An entry that matches nothing logs a warning
rather than failing silently, since a fixup that quietly stopped applying
after a marker upgrade is the exact failure it exists to survive.

## Curated Markdown input

```bash
task ingest -- --system mothership --markdown ~/psg-curated.md
```

The fallback for a book whose extraction is bad enough that transcribing it
beats iterating on the chunker. It skips extraction, hash verification, and
fixups, and feeds the file into the same chunking, embedding, and storage
path — the resulting index is structurally indistinguishable from one built
from a PDF.

**The pipeline ships this capability. No curated book ships with it.** A
curated file is enriched extracted text, which
[§ Licensing](#licensing) does not permit distributing. Yours lives on your
disk, is not version-controlled, and nothing in this repository backs it up.

Two consequences worth knowing:

- **It decouples your index from `marker-pdf`.** The pin stays load-bearing
  for the PDF path; it stops being load-bearing for a curated one.
- **It makes the pipeline testable without marker's model weights**, which is
  what `tests/test_markdown.py` exercises end to end in CI.

### The format

The file supplies the structure marker could not: a real heading hierarchy,
and explicit page markers.

| Markdown | Becomes |
|---|---|
| `<!-- page: 21 -->` | Sets the current page for everything after it. See the warning below |
| `# CHAPTER NAME` | Sets the chapter from here on — the curated equivalent of the running footer, and the `section_path` breadcrumb source. Emits no block of its own |
| `## …` through `###### …` | A `SectionHeader` block, indexed only with `--include-section-headers`, exactly as on the PDF path |
| A paragraph | A `Text` block. Wrapped lines stay one block; a blank line starts a new one |
| A run of `- ` / `* ` / `+ ` lines | One `ListGroup` block |
| A run of `\|…\|` lines | One `Table` block — atomic, never split, same as marker's |

```markdown
# STRESS

<!-- page: 20 -->

## 20.1 GAINING STRESS

Whenever a Contractor fails a Save, they gain one Stress.

- Failing a Save: +1 Stress
- Witnessing a death: +2 Stress

<!-- page: 21 -->

Stress carries between sessions and is only relieved by shore leave.

<!-- page: 22 -->

# PANIC CHECKS

Roll the Panic Die and add your Stress.

| ROLL | EFFECT |
|---|---|
| 1-3 | Steady |
| 4-6 | Shaken |
```

### Two rules the parser enforces rather than guesses at

**Page markers carry the *printed* page number** — the one on the paper, not
a 0-based index. The pipeline converts it using this book's `page_offset`, so
a curated file and a PDF of the same book agree about what "page 21" means
and you never have to think about physical indices.

**Content before the first page marker is an error, not a warning.** The
`source` citation (`"<label> p.21"`) is the only provenance the runtime ever
surfaces, and it is what the retrieval harness reads page labels out of. A
guessed page would corrupt every citation the Warden shows a player, silently.

**A chapter must begin at a page boundary.** `# CHAPTER` after content on the
same page is rejected, with the fix in the message. The chapter map is
page-granular — one chapter per page, the same shape the PDF's running footer
produces — so a mid-page chapter change cannot be represented, and left
unguarded it would silently re-label the prose above the heading. A wrong
breadcrumb is worse than none: it is embedded and read by the Warden, not
merely displayed.

If a real chapter genuinely starts mid-page, put the page marker at the
chapter break and accept that the page is cited for both, or leave the
break to the next page.

### What the manifest records

`sourceType: "markdown"`, a `markdownSha256`, a null `pdfSha256`, and a null
`markerVersion` — null because marker genuinely did not run, and recording
the installed version would imply that it had.

## Verifying the result

```bash
task eval:retrieval
```

Scores the index against page-labeled fixtures — recall@3, recall@5, MRR, and
the similarity distributions. Voyage calls only, no Anthropic calls. It needs
`ZOLTAR_EVAL_ROOT` set and fixtures for your system.

For a quick eyeball instead, query the database directly:

```sql
SELECT count(*) FROM rules_chunk
WHERE system_id = (SELECT id FROM game_system WHERE slug = 'mothership');
```

## Troubleshooting

**`SpawnError: llama-server binary not found`**
Marker's default path routes OCR through a llama.cpp backend this pipeline
doesn't install. The pipeline always passes `--disable_ocr`, so you shouldn't
see this — if you do, you're invoking marker directly rather than through
`ingest.py`.

**"extraction produced only N characters … below the floor"**
Your PDF has no usable embedded text layer — almost always a scan. Because
this pipeline disables OCR, a scanned book yields near-empty blocks rather
than an error, so this check exists to fail loudly instead of quietly
indexing nothing. **Scanned sources are not supported.**

**Healthy row count, but `rules_lookup` returns nothing or nonsense**
Rebuild the vector index:
```sql
REINDEX INDEX rules_chunk_embedding_idx;
```
The pipeline does this automatically after every run, so this should not
happen. If it does, check that the ingestion model and `VOYAGE_EMBED_MODEL`
are the same model.

**Marker fails to install**
It compiles native dependencies; some distributions need `build-essential`
and Python headers. Marker's own README is the better reference.

**Voyage rate limits**
A book of this size is a single API call, so limits are unlikely. Much larger
rulebooks may need batching work that has not been done yet.

**Citations point at the wrong pages**
Your `page_offset` is wrong, or the book's footer format differs. See
[Adding a book](#adding-a-book).

## Known limitations

- **Mothership PSG 1e is the only verified book.** The page-offset and
  footer-parsing logic is validated against it and nothing else. A different
  book may extract cleanly and still attribute pages or chapters wrongly —
  spot-check before trusting it.
- **No pre-built indexes ship.** Not for any system, SRD or otherwise, in this
  phase.
- **Some tables extract empty.** On the PSG, 14 of 32 `Table` blocks come out
  with no text, which removes printed pages 12–13 (FIREARMS, INDUSTRIAL
  EQUIPMENT) from the index entirely. Equipment stat queries will miss. This
  is a known, unresolved gap — see `docs/rules-extraction-findings.md § S3.2`.
  Two routes out of it, both available and neither taken yet: a fixup patch
  supplying the missing table text, or `--markdown` for the affected pages.
  `§ S19` measured a third (indexing section headings, which recovers p.12 as
  a side effect) and rejected it for costing more elsewhere than it recovers.
- **Five pages resolve no chapter** and are indexed with a page citation but
  no chapter breadcrumb.
- **No web UI.** The CLI is the supported path.
- **Chunking parameters are partly validated now.** `drop_pages` was swept in
  M7.5 and the character-creation and character-profile pages are excluded as
  a result; `include_section_headers` was tested and rejected. The ~400-token
  target and 50–100 token overlap remain inherited heuristics, never tuned —
  see `docs/rules-extraction-findings.md § S17`–`§ S19`.

## Licensing

You run this against a PDF you own, on your own infrastructure. That is the
whole model, and it is deliberate: a vector index is functionally equivalent
to distributing the rules text, because `rules_lookup` returns the source text
and injects it into Claude's context.

What ships here: the pipeline, fixup files and templates (no rules text), and
SHA-256 hashes of known editions. What does not: extracted text, chunk text,
or vector indexes for non-SRD systems. `docs/rules-ingestion.md § Licensing
Posture` has the per-system detail.

## Development

```bash
pip install -r requirements-dev.txt   # pytest only
pytest tests/
```

The tests are pure Python over synthetic data — no marker models, no Voyage
key, no database, no PDF — which is what lets them run in CI. `pipeline/chunk.py`
and `pipeline/extract.py` must therefore stay importable with nothing but the
standard library: no module-scope `import tiktoken`, no module-scope
`import pypdfium2`. If CI fails on a missing import, fix the import rather
than adding the package to `requirements-dev.txt`.
