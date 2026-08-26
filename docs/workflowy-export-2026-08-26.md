# Todo export — Workflowy paste

Extracted from `docs/roadmap.md` on 2026-08-26, when the roadmap was refactored back
to an inventory of scope and a sequence of delivery milestones. These are the
task-granularity items it used to carry. Status now lives here, not there.

Grouped by milestone. Blockers name another item's Title, or an external event.

---

## M7.4 — Warden Eval Harness

- Close the fixture-count bar
  - Blockers
    - Run the second steered playtest
    - Author fixtures from the second playtest capture
  - Summary
    - Four failure-mode tags still sit at a single confirmed instance and need a second before the category counts as covered.
  - Details
    - 15 fixtures cover all 9 tags; MISSING-CANON-CAPTURE, UNSURFACED-CHECK, OVER-RESOLUTION and SCENE-JUMP each have one instance
    - The spec flagged the first three as needing a second confirmed instance; SCENE-JUMP was added later and inherits the same bar
    - Blocked on playtest evidence, not on code

---

## M7.7 — Playtest and Fixture Capture

- Run the second steered playtest
  - Blockers
    - Re-baseline after the roll_dice.purpose prompt change
  - Summary
    - A steered rather than natural session, captured across its whole length, run against the final index.
  - Details
    - Targets, watch-fors and capture discipline are in docs/playtest-scenarios.md
    - Steered because an undirected repeat reproduces the corpus's existing bias — the first playtest returned zero instances of the four tags blocking M7.4's bar
    - Runs post-018, so the capture carries skills, equipment, crewRole, instinctRoll and rollModifiers — the corpus's largest coverage hole
    - Highest-value single turn is a wounds chain; HP to zero closes three items at once
    - The first playtest's yield was capped by the tool-syntax leak, now guarded inside the tool loop before persistence
    - Budget a re-baseline: new fixtures move the rollup denominators, so per-tag movement needs like-for-like-on-shared-fixtures treatment

- Re-baseline after the roll_dice.purpose prompt change
  - Summary
    - Plan 021's prompt change is Warden-visible and input-affecting, so it needs a fresh run before any capture freezes rolls against the old prompt.
  - Details
    - promptHash 6717347d to 995083c8, assemblyHash 6dc28608 to dc5fa663
    - One re-baseline covers plan 021 and the 2026-08-23 corpus bump together
    - Read applicability first as the falsifier: a rate that rises while applicability collapses means the Warden stopped making spontaneous rolls rather than started explaining them

- Author fixtures from the second playtest capture
  - Blockers
    - Run the second steered playtest
  - Summary
    - Turn the capture into fixtures, answering rather than deleting the applicability stubs capture-fixture writes.
  - Details
    - Every capture writes a fail-closed applicability entry per check the fixture could carry — its own tag plus every tag-independent check
    - applies: false with a real reason surfaces in the report's fixture-gated-never-applies finding; a deleted entry is visible nowhere
    - Sanity-check before authoring: one entity id per character, one resource-pool prefix per entity, gmContextBlob.playerEntityIds populated

- Register SEEDED-CANON-CONTRADICTION and capture turns 8, 14 and 29
  - Summary
    - Three turns of the 2026-08-24 playtest failed to recall which deck a named place is on, contradicting worldFacts.ship_layout.
  - Details
    - ADR-0104 carries the split, the causal ordering and the rejected alternatives
    - Fixture candidates all pre-clobber and clean: turns 8 and 14 fail-direction, turn 29 pass-direction; turn 18 is a further fail-direction candidate
    - Turn 24 is a third subtype — Petrov placed two decks from the engine room against worldFacts.crew_roster, which puts him in it
    - Turn 1 is the timeline subtype and is held pending whether a turn emitting no tool call is applicable to a canon-adjacent check
    - Author the rubric with requiredFacts: [] and inject seeded worldFacts through judgeContext from fixture.seededState
    - A committed golden on the judgeContext renderer is part of this, not optional
    - Capture ids take the 2c0ba938- prefix
    - SPATIAL-RELATION-ERROR stays deferred and unregistered — see ADR-0104's addendum

- Register UNREVERSED-RETCON and capture turn 21
  - Summary
    - When a turn reverses an outcome an earlier turn narrated, state the earlier turn committed is not reversed with it.
  - Details
    - Turn 20 adjudicated a Computers check as a failure against an unmodified Intellect 40; turn 21 reversed the narration and left the committed state standing
    - Prefer a structural check; a judged version needs the prior value injected via judgeContext, in which case ADR-0105's golden requirement applies

