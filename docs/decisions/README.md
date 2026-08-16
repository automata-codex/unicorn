# Decisions

One file per decision. `../decisions.md` is generated from this directory and
is the reading view — do not edit it by hand.

## How to add a decision

1. Create `NNNN-slug.md`, where `NNNN` is the highest existing number plus one.
   Numbers are assigned once and never reused, and carry no ordering or
   grouping meaning.
2. Fill in the front matter:

   ```yaml
   ---
   id: ADR-NNNN
   title: What was decided, as a sentence
   area: eval-harness
   status: accepted
   superseded_by: null
   milestone: M8
   summary: null
   ---
   ```

   `area` must be one of the 13 slugs in `../tooling/adr.core.ts`. `status` is
   `accepted`, `open`, or `superseded`; a superseded entry needs a
   `superseded_by` that resolves. `milestone` is `unknown` if the entry does
   not plainly state one — do not guess. `summary` may stay `null`.
3. Write the body beneath the front matter. Do not repeat the title as an H1;
   the generated index supplies the heading.
4. Run `task docs:decisions:build`, then commit the new file and the
   regenerated `../decisions.md` together.

## Referring to a decision

A reference is a bare `ADR-NNNN` token and nothing else:

> the underscore rule (`ADR-0032`) applies to resource pools too

Do not append the title. Nothing keeps a trailing title in step with the front
matter, and that drift is what this structure exists to remove. Titles may
still appear in prose where they help the sentence read; they carry no
addressing role.

The `§` convention is still used for references into *other* documents
(`docs/rules-extraction-findings.md § S4`) and is untouched by this.

## Summaries

`summary` is optional and starts out `null`, in which case the index renders
the entry's full body. Filling one in shortens the index without losing
anything. `task docs:decisions:missing-summaries` lists what is outstanding,
longest body first.

## Checks

`task docs:decisions:check` runs in CI and fails on a dangling or duplicate
identifier, a filename that disagrees with its front matter, an invalid area or
status, or a stale generated index.
