---
id: ADR-0026
title: State placement is decided by the lifetime of the referent, not the lifetime of the value
area: claude-tool-schemas-state
status: accepted
superseded_by: null
milestone: M7.6
summary: >-
  The placement rule across the three state destinations: does the value change in
  play, and if it does, how long does the thing it describes last. The part worth
  reading is 'reset is a rule, not a lifecycle' — the intuition that spell slots are
  adventure-scoped is exactly what the rule exists to correct. Scopes finer than an
  adventure have no home yet.
---

There are three places a piece of state can live — the character sheet, campaign state,
and adventure state — and until now there was no rule for choosing between them. The
sheet/campaign line was settled once, for HP and current Stress, in
`ADR-0027`. The
campaign/adventure line was never stated at all: `adventures` carries `mode`,
`initiative_order`, `caller_id` and `rolling_summary`, and everything else defaults into
`campaign_state.data` because that is where the blob is.

**The rule**, two axes applied in order:

1. **Does the value change during play?** No → **character sheet**. Name, pronouns, class, the creation rolls as rolled.
2. **For values that do change, how long does the thing they describe last?** Outlives the adventure → **campaign state** (anything attached to a character, a recurring NPC, or the party's ship). Created and destroyed with the adventure → **adventure state** (a derelict's reactor integrity, a synthesized threat's HP, a countdown timer, initiative order, scenario flags).

**Reset is a rule, not a lifecycle.** This is the part that is easy to get wrong, and
getting it wrong is what motivated writing the rule down. D&D 5e spell slots feel
adventure-scoped because 5e adventures conventionally begin after a long rest — but start
a party mid-dungeon with two of four slots spent and the slots plainly carry forward. The
long rest is a *mechanic that writes to campaign state*, not evidence that slots are
adventure-scoped. Ability drain is the cleaner case: a shadow's Strength drain is undone
by greater restoration, a purchase, exactly parallel to Mothership's Psychosurgery. In 5e
essentially nothing character-attached is adventure state — not slots, hit dice,
exhaustion, attunement, or prepared spells.

Making campaign the default and adventure the exception has a useful property: a system
with no reset mechanic needs no special handling, and a system with one implements the
reset as a state change rather than as a storage boundary.

**Mothership under the rule, which is not where the intuition points.** All *character*
state is campaign state — Mothership has no factory reset of any kind. Damage to Stats
and Saves is undone only by paid medical treatment; Maximum Health and Maximum Wounds
decrease monotonically with no recovery path in the Player's Survival Guide at all
(§29.2 Death table `00`; Panic `19`). But all *scenario* state — synthesized NPC and
threat pools, flags, `worldFacts`, `scenarioState` — is adventure-scoped by the rule, and
all of it lives in `campaign_state.data` today, in flat maps with no adventure
discriminator.

**A cross-check that agrees with the rule.** The writer already correlates with the
scope. Character creation writes campaign-scoped player pools
(`ADR-0036`);
synthesis writes NPC, threat, and timer pools. If synthesis wrote it, it is adventure
state.

**Known limit, recorded rather than pre-solved.** Some systems scope finer than an
adventure. Infinity 2d20's Momentum is a shared party pool that resets between *scenes*;
Feng Shui 2's Fortune resets per session while Marks of Death are permanent. The referent
rule still holds — Momentum's referent is the scene — but the three-destination model has
no home for it. Revisit at Phase 3–4 when those systems land, not before.

Roadmap: `docs/roadmap.md § M7.6 — Character Sheet Fidelity`.
