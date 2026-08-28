---
id: ADR-0116
title: Warden eval findings get their own log, and the `S` numbering spans both files
area: eval-harness
status: accepted
superseded_by: null
milestone: M7.7
summary: >-
  `rules-extraction-findings.md § S30`–`§ S36` are Warden eval findings in a file about
  chunking PDFs. `docs/eval-findings.md` takes the subject from `§ S37` on, continuing the
  same numbering — the break is forward-only because frozen plans cite the older sections
  by file and number.
---

## Context

`docs/rules-extraction-findings.md` describes itself as "a running record of what has
actually been tried against real rulebook PDFs… Chunking and extraction are expected to
need several iterations." `§ S1`–`§ S23` are exactly that: PDF block extraction,
column-aware sort, FTS versus dense retrieval, DF trimming, MRR bars. `§ S24`–`§ S29`
stretch to the primer and query-side retrieval, still tethered to the rules corpus.

From `§ S30` on 2026-08-09 the series stops being about rules extraction:

| | |
|---|---|
| `§ S30` | the attribution field shipped and made a *check* worse |
| `§ S31`, `§ S33`, `§ S34` | re-baselines, roll ownership, the `<entities>` render |
| `§ S35` | pointing a check at more fixtures |
| `§ S36` | `roll_dice` has nowhere to put a target |

Seven sections, the most recent seven at the time, none about extracting anything from a
PDF. **Each landed there because its predecessor had.** Splitting a thread reads worse
than continuing one, and every individual entry was justified by the entry above it —
which is the mechanism `CLAUDE.md` already records for how `docs/roadmap.md` reached
22,000 words.

## Decision

**`docs/eval-findings.md` owns Warden eval findings — run diagnoses, tag coverage, checker
defects, and the corpus decisions that follow from them — starting at `§ S37`.**

**`eval-methodology.md` is deliberately not the home.** Its own header draws the line that
excludes them: "how to run the Warden eval harness, as distinct from what it measures." A
rule you would apply to the next run belongs there; a number you got from the last one
belongs in the new file. That test is now stated in both file headers and in `CLAUDE.md`'s
routing table, because the previous instruction — three findings docs named with the
choice left to judgement — is what let the drift happen.

### The break is forward-only, and that is a constraint rather than a preference

`docs/plans/014-turn19-roll-ownership.md` cites `rules-extraction-findings.md § S30`,
`§ S31` and `§ S32`. `docs/plans/021-unauditable-mapping-roll-purpose.md` cites `§ S36`.
Plans are frozen — dated accounts of what was true when written — and `CLAUDE.md` forbids
rewriting a reference inside one to cite an identifier that did not exist at the time.
Moving those sections would strand the citations; rewriting the citations is not
available. So `§ S36` and earlier stay where they are, with a note in the rules file's
preamble saying they are in the wrong file and why they are not moving.

`§ S37` moved rather than the new file starting at `§ S38`: nothing frozen cited it, its
only references were the roadmap footer and a doc comment, and starting the file empty
would have made the break notional.

### The numbering is one namespace across two files

Restarting at `S1` in the new file would make `§ S12` ambiguous in every future citation,
and these sections are cited by number far more often than by title. One namespace, two
files, and a reader resolves a citation by looking in both — which is worse than one file
and better than an ambiguous number.

## Alternatives considered

- **Move `§ S30`–`§ S36` into the new file.** The tidy answer, and unavailable: it either
  strands frozen-plan citations or requires editing frozen documents.
- **Put them in `eval-methodology.md`.** Rejected on that file's own stated remit. It has
  the opposite problem already — dated records accumulated there before this file existed,
  each arriving with a lesson attached that made it feel at home — and its header now says
  so and points new ones here.
- **Rename `rules-extraction-findings.md` to cover both subjects.** Rejected: `§ S1`–`§ S23`
  genuinely are rules extraction, and a name broad enough to cover both is a name that
  routes nothing.
- **Leave it and rely on the routing table alone.** Rejected because the routing table is
  what failed: it named three findings docs and let judgement pick, and judgement picked by
  following each section's neighbours.

## Consequences

**`references.core.ts`'s `IN_SCOPE_DOCS` gains the new file.** That list is exported and
currently consumed by nothing — the migration script that used it is gone — so the addition
is an inventory statement rather than a functional change, and the reference-rewriting it
implies is not running on any document today.

**A reader resolving `§ S12` has two files to check.** Accepted, and cheaper than the
alternative: an `S` number that means different things in different files would be a
silent mis-citation rather than a two-second lookup.

**The rules file keeps a permanent irregularity.** Its preamble now carries a paragraph
explaining that seven of its sections belong elsewhere and are staying. That note is
maintained rather than appended, which the file's own rules permit for the preamble while
protecting session evidence from edits.

**This does not fix `eval-methodology.md`.** Roughly 700 of its 1,280 lines are dated
records rather than method — `§ Structural check migrations`, two `§ Bump note` sections,
`§ Same-prompt run-to-run variance`, and the tables under `§ Current baseline N`. They stay
for the same reason `§ S30`–`§ S36` stay: several are cited from ADRs and `§ Outcome` is
cited from a frozen plan. Its header names them and routes new ones here. Migrating them
is a large edit whose only benefit is tidiness, and it is not owed.
