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
| `--pdf <path>` | yes | The book |
| `--database-url <url>` | yes* | Postgres connection string. Defaults to `$DATABASE_URL`; not needed with `--dry-run` |
| `--voyage-api-key <key>` | yes* | Defaults to `$VOYAGE_API_KEY`; not needed with `--dry-run` |
| `--voyage-model <model>` | no | Default `voyage-4-lite`. **Must be the same model the backend uses** — see below |
| `--skip-hash-check` | no | Skip PDF verification entirely (it only ever warns) |
| `--dry-run` | no | Extract and chunk, print a summary, stop before embedding or inserting. Costs nothing |

\* Required for a real run, but each falls back to its environment variable.

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
  templates/       # replacement text referenced by fixups
```

`system.json` holds the facts that differ per edition and must not be
hardcoded in the pipeline:

```json
{
  "source_label": "Mothership Player's Survival Guide",
  "page_offset": 1,
  "footer_format": "page-number-then-chapter"
}
```

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

Templates live in `<system>/templates/` and hold structural scaffolding —
column headers, row labels — that **you** populate from your own extraction.
No rules text is authored or distributed here. `docs/rules-ingestion.md §
Step 2` is the canonical spec.

Matching is on block `id` rather than on content because the defect this
exists for is blocks that extract with *no text at all* — there is nothing
for a content matcher to match. An entry that matches nothing logs a warning
rather than failing silently, since a fixup that quietly stopped applying
after a marker upgrade is the exact failure it exists to survive.

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
- **Five pages resolve no chapter** and are indexed with a page citation but
  no chapter breadcrumb.
- **No web UI.** The CLI is the supported path.
- **Chunking parameters are unvalidated.** The ~400-token target and 50–100
  token overlap are inherited heuristics, not tuned values.

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
