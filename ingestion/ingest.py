#!/usr/bin/env python3
"""Ingest a rules PDF into the `rules_chunk` vector index.

    python ingest.py --system mothership --pdf <path> --database-url <url>

Offline job, run by hand. Nothing here is on the GM turn's hot path, and
nothing here makes an LLM call — reading order is recovered by deterministic
geometry, not by a model (`docs/decisions.md § Reading order requires an
explicit column-aware sort; an LLM may validate it, never perform it`).

Exit codes are part of the interface:

    0  success
    1  PDF not found or unreadable
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

from pipeline import embed, extract, fixup, hash as hashing, store
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
    parser.add_argument("--pdf", required=True, type=Path, help="input PDF")
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
        "--dry-run",
        action="store_true",
        help="extract and chunk only; print a chunk count and preview, then stop "
        "before embedding or inserting. Costs nothing.",
    )
    return parser


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


def build_chunks(args: argparse.Namespace, system_dir: Path, config: dict) -> list[Chunk]:
    """PDF -> chunks. Everything up to, but not including, spending money."""
    if not args.skip_hash_check:
        check = hashing.verify_pdf(args.pdf, system_dir / "hashes")
        hashing.log_result(check, args.pdf)
    else:
        logger.warning(
            "--skip-hash-check: not verifying the PDF against any recorded "
            "edition. Fixups may not apply cleanly to a different printing."
        )

    page_offset = int(config["page_offset"])

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

    ordered = sort_blocks_by_page(blocks, page_widths)
    chunks = chunk_blocks(
        ordered,
        page_chapters=page_chapters,
        source_label=str(config["source_label"]),
        page_offset=page_offset,
    )
    logger.info("chunked into %d chunks", len(chunks))
    return chunks


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
    """
    manifest = {
        "system": args.system,
        "ingestedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "pdfSha256": hashing.sha256_file(args.pdf),
        "markerVersion": _marker_version(),
        "embedModel": args.voyage_model,
        "embeddingDim": embedding_dim,
        "chunkCount": chunk_count,
        "sourceLabel": config.get("source_label"),
        "pageOffset": config.get("page_offset"),
        # Defaults live in chunk_blocks' signature; recorded explicitly so a
        # future change to them is visible in the provenance rather than
        # silently reinterpreting old runs.
        "targetTokens": 400,
        "overlapTokens": [50, 100],
        "droppedPages": [],
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

    if not args.pdf.is_file():
        logger.error("PDF not found or not a file: %s", args.pdf)
        return EXIT_BAD_PDF

    if not args.dry_run and not args.database_url:
        logger.error(
            "--database-url is required (or set $DATABASE_URL). Use --dry-run "
            "to chunk without a database."
        )
        return EXIT_BAD_ARGS

    try:
        config = load_system_config(system_dir)
    except (OSError, ValueError, KeyError) as err:
        logger.error("%s", err)
        return EXIT_BAD_ARGS

    try:
        chunks = build_chunks(args, system_dir, config)
    except extract.ExtractionError as err:
        logger.error("%s", err)
        return EXIT_EXTRACTION
    except fixup.FixupError as err:
        logger.error("%s", err)
        return EXIT_BAD_ARGS
    except OSError as err:
        logger.error("could not read the PDF: %s", err)
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
    write_manifest(args, config, chunk_count=inserted, embedding_dim=embedding_dim)

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
