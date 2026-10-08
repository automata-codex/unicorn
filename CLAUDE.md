# CLAUDE.md

This file provides context for AI assistants working in this repository.

## What This Is

Unicorn is a monorepo housing two Automata Codex tabletop RPG products:

- **Zoltar** — an AI-powered GM-in-a-box for solo and small-group TTRPG play
- **Unicorn VTT** — a traditional virtual tabletop (planned, not yet scaffolded)

Both products share workspace packages for service interfaces, game-system schemas and data, rules engine, and (eventually) a 2D renderer.

The full design document is at `docs/zoltar-design-doc.md`.

## Repository Structure

```
unicorn/
  apps/
    zoltar-fe/        # Svelte SPA — Zoltar frontend
    zoltar-be/        # NestJS API — Zoltar backend
    zoltar-playtest/  # Milestone 1.0 frontend-only prototype (historical)
  packages/
    auth-core/          # @uv/auth-core — AuthService interface definitions
    service-interfaces/ # @uv/service-interfaces — the other SaaS/self-hosted service interfaces (email, metering, realtime, …)
    game-systems/       # @uv/game-systems — per-system Zod schemas and data (Mothership character sheet, campaign state, oracle tables)
    rules-engine/       # @uv/rules-engine — dice, constraint evaluator (planned)
  ingestion/          # Python rules-ingestion pipeline (PDF → vector index)
  infra/              # Docker Compose, deployment config
  docs/               # Design docs, ADRs
```

Packages are internal workspace packages — they are not published to npm.

## Tech Stack

| Layer              | Technology                               |
|--------------------|------------------------------------------|
| Frontend           | Svelte 5 SPA (not SvelteKit, ADR-0010)   |
| Backend            | NestJS 11                                |
| Database           | PostgreSQL                               |
| AI                 | Anthropic Claude API (claude-sonnet-5)   |
| Auth (self-hosted) | Backend-owned magic link (ADR-0009)      |
| Auth (SaaS)        | Clerk                                    |
| Real-time (SaaS)   | Ably                                     |
| Language           | TypeScript throughout                    |
| Package manager    | npm workspaces                           |
| Node version       | >=22.0.0                                 |

## Key Architectural Decisions

**Claude as consequence engine, not state holder.** The backend constructs a visibility-filtered state snapshot, sends it to Claude with each request, and Claude issues structured change requests via the `submit_gm_response` tool. The backend validates and applies all state changes. Claude never holds authoritative state between requests.

**Two-mechanism hidden information model.** GM context secrets (NPC agendas, mystery answers, faction loyalties) are included in Claude's prompt and withheld behaviorally — Claude is playing the Warden role faithfully. **Entity existence is part of that half**: every entity is named in the prompt every turn, hidden ones included, because the Warden needs their stats to run them off-screen. Only an entity's *position* is structurally absent (`ADR-0101`), and in Phase 1 that is vacuous — nothing emits position yet. Entity `visible` is line of sight (transient, both directions); `revealed` is discovery (monotonic).

**Typed envelope + JSONB.** Universal concepts (campaigns, sessions, grid) use proper relational tables. System-specific state uses JSONB with Zod validation. Adding a new game system means writing a Zod schema, not a migration.

**Service interface abstraction.** Every SaaS/self-hosted divergence point is a NestJS provider interface. Self-hosted defaults ship in this repo. SaaS implementations live in a separate closed-source package. Deployment mode is selected via environment config, not code changes.

**Open core, self-hosted first.** SaaS infrastructure is intentionally deferred until the 2D renderer ships. The self-hosted version is the primary development target.

**Repository layer for DB access.** Services never call Drizzle directly. Each module that touches the database has a `*.repository.ts` that owns every query; the service owns business logic and exception handling. Changing the ORM then touches only repositories, and service tests mock domain-meaningful repository methods instead of Drizzle's query builder.

## Naming Conventions

