# 023 — Widen `UNAUDITABLE-MAPPING` past its single fixture

**Status: open.** Drafted 2026-08-29. The second half of M7.7's
`UNAUDITABLE-MAPPING` bullet — the coverage half, which plan 021 deliberately
left open behind the prompt change and `docs/rules-extraction-findings.md
§ S36` deferred on the grounds that "widening it before the instruction exists
buys more fixtures measuring a Warden that was never told." Both blockers are
now clear: the instruction shipped as prompt `e83e8aaa`, and the corpus
re-baseline that made it the standing point landed 2026-08-28
(`docs/eval-findings.md § S39`).

A plan rather than a spec, on the `014`/`021`/`022` precedent — a corpus change
aimed at one tag, with predictions pre-registered before the fixtures are
trusted.

Evidence: `docs/rules-extraction-findings.md § S36`, `docs/eval-findings.md
§ S39`, and the three playtest reports under `$ZOLTAR_EVAL_ROOT/playtests/`.

## The problem in one paragraph

`UNAUDITABLE-MAPPING` reads **1.00 (10/10) at applicability 10/50** on the
standing point, and every one of those ten rows comes from a single fixture.
The other four report `not_applicable` on every rep, all through the honest
`no dice_roll events this turn` branch — the Warden simply does not roll on
those turns. So the tag's headline number is ten reps of one turn, and
`ADR-0082`'s "≥0.90 is a blind rubric, not a pass" clause applies at full
force. Plan 021 said as much about its own result and left this open.

## What is already established (do not re-derive)

