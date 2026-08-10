"""Curated Markdown -> typed blocks, bypassing marker entirely.

The fallback path for a book whose extraction is bad enough that curating it
by hand beats iterating on the chunker. It produces the same ``Block`` list
and ``page_chapters`` map ``extract.py`` does, so everything downstream —
merge, breadcrumb, citation, embed, store — cannot tell the two apart.

**Two things this buys beyond the curation itself.** It decouples an index
from ``marker-pdf``: the pin stays load-bearing for every self-hoster on the
PDF path and stops being load-bearing for a curated one. And it makes the
pipeline end-to-end testable without model weights for the first time, which
is why ``tests/test_markdown.py`` can run a whole file through to chunks on a
CI runner that installs pytest and nothing else.

**Standard library only**, for the same reason ``chunk.py`` is: this module
runs in CI, and CI installs ``requirements-dev.txt`` precisely so marker's
1.3 GB of extraction models never land on a runner.

**No reading-order sort is applied to this path, deliberately.** A curated
file is in reading order by construction — that is most of what curating it
*means* — so ``sort_blocks_by_page``'s column geometry has nothing to
recover and no ``bbox`` to recover it from. ``ingest.py`` skips the sort for
markdown input rather than feeding it synthetic coordinates, which would be
a lie the sort might act on.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .chunk import Block

#: ``<!-- page: 21 -->``. The number is the **printed** page — the one on the
#: paper — because that is what a person transcribing a book can see. It is
#: converted to a physical index with the system's ``page_offset``, so a
#: curated file and a PDF of the same book agree about what "page 21" means
#: without the transcriber ever thinking about physical indices.
_PAGE_MARKER_RE = re.compile(r"^<!--\s*page:\s*(\d+)\s*-->\s*$", re.IGNORECASE)

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*\S)\s*$")
_LIST_ITEM_RE = re.compile(r"^\s*[-*+]\s+\S")
_TABLE_ROW_RE = re.compile(r"^\s*\|.*\|\s*$")


class CuratedMarkdownError(ValueError):
    """The file cannot be read as a curated rules document."""


@dataclass(frozen=True)
class _Section:
    """One page's worth of accumulated blocks, in file order."""

    printed_page: int
    blocks: list[Block]


def _make_block(
    *,
    index: int,
    physical_page: int,
    block_type: str,
    text: str,
) -> Block:
    """A ``Block`` with a synthetic id and a zero ``bbox``.

    The id mirrors marker's ``/page/<n>/<Type>/<k>`` shape so that anything
    keying on it — ``fixups.json``'s matcher, a log line, a debugging eye —
    reads the same on both paths.

    ``bbox`` is all zeros rather than plausible coordinates. Nothing on this
    path consumes it (the reading-order sort is skipped), and inventing
    geometry that no page actually has is exactly the kind of plausible-but-
    wrong metadata ``docs/rules-extraction-findings.md`` keeps cataloguing as
    the failure mode worth guarding against. Zeros are visibly synthetic.
    """
    return Block(
        id=f"/page/{physical_page}/{block_type}/{index}",
        block_type=block_type,
        text=text,
        bbox=(0.0, 0.0, 0.0, 0.0),
        page=physical_page,
    )


