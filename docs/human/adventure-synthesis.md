# Adventure Synthesis

```mermaid
sequenceDiagram
    participant User
    participant Browser
    participant AdvCon as Adventure Controller
    participant SynCon as Synthesis Controller
    participant SynSvc as Synthesis Service
    participant SynRepo as Synthesis Repository
    participant Claude as Claude API

    User->>Browser:Disable oracle entries, submit
    Browser->>Browser:Draw one enabled entry per category
    Browser->>SynCon:POST /synthesize<br/>(selections, enabled entries, addendum)
    Note over SynCon: Preconditions: adventure is "synthesizing",<br/>a character sheet exists, and each selection<br/>is among its category's enabled entries

    SynCon->>SynSvc:Check coherence
    SynSvc->>Claude:Coherence check
    Claude-->>SynSvc:Coherence report

    break Surface, or reroll with no alternative entry
        SynSvc-->>SynCon:Coherence conflict
        SynCon-->>Browser:409 coherence_conflict
    end

    opt Reroll
        Note over SynSvc: Not checked again after the swap
        SynSvc->>SynSvc:Replace one category with a random<br/>entry from its enabled entries
    end

    SynSvc-->>SynCon:Final selections
    SynCon-->>Browser:202 synthesizing

    Note over SynCon,Claude: The rest runs in the background, after the response
    SynCon->>SynSvc:Run synthesis
    SynSvc->>Claude:Synthesis request
    Claude-->>SynSvc:submit_gm_context
    SynSvc-->>SynCon:GM context (schema-checked, not yet saved)
    SynCon->>SynSvc:Save GM context
    SynSvc->>SynSvc:Validate, build campaign state,<br/>GM context and grid entities
    SynSvc->>SynRepo:Write GM context atomic
    Note over SynRepo: One transaction: gm_context, campaign_state,<br/>turn-0 snapshot, grid entities, status → "ready"<br/>(a failed write sets status → "failed")

    Note over Browser,AdvCon: Polling starts when the 202 arrives<br/>and runs alongside synthesis
    loop Every 2 seconds, until status is no longer "synthesizing"
        Browser->>AdvCon:GET adventure
        AdvCon-->>Browser:Adventure (status, opening narration)
    end
    Browser-->>User:Opening narration, "Begin adventure"
```

Creating a new adventure can only start once a campaign and a character exist. With those two pieces in place, the player can initiate a new adventure. On the oracle screen, the player can disable any options they don't want to make available to Claude in composing the adventure. Each oracle option includes a descriptive text that the player sees and a more detailed instruction for Claude.

Once the oracle options are submitted, the browser selects one entry from each category from among the options that the player enabled. The browser sends three things to `POST /synthesize`: the drawn selections, the full list of enabled entries (`activeEntryIds`), and an optional free-text addendum from the player. This addendum is used to provide additional instructions to the synthesis prompt during development and playtesting; it will be disabled in production. 

There is an initial coherence check that runs, just to make sure all of the selected options work together without any contradictions. The coherence check has three outcomes:

- **Proceed:** no conflict, carry on.
- **Reroll:** swap one category silently. Claude names the category, and the back-end then picks a random replacement from the entries the player left enabled. The swapped set is *not* checked again.
- **Surface:** the conflict goes back to the player as a 409 with a description. This also happens when a reroll is asked for but no alternative entry exists.

Once the coherence check passes, Claude synthesizes the adventure. Synthesis runs in the background. The endpoint returns 202 as soon as the coherence check passes, and the browser polls the adventure's status every two seconds. 

The synthesis call uses its own prompt (different from the Warden prompt used during play) and tool `submit_gm_context`. Claude's output is saved in one transaction as the adventure's GM context, the starting campaign state, the grid entities, and the turn-0 snapshot, and the adventure's status becomes `ready`. If the write fails, the status becomes `failed`.

The GM context from the synthesis output feeds directly into the GM context for the adventure and includes locations, threats, NPC agendas, flags, and so on. It also includes the opening narration, which is presented to the player before they take their first turn. It gives the player something to respond to for their first turn rather than just dumping them into the adventure without any kind of introduction.  
