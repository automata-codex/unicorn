# 024 — Describe the synthesis schema, and rename `location` to `scenarioPremise`

**Status: open.** Drafted 2026-08-31. Parts two and three of `ADR-0101`'s fix
ordering, minus `current_location` — which stays its own item and is blocked on
this one. Part one shipped the same day as `ADR-0117`.

A plan rather than a spec, on the `014`/`021`/`022`/`023` precedent: one tracked
item across a handful of surfaces. Unlike those four it buys no run, so there is
no pre-registration section — see **Eval disposition** for why, and for what
that costs.

Evidence: `ADR-0101` and its 2026-08-25 and 2026-08-31 addenda,
`docs/eval-methodology.md`'s emission table, `docs/eval-findings.md § S44`.

## The problem in one paragraph

`synthesis.schema.ts` carries `.describe` on two fields; `session.schema.ts`
carries it on thirty-six. The `narrative` block is five bare `z.string()`s, and
the synthesis prompt mentions only two of the five — `npcAgendas`,
`hiddenTruth` and `oracleConnections` are described in neither place, and all
five ship in the Warden's cached system block on every turn. Separately,
`narrative.location` is a scenario-level descriptor fixed at synthesis that
renders under a label a reader checks for *where are we*; `ADR-0101`'s
2026-08-25 addendum calls it the one field that actively misleads.

## What is already settled (do not re-derive)

- **The blocker is clear.** `ADR-0117` shipped the deck-indexed `ship_layout`
  restructure on 2026-08-31; it is live at `synthesis.prompts.ts:128`.
- **The precedent for descriptions is measured.** Adding `.describe` to the
  session tool schema took tool-syntax emission from 2.7% to 1.36%
  (`docs/eval-methodology.md`'s emission table; the 0.67% first reading is the
  optimistic tail). This change is argued from that, not from it.
- **The plumbing exists for `submit_gm_context`.** `synthesis.tools.ts:12`
  renders `submitGmContextSchema` through `zodToJsonSchema`, so a `.describe`
  reaches the model with no new wiring. It does **not** exist for
  `report_coherence` — see below.
- **Descriptions and the rename are not substitutes.** A `.describe` reaches
  only the synthesis model, because `submit_gm_context` is synthesis-phase-only
  and never in the session tool list — it fixes what gets *written*. The
  rendered label at `session.prompt.ts:41` reaches the Warden every turn — it
  fixes what gets *read*. A perfectly described `location` still renders as
  `location:`.
- **The bar for a description** is `visible`/`revealed` at
  `synthesis.schema.ts:26–56`: define the field, distinguish it from its
  sibling, name what is transient, and give the one worked case that differs.

## Decisions taken for this plan

| Question | Answer |
|---|---|
| Which rename | **Full field rename**, not just the rendered label |
| New name | **`narrative.scenarioPremise`**, rendering as `scenario_premise:` |
| Existing rows | **Lazy migrate on read**, `gm_context.schema_version` 1 → 2 |
| `apps/zoltar-playtest` | **Out of scope** |
| Guidance home | **Schema is the home.** Migrate the existing prompt prose now |
| Coherence tool | **In scope** — convert to `zodToJsonSchema` and describe |
| Corpus / baseline | **Batch per `ADR-0094`.** No run bought by this change |
| Records | New ADR for the policy + rename; short `ADR-0101` addendum |

## The guidance-home policy

**The schema is the home for per-field guidance. The prompt keeps only rules
the schema cannot express.** Today `worldFacts` has a long prose block in the
prompt and nothing in the schema, the narrative fields have neither, and
`crewRole` has prompt prose — two homes, inconsistently used, so a gap in
either one is invisible. One home makes the next gap visible.

**A rule the schema cannot express** is the test, and it is narrower than it
sounds. Zod can express a field's meaning, its type, its optionality, and its
relationship to a named sibling. It cannot express a required *key* inside a
`z.record`, a constraint spanning two sibling blocks, or a rule about the
authoring process rather than the value.

### Prompt audit — what moves and what stays

`buildMothershipSynthesisPrompt` has twelve sections (`synthesis.prompts.ts:117–130`).

