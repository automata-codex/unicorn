# 026 — Tool-leak recovery

**Status:** draft for review, 2026-10-04.
**Type:** implementation spec. Plan to follow at `docs/plans/026-tool-leak-recovery-implementation-plan.md`.
**Review tier:** *detailed* (tool loop, and it changes what gets applied to state) and *is this needed?* (a new parser and a new task).
**Origin:** the maintainer's note of 2026-10-04, and `ADR-0097` Addendum 4, which records the decision this spec builds.

---

## The problem

A tool-syntax leak is a `submit_gm_response` whose `playerText` ends in tool-call
markup, with one or more of the other parameters written into the narration as
text (`ADR-0097`). Today the turn path detects it, asks once for a clean call, and
abandons the turn if the second call leaks too. The retry rarely works.

On the `2026-10-04T03-14-41Z` eval-v2 run, 4 of 50 turns were abandoned this way.
`docs/eval-findings.md § S45` puts the abandoned rate at 1.4% to 7% depending on
the adventure.

The payload in those turns is usually fine. It is in the wrong place. This spec
reads it back out.

## The goal

Two numbers, set by the maintainer:

- at least 99% of turns end with a usable response, however many of them leak
- which needs at least 80% of leaked responses recovered

The second does not always deliver the first. If `p` is the share of turns that
leak and `r` the share of leaks recovered, at most `p × (1 − r)` of turns are
lost. At `p` = 5% and `r` = 80% that is 1%. On the `2c0ba938` cases, where `p` is
7% to 8%, it takes `r` of about 87%. So 80% is the floor this spec is accepted
at, and the refusal counts below say what to build if a run needs more.

## What the leaks look like

Measured 2026-10-04 by a throwaway script over every JSON file under
`$ZOLTAR_EVAL_ROOT`: 133 distinct leaked `playerText` values. The counts are
distinct strings, weighted toward a few fixtures whose history already carries
leaks. They are not a per-turn rate.

| Shape after the narration | Count |
|---|---|
| `</playerText>` then `<parameter name="X">` with a JSON value | 89 |
| `</playerText>` then `<X>` holding nested tags, JSON, or a mix | about 34 |
| `</playerText>` and nothing else, a call to a different tool, other | about 10 |

Three things in that data shape the design:

- **126 of 133 start with `</playerText>`.** The model closes the parameter with
  the property name instead of `</parameter>`. The other 7 start with a stray
  `</parameter>`.
- **Usually one parameter is swallowed, not all of them.** In 52 cases
  `stateChanges` is in the text and `gmUpdates` arrived as a real parameter. The
  text runs to the next real `</parameter>`, and everything after that parses
  normally.
- **No collisions.** No leak carries a field in the text that also arrived as a
  real parameter.

The nested shapes are not one format. Samples from the archive:

```
<stateChanges><flags><some_flag><value>true</value></some_flag></flags></stateChanges>
<stateChanges><scenarioState>{"timer":{"current":3}}</scenarioState></stateChanges>
<stateChanges><parameter name="flags">{"some_flag":{"value":true}}</parameter>…
<gmUpdates><notes>Free text…</notes></gmUpdates></submit_gm_response>
```

## What gets built

Three pieces, in this order. Each is usable before the next exists.

1. **Capture.** Every leaked payload a run or a playtest produces is saved where
   the corpus script can find it.
2. **The recovery function, its test cases, and the corpus script.** A pure
   function; one unit test per leak shape, built from real payloads; and a small
   free task that runs the function over every leak on disk and reports the
   recovery rate.
3. **Wiring.** The tool loop and the correction pass call the function before
   they reject.

Piece 3 does not start until the test cases pass and the corpus script reports
at least 80%.

## Where the real decisions are

### 1. One parsing rule, applied at every depth

The function cuts `playerText` at the first leaked tag. What is before the cut is
the narration. What is after it is a list of fields.

A field is `<parameter name="X">…` or `<X>…</X>`. The same rule reads its value,
whatever depth it is at:

