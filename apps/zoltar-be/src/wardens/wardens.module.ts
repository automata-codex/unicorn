import { Module } from '@nestjs/common';

import { WardenPromptsService } from './warden-prompts.service';

/**
 * Houses flat-file Warden role prompts per game system. Discovery happens
 * at module init; the selected prompt per system is cached for the process
 * lifetime. Rapid prompt iteration during playtest lands new files in
 * `prompts/` — a process restart picks them up.
 */
@Module({
  providers: [WardenPromptsService],
  exports: [WardenPromptsService],
})
export class WardensModule {}
