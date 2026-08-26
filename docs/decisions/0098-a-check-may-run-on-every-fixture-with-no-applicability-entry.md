---
id: ADR-0098
title: A check may run on every fixture, with no applicability entry to author
area: eval-harness
status: accepted
superseded_by: null
milestone: M7.7
summary: null
---

`ADR-0096` opened selection beyond the fixture's own `tag`, but kept every attachment an authoring act: a tag-independent check reaches a fixture only through an `applicability` entry someone wrote. That is right for the check it was built for and wrong for `tool-syntax-leak`, which grades whether the narration the player was shown contains raw tool-call markup. So selection is now the tag's check, plus tag-independent checks the fixture authors an entry for, plus every **universal** check unconditionally.

The distinction is whether the check's subject is conditional. `system-rolled-player-action` is portable across tags but still scenario-conditional — it means nothing where the scenario has the player declare no action — so an author states that it applies and names the player entity. A universal check has no precondition to state: every turn has narration, and that narration either contains tool-call markup or it does not. There is no fixture for which the question is not asked, and no answer an author could supply that the turn output does not already contain.

**Routing it through `applicability` anyway was the obvious move, and it fails three ways.** `applicabilityEntrySchema`'s `applies: true` branch requires `playerEntity` — a field a check about narration has no use for and would have to fabricate, in the one place the corpus records who the player is. `capture-fixture` stubs every attachable check **fail-closed** (`applies: false`), which is correct for a conditional check and exactly inverted for one that should always run: every new capture would arrive with it switched off, and `ADR-0096`'s own closing observation — that a check reaching fixtures only through authored entries is one omission away from the hole it closed — becomes a certainty rather than a risk. And an `applies: false` entry would let a single fixture opt out of a correctness check that has no scenario-shaped reason to be opted out of, which is not a knob the corpus should have.

So `capture-fixture` deliberately does **not** stub universal checks, and `selectChecksForFixture` throws on an `applicability` key naming one. A silently-ignored entry is the worse failure here than in `ADR-0096`'s case: an author who wrote `applies: false` would believe they had opted out, and would be wrong in the direction that hides a defect.

**What this costs: a universal check cannot be scoped to part of the corpus.** That is the intended trade rather than a limitation worked around. A leak rate is a claim about every turn the Warden takes, and a corpus-scoped denominator would understate it precisely where coverage was never authored — the same shape of error as `§ S34`, arriving through a different door. A check that genuinely needs scoping is evidence that it is conditional, which means it is tag-independent and belongs in the other list.

**Universal and tag-independent are alternatives, not a spectrum, and the registry enforces that.** Listing an id in both throws at build time, as does listing a judged check as universal — a judge call grades against `assertion.facts`, which exists only for the fixture's own tag, so "runs on every fixture" and "grades against this fixture's assertion" cannot both hold. The guards are priced the same way `ADR-0096`'s are: the failure they prevent is a check reporting nothing while appearing to be registered.

**Read `tool-syntax-leak`'s rate with its applicability, as always, but expect the two to be near-identical.** It declares `applicabilitySource: 'artifact'` rather than `'ungated'` under the weakest-link rule `out-of-order-resolution` established, because one branch reports `not_applicable`: a turn that produced no `gm_response` at all, which is the `diceResult`-without-auto-advance path. The selection hazard that label warns about is weak here — that branch means the turn did not happen, not that the Warden chose something — but `'ungated'` would assert a `not_applicable` is impossible, and it is not.

**The check grades the same detector the turn path enforces** (`src/session/session.tool-syntax.ts`, `ADR-0097`), imported rather than reimplemented. A checker with its own copy of the token set would drift from the guard, and both directions of drift are bad: the harness reporting clean while production rejects, or the harness failing runs that production would accept, which reads as a Warden regression when it is a harness disagreement.
