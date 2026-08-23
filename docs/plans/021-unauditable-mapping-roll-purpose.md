# 021 — `UNAUDITABLE-MAPPING`: tell the Warden to fix the meaning before the die is read

**Status: open.** Drafted 2026-08-23. A plan rather than a spec, on the
`docs/plans/014-turn19-roll-ownership.md` precedent: one prompt-surface change
aimed at one tag, with a pre-registered prediction that runs before the edit
is trusted. Lands **before** the second M7.7 playtest, per the sequencing call
recorded in `docs/roadmap.md § M7.7`.

Evidence: `docs/rules-extraction-findings.md § S36`.

## The problem in one paragraph

`UNAUDITABLE-MAPPING` reads **0.00** and has since 018's re-baseline. All ten
reps of the one fixture carrying it fail, with converging rationales: the
roll's `purpose` names the *subject* of the check and never states what the
result means. Two reps catch the Warden interpreting after the fact in its own
notes — a 93 called "auto-fail territory", a 22 read as "low = coherent". The
Warden is doing something wrong. It has also never been told not to.

## What is already established (do not re-derive)

- **The tag is prose-graded.** The rubric asks whether the roll's own
  `purpose` **text** states what the results mean, and never reads a
  structural field. `§ S36`'s first draft claimed the opposite and was
  corrected the same day.
- **`purpose` carries no guidance at all.** It is a bare `z.string()` in
  `rollDiceInputSchema` (`src/session/session.schema.ts:523`) with no
  `.describe()`, and `mothership-m7.txt` mentions the field **zero times** —
  including in `FIELDS EVERY roll_dice CALL MUST CARRY` (`:29`), which lists
  `actingEntityId` and `rollType` and stops.
- **The `target` asymmetry is real but is not the blocker.** The player roll
  path (`:463`) carries `target`; the GM path does not. That matters for
  structural auditability and for the `DiceRollEventPayload` gap M7.7's
  fixture-authoring bullet records. It is out of scope here.
- **The scope question is settled.** `isSpontaneousGmRoll` scopes in NPC stat
  checks, which do have a fixed mechanic (roll-under-Instinct) that the
  rubric's preamble nominally excludes. **Decision: keep them in scope and
  have the Warden state the stat as the threshold.** No checker change, and
  the instruction stays uniform across every GM-initiated roll.

## The numbers to beat

From `claude-sonnet-5__6717347d__2026-08-21T21-14-59Z`, adjusted for the
2026-08-23 bump (corpus `ead033182d6a`, `turn16` retired).

| Tag | Now | Target |
|---|---|---|
| `UNAUDITABLE-MAPPING` | **0.00 (0/10)**, applicability 0.20 (10/50) | materially above 0.00 |

One fixture — `5c34991b-turn01-unauditable-mapping` — is the entire
denominator; the other four return "no dice_roll events this turn" every rep.
So this measures one turn, and a good result here is evidence, not proof. The
tag's coverage-widening half stays open behind this.

**Do not break, and read as a pair with the above:** a prompt that pushes the
Warden toward stating thresholds could plausibly push it toward rolling more,
or toward resolving player actions itself. Both have a recorded history here.

| Tag | Now | Must hold |
|---|---|---|
| `SYSTEM-ROLLED-PLAYER-ACTION` | 0.94 (47/50) at last measure | ≥ 0.90 |
| `UNSURFACED-CHECK` | 1.00 (10/10) | ≥ 0.90 |
| `NARRATING-PAST-A-BLOCK` | 1.00 (20/20) post-retirement | ≥ 0.90 |
| `HIDDEN-INFO-LEAK` | 1.00 under rubric `13305f34` | ≥ 0.90 |

## The change

Two surfaces, both Warden-visible.