- Widen UNAUDITABLE-MAPPING coverage
  - Blockers
    - Re-baseline after the roll_dice.purpose prompt change
  - Summary
    - One fixture carries the whole tag; four of five return "no dice_roll events this turn", so the denominator is a single fixture.
  - Details
    - Sequenced after the prompt fix: widening before the field exists buys more fixtures measuring the same unrecordable thing
    - Three pass candidates from the 2026-08-24 session (turns 25, 45, 51) take the tag from five fixtures to eight
    - Those three will move both the rate and applicability for reasons unrelated to Warden behaviour — the bump note must say so, or M7.7 reads as an improvement it did not earn
    - Diagnostic is in rules-extraction-findings.md S36: all ten rationales converge, so there is no rubric ambiguity

- Fix MISSING-CANON-CAPTURE's ungradeable fixture
  - Summary
    - 0/10 applicability for three consecutive runs, excluded every time because the marker phrase the fixture waits for never appears in the narration.
  - Details
    - The fixture is gated on the Warden volunteering a specific phrase — RESTRICTED, VERIDIAN INTERNAL
    - Re-author against something the turn actually produces, or replace it from the new capture

- Capture a wounds chain
  - Blockers
    - Run the second steered playtest
  - Summary
    - Nothing in the corpus drives HP to zero, so spec 018 Part 7 shipped untested.
  - Details
    - The tool schema now enumerates the eleven pool names and disambiguates delta from maxDelta for taking a Wound
    - CARRYOVER-ARITHMETIC and UNEXPLAINED-DELTA are registered and unit-tested but no fixture carries either tag — third run running
    - One captured turn running the full chain closes all three at once
    - The Wounds Table is also a near-ideal M7.8 known-answer fixture

- Capture a Contractor with a crew role acting
  - Blockers
    - Run the second steered playtest
  - Summary
    - No fixture carries crewRole or instinctRoll, so ADR-0100 is shipped and unmeasured.
  - Details
    - Every existing capture predates the fields
    - One fixture with a Contractor holding a role exercises the Instinct derivation, the role-mapped skill chain and the entities render together

- Restructure worldFacts.ship_layout into a deck-indexed list
  - Summary
    - A single ~700-character prose run carrying roughly fifteen spatial facts, with no deck list and no adjacency, renders verbatim in all 52 snapshots.
  - Details
    - Decide whether it lands before or after the first SEEDED-CANON-CONTRADICTION measurement — before it, and the measurement grades the new shape rather than establishing a baseline for it

- Write the synthesis provenance spec
  - Blockers
    - Run the second steered playtest
  - Summary
    - Where the synthesis prompt should live, and what identity it carries. Sequenced after spec 020 and after the playtest.
  - Details
    - Distinct from the synthesis goldens, which are mechanical and already landed
    - A synthesisHash is still declined and the reasoning is unchanged: nothing would read it

- Widen the turn19/turn21 out-of-order-resolution corpus decision
  - Summary
    - The same argument that added system-rolled-player-action to the turn24 fixtures applies to turn19 and turn21, and was deliberately left open.
  - Details
    - S34 named those two as carrying four of the baseline's ten occurrences
    - A corpus decision of its own, on the same evidence

- Lint and format eval/ and scripts/
  - Summary
    - Neither directory is linted or formatted by anything, and together they are larger than src/.
  - Details
    - npm run lint is biome check src/ test/ && eslint "{src,apps,libs,test}/**/*.ts", run from apps/zoltar-be
    - So biome sees src/ and test/, eslint sees the same, and eval/ and scripts/ are seen by neither

---

## M7.8 — Harness Meta-Eval

- Author known-answer fixture pairs per structural checker
  - Summary
    - One fixture engineered to pass and one to fail per structural checker, asserted against the checker's verdict.
  - Details
    - The pass direction is the new half; M7.4's closed item covers the fail direction

- Cover the applicability gate as its own axis
  - Summary
    - A fixture per fixture / artifact / ungated path, asserting not_applicable is returned where it should be and not returned where it shouldn't.
  - Details
    - The M7.4 artifact-gating defect is the motivating case

- Add a regression case per known harness defect
  - Summary
    - Each defect found by hand once becomes a permanent assertion.
  - Details
    - The damage-only pattern matcher, the commitment-language false fails, the ambient-roll classifier blind spot, the spurious rubric-hash warning