| Section | Disposition |
|---|---|
| Preamble, `CHARACTER:`, `ORACLE RESULTS:` | **Stays.** Rendered input, not field guidance |
| Oracle-wiring paragraph (`:121`) | **Stays.** Cross-cutting authoring instruction |
| `PLAYER CHARACTER:` (`:122`) | **Split.** The "do not re-create hp/stress pools" half is an `initialState` rule and moves; the "use the Entity ID from CHARACTER above" half spans the prompt's own rendered input and stays |
| `FLAGS:` (`:123`) | **Moves** onto `flagSchema.value` and `flagSchema.trigger` |
| `REQUIRED FLAG — adventure_complete:` (`:124`) | **Stays.** A required key inside `z.record` — Zod cannot say it without changing the type |
| `CREW ROLES:` (`:125`) | **Split.** The enum, the "npc only" rule and the no-Instinct rule move onto `crewRole` and `entitySchema`; **NEVER INVENT AN NPC TO FILL A ROLE** stays — it constrains the entity list, not the field |
| `RESOURCE POOL ADDRESSES:` (`:126`) | **Moves** onto `initialState`, `_scenario` reserved owner included |
| `COUNTDOWN TIMERS:` (`:127`) | **Moves** onto `initialState`, merged with the above rather than duplicated |
| `WORLD FACTS:` (`:128`) | **Split.** Key/value conventions, the indexed-list form, top-down deck numbering and both worked examples move onto `worldFacts`; **"at least one entry must describe the spatial layout"** stays — it is a requirement on the record as a whole |
| `OPENING NARRATION:` (`:129`) | **Moves** onto `openingNarration` |
| `ADDITIONAL DIRECTION:` (`:133`) | **Stays.** Caller-supplied |

**`ADR-0117`'s text moves but does not change.** The indexed-list form, the
top-down rule and the two examples relocate from the prompt to `worldFacts`'s
description verbatim. That restructure is unmeasured (`§ S44`) and kept on a
cost argument; re-wording it here would quietly re-open a question this change
is not equipped to settle.

**Cost, stated plainly: this shrinks the synthesis prompt and grows the tool
schema.** Guidance moves from a position the model reads as instruction to one
it reads as parameter documentation. That is the intended effect and it is not
free — if anything regresses at the next playtest, this is the first thing to
suspect, and the ADR should say so.

**Measured after the fact, correcting this plan's first estimate.** The
drafted claim was that net bytes would be "roughly flat." They are not: the
prompt falls 8508 → 3129 bytes and the tool schema rises 5690 → 16353, a net
**+5.3 KB** to the model. Most of that is not moved text but new text — the
fields that had guidance nowhere, which is the gap the item exists to close.
It buys no per-turn cost: synthesis is one call per adventure, and none of this
is in the Warden's per-turn cached block.

## Fields to describe

Everything in `submitGmContextSchema` and the coherence schemas that lacks a
description. `visible` and `revealed` already meet the bar and are **not**
rewritten.

- `entitySchema`: `id`, `type`, `crewRole`, `startingPosition` (+ `x`, `y`,
  `z`), `tags`
- `flagSchema`: `value`, `trigger`
- Top level: `openingNarration`, `narrative`, `structured`
- `narrative`: `scenarioPremise`, `atmosphere`, `npcAgendas`, `hiddenTruth`,
  `oracleConnections`
- `structured`: `entities`, `flags`, `initialState`, `worldFacts`
- `coherenceConflictSchema`: `category`, `description`, `rerollable`
- `coherenceReportSchema`: `conflicts`, `resolution`, `rerollCategory`

**Two fields need care beyond the bar.**

`startingPosition` is grid position, and `ADR-0101` scopes structural secrecy
to exactly that. Its description should say it is written to `grid_entity` and
read by nothing in Phase 1 — otherwise it reads as the answer to "where is this
entity," which is the confusion the whole item exists to remove.

`npcAgendas` is the field `gmUpdates.npcStates` destroys by merging over it
(`ADR-0101` addendum 2026-08-21, `session.applier.ts:57`). Its description
should say the agenda is durable authored motivation and not a mood note —
which is the distinction the 2026-08-16 playtest lost.

## The rename

Four code surfaces, one golden, one persisted shape.

| Surface | Change |
|---|---|
| `synthesis.schema.ts:82` | `location:` → `scenarioPremise:` in `narrative` |
| `session.snapshot.ts:32` | `location: string` → `scenarioPremise: string` on the `GmContextBlob` interface |
| `session.prompt.ts:41` | `` `location: ${n.location}` `` → `` `scenario_premise: ${n.scenarioPremise}` `` |
| `apps/zoltar-playtest` | **No change.** Out of scope; its schema, types and prompt are a separate hand-maintained copy |
| `assembly-golden/gm-context.txt` | Regenerate |
| `gm_context.blob`, `adventure_synthesis_snapshots.gm_context_blob` | Read-migrated, `schema_version` 1 → 2 |

