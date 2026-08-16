# 017 — reference inventory

Working artifact, produced by `docs/tooling/references.core.ts` before any
reference was rewritten. Delete after execution.

Scope is the ADR source files under `docs/decisions/` plus the seven other
living docs. `docs/decisions.md` is not scanned — it is generated, so a
rewrite there is discarded by the next build. `specs/`, `plans/`, and
`milestones/` are frozen historical records and are out of scope.

## Totals

240 `§` tokens across 102 files.

| Class | Count | Disposition |
|---|---|---|
| resolves | 0 | Rewritten automatically to a bare `ADR-NNNN` token |
| ambiguous | 0 | **Left in place. Needs Alex.** |
| out of scope | 239 | Untouched — numeric citations, other documents, intra-document sections |
| unresolved | 1 | **Left in place. The rot report.** |

## Files with at least one in-scope reference

| File | resolves | ambiguous | out of scope | unresolved |
|---|---|---|---|---|
| `roadmap.md` | 0 | 0 | 55 | 1 |

## Ambiguous — author-truncated titles

Each reference below is a prefix of exactly one entry title, so the target is
determined rather than guessed — but the author wrote less than the full title,
and the spec reserves this class for human confirmation.

| Location | Reference text | Candidate |
|---|---|---|


## Unresolved — matches no entry title

The rot report. Do not guess a target for these.

| Location | Reference text |
|---|---|
| `roadmap.md:286` | Open questions |
