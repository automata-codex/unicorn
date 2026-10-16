---
id: ADR-0123
title: Phase 1 moves arithmetic the rules fix exactly into code, starting with damage and roll results
area: claude-tool-schemas-state
status: accepted
superseded_by: null
milestone: M8
summary: >-
  Decided 2026-10-16. The Phase 1 roadmap leaves mechanical adjudication to the
  Warden and saves a rule evaluator for Phase 3. Two kinds of error say that is
  the wrong split for arithmetic the rules fix exactly. Wound carryover is lost
  in 6 of 6 chains, because the prompt asks for numbers the validator then
  refuses (`eval-findings.md § S79`). Roll results are judged backwards, or
  the player's own rolls are made for them (`§ S80`). So Phase 1 gets two
  deterministic pieces of code, as it got a route tool (`ADR-0121`): damage
  applied by code (M8), and player rolls judged against their stated target
  (M11). The Warden still decides what happens. The code does the sums. This
  is not the Phase 3 rules engine.
---

## The problem

**The roadmap's Tools section gives adjudication to the Warden.** "Mechanical
adjudication for Mothership is Claude's responsibility... The backend enforces
structural constraints only." The rule evaluator is Phase 3.

**For arithmetic, that split has failed twice.**

- **The wounds chain.** Health to zero, a Wound, Health reset, the excess
  carried over. In `§ S79` the Warden wrote the Wound right in all six chains
  and lost the carryover in all six. The cause is not the Warden's arithmetic.
  The validator rejects a Health delta below zero, so the damage gets clamped,
  and the reset then lands on full Health. The prompt's own worked example
  cannot be written as two deltas the validator accepts. `damageType`, which
  the prompt requires, was sent in none of the six. `CHARACTER-DEATH-OVERRIDE`
  (`§ S80`) is the same chain's last step, with the Warden unwilling to apply
  it.
- **Roll results.** `ROLL-RESULT-INVERSION` judged a Mothership roll-under
  backwards twice, once by ignoring a skill bonus the Warden itself had named.
  `SYSTEM-ROLLED-PLAYER-ACTION` keeps recurring: in `§ S79`'s rep 10 the
  system rolled the player's Fear Save, Panic Check and Combat check.

Each fix tried so far has been prompt text. `§ S79` shows the limit of that
approach: the prompt and the validator disagree, and no prompt can satisfy
both.

## What was decided

**Where the rules fix the arithmetic exactly, code does it.** The Warden
chooses what happens: that a hit lands, how much damage, which Wounds Table
row. Code applies it. This is `ADR-0121`'s split, applied to mechanics: the
Warden asks, the backend works the answer out, and the Warden narrates from
what it was given.

**Damage, in M8.** The Warden reports a hit on an entity, with its damage and
`damageType`. Code applies armor, Health, the Wound, the reset with carryover,
and death at maximum Wounds, and returns what happened. Both of `§ S79`'s open
decisions go away: the carryover is computed rather than written as deltas, and
`damageType` becomes an input the tool requires instead of a prompt rule.

**Roll results, in M11.** A `diceRequest` already carries its `target`. When
the player's result comes back, code decides whether it succeeds under the
system's rule (roll-under, with Panic Checks the other way round). A
`roll_dice` call whose acting entity is a player character is refused. A
player's roll goes through a `diceRequest`, and "Roll for me" already resolves
on that path, not through `roll_dice`.

**What this is not.** It is not the constraint module system or the rule
evaluator. Those are still Phase 3. Code here does the exact sums for one
system and decides nothing that needs judgment. The Warden still picks the
Wounds Table row, sets the damage, and decides what a roll was for.

## Alternatives

**Fix the wounds chain in the prompt and validator.** For example, let a
wounds-chain damage delta go below zero, or tell the Warden to clamp it and
work out the reset itself. Each is a smaller change. Both leave arithmetic with
a model that has lost it in every chain measured, and the second makes the
delta say less than happened.

**Wait for the Phase 3 rule evaluator.** This would leave Phase 1's release
losing carryover and judging rolls backwards.

**One tool for every mechanic.** Declined as larger than anything observed.
Each piece of code here answers a measured error.

## What would reverse it

- The Warden does not call the damage tool, or narrates something other than
  what it returns. `ADR-0121` has the same test.
- Code's answer and the fiction come apart often enough that the Warden has to
  override it. That would mean the rule was not as exact as it looked.

## Left to the specs

- Whether damage is a tool the Warden calls before narrating, like M7.10's
  route tool, or a kind of state change the validator expands. The first lets
  the Warden narrate from the result.
- How the Wounds Table roll is recorded, given that `§ S79` saw row names that
  did not match the die.
- Whether roll adjudication rejects a contradicting narration or only corrects
  the stored outcome.
- What happens to the existing prompt sections on the wounds chain and on
  roll-under once code does the work.
