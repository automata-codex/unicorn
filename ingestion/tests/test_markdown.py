"""Unit tests for pipeline/markdown.py, and the first end-to-end pipeline test.

Pure Python over synthetic curated files: no marker, no Voyage key, no
database, no real book. Standard library only, like `test_chunk.py` — the
whole point of the curated path is that it works without marker's model
weights, and a test that needed them would disprove the claim it exists to
make.

**The rules text here is invented.** `docs/rules-ingestion.md § Licensing
Posture` and § What ships in the repository forbid committing extracted or
curated book text, and a test fixture is no exception. These are a few lines
of plausible sci-fi mechanics that resemble the shape of a rules page without
being one.

The last test in this file is the one that could not be written before this
module existed: a whole document, from raw Markdown through to finished
`Chunk` objects, with no model weights anywhere in the call graph.
"""

from __future__ import annotations

import pytest

from pipeline.chunk import chunk_blocks
from pipeline.markdown import CuratedMarkdownError, parse_curated_markdown

LABEL = "Test Survival Guide"


def parse(text: str, page_offset: int = 1):
    return parse_curated_markdown(text, page_offset=page_offset)


def kinds(blocks) -> list[tuple[str, str]]:
    return [(b.block_type, b.text) for b in blocks]


# ---------------------------------------------------------------------------
# Page markers
# ---------------------------------------------------------------------------


def test_page_marker_sets_the_physical_page_via_the_offset() -> None:
    """The marker carries the **printed** page — what a transcriber reads off
    the paper — and the offset converts it, so a curated file and a PDF of the
    same book agree about what "page 21" means."""
    blocks, _ = parse("<!-- page: 21 -->\nSome prose.\n")

    assert [b.page for b in blocks] == [20]


def test_page_offset_of_zero_is_honoured() -> None:
    blocks, _ = parse("<!-- page: 21 -->\nSome prose.\n", page_offset=0)

    assert [b.page for b in blocks] == [21]


@pytest.mark.parametrize(
    "marker",
    ["<!-- page: 7 -->", "<!--page:7-->", "<!--  PAGE:  7  -->", "  <!-- page: 7 -->  "],
)
def test_page_marker_tolerates_whitespace_and_case(marker: str) -> None:
    blocks, _ = parse(f"{marker}\nSome prose.\n", page_offset=0)

    assert [b.page for b in blocks] == [7]


def test_content_before_any_page_marker_is_a_hard_error() -> None:
    """Not a warning defaulting to page 1. `source` is the only provenance the
    runtime ever surfaces and the sole channel the retrieval scorer reads page
    labels from, so a silently mis-paged corpus scores every fixture as a miss
    for a reason that has nothing to do with retrieval."""
    with pytest.raises(CuratedMarkdownError, match="page"):
        parse("Some prose with no page marker.\n")


def test_a_heading_before_any_page_marker_is_also_an_error() -> None:
    with pytest.raises(CuratedMarkdownError):
        parse("## A subsection\n\n<!-- page: 3 -->\n")


def test_a_chapter_heading_before_the_first_page_marker_is_allowed() -> None:
    """`#` sets a chapter rather than emitting a block, so it carries no page
    of its own and a file may open with one."""
    blocks, chapters = parse("# PANIC CHECKS\n\n<!-- page: 21 -->\nProse.\n")

    assert chapters == {20: "PANIC CHECKS"}
    assert kinds(blocks) == [("Text", "Prose.")]


# ---------------------------------------------------------------------------
# Chapters
# ---------------------------------------------------------------------------


def test_a_chapter_applies_to_every_page_it_spans() -> None:
    """A chapter is named once and stays in force. Every page it covers has to
    reach `page_chapters`, because `_chapter_key` gives a page with no chapter
    a key unique to itself — which would break one chapter into one chunk-run
    per page."""
    _, chapters = parse(
        "<!-- page: 20 -->\n# STRESS\nProse.\n"
        "<!-- page: 21 -->\nMore prose.\n"
        "<!-- page: 22 -->\nYet more.\n"
    )

    assert chapters == {19: "STRESS", 20: "STRESS", 21: "STRESS"}


