# 017 — reference inventory

Working artifact, produced by `docs/tooling/references.core.ts` before any
reference was rewritten. Delete after execution.

Scope is the ADR source files under `docs/decisions/` plus the seven other
living docs. `docs/decisions.md` is not scanned — it is generated, so a
rewrite there is discarded by the next build. `specs/`, `plans/`, and
`milestones/` are frozen historical records and are out of scope.

## Totals

263 `§` tokens across 100 files.

| Class | Count | Disposition |
|---|---|---|
| resolves | 0 | Rewritten automatically to a bare `ADR-NNNN` token |
| ambiguous | 20 | **Left in place. Needs Alex.** |
| out of scope | 239 | Untouched — numeric citations, other documents, intra-document sections |
| unresolved | 4 | **Left in place. The rot report.** |

## Files with at least one in-scope reference

| File | resolves | ambiguous | out of scope | unresolved |
|---|---|---|---|---|
| `decisions/0012-rules-ingestion-pipeline-and-retrieval-quality-are-separate.md` | 0 | 2 | 0 | 0 |
| `decisions/0019-query-preprocessing-for-rules-lookup-promoted-from-optional.md` | 0 | 1 | 9 | 0 |
| `decisions/0023-warden-model-upgraded-to-claude-sonnet-5.md` | 0 | 2 | 1 | 0 |
| `decisions/0032-entity-and-resource-pool-identifiers-use-underscores-only.md` | 0 | 1 | 3 | 0 |
| `decisions/0036-player-resource-pools-are-derived-at-character-creation-not.md` | 0 | 1 | 0 | 0 |
| `decisions/0045-rolltype-gatedbyrollid-actingentityid-on-roll-dice-stay-defe.md` | 0 | 1 | 2 | 0 |
| `decisions/0080-open-the-undecided-discipline-has-never-been-extended-to-jud.md` | 0 | 1 | 1 | 0 |
| `decisions/0085-prompt-work-during-a-re-baseline-is-triggered-by-attribution.md` | 0 | 0 | 3 | 1 |
| `roadmap.md` | 0 | 2 | 55 | 2 |
| `rules-extraction-findings.md` | 0 | 7 | 97 | 0 |
| `eval-methodology.md` | 0 | 1 | 15 | 0 |
| `schema.md` | 0 | 1 | 3 | 0 |
| `api.md` | 0 | 0 | 0 | 1 |

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
| `roadmap.md:287` | Query preprocessing for rules_lookup... | ADR-0019 |
| `roadmap.md:292` | No similarity floor for rules_lookup | ADR-0020 |
| `rules-extraction-findings.md:1292` | Embedding model | ADR-0011 |
| `rules-extraction-findings.md:2826` | Character-creation content is excluded from the rules index | ADR-0016 |
| `rules-extraction-findings.md:3015` | Character-creation content is excluded from the rules index | ADR-0016 |
| `rules-extraction-findings.md:3311` | No similarity floor for rules_lookup | ADR-0020 |
| `rules-extraction-findings.md:3330` | warden-output.json is the full serialized TurnExecutionResult | ADR-0065 |
| `rules-extraction-findings.md:4676` | Agentic graph decomposition | ADR-0044 |
| `rules-extraction-findings.md:4765` | Structural checks report undecided rather than guessing | ADR-0078 |
| `eval-methodology.md:314` | The retrieval stopping rule is measured on the metrics with headroom | ADR-0022 |
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
| `roadmap.md` — `§ Open questions` | **Not rot.** Targets `rules-extraction-findings.md ## Open questions` (line 370). The author omitted the path; the two neighbouring references in the same parenthesis are `§ S3.7` and `§ S2`, which are that document's sections too. Out of scope — leave it. |
| `roadmap.md` — `§ Design documentation discipline` | **Rot.** The phrase appears nowhere in `docs/` as a heading or an entry title. The M9 bullet cites a policy for `docs/specs/zoltar/` being ephemeral, and that policy is not where the citation says it is. |
| `api.md` — `docs/decisions.md § Player-Action Endpoint Shape` | **Rot.** Names the decisions log explicitly. No entry has this title, and nothing close to it exists. |
| `decisions/0085-…` — `§ Don't pay for the same re-baseline twice` | **Rot.** The phrase occurs only in the sentence doing the citing. Either the target entry was renamed, or the rule it names was never written down as an entry. |

The first is a classifier limitation and is expected — a path-less reference
into another document is shape-identical to a decisions reference. The other
three are exactly the drift this restructure exists to stop.

### Note on the count

An earlier pass reported 21 ambiguous. One of those — `§ Warden model upgraded
to`, in `decisions/0082-…` — was an extractor bug rather than an author
truncation: the reference wrapped across two lines without being inside a code
span, and the extractor stopped at the line break. It cites the full title and
now resolves to `ADR-0023`. The remaining 20 are genuine.
