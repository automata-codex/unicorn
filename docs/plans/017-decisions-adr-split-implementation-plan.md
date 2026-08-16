# 017 — `decisions.md` → per-decision ADR files: Implementation Plan

Multipart implementation plan for
`../specs/zoltar/017-decisions-adr-split.md`. Three commits across two working
sessions, with a hard stop between them.

**Grounding.** Written 2026-08-16 against `decisions-adr-split` at `21ab1ee`.
Every count below was measured in the working tree, not copied from the spec —
the spec's appendix was taken at `1,806 lines / 92 entries` and the file has
since grown. Where this plan and the spec disagree on a number, this plan is
the measured one and the spec's Done When items need the amendment recorded in
**Amendments** below.

**What this plan adds over the spec.** The spec is close to complete on policy —
identifier scheme, front-matter contract, rendering rule, commit discipline,
rejected alternatives. It is silent on engineering. This plan settles where the
tooling lives, how it is tested, how it runs in CI, and the five parsing hazards
(H1–H5) that will otherwise surface as a failed losslessness diff or a bogus rot
report with no obvious cause. It introduces no new policy; where it must deviate
from the spec it says so under **Amendments** rather than quietly.

**Invariant for every commit: the repo is green.** `npm run lint`, `npm test`,
and the new `task docs:decisions:check` all pass at each of the three commits.

---

## Decisions required before starting

Three questions the spec does not answer. Each has a recommendation, and the
body of this plan is written against the recommendation — if a different option
is chosen, the affected Part says what changes.

### D1 — Where the tooling lives

There is no repo-root `scripts/`. Every script in this repo lives in
`apps/zoltar-be/scripts` and runs as `npx tsx --env-file=.env`. Root
`devDependencies` currently holds Biome and nothing else; `tsx` and `vitest`
resolve from `node_modules/.bin` only because npm hoists them out of the
workspaces, which is incidental behaviour and not a contract worth building on.

| Option | Cost | Benefit |
|---|---|---|
| **A** — `packages/docs-tools` | New workspace package; breaks the pattern that `packages/*` are product libraries (`auth-core`, `game-systems`, `rules-engine`, `service-interfaces`) | Correct isolation, own deps |
| **B** — `apps/zoltar-be/scripts/` | A docs compiler living inside the backend app; docs-only PRs run the full backend suite; a docs typo fails a job named "Backend" | Zero new infrastructure — tsx, vitest, zod, Biome, tsc and CI all already cover it |
| **C** — `docs/tooling/` + root devDeps | ~20 lines of new config: root `devDependencies`, a root vitest config, a fourth CI job | Honest placement; a fast, correctly-named `docs` CI job; docs-only PRs don't pay for the backend suite |

**Recommendation: C.** The permanent surface here is three small commands that
change rarely, and the deciding factor is CI legibility — a contributor whose
docs PR goes red should see a job called `Docs`, not `Backend (lint, tsc,
vitest, integration)`. The one-time config cost is paid once; the misleading
failure is paid on every future docs PR. Reversal is cheap if it proves
annoying: identifiers are path-independent and the swap is a directory move
plus config.

**If B is chosen instead:** drop Part 1.1 and Part 4.4 entirely, put the four
source files in `apps/zoltar-be/scripts/`, and the existing `scripts/**/*.spec.ts`
vitest glob and backend CI job pick everything up with no further change.

### D2 — How wide the reference rewrite goes

The spec's Part 5 Step 1 scopes the inventory to three files. Done When 9 then
asserts that *no* `§` token anywhere under `docs/` targets the decisions log.
Those cannot both hold. Measured today, counting only references that spell
`decisions.md` on the same line:

| Scope | `decisions.md §` references |
|---|---|
| `decisions.md` + `roadmap.md` | 17 |
| Other living docs — `rules-extraction-findings.md` (8), `eval-methodology.md` (3), `tools.md`, `schema.md`, `api.md`, `rules-ingestion.md` (1 each) | 15 |
| `specs/zoltar/` (013, 012, 016, 017) | 32 |
| `plans/` (012, 013, 014, 016) | 20 |
| `milestones/` (m7.6 × 3) | 10 |

That table is a floor, not the real count — many references omit the filename
entirely (an intra-document `§ Rules retrieval mechanism`) or wrap it onto the
previous line. The true in-scope figure is in H3 below: **46 exact resolves and
15 truncated-title ambiguities** across the eight living docs. Scope the
decision on the file list; take the counts from H3.

