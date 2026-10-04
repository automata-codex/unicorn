import type { Recovery } from './session.tool-syntax-recovery';

/**
 * One case per shape of tool-syntax leak found in the archive on 2026-10-04
 * (spec 026). These are the record of what `recoverLeakedPayload` does.
 *
 * Each `input` is a real `submit_gm_response` input, shortened for reading:
 * the narration is cut to its last sentence, and long free text (`notes`,
 * world facts, agendas) is cut to its first sentence or two. The markup, the
 * whitespace between tags and every structured value are as the model wrote
 * them. `source` names the archived file, relative to `$ZOLTAR_EVAL_ROOT`.
 *
 * Each `expected` was written by hand from reading the leak, not produced by
 * running the function.
 */
export interface RecoveryCase {
  name: string;
  source: string;
  input: Record<string, unknown>;
  expected: Recovery;
}

export const RECOVERY_CASES: RecoveryCase[] = [
  // -------------------------------------------------------------------------
  // `<parameter name="…">` with a JSON value. Two thirds of all leaks.
  // -------------------------------------------------------------------------
  {
    // The most common leak by far (51 of 133). `stateChanges` was swallowed
    // into the text; `gmUpdates` came after it and arrived intact.
    name: 'stateChanges as parameter JSON; gmUpdates arrived as a real parameter',
    source:
      'eval-runs/claude-sonnet-5__f0753f86__2026-08-23T16-26-10Z/reps/007/turn24-hidden-info-leak/warden-request.json',
    input: {
      playerText:
        "Delta didn't stop for any of this.</playerText>\n" +
        '<parameter name="stateChanges">{"flags":{"cargo_hold_quarantine_active":{"value":true}}}',
      gmUpdates: {
        notes: 'No explicit suppressive fire rule found in index.',
      },
    },
    expected: {
      ok: true,
      payload: {
        playerText: "Delta didn't stop for any of this.",
        stateChanges: {
          flags: { cargo_hold_quarantine_active: { value: true } },
        },
        gmUpdates: {
          notes: 'No explicit suppressive fire rule found in index.',
        },
      },
    },
  },
  {
    // 7 of 133 open with a stray `</parameter>` instead of `</playerText>`.
    name: 'starts with </parameter>; stateChanges JSON with pools and character state',
    source:
      'eval-runs/claude-sonnet-5__ccac7d1c__2026-08-18T11-48-47Z/reps/009/turn24-scene-jump/warden-request.json',
    input: {
      playerText:
        'You are on the floor at the base of the panel, wounded, weapon still in hand, exposed.</parameter>\n' +
        '<parameter name="stateChanges">{"resourcePools":[{"owner":"alvarez","pool":"hp","delta":-10,"damageType":"gunshot","reason":"Gamma shot through armor at secondary panel"},{"owner":"alvarez","pool":"hp","delta":10,"reason":"Health reset to Maximum minus carryover after Wound"},{"owner":"alvarez","pool":"strength","delta":-6,"reason":"Lodged bullet wound row penalty"}],"characterState":[{"op":"bleeding_set","entityId":"alvarez","value":0}]}',
    },
    expected: {
      ok: true,
      payload: {
        playerText:
          'You are on the floor at the base of the panel, wounded, weapon still in hand, exposed.',
        stateChanges: {
          resourcePools: [
            {
              owner: 'alvarez',
              pool: 'hp',
              delta: -10,
              damageType: 'gunshot',
              reason: 'Gamma shot through armor at secondary panel',
            },
            {
              owner: 'alvarez',
              pool: 'hp',
              delta: 10,
              reason: 'Health reset to Maximum minus carryover after Wound',
            },
            {
              owner: 'alvarez',
              pool: 'strength',
              delta: -6,
              reason: 'Lodged bullet wound row penalty',
            },
          ],
          characterState: [
            { op: 'bleeding_set', entityId: 'alvarez', value: 0 },
          ],
        },
      },
    },
  },
  {
    name: 'gmUpdates as parameter JSON, nothing closed',
    source:
      'eval-runs/claude-sonnet-5__0bdd1306__2026-08-09T14-37-36Z/reps/001/turn02-missing-canon-capture/warden-request.json',
    input: {
      playerText:
        "That's something you'll have to go find out about yourself.</playerText>\n" +
        '<parameter name="gmUpdates">{"notes": "Player asked an out-of-fiction question about map access; answered narratively via suit schematic."}',
    },
    expected: {
      ok: true,
      payload: {
        playerText:
          "That's something you'll have to go find out about yourself.",
        gmUpdates: {
          notes:
            'Player asked an out-of-fiction question about map access; answered narratively via suit schematic.',
        },
      },
    },
  },
  {
    name: 'gmUpdates as parameter JSON, closed, then </invoke>',
    source:
      'eval-runs/claude-sonnet-5__f0753f86__2026-08-23T14-39-39Z/reps/003/turn28-hidden-info-leak/warden-request.json',
    input: {
      playerText:
        "It's a real option. It's not a safe one.</playerText>\n" +
        '<parameter name="gmUpdates">{"notes":"Player asked an in-fiction tactical question rather than declaring an action. No state changes this turn."}</parameter>\n' +
        '</invoke>\n',
    },
    expected: {
      ok: true,
      payload: {
        playerText: "It's a real option. It's not a safe one.",
        gmUpdates: {
          notes:
            'Player asked an in-fiction tactical question rather than declaring an action. No state changes this turn.',
        },
      },
    },
  },
  {
    name: 'two parameters in the text: stateChanges closed, gmUpdates not',
    source:
      'eval-runs/claude-sonnet-5__f0753f86__2026-08-23T16-26-10Z/reps/007/turn24-hidden-info-leak/warden-request.json',
    input: {
      playerText:
        "Delta didn't stop for any of this.</playerText>\n" +
        '<parameter name="stateChanges">{"flags":{"cargo_hold_quarantine_active":{"value":true}}}</parameter>\n' +
        '<parameter name="gmUpdates">{"notes":"Quarantine seal completed via 3-step panel sequence as scripted."}',
    },
    expected: {
      ok: true,
      payload: {
        playerText: "Delta didn't stop for any of this.",
        stateChanges: {
          flags: { cargo_hold_quarantine_active: { value: true } },
        },
        gmUpdates: {
          notes:
            'Quarantine seal completed via 3-step panel sequence as scripted.',
        },
      },
    },
  },
  {
    // An array is recoverable when it is written as JSON.
    name: 'diceRequests as parameter JSON; gmUpdates arrived as a real parameter',
    source:
      'eval-runs/claude-sonnet-5__c45a142a__2026-08-10T19-45-15Z/reps/009/turn19-system-rolled-player-action/warden-request.json',
    input: {
      playerText:
        'Doubles are a Critical.</playerText>\n' +
        '<parameter name="diceRequests">[{"notation": "1d100", "purpose": "Alvarez\'s Combat Check firing on Veridian Contractor Alpha from cover", "target": 30}]',
      gmUpdates: {
        notes: 'Contractor Alpha spotted Alvarez at equipment bay door.',
      },
    },
    expected: {
      ok: true,
      payload: {
        playerText: 'Doubles are a Critical.',
        diceRequests: [
          {
            notation: '1d100',
            purpose:
              "Alvarez's Combat Check firing on Veridian Contractor Alpha from cover",
            target: 30,
          },
        ],
        gmUpdates: {
          notes: 'Contractor Alpha spotted Alvarez at equipment bay door.',
        },
      },
    },
  },
  {
    // 10 of 133. A parameter tag nested inside a parameter tag, holding
    // plain text, with neither closed.
    name: 'gmUpdates parameter holding a notes parameter as text, nothing closed',
    source:
      'eval-runs/claude-sonnet-5__97feadbd__2026-07-29T15-40-17Z/reps/009/turn02-missing-canon-capture/warden-request.json',
    input: {
      playerText:
        "You'll have to move to know more.</playerText>\n" +
        '<parameter name="gmUpdates">\n' +
        '<parameter name="notes">Player asked an out-of-fiction question about map access; answered in-fiction via orientation packet. No state change.',
    },
    expected: {
      ok: true,
      payload: {
        playerText: "You'll have to move to know more.",
        gmUpdates: {
          notes:
            'Player asked an out-of-fiction question about map access; answered in-fiction via orientation packet. No state change.',
        },
      },
    },
  },
  {
    name: 'gmUpdates parameter holding a notes parameter, notes closed, then </invoke>',
    source:
      'eval-runs/claude-sonnet-5__e83e8aaa__2026-08-28T13-00-14Z/reps/009/2c0ba938-turn21-unreversed-retcon/warden-request.json',
    input: {
      playerText:
        '"You want to read this together, right now — or figure out first if anyone\'s coming?"</playerText>\n' +
        '<parameter name="gmUpdates">\n' +
        '<parameter name="notes">Correcting prior turn\'s error: roll of 48 is a SUCCESS, not a failure.</parameter>\n' +
        '</invoke>\n',
    },
    expected: {
      ok: true,
      payload: {
        playerText:
          '"You want to read this together, right now — or figure out first if anyone\'s coming?"',
        gmUpdates: {
          notes:
            "Correcting prior turn's error: roll of 48 is a SUCCESS, not a failure.",
        },
      },
    },
  },

  // -------------------------------------------------------------------------
  // Bare tags named after the field. About a quarter of all leaks.
  // -------------------------------------------------------------------------
  {
    name: 'gmUpdates and notes as tags, then </submit_gm_response>',
    source:
      'eval-runs/claude-sonnet-5__c45a142a__2026-08-10T19-45-15Z/reps/009/turn16-narrating-past-a-block/warden-request.json',
    input: {
      playerText:
        "The secondary panel into the hub is maybe six metres from where you're standing, through that connecting door.</playerText>" +
        '<gmUpdates><notes>Player instinct roll (62) treated as favorable outcome for staying still/quiet. No combat triggered.</notes></gmUpdates></submit_gm_response>\n\n',
    },
    expected: {
      ok: true,
      payload: {
        playerText:
          "The secondary panel into the hub is maybe six metres from where you're standing, through that connecting door.",
        gmUpdates: {
          notes:
            'Player instinct roll (62) treated as favorable outcome for staying still/quiet. No combat triggered.',
        },
      },
    },
  },
  {
    name: 'gmUpdates and notes as tags on separate lines, then </invoke>',
    source:
      'eval-runs/claude-sonnet-5__0bdd1306__2026-08-09T14-37-36Z/reps/005/turn02-missing-canon-capture/warden-request.json',
    input: {
      playerText:
        "It's a floor plan, not a promise of what you'll find on it.</playerText>\n" +
        '<gmUpdates>\n' +
        '<notes>Player asked an OOC/character knowledge question about station layout. No new mechanical state changed.</notes>\n' +
        '</gmUpdates>\n' +
        '</invoke>\n',
    },
    expected: {
      ok: true,
      payload: {
        playerText:
          "It's a floor plan, not a promise of what you'll find on it.",
        gmUpdates: {
          notes:
            'Player asked an OOC/character knowledge question about station layout. No new mechanical state changed.',
        },
      },
    },
  },
  {
    name: 'stateChanges and gmUpdates as tags, each holding JSON, both closed',
    source:
      'eval-runs/claude-sonnet-5__f0753f86__2026-08-23T14-39-39Z/reps/004/5c34991b-turn10-roll-result-inversion/warden-request.json',
    input: {
      playerText:
        "The pulsing sound rises half a step in pitch, almost like it's responding to your presence.</playerText>\n" +
        '<stateChanges>{"worldFacts":{"lower_deck_status":"Corridor bulkhead buckled near the cargo bay. Torres and Whitfield not visible."}}</stateChanges>\n' +
        '<gmUpdates>{"notes":"Player is descending toward the signal source with intent to make contact."}</gmUpdates>\n' +
        '</invoke>\n',
    },
    expected: {
      ok: true,
      payload: {
        playerText:
          "The pulsing sound rises half a step in pitch, almost like it's responding to your presence.",
        stateChanges: {
          worldFacts: {
            lower_deck_status:
              'Corridor bulkhead buckled near the cargo bay. Torres and Whitfield not visible.',
          },
        },
        gmUpdates: {
          notes:
            'Player is descending toward the signal source with intent to make contact.',
        },
      },
    },
  },
  {
    name: 'stateChanges tag closed, gmUpdates tag holding JSON and not closed',
    source:
      'eval-runs/claude-sonnet-5__f0753f86__2026-08-23T16-26-10Z/reps/006/5c34991b-turn10-system-rolled-player-action/warden-request.json',
    input: {
      playerText:
        'Closer to something with intent behind it.</playerText>\n' +
        '<stateChanges>{"worldFacts":{"lower_deck_status":"Cargo bay hatch forced outward from inside."}}</stateChanges>\n' +
        '<gmUpdates>{"notes":"No combat trigger yet — reserving combat_encounter_triggered for when they reach the compartment."}',
    },
    expected: {
      ok: true,
      payload: {
        playerText: 'Closer to something with intent behind it.',
        stateChanges: {
          worldFacts: {
            lower_deck_status: 'Cargo bay hatch forced outward from inside.',
          },
        },
        gmUpdates: {
          notes:
            'No combat trigger yet — reserving combat_encounter_triggered for when they reach the compartment.',
        },
      },
    },
  },
  {
    // Tags all the way down: the flag's name is a tag and its value is the
    // text `true`, which has to come back as a boolean.
    name: 'flag written as nested tags with a boolean literal',
    source:
      'eval-runs/claude-sonnet-5__c45a142a__2026-08-10T19-45-15Z/reps/008/turn24-hidden-info-leak/warden-output.json',
    input: {
      playerText:
        "You have two armed contractors eight metres away who are about three seconds from deciding suppressive fire doesn't scare them anymore.</playerText>\n" +
        '<stateChanges><flags><cargo_hold_quarantine_active><value>true</value></cargo_hold_quarantine_active></flags></stateChanges>\n' +
        '<gmUpdates><notes>Ruled without rulebook support: suppressive fire (no explicit mechanic in index).</notes></gmUpdates></submit_gm_response>\n\n',
    },
    expected: {
      ok: true,
      payload: {
        playerText:
          "You have two armed contractors eight metres away who are about three seconds from deciding suppressive fire doesn't scare them anymore.",
        stateChanges: {
          flags: { cargo_hold_quarantine_active: { value: true } },
        },
        gmUpdates: {
          notes:
            'Ruled without rulebook support: suppressive fire (no explicit mechanic in index).',
        },
      },
    },
  },
  {
    name: 'flag and scenario counter as nested tags, with an integer literal',
    source:
      'eval-runs/claude-sonnet-5__c45a142a__2026-08-10T12-18-32Z/reps/002/turn24-hidden-info-leak/warden-request.json',
    input: {
      playerText:
        'Beta is sixty seconds — maybe less — from a clean line on you.</playerText>' +
        '<stateChanges><flags><cargo_hold_quarantine_active><value>true</value></cargo_hold_quarantine_active></flags><scenarioState><contamination_spread_timer><current>3</current></contamination_spread_timer></scenarioState></stateChanges>' +
        '<gmUpdates><notes>Alvarez sealed cargo_hold_quarantine via secondary panel in equipment bay.</notes></gmUpdates></submit_gm_response>\n\n',
    },
    expected: {
      ok: true,
      payload: {
        playerText:
          'Beta is sixty seconds — maybe less — from a clean line on you.',
        stateChanges: {
          flags: { cargo_hold_quarantine_active: { value: true } },
          scenarioState: { contamination_spread_timer: { current: 3 } },
        },
        gmUpdates: {
          notes:
            'Alvarez sealed cargo_hold_quarantine via secondary panel in equipment bay.',
        },
      },
    },
  },
  {
    name: 'stateChanges tag, with JSON one level down inside a flags tag',
    source:
      'eval-runs/claude-sonnet-5__0bdd1306__2026-08-09T14-37-36Z/reps/001/turn24-scene-jump/warden-output.json',
    input: {
      playerText:
        'The equipment bay is yours and the path to the ladder shaft is open.</playerText>\n' +
        '<stateChanges><flags>{"cargo_hold_quarantine_active":{"value":true}}</flags></stateChanges>\n' +
        '<gmUpdates><notes>Cargo hold quarantine sequence completed successfully.</notes></gmUpdates>\n' +
        '</submit_gm_response>\n',
    },
    expected: {
      ok: true,
      payload: {
        playerText:
          'The equipment bay is yours and the path to the ladder shaft is open.',
        stateChanges: {
          flags: { cargo_hold_quarantine_active: { value: true } },
        },
        gmUpdates: {
          notes: 'Cargo hold quarantine sequence completed successfully.',
        },
      },
    },
  },
  {
    name: 'two JSON-holding tags inside stateChanges',
    source:
      'eval-runs/claude-sonnet-5__c45a142a__2026-08-10T19-45-15Z/reps/002/turn24-scene-jump/warden-output.json',
    input: {
      playerText:
        'Hold position and hope Vasques and a maintenance android can survive a professional alone.</playerText>\n' +
        '<stateChanges><scenarioState>{"contamination_spread_timer":{"current":3}}</scenarioState><flags>{"cargo_hold_quarantine_active":{"value":true},"response_team_hostile_confirmed":{"value":true}}</flags></stateChanges>\n' +
        '<gmUpdates><notes>Alvarez sealed cargo hold quarantine (3-step sequence completed correctly).</notes></gmUpdates>\n' +
        '</invoke>\n',
    },
    expected: {
      ok: true,
      payload: {
        playerText:
          'Hold position and hope Vasques and a maintenance android can survive a professional alone.',
        stateChanges: {
          scenarioState: { contamination_spread_timer: { current: 3 } },
          flags: {
            cargo_hold_quarantine_active: { value: true },
            response_team_hostile_confirmed: { value: true },
          },
        },
        gmUpdates: {
          notes:
            'Alvarez sealed cargo hold quarantine (3-step sequence completed correctly).',
        },
      },
    },
  },
  {
    // The entity id and the world-fact key are both tag names here.
    name: 'entity and world fact keyed by tag name, boolean and text values',
    source:
      'eval-runs/claude-sonnet-5__f0753f86__2026-08-23T16-26-10Z/reps/003/5c34991b-turn10-system-rolled-player-action/warden-request.json',
    input: {
      playerText:
        '"That\'s the way. Doctor — please. Let\'s not linger here."</playerText>\n' +
        '<stateChanges><entities><signal_source_entity><revealed>true</revealed></signal_source_entity></entities><worldFacts><lower_deck_state>Cargo bay hatch hangs open, hull breached to vacuum. No sign of Torres or Whitfield.</lower_deck_state></worldFacts></stateChanges>\n' +
        '<gmUpdates><notes>Player pushed toward the signal source with deliberate calm; panic check (d20=16 vs stress 2) succeeded.</notes></gmUpdates>\n' +
        '</invoke>\n',
    },
    expected: {
      ok: true,
      payload: {
        playerText:
          '"That\'s the way. Doctor — please. Let\'s not linger here."',
        stateChanges: {
          entities: { signal_source_entity: { revealed: true } },
          worldFacts: {
            lower_deck_state:
              'Cargo bay hatch hangs open, hull breached to vacuum. No sign of Torres or Whitfield.',
          },
        },
        gmUpdates: {
          notes:
            'Player pushed toward the signal source with deliberate calm; panic check (d20=16 vs stress 2) succeeded.',
        },
      },
    },
  },
  {
    name: 'entity disposition as nested tags, one tag per line',
    source:
      'eval-runs/claude-sonnet-5__e83e8aaa__2026-08-28T13-00-14Z/reps/008/turn24-over-resolution/warden-request.json',
    input: {
      playerText:
        'You have maybe three seconds before Beta or Gamma finds a new angle on you.</playerText>\n' +
        '<stateChanges>\n' +
        '<entities>\n' +
        '<veridian_contractor_beta>\n' +
        '<npcState>Pinned behind EVA locker cover, suppressed, has not fired back yet</npcState>\n' +
        '</veridian_contractor_beta>\n' +
        '</entities>\n' +
        '</stateChanges>\n' +
        '</invoke>\n',
    },
    expected: {
      ok: true,
      payload: {
        playerText:
          'You have maybe three seconds before Beta or Gamma finds a new angle on you.',
        stateChanges: {
          entities: {
            veridian_contractor_beta: {
              npcState:
                'Pinned behind EVA locker cover, suppressed, has not fired back yet',
            },
          },
        },
      },
    },
  },
  {
    // gmUpdates first, then stateChanges. Agenda text keyed by a tag name;
    // flag and entity values are JSON inside a tag named for their key.
    name: 'gmUpdates before stateChanges; agenda as text, flag and entity as JSON under key tags',
    source:
      'eval-runs/claude-sonnet-5__e83e8aaa__2026-08-31T15-19-08Z/reps/020/5c34991b-turn10-system-rolled-player-action/warden-request.json',
    input: {
      playerText:
        'That sound rolling out of the dark past it, patient and getting stranger by the second.</playerText>\n' +
        '<gmUpdates>\n' +
        '<npcAgendas>\n' +
        '<deep_space_cartographer>Has confessed prior history with the signal pattern. Will not descend voluntarily without a strong push.</deep_space_cartographer>\n' +
        '</npcAgendas>\n' +
        '<notes>Cartographer confession already delivered in a prior turn organically; flipping it now since it was not set.</notes>\n' +
        '</gmUpdates>\n' +
        '<stateChanges>\n' +
        '<flags>\n' +
        '<cartographer_confesses>{"value": true}</cartographer_confesses>\n' +
        '</flags>\n' +
        '<entities>\n' +
        '<deep_space_cartographer>{"npcState": "Frozen at the top of the lower-deck ladder, refusing to descend further."}</deep_space_cartographer>\n' +
        '</entities>\n' +
        '</stateChanges>\n' +
        '</submit_gm_response>\n\n',
    },
    expected: {
      ok: true,
      payload: {
        playerText:
          'That sound rolling out of the dark past it, patient and getting stranger by the second.',
        gmUpdates: {
          npcAgendas: {
            deep_space_cartographer:
              'Has confessed prior history with the signal pattern. Will not descend voluntarily without a strong push.',
          },
          notes:
            'Cartographer confession already delivered in a prior turn organically; flipping it now since it was not set.',
        },
        stateChanges: {
          flags: { cartographer_confesses: { value: true } },
          entities: {
            deep_space_cartographer: {
              npcState:
                'Frozen at the top of the lower-deck ladder, refusing to descend further.',
            },
          },
        },
      },
    },
  },
  {
    // An array inside tags is fine when the array itself is JSON.
    name: 'notes as text and proposedCanon as a JSON array, inside a gmUpdates tag',
    source:
      'eval-runs/claude-sonnet-5__c45a142a__2026-08-10T12-18-32Z/reps/009/turn16-narrating-past-a-block/warden-output.json',
    input: {
      playerText:
        'That clock is now yours too.</playerText>\n' +
        '<gmUpdates>\n' +
        '<notes>Established a soft 15-minute clock for contractor movement - track narratively.</notes>\n' +
        '<proposedCanon>[{"summary":"Contractors have a ~15 minute internal schedule before moving up the ladder shaft to Deck 1.","context":"Sets a soft time pressure clock."},{"summary":"Contractor Delta is stationed alone at the environmental hub\'s primary panel.","context":"Immediate tactical situation for the quarantine seal objective."}]</proposedCanon>\n' +
        '</gmUpdates>\n' +
        '</submit_gm_response>\n\n',
    },
    expected: {
      ok: true,
      payload: {
        playerText: 'That clock is now yours too.',
        gmUpdates: {
          notes:
            'Established a soft 15-minute clock for contractor movement - track narratively.',
          proposedCanon: [
            {
              summary:
                'Contractors have a ~15 minute internal schedule before moving up the ladder shaft to Deck 1.',
              context: 'Sets a soft time pressure clock.',
            },
            {
              summary:
                "Contractor Delta is stationed alone at the environmental hub's primary panel.",
              context:
                'Immediate tactical situation for the quarantine seal objective.',
            },
          ],
        },
      },
    },
  },
  {
    name: 'an empty stateChanges tag',
    source:
      'eval-runs/claude-sonnet-5__97feadbd__2026-07-29T15-40-17Z/reps/005/turn02-missing-canon-capture/warden-request.json',
    input: {
      playerText:
        'Nothing on the readout tells you what that clicking sound near the junction is.</playerText>\n' +
        '<stateChanges></stateChanges>\n' +
        '</invoke>\n',
    },
    expected: {
      ok: true,
      payload: {
        playerText:
          'Nothing on the readout tells you what that clicking sound near the junction is.',
        stateChanges: {},
      },
    },
  },
  {
    // Nothing was swallowed. The only defect is the closing tag itself.
    name: 'a closing tag and nothing after it',
    source:
      'eval-runs/claude-sonnet-5__0bdd1306__2026-08-09T21-23-39Z/reps/006/turn02-missing-canon-capture/warden-output.json',
    input: {
      playerText:
        'The map says is the one place all of those routes intersect.</playerText>',
    },
    expected: {
      ok: true,
      payload: {
        playerText:
          'The map says is the one place all of those routes intersect.',
      },
    },
  },
  {
    name: 'two closing tags and nothing else',
    source:
      'eval-runs/claude-sonnet-5__ccac7d1c__2026-08-16T12-38-30Z/reps/008/turn28-hidden-info-leak/warden-request.json',
    input: {
      playerText:
        'Nothing about your charge takes them out of the fight.</playerText>\n</invoke>\n',
    },
    expected: {
      ok: true,
      payload: {
        playerText: 'Nothing about your charge takes them out of the fight.',
      },
    },
  },

  // -------------------------------------------------------------------------
  // Parameter tags inside a field tag.
  // -------------------------------------------------------------------------
  {
    // Not in the archive as written: every archived leak of this shape also
    // carries a wrongly-shaped `resourcePools` (see the refusals below). This
    // is the first of those with that one parameter removed, so the shape has
    // a case that shows it parsing.
    name: 'parameter tags inside a stateChanges tag, tag not closed (resourcePools removed from the real leak)',
    source:
      'eval-runs/claude-sonnet-5__0bdd1306__2026-08-09T21-23-39Z/reps/004/turn24-hidden-info-leak/warden-request.json',
    input: {
      playerText:
        'You have maybe two seconds before Beta or Gamma works up the nerve to lean back out.</playerText>\n' +
        '<stateChanges><parameter name="flags">{"cargo_hold_quarantine_active": {"value": true}}</parameter>\n' +
        '<parameter name="scenarioState">{"contamination_spread_timer": {"current": 3}}</parameter>\n',
      gmUpdates: {
        notes: 'Cargo hold quarantine now active. Air purge not yet initiated.',
      },
    },
    expected: {
      ok: true,
      payload: {
        playerText:
          'You have maybe two seconds before Beta or Gamma works up the nerve to lean back out.',
        stateChanges: {
          flags: { cargo_hold_quarantine_active: { value: true } },
          scenarioState: { contamination_spread_timer: { current: 3 } },
        },
        gmUpdates: {
          notes:
            'Cargo hold quarantine now active. Air purge not yet initiated.',
        },
      },
    },
  },

  // -------------------------------------------------------------------------
  // Refusals. The turn path does what it did before: one retry, then fail.
  // -------------------------------------------------------------------------
  {
    // The real leak the case above was cut down from. `resourcePools` is a
    // map keyed by pool name. That was the schema until 2026-08-15, when it
    // became an array of `{ owner, pool, delta, reason }`; this leak is from
    // 2026-08-09. The model was right at the time. No leak recorded since
    // the change uses the map.
    name: 'REFUSED: resourcePools in the pre-2026-08-15 map shape, in a parameter tag',
    source:
      'eval-runs/claude-sonnet-5__0bdd1306__2026-08-09T21-23-39Z/reps/004/turn24-hidden-info-leak/warden-request.json',
    input: {
      playerText:
        'You have maybe two seconds before Beta or Gamma works up the nerve to lean back out.</playerText>\n' +
        '<stateChanges><parameter name="flags">{"cargo_hold_quarantine_active": {"value": true}}</parameter>\n' +
        '<parameter name="resourcePools">{"alvarez_armor": {"delta": -1}}</parameter>\n' +
        '<parameter name="scenarioState">{"contamination_spread_timer": {"current": 3}}</parameter>\n',
      gmUpdates: {
        notes: 'Cargo hold quarantine now active. Air purge not yet initiated.',
      },
    },
    expected: { ok: false, reason: 'schema_invalid' },
  },
  {
    // The same old shape, from 2026-08-10.
    name: 'REFUSED: resourcePools in the pre-2026-08-15 map shape, in JSON inside a stateChanges tag',
    source:
      'eval-runs/claude-sonnet-5__c45a142a__2026-08-10T12-18-32Z/reps/008/turn19-out-of-order-resolution/warden-output.json',
    input: {
      playerText:
        'The secondary panel — your objective — is still fifteen metres away across open floor.</playerText>\n' +
        '<stateChanges>{"resourcePools":{"lt_alvarez_stress":{"delta":1}},"flags":{"response_team_hostile_confirmed":{"value":true}}}</stateChanges>\n' +
        '<gmUpdates><notes>Alvarez failed Combat check (70 vs 30). Gained 1 stress per failed check rule.</notes></gmUpdates>\n' +
        '</submit_gm_response>\n\n',
    },
    expected: { ok: false, reason: 'schema_invalid' },
  },
  {
    // The old map shape again (2026-08-09), this time as tags. Under today's
    // schema `resourcePools` is an array, and an array written as tags has
    // no single reading.
    name: 'REFUSED: resourcePools written as nested tags',
    source:
      'eval-runs/claude-sonnet-5__0bdd1306__2026-08-09T14-37-36Z/reps/002/turn24-scene-jump/warden-output.json',
    input: {
      playerText:
        'The one that matters more right now is above you.</playerText>' +
        '<stateChanges><flags><cargo_hold_quarantine_active><value>true</value></cargo_hold_quarantine_active></flags><resourcePools><veridian_contractor_alpha_hp><delta>0</delta></veridian_contractor_alpha_hp></resourcePools></stateChanges>' +
        '<gmUpdates><notes>Cargo hold quarantine sealed successfully via correct 3-step sequence.</notes></gmUpdates></submit_gm_response>\n\n',
    },
    expected: { ok: false, reason: 'array_as_tags' },
  },
  {
    name: 'REFUSED: diceRequests written as tags',
    source:
      'eval-runs/claude-sonnet-5__ccac7d1c__2026-08-16T12-38-30Z/reps/010/turn14-unauditable-mapping/warden-output.json',
    input: {
      playerText:
        'Every sound you make on the metal will carry further than it should.</playerText>\n' +
        '<diceRequests><parameter name="notation">1d100',
    },
    expected: { ok: false, reason: 'array_as_tags' },
  },
  {
    name: 'REFUSED: a call to another tool inside the text',
    source:
      'eval-runs/claude-sonnet-5__e83e8aaa__2026-08-28T13-00-14Z/reps/003/2c0ba938-turn21-unreversed-retcon/warden-request.json',
    input: {
      playerText:
        "She doesn't finish the sentence. She doesn't have to.</playerText>\n" +
        '<invoke name="rules_lookup">\n' +
        '<parameter name="query">critical success doubles 00',
    },
    expected: { ok: false, reason: 'other_tool_call' },
  },
  {
    // The model invented a tag carrying the entity id as an attribute.
    name: 'REFUSED: an entity tag with an id attribute',
    source:
      'eval-runs/claude-sonnet-5__0bdd1306__2026-08-09T21-23-39Z/reps/003/turn19-system-rolled-player-action/warden-output.json',
    input: {
      playerText:
        'You are one dead contractor and about ten seconds ahead of the rest of their team.</playerText>' +
        '<stateChanges><entities><entity id="veridian_contractor_alpha"><status>dead</status><visible>true</visible></entity></entities><flags><response_team_hostile_confirmed><value>true</value></response_team_hostile_confirmed></flags></stateChanges>' +
        '<gmUpdates><notes>Alvarez crit-killed contractor Alpha (roll of 03).</notes></gmUpdates></submit_gm_response>\n</invoke>\n',
    },
    expected: { ok: false, reason: 'unexpected_attribute' },
  },
  {
    name: 'REFUSED: values wrapped in a <json> tag',
    source:
      'eval-runs/claude-sonnet-5__c45a142a__2026-08-10T19-45-15Z/reps/007/turn24-over-resolution/warden-request.json',
    input: {
      playerText:
        'You did not buy Deck 1 any time.</playerText>\n' +
        '<stateChanges><json>{"flags":{"cargo_hold_quarantine_active":{"value":true}}}</stateChanges>\n' +
        '<gmUpdates><json>{"notes":"Ruled suppressive fire without direct rulebook mechanic support."}</json></gmUpdates>\n' +
        '</invoke>\n',
    },
    expected: { ok: false, reason: 'unknown_field' },
  },
  {
    // `npcStates` was renamed to `npcAgendas` after this leak was recorded.
    // As a tag it is a field the schema does not have.
    name: 'REFUSED: a tag for a field gmUpdates no longer has (npcStates)',
    source:
      'eval-runs/claude-sonnet-5__0bdd1306__2026-08-09T14-37-36Z/reps/007/turn16-narrating-past-a-block/warden-output.json',
    input: {
      playerText:
        "Whatever's happening in that hub, they haven't moved toward you. Not yet.</playerText>\n" +
        '<gmUpdates><npcStates>{"veridian_contractor_alpha":"Currently staging at the environmental control hub on Deck 0."}</npcStates>\n' +
        '<notes>Player passed a reactive stealth/instinct roll (62) to hold position.</notes>\n' +
        '</gmUpdates>\n' +
        '</invoke>\n',
    },
    expected: { ok: false, reason: 'unknown_field' },
  },
  {
    // `flags` belongs inside `stateChanges`. Here it is a third top-level
    // parameter, after `stateChanges` has already been written.
    name: 'REFUSED: a flags parameter at the top level',
    source:
      'eval-runs/claude-sonnet-5__fa4e6e2f__2026-08-21T11-05-26Z/reps/002/turn24-over-resolution/warden-request.json',
    input: {
      playerText:
        'You have maybe a few seconds before Beta or Gamma works up the nerve to lean back around cover.</playerText>\n' +
        '<parameter name="stateChanges">{"resourcePools":[{"owner":"alvarez","pool":"hp","delta":-1,"reason":"gunshot graze from contractor Gamma, absorbed mostly by vaccsuit armor"}],"flags":{"cargo_hold_quarantine_active":{"value":true}}}</parameter>\n' +
        '<parameter name="gmUpdates">{"notes":"Delta reaching Lab B door should flip android_memory_wipe_imminent per its trigger definition."}</parameter>\n' +
        '<parameter name="flags">{"android_memory_wipe_imminent":{"value":true}}',
    },
    expected: { ok: false, reason: 'unknown_field' },
  },
  // Found by the first `task leaks:corpus` run, 2026-10-04.
  {
    // The model's own JSON has one closing brace too many, so the value ends
    // early and the rest is text that belongs to no field.
    name: 'REFUSED: JSON with a stray closing brace, leaving text after the value',
    source:
      'eval-runs/claude-sonnet-5__c45a142a__2026-08-10T19-45-15Z/reps/006/turn24-over-resolution/warden-output.json',
    input: {
      playerText:
        'What do you do?</playerText>\n' +
        '<parameter name="stateChanges">{"flags":{"cargo_hold_quarantine_active":{"value":true}}},"resourcePools":{"veridian_contractor_alpha_hp":{"delta":0}}',
      gmUpdates: {
        notes: 'Ruled without rulebook support: suppressive fire.',
      },
    },
    expected: { ok: false, reason: 'leftover_text' },
  },
  {
    // Two things are wrong and neither is the leak in `playerText`: the real
    // `gmUpdates` parameter arrived as a string holding markup, and the
    // armor entry has `destroyed: false`. Recovery does not repair either.
    name: 'REFUSED: the leak parses, but a real parameter and a recovered value are both invalid',
    source:
      'eval-runs/claude-sonnet-5__6717347d__2026-08-21T21-14-59Z/reps/007/turn24-scene-jump/warden-request.json',
    input: {
      playerText:
        'You have maybe two seconds before someone shoots at you again.</playerText>\n' +
        '<parameter name="stateChanges">{"flags":{"cargo_hold_quarantine_active":{"value":true}},"characterState":[{"op":"armor_damage","entityId":"alvarez","apDelta":0,"destroyed":false}]}',
      gmUpdates:
        '\n<parameter name="notes">Ruled without rulebook support: suppressive fire has no mechanical bonus in Mothership.',
    },
    expected: { ok: false, reason: 'schema_invalid' },
  },
];
