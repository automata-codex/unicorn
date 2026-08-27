---
id: ADR-0105
title: '`judgeContext` output is covered by a golden, not a hash'
area: eval-harness
status: accepted
superseded_by: null
milestone: M7.8
summary: >-
  `judgeContext` output is the one judge-visible surface no identity covers, which
  lets `eval:compare` issue a false like-for-like license in silence. Covered by a
  committed golden rather than a hash, with the argument for why hashing the output is
  the wrong instrument and a corollary on renderers selecting from the fixture rather
  than authoring content.
---

**Four surfaces reach the judge and three of them have a recorded identity.** `runJudgeCall`
assembles the rubric text (template plus `assertion.facts` interpolated), the winning
`gm_response`'s `playerText`, a JSON dump of this turn's `gameEvents`, an optional
`--- Scope of this check ---` block produced by the check's `judgeContext`, and the closing
instruction. Of those, `rubricHashFor(checkId)` hashes `rubric.template` — the
uninterpolated template alone; `corpusVersion` covers `assertion.facts`, since it is a field
inside the fixture file; `serializeJudgeContract` covers the model, the system prompt, the
closing instruction and the verdict tool; and narration and event summary are derived from
the run itself. **`judgeContext` output is covered by nothing.**

**The consequence is that two runs can carry identical identities on every axis while the
judge read materially different material.** `judgeContext` is
`(result: TurnExecutionResult, fixture: EvalFixture) => string` — it receives the fixture and
can render anything it likes into the prompt, including seeded state the judge otherwise
never sees. Editing that function changes what the grader reads and moves `rubricHash`,
`judgeContractHash` and `corpusVersion` not at all. This is the shape `ADR-0099`'s addendum
exists to prevent — a Warden-visible or judge-visible surface built by code and carrying no
identity — reproduced inside the machinery built to prevent it.

**The severity is not "a missing test."** `eval:compare` treats matching identity hashes as
license to compare two runs, and reports a *missing* hash as unknown rather than as a match
precisely so that license is not issued on absent evidence. A surface that is present, that
varies, and that no hash covers means the license can be issued falsely: the comparison
reports like-for-like and is not. Every other gap in the hash coverage produces a warning;
this one produces silence.

**Pre-existing rather than introduced.** `unauditableMappingJudgeContext` has sat in this
gap since `UNAUDITABLE-MAPPING` shipped. It surfaced now because
`SEEDED-CANON-CONTRADICTION` (`ADR-0104`, drafted 2026-08-25) is definitionally a comparison
against seeded state, the judge cannot see seeded state, and `judgeContext` is therefore the
only available injection point — which made the gap load-bearing for a new check rather than
latent in an old one.

**Partially mitigated already, in one direction only.** The rendered output is recorded
per-run in the artifacts (`eval/runs/artifacts.ts:144-150`), so a reader of a given run can
see exactly what was injected. That makes any single run **auditable**. It does not make two
runs **comparable**, because nothing surfaces a difference between them without a manual
read of both artifact sets — and comparability is the property `eval:compare` exists to
assert.

**Decision: a committed golden on the renderer, and no hash over its output.**

Same instrument as `assemblyHash`'s three committed `.txt` goldens: a frozen input rendered
through the real function, the result committed, and a refactor producing identical text
moving nothing while a one-word edit fails a golden by name. Verified by mutation rather
than by argument.

**Hashing the output is the obvious move and it is wrong.** `judgeContext` output varies per
fixture and per run by construction — it is a function of both. A hash over it would move
whenever the corpus or the run moved, which is what `corpusVersion` and the run identity
already express, and it would therefore not be a stable contract identity in the way
`rubricHash` and `judgeContractHash` are. Those hash a *contract*: a thing that is fixed
across fixtures and changes only when someone changes it. The renderer is the contract here;
its output is not. What needs coverage is the renderer's behaviour, and a golden covers
behaviour where a hash would only re-express variability that is already labelled.

**Where the injected data should come from, as a corollary.** Data rendered from
`fixture.seededState` falls under `corpusVersion`, because the fixture file is hashed. Data
constructed inside the renderer does not fall under anything. So a `judgeContext` that
*selects* from the fixture leaves only the selection logic uncovered, while one that
*authors* content leaves the content uncovered too. Prefer selection, which is also what the
field's own doc comment endorses — *"One implementation selects; the judge grades what it
hands over."*

**Alternatives considered.**

- **Hash the rendered output.** Rejected above: not a contract identity, and re-expresses
  variability already carried by `corpusVersion` and the run identity.
- **Fold `judgeContext` into the rubric template.** Would inherit `rubricHash` coverage for
  free, and is impossible: the template is static text and the whole purpose of
  `judgeContext` is to render per-fixture data into the prompt.
- **Move the injected values into `assertion.facts`.** Would inherit `corpusVersion`
  coverage, and is rejected on a cost that falls elsewhere: `assertion.facts` lives inside
  the fixture file, so pinning a check's ground truth there commits every fixture carrying
  that tag to the current rubric's fact set, and any later revision changing that set costs
  a `corpusVersion` bump on all of them. Recorded at length in `ADR-0104`, where the
  `requiredFacts: []` decision for `SEEDED-CANON-CONTRADICTION` turns on exactly this.
- **Leave it and rely on the artifacts.** Rejected: auditability after the fact is not
  comparability, and the failure this gap produces is a silent false match rather than a
  missing record.

**Scope.** Two goldens are owed — one for the new `SEEDED-CANON-CONTRADICTION` renderer,
landing with its capture work in M7.7 because it is a prerequisite for using the mechanism
honestly there, and one for `unauditableMappingJudgeContext`, which is this entry's own work
in M7.8. Any future check adding a `judgeContext` adds a golden with it. Whether that is
enforceable by construction — the way `structuralCheckers` is typed
`Record<StructuralTag, ...>` so a missing checker is a compile error rather than a silent
`undefined` — is an open question worth answering while the goldens are being written, since
a convention that depends on remembering is the same class of thing this entry is
correcting.

**Incidental, found in the same read.** The comment in `fixture.schema.ts` stating that the
stub refusal *"is currently in force for the whole corpus"* is stale: `STUB_CHECK_IDS` has
been empty since 2026-08-20 and `assertNoStubCheckers` no longer blocks a full run. Correct
at the source rather than patching around it.
