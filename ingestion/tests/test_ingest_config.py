"""Unit tests for `ingest.py`'s chunking-lever resolution.

Argument parsing and config merging only — no PDF, no marker, no Voyage key,
no database. `ingest.py` is importable with the standard library alone
(every heavy dependency is imported lazily inside the function that needs
it), which is what earns this file the same CI slot as `test_chunk.py`.

**Why this layer is worth testing at all.** The four levers here are what
M7.5's chunking iteration turns, and `write_manifest` reports whatever they
resolve to as the provenance of the resulting index. A lever that silently
fails to apply, or a manifest that disagrees with the chunker about what ran,
produces two incomparable retrieval scores that look directly comparable —
the failure `docs/rules-extraction-findings.md § S15.7` and the manifest
itself exist to prevent.
"""

from __future__ import annotations

import argparse

import pytest

from ingest import (
    CHUNKING_DEFAULTS,
    build_parser,
    parse_overlap,
    parse_page_list,
    resolve_chunking,
)

BASE_CONFIG = {"source_label": "A Book", "page_offset": 1}


def parse(*argv: str) -> argparse.Namespace:
    return build_parser().parse_args(
        ["--system", "mothership", "--pdf", "book.pdf", *argv]
    )


# ---------------------------------------------------------------------------
# Flag value parsing
# ---------------------------------------------------------------------------


def test_overlap_parses_a_band() -> None:
    assert parse_overlap("50,100") == (50, 100)
    assert parse_overlap(" 50 , 100 ") == (50, 100)


@pytest.mark.parametrize("raw", ["50", "50,100,150", "", "a,b", "50,x"])
def test_a_malformed_overlap_is_rejected_rather_than_guessed(raw: str) -> None:
    """A single value has no unambiguous reading — the overlap is a range,
    accumulated as whole sentences from the end while they fit — so guessing
    a band around it would invent a configuration nobody asked for."""
    with pytest.raises(argparse.ArgumentTypeError):
        parse_overlap(raw)


def test_page_list_parses_and_deduplicates() -> None:
    assert parse_page_list("4,41,42") == frozenset({4, 41, 42})
    assert parse_page_list(" 4 , 4 , 41 ") == frozenset({4, 41})
    assert parse_page_list("") == frozenset()


@pytest.mark.parametrize("raw", ["4,x", "four", "4;41"])
def test_a_malformed_page_list_is_rejected(raw: str) -> None:
    with pytest.raises(argparse.ArgumentTypeError):
        parse_page_list(raw)


# ---------------------------------------------------------------------------
# Precedence: CLI beats config beats default
# ---------------------------------------------------------------------------


def test_defaults_apply_when_neither_config_nor_flag_says_anything() -> None:
    """The M7.2 behaviour, pinned. An existing `system.json` that predates
    these keys must keep producing exactly the index it produced before."""
    assert resolve_chunking(parse(), BASE_CONFIG) == CHUNKING_DEFAULTS


def test_config_overrides_the_default() -> None:
    config = {
        **BASE_CONFIG,
        "drop_pages": [4, 41, 42],
        "target_tokens": 250,
        "include_section_headers": True,
    }

    resolved = resolve_chunking(parse(), config)

    assert resolved["drop_pages"] == frozenset({4, 41, 42})
    assert resolved["target_tokens"] == 250
    assert resolved["include_section_headers"] is True
    assert resolved["overlap_tokens"] == (50, 100)


def test_a_flag_overrides_the_config() -> None:
    """The precedence that makes a one-off sweep possible without editing a
    config file and then having to remember to revert it."""
    config = {**BASE_CONFIG, "target_tokens": 250, "drop_pages": [4]}

    resolved = resolve_chunking(
        parse("--target-tokens", "600", "--drop-pages", "3,4"), config
    )

    assert resolved["target_tokens"] == 600
    assert resolved["drop_pages"] == frozenset({3, 4})


def test_an_absent_flag_does_not_clobber_a_configured_value() -> None:
    """The bug this test exists for: if the flags defaulted to the built-in
    values rather than to `None`, every run would silently overwrite the
    book's own settled configuration with the defaults."""
    config = {**BASE_CONFIG, "target_tokens": 250, "include_section_headers": True}

    resolved = resolve_chunking(parse("--overlap", "10,20"), config)

    assert resolved["target_tokens"] == 250
    assert resolved["include_section_headers"] is True
    assert resolved["overlap_tokens"] == (10, 20)


def test_dropping_no_pages_is_expressible_as_an_override() -> None:
    """`--drop-pages ''` has to mean "none", not "fall through to the
    config" — otherwise a configured exclusion cannot be turned off for a
    single measurement round."""
    config = {**BASE_CONFIG, "drop_pages": [4, 41, 42]}

    assert resolve_chunking(parse("--drop-pages", ""), config)["drop_pages"] == frozenset()


# ---------------------------------------------------------------------------
# Normalization and validation at the boundary
# ---------------------------------------------------------------------------


def test_json_lists_are_normalized_to_what_the_chunker_expects() -> None:
    """`system.json` can only express lists. `chunk_blocks` wants a tuple and
    a frozenset, and a mismatch would surface deep inside the merge rather
    than at the config boundary where it can be explained."""
    config = {**BASE_CONFIG, "overlap_tokens": [30, 60], "drop_pages": [4]}

    resolved = resolve_chunking(parse(), config)

    assert isinstance(resolved["overlap_tokens"], tuple)
    assert isinstance(resolved["drop_pages"], frozenset)
    assert resolved["overlap_tokens"] == (30, 60)


def test_a_config_overlap_that_is_not_a_pair_is_rejected() -> None:
    with pytest.raises(ValueError):
        resolve_chunking(parse(), {**BASE_CONFIG, "overlap_tokens": [50]})


def test_resolved_keys_match_the_chunker_and_the_manifest_exactly() -> None:
    """One name per concept, end to end. `build_chunks` splats this dict
    straight into `chunk_blocks`, so an extra or renamed key is a TypeError
    at ingestion time — after extraction has already run."""
    assert set(resolve_chunking(parse(), BASE_CONFIG)) == set(CHUNKING_DEFAULTS)
