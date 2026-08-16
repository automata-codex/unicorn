---
id: ADR-0013
title: Rules ingestion is CLI-only in Phase 1
area: rules-ingestion
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

No web upload surface. A self-hosted user installs the Python pipeline, points
it at a PDF they own, and runs one command; `ingestion/README.md` is the
supported path.

This follows directly from the licensing posture rather than from effort. The
model is "the user runs ingestion against a PDF they own, on their own
infrastructure" (`docs/rules-ingestion.md § Licensing Posture`), and a web
uploader would put the operator in the position of receiving other people's
rulebook PDFs — which is the distribution question the whole posture exists to
avoid, arriving through a different door.

It is also honest about the shape of the job: ingestion is a rare, offline,
minutes-long batch that pulls 1.3 GB of extraction models and needs a
per-edition config file checked by hand. That is a CLI's work, not a form's.

**Recorded because the absence of a web UI is the single most likely thing a
future reader assumes was an oversight.** It is not. Revisit if a hosted
deployment ever needs non-technical users to add their own books, at which
point the licensing question has to be answered first, not second.