def test_a_new_chapter_takes_over_from_where_it_appears() -> None:
    _, chapters = parse(
        "<!-- page: 20 -->\n# STRESS\nProse.\n"
        "<!-- page: 21 -->\n# PANIC CHECKS\nProse.\n"
        "<!-- page: 22 -->\nProse.\n"
    )

    assert chapters == {19: "STRESS", 20: "PANIC CHECKS", 21: "PANIC CHECKS"}


def test_a_chapter_may_open_a_page_it_did_not_start() -> None:
    """The common, correct case: page marker, then the chapter heading. The
    page carries the new chapter, not the one running into it."""
    _, chapters = parse(
        "<!-- page: 20 -->\n# STRESS\nProse.\n<!-- page: 21 -->\n# PANIC CHECKS\nProse.\n"
    )

    assert chapters == {19: "STRESS", 20: "PANIC CHECKS"}


def test_a_chapter_heading_after_content_on_the_same_page_is_rejected() -> None:
    """`page_chapters` is a page->chapter map — the same shape the running
    footer produces — so a page has exactly one chapter and a mid-page change
    cannot be represented. Left unguarded, this silently re-labels the prose
    above the heading, and `chunk.py` is explicit that a wrong breadcrumb is
    worse than none: it is embedded and read by the Warden, not just shown.
    """
    document = (
        "<!-- page: 20 -->\n"
        "# STRESS\n"
        "Stress carries between sessions.\n"
        "\n"
        "# PANIC CHECKS\n"
        "Roll the Panic Die.\n"
    )

    with pytest.raises(CuratedMarkdownError, match="page boundary"):
        parse(document)


def test_a_chapter_heading_emits_no_block_of_its_own() -> None:
    """It is breadcrumb material, not content — the same role the running
    footer plays on the PDF path."""
    blocks, _ = parse("<!-- page: 20 -->\n# STRESS\nProse.\n")

    assert kinds(blocks) == [("Text", "Prose.")]


# ---------------------------------------------------------------------------
# Block typing
# ---------------------------------------------------------------------------


def test_subheadings_become_section_header_blocks() -> None:
    """Indexed or not according to `include_section_headers`, exactly as on
    the PDF path — the curated path does not get its own policy."""
    blocks, _ = parse("<!-- page: 20 -->\n## 20.1 GAINING STRESS\n### Deeper\n")

    assert kinds(blocks) == [
        ("SectionHeader", "20.1 GAINING STRESS"),
        ("SectionHeader", "Deeper"),
    ]


def test_blank_lines_separate_paragraphs_into_separate_blocks() -> None:
    blocks, _ = parse("<!-- page: 20 -->\nFirst para.\n\nSecond para.\n")

    assert kinds(blocks) == [("Text", "First para."), ("Text", "Second para.")]


def test_wrapped_lines_stay_one_block() -> None:
    """A transcriber wraps at 80 columns; that is typography, not structure."""
    blocks, _ = parse("<!-- page: 20 -->\nA sentence that\nwraps across lines.\n")

    assert kinds(blocks) == [("Text", "A sentence that\nwraps across lines.")]


def test_a_list_run_becomes_one_listgroup_block() -> None:
    blocks, _ = parse("<!-- page: 20 -->\n- first item\n- second item\n* third item\n")

    assert [b.block_type for b in blocks] == ["ListGroup"]
    assert "third item" in blocks[0].text


def test_a_table_becomes_one_atomic_table_block() -> None:
    """`Table` is the type `chunk_blocks` never splits. Half a panic table is
    worse than an oversized chunk, and that has to hold on both paths."""
    blocks, _ = parse(
        "<!-- page: 20 -->\n"
        "| ROLL | RESULT |\n|---|---|\n| 1-3 | Nothing |\n| 4-6 | Something |\n"
    )

    assert [b.block_type for b in blocks] == ["Table"]
    assert "4-6" in blocks[0].text


def test_adjacent_constructs_of_different_kinds_split() -> None:
    blocks, _ = parse(
        "<!-- page: 20 -->\n"
        "Lead-in prose.\n"
        "- a list item\n"
        "| ROLL | RESULT |\n| 1 | x |\n"
        "Trailing prose.\n"
    )

    assert [b.block_type for b in blocks] == ["Text", "ListGroup", "Table", "Text"]


