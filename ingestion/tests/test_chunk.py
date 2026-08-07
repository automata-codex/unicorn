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
    chunk_blocks,
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


# ---------------------------------------------------------------------------
# Block merge
# ---------------------------------------------------------------------------

LABEL = "Mothership Player's Survival Guide"


def words(text: str) -> int:
    """Deterministic stand-in for the tiktoken default.

    The ~400-token target is a retrieval heuristic with no hard boundary, so
    testing the splitting logic against an approximate counter loses nothing —
    and it keeps this file free of a network-fetching dependency.
    """
    return len(text.split())


def sentences(n: int, word: str = "word") -> str:
    """`n` five-token sentences, so token budgets are legible in the test."""
    return " ".join(f"{word} {word} {word} {word} s{i}." for i in range(n))


def content_block(
    name: str,
    text: str,
    *,
    page: int = 19,
    block_type: str = "Text",
) -> Block:
    return Block(
        id=f"/page/{page}/{block_type}/{name}",
        block_type=block_type,
        text=text,
        bbox=(20.0, 100.0, 183.0, 120.0),
        page=page,
    )


def chunk(blocks, chapters, **kwargs):
    return chunk_blocks(
        blocks,
        page_chapters=chapters,
        source_label=LABEL,
        count_tokens=words,
        **kwargs,
    )


def test_only_content_block_types_reach_a_chunk() -> None:
    """A whitelist, so a marker version that adds a block type defaults to
    excluding it rather than silently injecting new text into the index."""
    blocks = [
        content_block("h", "STAT CHECKS & SAVES", block_type="SectionHeader"),
        content_block("t", "body prose here", block_type="Text"),
        content_block("p", "", block_type="Picture"),
        content_block("f", "footer junk", block_type="PageFooter"),
        content_block("hd", "header junk", block_type="PageHeader"),
        content_block("l", "list item text", block_type="ListGroup"),
        content_block("c", "a caption", block_type="Caption"),
    ]

    (result,) = chunk(blocks, {19: "STRESS"})

    assert "body prose here" in result.content
    assert "list item text" in result.content
    for excluded in ("STAT CHECKS & SAVES", "footer junk", "header junk", "a caption"):
        assert excluded not in result.content


def test_chapter_change_forces_a_boundary_regardless_of_token_count() -> None:
    """Chapter is the one reliable structural signal this book has, so it is
    the analogue of the heading boundary the original design wanted."""
    blocks = [
        content_block("a", "stress prose", page=19),
        content_block("b", "panic prose", page=20),
    ]

    result = chunk(blocks, {19: "STRESS", 20: "PANIC CHECKS"}, target_tokens=400)

    assert len(result) == 2
    assert result[0].section_path == ["STRESS"]
    assert result[1].section_path == ["PANIC CHECKS"]
    assert "panic prose" not in result[0].content


def test_same_chapter_across_pages_merges_and_cites_a_page_range() -> None:
    blocks = [
        content_block("a", "skills prose", page=21),
        content_block("b", "more skills prose", page=22),
    ]

    (result,) = chunk(blocks, {21: "SKILLS", 22: "SKILLS"})

    assert result.pages == (22, 23)
    assert result.source == f"{LABEL} pp.22-23"


def test_single_page_chunk_cites_one_printed_page() -> None:
    (result,) = chunk([content_block("a", "prose", page=20)], {20: "PANIC CHECKS"})

    assert result.pages == (21,)
    assert result.source == f"{LABEL} p.21"


def test_a_table_is_never_split_even_when_it_exceeds_the_target() -> None:
    """Half a panic table is worse than an oversized chunk."""
    table_text = sentences(30, "row")  # 150 tokens against a 50-token target
    blocks = [
        content_block("a", sentences(4, "before"), page=20),
        content_block("t", table_text, page=20, block_type="Table"),
        content_block("b", sentences(4, "after"), page=20),
    ]

    result = chunk(blocks, {20: "PANIC CHECKS"}, target_tokens=50)

    holding_table = [c for c in result if table_text in c.content]
    assert len(holding_table) == 1, "table text must appear whole, in exactly one chunk"
    assert holding_table[0].content.rstrip().endswith(table_text), (
        "an oversized table is terminal in its chunk — nothing merges in after it"
    )
    assert "after" not in holding_table[0].content


def test_a_table_chunk_still_receives_the_lead_in_overlap() -> None:
    """The asymmetry is deliberate: a table hands over no overlap forward
    (a fragment of rows opening the next chunk is noise), but it still
    receives the prose that introduced it — which is exactly the context a
    bare table of results needs to be interpretable.
    """
    table_text = sentences(30, "row")
    blocks = [
        content_block("a", sentences(8, "lead"), page=20),
        content_block("t", table_text, page=20, block_type="Table"),
    ]

    result = chunk(blocks, {20: "PANIC CHECKS"}, target_tokens=50, overlap_tokens=(10, 20))

    (holding_table,) = [c for c in result if table_text in c.content]
    assert "lead" in holding_table.content


