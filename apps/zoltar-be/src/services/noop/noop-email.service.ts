import { Injectable, Logger } from '@nestjs/common';
import { EmailService } from '../interfaces/email.service';

@Injectable()
export class NoopEmailService extends EmailService {
  private readonly logger = new Logger(NoopEmailService.name);
  private warned = false;

  async sendTransactional(
    _to: string,
    _subject: string,
    _body: string,
  ): Promise<void> {
    if (!this.warned) {
      this.logger.debug(
        'NoopEmailService active — transactional emails will not be delivered.',
      );
      this.warned = true;
    }
  }
}
