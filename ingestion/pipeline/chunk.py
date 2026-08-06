"""Reading-order recovery and page/chapter attribution for extracted blocks.

Three sub-steps live in this module: recovering reading order (marker does
not emit blocks in reading order on multi-column pages), attributing page
number and chapter from the PDF's running footer, and merging the sorted,
attributed blocks into chunks. They share the same block-list data structure
end to end, and none is more than a few dozen lines, so they stay together
rather than being split across modules. See
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
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field

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


# ---------------------------------------------------------------------------
# Chunk model and merge
# ---------------------------------------------------------------------------

#: Only these three block types become chunk content. A whitelist rather than
#: a blacklist: marker also emits ``SectionHeader``, ``PageHeader``,
#: ``PageFooter``, ``Picture``, ``PictureGroup``, ``Caption``, and ``Form``,
#: and a new marker version adding a type should default to *excluded* rather
#: than silently injecting a new kind of text into the index.
#:
#: ``SectionHeader`` is dropped despite carrying real topic labels: its text
#: is unreliable as ancestry (``§ S1.7``), and the breadcrumb comes from the
#: footer chapter instead. Whether to bring headings back in — as breadcrumb
#: material or as indexable content — is an M7.5 lever, and one that would
#: re-open the page-17 ordering defect (``§ S10.3``).
CONTENT_BLOCK_TYPES = frozenset({"Text", "Table", "ListGroup"})

#: Tables are the densest and most mechanically load-bearing content in a
#: rules PDF. Half a panic table is worse than an oversized chunk.
TABLE_BLOCK_TYPE = "Table"

_PARAGRAPH_RE = re.compile(r"\n{2,}")
_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")


@dataclass(frozen=True)
class Chunk:
    """One row-to-be in ``rules_chunk``.

    The column set is fixed and narrow (``source``, ``section_path``,
    ``content``, ``embedding``), so everything a reader or a scorer needs
    about provenance has to live in ``source``. ``pages`` is kept alongside
    as structured data so the pipeline never re-parses its own citation
    string; it is not persisted.
    """

    content: str
    section_path: list[str] = field(default_factory=list)
    source: str = ""
    pages: tuple[int, ...] = ()


def _default_count_tokens(text: str) -> int:
    """Lazily-constructed tiktoken counter.

    Imported inside the function, not at module scope: tiktoken fetches its
    BPE files over the network when an encoder is first built, which would
    make the CI test network-dependent and this module non-importable on a
    runner that installs pytest alone.

    tiktoken is OpenAI's tokenizer, not Voyage's, so these counts approximate
    what Voyage will bill and window. That is accepted — the ~400-token target
    is a retrieval heuristic with no hard boundary, and the PSG is nowhere
    near the 32k per-input limit. Whether the approximation actually holds is
    an open question in ``docs/rules-extraction-findings.md``, not yet a
    problem worth spending on; ``voyageai.Client().count_tokens()`` is the
    exact source if it ever becomes one.
    """
    global _ENCODER
    if _ENCODER is None:
        import tiktoken

        _ENCODER = tiktoken.get_encoding("cl100k_base")
    return len(_ENCODER.encode(text))


_ENCODER = None


@dataclass(frozen=True)
class _Unit:
    """A piece of text that may or may not be split further."""

    text: str
    page: int
    atomic: bool  # a Table block — never split, never sampled for overlap


def _split_oversized(
    text: str, target_tokens: int, count_tokens: Callable[[str], int]
) -> list[str]:
    """Break one block's text into pieces no larger than ``target_tokens``.

    Paragraph boundaries first, sentence boundaries only if a single
    paragraph is still too large, and never mid-sentence — a sentence that
    exceeds the target on its own is emitted over-target rather than cut.
    """
    if count_tokens(text) <= target_tokens:
        return [text]

    def pack(parts: Sequence[str], separator: str) -> list[str]:
        packed: list[str] = []
        current: list[str] = []
        current_tokens = 0
        for part in parts:
            part_tokens = count_tokens(part)
            if current and current_tokens + part_tokens > target_tokens:
                packed.append(separator.join(current))
                current, current_tokens = [], 0
            current.append(part)
            current_tokens += part_tokens
        if current:
            packed.append(separator.join(current))
        return packed

    paragraphs = [p.strip() for p in _PARAGRAPH_RE.split(text) if p.strip()]
    if len(paragraphs) > 1:
        pieces = pack(paragraphs, "\n\n")
        # A single paragraph may still be over target; recurse into it.
        return [
            out
            for piece in pieces
            for out in (
                [piece]
                if count_tokens(piece) <= target_tokens
                else _split_oversized(piece, target_tokens, count_tokens)
            )
        ]

    sentences = [s.strip() for s in _SENTENCE_RE.split(text) if s.strip()]
    if len(sentences) > 1:
        return pack(sentences, " ")

    return [text]


def _overlap_tail(
    text: str,
    overlap_tokens: tuple[int, int],
    count_tokens: Callable[[str], int],
) -> str:
    """The trailing slice of ``text`` to repeat at the head of the next chunk.

    Whole sentences from the end, accumulated while they fit the band. If the
    final sentence alone overshoots the maximum, fall back to a word-level cut
    — an overlap outside the stated band would make the band meaningless, and
    a mid-sentence overlap is only a cosmetic cost on a fragment that is
    duplicated content by construction.
    """
    minimum, maximum = overlap_tokens
    sentences = [s for s in _SENTENCE_RE.split(text.strip()) if s.strip()]

    taken: list[str] = []
    total = 0
    for sentence in reversed(sentences):
        sentence_tokens = count_tokens(sentence)
        if taken and total + sentence_tokens > maximum:
            break
        taken.insert(0, sentence)
        total += sentence_tokens
        if total >= minimum:
            break

    tail = " ".join(taken).strip()
    if not tail:
        return ""
    if count_tokens(tail) <= maximum:
        return tail

    words = tail.split()
    while words and count_tokens(" ".join(words)) > maximum:
        words.pop(0)
    return " ".join(words)


def _chapter_key(page: int, page_chapters: dict[int, str]) -> tuple[str, object]:
    """Group key for "same section, may merge".

    A page with no resolved chapter gets a key unique to that page: without a
    chapter there is no evidence two pages belong to the same section, and
    merging them would manufacture an adjacency the footer never asserted.
    """
    chapter = page_chapters.get(page)
    if chapter is None:
        return ("unresolved", page)
    return ("chapter", chapter)


def _build_source(source_label: str, pages: Sequence[int]) -> str:
    """``'<label> p.21'``, or ``'<label> pp.20-21'`` for a chunk that spans.

    This string is the *only* provenance the runtime ever surfaces —
    ``findByCosineSimilarity`` returns ``source`` and ``content`` and nothing
    else — so it carries the whole citation. It is also what the retrieval
    harness parses page labels out of, so the format is a contract: ASCII
    ``p.``/``pp.``, hyphen not en-dash, page numbers printed rather than
    physical.
    """
    unique = sorted(set(pages))
    if not unique:
        return source_label
    if len(unique) == 1:
        return f"{source_label} p.{unique[0]}"
    return f"{source_label} pp.{unique[0]}-{unique[-1]}"


def chunk_blocks(
    blocks: Iterable[Block],
    *,
    page_chapters: dict[int, str],
    source_label: str,
    page_offset: int = 1,
    drop_pages: frozenset[int] = frozenset(),
    target_tokens: int = 400,
    overlap_tokens: tuple[int, int] = (50, 100),
    count_tokens: Callable[[str], int] | None = None,
) -> list[Chunk]:
    """Merge sorted, attributed blocks into ~``target_tokens`` chunks.

    Expects ``blocks`` already in reading order — :func:`sort_blocks_by_page`
    is not called here, so that a caller cannot get sorted-vs-unsorted wrong
    silently by passing the wrong flag. Merging in marker's emitted order
    concatenates roughly half the book's body pages backwards (``§ S6.2``).

    ``drop_pages`` exists so page-level exclusions stay a config change. It is
    empty for M7.2 deliberately: the character-creation exclusion (physical 4,
    41, 42) is *decided* in ``docs/decisions.md`` but implemented as an M7.5
    lever, because applying it here would change the index before the baseline
    M7.5 iterates against.
    """
    count = count_tokens if count_tokens is not None else _default_count_tokens
    minimum_overlap, maximum_overlap = overlap_tokens
    if not 0 <= minimum_overlap <= maximum_overlap:
        raise ValueError(f"invalid overlap band: {overlap_tokens!r}")
    if target_tokens <= 0:
        raise ValueError(f"target_tokens must be positive, got {target_tokens!r}")

    kept = [
        block
        for block in blocks
        if block.block_type in CONTENT_BLOCK_TYPES
        and block.page not in drop_pages
        and block.text.strip()
    ]

    chunks: list[Chunk] = []
    run: list[Block] = []
    run_key: tuple[str, object] | None = None

    def flush_run() -> None:
        if run:
            chunks.extend(
                _chunk_one_run(
                    run,
                    page_chapters=page_chapters,
                    source_label=source_label,
                    page_offset=page_offset,
                    target_tokens=target_tokens,
                    overlap_tokens=overlap_tokens,
                    count_tokens=count,
                )
            )
        run.clear()

    for block in kept:
        key = _chapter_key(block.page, page_chapters)
        if run_key is not None and key != run_key:
            flush_run()
        run_key = key
        run.append(block)
    flush_run()

    return chunks


def _chunk_one_run(
    run: Sequence[Block],
    *,
    page_chapters: dict[int, str],
    source_label: str,
    page_offset: int,
    target_tokens: int,
    overlap_tokens: tuple[int, int],
    count_tokens: Callable[[str], int],
) -> list[Chunk]:
    """Merge one same-chapter run. A chapter change already forced a break."""
    chapter = page_chapters.get(run[0].page)
    section_path = [chapter] if chapter is not None else []
    # The breadcrumb is embedded *and* read by the Warden, so it improves
    # retrieval rather than only presentation — a continuation chunk of the
    # panic rules can easily never contain the word "panic" otherwise. Built
    # from the footer chapter, never from `section_hierarchy`, which records
    # the last header seen at each visual level and so turns siblings into
    # parents (`§ S1.7`); a wrong breadcrumb is worse than none.
    breadcrumb = f"{chapter}\n\n" if chapter is not None else ""

    units: list[_Unit] = []
    for block in run:
        if block.block_type == TABLE_BLOCK_TYPE:
            units.append(_Unit(text=block.text.strip(), page=block.page, atomic=True))
            continue
        for piece in _split_oversized(block.text.strip(), target_tokens, count_tokens):
            units.append(_Unit(text=piece, page=block.page, atomic=False))

    chunks: list[Chunk] = []
    current: list[_Unit] = []
    current_tokens = 0
    pending_overlap = ""

    def flush_chunk() -> None:
        nonlocal current, current_tokens, pending_overlap
        if not current:
            return
        body = "\n\n".join(unit.text for unit in current)
        content = breadcrumb + (
            f"{pending_overlap}\n\n{body}" if pending_overlap else body
        )
        pages = tuple(sorted({unit.page + page_offset for unit in current}))
        chunks.append(
            Chunk(
                content=content,
                section_path=list(section_path),
                source=_build_source(source_label, pages),
                pages=pages,
            )
        )
        # A chunk ending in a table hands over no overlap: a fragment of a
        # table's rows opening the next chunk reads as unrelated noise, and
        # atomicity is the whole reason tables are handled separately. The
        # asymmetry is deliberate — a table chunk still *receives* the prose
        # overlap that introduced it, which is the context a bare table of
        # results needs to be interpretable on its own.
        pending_overlap = (
            "" if current[-1].atomic else _overlap_tail(body, overlap_tokens, count_tokens)
        )
        current = []
        current_tokens = 0

    for unit in units:
        unit_tokens = count_tokens(unit.text)
        if current and current_tokens + unit_tokens > target_tokens:
            flush_chunk()
        current.append(unit)
        current_tokens += unit_tokens
    flush_chunk()

    return chunks
