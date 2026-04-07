export const PLAY_TOOLS = [
	{
		name: 'submit_gm_response',
		description:
			"Submit the Warden's response for this turn. Must be called to complete every turn.",
		input_schema: {
			type: 'object',
			properties: {
				playerText: {
					type: 'string',
					description: 'Narrative text delivered to the player.'
				},
				stateChanges: {
					type: 'object',
					properties: {
						resourcePools: {
							type: 'object',
							additionalProperties: {
								type: 'object',
								properties: { delta: { type: 'integer' } },
								required: ['delta']
							}
						},
						entities: {
							type: 'object',
							description: 'Entity state updates. Use entity IDs as keys.',
							additionalProperties: {
								type: 'object',
								properties: {
									position: {
										type: 'object',
										properties: {
											x: { type: 'integer' },
											y: { type: 'integer' }
										},
										required: ['x', 'y']
									},
									visible: { type: 'boolean' },
									status: {
										type: 'string',
										enum: ['alive', 'dead', 'unknown'],
										description:
											"Entity liveness. Set to 'dead' when an entity is killed — this also zeros all resource pools prefixed with the entity's ID."
									}
								}
							}
						},
						flags: {
							type: 'object',
							additionalProperties: { type: 'boolean' }
						},
						flagTriggers: {
							type: 'object',
							description:
								'Trigger descriptions for new flags. Required when introducing a new flag — describes the specific in-fiction event that flips it.',
							additionalProperties: { type: 'string' }
						}
					}
				},
				gmUpdates: {
					type: 'object',
					properties: {
						npcStates: {
							type: 'object',
							additionalProperties: { type: 'string' }
						},
						notes: { type: 'string' },
						proposedCanon: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									summary: { type: 'string' },
									context: { type: 'string' }
								},
								required: ['summary', 'context']
							}
						}
					}
				},
				diceRequests: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							notation: { type: 'string' },
							purpose: { type: 'string' },
							target: { type: ['integer', 'null'] }
						},
						required: ['notation', 'purpose']
					}
				}
			},
			required: ['playerText']
		}
	},
	{
		name: 'roll_dice',
		description:
			'Execute a dice roll server-side. Use for system-generated rolls — NPC actions, GM saves, random resolutions. For player-facing rolls, use diceRequests in submit_gm_response.',
		input_schema: {
			type: 'object',
			properties: {
				notation: {
					type: 'string',
					description: 'Standard dice notation: 1d100, 2d6+3, etc.'
				},
				purpose: {
					type: 'string',
					description: 'Why this roll is being made. Not shown to the player.'
				}
			},
			required: ['notation', 'purpose']
		}
	}
] as const;

export const SYNTHESIS_TOOLS = [
	{
		name: 'submit_gm_context',
		description:
			'Commit the synthesized GM context to the adventure. Call this once when synthesis is complete.',
		input_schema: {
			type: 'object',
			properties: {
				narrative: {
					type: 'object',
					properties: {
						location: { type: 'string' },
						atmosphere: { type: 'string' },
						npcAgendas: { type: 'object', additionalProperties: { type: 'string' } },
						hiddenTruth: { type: 'string' },
						oracleConnections: { type: 'string' }
					},
					required: [
						'location',
						'atmosphere',
						'npcAgendas',
						'hiddenTruth',
						'oracleConnections'
					]
				},
				structured: {
					type: 'object',
					properties: {
						entities: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									id: { type: 'string' },
									type: { type: 'string', enum: ['npc', 'threat', 'feature'] },
									startingPosition: {
										type: 'object',
										properties: {
											x: { type: 'integer' },
											y: { type: 'integer' }
										},
										required: ['x', 'y']
									},
									visible: { type: 'boolean' },
									tags: { type: 'array', items: { type: 'string' } }
								},
								required: ['id', 'type', 'visible', 'tags']
							}
						},
						initialFlags: {
							type: 'object',
							additionalProperties: { type: 'boolean' }
						},
						initialState: { type: 'object' }
					},
					required: ['entities', 'initialFlags', 'initialState']
				}
			},
			required: ['narrative', 'structured']
		}
	}
] as const;