- **The tag is prose-graded.** The rubric reads the roll's `purpose` **text**
  and never a structural field (`§ S36`'s same-day correction).
- **The scope question is settled.** `isSpontaneousGmRoll` keeps NPC stat
  checks in scope and the Warden states the stat as the threshold (plan 021,
  "The scope question is settled"). No checker change is owed here.
- **Applicability is a property of the re-run turn, not of the fixture.** The
  gate reads the Warden's fresh output, so a captured turn only *invites* a
  spontaneous roll — it cannot guarantee one. This is the whole reason the tag
  measures one fixture today.
- **The capture target is the `player_action` sequence**, not the
  `gm_response`. Verified against all six `2c0ba938` fixtures and both
  `5c34991b-turn0*` fixtures; `capture-fixture` reconstructs state strictly
  before the target.

## Where the tag stands, per fixture

From `claude-sonnet-5__e83e8aaa__2026-08-28T13-00-14Z`, read off `reps/*/scores.jsonl`.

| Fixture | Verdicts | `dice_roll` events per rep |
|---|---|---|
| `5c34991b-turn01-unauditable-mapping` | **pass 10/10** | 1 |
| `5c34991b-turn09-unauditable-mapping` | `not_applicable` 10 | 0 |
| `turn01-unauditable-mapping` | `not_applicable` 10 | 0 |
| `turn03-unauditable-mapping` | `not_applicable` 10 | 0 |
| `turn14-unauditable-mapping` | `not_applicable` 9, error 1 | 0 |

The four exclusions are the honest branch, not the classifier blind spot —
which the checker's own comment already predicted: "The no-rolls branch fires
11 times, all under Sonnet 5, which rolls far less than 4.6 on these fixtures."

## The three pass-direction candidates

From the 2026-08-24 playtest (`2c0ba938`), annotated `FIXTURE-CANDIDATE-PASS`
in its warden-failures report. Roll payloads read from the live rows.

| Turn | Capture target | Roll(s) | Verified against `isSpontaneousGmRoll` |
|---|---|---|---|
| 25 | **76** | `1d20` @ 77 — four bands, 1-5 / 6-12 / 13-17 / 18-20 | passes |
| 45 | **144** | `1d20` @ 145 — four bands covering 1-20 | passes |
| 51 | **165** | `1d100` @ 166 ("roll under 50") + `1d10` @ 167 (four bands) | both pass |

All four rolls are `system_generated`, single die, `modifier: 0`, no
`requestId`, so the structural gate returns `null` and the judge sees them.

**The playtest ran under prompt `e83e8aaa`** — the current one, post-021. That
matters more than the annotations do: these are not lucky turns from an older
Warden, they are the shipped instruction working, and the fixtures will re-run
under the same prompt that produced them.

**One wrinkle on turn 51.** Its `1d10` is conditional — *"Since the array
repair failed (96, high fail)"* — so on a re-run where the `1d100` succeeds the
second roll never fires. The graded set will vary between reps. That is fine
for the judge, which grades whatever spontaneous rolls the turn produced, but
it means turn 51's rows are not directly comparable rep to rep.

## There is no fail side available, and capture cannot buy one

Worth stating outright, because the corpus after this bump is all pass-side and
that should be a recorded choice rather than a discovered one.

`5c34991b-turn01` carries both answers already, from the same seeded state:

| Run | Prompt | Verdict |
|---|---|---|
| `6717347d__2026-08-21T21-14-59Z` | pre-021 | **fail 10/10** |
| `e83e8aaa__2026-08-24T11-21-49Z` | post-021 | pass 9, **fail 1** (rep 010) |
| `e83e8aaa__2026-08-28T13-00-14Z` | post-021 | **pass 10/10** |

A fixture is seeded state plus player input; the Warden re-runs the turn under
whatever prompt is current. So a turn captured from a pre-fix playtest does not
stay a fail — it becomes a pass the moment the fix works, which is exactly what
happened here. **The discriminating power this corpus lacks cannot be bought by
capture**, because the defect it would discriminate against is fixed in the
prompt.

Two consequences.

**1. The uncaptured fail annotations are tripwires, not fail-side fixtures.**
`5c34991b`'s failure report carries five `UNAUDITABLE-MAPPING` annotations —
turns 1, 9, 29, 35, 44. Turns 1 and 9 became fixtures; the other three never
did, and all three are still in the DB:

| Turn | Capture target | Roll | `purpose` |
|---|---|---|---|
| 29 | 96 | `1d20` | "Entity's reaction/response to Kennedy's direct attempt at communication and cooperation offer" |
| 35 | 117 | `1d20` | "Entity reaction/comprehension check - responding to abstract question about its origin/vessel" |
| 44 | **149** | `1d20` | "Reyes's assessment of remaining time before hull breach cascade becomes critical, based on her engineering read of the deepening groans and cascade progression" |

Subject named, no bands, no threshold — the `§ S36` shape exactly. Under the
current prompt each of these should now **pass**, and a fail is the defect
returning. That is a regression tripwire, and it is worth one fixture, not
three: 29 and 35 are both entity-reaction rolls duplicating `5c34991b-turn01`'s
shape, while **turn 44's assessment/estimation roll is a distinct shape the
corpus does not otherwise carry.** Take 44; leave 29 and 35.

`18be155e`'s two uncaptured annotations (turns 4 and 7, deferred by spec 010
because their stub annotations needed fleshing out) are **not capturable** —
the local DB holds only `5c34991b` and `2c0ba938` now. Backups exist under
`$ZOLTAR_EVAL_ROOT/database-backups`; restoring one to reach two July turns is
not worth it.

**2. The real fail side is already on disk, and costs no Warden call.** The
three runs tabled above give a frozen must-fail artifact (pre-021, ten of
them), a frozen must-fail artifact *under the current prompt* with no
prompt-change confound (08-24 rep 010), and a frozen must-pass artifact
(08-28). That is the raw material for an M7.8 known-answer pair, obtainable by
committing probes rather than by running anything. It belongs in M7.8, not
here, but this plan is where the pointer gets written down.

## The change

### Part 1 — capture four fixtures

Three pass-direction, one tripwire.

```
task eval:capture-fixture -- 2c0ba938-ea80-4138-a95a-dc13e417bf2b 76 \
  --tag UNAUDITABLE-MAPPING --id 2c0ba938-turn25-unauditable-mapping \
  --output eval/fixtures/2c0ba938-turn25-unauditable-mapping.json
```

…and the same for `144`/`turn45`, `165`/`turn51` against `2c0ba938`, and
`149`/`turn44` against `5c34991b-b03e-46c4-93c1-855b13f6afb4`. DB only, no
Anthropic calls, and it needs the maintainer's approval on the occasion like
every `eval:*` target.

Verify at capture time rather than after, per `docs/playtest-scenarios.md
§ Capture discipline`: `gmContextBlob.playerEntityIds` populated, one entity id
per character, one resource-pool prefix per entity. Checking this late is what
voided the 2026-08-20 re-baseline.

