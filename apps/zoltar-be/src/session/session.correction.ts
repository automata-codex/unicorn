import type Anthropic from '@anthropic-ai/sdk';
import type { CallSessionParams } from '../anthropic/anthropic.service';
import type { ValidationRejection } from './session.validator';

/**
 * Constructs the second-round Claude request that follows a validator
 * rejection. Extends the original messages with (a) the rejected assistant
 * response verbatim and (b) a user turn carrying a single `tool_result`
 * content block that names the rejections and asks for a corrected
 * `submit_gm_response`.
 *
 * `tool_choice` is overridden to force `submit_gm_response` specifically —
 * the M7 default is `{ type: 'any' }` to enable the inner tool loop, but
 * correction re-prompts must not re-enter that loop (rolls are inputs, not
 * retry levers — see docs/decisions.md). The outgoing request here forbids
 * any further `roll_dice` / `rules_lookup` calls on the correction pass.
 *
 * Pure function — no network, no DB.
 */
export function buildCorrectionRequest(args: {
  originalRequest: CallSessionParams;
  originalAssistant: Anthropic.Message;
  rejections: ValidationRejection[];
}): CallSessionParams {
  const toolUseBlock = args.originalAssistant.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === 'tool_use' && block.name === 'submit_gm_response',
  );

  if (!toolUseBlock) {
    throw new Error(
      'Original assistant response has no submit_gm_response tool_use block',
    );
  }

  const rejectionText = args.rejections
    .map((r) => `- ${r.path}: ${r.reason}`)
    .join('\n');

  const toolResultBlock: Anthropic.ToolResultBlockParam = {
    type: 'tool_result',
    tool_use_id: toolUseBlock.id,
    is_error: true,
    content: [
      {
        type: 'text',
        text:
          `The backend rejected ${args.rejections.length} proposed state change(s):\n\n` +
          `${rejectionText}\n\n` +
          `Re-narrate this turn. Call submit_gm_response again with corrected stateChanges that the backend will accept. Keep the narration faithful to the fiction — if an action is impossible, describe why in character rather than silently dropping it.`,
      },
    ],
  };

  return {
    ...args.originalRequest,
    messages: [
      ...args.originalRequest.messages,
      { role: 'assistant', content: args.originalAssistant.content },
      { role: 'user', content: [toolResultBlock] },
    ],
    toolChoice: { type: 'tool', name: 'submit_gm_response' },
  };
}
