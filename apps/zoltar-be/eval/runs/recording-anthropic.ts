import type Anthropic from '@anthropic-ai/sdk';
import type {
  AnthropicService,
  CallMessagesParams,
  CallSessionParams,
} from '../../src/anthropic/anthropic.service';

export interface CapturedWardenCall {
  request: CallSessionParams;
  response: Anthropic.Message;
}

/**
 * Wraps a real `AnthropicService` to force the harness's `--model` /
 * `--temperature` onto every Warden call and record the assembled request
 * plus raw response, in call order, into a per-fixture capture buffer the
 * runner drains after each turn (`beginFixture()` / `takeCaptured()`). One
 * fixture turn makes several `callSession` calls — each inner-tool-loop
 * iteration, plus a correction round if one fires — so the buffer, not a
 * single slot, is what `warden-request.json` is built from.
 *
 * `callMessages` — the judge's path — is passed through untouched. The
 * judge is pinned to `JUDGE_MODEL` by design (a deliberate
 * generator/grader model asymmetry — see `eval/checks/judged/judge.ts`) and
 * must never inherit the Warden's `--model`/`--temperature`. Forgetting
 * this would make `--temperature 0` silently change the grader too —
 * precisely the confound `eval:judge-variance` exists to measure.
 */
export class RecordingAnthropicService {
  private buffer: CapturedWardenCall[] = [];

  constructor(
    private readonly inner: AnthropicService,
    private readonly model: string,
    private readonly temperature: number,
  ) {}

  async callMessages(params: CallMessagesParams): Promise<Anthropic.Message> {
    return this.inner.callMessages(params);
  }

  async callSession(params: CallSessionParams): Promise<Anthropic.Message> {
    const forced: CallSessionParams = {
      ...params,
      model: this.model,
      temperature: this.temperature,
    };
    const response = await this.inner.callSession(forced);
    this.buffer.push({ request: forced, response });
    return response;
  }

  /** Starts a new capture buffer for one fixture's turn — call before
   * driving the turn through `SessionService`. */
  beginFixture(): void {
    this.buffer = [];
  }

  /** Drains and returns everything captured since the last `beginFixture()`
   * call, in call order. */
  takeCaptured(): CapturedWardenCall[] {
    const captured = this.buffer;
    this.buffer = [];
    return captured;
  }
}
