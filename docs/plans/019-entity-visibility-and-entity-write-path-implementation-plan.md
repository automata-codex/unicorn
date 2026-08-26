# 019 — Entity visibility and the entity write path: Implementation Plan

Multipart implementation plan for
`../specs/zoltar/019-entity-visibility-and-entity-write-path.md`. Each part is
sized for a manual code review and a single commit. **Pause after each part for
review before starting the next.**

**Grounding.** Written 2026-08-21 against `milestone-m77-playtest-and-fixtures`
at `cc07910`. Every `path:line` below was read in the working tree, not
inherited from the spec.

**Invariant for every part: the repo is green at each commit.** `npm run build`,
`npm test`, `npm run lint`. Load-bearing here, not ceremonial: `EntitySchema`
lives in `@uv/game-systems` (`packages/game-systems/src/shared.ts:12`) and every
consumer — validator, snapshot, synthesis writer — is in `apps/zoltar-be`. A
schema change and its consumers land in the same commit.

---

## Ordering

The spec has six Parts plus 4a. This plan splits them into ten commits.

The spec's suggested order — 5, 4a, 4, 2, 1, 3, 6 — survives with one
insertion. **`ASSEMBLY_PROBE` has to be able to see each new field before the
field ships**, or the change is Warden-visible with no run identity to prove it
(`ADR-0099`). That is not one task at the end; it is a clause inside each part
that touches a rendered surface, plus one dedicated commit (Part 8) for the gap
the probe cannot close incidentally.

| # | Title | Spec | Warden-visible |
|---|---|---|---|
| 1 | `applyEntity` reports every bad field | P5 | no |
| 2 | `revealed` on the schema, and `V20` | P2 | no (not yet rendered) |
| 3 | `revealed` is monotonic; unknown ids are rejected | P2, P5 | **yes** — schema |
| 4 | `npcState` gets a writer and a reader | P4 | **yes** — schema + snapshot |
| 5 | Agendas separate from disposition | P4a | **yes** — schema |
| 6 | `status` is the enum at the boundary | P4 | **yes** — schema |
| 7 | The snapshot stops filtering | P1 | **yes** — snapshot |
| 8 | The probe sees what the hash must see | — | **yes** — goldens |
| 9 | Descriptions, and the prompt | P3 | **yes** — schema + prompt |
| 10 | Docs, predictions, re-baseline | P6 | — |

**Part 1 first** because it is the only commit with no Warden-visible surface,
it is independent of everything else, and Parts 2–6 each add a field that makes
its reporting gap likelier.

**Part 8 is deliberately late but not last.** It has to land before Part 9's
descriptions, because Part 9 is the commit most likely to be reviewed as
"documentation" and waved through — and it moves `promptHash` and
`assemblyHash` together, which is the pair a run identity is supposed to
distinguish.

### What each part needs beyond the repo

- Parts 3–7 and 9 each move `assemblyHash`. Do **not** re-baseline per part;
  one run at Part 10 (`ADR-0094`).
- `UPDATE_ASSEMBLY_GOLDENS=1` rewrites the three goldens
  (`session.assembly.spec.ts:17`). Read every regenerated diff before
  committing — a golden that self-heals asserts nothing, which that file's own
  comment says.
- No fixture re-capture at any point (`ADR-0101`; spec § Non-goals).

---

## Part 1 — `applyEntity` reports every bad field

*Spec Part 5, first half. No Warden-visible surface.*

`applyEntity` (`session.validator.ts:607`) validates `status`, and on failure
pushes a rejection and `return`s at `session.validator.ts:621` before examining
anything else on the entity.

**This is not data loss and the fix is not partial application.** `ADR-0038 §
D4`'s validate-all-then-apply guarantee means a non-empty `rejections` array
discards the whole `applied` set: `SessionService` runs one correction round and
throws `SessionCorrectionError` if that also fails (`session.service.ts:377-406`).
Verified — the rejection fires with `applied.entities` empty. What the early
return costs is that a Warden told about `status`, fixing it, and failing on an
unreported sibling gets no second correction.

**Work.**

1. Accumulate field-level rejections for an entity rather than returning at the
   first. One rejection per bad field, all in the same round.
2. Rejection reasons name the remedy. `"status must be 'alive', 'dead', or
   'unknown'"` should point narrative detail at `npcState` — write it now,
   before Part 4 makes it true, or write it in Part 4 and not here. Do not ship
   a reason that names a field that does not exist yet.
3. Addendum to `ADR-0038` recording that within-entry rejection is
   all-or-nothing **by inheritance from D4**, and that the fixed property is
   completeness of reporting.

