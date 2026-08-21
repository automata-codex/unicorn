import { join } from 'node:path';
import {
  CREW_ROLE_SKILLS,
  crewRoleInstinctAdjustment,
  MothershipCampaignStateSchema,
  MothershipCrewRoleEnum,
} from '@uv/game-systems';

import { hashPromptText } from '../wardens/prompt-paths';

import { formatGmContextBlob } from './session.prompt';
import { buildStateSnapshot } from './session.snapshot';
import { SESSION_TOOLS } from './session.tools';

import type { CampaignStateData, GmContextBlob } from './session.snapshot';

/**
 * A fingerprint of everything the Warden sees that is **built by code** —
 * the tool definitions, the GM context block, and the state snapshot.
 *
 * ## Why this exists separately from `promptHash`
 *
 * Three of the four surfaces that reach the Warden are produced by
 * functions, not authored as files. `promptHash` covers the fourth
 * (`mothership-m7.txt`) by hashing the file, which is exactly right for a
 * file — its content is its identity. The other three have no identity at
 * all: `formatGmContextBlob` could start emitting `openingNarration`, a
 * snapshot section could be added, a tool description could be rewritten,
 * and every eval run before and after would be silently incomparable.
 *
 * `harnessVersion` does not fill that gap. It is the git SHA, so it moves on
 * every commit — it can say "the repo differs", never "what the model sees
 * differs". A signal that fires on every comparison is one nobody reads.
 *
 * ## How it works
 *
 * A fixed, synthetic adventure (`ASSEMBLY_PROBE`) is rendered through the
 * real formatters, and the hash is taken over that render. Because the input
 * is frozen, the output changes when and only when the *shape* changes: a
 * refactor that produces identical text leaves the hash alone, while adding
 * a field moves it. Fixture data changing is a different question, already
 * answered by `corpusVersion`.
 *
 * The hash is computed **live** rather than read from the golden files, so
 * it can never go stale relative to the code. The goldens exist to make a
 * change readable — `session.assembly.spec.ts` asserts the live render still
 * matches them, so altering any of these three surfaces fails a test and the
 * fix is committing an updated golden, which shows up in review as a diff of
 * the text the Warden actually receives.
 */

/**
 * The frozen input. Every branch of both formatters should be exercised
 * here — a section this probe never populates is a section whose shape the
 * hash cannot see.
 *
 * `openingNarration` is populated deliberately even though
 * `formatGmContextBlob` does **not** emit it: its absence from the golden is
 * the assertion. A change that started including it would move the hash,
 * which is the point.
 */
export const ASSEMBLY_PROBE: {
  gmContextBlob: GmContextBlob;
  campaignStateData: CampaignStateData;
} = {
  gmContextBlob: {
    openingNarration: 'Deliberately not rendered — see the doc comment above.',
    narrative: {
      location: 'Probe Station',
      atmosphere: 'Cold, and quieter than it should be.',
      npcAgendas: {
        probe_npc_one: 'Wants the reactor kept online.',
        probe_npc_two: 'Wants off the station before anyone notices.',
      },
      hiddenTruth: 'The distress signal was sent from inside.',
      oracleConnections: 'Signal ↔ the sealed compartment on Deck 0.',
    },
    entities: [
      {
        id: 'probe_npc_one',
        type: 'npc',
        visible: true,
        tags: ['crew'],
        // A Contractor with a role, so the derivation is in the golden at all.
        crewRole: 'chief_engineer',
      },
      {
        id: 'probe_threat',
        type: 'threat',
        visible: false,
        tags: ['unknown', 'aft'],
      },
      { id: 'probe_feature', type: 'feature', visible: true, tags: [] },
    ],
    structured: {
      flags: {
        probe_flag_set: { value: true, trigger: 'Set when the probe runs.' },
        probe_flag_unset: { value: false, trigger: 'Never set.' },
      },
    },
    playerEntityIds: ['probe_player'],
  },
  // Parsed through the real schema rather than asserted into the type, so
  // the probe is a *valid* campaign state by construction and picks up any
  // defaulted field a future schema version adds — which is correct, since a
  // new defaulted field can change what the snapshot renders.
  campaignStateData: MothershipCampaignStateSchema.parse({
    schemaVersion: 1,
    resourcePools: {
      probe_player: {
        hp: { current: 8, max: 12 },
        stress: { current: 3, max: 20 },
      },
      _scenario: { probe_timer: { current: 5, max: null } },
    },
    characterState: {
      probe_player: {
        // Two skills and one suppressed by the `loss_of_confidence` below.
        // The suppressed case is the branch the render is most likely to get
        // wrong, and a probe that never populates it is a shape the hash
        // cannot see.
        skills: [
          { skill: 'Zero-G', tier: 'trained' },
          { skill: 'Piloting', tier: 'expert' },
        ],
        conditions: [
          { condition: 'frightened', parameter: 'probe_threat' },
          { condition: 'loss_of_confidence', parameter: 'Piloting' },
        ],
        // Both scopes: one that takes a target and one that does not.
        rollModifiers: [
          {
            effect: 'disadvantage',
            scope: 'all_rolls',
            source: 'Wounds Table: skull fracture',
          },
          {
            effect: 'advantage',
            scope: 'save',
            target: 'body',
            source: 'Automed',
          },
        ],
        wornArmor: {
          item: 'Standard Crew Attire',
          apBase: 3,
          apCurrent: 1,
          dr: 0,
          destroyed: false,
          o2Remaining: null,
          features: ['sealed'],
        },
        wounds: 1,
        minimumStress: 2,
      },
    },
    entities: {
      probe_npc_one: {
        visible: true,
        revealed: true,
        status: 'alive',
        crewRole: 'chief_engineer',
        instinctRoll: [6, 3],
      },
      // Hidden *and* undiscovered — the case the snapshot filter used to hide
      // entirely, and the only entity here that exercises either false branch.
      probe_threat: { visible: false, revealed: false, status: 'unknown' },
    },
    flags: {
      probe_flag_set: { value: true, trigger: 'Set when the probe runs.' },
    },
    scenarioState: { probe_counter: { current: 2, max: 6 } },
    worldFacts: { probe_fact: 'The aft airlock has been welded shut.' },
  }),
};

