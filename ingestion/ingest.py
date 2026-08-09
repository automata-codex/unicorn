#!/usr/bin/env python3
"""Ingest a rules book into the `rules_chunk` vector index.

    python ingest.py --system mothership --pdf <path> --database-url <url>
    python ingest.py --system mothership --markdown <path>

Offline job, run by hand. Nothing here is on the GM turn's hot path, and
nothing here makes an LLM call — reading order is recovered by deterministic
geometry, not by a model (`docs/decisions.md § Reading order requires an
explicit column-aware sort; an LLM may validate it, never perform it`).

Two input paths, one back half. `--pdf` runs hash verification, marker
extraction, fixups, footer parsing, and the reading-order sort. `--markdown`
takes a hand-curated file that already supplies what all five recover, and
skips them; from `chunk_blocks` onward the two paths are identical code on
identical data, so a curated index is structurally indistinguishable from an
extracted one. See `ingestion/README.md` for the curated format.

Exit codes are part of the interface:

    0  success
    1  input document not found or unreadable
    2  marker extraction failed
    3  Voyage API error, or an embedding whose dimension does not match
       game_system.embedding_dim
    4  database error
    5  invalid arguments
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import NoReturn

from pipeline import embed, extract, fixup, hash as hashing, markdown, store
from pipeline.chunk import Chunk, chunk_blocks, sort_blocks_by_page

EXIT_OK = 0
EXIT_BAD_PDF = 1
EXIT_EXTRACTION = 2
EXIT_EMBEDDING = 3
EXIT_DATABASE = 4
EXIT_BAD_ARGS = 5

#: Must stay in sync with the backend's VOYAGE_EMBED_MODEL default
#: (`apps/zoltar-be/src/config/env.schema.ts`). The same *model*, not merely a
#: model of the same width — two 1024-dimension models produce similarity
#: scores that look plausible and mean nothing.
DEFAULT_VOYAGE_MODEL = "voyage-4-lite"

INGESTION_ROOT = Path(__file__).resolve().parent
MANIFEST_PATH = INGESTION_ROOT / ".ingest-manifest.json"

logger = logging.getLogger("ingest")


class _ArgumentParser(argparse.ArgumentParser):
    """Reports usage errors as exit 5, not argparse's default exit 2.

    Exit 2 is this pipeline's "marker extraction failed". Left alone, a typo
    in a flag would be indistinguishable from an extraction failure by any
    script checking the status code.
    """

    def error(self, message: str) -> NoReturn:
        self.print_usage(sys.stderr)
        print(f"{self.prog}: error: {message}", file=sys.stderr)
        raise SystemExit(EXIT_BAD_ARGS)


def build_parser() -> _ArgumentParser:
    parser = _ArgumentParser(
        prog="ingest.py",
        description="Ingest a rules PDF into the rules_chunk vector index.",
    )
    parser.add_argument(
        "--system",
        required=True,
        help="game_system.slug; selects ingestion/<system>/ for fixups, hashes, and config",
    )
    # Exactly one source. `--pdf` stops being unconditionally required, but
    # a mutually-exclusive *required* group keeps "neither" an argparse error
    # rather than something main() has to notice later.
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--pdf", type=Path, help="input PDF")
    source.add_argument(
        "--markdown",
        type=Path,
        help="curated Markdown input; skips extraction, fixups, and hash "
        "verification. See ingestion/README.md for the expected format",
    )
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL"),
        help="Postgres connection string (defaults to $DATABASE_URL)",
    )
    parser.add_argument(
        "--voyage-api-key",
        default=os.environ.get("VOYAGE_API_KEY"),
        help="Voyage API key (defaults to $VOYAGE_API_KEY)",
    )
    parser.add_argument(
        "--voyage-model",
        default=DEFAULT_VOYAGE_MODEL,
        help=f"embedding model (default {DEFAULT_VOYAGE_MODEL}; must match the backend's)",
    )
    parser.add_argument(
        "--skip-hash-check",
        action="store_true",
        help="skip PDF hash verification entirely (it only warns in any case)",
    )
    parser.add_argument(
        "--dump-headings",
        type=Path,
        metavar="PATH",
        help="extract the book's SectionHeader blocks to a JSON file and stop. "
        "These are excluded from the index by default, so they are the one "
        "thing a corpus query can never see — which makes them the cheapest "
        "check on whether the book has a rule for something. Costs no Voyage "
        "calls and touches no database.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="extract and chunk only; print a chunk count and preview, then stop "
        "before embedding or inserting. Costs nothing.",
    )

    # Chunking levers. Each overrides the same-named key in system.json,
    # which in turn overrides the built-in default. They exist as flags so a
    # sweep is one command rather than an edit to a config file that then has
    # to be remembered and reverted — see `docs/specs/zoltar/013-m7.5-rules-
    # retrieval-quality.md § Part 2`. Whatever is resolved here is what
    # `write_manifest` records, so every score carries the configuration that
    # produced it.
    levers = parser.add_argument_group(
        "chunking levers",
        "Override system.json. Recorded in the ingest manifest, so a "
        "retrieval score always names the configuration behind it.",
    )
    levers.add_argument(
        "--target-tokens",
        type=int,
        help="approximate chunk size (default 400)",
    )
    levers.add_argument(
        "--overlap",
        type=parse_overlap,
        dest="overlap_tokens",
        metavar="MIN,MAX",
        help="overlap band in tokens, e.g. 50,100 (default 50,100)",
    )
    levers.add_argument(
        "--drop-pages",
        type=parse_page_list,
        metavar="N[,N...]",
        help="physical (0-based) page indices to exclude from the index entirely",
    )
    levers.add_argument(
        "--include-section-headers",
        action="store_true",
        default=None,
        help="index SectionHeader block text as content, not just as topic "
        "labels the corpus never sees (default off)",
    )
    return parser


def parse_overlap(raw: str) -> tuple[int, int]:
    """``"50,100"`` -> ``(50, 100)``.

    Rejects a single value rather than guessing a band around it. The overlap
    is a *range* — whole sentences are accumulated from the end while they fit
    — so "50" has no unambiguous reading.
    """
    parts = raw.split(",")
    if len(parts) != 2:
        raise argparse.ArgumentTypeError(
            f"--overlap takes MIN,MAX (e.g. 50,100), got {raw!r}"
        )
    try:
        minimum, maximum = (int(part.strip()) for part in parts)
    except ValueError:
        raise argparse.ArgumentTypeError(
            f"--overlap values must be integers, got {raw!r}"
        ) from None
    return minimum, maximum


def parse_page_list(raw: str) -> frozenset[int]:
    """``"4,41,42"`` -> ``frozenset({4, 41, 42})``.

    **Physical, 0-based page indices** — the same numbering ``Block.page``
    uses, not the printed numbers in the footer. The two differ by
    ``page_offset`` and confusing them silently drops the wrong pages, so the
    flag help, the README, and this docstring all say so.
    """
    if not raw.strip():
        return frozenset()
    try:
        return frozenset(int(part.strip()) for part in raw.split(","))
    except ValueError:
        raise argparse.ArgumentTypeError(
            f"--drop-pages takes a comma-separated list of integers, got {raw!r}"
        ) from None


def load_system_config(system_dir: Path) -> dict:
    """Edition-specific facts the pipeline must not hardcode.

    Kept per-system so that adding a book is a new directory rather than a
    code change. ``page_offset`` and the footer format are properties of an
    edition, verified against the PSG 1e and nothing else.
    """
    config_path = system_dir / "system.json"
    if not config_path.exists():
        raise FileNotFoundError(
            f"no system.json for '{system_dir.name}' at {config_path}. It must "
            'contain at least {"source_label": ..., "page_offset": ...}.'
        )
    config = json.loads(config_path.read_text(encoding="utf-8"))
    for key in ("source_label", "page_offset"):
        if key not in config:
            raise KeyError(f"{config_path} has no '{key}'")
    return config


#: Built-in defaults for the chunking levers, in one place so that
#: ``resolve_chunking`` and ``chunk_blocks``' signature cannot drift apart
#: silently. Keys match both the ``system.json`` keys and the manifest
#: fields, deliberately: one name per concept, end to end.
CHUNKING_DEFAULTS = {
    "target_tokens": 400,
    "overlap_tokens": (50, 100),
    "drop_pages": frozenset(),
    "include_section_headers": False,
}


def resolve_chunking(args: argparse.Namespace, config: dict) -> dict:
    """Settle each chunking lever: CLI flag, else ``system.json``, else default.

    Precedence is fixed and stated because the two sources have different
    lifetimes. ``system.json`` is where a *decision* lives — the
    character-creation exclusion is a settled property of this book, not a
    thing to retype every run — while a flag is where an *experiment* lives,
    and an experiment must be able to override a decision for one run without
    editing (and then forgetting to revert) a config file.

    Returns a dict keyed exactly like :data:`CHUNKING_DEFAULTS`, which is
    what both ``chunk_blocks`` and ``write_manifest`` consume. The single
    return value is the point: a manifest built from separate lookups could
    disagree with the chunker about what actually ran, which is precisely the
    provenance failure M7.5's iteration cannot tolerate.
    """
    resolved = dict(CHUNKING_DEFAULTS)

    for key in resolved:
        if key in config:
            resolved[key] = config[key]

    if args.target_tokens is not None:
        resolved["target_tokens"] = args.target_tokens
    if args.overlap_tokens is not None:
        resolved["overlap_tokens"] = args.overlap_tokens
    if args.drop_pages is not None:
        resolved["drop_pages"] = args.drop_pages
    if args.include_section_headers:
        resolved["include_section_headers"] = True

    # Normalize whatever JSON gave us. `system.json` yields lists where the
    # chunker wants a tuple and a frozenset, and a mismatch here would surface
    # as a confusing failure deep in the merge rather than at the boundary.
    resolved["overlap_tokens"] = tuple(resolved["overlap_tokens"])
    resolved["drop_pages"] = frozenset(resolved["drop_pages"])
    resolved["target_tokens"] = int(resolved["target_tokens"])
    resolved["include_section_headers"] = bool(resolved["include_section_headers"])

    if len(resolved["overlap_tokens"]) != 2:
        raise ValueError(
            "overlap_tokens must be exactly two values (min, max), got "
            f"{resolved['overlap_tokens']!r}"
        )

    return resolved


def build_chunks(
    args: argparse.Namespace,
    system_dir: Path,
    config: dict,
    chunking: dict,
) -> list[Chunk]:
    """Source document -> chunks. Everything up to, but not including,
    spending money.

    Two front halves, one back half. The PDF path runs hash verification,
    marker extraction, fixups, footer parsing, and the column-aware reading
    order sort; the curated-Markdown path runs none of them, because a
    curated file supplies by construction what all five exist to recover.
    From ``chunk_blocks`` onward the two are the same code on the same data.
    """
    page_offset = int(config["page_offset"])

    if args.markdown is not None:
        blocks, page_chapters = markdown.parse_curated_markdown(
            args.markdown.read_text(encoding="utf-8"),
            page_offset=page_offset,
        )
        logger.info(
            "parsed %d blocks across %d pages from curated Markdown "
            "(no marker, no hash check, no fixups)",
            len(blocks),
            len({block.page for block in blocks}),
        )
        return _merge(blocks, page_chapters, config, chunking, page_offset)

    if not args.skip_hash_check:
        check = hashing.verify_pdf(args.pdf, system_dir / "hashes")
        hashing.log_result(check, args.pdf)
    else:
        logger.warning(
            "--skip-hash-check: not verifying the PDF against any recorded "
            "edition. Fixups may not apply cleanly to a different printing."
        )

    # The temp directory holds marker's output and nothing that outlives the
    # run; cleaned up on failure as well as success.
    with tempfile.TemporaryDirectory(prefix="zoltar-ingest-") as tmp:
        blocks, page_widths = extract.extract_blocks(args.pdf, Path(tmp))

    blocks = fixup.apply_fixups(
        blocks,
        fixup.load_fixups(system_dir / "fixups.json"),
        system_dir / "templates",
    )

    page_chapters = extract.read_page_chapters(args.pdf, page_offset=page_offset)

    # Marker's emitted order is not reading order on multi-column pages; the
    # curated path skips this because its file is in reading order already.
    ordered = sort_blocks_by_page(blocks, page_widths)
    return _merge(ordered, page_chapters, config, chunking, page_offset)


def _merge(
    blocks: list,
    page_chapters: dict,
    config: dict,
    chunking: dict,
    page_offset: int,
) -> list[Chunk]:
    """The half both input paths share, so neither can drift from the other."""
    chunks = chunk_blocks(
        blocks,
        page_chapters=page_chapters,
        source_label=str(config["source_label"]),
        page_offset=page_offset,
        **chunking,
    )
    logger.info(
        "chunked into %d chunks (target %d tokens, overlap %d-%d, dropped pages %s, "
        "section headers %s)",
        len(chunks),
        chunking["target_tokens"],
        chunking["overlap_tokens"][0],
        chunking["overlap_tokens"][1],
        ",".join(str(p) for p in sorted(chunking["drop_pages"])) or "none",
        "included" if chunking["include_section_headers"] else "excluded",
    )
    return chunks


def dump_headings(args: argparse.Namespace, source_path: Path) -> int:
    """Write the book's `SectionHeader` text to JSON, then stop.

    **Why this exists as a first-class flag.** `CONTENT_BLOCK_TYPES` excludes
    headings, so no query against `rules_chunk` can ever see them — and a
    heading is exactly where a rulebook names a mechanic most compactly. That
    blind spot has already produced one wrong conclusion: `surprise` was
    recorded as absent from the book across every query using it
    (``docs/rules-extraction-findings.md § S9.1``, ``§ S19``) when the PSG
    prints a `26.2 SURPRISE` heading and the rule itself is on the page.

    So this is the check to run before asserting a book *lacks* a rule. It is
    strictly better evidence than the corpus for that question, and it costs
    marker's extraction pass and nothing else — no embedding, no database.

    The output is a cache keyed to the source document, not a measurement:
    headings change only when the book or marker does.
    """
    if args.markdown is not None:
        logger.error(
            "--dump-headings reads a PDF's structure via marker; there is "
            "nothing to extract from curated Markdown, whose headings you "
            "wrote yourself."
        )
        return EXIT_BAD_ARGS

    with tempfile.TemporaryDirectory(prefix="zoltar-headings-") as tmp:
        blocks, _ = extract.extract_blocks(source_path, Path(tmp))

    headings = [
        {"physicalPage": block.page, "text": " ".join(block.text.split())}
        for block in blocks
        if block.block_type == "SectionHeader" and block.text.strip()
    ]

    payload = {
        "system": args.system,
        "sourceSha256": hashing.sha256_file(source_path),
        "markerVersion": _marker_version(),
        "extractedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "headings": headings,
    }
    args.dump_headings.parent.mkdir(parents=True, exist_ok=True)
    args.dump_headings.write_text(
        json.dumps(payload, indent=2) + "\n", encoding="utf-8"
    )
    logger.info(
        "wrote %d section headings to %s", len(headings), args.dump_headings
    )
    return EXIT_OK


def _marker_version() -> str | None:
    try:
        completed = subprocess.run(
            [sys.executable, "-m", "pip", "show", "marker-pdf"],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    for line in completed.stdout.splitlines():
        if line.lower().startswith("version:"):
            return line.split(":", 1)[1].strip()
    return None


def write_manifest(
    args: argparse.Namespace,
    config: dict,
    chunking: dict,
    *,
    chunk_count: int,
    embedding_dim: int,
) -> None:
    """Record how this index was built, for whoever scores it later.

    A retrieval score is only comparable against the same index build, so
    M7.5's iteration needs marker version, chunking parameters, embed model,
    and chunk count attached to every measurement — the analogue of
    ``corpusVersion``/``harnessVersion`` on the Warden side. There is no
    ingestion-metadata table and this milestone adds no migration, so it lands
    beside the pipeline as a gitignored file; the retrieval harness copies it
    into its run manifest and records an explicit null when it is absent.

    **The chunking fields come from :func:`resolve_chunking`, not from
    literals.** They were hardcoded through M7.2 — which was harmless while
    nothing could change them, and would have become actively misleading the
    moment a sweep did: a manifest reporting ``targetTokens: 400`` after a
    run at 250 turns two incomparable scores into an apparent improvement,
    with nothing anywhere looking wrong. Provenance that can lie is worse
    than no provenance.
    """
    curated = args.markdown is not None
    manifest = {
        "system": args.system,
        "ingestedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        # Which document produced this index, and its hash. `markerVersion`
        # is null on the curated path because marker genuinely did not run —
        # recording the installed version would imply it had.
        "sourceType": "markdown" if curated else "pdf",
        "pdfSha256": None if curated else hashing.sha256_file(args.pdf),
        "markdownSha256": hashing.sha256_file(args.markdown) if curated else None,
        "markerVersion": None if curated else _marker_version(),
        "embedModel": args.voyage_model,
        "embeddingDim": embedding_dim,
        "chunkCount": chunk_count,
        "sourceLabel": config.get("source_label"),
        "pageOffset": config.get("page_offset"),
        "targetTokens": chunking["target_tokens"],
        "overlapTokens": list(chunking["overlap_tokens"]),
        "droppedPages": sorted(chunking["drop_pages"]),
        "includeSectionHeaders": chunking["include_section_headers"],
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    logger.info("wrote index provenance to %s", MANIFEST_PATH)


def print_dry_run(chunks: list[Chunk]) -> None:
    print()
    print(f"chunks: {len(chunks)}")
    if not chunks:
        print("no chunks produced — nothing would be inserted")
        return

    with_chapter = sum(1 for c in chunks if c.section_path)
    chapters = {c.section_path[0] for c in chunks if c.section_path}
    print(f"chunks with a chapter: {with_chapter} ({len(chapters)} distinct chapters)")
    print(f"chunks with no chapter: {len(chunks) - with_chapter}")
    print()
    print("--- first chunk ---")
    first = chunks[0]
    print(f"source:       {first.source}")
    print(f"section_path: {first.section_path}")
    print(f"pages:        {list(first.pages)}")
    print()
    preview = first.content[:500]
    print(preview + ("…" if len(first.content) > 500 else ""))
    print()
    print("--dry-run: stopping before embedding and insert. Nothing was spent.")


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )
    args = build_parser().parse_args(argv)

    system_dir = INGESTION_ROOT / args.system
    if not system_dir.is_dir():
        known = sorted(p.parent.name for p in INGESTION_ROOT.glob("*/system.json"))
        logger.error(
            "unknown system '%s': no directory at %s. Systems available here: %s.",
            args.system,
            system_dir,
            ", ".join(known) or "none",
        )
        return EXIT_BAD_ARGS

    source_path = args.pdf if args.markdown is None else args.markdown
    if not source_path.is_file():
        logger.error(
            "%s not found or not a file: %s",
            "PDF" if args.markdown is None else "Markdown file",
            source_path,
        )
        return EXIT_BAD_PDF

    if args.dump_headings is not None:
        return dump_headings(args, source_path)

    if not args.dry_run and not args.database_url:
        logger.error(
            "--database-url is required (or set $DATABASE_URL). Use --dry-run "
            "to chunk without a database."
        )
        return EXIT_BAD_ARGS

    try:
        config = load_system_config(system_dir)
        # Settled before extraction, which costs 20-30 seconds and 1.3 GB of
        # model weights. A malformed overlap band should fail in the first
        # instant of the run, not after the expensive part.
        chunking = resolve_chunking(args, config)
    except (OSError, ValueError, KeyError) as err:
        logger.error("%s", err)
        return EXIT_BAD_ARGS

    try:
        chunks = build_chunks(args, system_dir, config, chunking)
    except extract.ExtractionError as err:
        logger.error("%s", err)
        return EXIT_EXTRACTION
    except markdown.CuratedMarkdownError as err:
        # A malformed curated file is the operator's input error, the same
        # kind as a bad flag — not an extraction failure, which on this path
        # would name a step that never ran.
        logger.error("%s: %s", args.markdown, err)
        return EXIT_BAD_ARGS
    except fixup.FixupError as err:
        logger.error("%s", err)
        return EXIT_BAD_ARGS
    except (OSError, UnicodeDecodeError) as err:
        logger.error("could not read %s: %s", source_path, err)
        return EXIT_BAD_PDF

    if args.dry_run:
        print_dry_run(chunks)
        return EXIT_OK

    if not args.voyage_api_key:
        logger.error("--voyage-api-key is required (or set $VOYAGE_API_KEY)")
        return EXIT_BAD_ARGS

    if not chunks:
        logger.error(
            "no chunks were produced, so there is nothing to insert. Refusing "
            "to proceed — continuing would delete the existing index and "
            "replace it with nothing."
        )
        return EXIT_EXTRACTION

    started = time.monotonic()

    try:
        import psycopg
    except ImportError as err:  # pragma: no cover - dependency check
        logger.error("psycopg is not installed: %s", err)
        return EXIT_DATABASE

    try:
        connection = psycopg.connect(args.database_url)
    except Exception as err:
        logger.error("could not connect to the database: %s", err)
        return EXIT_DATABASE

    try:
        try:
            system_id, embedding_dim = store.lookup_system(connection, args.system)
        except store.StorageError as err:
            logger.error("%s", err)
            return EXIT_DATABASE

        # Embed and dimension-check *before* touching the table. Running the
        # guard after the DELETE would trade a caught bug for an emptied index.
        try:
            vectors = embed.embed_documents(
                [chunk.content for chunk in chunks],
                model=args.voyage_model,
                api_key=args.voyage_api_key,
            )
            embed.assert_dimensions(vectors, embedding_dim)
        except embed.EmbeddingError as err:
            logger.error("%s", err)
            return EXIT_EMBEDDING

        try:
            inserted = store.replace_chunks(
                connection,
                system_id=system_id,
                chunks=chunks,
                embeddings=vectors,
            )
            store.reindex_embeddings(connection)
            rows, null_embeddings = store.count_chunks(connection, system_id)
        except Exception as err:
            connection.rollback()
            logger.error("database error: %s", err)
            return EXIT_DATABASE
    finally:
        connection.close()

    elapsed = time.monotonic() - started
    write_manifest(
        args, config, chunking, chunk_count=inserted, embedding_dim=embedding_dim
    )

    logger.info(
        "ingested %d chunks for '%s' (model=%s, dim=%d, rows now %d, null embeddings %d) in %.1fs",
        inserted,
        args.system,
        args.voyage_model,
        embedding_dim,
        rows,
        null_embeddings,
        elapsed,
    )
    if null_embeddings:
        logger.warning(
            "%d rows carry a NULL embedding and are invisible to rules_lookup, "
            "which filters them out",
            null_embeddings,
        )
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
