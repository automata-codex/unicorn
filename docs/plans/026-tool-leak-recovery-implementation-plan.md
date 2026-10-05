# 026 — Tool-leak recovery — implementation plan

**Status:** draft for review, 2026-10-04.
**Spec:** `../specs/zoltar/026-tool-leak-recovery.md`. Read it first; this plan
does not repeat its reasoning.
**Branch:** `tool-leak-recovery`, from `main`.

Six steps, one pull request. Nothing here spends money, and no step is a run.
The only paid thing this work waits on is the next eval-v2 run the maintainer was
already going to do.

**Review tier:** *detailed* (tool loop, telemetry, and what gets applied to
state) and *is this needed?* (a new parser and a new task).

Each step is its own commit, in order, so the pull request can be read a commit
at a time. Two of the steps are stops inside the branch, before the pull request
is opened:

- **after step 3**, the maintainer reads the hand-written expected results
- **after step 5**, the corpus result has to meet the gate before step 6 is written

The spec, this plan and `ADR-0097` Addendum 4 are the branch's first commit.

Expected size: about 250 lines of code, 150 of tests, and the cases file, which
is long but is data.

---

## Step 1 — Record every leak the turn path sees

**Files:** `src/session/session.tool-syntax.ts`, `session.service.ts`,
`session.telemetry.ts`, `session.controller.ts`, and their spec files.

- A new type beside the detector:

  ```ts
  interface ToolSyntaxLeakRecord {
    pass: 'tool_loop' | 'correction';
    rawInput: unknown;            // the tool_use block's input, as the API returned it
    outcome: 'rejected';          // step 6 adds 'recovered'
  }
  ```

- `runInnerToolLoop` keeps a `toolSyntaxLeaks` list and pushes a record each time
  the detector fires. The list is returned on `InnerToolLoopResult`.
- `SessionToolSyntaxError` gains a `leaks` property and is thrown with the list.
- **The correction pass throws `SessionToolSyntaxError` on a leak**, where today
  it throws `SessionOutputError`. One error class then carries leaks from both
  places. The HTTP result changes from the generic output error to
  `gm_tool_syntax_unrecoverable`, which describes it better. The class's doc
  comment ("after being told once not to") is reworded to cover both.
- `AdventureTelemetryPayload` gains `toolSyntaxLeaks?: ToolSyntaxLeakRecord[]`,
  written only when the list is not empty. `sendMessage` passes the loop's list
  through `applyTurnAtomic`'s telemetry block. Optional for the usual reason:
  older rows do not have it.
- The controller's existing error log for `SessionToolSyntaxError` adds the raw
  inputs as JSON. This is the only record of a turn abandoned in a live playtest
  (the gap the spec leaves open).
- Tests:
  - tool loop: a leak followed by a clean call returns one record; two leaks in
    a row throw an error carrying two
  - correction pass: a leak throws the new class with one record
  - telemetry: the field is written when there are records, absent when there
    are none, and a payload without it still reads

**Check before committing:** existing rows and the `turn_log` view are untouched;
no migration.

## Step 2 — Get the records into the archive

**Files:** `eval-v2/replay.ts`, `eval-v2/run.ts`, `eval-v2/run.core.ts` and spec,
`scripts/playtest-review.ts`.

- `replay.ts`: `readToolSyntaxLeaks(db, adventureId)` returns the
  `toolSyntaxLeaks` of the adventure's latest telemetry row, or an empty list.
- `run.ts`: called after `runTurn` and before `teardownScratch`. A rep's JSON
  becomes `{ ok: true, result, toolSyntaxLeaks }`. On a throw it becomes
  `{ ok: false, error, toolSyntaxLeaks }`, taking the list from the error when
  the error has one.
- `playtest-review.ts`: after writing the report, collect `toolSyntaxLeaks`
  across the adventure's telemetry rows. If there are any, write
  `<adventure-id>-tool-leaks.json` beside the report: a list of
  `{ turnNumber, ...record }`. Not written with `--stdout`.
- The report lands in `playtest-reports/` and the maintainer copies the real ones
  to `unicorn-artifacts/zoltar/playtests/`. The sidecar file is copied with it.
  That copy is what puts it where step 5's script looks.
- Tests: the rep-JSON shape in `run.core.spec.ts` if the shaping lives there. The
  database read is covered by the existing replay integration test, extended by
  one assertion.

Once this is merged, every eval-v2 run and every reviewed playtest adds to the
corpus.

## Step 3 — The cases (review point)

**Files:** `src/session/session.tool-syntax-recovery.cases.ts`.

Data only. One entry per shape:

