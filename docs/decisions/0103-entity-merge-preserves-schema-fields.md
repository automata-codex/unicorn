---
id: ADR-0103
title: Entity merge preserves all schema fields rather than a hand-enumerated set
area: claude-tool-schemas-state
status: accepted
superseded_by: null
milestone: M7.7
summary: null
---

## Context

`session.validator.ts:861-882` builds the merged entity record for every
`stateChanges.entities` write. The merged object is a fresh literal with a closed,
hand-enumerated field list:

```ts
const merged: {
  visible: boolean;
  revealed: boolean;
  status: EntityStatus;
  npcState?: string;
} = {
  visible: change.visible ?? existing.visible,
  revealed: change.revealed ?? existing.revealed,
  status: proposedStatus ?? existing.status,
};

const nextNpcState = change.npcState ?? existing.npcState;
if (nextNpcState !== undefined) merged.npcState = nextNpcState;

result.applied.entities[entityId] = merged;
```

The merge-from-prior-state logic is present and correct — each field reads
`change ?? existing` — but it operates only on the four fields the literal names.
Any other field on the entity record is absent from `merged` and is therefore
absent from `applied.entities`, and the TypeScript annotation declares those fields
out of existence rather than surfacing their omission.

`ADR-0100` (shipped 2026-08-21 as 018 Parts 9–10) introduced the first entity fields
that only synthesis writes and the Warden never proposes: `crewRole` and
`instinctRoll`. These are *authored-only* fields — the play loop has no path to set
them and no reason to, so they never appear in a `change` object and were never added
to the literal.

The consequence is that **any `entities` write naming an entity destroys every field
on that entity outside the enumerated four**, permanently, with no error and no log
entry.

### Evidence

Observed in adventure `2c0ba938-ea80-4138-a95a-dc13e417bf2b` (playtest 2026-08-24,
52 turns). `mara_odinsen` was authored at synthesis with
`{crewRole: "cargo_handler", instinctRoll: [5,5]}`. Both fields rendered correctly to
the Warden through turn 18 — the `<entities>` block showed `instinct 40, role
cargo_handler, skills Zero-G trained (+10), Athletics trained (+10)`, and both numbers
reconcile against `crew-roles.ts`.

The adventure contains exactly four entity writes: seq 30, 66, 99, 122. Seq 99
(turn 31) names `mara_odinsen` with an empty delta; the record emerges as
`{status, visible, revealed}` and both authored fields are gone. Turns 32–52 ran with a
statless Mara.

Seq 122 (turn 38) is the decisive case. The Warden proposed a *partial* delta —
`npcState` only — and the validator emitted the same four fields. Had a guard rejected
the empty delta at seq 99, the authored fields would have survived seven further turns
and been destroyed at seq 122 instead. The defect is not specific to empty deltas.

Independent confirmation without reference to the code: `crewRole` and `instinctRoll`
appear in **zero rows** of the adventure's `game_event` log — not in any proposal, not
in any applied payload. The output shape cannot carry them.

### The applier is not the cause

The loss was initially attributed to `session.applier.ts:47`
(`entities: { ...prior, ...applied.entities }`) and its documented replace-outright
semantics. That attribution is wrong. The fields are absent from `applied.entities`
before the applier runs; line 47 delivers faithfully what the validator produced. The
rationale at `session.applier.ts:37-42` — that array-valued operations cannot be
diffed without re-deriving the fold — stands and is not revisited here.

### This is the second instance of the same defect

`npcState` was added to the merge literal in M7.6 for this exact reason, and carries a
comment recording it as "schema-defined, commented and preserved on merge since M7.6."
The class has bitten before and was closed one field at a time. Under the standing
principle of deferring generalization until a second concrete case justifies it, the
second case has now occurred.

## Decision

The merged entity record is seeded from the prior record, overlaid with the validated
fields, and parsed through `EntitySchema` before being written to
`result.applied.entities`.

```ts
const merged = EntitySchema.parse({
  ...existing,
  visible: change.visible ?? existing.visible,
  revealed: change.revealed ?? existing.revealed,
  status: proposedStatus ?? existing.status,
  ...(nextNpcState !== undefined ? { npcState: nextNpcState } : {}),
});
```

Preservation becomes the default. A field added to `EntitySchema` survives entity
writes without anyone remembering this call site. The `EntitySchema.parse` is
load-bearing and not decoration: spreading `existing` alone would also preserve fields
that have been *removed* from the schema, indefinitely and invisibly. Parsing converts
that into a validation failure at the write, which is the same reasoning that types
`structuralCheckers` as `Record<StructuralTag, ...>` so a missing entry is a
compile-time error rather than a silent runtime `undefined`.

The fix is forward-only. Records already stripped are not restored by it.

## Alternatives considered

**Reject or ignore empty entity deltas.** The narrow fix, and the one the initial
applier-centric diagnosis suggested. Rejected on evidence: seq 122 demonstrates that a
partial delta destroys the same fields, so the guard relocates the bug rather than
closing it. Would have moved the observed loss from turn 31 to turn 38 and left the
class live.

**Add `crewRole` and `instinctRoll` to the merge literal.** Matches existing style and
is the same patch `npcState` received in M7.6. Rejected because it is the third
application of a one-field-at-a-time remedy to a defect whose shape is now clear, and
it leaves every future `EntitySchema` field a live landmine until someone recalls this
literal exists. The M7.6 precedent is the argument against repeating it, not for.

