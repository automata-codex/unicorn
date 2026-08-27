---
id: ADR-0096
title: A check may be attached to a fixture whose `tag` it is not, via fixture-authored `applicability`
area: eval-harness
status: accepted
superseded_by: null
milestone: M7.7
summary: >-
  Selection by `tag` alone meant a check was measured only on fixtures named after it
  — which let `SYSTEM-ROLLED-PLAYER-ACTION` read 1.00 while six violations sat on
  `turn24-*` fixtures. Adds tag-independent attachment through fixture-authored
  `applicability`, and explains why `tagIndependent` is hand-declared rather than
  derived from `applicabilitySource`.
---

`selectChecksForFixture` returned exactly the check whose id matched the fixture's `tag`, so a check was measured only on fixtures named after it. `ADR-0073` had already made applicability fixture-authored and keyed by `checkId`, and the schema comment already said a fixture "can in principle carry more than one check" — but nothing consumed that, and the corpus stayed 1:1 by construction rather than by choice.

The cost is recorded in `docs/rules-extraction-findings.md § S34`: the `c45a142a` re-baseline accepted `SYSTEM-ROLLED-PLAYER-ACTION` at 1.00 (20/20) while the same run's artifacts contain six turns where the Warden resolved the player's declared action system-side. Every one of them landed on a `turn24-*` fixture, which the check was not pointed at. **A tag rate is a claim about the fixtures carrying that check, and selection-by-tag made "which fixtures carry it" a consequence of what each fixture was named at capture time.** A fixture's `tag` records the failure mode it was captured to *reproduce*; it says nothing about which other failure modes its turn is capable of provoking.

So selection is now the tag's check plus every **tag-independent** check the fixture authors an `applicability` entry for, and the three `turn24-*` fixtures carry `system-rolled-player-action` that way. Attaching a check stays a fixture-authoring act — the author states the scenario calls for it and names the player entity — which keeps `ADR-0073`'s rule intact: applicability is still declared before the model runs, never inferred from what it produced. `capture-fixture` writes a fail-closed stub for every tag-independent check into each new fixture, not just for the fixture's own tag, so the authoring act is prompted rather than remembered — a check that reaches fixtures only through authored entries is one omission away from the hole this entry closes.

**`tagIndependent` is hand-declared on the check, not derived.** The load-bearing property is what the checker *reads*, which is a fact about checker code and derivable from nothing on the registry entry. `system-rolled-player-action` qualifies because `ADR-0073` already re-gated it purely onto `applicability[checkId]`; it reads no `assertion` at all. Every other check does: a judged check grades against `assertion.facts` (`perceptionBoundary`, `expectedScope`, ...), and `missing-canon-capture` parses `assertion.check` prose. Those exist only for the fixture's own tag, so attaching one to a foreign fixture would grade one question against another question's boundary text. The registry throws at build time if a judged check is ever listed, and `selectChecksForFixture` throws on an `applicability` key naming an unregistered or non-tag-independent check — silently skipping it would mean a fixture edit made to close a coverage hole opens no rows and reports nothing, which is the same failure shape as the hole.

Deliberately **not** derived from `applicabilitySource === 'fixture'`, which the two values coincide with today. They answer different questions — where a check's `not_applicable` verdicts come from, versus whether it reads the fixture's assertion — and `out-of-order-resolution` separates them: it is `'artifact'` because it has an artifact-dependent branch, yet it reads no assertion and would be portable on the merits. Whether it should be attached to more fixtures is a corpus decision, and is not made here.

**Three alternatives, and each is smaller on the page than in the corpus.**

**Retagging the three `turn24-*` fixtures is not available at all.** It is the first thing to reach for, and the file stops loading: `tag` holds a single value, and `evalFixtureSchema`'s refine ties `assertion.mode` to it, so `SYSTEM-ROLLED-PLAYER-ACTION` on a fixture carrying a judged assertion fails validation outright. Making it parse means replacing that assertion with a structural one — discarding the `SCENE-JUMP` / `OVER-RESOLUTION` / `HIDDEN-INFO-LEAK` coverage the fixtures were captured for. One hole closed by opening three.

**Capturing three new `turn24-system-rolled-player-action` fixtures** reaches the same coverage at three times the Warden spend per rep — the existing `turn24-*` trio already replays one captured turn, and a fourth copy of it would run on every rep of every future run — for files whose `seededState` is byte-identical to fixtures already on disk. It also leaves the underlying rule, a check is measured where its name appears, in place to be paid for again by the next check. And it saves less than it appears to: `system-rolled-player-action` calls `requireApplicability` and declares `requiresFixtureSchema: 2`, so a new fixture would need the same `applicability` block, naming the same `playerEntity`, that the existing three now carry. **The fixture-side work is common to both routes; the registry change is the whole of the difference between them.**

**Selecting every check a fixture names in `applicability`, with no `tagIndependent` flag at all**, is about ten lines and works against today's corpus. Rejected on one case: `missing-canon-capture` guards its `assertion.check` read with a runtime `throw` on non-structural mode, so attaching it to a judged fixture type-checks, builds, and fails at eval time as one `error` row per rep — naming the checker, never the fixture that misdeclared it. The flag and its throws turn that into a single message at selection time carrying the fixture id, the tag, and the fix. `ADR-0046`, `ADR-0073` and `§ S30` are three tellings of one story — a check that cannot resolve its subject reporting something other than undecided — and the guard is priced against that history, not against the ten lines it replaces.
