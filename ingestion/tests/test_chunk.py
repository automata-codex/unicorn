"""Unit tests for pipeline/chunk.py.

Pure Python over synthetic blocks and synthetic footer strings: no marker
models, no Voyage key, no database, no real PDF. That is what earns this the
only ingestion slot in CI, and it is why the module under test must stay
importable with nothing but the standard library installed.

Page geometry in these fixtures mirrors the real book — 396 x 612 points,
origin top-left, y increasing downward — but the numbers are chosen for
legibility rather than copied from any page.
"""

from __future__ import annotations

import pytest

from pipeline.chunk import (
    Block,
    parse_footer,
    physical_page_from_id,
    sort_blocks_by_page,
    sort_reading_order,
)

PAGE_WIDTH = 396.0
MIDLINE = PAGE_WIDTH / 2

# Column x-extents: each ~41% of page width, so neither trips the 60%
# full-width threshold.
LEFT = (20.0, 183.0)
RIGHT = (213.0, 376.0)


def block(
    name: str,
    *,
    y0: float,
    x: tuple[float, float] = LEFT,
    block_type: str = "Text",
    page: int = 0,
) -> Block:
    x0, x1 = x
    return Block(
        id=f"/page/{page}/{block_type}/{name}",
        block_type=block_type,
        text=name,
        bbox=(x0, y0, x1, y0 + 20.0),
        page=page,
    )


def ids(blocks: list[Block]) -> list[str]:
    return [b.text for b in blocks]


# ---------------------------------------------------------------------------
# Reading-order sort
# ---------------------------------------------------------------------------


def test_two_column_page_sorts_left_column_then_right() -> None:
    """The core defect: marker interleaves and reverses columns.

    `docs/rules-extraction-findings.md § S6.2` measured this on 8 of 16
    checkable pages, including full reversals. The emitted order here is the
    shape of a real scramble — a right-column block first, columns
    interleaved after.
    """
    emitted = [
        block("r1", y0=100.0, x=RIGHT),
        block("l1", y0=100.0),
        block("r2", y0=200.0, x=RIGHT),
        block("l2", y0=200.0),
    ]

    assert ids(sort_reading_order(emitted, PAGE_WIDTH)) == ["l1", "l2", "r1", "r2"]


def test_single_column_page_is_left_unchanged() -> None:
    """Single-column pages are reliable in marker's own order (`§ S6.2`).

    A sort that "fixed" them would be a regression, and the real check found
    none — this is that guarantee at unit scale.
    """
    emitted = [
        block("a", y0=100.0),
        block("b", y0=200.0),
        block("c", y0=300.0),
    ]

    assert ids(sort_reading_order(emitted, PAGE_WIDTH)) == ["a", "b", "c"]


def test_full_width_block_flushes_the_band_and_stands_alone() -> None:
    """A block spanning both columns terminates the band it appears in.

    Without this the columns above and below a full-width divider merge into
    one band, and the block itself sorts into whichever column its centre
    happens to fall in.
    """
    emitted = [
        block("below-right", y0=300.0, x=RIGHT),
        block("banner", y0=200.0, x=(10.0, 386.0)),
        block("above-left", y0=100.0),
        block("above-right", y0=100.0, x=RIGHT),
        block("below-left", y0=300.0),
    ]

    assert ids(sort_reading_order(emitted, PAGE_WIDTH)) == [
        "above-left",
        "above-right",
        "banner",
        "below-left",
        "below-right",
    ]


def test_full_width_threshold_is_a_share_of_page_width() -> None:
    """60% is the validated boundary (`§ S7.2`), and it is a ratio, not a
    point count — a narrower page makes the same block full-width."""
    wide = [block("banner", y0=100.0, x=(10.0, 250.0))]  # 240pt

    # 61% of 396 -> full-width, stands alone.
    assert ids(sort_reading_order(wide, PAGE_WIDTH)) == ["banner"]
    # 40% of 600 -> column content. Same block, different page.
    assert ids(sort_reading_order(wide, 600.0)) == ["banner"]
    # The observable difference is banding, so check it with a companion.
    band = [
        block("banner", y0=100.0, x=(10.0, 250.0)),
        block("right", y0=50.0, x=(300.0, 380.0)),
    ]
    assert ids(sort_reading_order(band, PAGE_WIDTH)) == ["right", "banner"]
    assert ids(sort_reading_order(band, 600.0)) == ["banner", "right"]


def test_sort_is_deterministic_for_blocks_sharing_a_y0() -> None:
    """Two blocks on the same line sort left-first regardless of input order,
    so output does not depend on marker's emission order."""
    a = block("a", y0=100.0, x=(20.0, 100.0))
    b = block("b", y0=100.0, x=(120.0, 180.0))

    assert ids(sort_reading_order([b, a], PAGE_WIDTH)) == ["a", "b"]
    assert ids(sort_reading_order([a, b], PAGE_WIDTH)) == ["a", "b"]


def test_empty_page_sorts_to_empty() -> None:
    assert sort_reading_order([], PAGE_WIDTH) == []