Plus the specs that assert on the shape — see **Test surface**.

### The migration, and why the corpus does not move

**Site the normalizer where a blob enters the application from persistence, not
at the render.** `formatGmContextBlob` is tempting because it is the only place
the field is rendered, but `GmContextBlob` is also read by
`adventure.repository.ts:70`, `replay/reconstruct-state.ts:106` and the session
service's blob merge, and a shim at the render leaves the other three reading a
key that is no longer in the type.

**The eval corpus goes through the same door, which is the load-bearing fact
here.** `harness-runner.ts:366–368` inserts `fixture.seededState.gmContextBlob`
into `gm_context` and the run then reads it back through the real repository
path. So a read-migration sited at that boundary covers all 33 fixtures
automatically — their bytes never change, `corpusVersion` hashes bytes
(`corpus-version.ts:70–74`), and **the corpus version does not move.**

**This is a simplification on the `ADR-0101` precedent, not a departure from
it.** That change needed two mechanisms — `V20__entity_revealed_backfill.sql`
for the database and `backfillEntityRevealed` (`harness-runner.ts:228`) for the
corpus, because "the eval corpus is not in the database." That is true of
`campaignState`, which the harness seeds through a different path. It is not
true of `gmContextBlob`. One read-migration does both jobs, and no `V21` is
owed. Retiring the shim later with a real backfill migration stays available;
`V20` is the current high-water mark.

**Nothing reads `schemaVersion` to branch today** — it is written at
`synthesis.write.ts:242`, `synthesis.repository.ts:63` and
`session.assembly.ts:124` and read nowhere. This change makes it load-bearing
for the first time, so the reader is new code and the plan should not assume a
pattern exists to follow.

## The coherence tool

`REPORT_COHERENCE_TOOL` (`synthesis.tools.ts:29–51`) is hand-written raw JSON
schema. `coherenceReportSchema` and `coherenceConflictSchema` exist in
`synthesis.schema.ts` and are used for *validating the response*; the two have
been maintained separately. Replace the hand-written block with
`zodToJsonSchema(coherenceReportSchema, { $refStrategy: 'none' })` and describe
the six fields.

**One rule does not survive the conversion.** `coherenceReportSchema` carries a
`.refine` — `rerollCategory` is required when `resolution` is `"reroll"`
(`synthesis.schema.ts:111–114`). `zodToJsonSchema` cannot express it, so the
emitted schema loses it. It must be restated in `rerollCategory`'s own
`.describe`. The backend keeps enforcing it: the refine still runs on the parse
of the model's response, so a violation is caught either way — what changes is
whether the model is *told*, and today it is told, in
`buildMothershipCoherenceCheckPrompt`'s resolution guide (`:146`). That line
stays under the guidance-home policy anyway, as a cross-field rule.

## Sequence

1. **Descriptions only.** Add `.describe` throughout `synthesis.schema.ts`,
   leaving `location` named as it is and the prompt untouched. Regenerate
   `synthesis-golden/synthesis-tools.txt`. Reviewable as a pure addition.
2. **Coherence tool conversion.** Swap the hand-written schema for the
   generated one; restate the `.refine` in prose. Regenerate
   `coherence-tools.txt` and diff it against the old hand-written JSON — the
   emitted shape should be equivalent modulo the refine.
3. **Prompt migration.** Delete the moved sections from
   `synthesis.prompts.ts`, keeping the retained rules per the audit table.
   Regenerate `synthesis-prompt.txt`. **Read the diff of both goldens end to
   end** — the goldens freeze text, they do not say it is right.
4. **Rename.** All four code surfaces plus the specs, in one commit.
5. **Migration.** The read-normalizer, the `schema_version` 2 write, and the
   reader that branches on it. Regenerate `assembly-golden/gm-context.txt`.
6. **Records.** New ADR; `ADR-0101` addendum; `task docs:decisions:build` then
   `task docs:decisions:check`.

Steps 1–3 are independent of 4–5 and could land separately if the rename gets
held up.

## Test surface

Regeneration is explicit and per-golden:

