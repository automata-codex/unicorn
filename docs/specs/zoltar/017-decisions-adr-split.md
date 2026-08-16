# 017 — `decisions.md` → per-decision ADR files with a generated index

**Status:** ready for implementation
**Target path:** `docs/plans/017-decisions-adr-split-implementation-plan.md`
**Type:** ephemeral implementation spec (archive after execution; the living record is `docs/decisions.md` and the design doc)

---

## Context

`docs/decisions.md` is 1,806 lines across 92 entries. The bulk is concentrated: the 24 entries longer than ~15 lines account for 1,293 of those lines (76%), almost all of them M7.x-era entries carrying accumulated addenda.

Length alone would not justify a restructure this milestone. The reference graph does. Every cross-reference into the log is keyed on a verbatim prose title, and titles here are long clauses rather than identifiers. Roughly 44 references across `decisions.md` and `roadmap.md` resolve to an entry title; at least one is already truncated to an ellipsis (`§ Query preprocessing for rules_lookup...`), and a wrong citation has previously been caught by hand review rather than by tooling. That rot compounds with every entry added, and M8 plus M9 will add entries.

This resolves one named candidate inside the M9 documentation-reorganization bullet — "whether `decisions.md` at 1,300+ lines with per-entry addenda stays one file" — ahead of that milestone. It does not resolve the rest of that bullet.

**Considered and rejected: a Docusaurus (or any static-site) migration.** The readers of this corpus are an editor, a CC session's context window, and GitHub's markdown renderer. A site serves a fourth reader who does not exist, adds a build and deploy surface to a monorepo that has neither, and produces a second representation to keep in sync with the files CC actually loads. Its one genuinely useful feature, build-time broken-link checking, is the validator specified in Part 5. Revisit only if self-hosting documentation grows past a README and a few setup pages — and even then the ADR corpus likely stays out of it.

---

## Goals

1. One file per decision, with a **stable identifier** that survives title edits.
2. A **generated** `docs/decisions.md` that stays at its current path so existing external references keep resolving.
3. **Validation that fails the build** on a dangling identifier, a duplicate identifier, or a stale generated index.
4. **No information change.** The migration is a re-shaping of existing text; no entry is rewritten, condensed, merged, split, or re-titled during it.

## Non-goals

- Static-site generation, in any form.
- A tag taxonomy, backlink graph, or status workflow beyond the three values in Part 2.
- Authoring summaries. See Part 4 — summaries are a follow-on, deliberately decoupled.
- Sweeping `docs/specs/zoltar/`, splitting public from internal docs, or the two pending renames. Those stay in the M9 bullet.
- Rewriting `§` references that point at documents other than the decisions log. `docs/rules-extraction-findings.md § S4` and similar are out of scope and must be left untouched.

---

## Part 1 — Layout and identifiers

**Directory:** `docs/decisions/` holds one Markdown file per entry. `docs/decisions.md` becomes a generated artifact.

**Identifier:** `ADR-NNNN`, zero-padded to four digits, assigned once and never reused. Numbers carry no ordering or grouping meaning after assignment.

**Migration seeding:** assign `0001`–`0092` in current document order. This is not chronological and should not be described as such — it is a deterministic, reproducible seed. New entries take `max + 1`.

**Filename:** `NNNN-short-slug.md`, slug derived from the title (lowercase, strip backticks and asterisks, non-alphanumerics to hyphens, collapse repeats, truncate to ~60 chars). The slug is cosmetic. The number in the filename must match the front matter `id`; the validator enforces this. Files may be renamed freely as long as both change together.

**Do not encode area in the identifier** (no `EVAL-001`). Entries migrate between areas — the D&D-5e-bias entry sits under Rules Retrieval but resolves to a schema finding — and a topical prefix would either lie or force renumbering.

---

## Part 2 — Front matter contract

YAML front matter, exactly these keys:

```yaml
id: ADR-0042
title: A rate that never moves is a harness suspect, not a finding
area: eval-harness
status: accepted
superseded_by: null
milestone: unknown
summary: null
```

| Key | Required | Notes |
|---|---|---|
| `id` | yes | `ADR-NNNN`. Must match the filename number. |
| `title` | yes | Verbatim from the current `###` heading, including backticks. The body must **not** repeat it as an H1. |
| `area` | yes | One of the 13 slugs below. |
| `status` | yes | `accepted` \| `open` \| `superseded`. |
| `superseded_by` | when `status: superseded` | An `ADR-NNNN` that exists and is not self. Otherwise `null`. |
| `milestone` | yes | `M7.4`, `M8`, etc., or `unknown`. |
| `summary` | no | One or two sentences. `null` at migration time for every entry. |

**Area slugs**, one per current `##` section, mapped mechanically:

