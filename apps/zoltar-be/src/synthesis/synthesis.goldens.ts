import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildMothershipCoherenceCheckPrompt,
  buildMothershipSynthesisPrompt,
  formatMothershipCharacterProse,
  formatOracleEntry,
  MOTHERSHIP_COHERENCE_SYSTEM_PROMPT,
  MOTHERSHIP_SYNTHESIS_SYSTEM_PROMPT,
} from './mothership/synthesis.prompts';
import { baseSelections, vasquezSheet } from './synthesis.fixtures';
import { COHERENCE_TOOLS, SYNTHESIS_TOOLS } from './synthesis.tools';

/**
 * Goldens for the surfaces that reach a model on the synthesis path.
 *
 * ## Why this exists, and why it carries no hash
 *
 * Four surfaces reach a model here and none of them had any identity:
 * `buildMothershipSynthesisPrompt` — roughly 6.8 KB of authored prose in
 * twelve sections, about a third the size of `mothership-m7.txt`, living in a
 * `.ts` file — the two tool definitions, the two formatters, and the
 * coherence check, which is a second model call with its own prompt and its
 * own tool.
 *
 * `ADR-0099`'s mechanism does two things and only one of them transfers. The
 * **edit-time** property transfers whole: a change to what the model receives
 * arrives in review as a diff of the received text, and a refactor that
 * renders identical text moves nothing. The **identity** property does not,
 * because nothing would read the hash — no eval command exercises synthesis
 * (the corpus replays turns), and `adventure_synthesis_snapshots`
 * (`db/schema.ts`) stores the output and its schema versions but nothing
 * about the prompt or tool that produced it. A `synthesisHash` today would be
 * computed, asserted, and read by nothing, which is exactly what `ADR-0099`
 * declined to do in the entry that recorded the requirement.
 *
 * So: goldens, no hash, and no `eval/preflight.ts` integration either. The
 * preflight refuses a run against stale goldens because a stale
 * `assemblyHash` mislabels the run; synthesis is not exercised by any run, so
 * gating `eval:run` on it would assert something no run depends on.
 *
 * ## What the goldens are actually guarding
 *
 * `synthesis.prompts.spec.ts`'s *"includes every required section"* asserts
 * twelve `toContain`s and misses four sections outright — `CREW ROLES:`
 * (`ADR-0100`'s), `RESOURCE POOL ADDRESSES:` (spec 018's pool-addressing
 * rules), `WORLD FACTS:`, and the oracle-wiring paragraph. All four could be
 * deleted and that suite stays green: the shape `ADR-0099` cites as its own
 * motivation, where M7.6 added fourteen descriptions under `stateChanges` and
 * nobody noticed five properties had none.
 *
 * Three of those four are load-bearing for the second M7.7 playtest, which is
 * why these land before the capture rather than after. Synthesis runs once,
 * at adventure creation, at the start of the session; the steered targets in
 * `docs/playtest-scenarios.md` depend on `CREW ROLES:` (the
 * Contractor-with-a-role target), `RESOURCE POOL ADDRESSES:` (the wounds
 * chain), and `WORLD FACTS:` (`MISSING-CANON-CAPTURE`'s "does a `world_facts`
 * entry appear"). A section that is wrong or silently dropped turns a capture
 * meant to prove `ADR-0100` into a frozen prompt defect.
 *
 * A golden freezes the text. It does not say the text is right — read it once
 * before the session; that is the actual check.
 */
export interface SynthesisSurfaces {
  /** System + user prompt for the synthesis call, in the order sent. */
  synthesisPrompt: string;
  /** `SYNTHESIS_TOOLS`, which is `SUBMIT_GM_CONTEXT_TOOL`. */
  synthesisTools: string;
  /** `formatMothershipCharacterProse` — the `formatGmContextBlob` case. */
  characterProse: string;
  /** `formatOracleEntry`, one labelled entry. */
  oracleEntry: string;
  /** System + user prompt for the second, separately-prompted model call. */
  coherencePrompt: string;
  /** `COHERENCE_TOOLS`, which is `REPORT_COHERENCE_TOOL`. */
  coherenceTools: string;
}

/**
 * Golden filename per surface. Plain `.txt` throughout — including the tools
 * JSON — so the formatter leaves them alone, the same reason
 * `src/session/assembly-golden/` uses `.txt` for `tools.txt`.
 */
