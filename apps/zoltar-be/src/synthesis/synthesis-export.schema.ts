import { z } from 'zod';

/**
 * Portable "starting conditions" clone for an adventure. Produced by the
 * `save-synthesis` CLI and consumed by `load-synthesis` to recreate the
 * same initial state in a new campaign + adventure. The mechanism by which
 * M7.1 runs the same scenario against different Warden prompt candidates:
 * freeze starting conditions once, load N times.
 *
 * Versioned — the loader rejects unknown versions loudly. `version: 1`
 * covers M7.1's Mothership-only freeform use case. Future versions can
 * widen the shape (other systems, initiative mode, mid-session export).
 *
 * `gmContext.schemaVersion` / `campaignState.schemaVersion` are read from
 * the corresponding DB columns (both default to 1 today). They exist so a
 * future shape change to either jsonb blob can be detected on load and
 * either migrated or refused.
 */
export const synthesisExportSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  source: z.object({
    campaignId: z.string().uuid(),
    adventureId: z.string().uuid(),
    campaignName: z.string(),
  }),
  system: z.object({
    slug: z.literal('mothership'),
  }),
  gmContext: z.object({
    schemaVersion: z.number().int().positive(),
    blob: z.unknown(),
  }),
  campaignState: z.object({
    schemaVersion: z.number().int().positive(),
    data: z.unknown(),
  }),
  adventure: z.object({
    mode: z.literal('freeform'),
  }),
});

export type SynthesisExport = z.infer<typeof synthesisExportSchema>;
