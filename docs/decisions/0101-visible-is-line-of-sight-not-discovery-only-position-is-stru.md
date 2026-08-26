---
id: ADR-0101
title: '`visible` is line of sight, not discovery — only position is structurally withheld'
area: claude-continuity-spatial
status: accepted
superseded_by: null
milestone: M7.7
summary: null
---

**Confirmed 2026-08-21.** `docs/hidden-information-findings.md` recorded an unplanned M7.7 finding and left five open questions, the first of which — *is the resource-pool leak a defect, or is the design doc's claim too strong?* — was framed as a binary. It resolves to neither. **`visible` is overloaded**, and once the two concepts inside it are separated, the leak stops being a leak and four of the five questions close with it.

**`visible` means line of sight, and line of sight is transient and bidirectional.** The design doc's own example is a goblin that ducks behind a column: it was visible, now it is not, and it can be visible again next turn. That is a per-moment fact about what a player character can currently perceive. **What the playtest actually used the field for was discovery** — `signal_source_entity` sat `visible: false` for all 58 turns as a marker that the mystery had not been solved yet, which is a monotonic narrative gate and a different thing entirely. Under line-of-sight semantics that entity should have flipped `true` when Dr. Kennedy entered its chamber and `false` again on leaving.

**The field is described nowhere, so both readings were available and the model picked one.** `visible` is a bare `z.boolean()` in the synthesis schema (`synthesis.schema.ts:25`) and a bare `z.boolean().optional()` in `submit_gm_response` (`session.schema.ts:275`); neither carries a `.describe()`, `mothership-m7.txt` never mentions visibility, and no synthesis prompt does either. Every model that reads or writes the field is inferring its meaning from the word. This is the shape `ADR-0097` addendum 2 named on the top-level response properties — an absent description is a gap, not brevity.

**The synthesis model reconstructed the missing concept in the flags namespace.** The playtest campaign carries `secret_signal_origin_revealed: false` and `secret_cut_corners_revealed: true` alongside `signal_source_entity.visible: false`. It modelled discovery *and* perception, and the entity schema had a slot for only one, so discovery leaked into flags. A schema that makes its writers invent the same field twice is describing a shape it does not have.

**Decision, in three parts.**

- **`visible` is line of sight.** Transient, bidirectional, Warden-authored, meaningful only about entities a player character could perceive right now.
- **A new `revealed` field carries discovery**, and it is monotonic — `false` to `true` and never back. Entity-scoped secrets live here; narrative secrets with no entity (`secret_cut_corners_revealed` is about a denied parts requisition, not a thing on the ship) stay flags. The two are complementary, not a migration of one into the other.
- **The whole entity map is emitted to the Warden every turn, `visible` and `revealed` included.** `renderEntities`' visibility filter (`session.snapshot.ts:309`) is removed.

**Removing that filter discloses far less than it appears to, because the structural mechanism was already not operating.** `formatGmContextBlob` (`session.prompt.ts:52`) emits every entity in the GM context blob — hidden ones tagged `starts hidden` in as many words — into the first cached system block on every turn, ahead of the state snapshot. The entity's existence, id, type and tags are already in the prompt, along with a `hidden_truth` line carrying the mystery in prose. The only genuinely new information the removal adds is **the current value of the flag**, which is precisely what a Warden adjudicating line of sight cannot work without: to decide whether the goblin steps out of the shadow it has to know the goblin is in one.

**The design doc is amended rather than the code.** `docs/zoltar-design-doc.md § The Hidden Layer` (line 263) claims *"The goblin isn't in the prompt."* That is too strong about the entity's **existence** and exactly right about its **position**. The amended claim is narrower and survives contact with the code: an entity's existence, identity and state are GM context, withheld **behaviourally**; an entity's **position** is withheld **structurally**. The two-mechanism model stands — the boundary between the mechanisms moves.

**Structural secrecy is narrowed, not abandoned, and the narrowing is deliberately forward-looking.** No renderer emits grid position and the M7 snapshot has no spatial block at all, so today the structural half is vacuous. It stops being vacuous when the 2D renderer ships: `grid_entity` already carries its own `visible` column, written at synthesis by `buildGridEntityRows` (`synthesis.write.ts:300`), and filtering position rows by line of sight is where structural secrecy will actually live. Stating the decision as "entity data is always visible" without this scoping would foreclose that.

