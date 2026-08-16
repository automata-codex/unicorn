---
id: ADR-0021
title: The D&D-5e-bias hypothesis has a confirmed instance, in the schema rather than in retrieval
area: rules-retrieval
status: accepted
superseded_by: null
milestone: M7.6
summary: null
---

The hypothesis — that the Warden's out-of-corpus vocabulary is specifically D&D 5e lexicon
bleeding into Mothership play, rather than generic TTRPG vocabulary — was recorded in
`docs/rules-extraction-findings.md` as named-but-untested open question. The retrieval-side version
remains untested; nothing below measures a query.

**But the M7.6 code inventory found 5e mechanics in the Mothership character sheet and
pool definitions, which nobody was looking at when the hypothesis was formed.** Two
instances, both cited against `milestones/m7.6-code-inventory.md` at `e1cdaac`:

- **`level: z.number().int().min(1).max(10).default(1)`**
  (`packages/game-systems/src/mothership/character-sheet.schema.ts:15`). Mothership has no
  levels. Advancement is Skill Training (§24.1, measured in years and credits) and Shore
  Leave converting Stress into permanently improved Saves (§39.1). The field has no
  producer and no consumer anywhere in the repo — absent from
  `formatMothershipCharacterProse`, absent from the frontend's hand-written
  `CharacterSheet` type, absent from both create and edit forms. A levels concept with a
  1–10 range arrived from somewhere, and it was not the Player's Survival Guide.
- **`HP_DEFINITION = { min: null, max: null, thresholds: [{ value: 0, effect:
  'death_save_required' }] }`** (`packages/game-systems/src/mothership/pool-definitions.ts`).
  That is the 5e rule — 0 HP sends you to death saving throws. Mothership's rule is
  different in kind: Health reaching zero gives a **Wound** and a roll on the Wounds Table,
  Health resets to Maximum minus carryover, and the Death Save comes only when Wounds
  equal Maximum Wounds (§28.2, §29.1–29.2). There is no `maxWounds` field on the sheet and
  no wounds pool definition, so the entire Wounds layer is absent and the code substitutes
  the 5e shortcut for it.

**Why this is worth an entry rather than a bug report.** The two defects are individually
fixable in M7.6 and would not need recording. What needs recording is the *pattern*: 5e
mechanics entered a Mothership artifact silently, at authoring time, and survived M2, M3,
M5, M6 and M7 without anyone noticing. The hypothesis predicted this happening in the
Warden's queries at runtime. Finding it instead in a schema written by hand, in a
different artifact, at a different time, is independent evidence for the same underlying
cause and is stronger than another instance of the predicted kind would have been.

**The drift went the wrong way, which rules out inheritance.** The retired
`apps/zoltar-playtest` prototype carried `sanity` under `saves` (correct — Sanity is a Save,
§18.2), no `instinct`, and no `level`
(`apps/zoltar-playtest/src/lib/types.ts`, via the inventory). The production schema has
`sanity` and `instinct` under `stats` and a `level` field. So the current shape was
authored rather than inherited from the prototype, and it is *less* faithful than what
preceded it.

**A third instance, weaker, recorded for completeness.** `stats.instinct`
(`character-sheet.schema.ts:21`) is not a 5e import — Instinct is a real Mothership stat,
but it belongs to **Contractors** (§40.1), the simplified NPC statblock where it is the
catchall standing in for Fear, Sanity, Body, Speed and Intellect. It is not a
player-character attribute. This is the same failure mode as the two above — a mechanic
from an adjacent model applied to the PC sheet — with a different adjacent model.

**What this does and does not license.**

- It **does** justify treating "check for 5e assumptions" as a standing review question on
  any Mothership artifact authored without the book open, and specifically on the M7.6
  spec, which is being written to correct exactly these fields.
- It **does not** validate the retrieval-side claim. The vocabulary gap measured in
  `ADR-0019`
  (amendment) splits 157 wrong-word / 130 concept-absent out of 344, and *which* lexicon
  those out-of-corpus terms come from is still unmeasured. Confirming the hypothesis in
  one artifact does not confirm it in another, and the mechanical-model primer's design
  should not start assuming 5e as the source.
- The cheap test remains available and is still not run: classify the 130 concept-absent
  queries by whether the named mechanic exists in 5e. Flanking, suppressive fire, opposed
  rolls and DCs all do. That is a labelling pass over data already in `unicorn-artifacts`,
  with no Warden run and no API spend.

Roadmap: `docs/roadmap.md § M7.6 — Character Sheet Fidelity`.
