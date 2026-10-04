# 025 — Eval v2: the smallest harness

**Status:** draft for review, 2026-10-03.
**Type:** implementation spec. Plan to follow at `docs/plans/025-eval-v2-smallest-harness-implementation-plan.md`.
**Review tier:** *is this needed?* (new tooling) and *cost and guardrails* (the run spends money).
**Origin:** the eval harness rebuild (`CLAUDE.md § Working With Claude`). The old harness in `apps/zoltar-be/eval/` is untouched by this spec and stays working.

---

## The question

> Does the Warden get descriptions of characters, places, and timelines correct
> against the seeded world facts and opening narration for labeled cases on at
> least 90% of reps per case?

The question lives in `$ZOLTAR_EVAL_ROOT/eval-v2-runs/README.md`. This spec builds
the least that answers it.

## What gets built

Two commands and nothing else.

**`task ev2:run`** replays each labeled case N times through the real turn code and
writes what the Warden said to disk. It grades nothing.

**`task ev2:report`** reads the verdicts the maintainer has marked by hand on those
outputs and prints, per case, how many reps were right, against the 90% bar.

Between the two, the maintainer reads the outputs and marks each one. There is no
automated grader in this version.

## Where the real decisions are

Three choices here are worth reading closely. The rest is mechanical.

### 1. Hand marks, not a judge

Five cases at 10 reps is 50 short narrations. That is readable in one sitting, and
reading them is the fastest way to find out whether the known failures still
reproduce at all. A judge would need validating against the maintainer's own
verdicts before its numbers meant anything, and these 50 marks are the first batch
of exactly those verdicts. A judge becomes worth building when marking by hand is
what stops a run from happening — not before.

### 2. A mark has three values, and the bar is over two of them

Each rep is marked `pass`, `fail`, or `na`.

- `pass` — the narration makes a claim the seeded values can check, and it is right.
- `fail` — it makes such a claim and it is wrong.
- `na` — it makes no checkable claim. The same player input does not guarantee the
  Warden mentions a deck every time.

A rep where the turn threw (an API error, the tool-loop cap) is recorded as `error`
by the run itself and is not markable.

The 90% bar is `pass / (pass + fail)`. `na` and `error` are left out of that
fraction and printed beside it, so a case that passes 3 of 3 with 7 `na` is visibly
not the same result as 10 of 10.

Decided at review, 2026-10-03: `na` stays out of the denominator. Counting it as a
pass would match the question's wording ("on at least 90% of reps") more
literally, but a rep that says nothing checkable is not evidence the Warden got
it right.

### 3. What a run records about itself

Only what is free to record and needed to read the result later:

- the git commit, and whether the working tree was dirty
- the Warden prompt's filename and hash, as `WardenPromptsService.getSelected('mothership')` reports them
- the fixture ids and the rep count
- start and end time

