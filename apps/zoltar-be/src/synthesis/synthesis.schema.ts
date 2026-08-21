import { MothershipCrewRoleEnum } from '@uv/game-systems';
import { z } from 'zod';

const entitySchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(['npc', 'threat', 'feature']),
    /**
     * The Contractor's crew role (`ADR-0100`). `npc` only.
     *
     * **`instinctRoll` is deliberately absent from this schema.** The backend
     * rolls Instinct; synthesis has no `roll_dice`, so a number the model
     * supplied would be a fabrication rather than a roll. Leaving the field out
     * means `.strip()` drops it rather than trusting a prompt instruction not to
     * send one — `ADR-0097` is the precedent for not relying on the prompt where
     * a schema can enforce it.
     */
    crewRole: MothershipCrewRoleEnum.optional(),
    startingPosition: z
      .object({
        x: z.number().int(),
        y: z.number().int(),
        z: z.number().int().default(0),
      })
      .optional(),
    visible: z.boolean(),

    /**
     * Discovery (`ADR-0101`). Optional here, unlike on `EntitySchema`, and
     * defaulted to `visible` by `buildEntityMap` when omitted — at synthesis the
     * two usually coincide, and asking the author for a second boolean they will
     * almost always set to the first is how a field stops being read.
     *
     * It is offered at all because one combination is genuinely useful:
     * `visible: false, revealed: true` is an entity the crew already knows about
     * but cannot currently see — the cartographer in another compartment. The
     * mirror image is incoherent and rejected below: an entity in line of sight
     * has necessarily been discovered.
     */
    revealed: z.boolean().optional(),

    tags: z.array(z.string()),
  })
  .superRefine((entity, ctx) => {
    if (entity.visible && entity.revealed === false) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['revealed'],
        message:
          'an entity in line of sight has been discovered: `visible: true` with `revealed: false` is not a state that exists',
      });
    }
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