- Generic abstractions over system-specific names: `resource_pool` not `spell_slots`, `condition` not `poisoned`
- Package namespace: `@uv/` (short for Unicorn)
- App names: `zoltar-fe`, `zoltar-be` (frontend/backend suffix convention)
- Entity identifiers use underscores only — no dots, hyphens, or other separators: `corporate_spy_1`, `dr_chen`, not `corporate-spy-1` or `dr.chen`
- Resource pool names use underscores and follow the pattern `{entity_id}_{pool_name}`: `dr_chen_hp`, `dr_chen_stress`, `vasquez_ammo`

## Design System

For all frontend work, read `docs/design-system.md` before writing any code. It covers the token architecture, semantic token reference, and component conventions.

## Where Things Get Written Down

Each kind of record has one home. Putting a thing in the wrong one is how
`docs/roadmap.md` grew to 22,000 words before being refactored back on 2026-08-26.

| Kind of thing | Home |
|---|---|
| A decision — its alternatives, its reasoning, what would reverse it | `docs/decisions/`, one file per ADR. `docs/decisions.md` (full text) and `docs/decisions-summary.md` (one summary per entry — the index to search first) are **generated views**: edit the file in `docs/decisions/`, then run `task docs:decisions:build`, and `task docs:decisions:check` to validate |
| A measurement, diagnosis, or defect writeup | the relevant findings doc — see the four below |
| How a feature is designed and built | `docs/specs/` and `docs/plans/` |
| Product and tooling scope, and the milestone sequence | `docs/roadmap.md` |
| Outstanding work at task granularity, and its status | Workflowy — hand it over in the format at `docs/workflowy-template.md` |

**Which findings doc.** All four are empirical records — what was run, what came
back, what was concluded — and they divide by subject, not by format:

| Doc | Subject |
|---|---|
| `docs/eval-findings.md` | what the Warden eval harness measured: run diagnoses, tag coverage, checker defects, corpus decisions |
| `docs/eval-methodology.md` | how to *run* the harness: rep allocation, corpus bumps, what a re-score is valid after. A rule for the next run, not a number from the last one |
| `docs/rules-extraction-findings.md` | the rules corpus: chunking, extraction, retrieval |
| `docs/hidden-information-findings.md` | what the Warden discloses and withholds |

`rules-extraction-findings.md § S30`–`§ S36` are Warden eval findings that
predate `eval-findings.md` and stay put, because frozen plans cite them. The `S`
numbering is one namespace across both files — `§ S37` onward is in
`eval-findings.md`.

**`docs/roadmap.md` tracks status at milestone granularity only.** It carries no
per-item checkboxes. A milestone entry states what the milestone delivers; it does
not narrate how the work went. The test for whether a line belongs there: **a
roadmap deliverable is a stable noun, and does not change as the work progresses.**
Anything that churns is a Workflowy item.

**To read the Workflowy board, use the `workflowy-tasks` skill** — it answers
"what's current" and "what's next". The board id is in `.workflowy.json`; the
skill is read-only, so changes to the board still go to the maintainer in the
`docs/workflowy-template.md` format.

**`docs/specs/`, `docs/plans/` and `docs/milestones/` are frozen** — they are dated
accounts of what was true when written. Never rewrite a reference inside them to
cite an identifier that did not exist at the time. This is enforced by
`docs/tooling/references.core.ts`.

## Working With Claude

The maintainer must be able to explain every part of this system. The eval harness grew one reasonable-looking step at a time into something they couldn't explain, and it is being rebuilt because of that. These rules keep that from happening again.

