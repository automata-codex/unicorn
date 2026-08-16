/**
 * M7.6 Part 9 — bring the eval corpus's seeded `campaignState` up to the shape
 * the code now produces: the player's full pool set, and the per-entity
 * `characterState` block Part 3 added.
 *
 *   npx tsx scripts/one-off/seed-fixture-character-state.ts [--check]
 *
 * A second one-off after `rekey-fixture-pools.ts`, deliberately separate: that
 * one was a lossless re-addressing of captured content, this one *adds* values
 * the capture never held. Keeping them apart keeps the mechanical change
 * reviewable on its own.
 *
 * **The added values are synthetic and this is the honest place to say so.**
 * The corpus was captured from an adventure played before Stats and Saves were
 * pools, so no roll for them exists anywhere. They are chosen to be internally
 * consistent with what *was* captured — `alvarez.hp` was 20/20, which is the
 * maximum `1d10+10`, and the character is a Marine — and to be unremarkable,
 * so no fixture's outcome turns on a stat being high or low. What matters for
 * a fixture is that the state is well-formed and stable across the corpus, not
 * that it descends from real dice.
 *
 * `alvarez.armor` is *removed* rather than carried: it was the old
 * `saves.armor`, and armor is `characterState.wornArmor` now, not a pool. The
 * captured 30/30 becomes a vaccsuit with the AP the value implies.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { stringifyFixture } from './rekey-fixture-pools.core';

const FIXTURES_DIR = join(__dirname, '../../eval/fixtures');

/** The player character every fixture in this corpus was captured against. */
const PLAYER = 'alvarez';

/**
 * Marine, `2d10+25` Stats and `2d10+10` Saves plus the Marine adjustments
 * (+10 Combat, +10 Body, +20 Fear, +1 Max Wounds). Health 20/20 is what the
 * capture already carried.
 */
const PLAYER_POOLS = {
  hp: { current: 20, max: 20 },
  wounds: { current: 0, max: 3 },
  // The capture had `alvarez.stress` at 0/3. Stress floors at Minimum Stress,
  // which is 2, and has no ceiling.
  stress: { current: 2, max: null },
  strength: { current: 38, max: 38 },
  speed: { current: 34, max: 34 },
  intellect: { current: 31, max: 31 },
  combat: { current: 45, max: 45 },
  sanity: { current: 22, max: 22 },
  fear: { current: 41, max: 41 },
  body: { current: 29, max: 29 },
  credits: { current: 120, max: null },
};

const PLAYER_CHARACTER_STATE = {
  conditions: [],
  skills: [
    { skill: 'Military Training', tier: 'trained' },
    { skill: 'Firearms', tier: 'expert' },
  ],
  equipment: [
    { item: 'Revolver', charges: 6 },
    { item: 'Stimpak', quantity: 2 },
  ],
  wornArmor: {
    item: 'Vaccsuit',
    apBase: 3,
    apCurrent: 3,
    destroyed: false,
    dr: 0,
    o2Remaining: 12,
    features: [],
  },
  minimumStress: 2,
  bleeding: 0,
  pendingDeathSave: null,
};

/** NPCs that carry an hp pool get state too, so a turn can wound them. */
const NPC_CHARACTER_STATE = {
  conditions: [],
  skills: [],
  equipment: [],
  wornArmor: null,
  minimumStress: 2,
  bleeding: 0,
  pendingDeathSave: null,
};

interface FixtureShape {
  seededState: {
    campaignState: {
      resourcePools: Record<string, Record<string, unknown>>;
      characterState?: Record<string, unknown>;
    };
  };
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const filenames = (await readdir(FIXTURES_DIR))
    .filter((f) => f.endsWith('.json'))
    .sort();

  let changed = 0;
  for (const filename of filenames) {
    const path = join(FIXTURES_DIR, filename);
    const original = await readFile(path, 'utf8');
    const fixture = JSON.parse(original) as FixtureShape;
    const state = fixture.seededState.campaignState;

    state.resourcePools[PLAYER] = { ...PLAYER_POOLS };

    const characterState: Record<string, unknown> = {
      [PLAYER]: PLAYER_CHARACTER_STATE,
    };
    for (const [owner, pools] of Object.entries(state.resourcePools)) {
      if (owner === PLAYER || owner.startsWith('_')) continue;
      if ('hp' in pools) characterState[owner] = NPC_CHARACTER_STATE;
    }
    state.characterState = characterState;

    const next = stringifyFixture(fixture);
    if (next === original) {
      console.log(`${filename}: unchanged`);
      continue;
    }
    changed += 1;
    console.log(
      `${filename}: ${Object.keys(PLAYER_POOLS).length} player pools, ` +
        `${Object.keys(characterState).length} characterState entries`,
    );
    if (!check) await writeFile(path, next);
  }

  console.log(
    check
      ? `\n--check: ${changed} fixture(s) would change.`
      : `\n${changed} fixture(s) rewritten.`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
