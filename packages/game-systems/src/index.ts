import { z } from 'zod';

import { MothershipOracleSelectionsSchema } from './mothership/oracle.schema';

// Explicit named re-exports for the dice surface. TypeScript compiles these
// to direct `exports.foo = ...` bindings in the CJS output, which Vite (via
// its CJS→ESM interop) can statically analyze from the frontend. `export *`
// compiles to `__exportStar(require(...), exports)` — opaque to Vite's
// static analyzer, which then reports "does not provide an export named X"
// in the browser at runtime. Keep this pattern for any surface the frontend
// imports as values (not types).
export {
  DiceNotationError,
  executeDiceRoll,
  parseDiceNotation,
  webCryptoRandomInt,
} from './dice';
export type { DiceRollResult, ParsedNotation } from './dice';

export * from './mothership/campaign-state.schema';
export * from './mothership/character-pools';
export * from './mothership/character-sheet.schema';
export * from './mothership/oracle.schema';
export * from './mothership/oracle-data';
export * from './mothership/pool-definitions';
export * from './shared';

export const oracleSchemas: Record<string, z.ZodTypeAny> = {
  mothership: MothershipOracleSelectionsSchema,
};
