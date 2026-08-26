"""Unit tests for pipeline/extract.py's HTML reduction.

Covers the pure parts: `html_to_text`, which decides what text actually lands
in the index, and `fill_chapter_gaps`, which decides what chapter a chunk is
attributed to. Both can be tested without marker's models or a real PDF. The
marker subprocess and the pypdfium2 footer read are not tested here — they are
covered by the manual run, per the spec's Testing Summary.

`extract.py` imports pypdfium2 lazily for exactly this reason, so importing
the module in CI costs nothing.
"""

from __future__ import annotations

import pytest

from pipeline.chunk import Block
from pipeline.extract import (
    ExtractionError,
    _assert_text_layer,
    fill_chapter_gaps,
    html_to_text,
)


def test_paragraphs_become_blank_line_separated() -> None:
    """Blank lines are load-bearing: `_split_oversized` prefers paragraph
    boundaries over sentence boundaries when a block must be broken up, and it
    detects them as runs of two or more newlines."""
    html = "<p>First paragraph.</p><p>Second paragraph.</p>"

    assert html_to_text(html) == "First paragraph.\n\nSecond paragraph."


def test_a_table_keeps_its_rows_and_cells() -> None:
    """Marker's `chunks` format keeps tables as HTML instead of flattening
    them, which is its main advantage over the Markdown output for a rules
    book. Flattening here would hand that advantage straight back."""
    html = (
        "<table>"
        "<tr><th>ITEM</th><th>COST</th></tr>"
        "<tr><td>Assorted Tools</td><td>20cr</td></tr>"
        "<tr><td>Automed (x5)</td><td>1.5kcr</td></tr>"
        "</table>"
    )

    assert html_to_text(html) == (
        "ITEM | COST\nAssorted Tools | 20cr\nAutomed (x5) | 1.5kcr"
    )


def test_list_items_become_lines() -> None:
    html = "<ul><li>Sanity</li><li>Fear</li><li>Body</li></ul>"

    assert html_to_text(html) == "Sanity\nFear\nBody"


def test_entities_are_unescaped() -> None:
    html = "<p>Stat Checks &amp; Saves &mdash; roll under.</p>"

    assert html_to_text(html) == "Stat Checks & Saves — roll under."


def test_line_breaks_are_honoured() -> None:
    html = "<p>Adjacent<br/>Close Range</p>"

    assert html_to_text(html) == "Adjacent\nClose Range"


def test_internal_whitespace_is_normalised() -> None:
    html = "<p>Roll   1d100\n   and    attempt\tto go under.</p>"

    assert html_to_text(html) == "Roll 1d100 and attempt to go under."


def test_an_empty_table_block_reduces_to_nothing() -> None:
    """14 of 32 PSG `Table` blocks extract as exactly this. They have to
    reduce to empty so the chunker drops them, rather than becoming a chunk
    that is a breadcrumb and a pipe character (`§ S3.2`)."""
    assert html_to_text("<p></p>") == ""
    assert html_to_text("<table><tr><td></td><td></td></tr></table>") == ""


def test_missing_html_reduces_to_empty_string() -> None:
    assert html_to_text(None) == ""
    assert html_to_text("") == ""


def test_runs_of_blank_lines_collapse() -> None:
    html = "<p>One.</p><p></p><p></p><p>Two.</p>"

    assert html_to_text(html) == "One.\n\nTwo."


# ---------------------------------------------------------------------------
# Text-layer floor
# ---------------------------------------------------------------------------


def synthetic_block(text: str) -> Block:
    return Block(
        id="/page/0/Text/0",
        block_type="Text",
        text=text,
        bbox=(0.0, 0.0, 100.0, 20.0),
        page=0,
    )


def test_a_healthy_text_layer_passes_the_floor() -> None:
    blocks = [synthetic_block("x" * 2400) for _ in range(44)]

    _assert_text_layer(blocks, page_count=44)  # does not raise


def test_a_scanned_pdf_fails_loudly_and_names_ocr() -> None:
    """`--disable_ocr` is not optional on a stock install, but it makes a
    scanned-only PDF yield near-empty blocks rather than an error. Without
    this floor the pipeline would cheerfully index three chunks and report
    success (`§ S1.2`)."""
    blocks = [synthetic_block("") for _ in range(44)]

    with pytest.raises(ExtractionError, match="no embedded text layer"):
        _assert_text_layer(blocks, page_count=44)


def test_the_floor_scales_with_page_count() -> None:
    """A short PDF is not a broken one — 300 characters is fine across two
    pages and catastrophic across forty."""
    blocks = [synthetic_block("x" * 300)]

    _assert_text_layer(blocks, page_count=2)
    with pytest.raises(ExtractionError):
        _assert_text_layer(blocks, page_count=40)


class TestFillChapterGaps:
    """`fill_chapter_gaps` — inheritance for footer-less pages.

    The PSG case these encode: physical 10 is equipment continuation whose
    footer does not parse and which should inherit `EQUIPMENT`, while physical
    1 and 43 are reference cards that belong to no chapter at all.
    """

    def test_a_gap_inherits_the_preceding_chapter(self) -> None:
        filled = fill_chapter_gaps({0: "EQUIPMENT"}, 3)

        assert filled == {0: "EQUIPMENT", 1: "EQUIPMENT", 2: "EQUIPMENT"}

    def test_a_chapterless_page_stays_blank(self) -> None:
        filled = fill_chapter_gaps(
            {0: "EQUIPMENT"}, 3, chapterless_pages=frozenset({1, 2})
        )

        assert filled == {0: "EQUIPMENT"}

    def test_a_chapterless_page_stops_the_carry(self) -> None:
        """A card between two chapters must not leak the earlier one past itself.

        Without this, physical 43 (back cover) would hand `SURVIVAL` to
        anything following it, and a reader would be told the back-cover
        reference card is part of the last chapter of the book.
        """
        filled = fill_chapter_gaps(
            {0: "COMBAT"}, 4, chapterless_pages=frozenset({1})
        )

        assert filled == {0: "COMBAT"}

    def test_a_later_chapter_resumes_the_carry(self) -> None:
        filled = fill_chapter_gaps({0: "COMBAT", 2: "SURVIVAL"}, 4)

        assert filled == {
            0: "COMBAT",
            1: "COMBAT",
            2: "SURVIVAL",
            3: "SURVIVAL",
        }

    def test_leading_pages_before_any_chapter_stay_blank(self) -> None:
        """Nothing to inherit from — front matter must not borrow forwards."""
        filled = fill_chapter_gaps({2: "COMBAT"}, 4)

        assert filled == {2: "COMBAT", 3: "COMBAT"}

    def test_the_input_is_not_mutated(self) -> None:
        chapters = {0: "COMBAT"}

        fill_chapter_gaps(chapters, 3)

        assert chapters == {0: "COMBAT"}
