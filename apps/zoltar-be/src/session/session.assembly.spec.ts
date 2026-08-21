import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ASSEMBLY_GOLDEN_DIR,
  ASSEMBLY_GOLDEN_FILES,
  ASSEMBLY_PROBE,
  computeAssemblyHash,
  renderAssemblySurfaces,
  serializeAssemblySurfaces,
} from './session.assembly';

import type { AssemblySurfaces } from './session.assembly';

/**
 * Set `UPDATE_ASSEMBLY_GOLDENS=1` to rewrite the goldens from the current
 * render:
 *
 *     UPDATE_ASSEMBLY_GOLDENS=1 npx vitest run src/session/session.assembly.spec.ts
 *
 * Deliberately an env var rather than something the suite does on its own.
 * A golden that self-heals asserts nothing — the point is that changing what
 * the Warden sees costs one explicit step and lands in review as a diff of
 * the text itself.
 */
const UPDATE = process.env.UPDATE_ASSEMBLY_GOLDENS === '1';

const surfaces = renderAssemblySurfaces();

describe('assembly goldens', () => {
  for (const [key, filename] of Object.entries(ASSEMBLY_GOLDEN_FILES)) {
    it(`${filename} matches what the code renders today`, () => {
      const rendered = surfaces[key as keyof AssemblySurfaces];
      const path = join(ASSEMBLY_GOLDEN_DIR, filename);

      if (UPDATE) {
        writeFileSync(path, rendered);
        return;
      }

      // Byte-for-byte: `renderAssemblySurfaces` already normalizes the
      // trailing newline, so there is nothing to trim on either side.
      expect(rendered).toBe(readFileSync(path, 'utf8'));
    });
  }
});

describe('the probe exercises every section', () => {
  // A section the probe never populates is a section whose shape the hash
  // cannot see, so these assertions are load-bearing rather than decorative:
  // they fail when a formatter gains a block the probe doesn't reach.
  it.each([
    ['<narrative>'],
    ['<entities>'],
    ['<flags>'],
  ])('gm context renders %s', (tag) => {
    expect(surfaces.gmContext).toContain(tag);
  });

  it.each([
    ['<resource_pools>'],
    ['<character_attributes>'],
    ['<entities>'],
    ['<flags>'],
    ['<scenario_state>'],
    ['<world_facts>'],
  ])('state snapshot renders %s', (tag) => {
    expect(surfaces.stateSnapshot).toContain(tag);
  });

  it('withholds openingNarration from the gm context', () => {
    // The probe supplies it precisely so its absence is asserted; a change
    // that started emitting it would move the hash, which is the point.
    expect(ASSEMBLY_PROBE.gmContextBlob.openingNarration).toBeTruthy();
    expect(surfaces.gmContext).not.toContain(
      ASSEMBLY_PROBE.gmContextBlob.openingNarration as string,
    );
  });

  /**
   * Inverted by `ADR-0101`. This test used to assert that `probe_threat` was
   * absent from `<entities>`, on the stated grounds that "spatial secrets are
   * structurally absent from the snapshot rather than withheld
   * behaviourally". That belief did not survive contact with the assembled
   * prompt: `<gm_context>` names the same entity, on the line asserted below,
   * tagged `starts hidden`. Nothing about it was structurally absent — the
   * filter withheld only the current value of its flag, from the one consumer
   * that needs it.
   */
  it('renders a hidden entity in both blocks, with its flags (`ADR-0101`)', () => {
    expect(surfaces.gmContext).toContain(
      '- probe_threat (threat, starts hidden)',
    );

    const entitiesBlock = surfaces.stateSnapshot.match(
      /<entities>[\s\S]*?<\/entities>/,
    )?.[0];
    expect(entitiesBlock).toBeDefined();
    expect(entitiesBlock).toContain(
      'probe_threat: hidden, undiscovered, status=unknown',
    );

    // Unchanged and still worth pinning: the probe's `frightened` condition
    // names probe_threat as its parameter, so the id reaches the snapshot by
    // that route as well. `ADR-0101` reads that as correct — a character
    // frightened *of* something has perceived it.
    expect(surfaces.stateSnapshot).toContain('frightened (probe_threat)');
  });

  /**
   * `assemblyHash` can only see what the probe exercises. A field that is
   * present but always at its default renders identically whatever the code
   * does with it, so an edit to that branch moves no run identity — the
   * failure `ADR-0099` was written to prevent, and the one `CREW_ROLE_SKILLS`
   * hit before the whole table was folded in.
   *
   * This asserts the *rendered surfaces*, not the probe literal, because the
   * literal having a field proves nothing about whether the renderer reached
   * it.
   */
  it('exercises both branches of every entity flag `ADR-0101` added', () => {
    const block = surfaces.stateSnapshot.match(
      /<entities>[\s\S]*?<\/entities>/,
    )?.[0] as string;

    expect(block).toContain('visible');
    expect(block).toContain('hidden');
    expect(block).toContain('revealed');
    expect(block).toContain('undiscovered');

    // Hidden *and* discovered — the combination with no single-boolean
    // spelling, and the reason the field was split at all.
    expect(block).toMatch(/probe_hidden_npc: hidden, revealed,/);

    // A hidden entity rendering role-derived skills. Without an entity that is
    // both hidden and role-bearing, this branch is unreachable from the hash.
    expect(block).toMatch(/probe_hidden_npc:.*skills .*expert/);

    // Disposition on a hidden entity.
    expect(block).toMatch(/probe_hidden_npc:.*state: /);
  });

  it('describes every top-level submit_gm_response property', () => {
    // The gap this whole mechanism was built after: `stateChanges` carried
    // fourteen nested descriptions while the five properties above it
    // carried none, and nothing was looking at the assembled tool schema.
    const tools = JSON.parse(surfaces.tools) as {
      name: string;
      input_schema: { properties: Record<string, { description?: string }> };
    }[];
    const submit = tools.find((t) => t.name === 'submit_gm_response');
    expect(submit).toBeDefined();
    for (const [name, prop] of Object.entries(
      submit?.input_schema.properties ?? {},
    )) {
      expect(prop.description, `${name} has no description`).toBeTruthy();
    }
  });
});

describe('computeAssemblyHash', () => {
  it('is stable across calls', () => {
    expect(computeAssemblyHash()).toBe(computeAssemblyHash());
  });

  it('is 8 hex chars, matching the promptHash convention', () => {
    expect(computeAssemblyHash()).toMatch(/^[0-9a-f]{8}$/);
  });

  it('moves when any one surface changes', () => {
    // Labelled joins are why: without them, text moving between two
    // surfaces would cancel out and the hash would miss the change.
    const base = serializeAssemblySurfaces(surfaces);
    for (const key of Object.keys(ASSEMBLY_GOLDEN_FILES)) {
      const mutated = serializeAssemblySurfaces({
        ...surfaces,
        [key]: `${surfaces[key as keyof AssemblySurfaces]}changed`,
      });
      expect(mutated, `${key} did not affect the serialization`).not.toBe(base);
    }
  });
});