```ts
{
  name: 'stateChanges as parameter JSON, gmUpdates arrived as a real parameter',
  source: 'eval-runs/<run>/reps/<rep>/<fixture>/warden-output.json',
  input: { playerText: '…two lines…</playerText>\n<parameter name="stateChanges">{…}', gmUpdates: { … } },
  expected: { ok: true, payload: { playerText: '…two lines…', stateChanges: { … }, gmUpdates: { … } } },
}
```

or `expected: { ok: false, reason: '…' }`.

- Taken from the archive: 40 distinct tag sequences as of 2026-10-04. Ones that
  differ only in trailing closing tags share a case, with the variants listed in
  its name. Expect 25 to 35 entries.
- The narration is cut to a line or two. Everything after the cut is kept as the
  model wrote it, because that is what is being parsed.
- `expected` is written by hand, from reading the leak, before the function
  exists. It is not generated by running anything.
- At least one case per refusal reason in step 4's list.

Shapes already known to need an expected refusal, from the archive:

| Shape | Count | Reason |
|---|---|---|
| `<invoke name="rules_lookup">` in the text | 2 | another tool call |
| `<entity id="…">` | 1 | attribute other than `name` |
| `<diceRequests><parameter name="notation">…` | 1 | array written as tags |
| `<json>` wrapper tags | 1 | unknown field |
| `resourcePools` as a map keyed by pool name | about 6 | fails the schema |
| `<npcStates>` under `gmUpdates` | 1 | unknown field (renamed before this leak was replayed) |
| `<parameter name="flags">` at the top level | 1 | unknown field at that level |

That is about 13 of 133, which would put recovery near 90% if everything else
parses. That is an estimate from tag sequences, not a result.

**Stop here for review.** The maintainer reads the expected results. This is the
check that the right value goes to the right field, and it is cheaper to argue
about a case than about parser code.

## Step 4 — The function

**Files:** `src/session/session.tool-syntax-recovery.ts`,
`session.tool-syntax-recovery.spec.ts`.

```ts
type Recovery =
  | { ok: true; payload: SubmitGmResponse }
  | { ok: false; reason: RefusalReason };

function recoverLeakedPayload(rawInput: unknown): Recovery;
```

`RefusalReason` is one of: `no_leak`, `leftover_text`, `unknown_field`,
`collision`, `schema_invalid`, `still_leaking`, `array_as_tags`,
`unexpected_attribute`, `other_tool_call`, `bad_literal`.

How it works, in order:

1. `findToolCallSyntax(playerText)`. No match is `no_leak`.
2. Cut at the first match. The narration is the left side, with trailing
   whitespace removed.
3. Read the right side as a list of fields against
   `SUBMIT_GM_RESPONSE_TOOL.input_schema`. It is already generated with
   `$refStrategy: 'none'`, so there are no references to resolve.
4. A field opens with `<parameter name="X">` or `<X>`, where `X` is a property
   the schema allows at this position. Under a record (`flags`, `entities`,
   `worldFacts`, …) any `[a-z0-9_]+` name is a key. A tag that is neither is
   `unknown_field`. A `<` that does not start a tag is ordinary text.
5. A field's text ends at its own closing tag, at the next field opener valid at
   the same level, or at the end of the input.
6. The value is read by the spec's rule: text if a string is expected, else JSON
   if it parses, else child fields if an object is expected, else a number,
   boolean or null literal, else refuse.
7. Skip whitespace and the closing tags `</invoke>`, `</submit_gm_response>`,
   `</function_calls>`, `</parameter>` and `</playerText>` between and after
   fields. Anything else left is `leftover_text`.
8. A recovered top-level field that is also present in `rawInput` is `collision`.
9. Merge, then `submitGmResponseSchema.safeParse`. Failure is `schema_invalid`.
10. Run the detector on the new `playerText`. A match is `still_leaking`.

Schema details the walk has to handle, each with a case in step 3:

- `anyOf` (the two `flags` value shapes): the allowed properties are the union.
- nullable (`adventureMode`, `diceRequests[].target`): the literal `null`.
- an enum is a string for rule 6.

**Checked on 2026-10-04 so the function need not handle them:** no leak in the
archive contains an XML escape (`&amp;`, `&lt;`, …), a CDATA section or a code
fence. Text is taken as written. The only attributes present are `name` (121
uses) and the one `entity id`.

The spec file is a loop over the cases file plus the refusal reasons that no
archived leak produces (`collision`, `still_leaking`, `no_leak`), written by hand.

## Step 5 — The corpus script, and the first number

**Files:** `scripts/tool-leak-corpus.ts`, `Taskfile.yml`, `docs/eval-findings.md`.