def test_an_oversized_text_block_splits_at_sentence_boundaries() -> None:
    blocks = [content_block("a", sentences(30), page=20)]

    result = chunk(blocks, {20: "PANIC CHECKS"}, target_tokens=50, overlap_tokens=(0, 0))

    assert len(result) > 1
    for c in result:
        body = c.content.split("\n\n", 1)[1]
        assert body.rstrip().endswith("."), "a chunk must not end mid-sentence"


def test_an_oversized_text_block_prefers_paragraph_boundaries() -> None:
    text = f"{sentences(6, 'alpha')}\n\n{sentences(6, 'beta')}"
    blocks = [content_block("a", text, page=20)]

    result = chunk(blocks, {20: "PANIC CHECKS"}, target_tokens=35, overlap_tokens=(0, 0))

    assert len(result) == 2
    assert "beta" not in result[0].content
    assert "alpha" not in result[1].content


def test_adjacent_same_chapter_chunks_overlap_within_the_band() -> None:
    """Measured on the body, not on `content`.

    The breadcrumb is byte-identical across every chunk in a chapter, so an
    overlap check computed over `content` would count the prefix and pass for
    the wrong reason. This is the easiest bug in this part to ship green.
    """
    blocks = [content_block("a", sentences(40), page=20)]

    result = chunk(blocks, {20: "PANIC CHECKS"}, target_tokens=60, overlap_tokens=(10, 20))

    assert len(result) > 2
    for previous, following in zip(result, result[1:]):
        previous_body = previous.content.split("\n\n", 1)[1]
        following_body = following.content.split("\n\n", 1)[1]
        shared = following_body.split("\n\n")[0]
        assert shared and shared in previous_body, "overlap must come from the previous body"
        assert 10 <= words(shared) <= 20


def test_chunks_in_different_chapters_do_not_overlap() -> None:
    blocks = [
        content_block("a", sentences(6, "stress"), page=19),
        content_block("b", sentences(6, "panic"), page=20),
    ]

    first, second = chunk(
        blocks, {19: "STRESS", 20: "PANIC CHECKS"}, overlap_tokens=(10, 20)
    )

    assert "stress" not in second.content


def test_a_chunk_ending_in_a_table_hands_over_no_overlap() -> None:
    """A fragment of a table's rows opening the next chunk reads as unrelated
    noise, and atomicity is why tables are handled separately at all."""
    table_text = sentences(20, "row")
    blocks = [
        content_block("t", table_text, page=20, block_type="Table"),
        content_block("b", sentences(6, "after"), page=20),
    ]

    result = chunk(blocks, {20: "PANIC CHECKS"}, target_tokens=50, overlap_tokens=(10, 20))

    assert len(result) == 2
    assert "row" not in result[1].content


def test_every_chunk_opens_with_the_chapter_breadcrumb() -> None:
    """A continuation chunk of the panic rules can easily never contain the
    word "panic"; the breadcrumb is embedded, so it fixes retrieval rather
    than only presentation."""
    blocks = [content_block("a", sentences(40), page=20)]

    result = chunk(blocks, {20: "PANIC CHECKS"}, target_tokens=60)

    assert len(result) > 1
    for c in result:
        assert c.content.startswith("PANIC CHECKS\n\n")


def test_a_footerless_page_yields_a_chunk_with_no_chapter_and_no_breadcrumb() -> None:
    """5 PSG pages resolve no chapter. They are attributed by page number
    alone rather than failing the run — a placeholder, not a decision about
    the right fallback (M7.5 lever 5)."""
    blocks = [content_block("a", "equipment continuation prose", page=10)]

    (result,) = chunk(blocks, {})

    assert result.section_path == []
    assert result.content == "equipment continuation prose"
    assert result.source == f"{LABEL} p.11"


def test_footerless_pages_do_not_merge_with_each_other() -> None:
    """Without a chapter there is no evidence two pages are the same section,
    so merging them would manufacture an adjacency the footer never asserted."""
    blocks = [
        content_block("a", "cover text", page=1),
        content_block("b", "credits text", page=2),
    ]

    result = chunk(blocks, {})

    assert len(result) == 2


def test_drop_pages_excludes_a_page_entirely() -> None:
    """The seam M7.5's character-creation exclusion flips. Empty in M7.2."""
    blocks = [
        content_block("a", "character creation prose", page=4),
        content_block("b", "panic prose", page=20),
    ]

    result = chunk(blocks, {20: "PANIC CHECKS"}, drop_pages=frozenset({4}))

    assert len(result) == 1
    assert "character creation" not in result[0].content


def test_page_offset_is_applied_to_the_citation() -> None:
    blocks = [content_block("a", "prose", page=20)]

    (default,) = chunk(blocks, {20: "PANIC CHECKS"})
    (shifted,) = chunk(blocks, {20: "PANIC CHECKS"}, page_offset=3)

    assert default.source.endswith("p.21")
    assert shifted.source.endswith("p.23")


