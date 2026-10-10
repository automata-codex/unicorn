# 028 — Eval v2: a judge for question 1

**Status:** draft for review, 2026-10-10.
**Type:** implementation spec. No separate plan: `§ Build` is short enough to be one.
**Review tier:** *is this needed?* (two new commands) and *cost and guardrails* (one of them makes Anthropic calls).
**Origin:** spec 025 `§ 1. Hand marks, not a judge` and spec 027 `§ Not in this version`. Workflowy card: <https://workflowy.com/#/346d8876149f>.

---

## The problem

Every question 1 run is marked by hand, 10 narrations a case. On 2026-10-09
seven runs were marked and three were not: `§ S60`, `§ S62` and `§ S64` each
replaced the marks with a phrase count because marking was what would have
stopped the run. That is the trigger spec 025 named for building a judge.

A judge's marks mean nothing until they have been checked against the
maintainer's. There are now 155 pass/fail marks and 16 `na` to check against,
all made before any judge existed.

## What gets built

Two commands.

```
task ev2:judge -- <run> [--fixtures <id,id>]
task ev2:judge-check -- <run>[,<run>...]
```

`ev2:judge` marks every narration in a run under Rubric v1 and writes the marks
to a file of its own in the run directory. It makes one Anthropic call per
narration, so it needs approval each time, like `ev2:run`.

`ev2:judge-check` reads a run's hand marks and its judge marks and prints where
they disagree. It reads files only and is free.

Neither command changes `marks.csv`, `ev2:report` or `ev2:compare`. Whether the
judge's marks may stand in for hand marks is what the check decides, so nothing
reads them as if they were until it has.

## Where the real decisions are

Decisions 1 to 4 and the model in decision 5 were agreed with the maintainer on
2026-10-10. The rest of decision 5, the file per prompt and no repeat calls, is
the author's recommendation.

### 1. What makes the judge usable

Checked against the 114 pass/fail marks of the 2026-10-09 runs (38 pass, 76
fail), the judge is usable for question 1 if both hold:

- it gives the same mark on at least 90% of them, so at most 11 disagreements
- at most 4 of those are the judge passing a narration the maintainer failed

The second limit is tighter because that direction makes the Warden look
better than it is, and a fix that did nothing can then look like it worked.

90% is a judgement, with one anchor. Seven of the 155 marks were changed by the
maintainer on a second look (five on turn 14, one on turn 29, one more on turn
14), which is about 5%. A judge cannot be asked to agree with the marks more
than the marks agree with themselves, and 90% allows it twice that.

A judge `na` where the maintainer marked pass or fail counts toward the 11. It
is listed apart from the other two kinds.

There is no pass mark per case. Turns 08 and 24 have 15 marks each across all
runs, which is too few for a rate. The check lists each case's disagreements to
be read.

If the judge misses either limit, marking stays by hand and the disagreements
are read to find out why.

### 2. The judge is adjusted against one run and checked against the others

If the judge's prompt is adjusted until it agrees with all 155 marks, and
agreement is then reported on the same 155, it agrees by construction. The card
names the same trap for marks revised after seeing the judge's.

So the marks are split by run:

| Use | Runs | Marks |
|---|---|---|
| Adjusting the prompt | `2026-10-04T03-14-41Z` | 21 pass, 20 fail, 2 `na` |
| The check | the seven marked runs of 2026-10-09 | 38 pass, 76 fail, 14 `na` |

Run `2026-10-04T03-14-41Z` is the one Rubric v1 was written from, and every
worked example in the rubric is one of its reps, so the judge has seen those
answers already. It was made before the replay fix (`§ S48`), which changes
what the Warden was sent and not how a narration is marked.

The check runs are judged once, with the prompt frozen. If the prompt changes
after that, there are no unseen marks left, and the next check needs a newly
marked run. `§ 5` makes a second pass visible.

### 3. The judge is given Rubric v1 as written, and each case's start

The judge's prompt is the `Rubric v1` section of
`$ZOLTAR_EVAL_ROOT/eval-v2-runs/README.md`, copied word for word, with its
worked examples. Rewording it to settle a known gap would make it a Rubric v2,
and the README's rule is that a new version means re-marking the old runs or
leaving them under v1.