`zoltar-design-doc.md` — one of the spec's three named inventory targets —
contains **zero** `§` tokens. It is a no-op and can be dropped from the
inventory scope.

Part 7 compounds the contradiction: it forbids touching `eval-methodology.md`,
`schema.md`, `tools.md`, and `rules-extraction-findings.md` "beyond reference
rewrites surfaced by the inventory", but the inventory as scoped never reads
those files, so it surfaces nothing in them.

**Recommendation: rewrite living docs, freeze the historical record.** Inventory
and rewrite `decisions.md`, `roadmap.md`, `rules-extraction-findings.md`,
`eval-methodology.md`, `tools.md`, `schema.md`, `api.md`, `rules-ingestion.md`
— 32 references. Leave `specs/`, `plans/`, and `milestones/` untouched: those
are dated records of what was true when written, a rewrite there is churn
against documents nobody navigates by reference, and editing a shipped plan to
cite an identifier that did not exist when it was written makes the record less
honest, not more. Narrow Done When 9 accordingly (see **Amendments**).

The validator's `ADR-NNNN` resolution check still covers all of `docs/`, per
spec Part 5 Step 3. That asymmetry is intentional: new tokens must always
resolve wherever they appear; old `§` prose is only cleaned up where it is
still read.

### D3 — YAML handling

No YAML library exists anywhere in this repo. Front matter here is a flat map of
seven scalar keys, which invites hand-rolling — do not. Measured against the
current titles, hand-formatting breaks on: **11** titles containing a colon
(`ORM: Drizzle over TypeORM`), **5** containing a quote character, **38**
containing backticks, and a longest title of 144 characters. Several titles
begin with a backtick, which is not a YAML quoting hazard but reads as one and
invites a bad hand-written escape.

**Recommendation: add `yaml` as a dependency and use it for both reading and
writing.** The writer matters more than the reader — generating front matter
with template strings is what produces the corrupt-quoting bug, and a library
writer quotes correctly by construction. Validate the parsed object with Zod,
matching how every other structured artifact in this repo is checked.

---

## Re-baseline

The spec's appendix is stale. Measured at `21ab1ee`:

| Measure | Spec appendix | Measured today |
|---|---|---|
| Total lines, `decisions.md` | 1,806 | **1,861** |
| Entries (`###`) | 92 | **93** |
| Sections (`##`) | 13 | 13 |
| `§` tokens, `decisions.md` | — | 102 |
| `§` tokens, `roadmap.md` | — | 74 |
| `§` tokens, `zoltar-design-doc.md` | — | **0** |
| `§` tokens, eight living docs (all kinds) | ~129 | **309** |
| …resolving to an entry title | ~44 | **46** |
| …truncated-title ambiguities | "at least one" | **15** |
| …numeric (`§ 24.1`, `§ S8`, `§ Part 4`) | — | **210** |
| Entries with `status: open` | 1 | 1 (confirmed, line 1656) |

Entries per section, for checking the split's output:

| Section | Entries |
|---|---|
| Architecture & Backend | 11 |
| Rules Ingestion | 6 |
| Rules Retrieval | 5 |
| Claude Integration — Tool Schemas & State | 18 |
| Claude Integration — Turn Loop & Correction | 6 |
| Claude Integration — Continuity & Spatial | 4 |
| API & Data Model | 5 |
| Frontend & Design System | 5 |
| Oracle Tables | 2 |
| Eval Harness | 23 |
| Monorepo, Tooling & Deployment | 4 |
| Licensing & Business Strategy | 3 |
| Security | 1 |
| **Total** | **93** |

**Do not hard-code 93 either.** It will be 94 before this lands if anyone adds
an entry. Every count in the tooling and in the Done When checks derives from
the file at run time; the table above is for eyeballing the first run, not for
asserting in code. The one exception is the `status: open` count, which the spec
deliberately asserts as exactly 1 — that assertion stays, because its purpose is
to catch a mechanical mis-classification.

---

## Hazards in the source — verified, do not re-derive

Four properties of `decisions.md` that a naive implementation gets wrong. All
four were checked in the working tree at `21ab1ee`.

**H1 — Horizontal rules sit between entries, inconsistently.** There are 16
`^---$` lines. Thirteen precede a `##` (one terminates the preamble, twelve
separate sections) and are structural. **Three precede a `###`** — at lines 880,
973, and 1002, all in the M7.6 cluster — and are entry separators that no other
entry has. A naive `^### ` split absorbs each stray rule into the *preceding*
entry's body as trailing content. This is the most likely cause of a first-run
losslessness failure. See Part 2.2 for the handling and **Amendments** for the
Done When 3 consequence.