**Deep-merge in the applier.** Rejected on two grounds: it addresses the wrong file,
and `session.applier.ts:37-42` gives a sound reason why generic deep merge is unsafe
for array-valued operations.

## Consequences

**Warden-visible.** Preserved fields render into the `<entities>` block, so the fix
changes the Warden's input. Under the alpha code-freeze rule it is a cohort boundary
requiring explicit tagging, and it is an input-affecting change for eval purposes —
it belongs in the same re-baseline batch as any fixtures captured alongside it.

**Regression coverage must span both shapes.** A test asserting only the empty-delta
case would pass against the rejected narrow fix. Cover: empty delta preserves authored
fields; partial delta preserves authored fields; complete delta still overwrites the
validated four. Seq 99 and seq 122 supply concrete inputs and expected outputs for the
first two.

**Not an eval fixture.** The turn 31 / turn 32 pair is deterministic — fixed input,
fixed expected output, no Warden in the loop — and belongs in unit tests beside the
fix. Placing it in the eval corpus would spend Warden budget re-proving what a unit
test asserts for free.

**Replay is affected.** `reconstructStateAsOfTurn` folds `state_update` payloads
through `applyValidatedTurn`, so the validator sits in the capture path as well as the
harness path. Fixtures captured from folds that cross an entity write may resolve
differently before and after the fix. See open item 1.

## Open items

1. **Fix-invariance of the pending captures has not been established.** Clean capture
   candidates from the 2026-08-24 playtest (turns 19, 29, the 1/8/9/14 geography
   sequence, and the 20/21 retcon pair) fold at most seq 30 and seq 66, both writes to
   `falsified_maintenance_logs`. That entity carries neither `crewRole` nor
   `instinctRoll`, so those two fields are not at stake. But the relocated diagnosis
   puts *every* non-enumerated `EntitySchema` field at stake, not just those two, so
   invariance now depends on the full schema field list rather than on `ADR-0100`'s
   pair. Confirm that the four non-Mara entities carry no field outside
   `{status, visible, revealed, npcState}` at synthesis before treating the captures as
   fix-invariant.

2. **There is no way to remove a field from an entity record, and this decision makes
   that consequential.** The inability predates this ADR: `change.x ?? existing.x`
   treats an omitted value and an explicit `null` identically as "no opinion," so
   deletion is already inexpressible. For the three non-optional fields this is moot.
   For `npcState` it is a real gap — once set, it can be overwritten but never cleared,
   and the closest approximation is an empty string.

   What changes is the visibility of the gap. Under copy-by-list, a field that should
   no longer be present is indistinguishable from one that was silently dropped, because
   both are simply absent. Under preserve-by-default, a stale field persists and is
   observable. That is the better failure, but it means the question stops being
   hypothetical the first time a field genuinely needs removing.

   **No mechanism now**, per the standing principle of deferring generalization: no
   current entity field requires deletion. `crewRole` and `instinctRoll` are
   authored-once and must never be removed — preserving them is the entire point of
   this ADR — and `npcState` is overwrite-in-place by nature. There is not yet a first
   case, let alone a second.

   **When one arrives, the shape is already established.** `characterState.rollModifiers`
   uses explicit add/remove operations rather than inferring intent from payload
   presence (`session.validator.ts:471-496`), and that is the precedent to follow.

   **Explicitly rejected in advance: a sentinel value.** Treating `null` or `""` as
   "delete" would require `null` to mean "no opinion" on some fields and "remove" on
   others, and would make "the Warden omitted this" indistinguishable from "the Warden
   wants this gone." That ambiguity is the precise shape of the defect this ADR exists
   to close, and reintroducing it one field over would be a regression in reasoning even
   where it happened to work.

3. **`capture-fixture` cannot emit `playerEntityIds`, and the harness treats its
   absence as `[]`.** `reconstructStateAsOfTurn` returns `gmContextBlob` from the
   synthesis snapshot, where the field is never persisted; `harness-runner.ts:179`
   reads it and resolves empty, which — per the comment in `seedScratchAdventure` —
   silently disables `actingEntityId` validation and grades a code path production does
   not take. All 21 existing fixtures carry hand-added values. This is a tooling defect
   reproducing on every capture, not a discipline lapse, and it is the mechanism behind
   the voided 2026-08-20 re-baseline. Two changes: `capture-fixture` should derive and
   emit the field from `character_sheet.data->>'entityId'` as
   `session.service.ts:280` already does, and `harness-runner` should fail loudly on an
   empty resolution rather than proceed. Tracked separately from this ADR.

4. **`gm_context_blob.entities` and `campaign_state.data->'entities'` disagree at
   synthesis.** The duplicate copy carries `crewRole` for `mara_odinsen` but not
   `instinctRoll`. Rendering reads `campaign_state`, so `ADR-0100` verified end-to-end
   only because the complete copy is the one consumed. The synthesis write path
   populates the two copies inconsistently, and a divergent duplicate of the same
   record is the shape M7.6 was meant to have eliminated. Separate defect; separate
   entry.

5. **`ADR-0100` status.** Verified end-to-end in the negative direction only — turns 15
   and 18 show the Warden correctly declining to apply Zero-G/Athletics out of domain,
   and both the Instinct arithmetic and the role→skill mapping reconcile against
   `crew-roles.ts`. The positive direction — an in-domain check where the tier bonus
   appears in the roll target — remains unexercised by any turn or fixture.