- Walk every `.json` file under `$ZOLTAR_EVAL_ROOT`. In each, find every object
  with a string `playerText` that trips the detector. This picks up old
  `warden-output.json` files, eval-v2 rep files and playtest sidecars alike,
  because a captured `rawInput` is such an object.
- Deduplicate on the `playerText` string.
- Run `recoverLeakedPayload` on each. Print `recovered N of M (P%)`, then one
  line per refusal: reason and file path.
- `task leaks:corpus`, with a `desc:` saying it is free and reads only the
  archive. It runs under `tsx`; it boots no Nest module.
- Run it. This is free and needs no approval. Write the result as the next `§ S`
  entry in `docs/eval-findings.md`: the count, the share, the refusals by reason,
  and the caveat that the corpus is weighted toward a few fixtures.

**Gate:** at least 80% recovered and every case passing. Below 80%, the refusal
list says which shape to take next, and the work returns to step 3 with a new
case. Step 6 does not start until the gate is met.

## Step 6 — Wiring

**Files:** `session.service.ts`, `session.tool-syntax.ts`,
`session.tool-loop.spec.ts`, `session.service.spec.ts`.

- `ToolSyntaxLeakRecord.outcome` becomes `'recovered' | 'rejected'`, with
  `refusal?: RefusalReason` on a rejected one.
- **Tool loop.** Where the detector fires, call `recoverLeakedPayload` on the
  raw input first.
  - Recovered: push a `recovered` record, log at `warn`, and return exactly as
    the clean path does, with `finalParsed` set to the recovered payload. The
    consecutive-rejection counter is not touched.
  - Refused: push a `rejected` record with the reason and carry on into today's
    code unchanged: one retry, then `SessionToolSyntaxError`.
- **The response handed onward carries the recovered input.** `finalResponse` is
  replayed to Claude as the assistant turn if a correction is needed
  (`buildCorrectionRequest`). Its `submit_gm_response` block's `input` is
  replaced with the recovered payload in a copy, so the model is not shown its
  own leak. The raw input survives in the leak record.
- **Correction pass** (`callClaudeOnce`): same call. Recovered is returned as
  parsed; refused throws as step 1 left it.
- Reword the comments that describe reject-and-retry as the first response:
  the header of `session.tool-syntax.ts`, the comment on
  `TOOL_SYNTAX_RETRY_BUDGET`, and the block in the loop. Each should point to
  `ADR-0097` Addendum 4.
- Tests, with a mocked client:
  - a recoverable leak commits after one model call, with the recovered state
    changes in `finalParsed` and one `recovered` record
  - a refused leak retries once; a second refused leak throws with two records
  - a refused leak followed by a recoverable one commits
  - the correction request built after a recovery contains no leaked markup
  - correction pass: recoverable applies, refused throws

## After

- **The live check** is the number of turns abandoned to a leak on the next
  eval-v2 run after the merge, against 4 of 50 on `2026-10-04T03-14-41Z`. It is
  the maintainer's run, on whatever question they were going to run next.
- After that run, `task leaks:corpus` again. New refusals become new cases.
- `docs/human/tool-loop-and-corrections.md` describes reject-and-retry. Updating
  it is the maintainer's, once step 6 is merged.
- The spec's open item, durable capture of turns abandoned in a live playtest,
  is decided after the first playtest with recovery on.

## Where this plan is most likely to be wrong

- **Step 4, rule 5: where a text value ends.** `notes` is free text and can run
  to hundreds of words. If a note contains something that looks like a field
  opener valid at its level, the value is cut short and the rest becomes
  `leftover_text`. That fails safe (a refusal, not a wrong recovery), but it
  would cost recovery rate. The cases will show it.
- **Step 4, the schema walk.** The `anyOf` and nullable handling is written from
  reading the Zod schema, not from the generated JSON. If `zodToJsonSchema`
  emits something else for the discriminated union or the records, the walk
  needs adjusting. Nothing under an array is walked, since arrays only arrive
  as JSON, which limits this.
- **Step 6, replacing the replayed input.** If `buildCorrectionRequest` or the
  telemetry shape record depends on the response object being the one the API
  returned, the copy needs more care than one substituted field.
- **Step 1, the correction pass changing error class.** If anything matches on
  `SessionOutputError` for that case (a test, the controller's mapping order),
  it needs updating in the same commit.
- **Step 2, which telemetry row.** "The latest row for the adventure" assumes a
  replayed turn writes exactly one. A dice-result case would not, but eval-v2
  has none yet.
- **Zod drops unknown keys inside a JSON value.** A leak whose JSON names a
  field the schema no longer has (`npcStates`) recovers with that field silently
  gone. That is the same thing a clean call does today, so it is not a recovery
  defect, but it means "recovered" does not always mean "nothing lost".