- Author the Wounds Table known-answer fixture
  - Blockers
    - Capture a wounds chain
  - Summary
    - A deterministic table with an unambiguous correct row per damage type and 1d10 result, both of which live in event structure.
  - Details
    - Structural rather than judge-graded
    - CARRYOVER-ARITHMETIC does the adjacent half and demonstrates the shape; what it cannot do is verify the row
    - The table is TKG content and does not ship, so the expected row must be supplied by the fixture author rather than by the repo

- Put judgeContext output behind a golden
  - Summary
    - The judge sees rubric text, playerText, a dump of the turn's gameEvents and an optional scope block, and no hash covers the renderer that assembles them.
  - Details
    - ADR-0105 records the decision — a golden, not a hash — and the implementation is this milestone's
    - Injected data falls under corpusVersion because it is fixture-derived; the renderer falls under nothing

- Widen the judge field-order study to the other six judged checks
  - Summary
    - Spec 020 measured the rationale-before-passed swap on three checks; six more were never measured.
  - Details
    - Here rather than in the spec that produced it because it is characterization of the harness, not a change to it

- Record the "pinned at 1.00" reframe
  - Summary
    - The heuristic moves from primary trust mechanism to coverage-gap detector for failure modes no known-answer fixture was authored against.
  - Details
    - The Haiku control arm's justification narrows the same way
    - ADR-0082 already describes retirement as per-check as coverage arrives; this is the reframe that closes it
    - Contingent on this milestone's fixtures actually shipping — do not record it before then

- Re-examine why the judge is excluded from known-answer testing
  - Summary
    - The stated reason is insufficient, and planning against it unamended would be planning against a blind spot.
  - Details
    - The exclusion rests on prose classification being irreducibly probabilistic and needing eval:judge-variance
    - But rationale-versus-verdict disagreement is checkable without a known answer, by reading one artifact against itself, which puts it inside this milestone's remit

---

## M8 — Multiplayer Foundation

- Audit the turn-path locks
  - Summary
    - applyTurnAtomic serializes concurrent turns incidentally rather than deliberately, and the ordering is safe by accident.
  - Details
    - writeCampaignState runs first and takes a row lock on campaign_state, keyed by campaign, before writeAdventureState
    - Is campaign_state.data genuinely campaign-scoped? If yes the coarse lock is load-bearing and write order must be pinned by convention
    - Confirm where the read-validate-write cycle is locked; decisions.md states the advisory lock must span the full cycle, and the transaction opens at write time only
    - Every path currently takes campaign_state then adventure; the diceResult transaction takes only the adventure lock. Record the ordering as a convention
    - Referenced from docs/decisions.md — keep that citation resolvable

- Run the multi-PC caller model playtest
  - Blockers
    - Caller role enforcement, transfer, and initiative shipped
  - Summary
    - The corpus has no coverage for caller transfer or initiative sequencing at all; these are new failure surfaces.
  - Details
    - Do not combine with mechanical coverage playtests
    - Author fixtures for whatever caller and initiative failure modes it surfaces

---

## M9 — Self-Hosted Deployment

- Enforce the identifier format rule
  - Summary
    - ADR-0032 states the rule and no code applies it anywhere.
  - Details
    - grep finds only comments citing the entry, at session.service.ts:962 and nearby
    - Enforcement touches entity creation, resource-pool naming, and the synthesis write path

- Enforce one adventure per campaign
  - Summary
    - Backend rejection on adventure creation when the campaign already has any adventure, including completed and failed, plus the UI gate.
  - Details
    - Placed in M9 rather than M7.6 because it is a backend guard touching no sheet, no render and no snapshot
    - Until it lands, "one adventure per campaign" is a playtest capture convention — see docs/playtest-scenarios.md

- Size and run the documentation reorganization
  - Summary
    - Scope is not yet established, and sizing it is the first task rather than an afterthought.
  - Details
    - The setup guide's location and the audience split depend on what it settles
    - The 2026-08-26 roadmap refactor and the docs/human split are down payments on this

- Consolidate the Flyway migrations
  - Summary
    - Squash the accumulated Phase 1 migrations into a clean baseline, immediately before the tag and after the last schema change lands.
  - Details
    - Until v0.1.0 the migration history has no external consumers, so this is free; after the tag it is not
    - Must be after the last schema change, or it has to be done twice

- Author the release checklist
  - Summary
    - Release discipline that recurs every release, currently sitting in M9 as if it were milestone scope.
  - Details
    - Full-corpus eval run before tagging, compared against the M7.5 re-baseline
    - Setup guide current, env-var docs current, signup mode documented
    - Move the eval-run item off the roadmap once this exists
