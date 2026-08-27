---
id: ADR-0032
title: Entity and resource pool identifiers use underscores only
area: claude-tool-schemas-state
status: accepted
superseded_by: null
milestone: unknown
summary: >-
  Identifiers carry underscores only, and why dots and hyphens were rejected. The
  addendum retires the `{entity_id}_{pool_name}` composite key in favour of
  owner-nested pools without disturbing the rule itself, and records the cost that is
  easy to miss: merges must become deep, where two existing merge points are shallow.
---

Dots in identifier strings cause subtle bugs when code uses dot-notation property access on JSON keys. Hyphens are legal but inconsistent with TypeScript naming conventions. Underscores are unambiguous. Resource pools follow the pattern `{entity_id}_{pool_name}`: `dr_chen_hp`, `vasquez_stress`.

**Addendum — the composite pool key is retired; the underscore rule for identifiers is not**

M7.6 nests resource pools by entity —
`resourcePools: { [entityId]: { hp: { current, max }, … } }` — replacing the
`{entity_id}_{pool_name}` composite key this entry specifies. `dr_chen_hp` becomes
`resourcePools.dr_chen.hp`.

**The rule this entry states is unaffected.** No identifier gains a dot: `dr_chen` and `hp`
are separate keys, each still underscores-only, and the dot-notation hazard the entry
describes does not arise because nothing parses a composite string. What lapses is only the
naming *pattern* in the final sentence.

**Why nest.** The composite key made pool identity a convention enforced by suffix matching
— `getMothershipPoolDefinition` tests `*_hp` and `*_stress`, correct only while no entity id
ends in a pool name. At ten pools per character that guarantee thins, and a `_max_hp`-shaped
key would break it outright. Nesting removes the parse rather than hardening it: the
selector receives the pool name directly.

Two defects close as a side effect. `CharacterService.delete` left derived pools orphaned
because removing them meant a prefix scan; nested it is `delete pools[entityId]`. And the
`alvarez` / `lt_alvarez` duplicate this entry's neighbouring amendment describes becomes
*visible* — two sibling keys with overlapping pool sets read as obviously wrong in a
rendered snapshot, where eight scattered flat keys did not. It does not prevent that defect,
which was two entity ids rather than a key-format failure.

**The cost, recorded because it is easy to miss.** Merges must become **deep**.
`mergePlayerResourcePools` (preserve-on-conflict) and `applyValidatedTurn` (plain shallow
spread) both operate at the top level. Nested, a shallow spread at the entity level clobbers
every pool that entity owns when one is written. The pre-existing disagreement between those
merge points acquires a much larger blast radius per key.

**The tool payload does not nest.** `stateChanges.resourcePools` becomes an array of
self-describing entries — `{ entityId, pool, delta, maxDelta?, reason, damageType? }` —
rather than a keyed map. Nested state does not require a nested payload, and the array
avoids string parsing on ingest without asking the Warden to generate nested JSON.

*(Member names corrected from `state_changes.resource_pools` — a transcription slip. The
five existing `stateChanges` members are camelCase, `session.schema.ts:15-45`, and no
decision here was choosing a naming convention. Spec §2.1 carries the same slip and is
amended alongside.)*

**Amendment.** This addendum describes the nesting as keyed "by entity," written before D1
was settled. D1-A constrains nothing about ownership: `resourcePools` nests by **owner**,
and pools with no entity owner take the reserved owner `_scenario`
(`docs/plans/016-m7.6-character-sheet-fidelity-implementation-plan.md` D1-A.1). Entity ids
may not begin with `_`; reserved owners must. See also
`ADR-0054`, addendum, on why owner and scope are orthogonal.

Spec: `docs/specs/zoltar/016-m7.6-character-sheet-fidelity.md` §1.3, §2.1.