/** The code-built surfaces, rendered from the frozen probe. */
export interface AssemblySurfaces {
  gmContext: string;
  stateSnapshot: string;
  tools: string;
  crewRoles: string;
}

/**
 * Each surface ends with exactly one newline, so a golden file is a
 * byte-for-byte copy of the render and the spec needs no normalization step
 * — normalization is where a golden quietly stops asserting what it claims.
 */
function withTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}

export function renderAssemblySurfaces(): AssemblySurfaces {
  return {
    gmContext: withTrailingNewline(
      formatGmContextBlob(ASSEMBLY_PROBE.gmContextBlob),
    ),
    stateSnapshot: withTrailingNewline(buildStateSnapshot(ASSEMBLY_PROBE)),
    // Pretty-printed rather than minified so a golden diff reads as one
    // changed line, not one changed 18KB line.
    tools: withTrailingNewline(JSON.stringify(SESSION_TOOLS, null, 2)),
    crewRoles: withTrailingNewline(renderCrewRoleTable()),
  };
}

/**
 * Every row of `CREW_ROLE_SKILLS`, rendered.
 *
 * **The probe alone cannot guard this table.** A Contractor's skills are
 * derived at read time rather than stored, so editing the table changes what
 * the Warden sees for frozen eval fixtures whose files did not change —
 * `corpusVersion` hashes fixture files and will not move. `assemblyHash` is the
 * only thing that can see it, and `probe_npc_one` holds one role: with a
 * `chief_engineer` in the probe, editing `xenobiologist` would move nothing.
 *
 * Rendering all twenty closes that, and doubles as a readable diff of a table
 * edit in review.
 */
function renderCrewRoleTable(): string {
  return MothershipCrewRoleEnum.options
    .map((role) => {
      const chain = CREW_ROLE_SKILLS[role]
        .map((entry) => `${entry.skill} ${entry.tier}`)
        .join(', ');
      return `${role} (+${crewRoleInstinctAdjustment(role)}): ${chain}`;
    })
    .join('\n');
}

/**
 * Golden filename per surface. Plain `.txt` for all three — including the
 * tools JSON — so the formatter leaves them alone. `biome.json` excludes
 * `eval/fixtures/` for the same reason; a formatter that reflows a golden
 * moves the hash without anyone changing what the Warden sees.
 */
export const ASSEMBLY_GOLDEN_FILES: Record<keyof AssemblySurfaces, string> = {
  gmContext: 'gm-context.txt',
  stateSnapshot: 'state-snapshot.txt',
  tools: 'tools.txt',
  crewRoles: 'crew-roles.txt',
};

/**
 * Where the goldens live. Resolved from `__dirname`, which is fine because
 * the only readers are the spec and any CLI that runs from source — the hash
 * itself never reads them, so nothing here depends on Nest copying non-`.ts`
 * assets into `dist/`.
 */
export const ASSEMBLY_GOLDEN_DIR = join(__dirname, 'assembly-golden');

/**
 * Ordered, labelled join. Labels are included so that moving text between
 * two surfaces changes the hash rather than cancelling out.
 */
export function serializeAssemblySurfaces(s: AssemblySurfaces): string {
  return (
    `# gmContext\n${s.gmContext}\n` +
    `# stateSnapshot\n${s.stateSnapshot}\n` +
    `# tools\n${s.tools}\n` +
    `# crewRoles\n${s.crewRoles}`
  );
}

/**
 * 8 hex chars, same convention as `promptHash` so the two read alike in a
 * manifest. Computed from the live render every time it is called.
 */
export function computeAssemblyHash(): string {
  return hashPromptText(serializeAssemblySurfaces(renderAssemblySurfaces()));
}
