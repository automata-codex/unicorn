import { z } from 'zod';

import { MothershipOracleSelectionsSchema } from './mothership/oracle.schema';

export * from './mothership/campaign-state.schema';
export * from './mothership/character-pools';
export * from './mothership/character-sheet.schema';
export * from './mothership/oracle.schema';
export * from './shared';

export const oracleSchemas: Record<string, z.ZodTypeAny> = {
  mothership: MothershipOracleSelectionsSchema,
};