export const SYNTHESIS_GOLDEN_FILES: Record<keyof SynthesisSurfaces, string> = {
  synthesisPrompt: 'synthesis-prompt.txt',
  synthesisTools: 'synthesis-tools.txt',
  characterProse: 'character-prose.txt',
  oracleEntry: 'oracle-entry.txt',
  coherencePrompt: 'coherence-prompt.txt',
  coherenceTools: 'coherence-tools.txt',
};

/** Where the goldens live. Only the spec reads them. */
export const SYNTHESIS_GOLDEN_DIR = join(__dirname, 'synthesis-golden');

/**
 * Fixed pools for the probe.
 *
 * Deliberately not a clean sheet: `combat` and `hp` and `wounds` all sit
 * below their ceiling so the golden covers the current/max rendering path
 * rather than the case where the two coincide and a bug is invisible.
 * `stress` and `credits` carry a null max for the same reason.
 */
const PROBE_POOLS = {
  hp: { current: 12, max: 15 },
  wounds: { current: 1, max: 3 },
  stress: { current: 4, max: null },
  strength: { current: 55, max: 55 },
  speed: { current: 40, max: 40 },
  intellect: { current: 35, max: 35 },
  combat: { current: 50, max: 60 },
  sanity: { current: 50, max: 50 },
  fear: { current: 30, max: 30 },
  body: { current: 40, max: 40 },
  credits: { current: 110, max: null },
};

function withTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}

/**
 * Renders every synthesis surface against the shared probe.
 *
 * The probe is `synthesis.fixtures.ts` rather than a dedicated one: those
 * fixtures already exist to exercise these functions and are the closest
 * thing the module has to a canonical input, so a second probe would be a
 * second thing to keep in step for no gain.
 */
export function renderSynthesisSurfaces(): SynthesisSurfaces {
  return {
    synthesisPrompt: withTrailingNewline(
      `# system\n${MOTHERSHIP_SYNTHESIS_SYSTEM_PROMPT}\n\n# user\n` +
        buildMothershipSynthesisPrompt(
          vasquezSheet,
          baseSelections,
          undefined,
          PROBE_POOLS,
        ),
    ),
    // Pretty-printed rather than minified so a golden diff reads as one
    // changed line, not one changed multi-KB line.
    synthesisTools: withTrailingNewline(
      JSON.stringify(SYNTHESIS_TOOLS, null, 2),
    ),
    characterProse: withTrailingNewline(
      formatMothershipCharacterProse(vasquezSheet, PROBE_POOLS),
    ),
    oracleEntry: withTrailingNewline(
      formatOracleEntry('Survivor', baseSelections.survivor),
    ),
    coherencePrompt: withTrailingNewline(
      `# system\n${MOTHERSHIP_COHERENCE_SYSTEM_PROMPT}\n\n# user\n` +
        buildMothershipCoherenceCheckPrompt(baseSelections),
    ),
    coherenceTools: withTrailingNewline(
      JSON.stringify(COHERENCE_TOOLS, null, 2),
    ),
  };
}

/** One committed golden that no longer matches what the code renders. */
export interface SynthesisGoldenMismatch {
  surface: keyof SynthesisSurfaces;
  /** The golden's filename, so an error names a file to go and look at. */
  file: string;
  reason: 'missing' | 'differs';
}

/**
 * Every committed golden that disagrees with the live render, or is absent.
 *
 * Returns rather than throws, matching `findAssemblyGoldenMismatches`: the
 * spec keeps its own per-file byte assertions for the readable diff and
 * asserts this is empty besides.
 */
export function findSynthesisGoldenMismatches(
  /** Overridable so the failure paths can be tested against a temp directory
   * rather than by mocking a function this repo owns. */
  dir: string = SYNTHESIS_GOLDEN_DIR,
): SynthesisGoldenMismatch[] {
  const surfaces = renderSynthesisSurfaces();
  const mismatches: SynthesisGoldenMismatch[] = [];

  for (const [key, file] of Object.entries(SYNTHESIS_GOLDEN_FILES)) {
    const surface = key as keyof SynthesisSurfaces;
    const path = join(dir, file);
    if (!existsSync(path)) {
      mismatches.push({ surface, file, reason: 'missing' });
      continue;
    }
    if (readFileSync(path, 'utf8') !== surfaces[surface]) {
      mismatches.push({ surface, file, reason: 'differs' });
    }
  }

  return mismatches;
}