def test_non_positive_page_width_is_rejected() -> None:
    with pytest.raises(ValueError, match="page_width"):
        sort_reading_order([block("a", y0=100.0)], 0.0)


def test_sort_by_page_concatenates_in_page_order() -> None:
    emitted = [
        block("p1-right", y0=100.0, x=RIGHT, page=1),
        block("p0-left", y0=100.0, page=0),
        block("p1-left", y0=100.0, page=1),
        block("p0-right", y0=100.0, x=RIGHT, page=0),
    ]
    widths = {0: PAGE_WIDTH, 1: PAGE_WIDTH}

    assert ids(sort_blocks_by_page(emitted, widths)) == [
        "p0-left",
        "p0-right",
        "p1-left",
        "p1-right",
    ]


def test_sort_by_page_rejects_a_page_with_no_recorded_width() -> None:
    """Falling back to emitted order for an unmeasurable page would
    reintroduce the exact silent scrambling this sort exists to prevent, so
    a missing width is an error."""
    with pytest.raises(KeyError, match="physical page 3"):
        sort_blocks_by_page([block("a", y0=100.0, page=3)], {0: PAGE_WIDTH})


# ---------------------------------------------------------------------------
# Physical page index
# ---------------------------------------------------------------------------


def test_physical_page_parsed_from_block_id() -> None:
    assert physical_page_from_id("/page/11/Table/5") == 11
    assert physical_page_from_id("/page/0/SectionHeader/0") == 0


@pytest.mark.parametrize(
    "block_id",
    ["page/11/Table/5", "/pages/11/Table/5", "/page//Table/5", "", "/page/x/Text/1"],
)
def test_malformed_block_id_raises_rather_than_guessing(block_id: str) -> None:
    """Marker's own `page` field is an internal id that looks like a page
    number and is not (`§ S1.6`). A silent fallback here would reintroduce
    that same class of plausible-and-wrong value."""
    with pytest.raises(ValueError):
        physical_page_from_id(block_id)


# ---------------------------------------------------------------------------
# Footer attribution
# ---------------------------------------------------------------------------


def test_footer_parsed_from_the_tail_of_the_text_stream() -> None:
    """The common case: 34 of 44 PSG pages carry the marker at the tail
    (`§ S1.8`)."""
    lines = [
        "Read more about Medical Care on pg. 34.",
        "21",
        "PANIC CHECKS",
    ]

    assert parse_footer(lines, physical_page=20) == (21, "PANIC CHECKS")


def test_footer_parsed_from_the_head_of_the_text_stream() -> None:
    """The footer alternates verso/recto. A tail-only check resolves 34/44
    pages; head-or-tail resolves 36/44 (`§ S1.8`)."""
    lines = [
        "14",
        "ARMOR",
        "ARMADYNE “HEAVY-K” ADVANCED BATTLE DRESS",
    ]

    assert parse_footer(lines, physical_page=13) == (14, "ARMOR")


def test_page_with_no_footer_resolves_to_nothing_rather_than_failing() -> None:
    """8 PSG pages carry no footer. They are attributed by page number alone,
    not treated as a run-stopping error (`§ S1.8`)."""
    lines = [
        "VIOLENCE",
        "Range",
        "A roll of 90-99 is always",
        "considered a failure.",
        "HOW TO PLAY MOTHERSHIP®",
    ]

    assert parse_footer(lines, physical_page=43) == (None, None)


def test_a_number_that_is_not_this_pages_number_is_not_a_footer() -> None:
    """The offset check is the guard against a body line that happens to be
    digits — the printed number has to be the one this physical page is
    expected to carry."""
    lines = ["some body text", "99", "PANIC CHECKS"]

    assert parse_footer(lines, physical_page=20) == (None, None)


def test_a_sentence_following_a_number_is_not_a_chapter() -> None:
    lines = [
        "some body text",
        "21",
        "Whenever you want to do something and the price for failure is high, roll 1d100.",
    ]

    assert parse_footer(lines, physical_page=20) == (None, None)


@pytest.mark.parametrize("lines", [[], ["21"], ["", "  "]])
def test_a_page_with_too_little_text_resolves_to_nothing(lines: list[str]) -> None:
    assert parse_footer(lines, physical_page=20) == (None, None)


def test_page_offset_is_configurable_because_it_is_edition_specific() -> None:
    """`printed == physical + 1` held on every PSG 1e page that parsed, with
    no counterexamples — but it is a property of this edition, not of PDFs
    (`§ S1.8`, `docs/decisions.md § Chunk extraction is block-based…`)."""
    lines = ["body", "21", "PANIC CHECKS"]

    assert parse_footer(lines, physical_page=20, page_offset=1) == (21, "PANIC CHECKS")
    assert parse_footer(lines, physical_page=17, page_offset=4) == (21, "PANIC CHECKS")
    assert parse_footer(lines, physical_page=20, page_offset=0) == (None, None)


def test_blank_lines_are_ignored_when_locating_the_footer() -> None:
    lines = ["", "body text", "  ", "21", "PANIC CHECKS", "   "]

    assert parse_footer(lines, physical_page=20) == (21, "PANIC CHECKS")