One gap is known. "You head back down" is a pass in run `2026-10-09T13-09-50Z`
rep 08, as a figure of speech, and a fail in run `2026-10-09T10-38-58Z`. The
judge will get one of them wrong. That disagreement is sorted as "the criterion
did not cover it" and is what a v2 would be written from.

For each narration the judge is sent:

| Sent | From |
|---|---|
| the rubric | the copy in the repo |
| the four seeded world facts and the opening narration | the run's `case.md` |
| the player's input | `case.md` |
| where Danny starts | a table in the judge's source |
| the narration | `rep-NN.md` |

It is not sent the session's history, the world facts the Warden wrote during
the session, the hand mark or its note.

The start is given and not worked out, because that is how the marks were
made: the rubric fixes one start per case. The README's table covers the five
captured cases. The constructed cases need adding:

| Case | Start |
|---|---|
| `turn18-berth-corrected`, `-berth-retracted`, `-berth-retracted-tidy` | the cryo bay bulkhead, mid-deck (README: "Same start") |
| `turn18-position-seeded`, `turn18-return-stated` | the same. Each is the tidy retracted case with one thing changed (`eval-v2/cases.ts`), and neither change moves him: one adds a world fact putting him at the bulkhead, the other spells out his return to it |

The two unmarked cases of run `2026-10-09T19-10-04Z` are not in the check and
get no start.

### 4. Three marks, and turn 01 is left out

The judge returns `pass`, `fail` or `na`, as the rubric defines them, with one
sentence of reasoning and the phrases it took as positional indicators.

- **`error` reps are skipped.** The turn threw and there is no narration.
- **Turn 01 is skipped.** Rubric v1 marks layout only and turn 01 is the
  timeline case; all ten of its marks are `na` because the rubric cannot mark
  it, not because the narrations say nothing.
- **The other 6 `na` marks are judged and reported apart from the limits in
  `§ 1`.** Four are in the check. That is too few to set a limit on, and enough
  to see whether the judge can recognise a narration that names no deck.

### 5. One call per narration, and a file per prompt

**The model is `claude-opus-5-5`**, one call per narration at the default
temperature. That is the maintainer's choice, made 2026-10-10. It is a stronger
model than the Warden's `claude-sonnet-5` and not the same one, so the judge is
not a model marking its own output. The model id is in the judge file's first
line, since a judge run on another model is another judge and needs its own
check.

**The answer's shape is enforced by the API** (structured outputs), and the
effort is set to `high`. `claude-opus-5-5` refuses a forced tool call, always
thinks, and defaults to `medium` effort; `high` is the author's choice for a
task that turns on reading closely, and it is covered by the prompt hash. A
refusal or a cut-off answer stops the run and is never written as a mark. No
fallback model is configured, since an answer from another model would be
another judge's.

**The cost of the whole check** is about 160 calls of roughly 3,000 input
tokens each: 43 for the adjusting run, each time the prompt is adjusted, and
118 once for the check runs.

**The judge's marks go in `judge.<prompt hash>.csv`** in the run directory, in
the shape of `marks.csv`:

```
# judge: q1 rubric v1 · prompt 3fa1c2d0 · claude-opus-5-5
fixture,rep,mark,note
2c0ba938-turn18-seeded-canon-contradiction,01,fail,"down to the lower deck" for the berths, which are on mid-deck
```

The hash is over everything sent that is the same for every narration: the
rubric copy, the instructions around it and the start table. A changed prompt
writes a new file beside the old one, so a check run that has been judged
twice shows two files. `ev2:judge` refuses to overwrite a file that exists.

**No repeat calls to measure how much the judge varies.** If the check passes,
the judge's own noise is already inside the disagreement count. If it fails
narrowly, a repeat is the first thing to try.

## Output

```
task ev2:judge-check -- 2026-10-09T10-38-58Z,2026-10-09T11-03-37Z,...

judge  q1 rubric v1 · prompt 3fa1c2d0 · claude-opus-5-5
runs   7 · 114 pass/fail marks · 4 na · 2 error skipped · turn 01 skipped

agreement             105 of 114   0.92   limit 0.90   met
judge pass, you fail    3          limit 4            met
judge fail, you pass    5
judge na, you marked    1

case                     marks  agree  judge pass/you fail  judge fail/you pass  judge na
turn 08                      8      7                    0                    1         0
turn 14                     20     17                    2                    1         0
turn 18                     20     20                    0                    0         0
...

Your na marks: judge na 3 of 4

Disagreements
  2026-10-09T13-09-50Z  turn18-berth-corrected  08   you pass · judge fail
    judge: "head back down" leaves mid-deck for a berth that is on mid-deck
  ...
```

