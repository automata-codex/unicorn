# Hidden Information — Findings

**Status: closed 2026-08-21 by `ADR-0101`, built and measured the same day.**
Spec at `docs/specs/zoltar/019-entity-visibility-and-entity-write-path.md`,
plan at
`docs/plans/019-entity-visibility-and-entity-write-path-implementation-plan.md`,
Parts 1–9 shipped. **Re-baseline
`claude-sonnet-5__6717347d__2026-08-21T21-14-59Z` passed every clause of its
pre-registered decision rule** — `HIDDEN-INFO-LEAK` 0.95 (19/20) against a 0.90
floor, and its single failure is a judge contradicting its own rationale rather
than a leak. `corpusVersion` unchanged at `abbce198026c`: no fixture was
re-captured, which was the consequence of question (5) that mattered most.
Details in the spec's `§ The run`.

What shipped, against what this document originally described: the snapshot no
longer filters, so the "leak" it opens with is now correct behaviour rather
than a defect; `revealed` exists and is monotonic; `npcState` has a writer and
a reader; `gmUpdates.npcStates` is gone and agenda amendment is explicit and
validated; entity creation is explicit; `status` is the enum at the boundary;
and every one of those fields carries a description in both tool schemas.

**Open question (1) resolved to neither of the two answers this document
anticipated.** `visible` was overloaded: it means line of sight, and the
playtest was using it as a discovery gate. Separating the two makes the pool
"leak" correct behaviour, which closes (2), (4) and (5) as consequences —
including **no fixture re-capture** — and (6) with them. (3) was answered by
measurement, below. Read `ADR-0101` before this document; what follows is the
evidence it was decided from, preserved as written.

*Original status, for the record:* **open. Nothing here has been fixed, and no
decision has been made about whether it should be.** This file records an unplanned finding from the
M7.7 assembly-golden work (2026-08-18) in enough detail that whoever picks it
up starts from the evidence rather than re-deriving it.

