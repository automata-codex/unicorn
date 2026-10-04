# 025 — Eval v2: the smallest harness — implementation plan

**Status:** draft for review, 2026-10-03.
**Spec:** `../specs/zoltar/025-eval-v2-smallest-harness.md`. Read it first; this plan
does not repeat its reasoning.
**Branch:** `eval-v2-smallest-harness`, from `main`.

Six steps. Steps 1–4 are commits and cost nothing. Steps 5 and 6 are runs, and both
are the maintainer's to launch by hand.

Everything new lives in `apps/zoltar-be/eval-v2/`. Nothing in `apps/zoltar-be/eval/`,
`scripts/eval-*.ts` or `src/` is edited. The only shared files touched are
`Taskfile.yml` and the two vitest configs.

Expected size: roughly 350 lines of code and 200 of tests.

---

## Step 1 — Fixture loading and the case list

**Files:** `eval-v2/fixture.ts`, `eval-v2/fixture.spec.ts`, `eval-v2/cases.ts`,
`vitest.config.ts`.

- `fixtureSchema` (Zod) accepts:
  - `id: string`
  - `playerInput: { type: 'message', content: string }` — any other `type` is
    rejected with a message saying dice-result cases are not supported yet
  - `seededState` with `campaignState` and `gmContextBlob` as loose objects and
    `messages`, `pendingCanon`, `pendingDiceRequests` as arrays
  - `gmContextBlob.playerEntityIds`: a non-empty array of strings
  - `pendingDiceRequests`: must be empty, for the same reason as `playerInput.type`
  - unknown top-level keys (`tag`, `applicability`, `assertion`, …) are ignored
- `loadFixture(id)` reads `eval/fixtures/<id>.json` and parses it.
- `cases.ts` exports one object: `q1` → the five `2c0ba938` fixture ids (turns 08,
  14, 18, 24, 29), with the question text beside it as a comment.
- Tests: one real fixture parses; a dice-result input, a missing
  `playerEntityIds`, and a non-empty `pendingDiceRequests` are each rejected. One
  test loads every id in `cases.ts`, so a typo in the list fails `npm test` rather
  than a paid run.
- Add `eval-v2/**/*.spec.ts` to `vitest.config.ts`.

**Check before committing:** `nest build` output does not pick up `eval-v2/`.

## Step 2 — Seeding and teardown

**Files:** `eval-v2/replay.ts`, `eval-v2/replay.spec-int.ts`,
`vitest.integration.config.ts`.

- `seedScratch(db, fixture, name)` → `{ campaignId, adventureId, userId }`. One
  transaction, the same rows the old runner writes (`eval/harness-runner.ts`,
  `seedScratchAdventure`), which is the answer key here:
  - `campaigns` (`private`, `soft_accountability`, named
    `__ev2__<fixture>__<run>__<rep>`), `campaign_members` (owner),
    `campaign_states`, `adventures` (`ready`), `gm_contexts`
  - one `character_sheets` row with `{ entityId: <first declared player id> }`
  - `messages`, in fixture order with their original `createdAt`
  - `pending_canon`
- The owner is the first user row by id. The system row is the one with slug
  `mothership`. Either missing is an error that names what to seed.
- `teardownScratch(db, campaignId)` deletes the campaign row.
- Integration test, against the test database, no Anthropic call: seed a small
  hand-written fixture, assert the row counts and the character sheet's entity id,
  tear down, assert nothing is left under the campaign.
- Add `eval-v2/**/*.spec-int.ts` to `vitest.integration.config.ts`.

## Step 3 — `ev2:run`

**Files:** `eval-v2/replay.ts` (two more functions), `eval-v2/run.ts`,
`eval-v2/run.spec.ts`, `Taskfile.yml`.

- `bootApp()` → `{ db, sessionService, prompt, close }`. Builds the testing module
  from `AppModule`, calls `init()`, and reads the selected Warden prompt's filename
  and hash from `WardenPromptsService`.
- `runTurn(sessionService, fixture, scratch)` calls `sendMessage` and returns its
  result.
