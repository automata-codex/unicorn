# Warden Eval — Findings Log

A running record of what the Warden eval harness has actually measured: run
diagnoses, tag coverage, checker defects, and the corpus decisions that follow
from them. Each entry says what was run, what came back, and what was concluded,
so the next reading starts from the last one's evidence.

**Relationship to the other documents.** `docs/eval-methodology.md` is *how to
run the harness* — rep allocation, corpus bumps, what a re-score is valid after.
This file is *what running it found*. The line between them is the one that
file's own header draws: methodology "as distinct from what it measures." A rule
you would apply to the next run belongs there; a number you got from the last one
belongs here. `docs/rules-extraction-findings.md` is the same kind of record for
the rules corpus — chunking, extraction, retrieval.

**Why the numbering starts at S37.** This file continues a section series that
began in `docs/rules-extraction-findings.md`, whose `§ S30`–`§ S36` are Warden
eval findings sitting in a file whose own header describes it as the empirical
record of "what has actually been tried against real rulebook PDFs." That drift
started 2026-08-09 with `§ S30` and was complete by `§ S34`: each entry followed
its predecessor into the wrong file because splitting a thread reads worse than
continuing one.

**Those sections stay where they are.** `docs/plans/014-turn19-roll-ownership.md`
cites `rules-extraction-findings.md § S30`, `§ S31` and `§ S32`;
`docs/plans/021-unauditable-mapping-roll-purpose.md` cites `§ S36`. Plans are
frozen — dated accounts of what was true when written — so rewriting those
citations is not available, and moving the sections would strand them. The break
is therefore forward-only: `§ S36` and earlier are found in the rules file,
`§ S37` and later here.

**The numbering is one namespace across two files**, deliberately. Restarting at
`S1` here would make `§ S12` ambiguous in every future citation, and the sections
are cited by number far more often than by title.

**How to add to this file.** Append a new dated section. Do not silently edit an
earlier one's numbers — supersede them with a new entry, so a wrong earlier
reading stays visible as something that was once believed. A section may be
amended in place to record that its own open item was later closed, which is what
`§ S37`'s "Fixed 2026-08-28" note is.

---

### S37 — 2026-08-27 · `SYSTEM-ROLLED-PLAYER-ACTION` attached to the two `-out-of-order-resolution` fixtures

`§ S35`'s "Still open" item, closed on the same evidence and by the same
mechanism. `turn19-out-of-order-resolution` and `turn21-out-of-order-resolution`
now carry a `system-rolled-player-action` `applicability` block, taking the check
from 8 fixtures to 10.

A **scoring-only** bump under `§ Two kinds of corpus bump`: two `applicability`
blocks, no `seededState`, `playerInput` or `assertion` touched, no
`fixtureSchemaVersion` moved (both fixtures were already v2, which is what
`requiresFixtureSchema` asks for). Every `warden-output.json` on disk remains
exactly as valid as it was.

#### One correction to `§ S34`'s citation

The ten occurrences are in the run `§ S34` compares **against**
(`claude-sonnet-5__c45a142a__2026-08-10T12-18-32Z`, `§ S33`), not in the run it
reports. The reported run had six, all on `turn24-*`, which is exactly what
`§ S34` says — but "the baseline carries ten of them, including four on
`turn19-out-of-order-resolution`" has been read since as though both counts
belong to the same run. They do not, and the distinction matters here: the
fixture this entry attaches the check to shows nothing at all on the run
`§ S34` accepted.

#### Re-scored, after being predicted first

The two runs carrying failures were re-scored under the widened corpus
(`corpusVersion` `8ac47a8296f8`, `harnessVersion` `81575df`); rows are in each
run's `rescore/2026-08-27T18-0[67]-*.jsonl`. Both fixtures select only
structural checks, so the pass made **no Anthropic calls**.

| Run | As scored | Widened | New failures |
|---|---|---|---|
| `c45a142a` 12-18-32Z (`§ S33`) | 1.00 (20/20) | **0.93 (37/40)** | 3 reps, all `turn19` |
| `c45a142a` 19-45-15Z (`§ S34`) | 1.00 (20/20) | 1.00 (40/40) | none |
| `ccac7d1c` 12-38-30Z (M7.6) | 0.94 (47/50, re-scored) | **0.93 (65/70)** | 2 reps, all `turn19` |
| `e83e8aaa` 2026-08-24 (current) | 1.00 (79/79) | 1.00 (99/99) | none |

The middle two rows are recorded measurements; the first and last remain
predictions, computed by running the checker against the frozen artifacts
without writing rows, because both are all-passes and re-scoring them would pad
a denominator without answering anything.