- `UPDATE_SYNTHESIS_GOLDENS=1 npx vitest run src/synthesis/synthesis.goldens.spec.ts`
  — covers `synthesis-prompt.txt`, `synthesis-tools.txt` and
  `coherence-tools.txt`. `coherence-prompt.txt` and `character-prose.txt`
  should come back byte-identical; if either moves, something migrated that
  the audit table did not sanction
- `UPDATE_ASSEMBLY_GOLDENS=1 npx vitest run src/session/session.assembly.spec.ts`
  — covers `assembly-golden/gm-context.txt`

Specs that assert on the renamed field or the moved prose:

- `synthesis.schema.spec.ts:7` — `narrative` fixture
- `synthesis.write.spec.ts:18`, `:335–342` — asserts `blob.narrative.location`
  explicitly
- `synthesis.service.spec.ts:230`, `:330`, `:411`
- `synthesis.repository.spec-int.ts:116`
- `replay/reconstruct-state.spec-int.ts:202`, `:352`
- `scripts/load-synthesis.spec-int.ts:40`, `:121`, `:193`, `:283`
- `synthesis.prompts.spec.ts` — its *"includes every required section"* test
  asserts twelve `toContain`s. Sections that move must come out of it, and the
  test's known blind spot (it misses four sections outright,
  `synthesis.goldens.ts:44–51`) means a silent deletion will not fail it. The
  golden diff is the real check.

**New tests owed:** the read-migration — a version-1 blob normalizes, a
version-2 blob passes through untouched, and a blob carrying both keys resolves
deterministically. Mirror `backfillEntityRevealed`'s leave-alone rule.

## Eval disposition

**No eval command exercises synthesis** — the corpus replays turns — so the
descriptions and the prompt migration are unmeasurable by the harness, and this
ships on reasoning as `ADR-0117` did.

**`assemblyHash` moves; `corpusVersion` does not.** The rendered `<narrative>`
block changes one label, which is Warden-visible, so `assemblyHash` moves per
`ADR-0099`. Fixture bytes are untouched (see the migration section), so the
corpus version is unchanged and every frozen run on disk stays comparable *as a
corpus*. `eval:compare` will correctly warn on any pairing across the
`assemblyHash` boundary; that warning is accurate and should not be suppressed.

**The `assemblyHash` move batches per `ADR-0094` and does not buy its own run.**
Its natural batch-mate is `current_location`, which is a tool-schema change and
owes a run outright. **`docs/eval-methodology.md § Current baseline` must record
that this change moved `assemblyHash` without a run** — a change nobody
dispositioned is how that section fell four runs behind on 2026-08-24.
`task docs:baseline-check` is free and needs no approval.

**The next playtest is the first thing that exercises any of this**, which is
the argument for landing before it. Note the limit on that: with
`apps/zoltar-playtest` out of scope, a playtest run through the prototype app
exercises none of it. If the next playtest runs there, this lands ahead of
nothing.

## Deliberately not in this change

- **`current_location`.** Its own item, blocked on this one. Read `ADR-0101`'s
  warning before implementing it — the obvious implementation is the one the
  ADR rejects — and re-derive its position in the ordering rather than
  inheriting it, since `§ S44` did not survive the premise the ordering rested
  on.
- **`apps/zoltar-playtest`.** Its duplicate schema, types and prompt drift
  further with this change. Worth its own item if the prototype is still in
  use.
- **A `synthesisHash`.** `synthesis.goldens.ts` argues against it and nothing
  here changes that argument: no run reads it.
- **Re-wording `ADR-0117`'s layout guidance.** It relocates verbatim.
- **A `V21` backfill migration.** The read-migration makes it unnecessary now;
  it stays available for retiring the shim later.

## Records to write

**New ADR (next number is 0118).** The guidance-home policy — schema is the
home, the prompt keeps what the schema cannot express — with the audit table's
reasoning, the `scenarioPremise` rename and why the rename and the descriptions
are not substitutes, the `schema_version` 2 read-migration and why no backfill
migration is owed, and the coherence-tool conversion with the `.refine` gap.
Record the cost stated above: guidance moves from instruction position to
parameter position, and that is the first thing to suspect if the next playtest
regresses.

**Addendum to `ADR-0101`.** Part three of its fix ordering is discharged;
`current_location` remains open. Correct the 2026-08-31 addendum's open
question — "which of the two is meant is an open decision" — by recording that
the full field rename was chosen and what made it affordable: the eval corpus
reaches `gmContextBlob` through the database, so the read-migration covers the
fixtures and no corpus bump is owed. That is the fact that changed the cost
calculus, and it is not in the ADR today.