- `run.ts`, in order:
  1. Parse `--question`, `--reps`, optional `--fixtures`. Require
     `ZOLTAR_EVAL_ROOT`.
  2. **Preflight, before any Anthropic call:** load and validate every fixture,
     boot the app, confirm the system row and a user exist. Any failure exits
     here, having spent nothing.
  3. Create `eval-v2-runs/<UTC timestamp>/`. Write `run.json` (commit, dirty flag,
     prompt filename and hash, fixture ids, reps, start time) and each case's
     `case.md` (world facts, opening narration, player input).
  4. For each fixture, for each rep: seed, run the turn, write `rep-NN.md` and
     `rep-NN.json`, tear down. Teardown is in a `finally`. A thrown turn writes the
     error into `rep-NN.json` and the run continues.
  5. Write `marks.csv`: header `fixture,rep,mark,note`, one row per rep, `mark`
     empty or `error`. Add the end time to `run.json`.
  6. Print the run directory and the count of errors.
- `marks.csv` is written once, at the end, so an interrupted run has none and
  `ev2:report` cannot be pointed at half a run by accident.
- Unit tests cover the pure pieces only: argument parsing, `case.md` rendering,
  `marks.csv` rendering.
- `Taskfile.yml` gets `ev2:run`, using the same loader line as `eval:run`
  (`node -r @swc-node/register -r reflect-metadata --env-file=.env`). Its `desc:`
  states that it writes to the dev database and makes cases × reps real Warden
  turns.

Not handled: Ctrl-C mid-turn leaves one scratch campaign behind. It is findable by
its `__ev2__` name.

## Step 4 — `ev2:report`

**Files:** `eval-v2/report.ts`, `eval-v2/report.spec.ts`, `Taskfile.yml`.

- `parseMarks(text)` splits each row on its first three commas, so a note may
  contain commas. A mark outside `pass | fail | na | error` is an error naming the
  row. An empty mark is an error naming how many rows are unmarked.
- `tally(rows)` → per fixture: counts of each mark, `pass / (pass + fail)`, and
  whether that meets 0.90. A fixture with `pass + fail = 0` has no rate and is
  reported as not meeting the bar.
- Output is a plain table on stdout, one row per case, then one line: every case
  meets the bar, or which ones do not.
- Tests: the tally over mixed marks, an all-`na` case, an unmarked row, an unknown
  mark, a note with commas.
- `Taskfile.yml` gets `ev2:report`, under plain `tsx` — it never boots Nest.

## Step 5 — Smoke run (maintainer runs; one Warden turn)

```
task ev2:run -- --question q1 --fixtures 2c0ba938-turn08-seeded-canon-contradiction --reps 1
```

What to check in the output: `rep-01.md` reads like a Warden turn answering the
player input in `case.md`; `run.json` names the prompt file you expect; no
`__ev2__` campaign is left in the database. Anything wrong is fixed and this step
repeated, with approval asked again each time.

## Step 6 — The first real run (maintainer runs; 50 Warden turns)

```
task ev2:run -- --question q1 --reps 10
```

Before this is launched, the cost per turn can be estimated for free from the old
archive's recorded token usage for these same five fixtures. Do that first.

Then: the maintainer marks `marks.csv`, runs `task ev2:report -- <run-dir>`, and
the result goes under question 1 in `eval-v2-runs/README.md`.

## After

- The maintainer writes the `docs/human` article.
- The PR description names its review tiers (*is this needed?*, *cost and
  guardrails*) and points at the spec's three decisions.
- Capturing the timeline case is separate work and not part of this branch.

## Where this plan is most likely to be wrong

- **Step 2's row list is copied from the old runner, not derived from
  `sendMessage`.** If the turn reads a table the old runner seeds implicitly or
  not at all, step 5 is where it shows.
- **`case.md` assumes the opening narration and world facts are enough to mark
  against.** The fixtures also carry up to 61 prior messages, and a narration may
  only be judgeable with the last few of them in view. If marking needs them,
  `case.md` grows a "recent messages" section.
