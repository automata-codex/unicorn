import { Module } from '@nestjs/common';

import { CanonRepository } from './canon.repository';

/**
 * Shared home for `pending_canon` read/write operations. Consumed by both
 * `SynthesisModule` (on adventure assembly) and `SessionModule` (per turn).
 */
@Module({
  providers: [CanonRepository],
  exports: [CanonRepository],
})
export class CanonModule {}