**H2 — A body may contain `---`, so front matter needs a real splitter.** Given
H1, entry bodies can legitimately begin or end near a `---`. The front-matter
reader must treat only the first two `---` lines of a file as delimiters and
never scan further. A regex that splits on every `---` will silently truncate
bodies.

**H3 — The `§` population is mostly *not* decisions references, and the naive
classifier misreads it badly.** A throwaway classifier was run over the eight
living docs to size this properly. Results, and they are not what the spec
assumes:

| Class | Count | Disposition |
|---|---|---|
| Numeric — `§ 24.1`, `§ S8`, `§ Part 4`, `§ Step 2` | **210** | Out of scope. Rulebook sections, `rules-extraction-findings.md` findings, plan parts |
| Exact match to an entry title | **46** | `resolves` — rewrite these |
| Truncated entry title | **15** | `ambiguous` — Alex adjudicates |
| Everything else | 38 | Mixed; see below |

Three consequences for the implementation:

1. **A numeric rule is mandatory and must come first.** Two thirds of all `§`
   tokens are numeric citations into the rulebook or into
   `rules-extraction-findings.md`. Without an explicit numeric guard they flood
   the `unresolved` bucket and bury the real rot report. This also independently
   validates the spec's "must not validate bare `§` references" rule — most `§`
   tokens in this corpus have nothing to do with decisions.
2. **Truncation is the norm, not the single known ellipsis.** The spec expects
   "at least one" truncated reference. There are 15, including
   `§ Agentic graph decomposition stays deferred`,
   `§ Rules retrieval mechanism`, and `§ actingEntityId must resolve against a
   declared identifier set` (twice). `schema.md:403` carries an explicitly
   `...`-elided title inside a SQL comment. This class is where the drift the
   spec exists to eliminate actually lives — it deserves Alex's attention, and
   it is a stronger argument for the plan than the line count ever was.
3. **Classification must anchor on the nearest preceding document path, not on
   shape.** The residual 38 are mostly references to *other documents'* sections
   with the filename on a previous line or omitted — `§ Licensing Posture` (the
   design doc), `§ M7.6 — Character Sheet Fidelity` and
   `§ Deferrals Introduced in M7` (roadmap sections), `§ Query Time`
   (`rules-extraction-findings.md`). An out-of-scope reference and an in-scope
   one are shape-identical; only the target distinguishes them. Resolve each
   `§` against the nearest preceding path within the same reference construct,
   and treat "matches no entry title and names no other document" as the rot
   report — that residue is small enough to read by hand.

The classifier must also normalise whitespace across newlines before matching
(**27** references wrap mid-title, e.g. `rules-extraction-findings.md:2827`),
and the rewriter must be able to replace a match spanning lines, collapsing it
onto one.

**H4 — Backtick-delimited titles break naive delimiter splitting.** 38 titles
contain backticks and several *begin* with one — `` § `actingEntityId` must
resolve against a declared identifier set ``. A classifier that bounds the
reference by splitting on the next backtick gets an empty string and drops the
reference into `unresolved`. This was not hypothetical: the throwaway classifier
above did exactly that, and it accounts for part of the residual 38. Bound the
reference on the *closing* delimiter of the enclosing code span, not on the
first backtick encountered.

**H5 — What is safe.** Checked and clean, so no defensive handling is needed:
no duplicate entry titles; no `### ` inside a code fence (only two fences in the
file); no `####` headings; no prose between a `##` and its first `###`. The
split itself is safe once H1 is handled.

---

## Ordering

| Commit | Contents | Session |
|---|---|---|
| 1 | Tooling: four source files, tests, three tasks, CI job. No docs content moves. | 1 |
| 2 | The split: N ADR files, `_index-header.md`, `README.md`, regenerated `decisions.md`. Mechanical output only. | 1 |
| 3 | Reference rewrites (`resolves` class only) + the Part 7 follow-ons. | 2, after Alex adjudicates |

**This is a deviation from the spec's Part 6, and a deliberate one.** Part 6
requires the split to be "a single commit that does nothing else". Landing the
tooling in commit 1 serves that goal better than folding it in: it leaves commit
2 as pure generated output — new files and a regenerated index, nothing a
reviewer has to read as code — which is a stricter reading of "does nothing
else" than the spec's own phrasing achieves.