**The prediction and the re-score agree exactly** — 7/3 on `turn19` and 10/0 on
`turn21` for `12-18-32Z`, 8/2 and 10/0 for `ccac7d1c`. That is worth one line
rather than none: the local prediction and the harness are the same checker over
the same files, so agreement proves nothing about the *rate*, but it does
establish that a scoped `--fixtures` re-score selects the checks the corpus edit
intended and no others.

A widened rate must not be read against a narrow-corpus one. `§ S35`'s treatment
applies: restrict per-tag movement to fixtures present on both sides before
reading it.

#### `§ S34`'s hand count reconciles, once the unit is watched

`§ S34` counted **four occurrences** on `turn19-out-of-order-resolution`; the
checker reports **three failing reps**. Both are right. Rep 004 of the
`12-18-32Z` run contains two system-generated rolls resolving Alvarez's declared
attack — the Combat to-hit at sequence 2 and the damage roll at sequence 3 —
and a structural checker returns one verdict per rep. Four rolls, three reps.

That agreement is the only evidence available that the attachment grades the
thing it was attached for, which is the test `§ S35` applied to the `turn24-*`
attachment and passed by a different route (there, six occurrences fell in six
distinct reps and the two numbers matched outright).

#### What it buys, stated honestly

**Denominator, not a rate.** The behaviour does not occur on the current
baseline: the widening adds 20 rows to `e83e8aaa` and all 20 pass. `turn21`
contributes no failures in any archived run and is denominator only.

That is the same shape `§ S35` recorded and worth restating rather than
re-deriving: widening a check's corpus is not a way to make a rate fall, it is a
way to make the rate mean the corpus. What changes is that `§ S34`'s four
hand-counted occurrences are now rows a future regression would surface without
anyone reading artifacts by hand.

#### A harness defect the re-score exposed: `sourceVerdict` on a check with no source row

Every row in both re-score files reports `sourceVerdict` equal to its own
`verdict` — including the `system-rolled-player-action` and `tool-syntax-leak`
rows, which the same pass warned had **no row in the source run**. The two
statements contradict each other, and the file is the one that survives.

The cause is at `scripts/eval-rescore.core.ts:417`:
`sourceVerdict: sourceRow?.verdict ?? observation.verdict`. The persisted schema
types the field `verdictSchema`, which is not nullable, so a check that was never
scored before is written as though it had been scored identically.

**The in-flight accounting is honest and only the record is not.** The progress
event at line 341 uses `sourceVerdict: sourceRow?.verdict ?? null` and sets
`changed: false` explicitly when there is no source row, so the CLI never prints
a false transition and the stderr warning names each affected row. Impact today
is bounded — nothing reads `sourceVerdict` back except that live line — but the
field's own doc comment states its purpose as "kept so a diff never needs both
files open", which is exactly the use it quietly breaks: a reader diffing the
file six months from now sees `pass → pass` for a check that had no prior
measurement at all.

This is the shape `ADR-0067` and `ADR-0078` both legislate against in other
places — an absent answer given a confident value rather than its own one.

**Fixed 2026-08-28.** `sourceVerdict` is nullable, `null` means there was no
source row, and the reasoning lives on `rescoreRowSchema.sourceVerdict` where
the next person to widen a check will read it. Two tests: the schema accepts
`null` and still parses the old shape, and a re-score whose universal check has
no source row records `null` rather than its own verdict — the second verified
by mutation, since it passes vacuously against a correct implementation and only
the old fallback distinguishes it.

**The two files this entry cites predate the fix** and carry the copied verdict.
Their verdicts are the measurement and are correct; only the source-side
bookkeeping is wrong, and it is wrong in the direction of claiming a prior
measurement that never happened. They were left as written rather than
re-generated: a second pair of files recording the same measurement would make
the archive harder to read than one documented quirk does.

#### Still open

`turn19-out-of-order-resolution` and `turn19-system-rolled-player-action` are the
same turn — identical `playerInput`, and `seededState` differing only in
`capturedAt`, which is provenance and never read at eval time. The turn21 pair is
the same at seq 95. Both pairs predate `ADR-0096`, when duplication was the only
way to cover two tags on one turn.

The obvious reading is waste — two Warden turns per rep for one scenario. The
opposite reading has better support: each fixture seeds its own scratch
adventure, so the pair is two independent draws, N=20 rather than N=10 for that
scenario, and `turn19` is the only scenario in the corpus that has ever produced
a `SYSTEM-ROLLED-PLAYER-ACTION` failure. Consolidating would halve the sample
exactly where the signal is. Recorded as a decision to make rather than work to
schedule.
