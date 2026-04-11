import { Injectable, Logger } from '@nestjs/common';
import { MeteringService } from '../interfaces/metering.service';

@Injectable()
export class NoopMeteringService extends MeteringService {
  private readonly logger = new Logger(NoopMeteringService.name);
  private warned = false;

  async recordTokenUsage(
    _adventureId: string,
    _promptTokens: number,
    _completionTokens: number,
  ): Promise<void> {
    if (!this.warned) {
      this.logger.debug(
        'NoopMeteringService active — token usage events will be discarded.',
      );
      this.warned = true;
    }
  }
}