1. **`mothership-m7.txt`**, in `FIELDS EVERY roll_dice CALL MUST CARRY` —
   a `purpose` entry requiring the meaning be fixed before the die is read:
   a threshold for a stat check (*"roll under the Cartographer's Instinct
   35"*), enumerated bands for a table or an oracle-style roll. Placed with
   the other required fields rather than in `WHEN TO CALL roll_dice`, because
   `§ S36` shows the failure is in what the field contains, not in whether
   the roll should have happened.
2. **`rollDiceInputSchema.purpose`** — a `.describe()` saying the same thing
   in the tool schema, so the requirement survives for a reader who never
   sees the role prompt.

Both move a hash: `promptHash` for the file, `assemblyHash` for the tool
definitions. That makes this **input-affecting** under
`docs/eval-methodology.md § Two kinds of corpus bump` — a fresh re-baseline,
not a rescore.

## Predictions, to pre-register before the run

Recorded here, before the edit, so the run can falsify them:

- `UNAUDITABLE-MAPPING` rises off 0.00. **A move to exactly 1.00 on one
  fixture is not the win it looks like** — it is ten reps of one turn, and
  `ADR-0082`'s "≥0.90 is a blind rubric, not a pass" clause applies with
  full force at this denominator.
- No tag in the hold-table above falls below 0.90.
- **The falsifier: applicability does not collapse.** If
  `UNAUDITABLE-MAPPING`'s applicability drops from 0.20 toward zero, the
  Warden has stopped making spontaneous rolls rather than started explaining
  them — the tag would read as improved while measuring less. This has
  happened before on this exact tag: `§ 014` records it at 0 of 30 applicable
  because the Warden stopped inventing rolls under prompt `0bdd1306`. Check
  applicability before reading the rate.

## Constraints that will bite

- **Re-baseline before the playtest, not after**, which is the whole reason
  this is sequenced here. The capture is steered at wounds chains and
  Contractor actions — precisely the GM-initiated rolls this tag measures —
  so capturing first would freeze unauditable rolls into new fixtures.
- **The assembly goldens must be regenerated** (`UPDATE_ASSEMBLY_GOLDENS=1`),
  or `eval:run`'s preflight refuses to start. `tools.txt` is the one that
  moves.
- One re-baseline covers this change **and** the 2026-08-23 bump. Its four
  predictions are already settled by cheaper means, so this run does not owe
  them a second answer.

## Open, and deliberately not done

- The `target` field on `roll_dice`, and the player/GM asymmetry behind it.
- Widening `UNAUDITABLE-MAPPING` past its single fixture — blocked on the
  playtest, and worth more once the Warden has been told what to write.
- Whether `isSpontaneousGmRoll` should exclude fixed-mechanic rolls. Decided
  *not* to, above; revisit if the run shows stat checks dominating the scope.

---

## The run, 2026-08-23 — target hit, decision rule breached, do not ship

`claude-sonnet-5__995083c8__2026-08-23T13-24-26Z`. **Partial: reps 1–7 of 10**
— the run was stopped during rep 8 and never wrote a report, so everything
below is computed from the seven complete `scores.jsonl` files. Small N, and
the run also carried ~6 errored turns.

### The target moved, and the falsifier did not fire

| | Before | After (7 reps) |
|---|---|---|
| `UNAUDITABLE-MAPPING` rate | 0.00 (0/10) | **1.00 (7/7)** |
| applicability | 0.20 (10/50) | **0.20 (7/35)** |

Applicability held at exactly the prior ratio, which is the thing that had to
be checked first: the Warden kept making spontaneous rolls at the same rate
and started explaining them, rather than avoiding them. The `§ 014` failure
mode did not recur. Per the plan's own caveat, 1.00 on one fixture is seven
reps of one turn and is evidence, not a solved tag.

### `SYSTEM-ROLLED-PLAYER-ACTION` fell through the floor

**0.76 (38/50) against a 0.90 floor**, and like-for-like on shared fixtures
the damage is concentrated and severe:

| Fixture | Before | After |
|---|---|---|
| `5c34991b-turn10-system-rolled-player-action` | 1.00 (10/10) | **0.33 (2/6)** |
| `5c34991b-turn10-narrating-past-a-block` | 1.00 (10/10) | **0.50 (3/6)** |
| `5c34991b-turn10-roll-result-inversion` | 1.00 (10/10) | **0.71 (5/7)** |
| `turn19-system-rolled-player-action` | 1.00 | 1.00 |
| `turn21-system-rolled-player-action` | 1.00 | 1.00 |

Two more tags moved with it: `SCENE-JUMP` 0.88 → **0.43**,
`ROLL-RESULT-INVERSION` 0.90 → **0.71** (1.00 under the contract-B rescore).
All three regressed tags share the `5c34991b-turn10` source turn or `turn24`.

### The mechanism, from the artifact rather than inferred

Rep 001 of `5c34991b-turn10-system-rolled-player-action`, whose
`playerEntityIds` is `['dr_kennedy']`:

```
ROLL: 1d20 | actingEntityId: dr_kennedy | rollType: panic_check
purpose: "Panic Die for dr_kennedy — … check against current Stress 2 to see
          if the mounting dread costs composure. Roll greater than 2"
diceRequests: []
```

**The Warden obeyed the new instruction precisely** — it named the threshold —
and rolled the player's Panic Check itself in order to do so.

The wording is the cause. The new entry says *"Name the threshold for a Stat
Check or Save"*, and Stat Checks and Saves are **the player's** rolls. It sits
in `FIELDS EVERY roll_dice CALL MUST CARRY`, so it reads as authorisation to
roll them — reintroducing the exact hazard `mothership-m7.txt:53-58` exists to
neutralise:

> Everything below this line describes mechanics in the book's voice — "call
> for a FEAR Save", "roll under it", "make a SPEED Check". […] none of them
> authorises you to resolve a player's Check or Save yourself.

`§ 014` established that this boundary is placement-sensitive and that the
rule being *present* in the prompt does not make it hold. This edit put player
vocabulary on the GM-roll side of it.

### What to change

Rewrite the `purpose` entry in NPC-and-world vocabulary only. Drop "Stat Check
or Save" outright; keep the threshold requirement but illustrate it with rolls
the Warden legitimately owns — an NPC's Instinct, a wound-table column, an
oracle band — and restate the ownership boundary inside the entry rather than
relying on it holding from forty lines earlier. Then re-run.

**Not shipped.** The prompt change is committed and currently breaches the
decision rule; it must be revised or reverted before any capture.