**The session seam after commit 2 is a hard stop.** Commit 3 rewrites references
only in the `resolves` class; the `ambiguous` and `unresolved` classes are
Alex's to adjudicate, per spec Part 5 Step 2. Do not guess a target for an
unresolved reference — that is how a wrong citation gets laundered into the
corpus, and the spec exists because one already was.

Budget for that seam realistically: the spec anticipated roughly one ambiguous
reference and there are **15** (H3), each needing a judgement about which entry
a truncated title meant. That is a half-hour of reading, not a rubber stamp, and
it is the part of this work that most needs a human.

---

## Part 1 — Tooling skeleton (commit 1)

Four source files under `docs/tooling/` (per D1), following the repo's
established `X.core.ts` / `X.ts` / `X.spec.ts` split — pure logic exported from
a core module, a thin CLI wrapper, unit tests against the core.

```
docs/tooling/
  adr.core.ts          # front matter schema, slugger, parser, splitter
  adr.spec.ts
  build-index.ts       # CLI → regenerates docs/decisions.md
  check.ts             # CLI → the validator
  missing-summaries.ts # CLI → the authoring queue
  references.core.ts   # inventory classifier + rewriter (Part 5)
  references.spec.ts
```

### 1.1 Root wiring

Add to root `package.json` `devDependencies`: `tsx`, `vitest`, `zod`, `yaml`.
Add a root `vitest.config.ts` with `include: ['docs/tooling/**/*.spec.ts']` —
scoped narrowly so a root `vitest` run never picks up the workspaces' suites.
Add a root script `"test:docs": "vitest run"`.

Biome already covers `docs/tooling/` via its `**` include and needs no change.

*(If D1 resolves to B, this subsection is dropped.)*

### 1.2 `adr.core.ts`

The pure layer. No filesystem access in this file beyond what is passed in — it
takes and returns strings and objects, so the tests need no fixtures on disk.

- `frontMatterSchema` — Zod, exactly the seven keys of spec Part 2, with `area`
  as a `z.enum` over the 13 slugs and `id` / `superseded_by` as a branded
  `ADR-\d{4}` pattern. Reject unknown keys (`.strict()`); a typo'd key is a
  defect, not a passthrough.
- `slugify(title)` — lowercase, strip backticks and asterisks, non-alphanumerics
  to hyphens, collapse repeats, trim leading/trailing hyphens, truncate to 60.
  Test against the real hazards: the 144-char `OPEN — …` title, a title starting
  with a backtick, and one containing a colon.
- `parseAdrFile(text)` — the H2-safe front-matter splitter. Only the first two
  `---` lines delimit; everything after is body, verbatim.
- `splitDecisionsLog(text)` — the H1-aware splitter. Returns preamble, then an
  ordered list of `{ area, title, body }`.

### 1.3 Tests

Per CLAUDE.md, this is service-shaped code with no I/O and gets real unit
coverage: the slugger against the hazard titles above, `parseAdrFile` against a
body containing a `---` line (H2), `splitDecisionsLog` against a fixture with a
stray entry-level rule (H1), and `frontMatterSchema` against valid shapes plus
representative invalid ones — bad `area`, missing `milestone`, `superseded`
without `superseded_by`, self-referential `superseded_by`.

---

## Part 2 — The split (commit 2)

Scripted, mechanical, no hand editing of body text.

### 2.1 Assignment

Walk entries in document order, assigning `0001`…`00NN`. Carry the enclosing
`##` into `area` via a hard-coded heading→slug map — mechanical, but written out
explicitly rather than derived by slugifying the heading, so that a heading
reword does not silently reassign areas.

`status` is `accepted` for every entry except the one whose title begins
`OPEN —` (line 1656 today), which is `open`. `milestone` is `unknown` unless the
entry text states one plainly — **do not infer**. `summary` is `null` for every
entry.

### 2.2 Handling H1

Strip trailing `---` and surrounding blank lines from every entry body at split
time; do not carry them into ADR files. The index compiler emits its own
separator uniformly between `##` sections and never between entries.

This means the three stray entry-level rules at 880, 973, and 1002 **disappear
from the regenerated index**. That is a deliberate normalisation of an
inconsistency that exists in only 3 of 93 entries, and it adds a fourth item to
Done When 3's list of permitted differences (see **Amendments**). The
alternative — preserving per-entry separator inconsistency in generated output —
is not worth the fidelity.

### 2.3 The losslessness gate

