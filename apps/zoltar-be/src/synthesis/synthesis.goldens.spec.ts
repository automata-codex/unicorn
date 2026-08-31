import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  findSynthesisGoldenMismatches,
  renderSynthesisSurfaces,
  SYNTHESIS_GOLDEN_DIR,
  SYNTHESIS_GOLDEN_FILES,
} from './synthesis.goldens';

import type { SynthesisSurfaces } from './synthesis.goldens';

/**
 * `UPDATE_SYNTHESIS_GOLDENS=1 npm test -- synthesis.goldens` rewrites them.
 *
 * Same shape as `session.assembly.spec.ts`: changing what a model receives
 * costs one explicit step and lands in review as a diff of the text itself.
 */
const UPDATE = process.env.UPDATE_SYNTHESIS_GOLDENS === '1';

const surfaces = renderSynthesisSurfaces();

describe('synthesis goldens', () => {
  for (const [key, filename] of Object.entries(SYNTHESIS_GOLDEN_FILES)) {
    it(`${filename} matches what the code renders today`, () => {
      const rendered = surfaces[key as keyof SynthesisSurfaces];
      const path = join(SYNTHESIS_GOLDEN_DIR, filename);

      if (UPDATE) {
        writeFileSync(path, rendered);
        return;
      }

      // Byte-for-byte: `renderSynthesisSurfaces` normalizes the trailing
      // newline, so there is nothing to trim on either side.
      expect(rendered).toBe(readFileSync(path, 'utf8'));
    });
  }
});

/**
 * Writes a full set of goldens to a fresh temp directory, optionally
 * corrupting or omitting one. Real files rather than a mocked reader — the
 * thing under test is whether a stale render is caught on disk.
 */
function goldenDir(
  opts: {
    corrupt?: keyof SynthesisSurfaces;
    omit?: keyof SynthesisSurfaces;
  } = {},
): string {
  const dir = mkdtempSync(join(tmpdir(), 'synthesis-goldens-'));
  for (const [key, file] of Object.entries(SYNTHESIS_GOLDEN_FILES)) {
    const surface = key as keyof SynthesisSurfaces;
    if (opts.omit === surface) continue;
    const text =
      opts.corrupt === surface
        ? `${surfaces[surface]}an edit nobody committed\n`
        : surfaces[surface];
    writeFileSync(join(dir, file), text);
  }
  return dir;
}

describe('findSynthesisGoldenMismatches', () => {
  it('is empty when every golden matches', () => {
    if (UPDATE) return;
    expect(findSynthesisGoldenMismatches()).toEqual([]);
  });

  it('finds nothing when every golden in a fresh dir matches the render', () => {
    expect(findSynthesisGoldenMismatches(goldenDir())).toEqual([]);
  });

  it('reports a golden whose text has drifted from the render', () => {
    expect(
      findSynthesisGoldenMismatches(goldenDir({ corrupt: 'synthesisPrompt' })),
    ).toEqual([
      {
        surface: 'synthesisPrompt',
        file: 'synthesis-prompt.txt',
        reason: 'differs',
      },
    ]);
  });

  it('reports a golden that is absent rather than throwing', () => {
    expect(
      findSynthesisGoldenMismatches(goldenDir({ omit: 'coherenceTools' })),
    ).toEqual([
      {
        surface: 'coherenceTools',
        file: 'coherence-tools.txt',
        reason: 'missing',
      },
    ]);
  });
});

/**
 * Guidance the synthesis call cannot lose, asserted against **everything the
 * model receives** rather than against the prompt alone.
 *
 * These began as the four sections `synthesis.prompts.spec.ts`'s "includes
 * every required section" misses. `ADR-0118` moved most of that text out of
 * the prompt and onto the fields themselves, and asserting on the prompt would
 * now fail for text that still reaches the model perfectly well — the tests
 * would be measuring the home rather than the guarantee.
 *
 * So they read the concatenation. The guarantee was always *the model is told
 * this*, and it holds whichever surface carries it; a later move back the other
 * way is equally fine and equally covered. The goldens catch a deletion as a
 * diff, but a diff says "this text changed" and not "the rule the wounds chain
 * depends on is gone" — these name them, so a deletion fails with the reason
 * attached.
 */
describe('guidance the model must receive, on whichever surface', () => {
  const received = `${surfaces.synthesisPrompt}\n${surfaces.synthesisTools}`;

  it('carries the crew-role rules that ADR-0100 and the Contractor capture depend on', () => {
    expect(received).toContain('NEVER INVENT AN NPC TO FILL A ROLE');
    // The backend rolls Instinct at synthesis-write time and `SYNTHESIS_TOOLS`
    // has no `roll_dice`, so a model-supplied value is a fabrication.
    expect(received).toContain('do not supply Instinct');
  });

  it('carries the pool addressing that spec 018 and the wounds chain depend on', () => {
    expect(received).toContain('{owner}.{pool_name}');
    // The composite-key prohibition is the synthesis-side half of the
    // duplicate-pool defect that gave the corpus `alvarez_*`/`lt_alvarez_*`.
    expect(received).toContain('composite single-part key');
    expect(received).toContain('_scenario');
  });

  it('carries the world-facts rules that MISSING-CANON-CAPTURE depends on', () => {
    expect(received).toContain('spatial layout');
    // `ADR-0117`'s restructure. Unmeasured (`eval-findings.md § S44`) and kept
    // on a cost argument, so it must not evaporate in a refactor unnoticed.
    expect(received).toContain('NUMBER THE DECKS FROM THE TOP DOWN');
  });

  it('carries the oracle-wiring paragraph', () => {
    expect(received).toContain('interfaces array');
    expect(received).toContain('submit_gm_context');
  });

  /**
   * `ADR-0118`'s policy, asserted rather than merely written down: per-field
   * guidance belongs on the field. A section heading returning to the prompt is
   * the drift the entry names, and it is invisible without this.
   */
  it('keeps per-field guidance out of the prompt', () => {
    for (const heading of [
      'FLAGS:',
      'RESOURCE POOL ADDRESSES:',
      'COUNTDOWN TIMERS:',
      'WORLD FACTS:',
      'OPENING NARRATION:',
    ]) {
      expect(surfaces.synthesisPrompt).not.toContain(heading);
    }
  });
});
