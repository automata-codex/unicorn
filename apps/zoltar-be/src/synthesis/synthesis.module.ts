import { Module } from '@nestjs/common';

import { AnthropicModule } from '../anthropic/anthropic.module';

import { SynthesisService } from './synthesis.service';

@Module({
  imports: [AnthropicModule],
  providers: [SynthesisService],
  exports: [SynthesisService],
})
export class SynthesisModule {}