def parse_curated_markdown(
    text: str,
    *,
    page_offset: int = 1,
) -> tuple[list[Block], dict[int, str]]:
    """Parse a curated Markdown rules file into blocks and a chapter map.

    Returns ``(blocks, page_chapters)`` exactly as ``extract.py`` does:
    ``blocks`` in reading order, ``page_chapters`` keyed by **physical** page
    index.

    The format, documented for humans in ``ingestion/README.md``:

    ==========================  ====================================
    ``<!-- page: 21 -->``       sets the current printed page
    ``# CHAPTER NAME``          sets the chapter from here on
    ``## …`` / ``### …``        a ``SectionHeader`` block
    a paragraph                 a ``Text`` block
    a run of ``- ``/``* `` lines  one ``ListGroup`` block
    a run of ``|…|`` lines      one ``Table`` block
    ==========================  ====================================

    Raises :class:`CuratedMarkdownError` if content appears before any page
    marker. That is a hard error rather than a default-to-page-1 warning: the
    ``source`` citation is the *only* provenance the runtime ever surfaces
    (``findByCosineSimilarity`` returns ``source`` and ``content`` and nothing
    else), it is what the retrieval harness parses page labels out of, and a
    silently mis-paged corpus would score every fixture as a miss for a reason
    that has nothing to do with retrieval.
    """
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")

    blocks: list[Block] = []
    page_chapters: dict[int, str] = {}

    physical_page: int | None = None
    chapter: str | None = None
    counter = 0
    # Blocks emitted since the current page marker. A `#` is only legal while
    # this is zero — see the guard where headings are handled.
    blocks_on_page = 0

    # A run of consecutive lines of one kind, flushed when the kind changes.
    # Paragraphs, list items, and table rows are all multi-line constructs, so
    # the parser is a small state machine rather than a per-line mapping.
    pending: list[str] = []
    pending_kind: str | None = None

    def flush() -> None:
        nonlocal pending, pending_kind, counter, blocks_on_page
        if not pending or pending_kind is None:
            pending, pending_kind = [], None
            return
        blocks_on_page += 1
        # `physical_page` is guaranteed non-None here: nothing accumulates
        # into `pending` before the first page marker (see `require_page`).
        assert physical_page is not None
        blocks.append(
            _make_block(
                index=counter,
                physical_page=physical_page,
                block_type=pending_kind,
                text="\n".join(pending).strip(),
            )
        )
        counter += 1
        pending, pending_kind = [], None

    def require_page(line_number: int, what: str) -> None:
        if physical_page is None:
            raise CuratedMarkdownError(
                f"line {line_number}: {what} appears before any "
                "'<!-- page: N -->' marker. Every block needs a page for its "
                "citation, and a guessed one would corrupt every source "
                "string the Warden shows a player."
            )

    def accumulate(kind: str, line: str, line_number: int) -> None:
        nonlocal pending_kind
        require_page(line_number, "content")
        if pending_kind is not None and pending_kind != kind:
            flush()
        pending_kind = kind
        pending.append(line)

    for line_number, raw in enumerate(lines, start=1):
        line = raw.rstrip()

        page_marker = _PAGE_MARKER_RE.match(line.strip())
        if page_marker:
            flush()
            physical_page = int(page_marker.group(1)) - page_offset
            blocks_on_page = 0
            # A chapter spans pages: it is named once, on its first page, and
            # stays in force until the next `#`. Stamping it onto every page
            # it covers is what lets `_chapter_key` merge a chapter's chunks
            # across a page boundary — a page absent from this map gets a key
            # unique to itself and breaks the chapter into one run per page.
            if chapter is not None:
                page_chapters[physical_page] = chapter
            continue

        if not line.strip():
            flush()
            continue

        heading = _HEADING_RE.match(line)
        if heading:
            flush()
            level, title = len(heading.group(1)), heading.group(2)
            if level == 1:
                # The curated equivalent of the running footer, and the only
                # breadcrumb source. Applied from here forward rather than to
                # the whole file, so one file can carry a whole book.
                #
                # `page_chapters` is a page->chapter map, the same shape the
                # footer produces, so **a page has exactly one chapter and a
                # mid-page chapter change cannot be represented**. Left
                # unguarded, a `#` after content would silently re-label the
                # prose above it — and `chunk.py` is explicit that a wrong
                # breadcrumb is worse than none, since the breadcrumb is
                # embedded and read by the Warden rather than merely
                # displayed. Rejected with a fix in the message instead.
                if blocks_on_page:
                    raise CuratedMarkdownError(
                        f"line {line_number}: chapter '{title}' begins after "
                        f"content already on printed page "
                        f"{physical_page + page_offset}. A chapter must start "
                        "at a page boundary — insert a '<!-- page: N -->' "
                        "marker before this heading, or move the heading above "
                        "the page's first block. (A page carries one chapter: "
                        "the map this builds is the same shape the PDF path's "
                        "running footer produces.)"
                    )
                chapter = title
                if physical_page is not None:
                    page_chapters[physical_page] = chapter
                continue
            require_page(line_number, "a heading")
            assert physical_page is not None
            blocks.append(
                _make_block(
                    index=counter,
                    physical_page=physical_page,
                    block_type="SectionHeader",
                    text=title,
                )
            )
            counter += 1
            continue

        if _TABLE_ROW_RE.match(line):
            accumulate("Table", line, line_number)
            continue
        if _LIST_ITEM_RE.match(line):
            accumulate("ListGroup", line, line_number)
            continue
        accumulate("Text", line, line_number)

    flush()

    return blocks, page_chapters
