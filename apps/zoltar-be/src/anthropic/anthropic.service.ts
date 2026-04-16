import Anthropic from '@anthropic-ai/sdk';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const DEFAULT_SYNTHESIS_MODEL = 'claude-sonnet-4-6';
export const DEFAULT_SYNTHESIS_MAX_TOKENS = 8192;

export interface CallMessagesParams {
  system: string;
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  toolChoice: Anthropic.ToolChoiceAny;
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
}