`architecture-backend`, `rules-ingestion`, `rules-retrieval`, `claude-tool-schemas-state`, `claude-turn-loop-correction`, `claude-continuity-spatial`, `api-data-model`, `frontend-design-system`, `oracle-tables`, `eval-harness`, `monorepo-tooling-deployment`, `licensing-business`, `security`

**Notes on the fields, because two of them invite over-modelling:**

- `status` stays coarse on purpose. The addendum discipline means most revision happens *inside* an entry — a document reading "decided X" followed by "Addendum: the second half of X is now false" has no honest single-valued status. `superseded` is reserved for wholesale reversal and no current entry qualifies. Everything in the log is `accepted` except the single entry whose title begins `OPEN —`, which is `open`; this is confirmed, not inferred, and the count is asserted in Done When 8.
- `milestone` rather than `date`. Git holds the date, milestone bands are how this project is actually navigated, and hand-setting dates during migration would be fabrication. **Do not infer milestones during the split.** Set `unknown` wherever the entry text does not state one plainly; backfill opportunistically later.

---

## Part 3 — The split

Mechanical, scripted, no hand editing of body text.

1. Split `decisions.md` on `^### ` boundaries. Preserve body text byte-for-byte, including addenda, bold run-in headers, code fences, and tables.
2. Carry the enclosing `##` section into `area`.
3. Preserve the preamble at the top of the current file (the four introductory paragraphs) — it becomes the header block of the generated index, stored as a template at `docs/decisions/_index-header.md`.
4. Write each entry to `docs/decisions/NNNN-slug.md` with front matter per Part 2, body unchanged beneath.
5. **Verify losslessness before proceeding:** concatenating all bodies in ID order must reproduce the original entry text exactly. Diff and fail loudly if not. Do not proceed to Part 4 with a non-empty diff.

Expected output: 92 files.

---

## Part 4 — The index, and why summaries are decoupled

The compile script emits `docs/decisions.md` from the ADR files.

**Rendering rule:** for each entry, render the heading, then `summary` if present, **else the full body verbatim**.

That fallback is the whole staging strategy. At migration time every `summary` is `null`, so the generated index reproduces today's document nearly byte-for-byte. The structural change lands with zero authoring work and zero information change — the diff is front matter and file boundaries, nothing a reader would notice. The index then shrinks toward roughly 400 lines as summaries are authored incrementally.

**A correction to an earlier estimate, recorded so it is not repeated:** an initial read suggested most entries were short enough to skip summarising, based on line counts. Measured by words, that is wrong — a "four-line" entry here is one long unwrapped paragraph. At a 60-word threshold, 77 of 92 entries would still need a hand-written summary; at 120 words, 56 would. There is no threshold that makes this cheap. Writing 92 summaries is roughly a day of work, it is genuinely valuable work, and it is exactly the kind of work that should not block a mechanical restructure. It belongs in the M9 pass or in idle time, not here.

**Backlog reporting:** `task docs:decisions:missing-summaries` lists entries with `summary: null`, longest body first. That is the authoring queue.

**Index structure:** preamble, then a generated banner marking the file as generated with the source path and the regenerating task, then an **Open** section listing every `status: open` entry (currently one, presently buried around line 1656), then entries grouped by `area` in the current section order, sorted by ID within each area. Each entry heading carries its ID and links to its source file.

---

## Part 5 — Reference migration and validation

**Reference format after migration:** a bare `ADR-NNNN` token in prose, and nothing more. Titles may still appear as ordinary prose but stop being load-bearing: "the underscore rule (`ADR-0031`)". The compile script may linkify these tokens in the generated index; source files keep them plain.

The rewrite collapses the **entire** reference construct, path included — `` `docs/decisions.md § Entity and resource pool identifiers use underscores only` `` becomes `` `ADR-0031` ``. The path is not preserved alongside the token: `docs/decisions.md` is now a generated index rather than the entry's home, so naming it would point readers at the wrong artifact. Where a sentence's grammar depends on the title ("`§ State placement is decided by the lifetime of the referent` states the rule and no code applies it"), leave the surrounding prose intact and substitute in place — the result reads "`ADR-0028` states the rule and no code applies it". Do not restructure sentences.

**Step 1 — inventory, before rewriting anything.** Produce `docs/plans/017-reference-inventory.md` (working artifact, delete after execution) listing every `§` reference in `docs/decisions.md`, `docs/roadmap.md`, and `docs/zoltar-design-doc.md`, classified as:

- **resolves** — matches exactly one entry title. Include the assigned ID.
- **ambiguous** — matches more than one, or matches on a truncated prefix. The known ellipsis case lands here.
- **out of scope** — targets another document (`rules-extraction-findings.md § S4`, `§ S4.5` continuations, plan-file sections). Left untouched.
- **unresolved** — looks like a decisions reference and matches nothing. **This is the rot report.** Do not guess a target.