Before writing anything else: concatenate all bodies in ID order and diff
against the original entry text, with the H1 separators normalised out of both
sides. **A non-empty diff stops the work.** Do not proceed to Part 3, do not
"fix up" the ADR files by hand, and do not narrow the diff by editing the
expected side — a diff here means the splitter is wrong.

Emit the diff to `docs/plans/017-split-diff.txt` on failure (working artifact,
delete after execution).

### 2.4 Preamble and README

The four introductory paragraphs and the closing `---` become
`docs/decisions/_index-header.md`. Write `docs/decisions/README.md` with the
"How to add a decision" block from spec Part 7: create `NNNN-slug.md` with
`max + 1`, fill front matter, run `task docs:decisions:build`, commit both.

---

## Part 3 — The index compiler

`build-index.ts` emits `docs/decisions.md`. Structure per spec Part 4:
`_index-header.md`, then a generated banner naming the source directory and
`task docs:decisions:build`, then an **Open** section listing every
`status: open` entry, then entries grouped by `area` in the current section
order and sorted by ID within each.

**Rendering rule:** heading, then `summary` if present, else the full body
verbatim. At migration time every summary is `null`, so the output reproduces
today's document modulo the differences enumerated in Done When 3.

Each entry heading carries its ID and links to its source file. The compiler may
linkify bare `ADR-NNNN` tokens in the generated index; source files keep them
plain.

The compiler is deterministic — same inputs, byte-identical output. The
stale-index check in Part 4 depends on this, so no timestamps in the banner.

---

## Part 4 — The validator and CI

### 4.1 `check.ts`

Fails on, per spec Part 5 Step 3:

- an `ADR-NNNN` token anywhere under `docs/` that does not resolve
- a duplicate `id`
- a filename number disagreeing with front-matter `id`
- an `area` outside the allowed set, or a missing required key
- `status: superseded` without a resolving `superseded_by`, or `superseded_by`
  pointing at itself
- a stale index — regenerate to a temp file and diff against the committed
  `docs/decisions.md`
- exactly one entry with `status: open`, per spec Done When 8

It must **not** validate bare `§` tokens; those address other documents.

### 4.2 `missing-summaries.ts`

Lists entries with `summary: null`, longest body first. Reports N (93 today) on
first run.

### 4.3 Tasks

```yaml
  docs:decisions:build:
    desc: Regenerate docs/decisions.md from docs/decisions/. Run after editing any ADR file.
    cmds:
      - npx tsx docs/tooling/build-index.ts

  docs:decisions:check:
    desc: Validate the ADR corpus — identifiers, front matter, and whether the generated index is stale.
    cmds:
      - npx tsx docs/tooling/check.ts

  docs:decisions:missing-summaries:
    desc: List ADR entries with no summary, longest body first. This is the authoring queue.
    cmds:
      - npx tsx docs/tooling/missing-summaries.ts
```

Note these carry no `dir:` and no `dotenv:` — unlike every existing task in the
file, they run from the repo root and need no environment.

### 4.4 CI

A fourth job in `.github/workflows/ci.yml`:

```yaml
  docs:
    name: Docs (ADR corpus)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: npm
      - name: Install dependencies
        run: npm ci
      - name: Validate ADR corpus
        run: npx tsx docs/tooling/check.ts
      - name: Unit tests
        run: npm run test:docs
```

No database, no workspace builds, no API-key placeholders — this job is fast and
independent of the other three.

*(If D1 resolves to B, this job is dropped and the check appends to the backend
job instead.)*

---

## Part 5 — Reference inventory and rewrite (commit 3)

### 5.1 Step 1 — inventory, before rewriting anything

Produce `docs/plans/017-reference-inventory.md` (working artifact, delete after
execution) covering the eight living docs from D2. Classify every `§` reference
as `resolves` / `ambiguous` / `out of scope` / `unresolved`, per spec Part 5.

**Classification order matters.** Apply the rules in this sequence, and do not
reorder them:

1. **Numeric** — `§ 24.1`, `§ S8`, `§ Part 4`, `§ Step 2` → out of scope. This
   rule fires first and takes ~210 of the ~309 tokens out of consideration (H3).
2. **Exact title match** → `resolves`. Expect ~46.
3. **Truncated title match** — the reference text is a prefix of exactly one
   entry title → `ambiguous`. Expect ~15.
4. **Names another document** — resolve against the nearest preceding path in
   the same reference construct → out of scope.
5. **Anything left** → `unresolved`. This is the rot report, and it should be
   small enough to read by hand. Do not guess a target.

