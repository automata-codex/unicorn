---
id: ADR-0099
title: The code-built prompt surfaces get their own identity, separate from `promptHash`
area: eval-harness
status: accepted
superseded_by: null
milestone: M7.7
summary: null
---

Four things reach the Warden, and until now exactly one of them had a recorded identity. `promptHash` covers `mothership-m7.txt`. The tool definitions, the GM context block and the state snapshot are produced by `session.tools.ts`, `formatGmContextBlob` and `buildStateSnapshot` — nothing anywhere recorded what shape they were in when a run executed. A rewritten tool description, an added snapshot section, or a formatter that started emitting `openingNarration` would change what the model reads while every field the run manifest prints stayed identical, and the difference would surface only in the rates, attributed to the model.

So `manifest.assemblyHash` now fingerprints those three, alongside `promptHash` rather than replacing it.

**`harnessVersion` was already there and could not do this job.** It is the git SHA, so it moves on every commit; `eval:compare` warns on a mismatch and will therefore warn on essentially every pair of runs anyone ever compares. It can say "the repo differs", never "what the model sees differs", and a signal that fires every time is one people learn to skip. The distinction this entry exists to draw is the one a commit id cannot make: a pure refactor of a formatter must not move the identity, and a one-word edit to a tool description must.

**Widening `promptHash` instead was rejected on the historical record.** `97feadbd`, `0bdd1306`, `c45a142a` and `ccac7d1c` appear in run directory names, in `ADR-0023`, in `ADR-0085`, and in roadmap prose going back to July. Redefining what that token covers would silently reinterpret every one of those values in hindsight — the `corpusVersion` trap from `§ S35`, applied retroactively across the whole record rather than to one comparison. The split is also principled rather than merely conservative: **hash the file when the thing is a file, use a golden when what you care about is what code produces.** The Warden prompt's content is its identity; a formatter's is not.

## A frozen probe, three goldens, a live hash

`ASSEMBLY_PROBE` (`apps/zoltar-be/src/session/session.assembly.ts`) is a synthetic adventure — two NPCs, a hidden threat, a set flag and an unset one, pools, armor, a condition, a scenario counter, a world fact. It is rendered through the real formatters, and the hash is taken over that render. Because the input is frozen, the output moves when and only when the *shape* moves. Fixture data changing is a different question and `corpusVersion` already answers it.

The probe is parsed through `MothershipCampaignStateSchema` rather than asserted into the type. That makes it a valid state by construction — it rejected four wrong guesses about field shapes while it was being written — and it picks up any defaulted field a future schema version adds, which is correct, since a new default can change what the snapshot renders.

The rendered text is committed as three `.txt` goldens and asserted by `session.assembly.spec.ts`. **The goldens are the reason to do this with a probe rather than by hashing source.** Two properties follow from them and from nothing else:

- **It is loud at edit time, not only at compare time.** Changing any of the three surfaces fails a test, and the fix is committing an updated golden — so the change arrives in review as a diff of the text the Warden actually receives, rather than as a formatter edit whose effect a reviewer has to simulate. This is precisely the check that was missing when M7.6 added fourteen descriptions under `stateChanges` and nobody noticed the five properties above it had none (`ADR-0097`).
- **A refactor that produces identical text moves nothing.** Rename a variable, reorder a function: hash stable, test green, nobody disturbed.

Updating is an explicit `UPDATE_ASSEMBLY_GOLDENS=1` run rather than something the suite does for itself. A golden that self-heals asserts nothing.

**The hash is computed live from the render, never read from the goldens**, so it cannot go stale relative to the code — the goldens are the human-readable artifact and the test is what keeps them honest. It is 8 hex chars from `hashPromptText`, matching `promptHash` so the two read alike in a manifest. Current value: `0bb41002`.

Verified by mutation rather than by argument: adding four words to the `submit_gm_response` description moved the hash to `22d3aa3f` and failed the `tools.txt` golden by name.

## Absent is reported as unknown, never as a match

The manifest field is optional and `schemaVersion` stays at `1`, so the runs already on disk keep parsing. Every one of them predates the field, and `eval:compare` says so explicitly rather than pairing them silently — "whether the two sides saw the same tool definitions, GM context and state snapshot is unknown rather than confirmed". Rendering an absent value as agreement is the failure the field exists to prevent, arriving through the back door.

`assertManifestMatches` checks it too, which is the smaller half of this entry and the one with teeth today: `--run-dir` appends reps to an existing run, and doing that after a tool-schema edit would put two different prompts under one run id. The guard already covered `model` and `promptHash`; this belongs beside them, and it is skipped — not failed — when the manifest carries no hash, because a mismatch that cannot be observed must not be asserted.

## What it deliberately does not cover

**The Warden prompt.** `promptHash`, unchanged. A golden of it would be a copy of the file.

**Fixture data.** `corpusVersion`, unchanged — a content hash over fixture bytes. Note it does *not* move when a checker changes, which is why the `TOOL-SYNTAX-LEAK` addition left it at `1c2a418cf68c`; that gap is `harnessVersion`'s to fill and it fills it badly, for the reasons above. Extending this mechanism to the checker registry is a reasonable next step and is not taken here.

