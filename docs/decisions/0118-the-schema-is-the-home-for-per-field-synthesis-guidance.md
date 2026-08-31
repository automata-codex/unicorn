---
id: ADR-0118
title: The schema is the home for per-field synthesis guidance, and `narrative.location` becomes `scenarioPremise`
area: claude-tool-schemas-state
status: accepted
superseded_by: null
milestone: M7.7
summary: >-
  Per-field guidance for synthesis moves onto the field as a Zod `.describe`, and the
  prompt keeps only rules Zod cannot express — closing a gap where three fields the
  Warden reads every turn were described in neither place. `narrative.location` is
  renamed `scenarioPremise` and relabelled `scenario_premise:`, discharging part three
  of `ADR-0101`'s fix ordering. `gm_context.schema_version` goes to 2 with a read
  migration that, unlike `ADR-0101`'s, also covers the eval corpus — so no corpus bump
  and no backfill migration are owed. Ships on reasoning: nothing measures synthesis.
---

## The gap

`synthesis.schema.ts` carried `.describe` on two of its fields against
`session.schema.ts`'s thirty-six. The `narrative` block was five bare
`z.string()`s, and the synthesis prompt covered only two of the five —
`npcAgendas`, `hiddenTruth` and `oracleConnections` were described **nowhere**,
in a block that ships in the Warden's cached system block on every turn.

**Two homes, inconsistently used, is what made that invisible.** `worldFacts`
had a long prose block in the prompt and nothing in the schema; `crewRole` had
prompt prose; the narrative fields had neither. With guidance able to live in
either place, a field with none in both reads as a field with some in the other.

## What was decided

**The schema is the home. The prompt keeps only what Zod cannot express.** One
home means the next gap is visible instead of invisible.

The test is narrower than it sounds. Zod can express a field's meaning, its
type, its optionality, and its relationship to a named sibling. It cannot
express a required *key* inside a `z.record`, a constraint spanning sibling
blocks, or a rule about the authoring process rather than the value. Seven of
the synthesis prompt's twelve sections moved or split. Three rules stayed, each
for a reason a description could not serve:

- **`adventure_complete` is required** — a required key inside a `z.record`.
  Saying it in Zod means changing the type; the service enforces it instead.
- **NEVER INVENT AN NPC TO FILL A ROLE** constrains the entity *list*, not the
  `crewRole` field. A field description is read while writing one entity, which
  is exactly the wrong moment to be told not to add another.
- **A spatial-layout entry is required** constrains `worldFacts` as a whole, and
  no per-key description can state it. Its *form* — the indexed list, the
  top-down deck numbering, the worked examples (`ADR-0117`) — is per-field and
  moved, verbatim: that restructure is unmeasured (`docs/eval-findings.md
  § S44`) and kept on a cost argument, so re-wording it here would have quietly
  reopened a question this change cannot settle.

**The bar for a description is `visible`/`revealed`**: define the field,
distinguish it from its sibling, name what is transient, give the one worked
case that differs.

## The rename

**`narrative.location` becomes `narrative.scenarioPremise`, rendering as
`scenario_premise:`.** `ADR-0101`'s 2026-08-25 addendum calls it the one field
that actively misleads: a scenario-level descriptor fixed at synthesis,
occupying the slot a reader checks for *where are we* and answering *what is
this scenario about*. An absent field would mislead less.

**Both halves are needed and neither substitutes for the other**, because they
act on different surfaces for different audiences. A `.describe` reaches only
the synthesis model — `submit_gm_context` is synthesis-phase-only and never in
the session tool list — so it fixes what gets *written*. The rendered label
reaches the Warden every turn, so it fixes what gets *read*. A perfectly
described `location` still renders as `location:`, which is `ADR-0101`'s actual
complaint.

**The full field rename was chosen over relabelling only the rendered line**,
which `ADR-0101`'s 2026-08-31 addendum left open on cost grounds. What changed
the calculus is in the next section.

## `gm_context.schema_version` goes to 2, and the corpus does not move

`docs/schema.md` classes a renamed field in a versioned blob as a breaking shape
change, to be paired with code that lazily migrates on read or rejects old rows
loudly. Rejecting would break replay of the two playtest campaigns the eval
corpus was captured from, so it migrates.

