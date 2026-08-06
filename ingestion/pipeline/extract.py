"""PDF -> typed blocks + per-page chapter attribution.

Two passes over the same PDF, because marker gives one of the two things the
chunker needs and actively cannot give the other:

1. **marker** produces typed blocks with page and bbox metadata.
2. **pypdfium2** reads the running footer for printed page number and chapter
   name. Marker detects footers (11 ``PageFooter`` blocks in the PSG) and
   emits them with empty ``html`` — it strips them as noise — so the text has
   to be read independently. Every other page-like field marker offers has
   been tested and rejected; see the Dead ends table in
   ``docs/rules-extraction-findings.md``.

``pypdfium2`` is imported lazily inside the pass that needs it, so this module
stays importable with the standard library alone and its HTML reduction can be
unit-tested in CI alongside ``chunk.py``. That reduction decides what text
actually lands in the index, which makes it worth testing rather than
inferring from a successful run.
"""

from __future__ import annotations

import json
import logging
import re
import shutil
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path

from .chunk import Block, parse_footer, physical_page_from_id

logger = logging.getLogger(__name__)


class ExtractionError(RuntimeError):
    """Marker failed, or produced output that cannot be used."""


# ---------------------------------------------------------------------------
# HTML reduction
# ---------------------------------------------------------------------------

#: Tags that end a line of output. ``p`` gets a blank line instead (below) so
#: that paragraph boundaries survive into `_split_oversized`, which prefers
#: them over sentence boundaries when a block has to be broken up.
_LINE_TAGS = frozenset({"div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6"})
_PARAGRAPH_TAGS = frozenset({"p"})
#: Cell boundaries become a visible separator rather than a space: a table
#: flattened into running prose is unreadable to the Warden and embeds worse.
_CELL_TAGS = frozenset({"td", "th"})

_WHITESPACE_RE = re.compile(r"\s+")


class _HtmlToText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: object) -> None:
        if tag == "br":
            self._parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in _PARAGRAPH_TAGS:
            self._parts.append("\n\n")
        elif tag in _LINE_TAGS:
            self._parts.append("\n")
        elif tag in _CELL_TAGS:
            self._parts.append(" | ")

    def handle_data(self, data: str) -> None:
        # Whitespace inside HTML text content — newlines included — is not
        # semantic; only tags produce line breaks. Marker's HTML is wrapped at
        # source width, so preserving those newlines would scatter breaks
        # through the middle of sentences in the embedded text.
        self._parts.append(_WHITESPACE_RE.sub(" ", data))

    def result(self) -> str:
        return "".join(self._parts)


def html_to_text(html: str | None) -> str:
    """Reduce one block's HTML to plain text, keeping tables legible.

    Rows become lines and cells are separated by ``|``, so a stat table
    survives as something a reader can parse. Marker's ``chunks`` format keeps
    tables as HTML rather than flattening them, which is the main substantive
    advantage over its Markdown output for a rules book; throwing that
    structure away here would give the advantage straight back.
    """
    if not html:
        return ""

    parser = _HtmlToText()
    parser.feed(html)
    parser.close()

    lines: list[str] = []
    for raw_line in parser.result().splitlines():
        line = " ".join(raw_line.split())
        line = line.strip().strip("|").strip()
        lines.append(line)

    # Collapse runs of blank lines to a single blank line, so paragraph
    # boundaries stay detectable without accumulating vertical noise.
    out: list[str] = []
    for line in lines:
        if line or (out and out[-1]):
            out.append(line)
    return "\n".join(out).strip()


# ---------------------------------------------------------------------------
# Pass 1 — marker
# ---------------------------------------------------------------------------

#: Below this, the PDF almost certainly has no usable embedded text layer.
#: The PSG averages ~2,400 characters per page, so this is a floor for
#: "something is fundamentally wrong," not a quality bar.
MIN_CHARS_PER_PAGE = 100


def _marker_executable() -> str:
    """Resolve ``marker_single`` from this interpreter's environment first.

    ``task ingest`` invokes ``.venv/bin/python ingest.py`` without activating
    the venv, so ``marker_single`` is frequently not on ``PATH`` even though
    it is installed. Looking beside ``sys.executable`` finds it anyway.
    """
    candidate = Path(sys.executable).parent / "marker_single"
    if candidate.exists():
        return str(candidate)

    found = shutil.which("marker_single")
    if found:
        return found

    raise ExtractionError(
        "marker_single not found. Install the pipeline's dependencies into "
        "ingestion/.venv (see ingestion/README.md): pip install -r requirements.txt"
    )


