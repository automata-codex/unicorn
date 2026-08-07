"""SHA-256 verification of the input PDF against known editions.

Verification never blocks. A mismatch may mean a different printing rather
than a corrupted file — TKG has released multiple printings of the PSG 1e,
and different printings carry different hashes even when the content is
identical. The consequence of a mismatch is that fixup patches keyed on block
`id` may not land where they are meant to, which matters only once
``fixups.json`` is non-empty. It is empty in M7.2, so a warning is the honest
severity. ``--require-hash`` is deliberately deferred until someone needs it.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

#: Read in chunks rather than whole — a rulebook PDF runs to tens of MB and
#: there is no reason to hold it in memory to hash it.
_READ_SIZE = 1024 * 1024


@dataclass(frozen=True)
class HashCheck:
    actual: str
    matched_edition: str | None
    known_editions: dict[str, str]

    @property
    def ok(self) -> bool:
        return self.matched_edition is not None

    @property
    def had_reference(self) -> bool:
        return bool(self.known_editions)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(_READ_SIZE):
            digest.update(block)
    return digest.hexdigest()


def read_hash_file(path: Path) -> str:
    """First whitespace-delimited field of a ``<hash>  <filename>`` line.

    Only the hash portion is read: the filename column records what the hash
    was taken from on somebody else's machine and carries no authority here.
    """
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        raise ValueError(f"hash file is empty: {path}")
    candidate = text.split()[0].lower()
    if len(candidate) != 64 or not all(c in "0123456789abcdef" for c in candidate):
        raise ValueError(f"hash file does not start with a SHA-256 digest: {path}")
    return candidate


def verify_pdf(pdf_path: Path, hashes_dir: Path) -> HashCheck:
    """Hash ``pdf_path`` and compare against every recorded edition.

    Every ``.txt`` in ``hashes_dir`` is a candidate, and a match against any
    one passes. That is what makes adding a second printing a one-file change
    rather than a code change — the deferral entry "PDF hash stability across
    printings" anticipates exactly that.

    A missing or empty directory is not an error: a Phase 2 system nobody has
    recorded an edition for yet should still be ingestable.
    """
    actual = sha256_file(pdf_path)

    known: dict[str, str] = {}
    if hashes_dir.is_dir():
        for hash_file in sorted(hashes_dir.glob("*.txt")):
            try:
                known[hash_file.stem] = read_hash_file(hash_file)
            except ValueError as err:
                logger.warning("ignoring malformed hash file: %s", err)

    matched = next((name for name, value in known.items() if value == actual), None)
    return HashCheck(actual=actual, matched_edition=matched, known_editions=known)


def log_result(check: HashCheck, pdf_path: Path) -> None:
    """Report the outcome at the severity it actually warrants."""
    if check.ok:
        logger.info("PDF matches known edition '%s'", check.matched_edition)
        return

    if not check.had_reference:
        logger.warning(
            "no reference hashes recorded for this system; skipping verification. "
            "SHA-256 of %s is %s",
            pdf_path.name,
            check.actual,
        )
        return

    logger.warning(
        "PDF does not match any recorded edition (%s). SHA-256 is %s. "
        "Proceeding anyway — this usually means a different printing, not a "
        "corrupt file. Fixup patches keyed on block id may not apply cleanly; "
        "there are none for this system yet, so nothing is affected today.",
        ", ".join(sorted(check.known_editions)),
        check.actual,
    )
