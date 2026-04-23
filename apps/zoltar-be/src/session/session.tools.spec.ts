import { describe, expect, it } from 'vitest';

import {
  ROLL_DICE_TOOL,
  RULES_LOOKUP_TOOL,
  SESSION_TOOLS,
  SUBMIT_GM_RESPONSE_TOOL,
} from './session.tools';

describe('SESSION_TOOLS', () => {
  it('registers all three M7 tools', () => {
    const names = SESSION_TOOLS.map((t) => t.name);
    expect(names).toEqual([
      'submit_gm_response',
      'roll_dice',
      'rules_lookup',
    ]);
  });

  it('carries the three tool objects in the registration array', () => {
    expect(SESSION_TOOLS).toContain(SUBMIT_GM_RESPONSE_TOOL);
    expect(SESSION_TOOLS).toContain(ROLL_DICE_TOOL);
    expect(SESSION_TOOLS).toContain(RULES_LOOKUP_TOOL);
  });
});

describe('ROLL_DICE_TOOL', () => {
  it('has an input_schema requiring notation and purpose', () => {
    const schema = ROLL_DICE_TOOL.input_schema as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    expect(schema.properties).toHaveProperty('notation');
    expect(schema.properties).toHaveProperty('purpose');
    expect(schema.required).toEqual(expect.arrayContaining(['notation', 'purpose']));
  });
});

describe('RULES_LOOKUP_TOOL', () => {
  it('has an input_schema exposing query and limit', () => {
    const schema = RULES_LOOKUP_TOOL.input_schema as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    expect(schema.properties).toHaveProperty('query');
    expect(schema.properties).toHaveProperty('limit');
    expect(schema.required).toEqual(expect.arrayContaining(['query']));
  });
});
