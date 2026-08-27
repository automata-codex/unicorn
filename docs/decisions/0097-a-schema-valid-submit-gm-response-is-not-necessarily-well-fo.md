---
id: ADR-0097
title: A schema-valid `submit_gm_response` is not necessarily well-formed
area: claude-turn-loop-correction
status: accepted
superseded_by: null
milestone: M7.7
summary: >-
  The tool-syntax leak — schema-valid responses whose payload was serialized into
  `playerText` — its measurement, and the deterministic guard that catches it. Read
  the addenda before citing the body: they supersede the retry reasoning (the budget
  is 1, not the loop cap) and replace the prompt-block mitigation with tool-schema
  descriptions.
---

`playerText` is the only required field on `submitGmResponseSchema`. A response carrying nothing else validates cleanly, so a payload whose remaining parameters were serialized as *text inside the narration* is indistinguishable, to every consumer downstream of the Zod parse, from a turn that genuinely had no state changes. The turn commits, the markup reaches the player, and `stateChanges` / `gmUpdates` / `diceRequests` are discarded — with no rejection, no correction event, and no log line. There was no discard point to instrument: nothing in the code believed anything had gone wrong.

The 2026-08-16 playtest applied state changes on 3 of 58 turns. On 39 it shipped raw tool-call markup inside `playerText` and dropped the payload. The anti-correlation is perfect across all 58 — every turn carrying markup applied nothing, and the discarded payloads were not junk: turn 52 lost an HP delta of −12, a carryover reset with `maxDelta: 0`, and `characterState: [{op: "death_save_pending", entityId: "dr_kennedy", roundsRemaining: 2}]`, all of it mechanically correct.

**The defect is model-side, and the extraction path was never at fault.** The API returned a well-formed `tool_use` block whose only parameter was `playerText`. One response — eval rep `008/turn24-hidden-info-leak` on the `ccac7d1c` re-baseline — carried the markup inside `playerText` *and* a correctly structured `gmUpdates` parameter in the same tool call, which rules out a parameter-boundary parse failure: the parser demonstrably closed the parameter and parsed a subsequent real one. What the model did was write the tag as content.

**It tracks the model, not the prompt, and predates the playtest by two and a half weeks.** Across every eval run on disk, `claude-sonnet-4-6` leaked 0 of 245 outputs and `claude-sonnet-5` 48 of 916 (~5%), spanning all four prompt hashes since 2026-07-29. Prompt `0bdd1306` gives a same-fixture head-to-head: 4.6 at 0/106, Sonnet 5 at 12/150. Under a 5% rate, 0-of-245 has probability ~2×10⁻⁶. `mothership-m7.txt` contains no tool-call examples to imitate, so prompt-induced mimicry is not the seed.

**The playtest's 67% is amplification of that ~5%, not a second defect.** Leaked `playerText` is persisted to `message` verbatim and replayed as assistant history on the next turn, where the model imitates it. Turn 12 leaked with zero contaminated messages in window — the spontaneous seed — and the rate thereafter tracks in-window contamination density (8% at turn 13, 44% at turn 23, 87–100% from turn 42) rather than prompt tokens, which is why turn 13 leaked at 6,952 tokens while turn 50 stayed clean at 15,799. Any single-turn measurement of this defect will read ~5% and understate what a long session does with it.

## Reject and retry, rather than fail the turn

`ADR-0041` caps the correction loop at one re-prompt on the reasoning that a larger retry budget masks a validator-or-prompt bug. This guard retries and does not violate that, because the two are rejecting different things. `ADR-0041` governs *semantic* rejection — the Warden proposed a delta the validator disagrees with — where a second attempt papers over a real disagreement. This is *structural* malformation: the model computed the right payload and put it in the wrong place. Turn 52 is the proof. Retrying recovers a correct answer rather than negotiating for a different one, and there is no outcome to launder, because the guard reads no game state.

So the inner tool loop hands back an error `tool_result` naming the failure and the corrective action, and re-enters — the same machinery a malformed payload already uses, bounded by the same `INNER_TOOL_LOOP_CAP`. A turn that never recovers exhausts the cap and 502s, which is loud. The correction pass throws instead: it is single-shot by construction (`ADR-0042`), so there is nowhere to retry to, and applying a response whose state changes were serialized into prose is worse than failing.

The alternative — flag and pass through — was rejected outright. The whole defect is that a broken payload was indistinguishable from a valid one; preserving that indistinguishability while adding a log entry keeps the data loss and merely annotates it.

## Structural matching, not a semantic classifier

The detector (`apps/zoltar-be/src/session/session.tool-syntax.ts`) matches literal markup only: the canonical tool-call element names as whole tags, plus a tag built from each **top-level property name on the schema itself**. Deriving that half from `submitGmResponseSchema.shape` rather than listing it by hand is what stops the token set and the tool drifting apart when a field is added — a hand-maintained list would go stale silently, in a detector whose entire job is catching things that fail silently.

