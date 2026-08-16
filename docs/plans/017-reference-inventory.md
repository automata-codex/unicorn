# 017 — reference inventory

Working artifact, produced by `docs/tooling/references.core.ts` before any
reference was rewritten. Delete after execution.

Scope is the ADR source files under `docs/decisions/` plus the seven other
living docs. `docs/decisions.md` is not scanned — it is generated, so a
rewrite there is discarded by the next build. `specs/`, `plans/`, and
`milestones/` are frozen historical records and are out of scope.

## Totals

309 `§` tokens across 100 files.

| Class | Count | Disposition |
|---|---|---|
| resolves | 45 | Rewritten automatically to a bare `ADR-NNNN` token |
| ambiguous | 21 | **Left in place. Needs Alex.** |
| out of scope | 239 | Untouched — numeric citations, other documents, intra-document sections |
| unresolved | 4 | **Left in place. The rot report.** |

## Files with at least one in-scope reference

| File | resolves | ambiguous | out of scope | unresolved |
|---|---|---|---|---|
| `decisions/0011-embedding-model-voyage-4-lite-chosen-together-with-the-colum.md` | 1 | 0 | 0 | 0 |
| `decisions/0012-rules-ingestion-pipeline-and-retrieval-quality-are-separate.md` | 1 | 2 | 0 | 0 |
| `decisions/0019-query-preprocessing-for-rules-lookup-promoted-from-optional.md` | 0 | 1 | 9 | 0 |
| `decisions/0021-the-d-d-5e-bias-hypothesis-has-a-confirmed-instance-in-the-s.md` | 1 | 0 | 7 | 0 |
| `decisions/0023-warden-model-upgraded-to-claude-sonnet-5.md` | 1 | 2 | 1 | 0 |
| `decisions/0026-state-placement-is-decided-by-the-lifetime-of-the-referent-n.md` | 2 | 0 | 2 | 0 |
| `decisions/0027-character-sheet-stores-identity-and-build-not-live-mutable-s.md` | 5 | 0 | 5 | 0 |
| `decisions/0030-typed-system-specific-fields-on-tool-schemas-are-acceptable.md` | 2 | 0 | 1 | 0 |
| `decisions/0032-entity-and-resource-pool-identifiers-use-underscores-only.md` | 0 | 1 | 3 | 0 |
| `decisions/0036-player-resource-pools-are-derived-at-character-creation-not.md` | 1 | 1 | 0 | 0 |
| `decisions/0045-rolltype-gatedbyrollid-actingentityid-on-roll-dice-stay-defe.md` | 0 | 1 | 2 | 0 |
| `decisions/0046-actingentityid-must-resolve-against-a-declared-identifier-se.md` | 2 | 0 | 2 | 0 |
| `decisions/0049-the-character-attributes-snapshot-block-is-specified-but-def.md` | 1 | 0 | 1 | 0 |
| `decisions/0053-one-active-adventure-per-campaign.md` | 1 | 0 | 0 | 0 |
| `decisions/0054-adventure-state-gets-its-own-row-not-an-adventure-tag-on-cam.md` | 5 | 0 | 0 | 0 |
| `decisions/0080-open-the-undecided-discipline-has-never-been-extended-to-jud.md` | 0 | 1 | 1 | 0 |
| `decisions/0082-a-rate-that-never-moves-is-a-harness-suspect-not-a-finding.md` | 0 | 1 | 0 | 0 |
| `decisions/0085-prompt-work-during-a-re-baseline-is-triggered-by-attribution.md` | 2 | 0 | 3 | 1 |
| `roadmap.md` | 15 | 2 | 55 | 2 |
| `rules-extraction-findings.md` | 1 | 7 | 97 | 0 |
| `eval-methodology.md` | 2 | 1 | 15 | 0 |
| `tools.md` | 1 | 0 | 2 | 0 |
| `schema.md` | 0 | 1 | 3 | 0 |
| `api.md` | 0 | 0 | 0 | 1 |
| `rules-ingestion.md` | 1 | 0 | 1 | 0 |

## Ambiguous — author-truncated titles

Each reference below is a prefix of exactly one entry title, so the target is
determined rather than guessed — but the author wrote less than the full title,
and the spec reserves this class for human confirmation.