**Four of the five open questions in `hidden-information-findings.md` close as consequences, not as separate calls.** (2) — where does a pool filter belong — is moot, because there is no filter. (4) — the other unfiltered renderers — is answered: they are correct, and were never wrong. (5) — does the fixture corpus need re-capture — resolves to **no**, which is the most valuable consequence: the four fixtures freezing a hidden entity's pools are freezing correct behaviour, and no `corpusVersion` bump or re-scoring is owed. (3) was answered by measurement on 2026-08-21 and is recorded in that document.

**Two costs, both accepted.**

- **A re-baseline.** `visible` gaining a description, `revealed` appearing, and `<entities>` changing shape are all Warden-visible, so `assemblyHash` and `promptHash` both move (`ADR-0099`). This does not buy its own run: it batches, per `ADR-0094`. It was the natural occupant of the tool-schema batch M8.1 deferred to twice and never allocated; M7.7 paid for it instead.
- **`applyEntity` reports only the first bad field on an entity, and there is one correction shot.** A failed `status` returns before any other field is examined (`session.validator.ts:613-621`). This is *not* data loss — `ADR-0038 § D4`'s validate-all-then-apply guarantee discards the whole `applied` set whenever any rejection exists, and `SessionService` runs a correction round rather than committing a partial turn — but it does mean a Warden that fixes the reported problem can fail on an unreported sibling, and the correction path is single-shot, so the turn is then thrown. Adding `revealed` makes a second rejectable field on the same entity, which is what turns this from theoretical into likely.

**Scheduled into M7.7**, against the open bullet this finding already had there. M8.1 was the wrong home twice over — it is prompt-only by its own preamble, and the tool-schema batch it defers to has never been allocated. M7.7 is already paying for a re-baseline and already owns the playtest this was found in. The spec at `docs/specs/zoltar/019-entity-visibility-and-entity-write-path.md` carries the work.

**Addendum, 2026-08-21 — `gmUpdates.npcStates` destroys the agenda it merges into, and that is why `npcState` must exist on the entity.** The two are *not* the same concept under two names. `narrative.npcAgendas` holds durable authored motivation; `gmUpdates.npcStates` holds volatile per-turn disposition; and `session.applier.ts:57` merges the second over the first, keyed by entity id, silently. In the 2026-08-16 playtest the cartographer's synthesized agenda — *"withholding what they know out of guilt and fear of being blamed — they will only reveal it if pushed hard or if the situation becomes lethal enough that silence is worse than confession"* — was overwritten by *"Panic check passed (rolled 15 vs stress ~4) … shaken, voice thin, but still functional."* The conditions governing the NPC's central secret were replaced by a mood note, and every subsequent turn read the mood note under an `npc_agendas:` heading. Nine of 58 turns wrote `npcStates`. The original survives only in `adventure_synthesis_snapshots`. This makes the entity-scoped `npcState` field load-bearing rather than tidy: disposition needs a home that is not the agenda.

**Addendum, 2026-08-25 — the structural half was vacuous for *grid* position and not for
*narrative* position, and the entry did not distinguish them.**

This entry narrowed structural secrecy to position and then observed that *"no renderer
emits grid position and the M7 snapshot has no spatial block at all, so today the
structural half is vacuous."* Every clause of that is still true of the grid.
`grid_entity` holds five rows for the 2026-08-24 playtest campaign, all `z=0`, all
synthesis-assigned, Danny among the absent — player entities never enter that map — and
nothing reads any of it into the prompt. The 2D renderer remains the thing that makes
grid position load-bearing, exactly as scoped.

**What the entry did not anticipate is that Phase 1 already has a spatial model, and it
is vertical, narrative, and load-bearing without a grid.** A three-deck ship with a
single ladder shaft is a topology. The Warden narrates movement through it every turn,
and in the 2026-08-24 playtest (adventure `2c0ba938-ea80-4138-a95a-dc13e417bf2b`, 52
turns) it got that movement wrong five times. "Vacuous" was read off the absence of a
grid; what it should have been read off is whether any position reasoning was occurring
at all. It was.

**The errors are two kinds, and conflating them points the fix at the smaller half.**