**Watch for.** With one rejectable field today this change is unobservable from
the outside — the test has to construct a two-bad-field entity, which is only
possible after Part 6 tightens `status` or Part 2 adds `revealed`. Write the
test against a temporary second rejectable condition, or accept that Part 1's
test lands in Part 3. Say which in the commit message rather than leaving the
part untested.

**Done when.** An entity change with two invalid fields produces two rejections
in one round; the `ADR-0038` addendum is written.

---

## Part 2 — `revealed` on the schema, and `V20`

*Spec Part 2, storage only. Nothing renders it yet.*

**Work.**

1. `revealed: z.boolean()` on `EntitySchema`
   (`packages/game-systems/src/shared.ts:12-28`).
2. `V20__entity_revealed_backfill.sql` — set `revealed` from `visible` on every
   `campaign_state.data.entities.*`. Header-commented **disposable by design**,
   in `V19__character_sheet_m76_reset.sql`'s idiom — that file says the same
   thing about itself at `V19:20`. `roadmap.md § M9` already carries the
   matching note.
3. `revealed` on the synthesis entity schema (`synthesis.schema.ts:25`) and
   through `synthesis.write.ts:188`, which today builds `{visible, status}`.

**Watch for — this is the trap in this part.** `ASSEMBLY_PROBE.campaignStateData`
is built with `MothershipCampaignStateSchema.parse(...)`
(`session.assembly.ts:104-106`), and its comment says the probe deliberately
"picks up any defaulted field a future schema version adds". A **required**
`revealed` therefore breaks the probe's parse at build time until the two
entity literals at `session.assembly.ts:157-165` carry it. That is the correct
outcome — the alternative, a `.default()`, means the probe silently acquires a
value nobody chose and the hash sees a field the schema never made anyone think
about. Make it required, fix the probe in the same commit, and give
`probe_threat` `revealed: false` so the interesting case exists from here on.

**Also.** The eval corpus reads `campaign_state` from fixture JSON, not from the
database, so `V20` does not touch it. Fixtures predating `revealed` will fail
the parse if it is required. Check this before committing — if they do, the
fixtures need the field, and that *is* a corpus edit, which contradicts the
spec's no-re-capture guarantee. Resolve it as a fixture-loader default rather
than a re-capture, and record which.

**Done when.** `revealed` exists on all three schemas; `V20` back-fills and is
commented as disposable; the probe carries it explicitly; the eval corpus still
loads.

---

## Part 3 — `revealed` is monotonic; unknown ids are rejected

*Spec Part 2 and Part 5, second half. Warden-visible: the payload gains a field.*

**Work.**

1. `revealed` on the `entities` payload of `submit_gm_response`
   (`session.schema.ts:272-278`).
2. Monotonic enforcement in `applyEntity`: a proposed `revealed: false` against
   an entity already `true` is a rejection naming the rule, not a silent no-op.
3. Unknown ids rejected. `validateStateChanges` already receives
   `knownEntityIds` (`session.service.ts:365`) and `applyEntity` ignores it —
   this is a use of wiring that already exists, not new wiring. The create
   branch at `session.validator.ts:628-633` becomes the rejection branch.
4. An explicit create op, since Part 3 removes the implicit one and entities
   introduced mid-adventure are legitimate. Shape is the implementer's call; the
   rule is that creation is stated, never inferred.

**Watch for.** Removing implicit creation is the highest-blast-radius change in
this plan — every entity the Warden has ever introduced mid-adventure took that
path silently. Grep the playtest telemetry for `applied.entities` keys absent
from the synthesis roster before committing; if the Warden did this routinely,
the create op's ergonomics matter more than this plan assumes.

**Also.** Part 1's two-bad-field test becomes constructible here.

**Done when.** A reverse `revealed` is rejected with a reason; an unknown id is
rejected with a reason naming the create op; a create op introduces an entity
that renders next turn.

---

## Part 4 — `npcState` gets a writer and a reader

*Spec Part 4, second half. Warden-visible: schema and snapshot.*

`npcState` is defined (`shared.ts:15`), carries an instructional comment
(`shared.ts:27-28`), and is preserved on merge (`session.validator.ts:641-642`).
Nothing writes it and nothing renders it. It appears nowhere in
`assembly-golden/tools.txt`.

**Work.**

1. `npcState` on the `entities` payload.
2. Render it — `<entities>` or `<character_attributes>`, implementer's call.
   A field nothing renders teaches the Warden to stop writing it.
3. `probe_npc_one` gets an `npcState` so the render is in the golden at all.

**Done when.** A written `npcState` survives a turn and appears in the snapshot.

---

## Part 5 — Agendas separate from disposition

*Spec Part 4a. Warden-visible: the payload loses a property and gains one.*

