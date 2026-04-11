export abstract class RealtimeService {
  abstract publish(
    channel: string,
    event: string,
    payload: unknown,
  ): Promise<void>;
}
