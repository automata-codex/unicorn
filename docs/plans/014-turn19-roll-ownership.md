# turn19 — roll ownership

> **RESOLVED 2026-08-10, in one iteration.** `SYSTEM-ROLLED-PLAYER-ACTION`
> reads **1.00 (20/20)** at prompt `c45a142a` — above July's 0.90 — with
> `UNSURFACED-CHECK` holding at 1.00. The falsifier below was run first and
> the hypothesis survived; the fix was placement and voice, as predicted.
> Account in `docs/rules-extraction-findings.md § S32` (the falsifier and the
> edit) and `§ S33` (the re-baseline). Prompt change is `e5dfd0f`.
>
> **Two corrections to this document, kept in place rather than edited away**
> because the reasoning below is what a future reader will be checking:
> the primer is `:60`–`:174`, not `:141`–`:189` (July's whole prompt was 62
> lines against today's 191), and the defect is a referent flip — the primer
> silently reassigns "you" from the Warden to the player-character — rather
> than the ambiguity of "call for a Save". Both are corrected inline below.

Handoff for a fresh thread. Everything here is verified as of 2026-08-09,
commit `4a04f2d` on `milestone-m75-rules-retrieval-quality`.

## The problem in one paragraph

Sonnet 5 resolves the player's declared action itself instead of surfacing a
`dice_request`. On `turn19-system-rolled-player-action` it fails 9 of 10 reps,
against 10 of 10 passing in July. Every failing rep resolves the *entire*
combat exchange server-side — the player's Combat check, the player's damage,
then the NPC's return fire — and emits no `diceRequests` at all. In solo play
this takes the player's action out of their hands, which is an agency
violation rather than a polish item.

## What is already established (do not re-derive)

- `docs/rules-extraction-findings.md § S30` — the attribution false pass. The
  checker was measuring this wrong until 2026-08-09; ignore any
  `SYSTEM-ROLLED-PLAYER-ACTION` figure dated 08-07 to 08-09.
- `docs/rules-extraction-findings.md § S31` — the post-fix re-baseline and the
  reproducibility result.
- `docs/decisions.md § Agentic graph decomposition` — why this is not a graph
  problem, and the criterion that governs revisiting it.
- `docs/decisions.md § actingEntityId must resolve against a declared
  identifier set` — the instrument rules that came out of § S30.

## The numbers to beat

Sonnet 5, prompt `0bdd1306`, populated index, corrected checker. **Read these
two as a pair** — they moved in opposite directions on one prompt change, and
a fix that trades one for the other will look like progress.

| Tag | July `97feadbd` | Now `0bdd1306` | Result `c45a142a` |
|---|---|---|---|
| `SYSTEM-ROLLED-PLAYER-ACTION` | 0.90 (18/20) | **0.45 (9/20)** | **1.00 (20/20)** |
| `UNSURFACED-CHECK` | 0.70 (7/10) | **1.00 (10/10)** | **1.00 (10/10)** |

Per fixture, `SYSTEM-ROLLED-PLAYER-ACTION` is `turn19` 0.10 (1/10) and
`turn21` 0.80 (8/10). turn19 is where the work is.

Secondary, worth not breaking: `UNAUDITABLE-MAPPING` is 0 of 30 applicable
because the Warden stopped inventing spontaneous rolls; `OUT-OF-ORDER-RESOLUTION`
0.94; `HIDDEN-INFO-LEAK` 1.00.

## The live hypothesis

**Placement, not content.** The rule is already in the prompt:

- `mothership-m7.txt:41` — "WHEN TO CALL diceRequests — Any roll the player's
  character makes to resolve their own action."
- `mothership-m7.txt:22` — the mirror rule for `roll_dice`.

Both predate M7.5. So the model is violating an explicit instruction, and
"tell it whose roll it is" has *already been tried* by whoever wrote line 41.

What M7.5 changed is what sits after it. The mechanical primer occupies
`:60`–`:174` — *corrected from `:141`–`:189`; the M7.5 additions start at the
vocabulary-bridging block, and July's entire prompt was 62 lines against
today's 191, so `:41` went from 66% depth to 21%* — written throughout in
resolution voice ("call for a FEAR Save", "roll under it") and never restating
who rolls. "Call for a Save" is exactly ambiguous between issuing a request
and rolling one.

If that is right, the fix is placement and voice, not a new rule, and the
cheapest test is to move or re-voice rather than to add.

**Falsifier to run first, before editing anything:** re-read the primer and
count how many imperatives could be read as "you roll this." If the answer is
"few," the hypothesis is weak and the next candidate is the interaction
between `:22`'s "if a character is not pressing a button to resolve it, the
Warden rolls" and an eval harness where nobody is pressing a button.

> **Run 2026-08-10. The count is 12, so the hypothesis survived** — and it
> turned up something this section did not predict. The real defect is not
> ambiguity but a **referent flip**: `:1`–`:58` address the Warden ("You are
> the Warden"), then from `:91` the primer switches to the book's voice where
> "you" is the player-character (`:137` "You gain 1 Stress every time you fail
> a Stat Check"), and never announces the switch or switches back. The rule at
> `:41` lost because the pronoun binding it depends on was reassigned
> underneath it. The fallback hypothesis was live too and was fixed in the same
> pass: "pressing a button" keys the decision to *availability of a roller*
> rather than ownership of the action. Full count in § S32.

## Constraints that will bite

- **Any prompt edit changes the hash**, which forces a new baseline. Budget
  one N=10 Sonnet 5 run per iteration. Do not iterate blind — `task
  eval:run -- --fixtures turn19-system-rolled-player-action,turn03-unsurfaced-check`
  scopes a cheap probe to the pair that matters.
- **`task eval:primer-audit` after every primer edit.** Six errors were found
  across five revisions in three days and three read perfectly well.
- **4.6 is not being re-run.** It carried 10 tool-loop-cap errors on the M7.5
  attempt and the upgrade decision was settled in July.
- **`corpusVersion` is `104b2d944252`** as of the fixture edit in § S30.
  Comparisons against anything older warn; that warning is benign and the
  reason is recorded in § S31 (the assembled request is byte-identical).

## Frozen runs worth comparing against

```
claude-sonnet-5__97feadbd__2026-07-29T15-40-17Z   July baseline, empty index
claude-sonnet-5__0bdd1306__2026-08-09T14-37-36Z   M7.5, pre-fix checker
claude-sonnet-5__0bdd1306__2026-08-09T21-23-39Z   M7.5, post-fix — the one to beat
```

All under `$ZOLTAR_EVAL_ROOT/eval-runs`. The July run needs `--scoring rescore`
(its own scores predate the corrected checker); the 08-09T21 run does not.

## Open, and deliberately not done

*Status as of 2026-08-10. The roll-ownership item itself is closed; everything
below was open before this work and mostly still is.*

**New, opened by § S33:** `turn24-over-resolution` is an `ungated` judged check
with no `not_applicable` path, and one rep failed on a rubric whose subject the
turn never reached — the judge said so in its own rationale and returned `fail`
anyway. That is § S30 inverted, on the judged side. Needs a gate, or a recorded
decision that judged checks are exempt from the undecided discipline.

- `docs/eval-methodology.md` `Current baseline N` was not updated —
  applicability shifted on the roll-shaped checks and that is a variance
  judgement for Alex.
- Roadmap ticks for M7.5 not applied; whether the milestone closes with a
  known 0.45 on a headline check is Alex's call.
- **Product-side root cause from § S30 is still open**: player entities are
  absent from `<entities>` because `renderEntities` only un-hides ids already
  in `campaign_state.entities`. Seeding fixtures closed it for the eval only.
- Duplicate `alvarez_*` / `lt_alvarez_*` resource pools — debug before the
  next playtest capture.