The classifier must be multi-line aware (H3, 27 wrapped references) and must
bound references on the closing code-span delimiter rather than the first
backtick (H4). A result showing dozens unresolved means rule 1 or rule 4 is
misfiring, not that the corpus is rotten — check H3 and H4 before reporting a
finding.

`schema.md:403` carries a `...`-elided title in a SQL comment and is expected to
land in `ambiguous`.

### 5.2 Step 2 — rewrite, `resolves` only

Collapse the entire reference construct including the path:
`` `docs/decisions.md § Entity and resource pool identifiers use underscores
only` `` becomes `` `ADR-0031` ``. Where a sentence's grammar depends on the
title, substitute in place and leave the surrounding prose intact. Do not
restructure sentences. The rewriter must handle a match spanning lines (H3),
collapsing it onto one.

Leave `ambiguous` and `unresolved` in place, and surface both for Alex.

### 5.3 The Part 7 follow-ons

Ride along in commit 3:

- Update the M9 roadmap bullet to record that the one-file question is settled
  and by which plan, leaving the rest of that bullet's scope intact.
- No content edits to `eval-methodology.md`, `schema.md`, `tools.md`, or
  `rules-extraction-findings.md` beyond the reference rewrites themselves.

---

## Amendments to the spec's Done When

The spec should be amended in place before execution, per this repo's habit of
amending specs rather than silently diverging.

| # | Spec text | Amendment | Why |
|---|---|---|---|
| 1 | "contains 92 ADR files" | "contains one file per entry in the source log (93 at `21ab1ee`)" | Re-baseline; the count moves with the file |
| 3 | differs only in banner, Open section, ID annotations, source links | add: **and the three stray entry-level `---` separators, normalised away** | H1 / Part 2.2 |
| 5 | "reports 92" | "reports the full entry count" | Re-baseline |
| 9 | "No `§` token anywhere under `docs/` targets the decisions log" | "No `§` token in the eight living docs listed in D2 targets the decisions log. `specs/`, `plans/`, and `milestones/` are frozen historical records and are out of scope." | D2 — the spec's own Part 5 Step 1 scope never covered these |

Two further corrections to the spec's Part 5 Step 1:

- `zoltar-design-doc.md` contains zero `§` tokens and should be dropped from the
  named inventory targets.
- The "~129 tokens, of which ~44 resolve" estimate is low on the first figure
  and close on the second: there are ~309 `§` tokens across the eight in-scope
  docs, of which ~46 resolve, ~15 are truncated titles, and ~210 are numeric
  citations that were never in scope (H3). The step should also state the
  numeric rule explicitly — the spec's four classes have no home for
  `§ 24.1`, and it is the single largest population in the corpus.

Done When 2, 4, 6, 7, and 8 stand as written.

---

## Assumptions worth a second look at review time

- **The heading→slug map is hard-coded.** If a section heading is reworded
  between now and execution, the map fails loudly rather than silently
  reassigning an area. That is the intent, but it means a reword is a two-line
  change in two places.
- **`milestone: unknown` will dominate.** The spec forbids inferring milestones,
  so most entries migrate as `unknown`. If the first run produces a suspiciously
  high number of populated milestones, the extractor is inferring when it should
  not be.
- **Freezing `plans/` and `milestones/` is reversible but awkward.** If D2 goes
  the other way later, those 62 references get rewritten in a separate commit
  against documents whose `git blame` currently means something. Worth being
  sure now rather than revisiting.
- **The stale-index check makes the compiler load-bearing in CI.** Any
  nondeterminism in output — map iteration order, locale-sensitive sorting —
  turns into an intermittently red `docs` job. Sort by ID explicitly; do not
  rely on filesystem read order.
- **H3's figures came from a throwaway classifier, not the real one.** The
  46/15/210 split is good enough to size the work and to justify the numeric
  rule, but the buckets were produced by a ~40-line prototype that is known to
  mishandle backtick-led references (H4). Treat the counts as approximate and
  expect the real classifier to move a handful of references from `unresolved`
  into `resolves`. Do not carry these numbers into the spec as measured
  results — the inventory in Part 5.1 is the authoritative count.
- **The ambiguous class may be the most valuable output of this whole plan.**
  Fifteen references that have drifted from their targets is the concrete
  evidence for the restructure. If the inventory turns up substantially fewer,
  the classifier is being too generous with rule 2 and is silently resolving
  references it should be flagging.