**Playtest telemetry.** `adventure_telemetry` records `snapshotSent` but stores the GM context render as a *count* (`originalRequest.systemBlocks`), so the assembled prompt is only half recoverable for a playtest — where eval runs archive it in full in `warden-request.json`. That asymmetry is backwards, since the playtest is what fixture capture reads from, and it is left open rather than fixed here: the proportionate shape is probably a per-turn hash plus the full text once per adventure, not 7.5 KB × 58 turns.

**Naming.** `assemblyHash`, not `promptShapeHash`. `buildSessionRequest` is the assembly step and that is exactly what is fingerprinted; a name beginning with `prompt` would read as a variant of `promptHash` when the two are "the file" and "everything else".

**Addendum — `assemblyHash` is a function of the build, not of the commit, and a stale workspace package produces a hash no commit corresponds to.** Recorded 2026-08-21 from the spec 019 re-baseline, `claude-sonnet-5__6717347d__2026-08-21T21-14-59Z`.

That run recorded `harnessVersion 1458aaf` and `assemblyHash 8e332e38`. The same commit produces **`6dc28608`** on a machine with a current workspace build, which is the value spec 019 pre-registered. The gap is `@uv/game-systems`: the eval host was running a `dist` built before `ADR-0101` added `revealed` to `EntitySchema`, and `ASSEMBLY_PROBE.campaignStateData` is constructed with `MothershipCampaignStateSchema.parse` — so Zod stripped the unknown key and the probe rendered `undiscovered` for entities that carry `revealed: true`. Reproduced exactly: deleting `revealed` from the probe's entities before rendering yields `8e332e38` to the character.

**Nothing the Warden read was wrong, which is what makes this worth recording rather than merely fixing.** The probe feeds the hash and the goldens and is never sent; fixtures reach the turn path through a cast (`session.service.ts:282`) rather than a parse, so `revealed` rendered correctly in every request — verified against the archived `warden-request.json`, and the run's tool definitions are byte-identical to the committed `tools.txt`. The measurement stands. What is wrong is the label on it.

**Two holes this exposes.**

- **The hash absorbed a dependency version silently, which is the failure mode this entry exists to prevent, one level out.** `ADR-0099` reasoned about edits to *our* source moving the hash. It did not consider that the same source can render two different surfaces depending on what `node_modules` and the workspace `dist` hold, and a hash that varies with the build cannot serve as run identity — `eval:compare` pairs on it and will call two runs incomparable, or comparable, for reasons no commit explains.
- **The goldens would have caught it and were not run.** `session.assembly.spec.ts` asserts the rendered surfaces match the committed files; against a stale `@uv/*` build it fails. A green `npm test` on the eval host is therefore a precondition for a run being labelled, and nothing enforces that today.

**Not fixed here.** The obvious candidates — fold resolved `@uv/*` versions into the hash, or have `eval:run` refuse to start unless the assembly goldens pass — are a change with its own design questions, and the entry that records the requirement should not also invent the mechanism. Tracked in `roadmap.md § M7.7`.

**Addendum, 2026-08-23 — the playtest-telemetry gap is closed, and the shape this entry
proposed for it was wrong.**

This entry left the GM context render *"only half recoverable for a playtest"* and suggested
*"a per-turn hash plus the full text once per adventure."* That shape assumed the blob is
essentially static. Spec 019 Part 4a established that it is not.

**Recomputing after the fact does not work either.** `gm_context` (`db/schema.ts:202`) is a
single mutable row with an `updatedAt` and no history: turn 0 survives in
`adventure_synthesis_snapshots`, the current value is live, and every intermediate state is
gone. Nine of 58 turns of the 2026-08-16 playtest wrote `npcStates`, which destroyed the
cartographer's authored agenda ([[0101-visible-is-line-of-sight-not-discovery-only-position-is-stru]]),
and nothing can now say which turns read the original and which read the mood note that
replaced it.

**So the once-per-adventure copy would have been actively misleading.** The hash would tell
you the text changed while the single stored copy is the wrong text — leaving a reader
certain they had lost something and unable to recover it.

**Store-on-change instead, and that is what shipped.** `adventure_telemetry.payload` is
JSONB, so the render lands as `originalRequest.gmContext: { hash, text? }` — hash every turn,
`text` only when it moves off the previous turn, and always on a turn whose predecessor is
unknown, which is the safe direction. The previous hash is read inside the same transaction
before the insert (`latestGmContextHash`), in the repository layer. `systemBlocks` stays as a
count beside it; it answers a different question. **Absent `text` means identical to the last
turn that carried text, never unknown**, and that is asserted rather than assumed.

One copy on a quiet adventure, ten on the 2026-08-16 playtest, and this entry's 7.5 KB × 58
worst case only for an adventure that genuinely rewrote its context every turn — which would
itself be worth seeing.

**The asymmetry this closes was backwards.** Eval runs archive the whole assembled request in
`warden-request.json` and are replays of things that already happened; the playtest is what
fixture capture reads *from*, so the artifact needing the most provenance had the least.