def run_marker(pdf_path: Path, output_dir: Path) -> Path:
    """Run marker and return the path to its ``chunks`` JSON.

    ``--disable_ocr`` is not optional on a stock install: marker's default
    path routes full-page OCR through a llama.cpp backend that this pipeline
    does not install, and fails outright with ``SpawnError: llama-server
    binary not found``. It is also ~3x slower where it does work. The cost is
    that a scanned-only PDF yields near-empty blocks rather than an error,
    which is what :func:`extract_blocks`'s text floor exists to catch.
    """
    command = [
        _marker_executable(),
        str(pdf_path),
        "--output_dir",
        str(output_dir),
        "--output_format",
        "chunks",
        "--disable_ocr",
        "--disable_image_extraction",
    ]

    logger.info("running marker (this takes ~20-30s for a 44-page book)")
    completed = subprocess.run(command, capture_output=True, text=True)
    if completed.returncode != 0:
        raise ExtractionError(
            f"marker exited {completed.returncode}.\n"
            f"--- marker stderr ---\n{completed.stderr.strip()}"
        )

    produced = sorted(p for p in output_dir.rglob("*.json") if not p.name.endswith("_meta.json"))
    if not produced:
        raise ExtractionError(
            f"marker reported success but wrote no chunks JSON under {output_dir}"
        )
    return produced[0]


def extract_blocks(pdf_path: Path, output_dir: Path) -> tuple[list[Block], dict[int, float]]:
    """Typed blocks plus per-page width, from marker's ``chunks`` output."""
    payload = json.loads(run_marker(pdf_path, output_dir).read_text(encoding="utf-8"))

    raw_blocks = payload.get("blocks") or []
    page_info = payload.get("page_info") or {}
    if not raw_blocks:
        raise ExtractionError("marker produced no blocks")

    page_widths: dict[int, float] = {}
    for key, info in page_info.items():
        bbox = info.get("bbox")
        if bbox:
            page_widths[int(key)] = float(bbox[2]) - float(bbox[0])

    blocks: list[Block] = []
    for raw in raw_blocks:
        page = physical_page_from_id(raw["id"])
        blocks.append(
            Block(
                id=raw["id"],
                block_type=raw["block_type"],
                text=html_to_text(raw.get("html")),
                # Marker's own `page` field is deliberately not read: it is an
                # internal id whose values look like page numbers (physical
                # 0 -> '7') and are not.
                bbox=tuple(float(v) for v in raw["bbox"]),  # type: ignore[arg-type]
                page=page,
            )
        )

    _assert_text_layer(blocks, page_count=len(page_widths) or 1)
    logger.info(
        "extracted %d blocks across %d pages", len(blocks), len(page_widths)
    )
    return blocks, page_widths


def _assert_text_layer(blocks: list[Block], *, page_count: int) -> None:
    total_chars = sum(len(block.text) for block in blocks)
    if total_chars >= MIN_CHARS_PER_PAGE * page_count:
        return
    raise ExtractionError(
        f"extraction produced only {total_chars} characters across {page_count} "
        f"pages, below the {MIN_CHARS_PER_PAGE}/page floor. The most likely "
        "cause is a PDF with no embedded text layer: this pipeline always "
        "passes --disable_ocr, which is correct for digitally-produced "
        "rulebooks and wrong for scanned ones. Scanned sources are not "
        "supported."
    )


# ---------------------------------------------------------------------------
# Pass 2 — running footers
# ---------------------------------------------------------------------------


def read_page_chapters(pdf_path: Path, *, page_offset: int = 1) -> dict[int, str]:
    """Physical page index -> chapter name, read from the running footer.

    Edition- and printing-specific. A sharp drop in the resolved count on some
    future PDF is the signal that this heuristic has stopped applying to it,
    which is why the count is logged rather than silently accepted — on the
    PSG 1e it is 36 of 44.
    """
    import pypdfium2 as pdfium  # lazy: keeps this module stdlib-importable

    chapters: dict[int, str] = {}
    document = pdfium.PdfDocument(str(pdf_path))
    try:
        page_count = len(document)
        for index in range(page_count):
            text = document[index].get_textpage().get_text_bounded()
            _, chapter = parse_footer(
                text.splitlines(), index, page_offset=page_offset
            )
            if chapter:
                chapters[index] = chapter
    finally:
        document.close()

    logger.info(
        "resolved a chapter from the running footer on %d of %d pages",
        len(chapters),
        page_count,
    )
    if page_count and len(chapters) < page_count // 2:
        logger.warning(
            "fewer than half the pages resolved a chapter. The footer format "
            "is edition-specific; a new book or printing needs its own check "
            "before its page and chapter attribution can be trusted."
        )
    return chapters