**Amended 2026-08-21.** Answering "how does the Warden flip a hidden entity's
visibility if the entity isn't in `<entities>`?" found that it doesn't need
to — the entity is in the system prompt on every turn, by a path this
document originally missed. That changes the premise of open questions (2)
and (3) and answers (3). See [Amendment](#amendment-2026-08-21--the-snapshot-is-not-the-only-path).

The subject is the gap between the *documented* two-mechanism hidden
information model and what the state snapshot actually emits. It is written
up separately from the roadmap because it is not a bullet — it touches the
design doc, the live playtest data, and four eval fixtures, and the right
resolution is not obvious.

There is **no ADR for the two-mechanism model.** It is design-doc material:
`docs/zoltar-design-doc.md § The Hidden Layer` (line 257), summarized at
`CLAUDE.md:51`. An earlier draft of this finding cited "ADR-0004" — that is
the session→adventure rename and has nothing to do with this.

---

## What is claimed

`docs/zoltar-design-doc.md:263`, verbatim:

> **Spatial secrets** — entities outside the party's line of sight — are
> structurally absent from the visibility-filtered state snapshot. Claude
> doesn't choose not to mention the goblin behind the column; it genuinely
> doesn't receive that entity's position data. The goblin isn't in the
> prompt.

The section closes: *"This is structural secrecy for spatial information
specifically — not for GM context generally."*

The load-bearing sentence is **"The goblin isn't in the prompt."** The
mechanism is supposed to make hidden entities unavailable rather than
merely unmentioned, which is what distinguishes it from the behavioral
mechanism governing GM context secrets.

## What actually happens

`buildStateSnapshot` (`apps/zoltar-be/src/session/session.snapshot.ts:43`)
composes six section renderers. **Exactly one of them consults visibility:**

| Renderer | Line | Filters on `visible`? |
|---|---|---|
| `renderResourcePools` | 98 | no |
| `renderCharacterAttributes` | 140 | no |
| `renderEntities` | 235 | **yes** — `session.snapshot.ts:248` |
| `renderFlags` | 257 | no |
| `renderScenarioState` | 282 | no |
| `renderWorldFacts` | 298 | no |

`campaignState.resourcePools` is keyed by owner entity id, and
`renderResourcePools` walks every owner unconditionally. So a hidden entity
that has any pool renders its **id, current value and maximum** into the
prompt, while `<entities>` correctly withholds it:

```
<resource_pools>
probe_threat.hp: 9/9          ← visible: false
</resource_pools>

<entities>
probe_player: visible, status=unknown, player_character
probe_npc_one: visible, status=alive
</entities>                    ← correctly withheld here
```

Position data is *not* leaked — the design doc's narrow claim survives. The
entity's existence, identity, and health do not.

## Evidence

**Synthetic.** Reproducible from the assembly probe; see
[Reproducing this](#reproducing-this).

**Live — playtest `5c34991b-b03e-46c4-93c1-855b13f6afb4` (2026-08-16).** The
campaign has exactly one hidden entity, and it is the centre of the
adventure's mystery:

| entity | visible | pools |
|---|---|---|
| `signal_source_entity` | **false** | `hp` |
| `deep_space_cartographer` | true | `hp`, `stress` |
| `hull_breach_cascade` | true | — |

`signal_source_entity.hp: 25/25` appears in the archived `snapshotSent` of
**all 58 turns**, in `<resource_pools>`, several lines above an `<entities>`
block that omits the entity. The id alone is a spoiler for the mystery.

Only `resourcePools` leaked it — the other four unfiltered renderers named it
on no turn. That is a property of this campaign's data, not of the code.

**Eval corpus — 4 of 15 fixtures** freeze the same shape:

| fixture | hidden entities carrying pools |
|---|---|
| `turn01-unauditable-mapping` | `decommissioned_android` (`memory_integrity`, `hp`), `veridian_contractor_alpha`/`beta`/`gamma`/`delta` (`hp`) |
| `turn02-missing-canon-capture` | same |
| `turn03-unauditable-mapping` | same |
| `turn03-unsurfaced-check` | same |

## Amendment 2026-08-21 — the snapshot is not the only path

**Everything above concerns `<state_snapshot>`. The hidden entity is also in
the system prompt, on every turn, and that is the design rather than a bug in
it.**

`formatGmContextBlob` (`apps/zoltar-be/src/session/session.prompt.ts:52`)
emits **every** entity in the GM context blob. It reads `visible` as a
*label*, not a filter:

```ts
`- ${entity.id} (${entity.type}${entity.visible ? '' : ', starts hidden'}): tags=${tags}`
```

That block is the first of the two cached system blocks
(`session.prompt.ts:148`), so it ships ahead of the state snapshot on every
turn. Rendered from the 2026-08-16 playtest's own stored blob:

```
- signal_source_entity (threat, starts hidden): tags=cosmic, communication, escalating, combat_encounter
```

— accompanied by a `hidden_truth` line carrying the mystery in full prose.

**This changes the premise of the finding above.** `renderResourcePools` is
not what puts a hidden entity's existence in the prompt. The GM context
entity roster does, for *every* hidden entity, pools or not, and more
explicitly — it says `starts hidden` in as many words. `renderEntities`'
filter is withholding from `<state_snapshot>` an id that `<gm_context>`
stated earlier in the same prompt.

So **nothing in M7 makes a hidden entity structurally absent.** The single
renderer that consults visibility is filtering data the prompt already
carries.

Whether *that* is a defect turns on the same call as open question (1), and
plausibly resolves the other way: an entity declared at synthesis is GM
context, and GM context is the behavioral mechanism's territory by design. On
that reading the design doc's "The goblin isn't in the prompt" is too strong
about the entity's *existence* and exactly right about its *position*.

### There is no reveal catch-22

The question that prompted this pass — if a hidden entity is absent from
`<entities>`, how does the Warden name it to flip `visible`? — has a
mechanical answer: it reads the id from `<gm_context>`. The structural filter
never withheld the identifier the reveal needs.

Worth stating because the alternative would be silent corruption rather than
an error: `applyEntity` has **no existence check**, so an id absent from
`currentData.entities` is *created* rather than rejected
(`session.validator.ts:626-633`). Nothing requires a revealed id to match a
declared one. Hallucinated ids are not a live problem only because
`<gm_context>` supplies the real ones.

### Open question (3), answered: the Warden used it

Across all 58 turns of adventure `5c34991b-b03e-46c4-93c1-855b13f6afb4`:

| where `signal_source_entity` appears | turns |
|---|---|
| `snapshotSent` (the pools leak) | 58 |
| `originalResponse` | 5 |
| `applied` | 0 |
| player-visible narration | 0 |

The Warden never named it to the player before the reveal and did reason
about it privately — one `gmUpdates.notes` entry weighs flipping
`secret_signal_origin_revealed`, then deliberately holds off, citing the
flag's own trigger. That is the behavioral mechanism working as intended.

**One turn proposed the reveal outright** — 2026-08-16 23:19:59 — carrying
`entities: {signal_source_entity: {visible: true, status: "manifested, stationary, vocalizing"}}`
and the matching `combat_encounter_triggered` flip. **It did not apply.**
Every `applied` bucket on that turn is empty, and `campaign_state` still
reads:

```
signal_source_entity | visible=false | status=unknown
```

**The proximate cause is the tool-syntax defect (`ADR-0097`), not anything
else in this document.** The response serialized
`<parameter name="stateChanges">…` as text inside `playerText`, so the
payload never reached the validator. The fiction has the entity manifest and
speak to the crew; the state has it hidden and `unknown`. It is one of the 39
turns `ADR-0097` already characterizes — recorded here only because the state
change it ate is the one this document is about.

The other four of the five mentions are `gmUpdates.notes` reasoning, not
proposed changes. A second turn (2026-08-17 11:42:38) also carries
`visible: true`, but on `dr_kennedy` — a death, `status: "deceased"` — and
does not name `signal_source_entity` at all. It is cited below only as the
second instance of an out-of-enum `status`.

## A second defect, independent of the above: a bad `status` discards the reveal with it

Found while answering the amendment. **Not** caused by the visibility
question, and **not** covered by the `ADR-0097` guard.

`submit_gm_response` advertises entity `status` as a free string
(`session.schema.ts:272-278`):

```ts
entities: z.record(z.string(), z.object({
  visible: z.boolean().optional(),
  status: z.string().optional(),
}))
```

`applyEntity` (`session.validator.ts:607`) validates it against
`EntityStatusSchema` — `z.enum(['alive','dead','unknown'])`,
`packages/game-systems/src/shared.ts:10` — and on failure pushes a rejection
and **returns before writing anything**:

```ts
if (change.status !== undefined) {
  const parsed = EntityStatusSchema.safeParse(change.status);
  if (!parsed.success) {
    result.rejections.push({ /* … */ });
    return;                      // ← change.visible is discarded here
  }
}
```

An entity change carrying a valid `visible: true` and an invalid `status`
therefore loses both. Both `visible: true` proposals in the playtest carried
out-of-enum statuses — `"manifested, stationary, vocalizing"` on the reveal
turn, `"deceased"` on the `dr_kennedy` death the next day — confirmed
rejected:

```
EntityStatusSchema.safeParse('manifested, stationary, vocalizing').success === false
```

They died at the tool-syntax layer first, so this never fired in the
playtest.

**Corrected 2026-08-21 — it is not silent, and the loss is recoverable.** The
paragraph above originally claimed the discarded `visible` reaches the
database. It does not. `applyEntity` pushes a rejection, and `ADR-0038 § D4`'s
validate-all-then-apply guarantee discards the *entire* `applied` set whenever
any rejection exists: `SessionService` runs one correction round and throws
`SessionCorrectionError` if that also fails (`session.service.ts:377-406`).
Verified directly — the rejection fires with `applied.entities` empty. So the
early return costs nothing observable today, and "apply the valid field" would
be unreachable code.

**What is genuinely wrong is narrower:** only the *first* bad field on an
entity is ever reported, because the return happens before any other field is
examined — and the correction path is single-shot, so a Warden that fixes the
reported problem and fails on an unreported sibling loses the turn. With one
other rejectable field this is theoretical. `ADR-0101` adds `revealed` and
`npcState`, which is what makes it likely. Carried into
`docs/specs/zoltar/019-entity-visibility-and-entity-write-path.md § Part 5`.

**Tracking.** The prompt-side half is on the roadmap: `roadmap.md § M8.1` —
*"`status`-field-overload prompt fix: `status` is strictly the
`'alive'|'dead'|'unknown'` enum; tactical and narrative detail moves to
`npcState`"*. **Superseded 2026-08-21:** that bullet moved from M8.1 to M7.7
and folds into spec 019 § Part 4 — it no longer appears in the roadmap under
either milestone — because M8.1 is prompt-only and because
`npcState` — its stated destination — turned out to have no write path at
all. The applier-side half is spec 019 § Part 5, and is a reporting-
completeness fix rather than the partial-application one this paragraph
originally proposed; `ADR-0038 § D4` settles the rest by inheritance.

## What is *not* wrong

Recorded so the next person doesn't re-litigate it.

**Position data.** No renderer emits grid position, and the M7 snapshot has
no spatial block at all. The goblin's *position* genuinely isn't in the
prompt.

**Condition parameters naming an entity.** `renderCharacterAttributes` emits
`conditions: frightened (probe_threat)` — a hidden entity's id, via the
condition's `parameter`. This looked like a second instance and is better
read as correct: a character frightened *of* something has perceived it, and
the value is Warden-authored, so it falls under the behavioral mechanism
rather than the structural one. It is pinned by a test only so a future
change to it is visible.

**The `HIDDEN-INFO-LEAK` fixtures.** `turn24-hidden-info-leak` and
`turn28-hidden-info-leak` are **not** among the four affected fixtures. An
earlier framing of this finding suggested the check's verdicts might be
misattributing a snapshot defect to the Warden; on the current corpus that
does not apply. It would apply to any *future* hidden-info fixture captured
from a campaign whose hidden entities carry pools — which the 2026-08-16
playtest's does.

## Why it matters

**The two mechanisms are supposed to be distinguishable.** The design doc is
explicit that they "work differently and should not be conflated". A hidden
entity whose HP is in the prompt is being protected behaviorally while the
documentation says it is protected structurally — and per the
[amendment](#amendment-2026-08-21--the-snapshot-is-not-the-only-path), so is
every hidden entity *without* pools, via `<gm_context>`. Any reasoning that
depends on the distinction — a security argument, a prompt-injection analysis
(`ADR-0093`), a hidden-info eval — is reasoning from a premise that does not
hold for entities with pools.

**It is silent.** Nothing fails, nothing logs, and the `<entities>` block
reads as though the filter worked. The same shape as the tool-syntax defect
(`ADR-0097`): a mechanism that appears to be functioning while a second path
routes around it.

**It compounds with fixture capture.** M7.7 captures fixtures from playtest
state. A capture from a campaign whose hidden entities carry pools freezes
the leak into the corpus permanently, and the four fixtures above show that
has already happened once.

## Open questions

1. **Is it a defect or accepted scope?** The design doc says spatial
   secrecy is "for spatial information specifically". A resource pool is
   arguably not spatial information — in which case the code is correct and
   the doc's "The goblin isn't in the prompt" is too strong. Both readings
   are defensible and they imply opposite fixes.
2. **If a defect, where does the filter belong?** Filtering
   `renderResourcePools` by owner visibility is a two-line change and would
   have hidden `signal_source_entity.hp` on all 58 turns. **Amended
   2026-08-21:** it would have hidden the *HP*, not the entity — the id was
   in `<gm_context>` on all 58 turns regardless, so this buys materially less
   than first written. But the Warden needs a hidden NPC's HP to run
   off-screen combat — the very thing that
   drove the tool-loop cap to 20 (`ADR-0023` context). A filter that starves
   it of that data may trade one defect for a worse one.
3. ~~**Does the Warden actually use it?** Unmeasured.~~ **Answered
   2026-08-21 — yes.** Named in 5 of 58 responses, once to propose the
   reveal and four times in `gmUpdates.notes` reasoning; never in
   player-visible narration. See
   [Open question (3), answered](#open-question-3-answered-the-warden-used-it).
   Note the measurement does not isolate *this* leak: the id was reaching the
   Warden through `<gm_context>` too, so it does not establish that
   `<resource_pools>` is what the Warden read.
4. **What about the other four unfiltered renderers?** `flags`,
   `scenarioState` and `worldFacts` are keyed by author-chosen strings, so a
   leak there depends on naming discipline rather than structure. No
   instance observed; not searched for systematically.
5. **Does the fixture corpus need re-capture?** Only if (1) resolves to
   "defect". Four fixtures would need re-capture or hand-patching, which is
   a `corpusVersion` bump and re-scoring of every frozen run.

6. **Added 2026-08-21 — does `<gm_context>` emitting hidden entities need its
   own answer?** It is a separate call from (1): (1) is about pools in the
   state snapshot, this is about the entity roster in the cached system
   block. If (1) resolves to "defect" on the grounds that a hidden entity's
   existence must not reach the prompt, then this is the larger instance of
   the same defect and filtering pools alone does not close it. If (1)
   resolves to "the doc is too strong", this is what the amended doc has to
   describe.

## Reproducing this

```bash
cd apps/zoltar-be
npx tsx -e "
import { buildStateSnapshot } from './src/session/session.snapshot';
import { ASSEMBLY_PROBE } from './src/session/session.assembly';
const state: any = structuredClone(ASSEMBLY_PROBE.campaignStateData);
state.resourcePools.probe_threat = { hp: { current: 9, max: 9 } };
console.log(buildStateSnapshot({
  gmContextBlob: ASSEMBLY_PROBE.gmContextBlob,
  campaignStateData: state,
}));
"
```

`probe_threat` is `visible: false` in the probe. It appears under
`<resource_pools>` and not under `<entities>`.

Against the live playtest:

```sql
-- hidden entities that carry pools
WITH s AS (SELECT data FROM campaign_state
           WHERE campaign_id = '749d2fa0-30d8-43a8-ab30-95eb0e75ec07')
SELECT e.key AS entity, (e.value->>'visible')::boolean AS visible,
       (SELECT string_agg(p.key, ', ')
          FROM jsonb_each(s.data->'resourcePools'->e.key) p) AS pools
FROM s, jsonb_each(s.data->'entities') e
ORDER BY visible, entity;

-- how many turns carried it
SELECT count(*) FILTER (WHERE payload->>'snapshotSent' LIKE '%signal_source_entity%'),
       count(*)
FROM adventure_telemetry
WHERE adventure_id = '5c34991b-b03e-46c4-93c1-855b13f6afb4';
```

For the amendment — the GM context roster is keyed by `adventure_id`, not
`campaign_id`:

```sql
-- every entity the cached system block names, hidden included
SELECT e->>'id' AS id, e->>'type' AS type, e->>'visible' AS visible
FROM gm_context g, jsonb_array_elements(g.blob->'entities') e
WHERE g.adventure_id = '5c34991b-b03e-46c4-93c1-855b13f6afb4'
ORDER BY 3, 1;

-- where the id actually appears, per turn
SELECT count(*) FILTER (WHERE payload->>'snapshotSent'     LIKE '%signal_source_entity%') AS in_snapshot,
       count(*) FILTER (WHERE payload->>'originalResponse' LIKE '%signal_source_entity%') AS in_response,
       count(*) FILTER (WHERE payload->>'applied'          LIKE '%signal_source_entity%') AS in_applied,
       count(*) AS total
FROM adventure_telemetry
WHERE adventure_id = '5c34991b-b03e-46c4-93c1-855b13f6afb4';
```

`payload->>'wardenPrompt'` is a `{hash, filename}` pointer to the static
prompt file, not the assembled prompt — `<gm_context>` is **not** archived in
telemetry, which is why grepping it for a hidden id returns nothing. Render
it from the stored blob instead:

```bash
cd apps/zoltar-be
npx tsx -e "
import { formatGmContextBlob } from './src/session/session.prompt';
// blob.json := SELECT blob FROM gm_context WHERE adventure_id = '5c34991b-…';
console.log(formatGmContextBlob(require('/tmp/blob.json')));
"
```

## What was deliberately not done

- **No behaviour changed.** No filter added, no fixture re-captured, no
  design-doc edit. Question (1) has to be answered first, and it is a design
  call rather than an implementation one. Still true after the 2026-08-21
  amendment, which is investigation written up, not code touched.
- **The `status`-discards-`visible` defect was left unfixed and unticketed.**
  It is a real defect with a one-line shape, but it belongs to the entity
  write path rather than to the hidden-information question, and filing it
  against a milestone is a scheduling call. Named here so it is not
  rediscovered from the same playtest a third time.
- **No ADR written.** There is no decision to record yet. When (1) is
  answered, the answer is an ADR — and if the resolution is "the doc is too
  strong", that ADR should amend `docs/zoltar-design-doc.md § The Hidden
  Layer` rather than leaving the two in disagreement.
- **The condition-parameter case was left alone**, for the reasons under
  [What is *not* wrong](#what-is-not-wrong).