No model or temperature override: the turn uses what the app uses (`claude-sonnet-5`,
the API's default temperature). No corpus hash, no harness version, no comparison
between runs. Two runs are compared by the maintainer reading two reports. If that
turns out to be error-prone, that is the problem that earns the next piece.

## How a replay works

One rep of one case:

1. Seed a scratch campaign and adventure from the fixture's `seededState`: campaign,
   owner membership, campaign state, adventure, GM context blob, one character
   sheet, the message history, pending canon.
2. Call `SessionService.sendMessage` with the fixture's `playerInput.content`.
3. Write the returned message's `content` (the narration) and the full result.
4. Delete the scratch campaign. Cascades remove everything under it.

The app is booted once per run, from the real `AppModule` through
`@nestjs/testing`, with nothing overridden.

Things the old runner learned that apply here, and are carried over:

- **Loader.** The script runs under `node -r @swc-node/register -r reflect-metadata`.
  Plain `tsx` does not emit the decorator metadata Nest's injector needs.
- **`init()`, not only `compile()`.** The prompt service loads its prompts in an
  init hook.
- **The character sheet is required.** `sendMessage` reads player entity ids from
  `character_sheet` and overwrites the blob's list with them. No sheet means an
  empty list, which switches off `actingEntityId` validation, and the replay would
  run a path production does not. The fixture declares the id in
  `gmContextBlob.playerEntityIds`; a fixture that declares none is refused before
  anything is written.
- **Scratch campaigns are named** `__ev2__<fixture>__<run>__<rep>`, so a crashed
  run's leftovers can be found and deleted by hand.

Reps run one at a time. Fifty turns in sequence is slow but simple, and a crash
leaves at most one scratch campaign behind.

## Layout

```
apps/zoltar-be/eval-v2/
  cases.ts       the list: question id → fixture ids
  fixture.ts     minimal Zod schema for a fixture file, and the loader
  replay.ts      boot, seed, run one turn, tear down
  run.ts         CLI for ev2:run
  report.ts      CLI for ev2:report, plus the tally as a plain function
```

`fixture.ts` reads `apps/zoltar-be/eval/fixtures/*.json` and validates only what a
replay uses: `id`, `seededState` (its six keys, contents left loose — the app
validates them when it reads them back), and `playerInput`. It does not import
`eval/fixture.schema.ts`.

`cases.ts` names fixtures explicitly instead of selecting on the old `tag` field,
so the list of what a question covers is one readable array:

```
q1: 2c0ba938 turns 08, 14, 18, 24 (known failures) and 29 (known good)
```

### Output

```
$ZOLTAR_EVAL_ROOT/eval-v2-runs/<UTC timestamp>/
  run.json                     what the run records about itself
  marks.csv                    one row per rep: fixture, rep, mark, note
  <fixture id>/
    case.md                    world facts, opening narration, player input
    rep-01.md                  the narration, for reading
    rep-01.json                the full sendMessage result, or the error
```

`marks.csv` is written by the run with the `mark` column empty (or `error`). The
maintainer fills it in. `case.md` puts the ground truth next to the narrations so
marking does not need the fixture JSON open.

### Commands

```
task ev2:run -- --question q1 --reps 10 [--fixtures <id,id>]
task ev2:report -- <run-dir>
```

`ev2:run` hits the dev database and makes real Anthropic calls: cases × reps
Warden turns, each of which may be several API calls inside the tool loop. Its
`desc:` in `Taskfile.yml` says so. Under `CLAUDE.md § Running the Eval Harness` it
is run by the maintainer, by hand, every time. `ev2:report` is free.

`ev2:report` refuses a run with unmarked rows instead of reporting a partial rate.

## Tests

- `fixture.ts`: the schema, against a valid fixture and representative invalid ones.
- `report.ts`: the tally function, including `na` and `error` handling and the
  zero-denominator case.
- `replay.ts`, seeding and teardown: an integration test against the test database
  (`test/db-test-helper`), checking the rows land and the delete cascades. It makes
  no Anthropic call and is free.
- `replay.ts`, the turn itself: no automated test. It is exercised by a one-case,
  one-rep run, which costs one Warden turn and needs approval like any other.

Both vitest configs get `eval-v2/` added to their include lists.

## Not in this version

- **A judge**, or any automated grader.
- **Model or temperature override**, and recording of the raw API requests.
- **Dice-result fixtures.** All five cases are plain messages with no pending dice
  request. The second code path gets written when a case needs it.
- **The `revealed` backfill** for fixtures captured before 2026-08-21. All five
  cases already carry it.
- **Resume, concurrency, run comparison, identity hashes.**
- **Capturing the timeline case** (`2c0ba938` turn 1). The question owes it, but it
  is fixture capture, which stays with the existing tooling. Whether that adventure
  is still in the dev database to capture from is unverified.

## What would make this wrong

- If most reps come back `na`, the cases do not reproduce the situation and the
  question needs different cases, not more reps.
- If the four known failures pass 10 of 10 on the current prompt, the bar is
  already met and these cases no longer show the failure. That is a result, and it
  means the next question is the one to work on.