1. If the schema expects a string here, the value is the text as written.
2. Otherwise, if the text parses as JSON, the value is that JSON.
3. Otherwise, if the schema expects an object, the text is a list of fields. Read
   each one by this same rule.
4. Otherwise, if the schema expects a number, a boolean or null and the text is
   one, the value is that.
5. Otherwise, refuse.

That covers all four samples above with no per-shape code.

"What the schema expects" is read from the tool's generated JSON `input_schema`,
the same document the model is given. It is plain data and easy to walk. Walking
Zod's internals would mean unwrapping optionals, descriptions and unions by hand.

A closing tag may be missing on the last field, because the API consumed it as
the end of `playerText`. Trailing `</invoke>`, `</submit_gm_response>` and
`</function_calls>` are ignored.

### 2. When it refuses

The function returns either a whole repaired payload or a refusal with a reason.
There is no partial result. It refuses when:

- **Anything after the cut is left over.** Every character after the cut is
  parsed into a field, or is whitespace or a known closing tag. This is the
  hidden-information guard: `gmUpdates.notes` is Warden-private, and a parse that
  left part of it in `playerText` would show it to the player.
- **A recovered field also arrived as a real parameter.** Not seen in 133 cases,
  and there is no right answer for which copy wins.
- **The merged payload fails `submitGmResponseSchema`.** The function moves
  values to where they belong. It does not fix their shape. One archived leak
  writes `resourcePools` as a map keyed by pool name, which the schema rejects
  wherever it arrives.
- **The trimmed `playerText` still trips the leak detector.**
- **An array is written as tags**, or a tag carries attributes other than
  `name`. One case in the archive (`<entity id="…">`). There is no single
  reading of it.
- **The text contains a call to another tool** (`<invoke name="rules_lookup">`).
  Two cases.

A refusal changes nothing about today's behaviour: one retry, then
`SessionToolSyntaxError`.

### 3. Recovery comes before the retry, and replaces it when it works

A recovered payload is treated exactly as if it had arrived clean. It goes on to
the validator and, if needed, the correction pass. No extra model call is made.

This reverses the order `ADR-0097` set (reject, then retry). The retry stays as
the fallback for refusals because it costs one call and sometimes works.

The clean `playerText` is what gets persisted as the assistant message, so a
recovered leak does not seed the history that `ADR-0097` found the model
imitating.

### 4. Where captured leaks live

There is no separate corpus directory. The corpus is every JSON object under
`$ZOLTAR_EVAL_ROOT` with a `playerText` that trips the detector, which is what
the measurement above already scanned. Capture means making sure new leaks land
in JSON under that root.

- **The tool loop** keeps a list for the turn: each leaked raw input, and whether
  it was recovered or refused (and why).
- **A turn that commits** writes the list to its telemetry row as an optional
  field, `toolSyntaxLeaks`.
- **A turn that is abandoned** has no telemetry row. `SessionToolSyntaxError`
  carries the list instead.
- **`ev2:run`** copies the list into the rep's JSON in both cases. On success it
  reads the telemetry row before deleting the scratch campaign.
- **`playtest:review`** writes `<adventure-id>-tool-leaks.json` beside the
  report when the adventure has any.

**One gap, left open on purpose:** a turn abandoned during a live playtest has
no telemetry row and no eval run to save it. Its payload is written in full to
the server log at error level and nowhere durable. Those are the refusals, which
are the examples worth most. Making them durable means the app writing to a
table or a file outside a turn, and that is a bigger change than the rest of
this spec. Decide it after the first playtest with recovery on, when the number
of such turns is known.

## The test cases are the record

The unit tests say what the function does. The corpus script only counts.

The 133 archived leaks come down to 40 distinct tag sequences, and fewer shapes
once those differing only in their trailing closing tags are merged. Each shape
gets one named test case: a real payload with its narration cut to a line or two, and the
expected result written by hand. The expected result is either the full repaired
payload or a refusal with its reason.