*Destination-deck errors* — three instances — are failures to recall which deck a named
place is on. Turn 8: Danny leaves the bridge, stated in the same paragraph, then climbs
*down to the deck below* and arrives at the engineering records terminal, which
`worldFacts.ship_layout` places on the upper deck aft of the bridge. Turn 14: from that
same terminal alcove, *past mid-deck and on toward the lower deck* to Mara's berth;
berths are mid. Turn 19: *back down to the lower deck* to Mara's hatch, two messages
after correctly treating the cryo bay as above the lower deck. These need no position
term. The layout was in the prompt — `ship_layout` renders verbatim in all 52 snapshots,
`ladder shaft` and all — and the lookup failed against it.

*Distance-computation errors* — two instances — genuinely require position and layout
together. Turn 21 places the cryo bay *two decks from here* and the bridge *two decks
up* in one sentence; both cannot hold from one spot. Turn 28 puts the cryo bay *two decks
away* from a scene explicitly set in the mess hall, which is the same deck.

**The first kind manufactures the false premises the second kind then reasons from
correctly.** Turn 21 was narrated from Mara's berth — which turn 14 had wrongly placed
on the lower deck seven turns earlier. From the lower deck, *bridge two decks up* is
right. The distance arithmetic was sound; the position it operated on was a fiction the
Warden had authored itself and never recorded. That ordering matters for the fix: the
lookup failures are upstream.

**Why the lookups fail is form, not absence.** `ship_layout` is a single ~700-character
prose run carrying roughly fifteen spatial facts with no deck list and no adjacency
structure, so answering "how many decks from the mess to the cryo bay" means re-parsing
that paragraph on every turn. The errors cluster on the mid deck, which is the middle
clause of the sentence. **Eviction is not the explanation for this class** — turns 8 and
14 are early, and turn 19's error sits two messages after the same turn got the adjacent
geometry right. It compounds the second class, where it is real: messages total 95.7 KB
against a 40 KB window, prompt tokens plateau near 13.1k from turn 28 on, and
`rolling_summary` is never read, so current deck is recoverable only by reading back
through narration that is being dropped.

**One field actively misleads.** `gm_context.narrative.location` ships in the cached
system block every turn as a scenario-level descriptor fixed at synthesis — *"The colony
transport ESV Halbrecht, three weeks out from the nearest relay beacon…"*. It occupies
the slot a reader checks for *where are we* and answers *what is this scenario about*.
An absent field would be less misleading than this one. Renaming it (`scenario_premise`
or similar) is nearly free and should not wait for the rest.

**Fix ordering, and one correction to the obvious fix.** Restructuring `ship_layout`
from prose into a deck-indexed list comes first: no schema change, no snapshot section,
no write path, and it addresses the larger error class and the upstream one. Adding a
`current_location` the Warden writes through `stateChanges` — `scenarioState` is `{}`
today and already in the snapshot pipeline — comes second, **but not for the reason it
first appears.** The Warden authors that field, and no independent position source
exists to validate it against, so at turn 14 it would have written *lower deck* and
every subsequent turn would have read that back as authoritative. A wrong value in a
structured field is worse than a wrong sentence in prose, because everything downstream
treats structured fields as trustworthy — the same failure shape as a Warden supplying
its own Instinct score. The field is still worth having, and what it buys is
**auditability**: position becomes a visible value in the event log rather than an
inference from narration, and a wrong one becomes a gradeable defect.

**Consequence for the checker taxonomy.** The destination-deck class is judge-gradeable
today — a named place, a claimed deck, and `ship_layout` as ground truth in the fixture —
and becomes substantially more tractable once the layout is a lookup rather than a
paragraph. The distance class is not gradeable at all, because the position term does not
exist in state. It is a clean instance of the third structural-checker category: a
question that would be structural if the tool schema recorded an additional field. The
interim answer is `not_applicable` naming `current_location`, and if that field ships the
tag converts from judged to structural — the first worked example of that category
resolving in the direction it was defined for.

**What this does not change.** `visible` as line of sight, `revealed` as monotonic
discovery, the removal of `renderEntities`' filter, and the conclusion that no fixture
needed re-capture all stand. The two-mechanism model stands. What moves is the claim that
the structural half is presently vacuous: it is vacuous for the grid, and it was never
vacuous for the vertical topology Phase 1 has been narrating since M1.