| Location | Reference text | Candidate |
|---|---|---|
| `decisions/0012-rules-ingestion-pipeline-and-retrieval-quality-are-separate.md:19` | Agentic graph decomposition stays deferred | ADR-0044 |
| `decisions/0012-rules-ingestion-pipeline-and-retrieval-quality-are-separate.md:19` | rollType / gatedByRollId / actingEntityId on roll_dice stay deferred | ADR-0045 |
| `decisions/0019-query-preprocessing-for-rules-lookup-promoted-from-optional.md:17` | Rules retrieval mechanism | ADR-0018 |
| `decisions/0023-warden-model-upgraded-to-claude-sonnet-5.md:51` | `actingEntityId` must resolve against a declared identifier set | ADR-0046 |
| `decisions/0023-warden-model-upgraded-to-claude-sonnet-5.md:83` | A rate that never moves is a harness suspect | ADR-0082 |
| `decisions/0032-entity-and-resource-pool-identifiers-use-underscores-only.md:59` | Adventure state gets its own row… | ADR-0054 |
| `decisions/0036-player-resource-pools-are-derived-at-character-creation-not.md:27` | actingEntityId must resolve against a declared identifier set | ADR-0046 |
| `decisions/0045-rolltype-gatedbyrollid-actingentityid-on-roll-dice-stay-defe.md:28` | out-of-order-resolution reads the deferred gate | ADR-0079 |
| `decisions/0080-open-the-undecided-discipline-has-never-been-extended-to-jud.md:15` | actingEntityId must resolve against a declared identifier set | ADR-0046 |
| `decisions/0082-a-rate-that-never-moves-is-a-harness-suspect-not-a-finding.md:23` | Warden model upgraded to | ADR-0023 |
| `roadmap.md:287` | Query preprocessing for rules_lookup... | ADR-0019 |
| `roadmap.md:292` | No similarity floor for rules_lookup | ADR-0020 |
| `rules-extraction-findings.md:1292` | Embedding model | ADR-0011 |
| `rules-extraction-findings.md:2827` | Character-creation content is excluded from the rules index | ADR-0016 |
| `rules-extraction-findings.md:3016` | Character-creation content is excluded from the rules index | ADR-0016 |
| `rules-extraction-findings.md:3312` | No similarity floor for rules_lookup | ADR-0020 |
| `rules-extraction-findings.md:3331` | warden-output.json is the full serialized TurnExecutionResult | ADR-0065 |
| `rules-extraction-findings.md:4677` | Agentic graph decomposition | ADR-0044 |
| `rules-extraction-findings.md:4766` | Structural checks report undecided rather than guessing | ADR-0078 |
| `eval-methodology.md:316` | The retrieval stopping rule is measured on the metrics with headroom | ADR-0022 |
| `schema.md:403` | Chunk extraction is block-based... | ADR-0014 |

## Unresolved — matches no entry title

The rot report. Do not guess a target for these.

| Location | Reference text |
|---|---|
| `decisions/0085-prompt-work-during-a-re-baseline-is-triggered-by-attribution.md:26` | Don't pay for the same re-baseline twice |
| `roadmap.md:286` | Open questions |
| `roadmap.md:366` | Design documentation discipline |
| `api.md:140` | Player-Action Endpoint Shape |

### Hand analysis of the unresolved four

Checked individually rather than left as a bare list, because "unresolved" is
the class that matters and three of these are real.

| Location | Verdict |
|---|---|
| `roadmap.md:286` — `§ Open questions` | **Not rot.** Targets `rules-extraction-findings.md ## Open questions` (line 370). The author omitted the path; the two neighbouring references in the same parenthesis are `§ S3.7` and `§ S2`, which are that document's sections too. Out of scope — leave it. |
| `roadmap.md:366` — `§ Design documentation discipline` | **Rot.** The phrase appears nowhere in `docs/` as a heading or an entry title. The M9 bullet cites a policy for `docs/specs/zoltar/` being ephemeral, and that policy is not where the citation says it is. |
| `api.md:140` — `docs/decisions.md § Player-Action Endpoint Shape` | **Rot.** Names the decisions log explicitly. No entry has this title, and nothing close to it exists. |
| `decisions/0085-…:26` — `§ Don't pay for the same re-baseline twice` | **Rot.** The phrase occurs only in the sentence doing the citing. Either the target entry was renamed, or the rule it names was never written down as an entry. |

The first is a classifier limitation and is expected — a path-less reference
into another document is shape-identical to a decisions reference. The other
three are exactly the drift this restructure exists to stop, and they are now
the kind of thing `task docs:decisions:check` catches at commit time rather
than by hand review a milestone later.
