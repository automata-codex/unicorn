import { z } from 'zod';

export const SynthesizeRequestSchema = z.object({
  oracleSelections: z.record(z.string(), z.unknown()),

  /**
   * The entry ids the player left enabled in the oracle filter, per category,
   * keyed by selection key to match `oracleSelections`.
   *
   * **Required, and the coherence reroll is why.** Before this field existed
   * the request carried only the drawn selection, and the backend reconstructed
   * the pool to reroll from by taking every entry the game system ships
   * (`synthesis.controller.ts`, `getMothershipOraclePool`). A reroll therefore
   * drew from options the player had explicitly deselected — not as an edge
   * case but as the only behaviour available, because the filter had never
   * crossed the wire. The 2026-08-16 playtest logged exactly that:
   * `Coherence reroll: tone body_horror -> corporate_nihilism`, substituting a
   * tone that had been switched off.
   *
   * Required rather than optional deliberately. Optional would mean an older
   * client silently keeps the broken behaviour, which is the failure mode that
   * produced the bug; this is a self-hosted SPA served from the same deploy, so
   * a version skew is a deploy problem and should present as a 422 rather than
   * as a quietly wrong adventure.
   */
  activeEntryIds: z.record(z.string(), z.array(z.string()).min(1)),

  addendum: z.string().optional(),
});

export type SynthesizeRequestDto = z.infer<typeof SynthesizeRequestSchema>;