### Part 2 — author the fixtures by hand

`playerInput` from the transcript, an
`applicability.unauditable-mapping` block with `applies: true` and situation
prose, and `assertion: { mode: 'judged', rubric: 'UNAUDITABLE-MAPPING',
facts: {} }` — the rubric requires no facts, so a rubric revision stays
scoring-only.

**The trap here is the stubs.** `capture-fixture` writes an `applicability`
entry per candidate check and they must be answered, not deleted — `applies:
false` with a real reason surfaces in the report's
`fixture-gated-never-applies` finding, a deleted entry is visible nowhere. But
every `applies: true` silently widens *another* tag's denominator, so each one
is a deliberate call. Turn 51's repair-then-consequence sequence is the one to
look at hardest: `out-of-order-resolution` is tag-independent (`ADR-0114`) and
has a plausible claim on it.

These capture as `fixtureSchemaVersion: 3`. `unauditable-mapping` declares no
`requiresFixtureSchema`, so nothing is gated on that here, but v3 does make
them eligible for `unreversed-retcon`, which requires it.

### Part 3 — close the `judgeContext` golden gap

In the same branch. Free, no API calls, and it should land *before* four more fixtures start flowing through an
unguarded renderer. `ungrounded-contractor-target.spec.ts` says it outright:
`unauditableMappingJudgeContext` "has sat in the same gap since it shipped and
is not retrofitted here", and `docs/eval-tags.md` flags it **uncovered** while
its three siblings carry goldens under
`eval/checks/judged/judge-context-golden/`. Build the probe from the frozen
artifacts named above and follow the `ADR-0105` pattern.

### Part 4 — regenerate `docs/eval-tags.md`

`task docs:eval-tags -- --output ../../docs/eval-tags.md` — the coverage row
moves from 5 fixtures to 9, and the `judgeContext` flag from **uncovered** to
`golden`. The file is gitignored, so this shows up in no diff: it is a local
generated view, and regenerating it is how a reader gets a current one.

## Part 5 — the bump note this owes

`docs/eval-methodology.md`, a new `## Bump note — 2026-08-29`, on the 08-23 and
08-24 precedents. It must carry four things.

- **Kind: set-membership.** No surviving fixture's input or grading moves;
  frozen artifacts stay exactly as valid as they were and `eval:rescore` is a
  real measurement for everything already on disk. The four new fixtures have
  no artifacts, so no rescore can produce numbers for them.
- **Three of the four are pass-direction, and the fourth is a tripwire.** Rate
  and applicability will both move for reasons unrelated to Warden behaviour.
  A rollup going 1.00 (10/10) → 1.00 (40/90) is arithmetic. Without this
  sentence M7.7 reads as an improvement it did not earn.
- **Like-for-like is `5c34991b-turn01` alone** — the treatment `§ S35` and
  `§ S37` already give a widened check, restricted to fixtures present on both
  sides.
- **After this bump the tag has no live fail side and cannot get one by
  capture**, for the reason tabled above. The fail side is M7.8's known-answer
  pair, sourced from artifacts already paid for.

## Part 6 — predictions, to pre-register before the run

Recorded as `§ S41` in `docs/eval-findings.md` before anything runs, per
`ADR-0085` and `ADR-0116`.

- **The falsifier: a new fixture that returns `not_applicable` on most reps has
  bought paper denominator.** The Warden must actually re-roll spontaneously on
  the captured turn, and it produced zero rolls on four of five existing
  fixtures. A fixture that never applies is `turn02` (`ADR-0115`) arriving in a
  new place, and it is a corpus defect rather than a result.
- **Turn 25 is the likeliest of the three to fail that test.** Its roll is the
  Warden's own initiative on a casual conversational beat — the easiest one to
  skip. Turn 51's repair attempt is the most likely to force a roll.
- The three pass candidates pass where they apply. They were produced under
  this exact prompt, so a fail here is a rubric or renderer problem before it
  is a Warden one.
- **Turn 44 passes.** It failed under the pre-021 prompt; a fail now means the
  fix does not hold on an assessment-shaped roll, which is a finding.
- Applicability across the tag rises materially above 0.20 without the rate
  falling below 0.90. **A rate that stays at 1.00 while the new fixtures sit at
  `not_applicable` is the null result**, not a pass.

## Constraints that will bite

