"""Per-edition corrections to extracted blocks, matched on block ``id``.

Marker's output is imperfect for dense rules layouts. The known defect is
tables that extract with no text at all — 14 of 32 in the PSG, taking physical
pages 11 and 12 out of the index entirely. A fixup file lets a specific block
be replaced with structural scaffolding the user's own extraction populates.

**Matched on block ``id``, not on content.** The obvious matcher — "find the
block containing this text" — cannot express the defect it exists to correct:
the defective blocks hold exactly ``<p></p>``, so there is nothing to match
against. Matching on section is no better; that would derive from marker's
``section_hierarchy``, which records the last header seen at each visual level
and turns siblings into parents. See ``docs/decisions.md § Fixup match schema
keyed on block id``.

``ingestion/mothership/fixups.json`` is an empty array in M7.2. This module is
plumbing exercised only by the empty case, which is exactly the kind of code
that rots unnoticed — hence the loud warning on an entry that matches nothing.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path

from .chunk import Block

logger = logging.getLogger(__name__)


class FixupError(ValueError):
    """A fixup file is malformed. Distinct from a fixup that simply misses."""


@dataclass(frozen=True)
class Fixup:
    description: str
    block_id: str
    template: str


def load_fixups(path: Path) -> list[Fixup]:
    """Parse a system's ``fixups.json``. A missing file is not an error."""
    if not path.exists():
        logger.info("no fixup file at %s; continuing without fixups", path)
        return []

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as err:
        raise FixupError(f"{path} is not valid JSON: {err}") from err

    if not isinstance(payload, list):
        raise FixupError(f"{path} must contain a JSON array, got {type(payload).__name__}")

    fixups: list[Fixup] = []
    for index, entry in enumerate(payload):
        where = f"{path} entry {index}"
        if not isinstance(entry, dict):
            raise FixupError(f"{where} is not an object")
        match = entry.get("match")
        if not isinstance(match, dict) or not match.get("block_id"):
            raise FixupError(
                f"{where} has no match.block_id. Fixups are matched on the "
                "block id (e.g. '/page/11/Table/5'); the {section, contains} "
                "schema an earlier draft specified cannot express the defects "
                "this file exists for."
            )
        template = entry.get("replace_with_template")
        if not template:
            raise FixupError(f"{where} has no replace_with_template")
        fixups.append(
            Fixup(
                description=str(entry.get("description", "")),
                block_id=str(match["block_id"]),
                template=str(template),
            )
        )
    return fixups


def apply_fixups(
    blocks: list[Block], fixups: list[Fixup], templates_dir: Path
) -> list[Block]:
    """Replace matched blocks' text with their template's contents.

    An entry matching nothing is a warning rather than a silent no-op: a fixup
    that stops applying after a marker version bump is precisely the failure
    this file exists to survive, and it is invisible in the output.
    """
    if not fixups:
        return blocks

    by_id = {block.id: index for index, block in enumerate(blocks)}
    patched = list(blocks)
    applied = 0

    for fixup in fixups:
        index = by_id.get(fixup.block_id)
        if index is None:
            logger.warning(
                "fixup matched no block: id=%s (%s). The block id may have "
                "changed with a marker version bump, or this PDF may be a "
                "different printing.",
                fixup.block_id,
                fixup.description or "no description",
            )
            continue

        template_path = templates_dir / fixup.template
        if not template_path.exists():
            raise FixupError(
                f"fixup for {fixup.block_id} references a missing template: {template_path}"
            )

        original = patched[index]
        patched[index] = Block(
            id=original.id,
            block_type=original.block_type,
            text=template_path.read_text(encoding="utf-8").strip(),
            bbox=original.bbox,
            page=original.page,
        )
        applied += 1
        logger.info("applied fixup to %s (%s)", fixup.block_id, fixup.description)

    logger.info("applied %d of %d fixups", applied, len(fixups))
    return patched
