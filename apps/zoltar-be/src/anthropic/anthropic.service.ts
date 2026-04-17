import Anthropic from '@anthropic-ai/sdk';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const DEFAULT_SYNTHESIS_MODEL = 'claude-sonnet-4-6';
export const DEFAULT_SYNTHESIS_MAX_TOKENS = 8192;
export const DEFAULT_SESSION_MAX_TOKENS = 4096;

export interface CallMessagesParams {
  system: string;
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  toolChoice: Anthropic.ToolChoiceAny;
  model?: string;
  maxTokens?: number;
}

export interface CallSessionParams {
  // Array form enables `cache_control` on individual blocks — a string `system`
  // cannot be cached block-by-block.
  systemBlocks: Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  // Session calls force a specific tool (`submit_gm_response`) — use the full
  // `ToolChoice` union so `{ type: 'tool', name }` is accepted.
  toolChoice: Anthropic.ToolChoice;
  model?: string;
  maxTokens?: number;
}

@Injectable()
export class AnthropicService {
  private readonly client: Anthropic;

  constructor(config: ConfigService) {
    this.client = new Anthropic({
      apiKey: config.getOrThrow<string>('ANTHROPIC_API_KEY'),
    });
  }

  async callMessages(params: CallMessagesParams): Promise<Anthropic.Message> {
    return this.client.messages.create({
      model: params.model ?? DEFAULT_SYNTHESIS_MODEL,
      max_tokens: params.maxTokens ?? DEFAULT_SYNTHESIS_MAX_TOKENS,
      system: params.system,
      messages: params.messages,
      tools: params.tools,
      tool_choice: params.toolChoice,
    });
  }

  async callSession(params: CallSessionParams): Promise<Anthropic.Message> {
    return this.client.messages.create({
      model: params.model ?? DEFAULT_SYNTHESIS_MODEL,
      max_tokens: params.maxTokens ?? DEFAULT_SESSION_MAX_TOKENS,
      system: params.systemBlocks,
      messages: params.messages,
      tools: params.tools,
      tool_choice: params.toolChoice,
    });
  }
}
