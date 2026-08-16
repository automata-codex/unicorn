---
id: ADR-0030
title: Typed system-specific fields on tool schemas are acceptable while one system is supported
area: claude-tool-schemas-state
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

`damageType` on the pool-delta object (M7.6) is the first **rules-semantic** field on a
tool schema — a field whose permitted values come from one book. `rollType` is arguably
system-flavoured, but it names a category of interaction; `damageType` names five specific
columns of Mothership's Wounds Table (PSG §29.1): Blunt Force, Bleeding, Gunshot, Fire &
Explosives, Gore & Massive.

The generic alternative is `properties: Record<string, unknown>`, validated per system.
**Deferred, for the same reason the synthesis driver registry is deferred**
(`ADR-0037`): until a second system
exists, any interface is a guess shaped entirely by Mothership's needs, and the second
system is likelier to reveal the right abstraction than to conform to a premature one.

**What the typed field buys that a container does not.** The value is not only schema
shape — it is a prompt instruction and a closed enum the Warden selects from. Typed,
`gore_massive` is checkable and `slashing` is rejected at the tool boundary. Under
`properties`, that validation moves into a per-system Zod refinement or it disappears.
The first is fine; the second reintroduces `UNAUDITABLE-MAPPING` through a side door.
Note also that the machinery which would dispatch per-system validation does not exist in
this path today: pool behaviour is selected by pool key
(`ADR-0029`), not by
campaign system.

**The trigger to generalize is the second system needing a *different* field, not this
system needing a second field.** If Mothership later wants `woundSeverity` alongside
`damageType`, that is two typed fields and still fine. When OSE needs `saveCategory` and
Infinity needs `momentumSpend`, the object carries three mutually exclusive fields each
null for two systems out of three — and at that point the container is cheaper than the
union. Phase 2 is when this is discovered, and deferring costs nothing because the change
is additive either way.

**One asymmetry that argues for watching this closely rather than filing it.** The
pool-delta object is precisely where four fields landed simultaneously in M7.6 to avoid
paying for two re-baselines. Every future change to it carries that same cost. So the
question is not only whether `damageType` is the right shape, but how many more times this
object will be opened — and if the answer turns out to be once per system, the container
is cheaper than it looks today.

Recorded now as a recognised boundary with a named trigger, so that the Phase 2
implementer meets a decision rather than a surprise.
