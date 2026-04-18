import { z } from 'zod';

export const PoolDefinitionSchema = z.object({
  min: z.number().int().nullable(),
  max: z.number().int().nullable(),
  thresholds: z
    .array(
      z.object({
        value: z.number().int(),
        effect: z.string(),
      }),
    )
    .default([]),
});

export type PoolDefinition = z.infer<typeof PoolDefinitionSchema>;

const HP_DEFINITION: PoolDefinition = {
  min: null,
  max: null,
  thresholds: [{ value: 0, effect: 'death_save_required' }],
};

const STRESS_DEFINITION: PoolDefinition = {
  min: 0,
  max: null,
  thresholds: [],
};

const DEFAULT_DEFINITION: PoolDefinition = {
  min: null,
  max: null,
  thresholds: [],
};

export function getMothershipPoolDefinition(poolName: string): PoolDefinition {
  if (poolName.endsWith('_hp')) return HP_DEFINITION;
  if (poolName.endsWith('_stress')) return STRESS_DEFINITION;
  return DEFAULT_DEFINITION;
}
