import { z } from 'zod';

export const SynthesizeRequestSchema = z.object({
  oracleSelections: z.record(z.string(), z.unknown()),
  addendum: z.string().optional(),
});

export type SynthesizeRequestDto = z.infer<typeof SynthesizeRequestSchema>;