`session.applier.ts:57` spreads `gmUpdates.npcStates` over
`narrative.npcAgendas` — `{...priorAgendas, ...npcStates}`, keyed by entity id,
with no rejection, no event and no log line. In the 2026-08-16 playtest this
replaced the cartographer's authored agenda, including the conditions governing
her central secret, with a mood note; 9 of 58 turns wrote `npcStates`.
`formatGmContextBlob` then rendered the mood note under `npc_agendas:`
(`session.prompt.ts:34-36`).

**Agendas may change during play** (decided 2026-08-21) — so this is not "freeze
the agenda", it is "make the two paths separate and neither able to reach the
other's field".

**Work.**

1. Disposition goes to `entities[id].npcState` (Part 4). Remove
   `gmUpdates.npcStates` (`session.schema.ts:311`) rather than keeping a third
   spelling.
2. An explicit agenda-amendment path, named so it cannot be mistaken for
   disposition. An explicit write may replace outright — that is stated intent.
3. A key that is not a known entity id is rejected, per Part 3.
4. `probe_npc_two` is in `npcAgendas` (`session.assembly.ts:73`) and **not** in
   `entities` — so the probe already contains the case where an agenda key has
   no entity. Decide whether that stays legal and pin it either way.

**Watch for.** The 2026-08-16 campaign is deliberately **not** repaired
(spec § Part 4a). Do not add a restore step. `adventure_synthesis_snapshots`
holds the original if that decision is ever revisited.

**Done when.** A turn writing disposition leaves that NPC's `npcAgendas` entry
byte-identical; a golden pins the cartographer's agenda against
`adventure_synthesis_snapshots`; `gmUpdates.npcStates` is gone.

---

## Part 6 — `status` is the enum at the boundary

*Spec Part 4, first half. Folds `roadmap.md § M8.1`'s moved bullet.*

`status` is `z.string().optional()` at the tool boundary
(`session.schema.ts:275`, rendered as `"type": "string"` at
`assembly-golden/tools.txt:332`) and `z.enum(['alive','dead','unknown'])` at the
applier (`shared.ts:10`). The playtest's rejected values are the test cases:
`"manifested, stationary, vocalizing"` and `"deceased"`.

**Work.**

1. `status` becomes the `EntityStatusSchema` enum on the payload, so the
   constraint appears in the generated `input_schema` rather than only in a
   rejection.
2. Part 1's rejection reason now legitimately names `npcState`.

**Watch for.** `stateChanges`' own description says "entity visibility and
status" (`assembly-golden/tools.txt:397`). It is now wrong in two ways —
`revealed` and `npcState`. Update it here or in Part 9, not neither.

**Done when.** An out-of-enum status is rejected at the boundary with a reason
naming `npcState`; both playtest values have a legal home.

---

## Part 7 — The snapshot stops filtering

*Spec Part 1. Warden-visible: `<entities>` changes shape.*

Remove the filter at `session.snapshot.ts:309`. `otherLines` hardcodes the
literal `visible` at `session.snapshot.ts:312` because the filter guaranteed it;
`playerLines` already computes the two-state form at `session.snapshot.ts:293`.
NPCs adopt the computed form plus `revealed`.

**This discloses less than it looks like.** `formatGmContextBlob`
(`session.prompt.ts:52`) already emits every entity, hidden ones tagged
`starts hidden` — `assembly-golden/gm-context.txt` shows
`- probe_threat (threat, starts hidden): tags=unknown, aft` today. The new
information is the flag's current value.

**Work.**

1. Delete the filter; render `visible`/`hidden` and `revealed` per entity.
2. Regenerate `state-snapshot.txt`. `probe_threat` appears for the first time —
   confirm that is the whole diff.

**Watch for.** Hidden NPCs now render Instinct and `crewRole` skills
(`session.snapshot.ts:314-322`), which is correct and load-bearing for
off-screen combat (`ADR-0023`). `probe_threat` has no `crewRole`, so the probe
does **not** exercise that branch — Part 8.

**Done when.** A `visible: false` entity appears in `<entities>` with its flag
state legible; the golden diff is exactly `probe_threat`'s line.

---

## Part 8 — The probe sees what the hash must see

*No spec part. `ADR-0099` maintenance, and the reason it is its own commit.*

After Part 7 the probe still has no hidden entity carrying a `crewRole`, so the
hidden-NPC skill render — new behaviour this spec introduces — is invisible to
`assemblyHash`. A later edit to how hidden NPCs render their target numbers
would move no run identity. That is precisely the failure `ADR-0099` exists to
prevent, and the same shape as the `CREW_ROLE_SKILLS` gap that 018 Part 10 had
to close.

**Work.**

