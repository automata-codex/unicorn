import { z } from 'zod';

const entitySchema = z.object({
  id: z.string().min(1),
  type: z.enum(['npc', 'threat', 'feature']),
  startingPosition: z
    .object({
      x: z.number().int(),
      y: z.number().int(),
      z: z.number().int().default(0),
    })
    .optional(),
  visible: z.boolean(),
  tags: z.array(z.string()),
});

const flagSchema = z.object({
  value: z.boolean(),
  trigger: z.string(),
});

export const submitGmContextSchema = z.object({
  openingNarration: z.string().optional(),

  narrative: z.object({
    location: z.string(),
    atmosphere: z.string(),
    npcAgendas: z.record(z.string(), z.string()),
    hiddenTruth: z.string(),
    oracleConnections: z.string(),
  }),

  structured: z.object({
    entities: z.array(entitySchema),
    flags: z.record(z.string(), flagSchema),
    initialState: z.record(z.string(), z.unknown()),
    worldFacts: z.record(z.string(), z.string()).optional(),
  }),
});

export type SubmitGmContext = z.infer<typeof submitGmContextSchema>;

export const coherenceConflictSchema = z.object({
  category: z.string(),
  description: z.string(),
  rerollable: z.boolean(),
});

export const coherenceReportSchema = z
  .object({
    conflicts: z.array(coherenceConflictSchema),
    resolution: z.enum(['proceed', 'reroll', 'surface']),
    rerollCategory: z.string().optional(),
  })
  .refine(
    (report) => report.resolution !== 'reroll' || !!report.rerollCategory,
    { message: 'rerollCategory is required when resolution is "reroll"' },
  );

export type CoherenceConflict = z.infer<typeof coherenceConflictSchema>;
export type CoherenceReport = z.infer<typeof coherenceReportSchema>;
