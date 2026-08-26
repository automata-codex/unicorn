# Workflowy paste template

The format for handing todo items to Alex's Workflowy list. Anything extracted
from `docs/roadmap.md`, a spec, or a plan for tracking as work goes out in this
shape.

## Template

```markdown
- Title
  - Blockers
    - Title
    - Title
  - Summary
    - One sentence
  - Details
    - Detail 1
    - Detail 2
    - Detail 3
```

## Conventions

- **`Title`** is imperative and specific — "Register `UNREVERSED-RETCON` and capture
  turn 21", not "UNREVERSED-RETCON".
- **`Blockers`** names another item by its exact `Title`. Where the blocker is
  external — a playtest, an approval, an upstream run — write it as plain text.
- **`Summary`** is one sentence. It states the problem, not the fix.
- **`Details`** carries the evidence a reader needs to act: file and line
  references, run identifiers, hashes, measured figures, rejected options.
- **Omit a section entirely when it is empty.** No placeholder bullets.
- One item per unit of work. If two things can land in separate commits by
  separate people, they are two items.

## What goes here rather than in the roadmap

`docs/roadmap.md` carries scope and milestone sequence, and tracks status at
milestone granularity only. Task-level status lives in Workflowy. The dividing
line: **if a line would change as the work progresses, it belongs in Workflowy,
not the roadmap.** Roadmap deliverables are stable nouns; Workflowy items are
imperative and churn.

Decisions still go to `docs/decisions/`, and measurements to the findings
documents, regardless of which of the two is tracking the work.