def test_empty_and_whitespace_only_blocks_produce_no_chunks() -> None:
    """14 of 32 PSG `Table` blocks extract as `<p></p>` (`§ S3.2`). They must
    drop out rather than becoming empty chunks with a breadcrumb and no body.
    """
    blocks = [
        content_block("t", "", page=11, block_type="Table"),
        content_block("u", "   \n  ", page=11, block_type="Table"),
    ]

    assert chunk(blocks, {11: "FIREARMS"}) == []


@pytest.mark.parametrize(
    "kwargs", [{"target_tokens": 0}, {"overlap_tokens": (100, 50)}, {"overlap_tokens": (-1, 50)}]
)
def test_invalid_chunking_parameters_are_rejected(kwargs) -> None:
    with pytest.raises(ValueError):
        chunk([content_block("a", "prose")], {19: "STRESS"}, **kwargs)


# ---------------------------------------------------------------------------
# The M7.5 chunking levers
#
# Each of these changes what lands in the index, which is why `ingest.py`
# records all four in the manifest. Tested here because a lever that silently
# does nothing would show up in M7.5's iteration as "that change didn't help"
# rather than as a bug.
# ---------------------------------------------------------------------------


def test_drop_pages_excludes_several_pages_and_leaves_the_rest() -> None:
    """The character-creation exclusion's shape: a set, not a single page."""
    blocks = [
        content_block("a", "character creation prose", page=4),
        content_block("b", "duplicate spread", page=41),
        content_block("c", "duplicate spread again", page=42),
        content_block("d", "panic prose", page=20),
    ]

    result = chunk(
        blocks,
        {20: "PANIC CHECKS", 4: "CREATION"},
        drop_pages=frozenset({4, 41, 42}),
    )

    assert len(result) == 1
    assert "panic prose" in result[0].content
    for dropped in ("character creation", "duplicate spread"):
        assert dropped not in result[0].content


def test_section_headers_are_indexed_when_the_lever_is_on() -> None:
    """M7.5 lever 3. `surprise` is absent from the whole corpus only because
    the PSG prints it as a `26.2 SURPRISE` heading and headings are excluded
    (`§ S9.1`); this is the switch that tests whether including them helps."""
    blocks = [
        content_block("h", "26.2 SURPRISE", block_type="SectionHeader"),
        content_block("t", "body prose here", block_type="Text"),
    ]

    (result,) = chunk(blocks, {19: "STRESS"}, include_section_headers=True)

    assert "26.2 SURPRISE" in result.content
    assert "body prose here" in result.content


def test_the_section_header_lever_admits_one_type_not_every_type() -> None:
    """It extends the whitelist rather than inverting it. A marker version
    that adds a new block type must still default to excluded even with this
    lever on — otherwise the flag quietly changes the safety property the
    whitelist exists for."""
    blocks = [
        content_block("h", "26.2 SURPRISE", block_type="SectionHeader"),
        content_block("t", "body prose here", block_type="Text"),
        content_block("f", "footer junk", block_type="PageFooter"),
        content_block("hd", "header junk", block_type="PageHeader"),
        content_block("c", "a caption", block_type="Caption"),
        content_block("n", "some new marker type", block_type="Equation"),
    ]

    (result,) = chunk(blocks, {19: "STRESS"}, include_section_headers=True)

    assert "26.2 SURPRISE" in result.content
    for excluded in ("footer junk", "header junk", "a caption", "some new marker type"):
        assert excluded not in result.content


def test_section_headers_stay_excluded_by_default() -> None:
    """The M7.2 behaviour, pinned. Round 3 of M7.5's iteration is allowed to
    flip this default — but only deliberately, with a measurement behind it."""
    blocks = [
        content_block("h", "26.2 SURPRISE", block_type="SectionHeader"),
        content_block("t", "body prose here", block_type="Text"),
    ]

    (result,) = chunk(blocks, {19: "STRESS"})

    assert "26.2 SURPRISE" not in result.content


def test_a_smaller_target_produces_more_chunks() -> None:
    """`target_tokens` is an inherited heuristic that has never been swept
    (`docs/rules-ingestion.md § Step 4`). Sweeping it requires that it
    actually move the output."""
    # 40 five-token sentences: 200 tokens, so a 200-token target is exactly
    # one chunk and anything below it must split.
    blocks = [content_block("a", sentences(40))]
    band = (5, 10)

    coarse = chunk(blocks, {19: "STRESS"}, target_tokens=100, overlap_tokens=band)
    fine = chunk(blocks, {19: "STRESS"}, target_tokens=25, overlap_tokens=band)

    assert len(fine) > len(coarse) > 1


def test_a_wider_overlap_band_repeats_more_of_the_previous_chunk() -> None:
    blocks = [content_block("a", sentences(40))]

    narrow = chunk(blocks, {19: "STRESS"}, target_tokens=50, overlap_tokens=(5, 10))
    wide = chunk(blocks, {19: "STRESS"}, target_tokens=50, overlap_tokens=(20, 40))

    # Compare the second chunk of each: the first never carries an overlap.
    assert words(wide[1].content) > words(narrow[1].content)
