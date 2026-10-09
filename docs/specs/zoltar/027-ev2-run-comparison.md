# 027 — Eval v2: run comparison

**Status:** draft for review, 2026-10-08.
**Type:** implementation spec. No separate plan: `§ Build` is short enough to be one.
**Review tier:** *is this needed?* (a new command) and *cost and guardrails* (it settles how many reps a fix attempt spends).
**Origin:** spec 025 `§ Not in this version` ("run comparison"), and `docs/eval-findings.md § S48`, where a harness fix made the only existing run unusable as a before-number.

---

## The problem

A fix tried against question 1 produces a second run. Nothing puts the two runs
side by side, and nothing says whether they can be put side by side at all.

`§ S48` is the case in point. The fix in PR 61 changed what every replay sends
the Warden, with no fixture and no prompt edited. Anyone comparing a run from
before it with a run from after it by reading two reports would have seen two
tables that look alike and measure different things.

## What gets built

One command and one line in `marks.csv`.

```
task ev2:compare -- <before> <after>
```

Each argument is a run id or a run directory, as `ev2:report` takes. The command
reads files and runs `git diff`. It touches no database and makes no Anthropic
call, so it is free and needs no approval.

It prints three things, in this order:

1. what differs between the two runs, apart from the marks
2. each shared case's pass rate in both runs
3. for each case, whether the change is larger than 10 reps can produce by chance

## Where the real decisions are

### 1. What "comparable" means

Two runs are comparable when they share a question, a set of cases and a rubric
version, and the only thing that changed between their commits is the change
under test.

The command checks the first three and shows the fourth. It cannot check the
fourth, because it does not know what the maintainer meant to change.

**Refused:**

- different questions
- different rubric versions, or a run with no rubric version recorded
- no case in common

**Shown, for the maintainer to read:**

- the prompt filename and hash of each run, and whether they differ
- whether either run was made from a dirty tree
- the files that differ between the two commits under `apps/zoltar-be/` and
  `packages/`, with test files left out
- the cases that are in one run and not the other
- the two start dates

The file list is the part that would have caught PR 61. Between `a1f7218`, the
commit of run `2026-10-04T03-14-41Z`, and today's `main`, it reads:

```
apps/zoltar-be/eval-v2/cases.ts
apps/zoltar-be/eval-v2/fixture.ts
apps/zoltar-be/eval-v2/replay.ts
apps/zoltar-be/eval-v2/run.core.ts
apps/zoltar-be/eval-v2/run.ts
apps/zoltar-be/eval/fixtures/2c0ba938-turn01-seeded-canon-contradiction.json
apps/zoltar-be/scripts/playtest-review.ts
apps/zoltar-be/scripts/tool-leak-corpus.ts
apps/zoltar-be/src/session/session.controller.ts
apps/zoltar-be/src/session/session.repository.ts
apps/zoltar-be/src/session/session.service.ts
apps/zoltar-be/src/session/session.telemetry.ts
apps/zoltar-be/src/session/session.tool-syntax-recovery.cases.ts
apps/zoltar-be/src/session/session.tool-syntax-recovery.ts
apps/zoltar-be/src/session/session.tool-syntax.ts
```

`replay.ts` and `fixture.ts` are the duplicate-message fix. The `session/` files
are tool-leak recovery (spec 026), which is a second difference from that run:
turns that used to end as `error` can now end as a narration, so the denominators
move as well.

The list is deliberately not narrowed to "files that affect the Warden". Deciding
that per file is the judgment the maintainer is being shown the list to make.

**Why not identity hashes.** A hash of the fixture and of the prompt file matched
before and after PR 61, because neither changed. The one hash that would have
differed is over the request the Warden is actually sent, and getting at that
means recording raw requests, which spec 025 left out. The file list catches the
same defect for one `git diff`.

**What nothing here covers.** A model that changes behind an unchanged id, the
contents of the dev database's rules corpus, and the maintainer's marking drifting
between two sittings. The only cover for those is a before-run made close to the
after-run. The start dates are printed so the gap is visible.

### 2. The rubric version goes in `marks.csv`

The rubric is the one input to a result that no file in the run records today.
It lives in `$ZOLTAR_EVAL_ROOT/eval-v2-runs/README.md`, in a table of runs per
version.

`marks.csv` gets an optional first line:

```
# rubric: v1
fixture,rep,mark,note
```

`ev2:run` writes the line with the version blank. The maintainer fills it in when
marking, which is when the version is known. It sits in `marks.csv` and not
`run.json` so that a re-mark under a new rubric carries its version with the
marks, and the copy kept under the old name (`marks.2026-10-04.csv`) keeps the old
one.

`ev2:report` prints the version when it is there and does not require it.
`ev2:compare` requires it on both sides.

Run `2026-10-04T03-14-41Z` needs the line added by hand. That is an edit to the
archive and is the maintainer's to make.

### 3. Ten reps stays, with a rule for reading a difference at ten

Hand marking is what limits the rep count. A six-case run at 10 reps is 60
narrations to read.

The chance of detecting a real change in one case's pass rate, with the same
number of judged reps in both runs:

| True pass rate, before → after | 10 reps | 20 | 30 | 60 |
|---|---|---|---|---|
| 0.30 → 0.90 | 0.82 | 0.99 | 1.00 | 1.00 |
| 0.30 → 0.80 | 0.62 | 0.91 | 0.99 | 1.00 |
| 0.57 → 0.90 | 0.34 | 0.69 | 0.86 | 0.99 |
| 0.57 → 0.80 | 0.16 | 0.36 | 0.51 | 0.82 |

