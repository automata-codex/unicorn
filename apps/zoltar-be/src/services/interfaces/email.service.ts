export abstract class EmailService {
  abstract sendTransactional(
    to: string,
    subject: string,
    body: string,
  ): Promise<void>;
}
