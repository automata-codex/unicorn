import { Injectable, Logger } from '@nestjs/common';
import { RealtimeService } from '../interfaces/realtime.service';

@Injectable()
export class NoopRealtimeService extends RealtimeService {
  private readonly logger = new Logger(NoopRealtimeService.name);
  private warned = false;

  async publish(
    _channel: string,
    _event: string,
    _payload: unknown,
  ): Promise<void> {
    if (!this.warned) {
      this.logger.debug(
        'NoopRealtimeService active — published events will not reach any subscriber.',
      );
      this.warned = true;
    }
  }
}
