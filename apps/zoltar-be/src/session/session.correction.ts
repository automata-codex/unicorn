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

  // `resourcePools` and `characterState` abort as a unit (M7.6 D4): one bad
  // entry means none of either array was applied. Saying so matters, because
  // the paths above name single entries and the natural reading of "entry 1
  // was rejected" is that entry 0 landed. It did not, and a correction that
  // resends only the failing entry would silently drop the rest.
  const arrayAbort = args.rejections.some((r) =>
    /^(resourcePools|characterState)\[/.test(r.path),
  )
    ? '\n\nNote: resourcePools and characterState are applied all-or-nothing. ' +
      'None of the changes in either array were applied, and the state you ' +
      'reasoned from is unchanged. Resend every change the turn needs, not ' +
      'just the one named above.'
    : '';

  const toolResultBlock: Anthropic.ToolResultBlockParam = {
    type: 'tool_result',
    tool_use_id: toolUseBlock.id,
    is_error: true,
    content: [
      {
        type: 'text',
        text:
          `The backend rejected ${args.rejections.length} proposed state change(s):\n\n` +
          `${rejectionText}${arrayAbort}\n\n` +
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