def test_block_ids_mirror_markers_shape() -> None:
    """So anything keying on an id — `fixups.json`'s matcher, a log line, a
    debugging eye — reads the same on both paths."""
    blocks, _ = parse("<!-- page: 21 -->\nProse.\n")

    assert blocks[0].id.startswith("/page/20/Text/")


def test_synthetic_blocks_carry_a_zero_bbox_not_invented_geometry() -> None:
    """Nothing on this path consumes bbox — the reading-order sort is skipped
    — and plausible-looking coordinates that describe no real page are the
    exact class of metadata the findings file keeps cataloguing as dangerous.
    Zeros are visibly synthetic."""
    blocks, _ = parse("<!-- page: 21 -->\nProse.\n")

    assert blocks[0].bbox == (0.0, 0.0, 0.0, 0.0)


# ---------------------------------------------------------------------------
# End to end, with no model weights in the call graph
# ---------------------------------------------------------------------------

DOCUMENT = """\
# STRESS

<!-- page: 20 -->

## 20.1 GAINING STRESS

Whenever a Contractor fails a Save, they gain one Stress. Stress is never
lost through rest alone.

- Failing a Save: +1 Stress
- Witnessing a death: +2 Stress

<!-- page: 21 -->

Stress carries between sessions and is only relieved by shore leave.

<!-- page: 22 -->

# PANIC CHECKS

Roll the Panic Die and add your Stress.

| ROLL | EFFECT |
|---|---|
| 1-3 | Steady |
| 4-6 | Shaken |
"""


def words(text: str) -> int:
    return len(text.split())


def test_a_whole_curated_document_reaches_chunks_without_marker() -> None:
    """The capability this part exists to prove: chunk -> (embed) -> store is
    now exercisable end to end with no model weights, no network, and no PDF.

    Asserts the four properties a curated index has to share with an extracted
    one, since `chunk_blocks` is the same code for both: page-range citations
    in the contract format the scorer parses, chapter breadcrumbs on every
    chunk, a chapter change forcing a boundary, and tables kept intact.
    """
    blocks, chapters = parse_curated_markdown(DOCUMENT, page_offset=1)

    chunks = chunk_blocks(
        blocks,
        page_chapters=chapters,
        source_label=LABEL,
        page_offset=1,
        count_tokens=words,
    )

    assert chunks, "a curated document must produce chunks"

    # A chapter change forces a break, so STRESS and PANIC CHECKS never merge.
    paths = [tuple(c.section_path) for c in chunks]
    assert ("STRESS",) in paths
    assert ("PANIC CHECKS",) in paths

    # Every chunk opens with its breadcrumb and cites its pages in the format
    # `parseCitedPages` treats as a contract: ASCII `p.`/`pp.`, hyphen, printed
    # page numbers.
    for chunk in chunks:
        assert chunk.section_path
        assert chunk.content.startswith(chunk.section_path[0])
        assert chunk.source.startswith(f"{LABEL} p")

    stress = [c for c in chunks if c.section_path == ["STRESS"]]
    assert any("pp.20-21" in c.source for c in stress), (
        "a chapter spanning two pages must cite the range, which only works "
        "because the chapter reached page_chapters for both pages"
    )

    panic = next(c for c in chunks if c.section_path == ["PANIC CHECKS"])
    assert "| 1-3 | Steady |" in panic.content
    assert "| 4-6 | Shaken |" in panic.content


def test_section_headers_in_a_curated_file_obey_the_same_lever() -> None:
    blocks, chapters = parse_curated_markdown(DOCUMENT, page_offset=1)

    def render(**kwargs) -> str:
        return "\n".join(
            c.content
            for c in chunk_blocks(
                blocks,
                page_chapters=chapters,
                source_label=LABEL,
                page_offset=1,
                count_tokens=words,
                **kwargs,
            )
        )

    assert "20.1 GAINING STRESS" not in render()
    assert "20.1 GAINING STRESS" in render(include_section_headers=True)
