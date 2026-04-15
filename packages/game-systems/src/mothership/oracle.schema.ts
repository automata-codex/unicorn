import { z } from 'zod';

export const OracleInterfaceSchema = z.object({
  condition: z.string(),
  note: z.string(),
});

export const OracleEntrySchema = z.object({
  id: z.string().min(1),
  player_text: z.string(),
  claude_text: z.string(),
  interfaces: z.array(OracleInterfaceSchema),
  tags: z.array(z.string()),
});

export type OracleEntry = z.infer<typeof OracleEntrySchema>;

export const MothershipOracleSelectionsSchema = z.object({
  survivor: OracleEntrySchema,
  threat: OracleEntrySchema,
  secret: OracleEntrySchema,
  vessel_type: OracleEntrySchema,
  tone: OracleEntrySchema,
});

export type MothershipOracleSelections = z.infer<
  typeof MothershipOracleSelectionsSchema
>;
