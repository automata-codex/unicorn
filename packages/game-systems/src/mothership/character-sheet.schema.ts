import { z } from 'zod';

export const MothershipClassEnum = z.enum([
  'teamster',
  'scientist',
  'android',
  'marine',
]);

export const MothershipCharacterSheetSchema = z.object({
  entityId: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  pronouns: z.string().max(50).optional(),
  class: MothershipClassEnum,
  level: z.number().int().min(1).max(10).default(1),
  stats: z.object({
    strength: z.number().int().min(0).max(100),
    speed: z.number().int().min(0).max(100),
    intellect: z.number().int().min(0).max(100),
    combat: z.number().int().min(0).max(100),
    instinct: z.number().int().min(0).max(100),
    sanity: z.number().int().min(0).max(100),
  }),
  saves: z.object({
    fear: z.number().int().min(0).max(100),
    body: z.number().int().min(0).max(100),
    armor: z.number().int().min(0).max(100),
    armorMax: z.number().int().min(0).max(100),
  }),
  currentHp: z.number().int().min(0),
  maxHp: z.number().int().min(1),
  stress: z.object({
    current: z.number().int().min(0),
    max: z.number().int().min(1),
  }),
  skills: z.array(z.string()).default([]),
  equipment: z.array(z.string()).default([]),
  notes: z.string().max(2000).optional(),
});

export type MothershipCharacterSheet = z.infer<
  typeof MothershipCharacterSheetSchema
>;
