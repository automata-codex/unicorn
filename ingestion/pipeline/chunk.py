"""Reading-order recovery and page/chapter attribution for extracted blocks.

Three sub-steps live in this module: recovering reading order (marker does
not emit blocks in reading order on multi-column pages), attributing page
number and chapter from the PDF's running footer, and — landing separately
— merging the sorted, attributed blocks into chunks. They share the same
block-list data structure end to end, and none is more than a few dozen
lines, so they stay together rather than being split across modules. See
``docs/rules-ingestion.md § Step 4`` for the canonical algorithm.

**This module must stay importable with nothing but the standard library.**
It is the only ingestion code that runs in CI, and CI installs
``requirements-dev.txt`` (pytest alone) precisely so marker's extraction
models never land on a runner. No imports from ``extract.py``, ``embed.py``,
``store.py``, or ``fixup.py``, and no module-scope ``import tiktoken`` —
tiktoken downloads its BPE files from the network when an encoder is first
constructed, which would make the CI test network-dependent. The token
counter is injected, and its tiktoken default is built lazily on first call.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

# ---------------------------------------------------------------------------
# Block model
# ---------------------------------------------------------------------------

#: ``(x0, y0, x1, y1)`` in PDF points, origin top-left — y increases downward,
#: which is what marker emits and what makes ``y0`` ascending mean
#: top-to-bottom.
BBox = tuple[float, float, float, float]


@dataclass(frozen=True)
class Block:
    """One typed content block from marker's ``chunks`` output.

    ``page`` is the *physical* page index, parsed from ``id`` — never
    marker's own ``page`` field, which is an internal identifier whose
    values look like page numbers and are not (physical 0 -> ``'7'``,
    1 -> ``'512'``, 2 -> ``'75'``). See
    ``docs/rules-extraction-findings.md § S1.6``, and the Dead ends table in
    that file, where this is the entry flagged as the failure mode most worth
    guarding against: it is plausible, silent, and wrong.
    """

    id: str
    block_type: str
    text: str
    bbox: BBox
    page: int


# ---------------------------------------------------------------------------
# Physical page index
# ---------------------------------------------------------------------------

_PAGE_ID_RE = re.compile(r"^/page/(\d+)/")


def physical_page_from_id(block_id: str) -> int:
    """Physical (0-based) page index from a block id such as
    ``/page/11/Table/5``.

    Raises rather than guessing. Every other page-like field in marker's
    output has already been ruled out as a page number, so a silent fallback
    here would reintroduce exactly the class of bug this function exists to
    avoid.
    """
    match = _PAGE_ID_RE.match(block_id)
    if match is None:
        raise ValueError(
            f"block id does not start with a /page/<n>/ prefix: {block_id!r}"
        )
    return int(match.group(1))


# ---------------------------------------------------------------------------
# Reading-order sort
# ---------------------------------------------------------------------------

#: A block at least this share of the page's width spans both columns, so it
#: terminates the column band it appears in rather than belonging to one
#: column. 0.6 is the value validated in
#: ``docs/rules-extraction-findings.md § S7.2``.
FULL_WIDTH_RATIO = 0.6


def _is_full_width(block: Block, page_width: float) -> bool:
    x0, _, x1, _ = block.bbox
    return (x1 - x0) >= FULL_WIDTH_RATIO * page_width


def _x_centre(block: Block) -> float:
    x0, _, x1, _ = block.bbox
    return (x0 + x1) / 2.0


def sort_reading_order(blocks: Sequence[Block], page_width: float) -> list[Block]:
    """Recover reading order for the blocks of a single page.

    Marker's emitted order is not reading order on multi-column pages: of the
    16 PSG pages carrying two or more numbered section headers, 8 emit them
    out of order, including full reversals
    (``docs/rules-extraction-findings.md § S6.2``). Merging in emitted order
    would concatenate a meaningful share of the book's body pages backwards —
    silently, since the chunk count and token counts all still look right.

    The sort is deterministic geometry over the ``bbox`` every block already
    carries, and it must stay that way: no model call belongs in this path,
    ever. An LLM-assisted pass may *validate* the output offline; where
    geometry genuinely cannot resolve a page, the escape hatch is a
    hand-blessed ordering recorded once per edition in ``fixups.json``, keyed
    on block ``id``. See ``docs/decisions.md § Reading order requires an
    explicit column-aware sort; an LLM may validate it, never perform it``.

    Algorithm (``§ S7.2``, which scored 8/16 -> 15/16 with nothing
    regressed):

    1. A block whose width is at least ``FULL_WIDTH_RATIO`` of the page spans
       both columns.
    2. Walk blocks top-to-bottom. A full-width block flushes the current
       column band and is emitted on its own; everything else accumulates
       into the band.
    3. Within a band, split by bbox x-centre against the page midline and
       emit the left column top-to-bottom, then the right.
    """
    if page_width <= 0:
        raise ValueError(f"page_width must be positive, got {page_width!r}")

    # (y0, x0) rather than y0 alone so the order is total, not merely
    # stable-by-input-order: two blocks sharing a y0 sort left-first, which
    # keeps the output independent of marker's emission order.
    ordered = sorted(blocks, key=lambda b: (b.bbox[1], b.bbox[0]))
    midline = page_width / 2.0

    out: list[Block] = []
    band: list[Block] = []

    def flush_band() -> None:
        if not band:
            return
        # `band` is already in (y0, x0) order, so each column comes out
        # top-to-bottom for free.
        out.extend(b for b in band if _x_centre(b) < midline)
        out.extend(b for b in band if _x_centre(b) >= midline)
        band.clear()

    for block in ordered:
        if _is_full_width(block, page_width):
            flush_band()
            out.append(block)
        else:
            band.append(block)
    flush_band()

    return out


def sort_blocks_by_page(
    blocks: Iterable[Block],
    page_widths: dict[int, float],
) -> list[Block]:
    """Apply :func:`sort_reading_order` per page, concatenated in page order.

    ``page_widths`` maps physical page index to page width in points, read
    from ``page_info[N].bbox`` in marker's output. A page missing from the
    map is a caller error rather than a fall-back-to-emitted-order case: the
    fallback would be the exact silent scrambling this function exists to
    prevent.
    """
    by_page: dict[int, list[Block]] = {}
    for block in blocks:
        by_page.setdefault(block.page, []).append(block)

    out: list[Block] = []
    for page in sorted(by_page):
        if page not in page_widths:
            raise KeyError(f"no page width recorded for physical page {page}")
        out.extend(sort_reading_order(by_page[page], page_widths[page]))
    return out


# ---------------------------------------------------------------------------
# Page and chapter attribution from the running footer
# ---------------------------------------------------------------------------

#: A chapter name longer than this is a body sentence that happened to follow
#: a number, not a running footer. The longest real PSG chapter name is
#: ``MODIFYING STAT CHECKS & SAVES`` at 29 characters
#: (``docs/rules-extraction-findings.md § S1.8``).
MAX_CHAPTER_LENGTH = 60

_DIGITS_RE = re.compile(r"^\d+$")


def _parse_footer_pair(
    number_line: str,
    chapter_line: str,
    *,
    expected_printed_page: int,
) -> tuple[int | None, str | None]:
    """Match one candidate ``[<digits>, <CHAPTER>]`` line pair."""
    number_line = number_line.strip()
    chapter_line = chapter_line.strip()

    if not _DIGITS_RE.match(number_line):
        return None, None
    # The offset check is what makes this safe against a body line that
    # happens to be digits: the printed number has to be the one this
    # physical page is expected to carry, not just any number.
    if int(number_line) != expected_printed_page:
        return None, None
    if not chapter_line or _DIGITS_RE.match(chapter_line):
        return None, None
    if len(chapter_line) > MAX_CHAPTER_LENGTH:
        return None, None
    if not any(ch.isalpha() for ch in chapter_line):
        return None, None

    return int(number_line), chapter_line


def parse_footer(
    lines: Sequence[str],
    physical_page: int,
    *,
    page_offset: int = 1,
) -> tuple[int | None, str | None]:
    """Printed page number and chapter for one page, from its text lines.

    Takes already-extracted lines rather than a PDF, which keeps
    ``pypdfium2``'s file I/O out of the unit test the same way ``extract.py``
    and ``embed.py`` are kept out.

    Marker detects the running footer (11 ``PageFooter`` blocks in the PSG)
    but emits it with empty ``html`` — it treats footers as noise and strips
    them — so the text has to come from ``pypdfium2`` directly
    (``docs/rules-extraction-findings.md § S1.8``, and a Dead end in that
    file).

    The footer alternates verso/recto, so both ends of the text stream are
    checked: a tail-only check resolves 34/44 pages, head-or-tail resolves
    36/44. The remaining 8 have no footer to find and return
    ``(None, None)`` — an unresolved page is attributed by page number alone
    rather than failing the run.

    ``page_offset`` is edition-specific. ``printed == physical + 1`` held on
    every PSG 1e page that parsed, with no counterexamples, but a second book
    needs its own check before ingestion.
    """
    non_empty = [line.strip() for line in lines if line.strip()]
    if len(non_empty) < 2:
        return None, None

    expected = physical_page + page_offset
    candidates = ((non_empty[0], non_empty[1]), (non_empty[-2], non_empty[-1]))
    for number_line, chapter_line in candidates:
        printed, chapter = _parse_footer_pair(
            number_line, chapter_line, expected_printed_page=expected
        )
        if printed is not None:
            return printed, chapter

    return None, None