- **Don't build faster than the maintainer can follow.** Nothing merges that the maintainer couldn't explain in a paragraph. If they couldn't, stop and explain before adding more. Before proposing new rigor, tooling, or abstractions, ask whether they are proportionate for a solo project.
- **Most review happens at the spec and plan**, where the decisions are made. Raise questions of scope and proportion there, not in the diff.
- **Every PR description must:**
  - say in plain language what changed and why
  - point to the 2–3 places where a real decision was made, so the maintainer knows where to read closely
  - name its review tier:
    - *detailed*: turn path, state application, hidden information, tool loop, migrations/schema
    - *cost and guardrails*: anything that spends money
    - *is this needed?*: new concepts, abstractions, or tooling
    - *skim*: tests, docs, refactors that don't change behavior, UI polish
- **If you can't write that description clearly, say so.** That is a warning sign, not a formatting problem. When asked, argue against your own PR: what's overbuilt, and what could be cut.

## Testing Standards

Testing expectations apply uniformly across all milestones — they are not tracked per-feature in the roadmap.

**Backend**
- All service-layer code requires unit tests. Mock dependencies at the service boundary; do not hit the database in unit tests.
- Integration tests are required for any endpoint that touches the database. Use a dedicated test database spun up via Docker Compose.
- Tool handlers (`roll_dice`, `submit_gm_response`, etc.) require unit tests covering valid input, malformed input, and boundary conditions.
- Zod schemas require unit tests covering valid shapes and representative invalid shapes.

**Frontend**
- Component logic that can be extracted into plain functions should be tested as plain functions.
- UI integration tests are not required in Phase 1 but should not be actively avoided.

**General**
- Do not mock what you own. Prefer thin integration tests over heavily mocked unit tests for code where the behavior is the integration.
- Tests live adjacent to the code they test (`*.test.ts` or `*.spec.ts`), not in a separate top-level directory.

## Running the Eval Harness

**Every eval script goes through `task`, and none of them runs without the maintainer's explicit approval on that occasion.**

- **Use `task eval:*`, never `npm run eval:*` or a direct `npx tsx scripts/eval-*.ts`.** The `task` targets carry the working directory, the env file, and — for `eval:run` — the `@swc-node/register` loader that plain `tsx` cannot substitute for. Their `desc:` fields in `Taskfile.yml` also carry the cost and precondition notes (which scripts hit the DB, which make real Anthropic or Voyage calls, and how many), which is the information a decision to run one should be based on. Going around `task` skips all of it.
- **Ask before every run, every time.** Most of these spend real money — `eval:run` is N × a full-corpus pass, `eval:rescore` is one judge call per judged fixture-rep, `eval:retrieval-probe` is one Voyage call per distinct query. Approval to run one script once is not approval to run it again, and not approval for a different script. This holds even when a run is the obvious next step in a plan the maintainer already approved.
- **`eval:run` is always run by the maintainer, by hand.** Never launch it, including in the background. Prepare everything it needs — the prompt edit committed, goldens regenerated, predictions pre-registered — and then hand over the full command with its `--decision-rule` string for them to run.
- **A baseline run is not closed until `docs/eval-methodology.md § Current baseline N` names it**, by full run id. That section carries one standing-point statement; accepting a new baseline means *replacing* it, not appending beside it. A run that happened and was not accepted still needs saying so there — the failure mode is a run nobody dispositioned, which is how that section fell four runs behind by 2026-08-24. This is the write-up's job, not the run's: the run is the maintainer's, the record is whoever reads the artifacts. **`task docs:baseline-check` enforces it** — free, no approval needed, and it skips when the archive is absent.

Reading the artifacts a run has already produced is not running the harness: `ls`, `cat`, and parsing `scores.jsonl` under `$ZOLTAR_EVAL_ROOT` are free and need no approval. Prefer them. A surprising number of questions that look like they need a run — a tag's per-fixture breakdown, whether a denominator moved, what a judge actually said — are answerable from the archive at zero cost, and `docs/eval-methodology.md § Two kinds of corpus bump` decides when a re-run is genuinely owed rather than merely convenient.

## License

Elastic License 2.0. Self-hosting for personal or internal use is unrestricted. Offering the software as a managed service to third parties is not permitted without authorization.