**The migration keys on the shape, not on the version, and that is deliberate.**
Not every read path selects the version column — `getGmContextBlob` selects
`blob` alone — so a version-gated migration would silently no-op wherever a
caller had not thought to add the column to a projection. The failure that buys
is a v1 blob reaching the prompt builder and rendering `scenario_premise:
undefined` to the Warden on every turn. Shape-keying is total. The version
remains the *declaration* of what new writes produce.

**One mechanism covers both the database and the eval corpus, where `ADR-0101`
needed two.** That entry paired `V20__entity_revealed_backfill.sql` with a
load-time normalizer in the harness, because "the eval corpus is not in the
database." True of `campaignState`, which the harness seeds down a different
path — **not** true of `gmContextBlob`: `harness-runner.ts` inserts the
fixture's blob into `gm_context` and the run reads it back through the same
repository. Verified: all 33 fixtures carry `narrative.location`,
`session.service.ts` reads through `getGmContextBlob`, no fixture byte changed,
and the corpus version is still `d651cec51ad7`.

**So no corpus bump and no `V21` are owed.** This is what made the full rename
affordable, and it is the fact `ADR-0101`'s addendum did not have when it called
the cheap version the likely answer. Retiring the shim with a real backfill stays
available later.

**One correction to what that addendum assumed.** `gm_context.schema_version`
was never written by application code at all — it took the column default of 1.
Every explicit `schemaVersion: 1` in the write paths is `campaign_state`'s. It
is now written explicitly on all three `gm_context` write paths, including the
per-turn update, so an old adventure's row is relabelled by its first turn after
this lands.

## Costs, accepted

**Guidance moves from instruction position to parameter-documentation
position.** That is the intended effect and it is not free. If anything
regresses at the next playtest, this is the first thing to suspect.

**Net bytes to the model rise by about 5.3 KB** — the prompt falls 8508 → 3129
and the tool schema rises 5690 → 16353. Most of the increase is not moved text
but new text, for the fields that had guidance nowhere. It costs nothing
per-turn: synthesis is one call per adventure, and none of this sits in the
Warden's per-turn cached block.

**`assemblyHash` moves; `corpusVersion` does not.** The rendered `<narrative>`
block changes one label, which is Warden-visible (`ADR-0099`). Per `ADR-0094`
this does not buy its own run; its natural batch-mate is `current_location`,
which is a tool-schema change and owes a run outright. `eval:compare` will
correctly warn across the boundary — that warning is accurate and should not be
suppressed. `docs/eval-methodology.md § Current baseline N` records the move
without a run, because a change nobody dispositioned is how that section fell
four runs behind on 2026-08-24.

**`x`/`y`/`z` on `startingPosition` are deliberately left undescribed**, against
the policy this entry sets. No axis convention is documented anywhere — nothing
says whether `y` runs up or down, and `grid_cell` carries both a `z` and an
`elevation` with nothing distinguishing them. An invented convention arriving as
documentation is worse than the gap. They get descriptions when the 2D renderer
fixes the axes.

**`apps/zoltar-playtest` is out of scope and drifts further.** It keeps a
hand-written copy of this schema, its types and its prompt, importing nothing
from the backend. This has a real consequence for the argument that the change
should land before the next playtest: if that playtest runs on the prototype
app, it exercises none of this.

## Why this ships on reasoning

**No eval command exercises synthesis** — the corpus replays turns — so none of
this is measurable by the harness, the same position `ADR-0117` shipped from.
The precedent it leans on is measured, though not here: adding `.describe` to
the session tool schema took tool-syntax emission from 2.7% to 1.36%
(`docs/eval-methodology.md`'s emission table, where the first reading of 0.67% is
recorded as the optimistic tail). The next playtest is the first thing that
exercises any of it.

**`report_coherence`'s schema is now generated from `coherenceReportSchema`**
rather than hand-written beside it, which removed the same duplication one layer
down. Its `.refine` — `rerollCategory` is required when `resolution` is
`reroll` — does not survive `zodToJsonSchema`, so it is restated in that field's
own description. Nothing is weakened on the backend: the refine still runs on
the response parse.

## What would reverse this

A measured regression at the next playtest traceable to synthesis output
quality, which would implicate the instruction-to-parameter move. Or a second
game system whose synthesis needs prose the schema genuinely cannot carry — at
which point the split is between systems rather than between homes, and this
entry's test needs restating rather than its conclusion.