Writing the expected payload by hand is the check that the right value went to
the right field. The corpus script cannot make that check. It can only say a
result is schema-valid.

The cases live in the repo and run in CI. The archive does not, so anything that
reads it runs only on the maintainer's machine.

## The corpus script

```
task leaks:corpus
```

Free: no database, no Anthropic, no Voyage. Needs `ZOLTAR_EVAL_ROOT`.

It answers the two questions the test cases cannot:

- **What share of real leaks is recovered?** It walks the archive, collects every
  distinct leaked payload, runs the function on each, and prints recovered over
  total.
- **Did a run produce a shape nobody has seen?** It lists each refused payload:
  the file it came from and the refusal reason.

That is all it does. It has no flags and no report file.

**After a run or a playtest**, the maintainer runs it and looks at the refusals.
A shape with no test case gets one, expecting either a recovery (and the function
is changed to match) or a refusal (and the case records that the refusal is
intended).

The first result is written up in `docs/eval-findings.md` as the next `§ S`
entry. It replaces the throwaway measurement in this spec as the number to cite.

## Layout

```
apps/zoltar-be/src/session/
  session.tool-syntax-recovery.ts       the function
  session.tool-syntax-recovery.spec.ts  one case per shape
  session.tool-syntax-recovery.cases.ts the payloads and their expected results
apps/zoltar-be/scripts/
  tool-leak-corpus.ts                   CLI for leaks:corpus
```

Changed: `session.service.ts` (tool loop, correction pass, the error class),
`session.telemetry.ts` (one optional field), `eval-v2/run.ts` and `replay.ts`
(copy the list), `scripts/playtest-review.ts` (the sidecar file), `Taskfile.yml`.

## Tests

- **The function:** one case per archived shape and at least one per refusal
  reason, as described above.
- **The tool loop** (`session.tool-loop.spec.ts`, mocked client): a recoverable
  leak commits with no second call; a refused leak still retries once, then
  throws; the error carries the raw inputs.
- **The correction pass:** a recoverable leak is applied; a refused one throws
  as it does today.
- **The corpus script:** no test of its own. It is a loop around a tested
  function, and a wrong count is visible on reading its output.
- **Telemetry:** the new field is written, and a row without it still reads.

Acceptance for piece 2 is two things: every test case passes, with the maintainer
having reviewed the hand-written expected results; and the corpus script reports
at least 80% recovered.

Acceptance for piece 3 is the count of abandoned turns on the next eval-v2 run
the maintainer was going to do anyway. This spec does not ask for a run of its
own, and it adds no eval-v2 question. The before-number is 4 of 50.

## Not in this version

- **Retrying with the schema error when a recovered payload is schema-invalid.**
  The ordinary malformed-payload retry does work, so this may be worth having.
  The corpus script lists every such refusal. Decide from how many there are.
- **Arrays written as tags.**
- **Durable capture of turns abandoned in a live playtest** (above).
- **Judge-side leaks.** The old harness's judge leaks into `rationale` too. That
  harness is not being extended.
- **Any change to what the Warden reads.** No prompt edit, no tool-schema edit.
- **Removing the detector or the retry.** Both stay.

## What would make this wrong

- **A recovered payload applies the wrong state.** The failure this replaces is
  loud (a 502). A wrong recovery would be quiet. The left-over rule and the
  schema check are the guards, and the hand-written expected results are the
  test of them. If one wrong value turns up, in a test case or in play, piece 3
  does not ship (or comes back out) until the rule that let it through is fixed.
- **The shapes move.** Every shape here came from `claude-sonnet-5`. A model
  change could produce shapes the rule refuses. That shows up as refusals when
  the corpus script is run after the next run, which is what the capture is for.
- **Text values carry XML escapes** (`&amp;`, `&lt;`). Not checked yet. The plan
  checks the archive before the function is written.
- **The corpus overstates the rate.** It is weighted toward a few fixtures. A
  result of 80% on the corpus is not a promise of 80% in play. The abandoned-turn
  count on real runs is the number that matters.