1. Give the probe a hidden entity with a `crewRole` — either `probe_threat`
   gains one or a fourth entity is added. Prefer a fourth: `probe_threat`'s
   role in `conditions: frightened (probe_threat)` is pinned by the golden and
   is a separate assertion.
2. Confirm every field this spec adds is non-default in at least one probe
   entity: `revealed: false` on one, `npcState` on one, an amended agenda if
   Part 5's path renders.
3. Regenerate all three goldens; read each diff.

**Watch for.** The synthesis tool schema is **not** covered by `assemblyHash` —
the goldens are session-side (`assembly-golden/{tools,gm-context,state-snapshot}.txt`)
and the eval corpus replays turns, not synthesis. Parts 2 and 5's synthesis-side
changes are therefore unmeasured by any run. Record that in Part 10's "what this
run does not measure" rather than discovering it afterwards.

**Done when.** Every field added by this spec is non-default somewhere in the
probe; `computeAssemblyHash()` moves; the three goldens are regenerated and
reviewed line by line.

---

## Part 9 — Descriptions, and the prompt

*Spec Part 3. Moves `promptHash` and `assemblyHash` together.*

Nothing describes any of this today: `visible` and `status` render as bare
`{"type": "boolean"}` / `{"type": "string"}` at `assembly-golden/tools.txt:329-334`,
`npcStates` as a bare string map at `:402-406`, and `mothership-m7.txt` contains
no occurrence of `visible`, `hidden`, `sight` or `reveal` in any relevant sense.

**Work.**

1. `.describe()` on `visible`, `revealed`, `status`, `npcState` — on **both**
   `submit_gm_response` and the synthesis tool. The descriptions must
   distinguish the two axes against each other, not describe each field alone:
   the failure this spec exists to fix is a reader given only the word
   `visible` picking the wrong one of two defensible meanings.
2. Update `stateChanges`' own description (`tools.txt:397`).
3. `mothership-m7.txt`: state that line of sight is Warden-maintained and
   changes both directions. This is the only place the Warden is told the job
   exists at all.

**Watch for.** This is the commit most likely to be reviewed as documentation
and waved through, and it is the one that moves both hashes. Part 8 lands first
for that reason.

**Done when.** No undescribed property remains on the entity payload of either
schema; `promptHash` and `assemblyHash` both move.

---

## Part 10 — Docs, predictions, re-baseline

*Spec Part 6, and the run.*

**Work.**

1. `docs/zoltar-design-doc.md:263` — narrow to the claim that survives:
   existence and state are behavioural, **position** is structural. Do not
   delete the structural half; `grid_entity.visible`
   (`synthesis.write.ts:300`) is what makes it real in the renderer era.
   `CLAUDE.md:51` moves with it.
2. Close `docs/hidden-information-findings.md` against the shipped state, and
   the M7.7 roadmap bullet.
3. **Predictions in writing before the run** (`ADR-0085`). `eval:compare` across
   this boundary is meaningless and the warning is not to be suppressed.
4. One full-corpus re-baseline, batched (`ADR-0094`).

**Predictions worth pre-registering.** `HIDDEN-INFO-LEAK` read 1.00 (20/20) on
the 2026-08-21 baseline; `<entities>` growing hidden rows is exactly the change
that could move it, and a fall is a real signal rather than noise. State a floor
before the run. Say also what the run does **not** measure: the synthesis-side
schema changes (Part 8), and agenda amendment, which no fixture exercises.

**Done when.** Docs match the code; predictions are written and dated before the
run; the report states its own blind spots.

---

## Acceptance criteria → parts

| Spec § Done when | Part |
|---|---|
| `renderEntities` emits every entity; no caller filters | 7 |
| Hidden NPCs render Instinct and skills | 7, exercised 8 |
| `revealed` exists, monotonic, reverse flip rejected | 2, 3 |
| `V20` back-fills, commented disposable, M9 note | 2 |
| Four fields described on both schemas | 9 |
| `mothership-m7.txt` states LOS is Warden-maintained | 9 |
| `status` is the enum; both playtest values have a home | 6 |
| `npcState` writable and rendered | 4 |
| Agenda path explicit; `npcStates` removed | 5 |
| Two bad fields → two rejections | 1, tested 3 |
| Unknown id rejected; explicit create | 3 |
| `ADR-0038` addendum | 1 |
| Design doc and `CLAUDE.md` corrected | 10 |
| Findings doc closed | 10 |
| Predictions, then one re-baseline | 10 |

## Out of scope, restated

No LOS computation. No spatial block (`ADR-0047`). No `grid_entity`
reconciliation. **No fixture re-capture** (`ADR-0101`). No reopening of
`ADR-0038 § D4`'s turn-level atomicity. No repair of the 2026-08-16 campaign.
