import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '@uv/service-interfaces';
import * as nodemailer from 'nodemailer';

@Injectable()
export class SmtpEmailService extends EmailService {
  private readonly logger = new Logger(SmtpEmailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private config: ConfigService) {
    super();
    this.transporter = nodemailer.createTransport({
      host: config.get('SMTP_HOST'),
      port: config.get<number>('SMTP_PORT'),
      secure: false,
    });
  }

  async sendTransactional(to: string, subject: string, body: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.get('AUTH_EMAIL_FROM'),
      to,
      subject,
      html: body,
    });
    this.logger.debug(`Email sent to ${to}: ${subject}`);
  }
}
