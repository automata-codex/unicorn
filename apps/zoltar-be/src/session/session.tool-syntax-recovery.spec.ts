import { describe, expect, it } from 'vitest';

import { recoverLeakedPayload } from './session.tool-syntax-recovery';
import { RECOVERY_CASES } from './session.tool-syntax-recovery.cases';

// One test per shape of leak found in the archive. The cases file holds the
// payloads and the expected results, written by hand.
describe('recoverLeakedPayload — archived leak shapes', () => {
  it.each(RECOVERY_CASES)('$name', ({ input, expected }) => {
    expect(recoverLeakedPayload(input)).toEqual(expected);
  });
});

// Refusals and edge cases that no archived leak produces.
describe('recoverLeakedPayload — hand-written cases', () => {
  const leak = (tail: string, rest: Record<string, unknown> = {}) => ({
    playerText: `The door opens.</playerText>\n${tail}`,
    ...rest,
  });

  it('refuses a payload with no leak in it', () => {
    expect(recoverLeakedPayload({ playerText: 'The door opens.' })).toEqual({
      ok: false,
      reason: 'no_leak',
    });
    expect(recoverLeakedPayload('not an object')).toEqual({
      ok: false,
      reason: 'no_leak',
    });
    expect(recoverLeakedPayload({ playerText: 7 })).toEqual({
      ok: false,
      reason: 'no_leak',
    });
  });

  it('refuses when a recovered field also arrived as a real parameter', () => {
    const input = leak(
      '<parameter name="gmUpdates">{"notes":"from the text"}',
      {
        gmUpdates: { notes: 'the real one' },
      },
    );
    expect(recoverLeakedPayload(input)).toEqual({
      ok: false,
      reason: 'collision',
    });
  });

  it('refuses when the text names the same field twice', () => {
    const input = leak(
      '<gmUpdates><notes>one</notes></gmUpdates><gmUpdates><notes>two</notes></gmUpdates>',
    );
    expect(recoverLeakedPayload(input)).toEqual({
      ok: false,
      reason: 'collision',
    });
  });

  it('refuses text that sits between fields, rather than leaving it anywhere', () => {
    const input = leak(
      '<gmUpdates><notes>private</notes></gmUpdates> and one more thing',
    );
    expect(recoverLeakedPayload(input)).toEqual({
      ok: false,
      reason: 'leftover_text',
    });
  });

  it('refuses a closing tag that closes nothing', () => {
    const input = leak('<gmUpdates><notes>private</notes></gmUpdates></notes>');
    expect(recoverLeakedPayload(input)).toEqual({
      ok: false,
      reason: 'leftover_text',
    });
  });

  it('refuses an unclosed text value that would swallow the next field', () => {
    // `notes` is never closed, so its text would run on through the
    // stateChanges that follows.
    const input = leak(
      '<parameter name="gmUpdates"><parameter name="notes">private\n' +
        '<parameter name="stateChanges">{"flags":{"a":{"value":true}}}</parameter>',
    );
    expect(recoverLeakedPayload(input)).toEqual({
      ok: false,
      reason: 'leftover_text',
    });
  });

  it('refuses JSON that is cut off', () => {
    const input = leak(
      '<parameter name="stateChanges">{"flags":{"a":{"value":tr',
    );
    expect(recoverLeakedPayload(input)).toEqual({
      ok: false,
      reason: 'bad_value',
    });
  });

  it('refuses a literal of the wrong type', () => {
    const input = leak(
      '<stateChanges><flags><a><value>probably</value></a></flags></stateChanges>',
    );
    expect(recoverLeakedPayload(input)).toEqual({
      ok: false,
      reason: 'bad_value',
    });
  });

  it('reads adventureMode as text, and as null', () => {
    expect(
      recoverLeakedPayload(leak('<parameter name="adventureMode">initiative')),
    ).toEqual({
      ok: true,
      payload: { playerText: 'The door opens.', adventureMode: 'initiative' },
    });
    expect(
      recoverLeakedPayload(leak('<adventureMode>null</adventureMode>')),
    ).toEqual({
      ok: true,
      payload: { playerText: 'The door opens.', adventureMode: null },
    });
  });

  it('keeps a "<" that is not a tag as part of a text value', () => {
    const input = leak(
      '<gmUpdates><notes>Rolled 38 < 40, a success. Sign reads <MANUAL OVERRIDE>.</notes></gmUpdates>',
    );
    expect(recoverLeakedPayload(input)).toEqual({
      ok: true,
      payload: {
        playerText: 'The door opens.',
        gmUpdates: {
          notes: 'Rolled 38 < 40, a success. Sign reads <MANUAL OVERRIDE>.',
        },
      },
    });
  });

  it('handles braces and quotes inside a JSON string', () => {
    const input = leak(
      '<parameter name="gmUpdates">{"notes":"She said \\"wait}\\" and left ]"}</parameter>',
    );
    expect(recoverLeakedPayload(input)).toEqual({
      ok: true,
      payload: {
        playerText: 'The door opens.',
        gmUpdates: { notes: 'She said "wait}" and left ]' },
      },
    });
  });

  it('does not modify its input', () => {
    const input = leak('<parameter name="gmUpdates">{"notes":"n"}');
    const before = JSON.stringify(input);
    recoverLeakedPayload(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
