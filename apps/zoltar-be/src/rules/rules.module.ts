import { Module } from '@nestjs/common';

import { VoyageModule } from '../voyage/voyage.module';

import { RulesLookupService } from './rules-lookup.service';
import { RulesRepository } from './rules.repository';

@Module({
  imports: [VoyageModule],
  providers: [RulesRepository, RulesLookupService],
  exports: [RulesLookupService],
})
export class RulesModule {}
