"""Unit tests for pipeline/fixup.py.

`ingestion/mothership/fixups.json` is an empty array in M7.2, so in production
this module is exercised only by the empty case. That is exactly the kind of
code that rots unnoticed — these tests are what stop the non-empty path from
being discovered broken by whoever first needs it.
"""

from __future__ import annotations

import json

import pytest

from pipeline.chunk import Block
from pipeline.fixup import FixupError, apply_fixups, load_fixups


def block(block_id: str, text: str = "") -> Block:
    return Block(
        id=block_id,
        block_type="Table",
        text=text,
        bbox=(0.0, 0.0, 100.0, 20.0),
        page=11,
    )


def write(tmp_path, name: str, payload) -> "object":
    path = tmp_path / name
    path.write_text(
        payload if isinstance(payload, str) else json.dumps(payload), encoding="utf-8"
    )
    return path


def test_a_missing_fixup_file_is_not_an_error(tmp_path) -> None:
    """A Phase 2 system nobody has written corrections for yet must still be
    ingestable."""
    assert load_fixups(tmp_path / "nope.json") == []


def test_an_empty_array_loads_as_no_fixups(tmp_path) -> None:
    """Mothership's actual state in M7.2."""
    assert load_fixups(write(tmp_path, "fixups.json", [])) == []


def test_a_fixup_replaces_the_matched_block_text(tmp_path) -> None:
    templates = tmp_path / "templates"
    templates.mkdir()
    (templates / "panic_table.md").write_text("D20 | PANIC EFFECT\n", encoding="utf-8")
    fixups = load_fixups(
        write(
            tmp_path,
            "fixups.json",
            [
                {
                    "description": "Panic table extracted with no text",
                    "match": {"block_id": "/page/11/Table/5"},
                    "replace_with_template": "panic_table.md",
                }
            ],
        )
    )

    blocks = [block("/page/11/Table/4", "kept"), block("/page/11/Table/5", "")]
    patched = apply_fixups(blocks, fixups, templates)

    assert patched[0].text == "kept"
    assert patched[1].text == "D20 | PANIC EFFECT"
    assert patched[1].id == "/page/11/Table/5", "identity and geometry survive"
    assert patched[1].page == 11


def test_a_fixup_matching_nothing_warns_and_does_not_raise(tmp_path, caplog) -> None:
    """A fixup that stops applying after a marker version bump is precisely
    the failure this file exists to survive, and it is invisible in the
    output — so it has to be loud."""
    fixups = load_fixups(
        write(
            tmp_path,
            "fixups.json",
            [
                {
                    "description": "stale entry",
                    "match": {"block_id": "/page/99/Table/9"},
                    "replace_with_template": "irrelevant.md",
                }
            ],
        )
    )

    blocks = [block("/page/11/Table/5", "untouched")]
    patched = apply_fixups(blocks, fixups, tmp_path / "templates")

    assert patched[0].text == "untouched"
    assert any(
        "matched no block" in record.getMessage()
        for record in caplog.records
        if record.levelname == "WARNING"
    )


def test_a_matched_fixup_with_a_missing_template_is_an_error(tmp_path) -> None:
    """Distinct from a fixup that misses: the entry found its block and then
    could not do its job, which is a broken repository, not a stale pin."""
    fixups = load_fixups(
        write(
            tmp_path,
            "fixups.json",
            [
                {
                    "description": "x",
                    "match": {"block_id": "/page/11/Table/5"},
                    "replace_with_template": "absent.md",
                }
            ],
        )
    )

    with pytest.raises(FixupError, match="missing template"):
        apply_fixups([block("/page/11/Table/5")], fixups, tmp_path / "templates")


def test_the_superseded_section_contains_matcher_is_rejected(tmp_path) -> None:
    """`{section, contains}` cannot express either confirmed defect: `contains`
    needs text and the defective blocks hold none, and `section` would derive
    from `section_hierarchy`, a dead end. An old-format file must fail loudly
    rather than silently matching nothing."""
    path = write(
        tmp_path,
        "fixups.json",
        [
            {
                "description": "old schema",
                "match": {"section": ["Combat", "Panic"], "contains": "1-10Roll"},
                "replace_with_template": "panic_table.md",
            }
        ],
    )

    with pytest.raises(FixupError, match="match.block_id"):
        load_fixups(path)


@pytest.mark.parametrize(
    "payload",
    ['{"not": "an array"}', "not json at all", '[{"match": {"block_id": "/page/1/Table/1"}}]'],
)
def test_malformed_fixup_files_raise(tmp_path, payload: str) -> None:
    with pytest.raises(FixupError):
        load_fixups(write(tmp_path, "fixups.json", payload))