The numbers are illustrative.

The check prints the disagreements and does not sort them. Sorting each one as
judge wrong, mark wrong or not covered by the criterion is done by reading, and
is written up in `docs/eval-findings.md` with the result.

A mark the maintainer changes after reading the judge's is changed the way the
README says: `marks.csv` is copied first and the `note` column says why. The
agreement that gets reported is the one against the marks as they stood before.

## Build

- `apps/zoltar-be/eval-v2/judge.core.ts`: the start table, building the
  request from a case and a narration, the prompt hash, parsing the judge's
  answer, and rendering `judge.<hash>.csv`, as plain functions.
- `apps/zoltar-be/eval-v2/judge.ts`: a `main` that reads a run directory,
  calls Anthropic once per narration and writes the file. It needs no database
  and no NestJS container.
- `apps/zoltar-be/eval-v2/judge-rubric-q1-v1.txt`: the rubric copy.
- `apps/zoltar-be/eval-v2/judge-check.ts`: reading both files for each run,
  the counts, the two limits and the rendering. It reuses `parseMarks` from
  `report.ts`.
- `Taskfile.yml`: `ev2:judge`, with a `desc:` giving its cost, and
  `ev2:judge-check`, with one saying it is free.

Nothing from the M7.4 harness's judge is reused.

### Tests

- The request built for a case: what is in it, and that the hand mark, the
  history and the session's own world facts are not.
- The prompt hash changes when the rubric copy or the start table changes and
  not when the narration does.
- Parsing the judge's answer, including a mark outside the three and a missing
  field.
- The counts and both limits at their boundaries: 11 and 12 disagreements, 4
  and 5 in the tighter direction.
- A run with no judge file, with two, and with a rep in one file and not the
  other.
- `error` rows and turn 01 are left out of every count.

No test calls Anthropic. `judge.ts` is exercised by judging one case of the
adjusting run, which needs approval like any other call.

## Order of work

1. Build both commands and their tests.
2. Judge the adjusting run. Read its disagreements, adjust the instructions
   around the rubric, and repeat until it is stable. The rubric copy is not
   edited.
3. Write the prediction for the check in `docs/eval-findings.md`.
4. Judge the seven check runs, once.
5. Run `ev2:judge-check`, sort the disagreements, and write up the result.

Steps 2 and 4 are Anthropic calls and each is asked for when it comes.

## Not in this version

- **`ev2:report` and `ev2:compare` reading judge marks.** That follows a check
  that passes, on its own card, with the rep count spec 027 says to reopen.
- **A judge for any other question.** Agreement is per question and does not
  carry.
- **Rubric v2**, and marking the timeline case.
- **Repeat calls and a measure of judge variance.**
- **Judging the three unmarked runs.** They have no marks to check against.
  They are the first runs a usable judge would be pointed at.

## What would make this wrong

- **Three fifths of the check is turn 18.** 68 of the 114 marks are turn 18 or a
  constructed copy of it, and many of the fails are one sentence, "You head
  back up to mid-deck". A judge can clear 90% on those and still be poor on
  turns 08, 24 and 29, which have 8, 8 and 10 marks in the check. The per-case
  table is there so that this is seen and not averaged away.
- **The start table carries part of the answer.** A judge told where Danny
  starts is checked on whether it can apply the rubric, not on whether it could
  have found the start. A new case needs a start written for it by hand before
  the judge can mark it.
- **Agreement on these cases says little about a new one.** All 155 marks are
  one session, one ship and one rubric that marks decks. The second playtest's
  cases will need their own marks before the judge is trusted on them.
- **The author of the judge's prompt has read the check runs' write-ups**
  (`§ S49` to `§ S65`). Keeping the rubric verbatim limits what that can leak
  into the prompt, and does not remove it.