A "looks like internals" heuristic was rejected. It would be non-deterministic against narration, and this check sits on the path of every turn: a false positive costs a real player a real turn. Deterministic matching also makes the check re-runnable against frozen artifacts, which is what lets the eval harness reuse it (`ADR-0096`) rather than reimplement it — `eval/` already imports from `src/`, so the shared boundary is a wrapper, not a port.

Validated against every playtest turn and every eval `gm_response` on disk — 1,228 real responses — at 87 true positives and 1,141 true negatives, with zero false positives and zero false negatives.

## Only `playerText` is scanned

`gmUpdates.notes` is Warden-private reasoning where naming schema fields is legitimate and frequent — turn 52's notes discuss `resourcePools` and `characterState` by name at length, correctly. Scanning it would trade the real signal for false positives on the field most likely to produce them. The accepted consequence is that markup leaking into `notes` alone goes undetected; it is not player-visible and it does not discard state.

## What this does not claim

The guard catches the symptom. It does not stop the model emitting the markup, and it does not reduce the ~5% base rate — it converts those turns from silent data loss into an extra tool-loop iteration. Expect `toolLoopIterations` to rise slightly and `UNAUDITABLE-MAPPING` applicability to rise with it, since state changes that previously vanished now land; both are the defect clearing, not a regression.

Mitigating the emission is Warden-visible and needs a re-baseline, so it is deferred to M8.1's backlog under `ADR-0085` unless the retry rate proves unacceptable in practice. Nothing here was measured against a model other than the two named above, and the Haiku 4.5 control arm's 9 outputs are far too few to say whether it exhibits the defect at all.

The detector cannot see a leak that uses markup it does not know — a differently-shaped fabricated tag would pass. That is the accepted cost of matching on structure instead of guessing at intent, and the schema-derived half of the token set is what keeps the known surface from shrinking as the tool grows.

**Addendum — the emission mitigation landed rather than being deferred, and the harness can now see the failure.** Recorded 2026-08-17, the same day, on the decision to put it in front of the next playtest rather than behind M8.1's backlog.

The paragraph above routed the Warden-visible half to M8.1 under `ADR-0085` on the grounds that it needs a re-baseline. That reasoning was sound and the scheduling premise it rested on was wrong: a re-baseline was already owed and already being run by hand, so the prompt change rides it at no additional Warden spend, and shipping the guard alone would have meant playtesting a known ~5% emission rate with a recovery path instead of a reduced one. `ADR-0094`'s rule is not to pay twice; batching onto a run already scheduled is the shape it prescribes.

`mothership-m7.txt` gains a `WHAT GOES IN playerText` block under `TOOLS`, and the prompt hash moves **`ccac7d1c` → `d8791e8d`** — Warden-visible, so `eval:compare` across that boundary is meaningless in the usual way. Two of its three paragraphs state the rule and its consequence; the third is the one carrying the load, and it exists only because of the amplification finding above: it tells the Warden that earlier turns in its own conversation may show narration ending in that markup, and that it is the defect rather than a format to copy. A prompt that only forbade emitting the markup would leave the contamination loop intact, since the model is imitating what it was shown rather than inventing it.

The guard is unchanged and stays. Prompt work reduces a rate; it does not make a rate zero, and the failure mode is silent data loss — the case for a deterministic backstop is unaffected by how well the prompt performs.

On the eval side, `TOOL-SYNTAX-LEAK` is registered as a **universal** check rather than the tag-independent one anticipated when this work was scoped: `applicability`'s `applies: true` branch requires a `playerEntity` the check has no use for, and `capture-fixture`'s fail-closed stub would ship it switched off on every new capture. See `ADR-0098`. The check imports this entry's detector rather than restating its token set.

**The number to expect.** Re-scoring the frozen `ccac7d1c` baseline would put `TOOL-SYNTAX-LEAK` at 4 failures in 150 (~2.7%) — the four occurrences already identified in that run's artifacts, every one of which the existing checks scored `pass` or `not_applicable`. That is the pre-mitigation figure for the tag, available without a Warden run, though not without judge spend: `eval:rescore` re-grades every check on every row, judged ones included.

**Addendum 2 — the prompt block did not work and has been removed; the mitigation moved to the tool schema.** Recorded 2026-08-18. Supersedes the paragraph in Addendum 1 describing the `WHAT GOES IN playerText` block and the `d8791e8d` prompt hash.

The block shipped on 2026-08-17 and did not reduce the emission rate. It is deleted, and `mothership-m7.txt` is back to **`ccac7d1c`** byte-for-byte — the same prompt the last baseline ran, which makes the tool schema the only Warden-visible change going into the next run.

