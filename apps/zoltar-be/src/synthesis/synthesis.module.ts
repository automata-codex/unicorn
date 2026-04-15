import { Module } from '@nestjs/common';

import { AnthropicModule } from '../anthropic/anthropic.module';

import { SynthesisRepository } from './synthesis.repository';
import { SynthesisService } from './synthesis.service';

@Module({
  imports: [AnthropicModule],
  providers: [SynthesisRepository, SynthesisService],
  exports: [SynthesisService],
})
export class SynthesisModule {}
