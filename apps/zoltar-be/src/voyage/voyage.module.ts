import { Module } from '@nestjs/common';

import { VoyageService } from './voyage.service';

@Module({
  providers: [VoyageService],
  exports: [VoyageService],
})
export class VoyageModule {}
