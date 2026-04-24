import { Module } from '@nestjs/common';

import { VoyageModule } from '../voyage/voyage.module';

import { RulesRepository } from './rules.repository';
import { RulesLookupService } from './rules-lookup.service';

@Module({
  imports: [VoyageModule],
  providers: [RulesRepository, RulesLookupService],
  exports: [RulesLookupService],
})
export class RulesModule {}
