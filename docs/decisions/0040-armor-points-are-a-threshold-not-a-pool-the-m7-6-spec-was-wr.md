---
id: ADR-0040
title: Armor Points are a threshold, not a pool — the M7.6 spec was wrong about this
area: claude-tool-schemas-state
status: accepted
superseded_by: null
milestone: M7.6
summary: null
---

**Found during implementation, 2026-08-15.** The M7.6 spec §1.3 and the
reconciled diff §5 both state that "AP is consumed", and the implementation plan
builds `armor_damage` around AP being ground down hit by hit.

That is not the rule. `docs/rules-extraction-findings.md § S25.6`, recorded from
reading PSG p.28 directly, states it plainly: a character ignores all Damage
**less than** their AP, a single hit at or above AP destroys the armor and the
remainder lands, and **armor is never worn down across several hits.** That
finding is what corrected the Warden primer in M7.5, and the live prompt has
said so since.

The primary-source reading beats a derived spec line, so the built behaviour
follows the finding: `armor_damage` keeps the plan's `{ apDelta, destroyed }`
shape, but `destroyed` is `literal(true)` and the validator rejects an `apDelta`
that leaves AP above zero, naming the rule in the rejection. A hit below AP is
not a state change at all and must not be sent.

**Damage Reduction is the opposite in kind and is a separate field for exactly
this reason:** it applies first, and survives both armor destruction and
Anti-Armor. A single number could not express "the armor is gone but the
reduction is not", which is why `wornArmor` carries `dr` alongside `apCurrent`
and why `<character_attributes>` renders DR even at zero.

Recorded here because a reader hitting the spec first will find the opposite
claim, and because "subtract armor from each hit" is named in the S25.6 finding
as the error a Warden defaults to — the code should not make the same one.
