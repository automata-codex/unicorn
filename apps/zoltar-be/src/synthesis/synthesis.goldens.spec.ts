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
 * The four sections `synthesis.prompts.spec.ts`'s "includes every required
 * section" misses. The goldens would catch a deletion as a diff, but a diff
 * says "this text changed" and not "the section the wounds chain depends on
 * is gone" — these name them, so a deletion fails with the reason attached.
 *
 * Three of the four are load-bearing for the second M7.7 playtest:
 * `CREW ROLES:` for the Contractor-with-a-role capture target,
 * `RESOURCE POOL ADDRESSES:` for the wounds chain, and `WORLD FACTS:` for
 * `MISSING-CANON-CAPTURE`.
 */
describe('sections the required-section test does not assert', () => {
  const prompt = surfaces.synthesisPrompt;

  it('renders CREW ROLES:, which ADR-0100 and the Contractor capture depend on', () => {
    expect(prompt).toContain('CREW ROLES:');
    expect(prompt).toContain('NEVER INVENT AN NPC TO FILL A ROLE');
    // The backend rolls Instinct at synthesis-write time and `SYNTHESIS_TOOLS`
    // has no `roll_dice`, so a model-supplied value is a fabrication.
    expect(prompt).toContain('Do not supply Instinct');
  });

  it('renders RESOURCE POOL ADDRESSES:, which spec 018 and the wounds chain depend on', () => {
    expect(prompt).toContain('RESOURCE POOL ADDRESSES:');
    expect(prompt).toContain('"{owner}.{pool_name}"');
    // The composite-key prohibition is the synthesis-side half of the
    // duplicate-pool defect that gave the corpus `alvarez_*`/`lt_alvarez_*`.
    expect(prompt).toContain('composite single-part key');
    expect(prompt).toContain('_scenario');
  });

  it('renders WORLD FACTS:, which MISSING-CANON-CAPTURE depends on', () => {
    expect(prompt).toContain('WORLD FACTS:');
    expect(prompt).toContain('Spatial layout (required)');
  });

  it('renders the oracle-wiring paragraph', () => {
    expect(prompt).toContain('interfaces array');
    expect(prompt).toContain('submit_gm_context');
  });
});
