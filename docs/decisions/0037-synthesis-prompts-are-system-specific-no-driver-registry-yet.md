---
id: ADR-0037
title: Synthesis prompts are system-specific; no driver registry yet
area: claude-tool-schemas-state
status: accepted
superseded_by: null
milestone: unknown
summary: null
---

Each supported game system owns its own synthesis prompt module under `apps/zoltar-be/src/synthesis/<system>/synthesis.prompts.ts` (currently only `mothership/`). System-specific exports — system prompt, character-sheet prose formatter, synthesis user prompt, coherence check prompt, and the canonical oracle-category list — are all prefixed with the system name (`MOTHERSHIP_SYNTHESIS_SYSTEM_PROMPT`, `formatMothershipCharacterProse`, etc.) so names never falsely suggest cross-system generality. Universals — the `submit_gm_context` and `report_coherence` tool definitions and the coherence report Zod schema — live in `src/synthesis/synthesis.tools.ts` and `synthesis.schema.ts` and are imported by every system module.

A generic prompt module was rejected because oracle category counts, character sheet structure, and tonal framing all differ across systems; a single parameterized builder would either be the least common denominator or a tangle of per-system branches. A `synthesisDrivers[systemId]` registry was also considered and deferred: until a second system exists, any interface we define is a guess shaped entirely by Mothership's needs, and the second system is more likely to reveal the right abstraction than to conform to a premature one. When UVG (or the next system) lands, the registry pattern can be introduced at that moment with two concrete implementations to compare against.
