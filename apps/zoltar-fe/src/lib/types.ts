import type { MothershipCharacterSheet } from '@uv/game-systems';

export type Campaign = {
  id: string;
  name: string;
  visibility: string;
  diceMode: string;
  createdAt: string;
};

export type Adventure = {
  id: string;
  campaignId: string;
  status: string;
  mode: string;
  callerId: string;
  openingNarration: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type CoherenceConflict = {
  category: string;
  description: string;
};

/**
 * `data` is the real type from `@uv/game-systems`, not a hand-written copy.
 *
 * The copy this replaces typed stats and saves as `Record<string, number>`,
 * `class` as `string`, and omitted `level` — so it agreed with the backend on
 * nothing that mattered and caught none of M7.6's changes at compile time.
 * Importing the real one is what turns the rest of this milestone's frontend
 * work into compiler errors instead of bug reports.
 */
export type CharacterSheet = {
  id: string;
  campaignId: string;
  system: string;
  data: MothershipCharacterSheet;
};