Ten reps finds a large change most of the time and a modest one rarely. Finding
0.57 → 0.80 reliably takes about 60 reps per case in each run, which is 720
narrations for one comparison of six cases. No rep count that can be marked by
hand buys that, so the number stays at 10 and the limit is written into how the
result is read.

**The reading rule.** For each case, `ev2:compare` asks: if both runs had the same
underlying pass rate, how often would a split at least this lopsided turn up by
chance? That is Fisher's exact test on the two runs' pass and fail counts. A case
is labeled:

- `improved` when the after-run is better and that chance is 0.05 or less
- `worse` when the after-run is worse and that chance is 0.05 or less
- `not shown` otherwise

`not shown` does not mean no effect. It means 10 reps could not tell.

At 10 judged reps a side, this works out to a gain of about five passes: 4 → 9
is 0.03, and 5 → 9 is 0.07. The test is used instead of a fixed "five passes"
because `na` and `error` reps leave the denominators unequal, and it handles
that.

The denominators matter more than they look. Taking `§ S47`'s prediction table as
arithmetic only (its counts are not a valid before-number, per `§ S48`):

| Case | Before | Predicted after | Label if the prediction held exactly |
|---|---|---|---|
| turn 14 | 4 of 9 | 9 of 10 | `improved` (0.05) |
| turn 18 | 2 of 8 | 8 of 10 | `improved` (0.03) |
| turn 08 | 4 of 7 | 9 of 10 | `not shown` (0.16) |
| turn 29 | 8 of 10 | 10 of 10 | `not shown` (0.24) |

Turn 08 reaching the bar would not count as shown, because three of its ten
before-reps threw and left seven to compare against.

**The 0.90 bar is unchanged** and is still what answers the question. The bar says
whether a case is good enough. The label says whether the change did anything.
Both are printed.

**One top-up, decided before marking.** When a case that the fix was aimed at
comes back `not shown`, run 20 more reps of that case alone on each side with
`--fixtures`, and compare the pooled 30. To allow that, either argument may be a
comma-separated list of runs:

```
task ev2:compare -- <before>,<before-top-up> <after>,<after-top-up>
```

Runs pooled on one side must share a commit, a prompt hash and a rubric version,
or the command refuses. One top-up per case and no more: adding reps until a
label appears will eventually produce one from noise.

This is the part of the spec most easily cut. Without it a top-up is tallied by
hand from two reports.

## Output

```
before  2026-10-10T14-02-11Z  d83812d        mothership-m7.txt e83e8aaa  rubric v1
after   2026-10-10T16-40-37Z  4be19a0 dirty  mothership-m7.txt 7c20f3d1  rubric v1

Prompt changed: e83e8aaa → 7c20f3d1
Run from a dirty tree: after
Files changed between d83812d and 4be19a0:
  apps/zoltar-be/src/wardens/prompts/mothership-m7.txt
Only in before: 2c0ba938-turn01-seeded-canon-contradiction

case       before       after        bar (after)  change
turn 14    4/9   0.44   9/10  0.90   met          improved (0.05)
turn 18    2/8   0.25   8/10  0.80   NOT          improved (0.03)
turn 08    4/7   0.57   9/10  0.90   met          not shown (0.16)
```

The example is illustrative; the run ids and the second commit do not exist.

A commit that the local repository does not have is reported as such, and the
file list is left out with a line saying why.

## Build

- `apps/zoltar-be/eval-v2/compare.ts`: the argument parsing, the comparability
  checks, Fisher's exact test, the labels and the rendering as plain functions,
  plus a `main` that reads the run directories and calls `git diff --name-only`.
  It reuses `parseMarks` and `tally` from `report.ts`.
- `report.ts`: `parseMarks` accepts the optional `# rubric:` line and returns the
  version beside the rows. `renderReport` prints it.
- `run.core.ts`: `renderMarksCsv` writes the blank `# rubric:` line.
- `Taskfile.yml`: `ev2:compare`, with a `desc:` saying it is free.
- `docs/eval-methodology.md`: a short eval-v2 section holding the rep count, the
  reading rule and the top-up rule, since that file is where a rule for the next
  run lives.

### Tests

- Fisher's exact test against the hand-worked values in this spec, and the
  degenerate tables (a zero denominator on either side, all pass on both).
- The labels at the 0.05 boundary, in both directions.
- Each refusal: question, rubric, no shared case, a mixed pool.
- `parseMarks` with and without the rubric line, and with it blank.
- Rendering, including a case present on one side only.

No test calls `git`; the file list is passed in to the renderer.

## Not in this version

- **A hash of the outgoing request.** It is the stronger check and it needs raw
  request capture. It earns its place if the file list proves too long to read.
- **Checking a run against a written prediction.** `§ S47`'s table is read
  against the output by eye.
- **More than two sides**, and any trend across runs.
- **A judge.** When one exists (the M7.9 card "Build a judge for question 1 and
  check it against blind hand marks"), marking stops being the limit and the rep
  count in decision 3 is worth reopening.

## What would make this wrong

- If the file list is long on most comparisons, it will stop being read, and the
  check becomes decoration. The fix is to make the before-run and the after-run
  from adjacent commits, which is a habit and not a feature.
- If most cases come back `not shown` after a top-up, hand-marked reps cannot
  resolve the fixes being tried, and the judge is the next piece, not more reps.
- Six cases each get their own label, so one false `improved` across a whole
  comparison is more likely than 0.05 suggests. The exact test is conservative at
  these sizes, which offsets some of it. A fix that shows on one case and nowhere
  it was predicted to should be read as noise.