Expected order of magnitude: ~129 `§` tokens across the three files, of which ~44 resolve to entries. Treat a large deviation from that as a bug in the classifier, not a finding.

**Step 2 — rewrite only the `resolves` class**, automatically. Leave `ambiguous` and `unresolved` in place and surface both for Alex to adjudicate. Blind regex over the whole set is the failure mode to avoid here.

**Step 3 — the validator**, `task docs:decisions:check`, fails on:

- an `ADR-NNNN` token anywhere under `docs/` that does not resolve
- a duplicate `id`
- a filename number that disagrees with front matter `id`
- an `area` outside the allowed set, or a missing required key
- `status: superseded` without a resolving `superseded_by`, or `superseded_by` pointing at itself
- a stale index: regenerate to a temp file and diff against the committed `docs/decisions.md`

It must **not** validate bare `§` references. Those belong to other documents.

**Step 4 — CI.** `docs:decisions:check` runs in CI. `task docs:decisions:build` regenerates the index.

---

## Part 6 — Commit discipline

Land the split as a **single commit that does nothing else**. No content edits, no summary authoring, no unrelated doc changes riding along. Per-file `git blame` starts fresh regardless, but `git log docs/decisions.md` before that commit stays readable, and the commit itself stays reviewable as a pure re-shaping.

Reference rewrites (Part 5, step 2) go in a **second** commit.

---

## Part 7 — Follow-on edits outside the tooling

- Add a short "How to add a decision" block to `docs/decisions/README.md`: create `NNNN-slug.md` with `max + 1`, fill front matter, run `task docs:decisions:build`, commit both.
- Update the M9 roadmap bullet to record that the one-file question is settled and by which plan, leaving the remainder of that bullet's scope intact.
- Do **not** update `docs/eval-methodology.md`, `docs/schema.md`, `docs/tools.md`, or `docs/rules-extraction-findings.md` beyond reference rewrites surfaced by the inventory.

---

## Done when

1. `docs/decisions/` contains 92 ADR files, each with complete front matter conforming to Part 2.
2. Concatenated bodies in ID order reproduce the original entry text exactly.
3. `task docs:decisions:build` regenerates `docs/decisions.md`, and the result differs from the pre-migration file only in the generated banner, the Open section, per-entry ID annotations, and source links.
4. `task docs:decisions:check` passes and is wired into CI.
5. `task docs:decisions:missing-summaries` runs and reports 92.
6. The reference inventory exists, the `resolves` class is rewritten, and the `ambiguous` and `unresolved` classes are listed for review.
7. The split is one commit; reference rewrites are a second.
8. Exactly one entry carries `status: open`; every other entry is `accepted`. No entry is `superseded`.
9. No `§` token anywhere under `docs/` targets the decisions log. Remaining `§` tokens target other documents only.

---

## Resolved before drafting

Three questions were open when this plan was first drafted. All three are settled; recorded here because the reasoning is not recoverable from the resulting code.

1. **Directory name: `docs/decisions/`, not `docs/adr/`.** The former keeps the vocabulary already used across the roadmap and the design doc, and keeps the generated index adjacent to its source. `docs/adr/` is the more conventional name and would read better to an outside contributor, which is a `v0.1.0` audience question rather than a working-record question — it belongs to the M9 public/internal split if it is revisited at all. A later rename is cheap: identifiers are path-independent.

2. **The `§` habit retires for decisions references.** A reference is a bare `ADR-NNNN` token and nothing else. Titles may still appear in prose where they aid reading, but they carry no addressing role and are not part of the syntax. Retaining `ADR-0042 § Title` was rejected: it reintroduces exactly the drift this plan exists to remove, since nothing would keep the trailing title in step with the front matter. `§` remains in use for references into other documents and is untouched.

3. **Exactly one entry is `status: open`** — the entry titled `OPEN — the undecided discipline has never been extended to judged checks, and turn24-over-resolution is the case that shows it should be`. Every other entry migrates as `accepted`. The validator asserts the count (Done When 8) so that a mechanical mis-classification during the split fails rather than passing quietly.

---

## Appendix — measured baseline

Recorded so post-migration counts can be checked against something.

| Measure | Value |
|---|---|
| Total lines, `decisions.md` | 1,806 |
| Entries (`###`) | 92 |
| Sections (`##`) | 13 |
| Entries > 15 lines | 24 (1,293 lines, 76% of body) |
| Entries ≤ 6 lines | 38 |
| Entries > 120 words | 56 |
| `§` tokens across the three docs | ~129 |
| `§` tokens resolving to an entry title | ~44 |
| References to `decisions.md` from `roadmap.md` | 21 |
| Longest entry | `Character sheet stores identity and build, not live mutable state` (115 lines) |
