import { z } from 'zod';

export const CreateAdventureSchema = z.object({
  // Oracle selections accepted but ignored in M2 — synthesis pipeline is M4.
  oracleSelections: z.record(z.string(), z.array(z.string())).optional(),
  ranges: z.record(z.string(), z.number().int()).optional(),
});

export type CreateAdventureDto = z.infer<typeof CreateAdventureSchema>;