**Adding a fourth statement to the prompt would have been volume, not signal.** `mothership-m7.txt` is ~19 KB and already forbade this in three places; stacking emphasis is the pattern that produces over-application rather than compliance. What the investigation had not checked was whether the model was being told anything *at the point where it generates the parameter* — and it was not. Dumping the generated `input_schema` showed all five top-level properties of `submit_gm_response` carrying **no description at all**:

```
playerText       *** NO DESCRIPTION ***
stateChanges     *** NO DESCRIPTION ***
gmUpdates        *** NO DESCRIPTION ***
diceRequests     *** NO DESCRIPTION ***
adventureMode    *** NO DESCRIPTION ***
```

All fourteen descriptions in the 6.4 KB schema were nested under `stateChanges` — the `resourcePools` and `characterState` fields M7.6 added. The model's entire view of the field it was leaking into was `"playerText": { "type": "string" }`. That is a gap, not a volume problem, which is why the same instruction is expected to behave differently here than it did in the prompt.

The five properties now carry descriptions (via `.describe()` in `session.schema.ts`, which `zodToJsonSchema` carries into the tool definition; schema 6,402 → 8,126 bytes, 14 → 19 descriptions). **The boundary statement appears once**, in `playerText`'s own description, rather than repeated on all five — four copies of one prohibition is the repetition-as-reinforcement pattern that the prompt block already failed with. The other four state their content plainly and let the contrast carry it; `stateChanges` closes with "a change described only in the narration is a change that did not happen."

**Two costs worth knowing.** Tool definitions render at position 0 of the cached prefix, ahead of both system blocks, so editing them invalidates every breakpoint — where a prompt edit keeps the tools cache. One extra prefix write per conversation, which for a fresh playtest adventure is nothing. And a tool-schema change is Warden-visible while leaving `promptHash` untouched, so two runs with materially different tool definitions would carry identical run identities. That gap is what `ADR-0099` closes.

**Addendum 3 — the retry does not work, and the turn is now abandoned after one.** Recorded 2026-08-18 on the evidence of the re-baseline run `claude-sonnet-5__ccac7d1c__2026-08-18T11-48-47Z`. Supersedes the retry reasoning in the body of this entry.

The body argued for handing the rejection back and re-entering the loop, on the grounds that Claude recovers from a malformed payload that way (the 2026-07-14 precedent) and that recovering a turn beats failing it. The first half of that is now falsified for this failure mode. On `turn24-scene-jump` rep 9 the same leaked payload came back **ten consecutive times** — the whole remaining loop budget — and the turn died on cap exhaustion regardless. Ten model calls at 13k+ prompt tokens each to reach the outcome the second call already predicted. Once Claude enters this mode within a turn, it stays there.

So `TOOL_SYNTAX_RETRY_BUDGET` is **1**: one rejection is handed back, a second consecutive leak throws `SessionToolSyntaxError` (502 `gm_tool_syntax_unrecoverable`). That is the number `ADR-0041` already argues for on the correction loop, and the argument transfers intact — more attempts hide the failure rather than fixing it.

**A separate error class rather than reusing `SessionToolLoopError`.** Both end at 502, and they mean opposite things: the loop error means Claude was still working and ran out of room, this one means it finished the same wrong way twice. Under one code, a genuinely stuck combat turn and an unrecoverable formatting failure are indistinguishable in the logs, and the operator response to each differs.

**Failing here also decouples the two budgets, which matters more than it looks.** Riding `INNER_TOOL_LOOP_CAP` meant the retries available depended on how much legitimate work the turn had already done — the rep-9 turn had spent ten iterations on rolls and lookups before the first leak, so it got ten retries where a quiet turn would have got nineteen. A busy turn getting *fewer* attempts to recover is backwards, and the count is now independent of what came before it.

The counter is consecutive rather than cumulative, resetting on a submit that fails some other way, so a turn alternating between a malformed payload and a leaked one still gets a fresh budget for each mode.

**What the run says about the emission itself, stated carefully.** `TOOL-SYNTAX-LEAK` read 1.00 across 149 graded turns, and an independent scan of every `warden-output.json` with the original oracle regex found zero markup in 149 outputs — the guard did its job completely, and nothing reached a player or committed silently. But the check reads 1.00 partly *because* the one occurrence became an `error` row: a turn that never produces a `gm_response` leaves the denominator, so the rate is computed over the turns that survived the behaviour being measured. The honest figure is **emission 4/150 → 1/150**, suggestive at p≈0.09 rather than the clean sweep that would have settled it. The property descriptions look like a real improvement; they are not shown to have eliminated the emission, and this tag now belongs on `ADR-0082`'s list of rates to distrust at 1.00 for a reason of its own.

This fix changes recovery, not what the Warden reads: `promptHash` stays `ccac7d1c` and `assemblyHash` stays `0bb41002`, so the run's numbers remain valid and the next run is comparable to it.