- **No re-run is owed by the bump itself**, and none can settle it either. A
  set-membership bump permits a rescore for the survivors, but the four new
  fixtures have never executed. Two options: a scoped
  `eval:run --fixtures <the four> --reps 10`, or fold them into the next full
  re-baseline. **Prefer folding in** — the pass-direction caveat means the
  result is not decision-bearing on its own, and one run answers both
  questions.
- Either way the run needs a line in `docs/eval-methodology.md § Current
  baseline N` saying what it was and whether it was accepted, or
  `task docs:baseline-check` flags it. A scoped run is not a baseline and must
  say so.
- **Sequences 144, 149 and 165 are late-session turns** with long histories, so
  these reps cost more per turn than the corpus average. Both
  `2c0ba938-turn21-*` fixtures (sequence 64) error at 2 and 3 of 10 for reasons
  `§ S39` records as unexplained; if the new late-sequence captures error at a
  similar rate, that is the same unexplained thing and not a new one.
- `eval:run` is the maintainer's to launch by hand. Everything here prepares it.

## Open, and deliberately not done

- **`5c34991b` turns 29 and 35.** Capturable, same shape as `turn01`, declined
  as duplicate coverage rather than as bad fixtures.
- **`18be155e` turns 4 and 7.** Would need a database restore.
- **The M7.8 known-answer pair** for this tag, from the three frozen artifacts.
  In scope for M7.8 for the structural half; the judged half runs into that
  milestone's stated exclusion, which the roadmap already asks to be
  re-examined before planning against.
- **The `target` field on `roll_dice`**, still, and the player/GM asymmetry
  behind it. Out of scope here as it was in 021.

---

## What landed, 2026-08-29 — Parts 1 to 6

Corpus `c077bc456af7` → **`0272d4951fa0`**. `promptHash` `e83e8aaa` and
`assemblyHash` `ada7fb8a` unmoved; nothing Warden-visible is in this change.

**Part 1 — the four captures ran clean.** Targets resolved as planned: `76`,
`144` and `165` against `2c0ba938`, `149` against `5c34991b`. Capture discipline
verified at capture time rather than after: `playerEntityIds` populated on all
four (`danny` ×3, `dr_kennedy`), one entity id per character, and one
resource-pool prefix per entity with no strays. The `2c0ba938` captures carry
the same five entities and the same two pool prefixes as the six `2c0ba938`
fixtures already accepted, so the seeded shape is the corpus's own.

**Part 2 — authored, with one call worth reviewing.** Every stub answered, none
deleted. `unauditable-mapping` is `applies: true` on all four;
`system-rolled-player-action` is `applies: false` on all four, because in every
case the roll the situation invites belongs to an NPC — Teo's demeanour,
Reyes's engineering judgement — and the player's own input is conversation or
waiting.

`out-of-order-resolution` is `applies: false` on all four, and **turn 51 is the
one that could reasonably have gone the other way.** Its two rolls do chain —
the consequence fires only because the repair failed — which is the shape the
in-turn `gatedByRollId` branch exists to grade, and `§ S39` records that check
finding nothing across eight fixtures. It was declined because the chain runs in
the correct direction and is entirely NPC-side, while the block asks for a
`playerEntity` whose declared action is being resolved and Danny declares none.
The reason is recorded in the fixture rather than left implicit. If NPC-side
chain ordering is worth grading, it wants its own decision, not a quiet
attachment here.

**Part 3 — the `ADR-0105` gap is closed.** The golden's probe is transcribed
from frozen artifacts rather than invented: the `§ S36` cartographer roll that
failed 10/10 under `6717347d`, turn 51's banded consequence roll under
`e83e8aaa`, and a third roll resolving a `dice_request` that must be **absent**
from the render — the half a rubric rewrite is most likely to lose silently.
`ungrounded-contractor-target.spec.ts`'s note that this renderer "is not
retrofitted here" was updated rather than left to go stale.

**Parts 5 and 6 are written**: `docs/eval-methodology.md § Bump note —
2026-08-29` and `docs/eval-findings.md § S41`.

**What is not done, and is the maintainer's:** the run. Nothing on disk can
produce first numbers for four fixtures that have never executed, and per
`§ Constraints that will bite` the recommendation is to fold them into the next
full re-baseline rather than buy a scoped run for them.
