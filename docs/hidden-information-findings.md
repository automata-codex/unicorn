# Hidden Information — Findings

**Status: open. Nothing here has been fixed, and no decision has been made
about whether it should be.** This file records an unplanned finding from the
M7.7 assembly-golden work (2026-08-18) in enough detail that whoever picks it
up starts from the evidence rather than re-deriving it.

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
documentation says it is protected structurally. Any reasoning that depends
on the distinction — a security argument, a prompt-injection analysis
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
   have hidden `signal_source_entity.hp` on all 58 turns. But the Warden
   needs a hidden NPC's HP to run off-screen combat — the very thing that
   drove the tool-loop cap to 20 (`ADR-0023` context). A filter that starves
   it of that data may trade one defect for a worse one.
3. **Does the Warden actually use it?** Unmeasured. The 58 turns of playtest
   telemetry can answer whether any narration or state change referenced
   `signal_source_entity` before it was revealed.
4. **What about the other four unfiltered renderers?** `flags`,
   `scenarioState` and `worldFacts` are keyed by author-chosen strings, so a
   leak there depends on naming discipline rather than structure. No
   instance observed; not searched for systematically.
5. **Does the fixture corpus need re-capture?** Only if (1) resolves to
   "defect". Four fixtures would need re-capture or hand-patching, which is
   a `corpusVersion` bump and re-scoring of every frozen run.

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

## What was deliberately not done

- **No behaviour changed.** No filter added, no fixture re-captured, no
  design-doc edit. Question (1) has to be answered first, and it is a design
  call rather than an implementation one.
- **No ADR written.** There is no decision to record yet. When (1) is
  answered, the answer is an ADR — and if the resolution is "the doc is too
  strong", that ADR should amend `docs/zoltar-design-doc.md § The Hidden
  Layer` rather than leaving the two in disagreement.
- **The condition-parameter case was left alone**, for the reasons under
  [What is *not* wrong](#what-is-not-wrong).
