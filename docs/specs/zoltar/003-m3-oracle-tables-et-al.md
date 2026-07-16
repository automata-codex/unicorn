# Milestone M3 — Oracle Tables, Character Creation & Frontend Theming
## Implementation Spec for Claude Code

**Spec status:** Claude Code handoff
**Depends on:** M2.5 complete (token files in place, base components implemented, DevComponents preview page rendering correctly against Mothership theme)

**Reference:** Read `docs/design-system.md` in full before writing any frontend code. It is the authoritative spec for tokens, conventions, and component behavior. This spec covers structure, layout, and behavior; `docs/design-system.md` covers all visual decisions. Do not use hardcoded hex values. Do not reference primitive tokens in components.

---

## Done When

1. Oracle table JSON files exist and load correctly.
2. All existing pages (SignIn, CampaignList, CampaignDetail, App nav) are fully themed against the Mothership design system.
3. The 768px breakpoint is applied throughout — all pages expand their layout at `min-width: 768px`.
4. The character creation form is implemented and functional.
5. The oracle filtering UI is implemented and functional.
6. `tsc --noEmit` passes with no type errors (frontend).

---

## Part 1: Oracle Table Data Files

Oracle tables live as versioned JSON at `apps/zoltar-fe/src/lib/data/oracle/`. Each file exports a typed array. These are static data — they are bundled with the app, not fetched from the API.

### File structure

```
apps/zoltar-fe/src/lib/data/oracle/
  index.ts                  ← re-exports all tables
  survivors.json
  threats.json
  secrets.json
  vessel-type.json
  tone.json
```

### TypeScript types

```typescript
// src/lib/data/oracle/types.ts
export type OracleEntry = {
  id: string;           // stable slug, e.g. "corporate_spy"
  player_text: string;  // short label shown in the filtering UI
  claude_text: string;  // full narrative seed passed to synthesis — not shown to the player
  interfaces: Array<{
    condition: string;  // e.g. "secret:company_knew" — cross-category linkage hint
    note: string;       // how this entry connects to the referenced entry
  }>;
  tags: string[];       // e.g. ["biological", "body_horror"] — used by synthesis for thematic coherence
};

export type OracleTable = {
  id: string;           // e.g. "mothership_survivor"
  system: string;       // e.g. "mothership"
  category: string;     // e.g. "survivor"
  version: string;      // semver — stored at adventure creation time for audit trail
  entries: OracleEntry[];
};

// Normalised shape consumed by the filtering UI and synthesis path.
// The UI and oracle state module work with this type, not OracleTable directly.
export type OracleCategory = {
  id: string;           // matches OracleTable.category
  label: string;        // uppercase display label, e.g. "SURVIVORS"
  entries: OracleEntry[];
};
```

`claude_text` and `interfaces` are never rendered in the player-facing UI. They are included in the bundled JSON because they are passed verbatim to the synthesis prompt. The filtering UI reads only `player_text`.

### Required categories and entry counts

| File               | Category ID   | Label         | Minimum entries |
|--------------------|---------------|---------------|-----------------|
| `survivors.json`   | `survivors`   | `SURVIVORS`   | 8               |
| `threats.json`     | `threats`     | `THREATS`     | 8               |
| `secrets.json`     | `secrets`     | `SECRETS`     | 8               |
| `vessel-type.json` | `vessel_type` | `VESSEL TYPE` | 6               |
| `tone.json`        | `tone`        | `TONE`        | 6               |

Entries must be consistent with the Mothership sci-fi horror genre. `player_text` is a short phrase the player reads when curating. `claude_text` is a rich archetype description — one to three sentences — that Claude uses as a generation seed at synthesis time. `interfaces` lists cross-category connection hints; each `condition` value names another category entry this one pairs naturally with.

Example entry (survivors):
```json
{
  "id": "corporate_spy",
  "player_text": "Corporate spy",
  "claude_text": "This survivor was placed on the vessel by a corporate entity. They have a specific information objective: recovering, destroying, or concealing something on this ship. They are not a trained operative — a logistics manager, a technician, a mid-level bureaucrat told this would be simple. They are frightened and increasingly aware that it will not be.",
  "interfaces": [
    {
      "condition": "secret:company_knew",
      "note": "This survivor knew before boarding. Their fear is guilt as much as danger."
    },
    {
      "condition": "threat:corporate",
      "note": "They may have a relationship with the threat, intended or not."
    }
  ],
  "tags": ["corporate", "information_objective", "civilian"]
}
```

### `index.ts`

```typescript
import survivorsTable from './survivors.json';
import threatsTable from './threats.json';
import secretsTable from './secrets.json';
import vesselTypeTable from './vessel-type.json';
import toneTable from './tone.json';
import type { OracleCategory } from './types';

// Map the on-disk OracleTable format to the OracleCategory shape consumed by the UI.
// The label field is not in the JSON — it is assigned here so the JSON files
// stay format-compatible with the future DB table schema.
export const builtInOracleCategories: OracleCategory[] = [
  { id: survivorsTable.category,  label: 'SURVIVORS',    entries: survivorsTable.entries },
  { id: threatsTable.category,    label: 'THREATS',      entries: threatsTable.entries },
  { id: secretsTable.category,    label: 'SECRETS',      entries: secretsTable.entries },
  { id: vesselTypeTable.category, label: 'VESSEL TYPE',  entries: vesselTypeTable.entries },
  { id: toneTable.category,       label: 'TONE',         entries: toneTable.entries },
];
```

### Source-agnostic loading

The oracle filtering page and oracle state module must accept `OracleCategory[]` as a parameter — they must not import the JSON bundle directly. In M3, callers pass `builtInOracleCategories`. When user-authored tables are introduced, a `GET /oracle-tables` endpoint will return a merged set of built-in and user tables in the same shape, and no changes to the filtering UI or state module will be required.

```typescript
// Correct — source is injected
export function createOracleFilterState(categories: OracleCategory[]): OracleFilterState { ... }

// Wrong — hardcodes the built-in source
import { builtInOracleCategories } from '$lib/data/oracle';
export function createOracleFilterState(): OracleFilterState {
  for (const cat of builtInOracleCategories) { ... }  // ← do not do this
}
```

`OracleFilter.svelte` receives `categories: OracleCategory[]` as a prop. `App.svelte` (or whatever mounts it) passes `builtInOracleCategories` for now.

---

## Part 2: Oracle Filtering Data Model

The oracle filtering state tracks which entries are active per category. This state is local to the adventure creation flow — it is not persisted to the backend in M3 (that is M4).

```typescript
// src/lib/oracle/state.svelte.ts
export type OracleFilterState = {
  // categoryId → Set of active entry ids
  active: Record<string, Set<string>>;
};

export function createOracleFilterState(): OracleFilterState {
  const active: Record<string, Set<string>> = {};
  for (const cat of oracleCategories) {
    // All entries start active
    active[cat.id] = new Set(cat.entries.map(e => e.id));
  }
  return { active };
}

export function isAllActive(state: OracleFilterState, categoryId: string): boolean { ... }
export function isNoneActive(state: OracleFilterState, categoryId: string): boolean { ... }
export function activeCount(state: OracleFilterState, categoryId: string): number { ... }
export function toggleEntry(state: OracleFilterState, categoryId: string, entryId: string): void { ... }
export function selectAll(state: OracleFilterState, categoryId: string): void { ... }
export function deselectAll(state: OracleFilterState, categoryId: string): void { ... }
```

The "begin" gate: submission is only allowed when every category has ≥1 active entry. This is enforced in the UI and should be a derived boolean.

---

## Part 3: Breakpoint Convention

All layouts are mobile-first. The single breakpoint for M3 is `768px`.

```css
/* Mobile-first base styles */
.page-content {
  padding: var(--space-7);
}

/* Wider viewport expansion */
@media (min-width: 768px) {
  .page-content {
    max-width: 680px;
    margin: 0 auto;
    padding: var(--space-10) var(--space-7);
  }
}
```

Apply this pattern consistently across all pages and new UI. The 768px breakpoint is the only responsive breakpoint introduced in M3. Do not introduce additional breakpoints.

Add a shared layout wrapper to avoid duplicating this pattern in every page. A `PageLayout.svelte` component is the right place for it:

```typescript
// src/lib/components/PageLayout.svelte
// Props: none. Slot: default.
// Wraps content in the centered column at ≥768px.
```

```svelte
<div class="page-layout">
  <slot />
</div>

<style>
  .page-layout {
    min-height: 100vh;
    background: var(--color-bg);
    padding: var(--space-7);
  }

  @media (min-width: 768px) {
    .page-layout {
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .page-layout :global(> *) {
      width: 100%;
      max-width: 680px;
    }
  }
</style>
```

---

## Part 4: Theme Existing Pages

M2 pages (`SignIn`, `CampaignList`, `CampaignDetail`) and `App.svelte` were scaffolded functionally but without Mothership theme styling. This part fully themes them using the design system tokens and base components from M2.5.

**Constraint:** No layout or data-fetching logic changes. Only visual styling. If a refactor is needed to apply the theme correctly (e.g. replacing a raw `<button>` with `<Button>`), make the minimum change required — do not restructure component logic.

### 4.1 `App.svelte` — Global Nav

Replace the unstyled `<nav>` with a styled nav bar.

**Mobile layout:** Full-width bar. Left: wordmark `ZOLTAR` in `type-screen-title`. Right: session email in `type-meta` + ghost `<Button>` for sign out.

**≥768px:** Nav constrains to `680px` centered, matching `PageLayout`.

Tokens:
- Nav background: `--color-surface`
- Bottom border: `1px solid var(--color-border-subtle)`
- Padding: `var(--space-4) var(--space-7)`
- Wordmark: `--font-primary`, `--font-size-xl`, `--color-accent`, `--tracking-widest`, uppercase
- Email: `--color-text-ghost`, `--font-size-xs`

The session-loading state (`<p>Loading...</p>`) must be replaced with a minimal full-screen centered layout using `--color-bg` background and a `--color-text-ghost` loading indicator.

### 4.2 `SignIn.svelte`

**Layout:** Vertically and horizontally centered on the page. Single `<Card>` containing the form.

**Mobile:** Card fills most of the screen width with `var(--space-7)` horizontal padding on the outer container.

**≥768px:** Card has a fixed max-width of `400px`, centered.

**Content:**
- Wordmark `ZOLTAR` above the card: `type-screen-label`, `--color-accent`, `--tracking-widest`
- Screen title inside card: `CREW ACCESS` in `type-screen-label`
- `<Input>` with `label="EMAIL"`, `type="text"`, `placeholder="user@domain"`
- `<Button fullWidth>` with label `REQUEST ACCESS`
- On submission (link sent state): replace form with a `type-meta` message — `LINK TRANSMITTED — CHECK YOUR INBOX`
- Local dev note below: `MAILHOG → LOCALHOST:8025` in `type-meta`, `--color-text-ghost`

### 4.3 `CampaignList.svelte`

**Layout:** `<PageLayout>` wrapper. Screen label `CAMPAIGNS` at top.

**Campaign cards:** Each campaign renders as a `<Card>` containing:
- Campaign name: `type-campaign-name`
- A `--color-text-ghost` meta line with adventure count or last-active text (if available from API response, otherwise omit)
- The card is a clickable affordance — entire card navigates to `/campaigns/:id`. Use `cursor: pointer`, `--color-border` default border, `--color-accent-border` on hover.

**Mobile:** Cards are full-width, stacked vertically with `var(--space-4)` gap.

**≥768px:** Two-column card grid.

```css
@media (min-width: 768px) {
  .campaign-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-5);
  }
}
```

**New campaign form:** Inline below the grid, collapsible. Collapsed state shows a ghost `<Button>` labeled `+ NEW CAMPAIGN`. Expanded state shows:
- `<Input label="NAME">` for the campaign name
- `<Button>` for submit, `<Button variant="ghost">` for cancel
- No modal or overlay. Inline expansion only.

**Empty state:** When no campaigns exist, show a centered `type-meta` message `NO CAMPAIGNS — CREATE ONE BELOW` above the new campaign button.

### 4.4 `CampaignDetail.svelte`

**Layout:** `<PageLayout>` wrapper.

**Header:**
- Back link: `← CAMPAIGNS` as a ghost `<Button>` (calls `navigate('/campaigns')`)
- Campaign name: `type-campaign-name`

**Character section:**

`<Card>` with `<SectionLabel>CHARACTER</SectionLabel>` header.

If no character exists:
- Instruction text in `type-meta`: `NO CREW ASSIGNED`
- `<Button>` labeled `CREATE CHARACTER` — navigates to character creation (M3 new page, see Part 6)

If a character exists:
- Character name: `type-screen-title`
- Class and background: `type-label`, dim
- A row of stat values using `type-stat-value` for numbers and `type-label` for their labels

**Adventures section:**

`<Card>` with `<SectionLabel>ADVENTURES</SectionLabel>` header.

New adventure button: `<Button fullWidth>NEW ADVENTURE</Button>`. Disabled (with explanation) when:
- No character exists → tooltip/caption: `ASSIGN CREW FIRST`
- An adventure is in `synthesizing`, `ready`, or `in_progress` state → `ADVENTURE IN PROGRESS`

Adventure list: Each adventure is a row inside the card:
- Adventure status badge using `--color-success` / `--color-danger` / `--color-text-ghost` as appropriate for status
- `createdAt` date in `type-meta`
- Status text: `SYNTHESIZING`, `READY`, `IN PROGRESS`, `COMPLETED`, `FAILED`

Completed adventures are hidden by default. A ghost button `SHOW COMPLETED (n)` appears below the list when completed adventures exist. Clicking it reveals them and changes the label to `HIDE COMPLETED`.

---

## Part 5: Oracle Filtering UI

### Route

`/oracle-filter` — accessible from the new adventure flow in `CampaignDetail`. In M3 this page does not submit to the backend — it is a standalone UI that logs selections to the console and shows a confirmation state. Wiring to the backend is M4.

### Page: `OracleFilter.svelte`

**Layout:** `<PageLayout>`. Screen label `ORACLE FILTER` at top. Instruction text: `CONFIGURE ORACLE POOL — ONE ENTRY WILL BE DRAWN PER CATEGORY`.

**Per category:** A collapsible `<Card>` component.

Card header (always visible):
- `<SectionLabel>` with category label (e.g. `SURVIVORS`)
- Count indicator `x/y` — `x` is active count, `y` is total. Color: `--color-success` when x ≥ 1, `--color-danger` when x = 0.
- Select All / Deselect All ghost buttons (small, `--font-size-xs`)
- Chevron icon (`▸` / `▾`) indicating collapsed/expanded state. Rotates 180° when expanded.

Card body (visible when expanded):
- Entry list with `max-height` set to show approximately 3 entries, `overflow-y: scroll`, `overscroll-behavior: contain`.
- Each entry: a toggle row. Left: entry `player_text` in `type-body`. Right: a toggle affordance (checkbox or styled toggle button). Active entries: `--color-text-primary`. Inactive: `--color-text-ghost`, slight dimming.

**Submit gate:**
- A `<Button fullWidth>` labeled `BEGIN` at the bottom of the page.
- Disabled with `--btn-disabled-*` tokens and caption `ALL CATEGORIES MUST HAVE ≥1 ACTIVE ENTRY` when any category has 0 active entries.
- Enabled when all categories have ≥1 active entry.

**≥768px:** Categories arrange in a two-column grid.

```css
@media (min-width: 768px) {
  .category-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-5);
  }
}
```

Initial state: all categories expanded, all entries active.

---

## Part 6: Character Creation UI

### Route

`/campaigns/:campaignId/characters/new` — navigated to from `CampaignDetail` when no character exists.

### Page: `CharacterCreate.svelte`

**Layout:** `<PageLayout>`. Screen label `CHARACTER CREATION` at top.

**Form structure:** Single scrollable form. No stepped wizard. All sections visible at once. `<Button fullWidth type="submit">` labeled `CONFIRM CREW` at the bottom.

On submit: POST to `POST /campaigns/:campaignId/characters` (see backend note below). On success, navigate back to `/campaigns/:campaignId`.

No validation in M3. All fields are optional at the API level. Display default values as specified.

---

### Section: IDENTITY

`<Card>` with `<SectionLabel>IDENTITY</SectionLabel>`.

| Field     | Component                   | Default    | Notes                                                                                                                                                                                                                                          |
|-----------|-----------------------------|------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| NAME      | `<Input label="NAME">`      | empty      | Required conceptually; no validation in M3                                                                                                                                                                                                     |
| CLASS     | `<Select label="CLASS">`    | `Teamster` | Options: `Teamster`, `Marine`, `Scientist`, `Android`                                                                                                                                                                                          |
| PRONOUNS  | `<Input label="PRONOUNS">`  | empty      | Free text                                                                                                                                                                                                                                      |
| ENTITY ID | `<Input label="ENTITY ID">` | auto       | Auto-derived from name: lowercase, spaces → underscores, strip special chars. Field is editable. Render it smaller (`--color-text-ghost`, `--font-size-xs`) to de-emphasize. Show derivation hint below: `DERIVED FROM NAME — USED INTERNALLY` |

---

### Section: STATS

`<Card>` with `<SectionLabel>STATS</SectionLabel>`.

Six stat fields in a 2-column grid. Each is an `<Input type="number" label="...">` with default value `30`.

Stats: `STRENGTH`, `SPEED`, `INTELLECT`, `COMBAT`, `INSTINCT`, `SANITY`

```css
.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}
```

---

### Section: SAVES

`<Card>` with `<SectionLabel>SAVES</SectionLabel>`.

Four save fields in a 2-column grid. Each is an `<Input type="number" label="...">` with default value `30`.

Saves: `FEAR`, `BODY`, `ARMOR`, `ARMOR MAX`

---

### Section: HIT POINTS

`<Card>` with `<SectionLabel>HIT POINTS</SectionLabel>`.

Two fields side by side:
- `CURRENT HP`: `<Input type="number">`, default `20`
- `MAX HP`: `<Input type="number">`, default `20`

---

### Section: STRESS

`<Card>` with `<SectionLabel>STRESS</SectionLabel>`.

Two fields side by side:
- `CURRENT STRESS`: `<Input type="number">`, default `0`
- `MAX STRESS`: `<Input type="number">`, default `3`

---

### Section: SKILLS

`<Card>` with `<SectionLabel>SKILLS</SectionLabel>`.

Dynamic add/remove list. Not a comma-separated text input.

Each skill entry: a row with a text input (`<Input placeholder="Skill name">`) and a remove button (`×`, ghost, `--color-text-ghost`).

An `+ ADD SKILL` ghost button below the list adds a new empty row.

---

### Section: LOADOUT

`<Card>` with `<SectionLabel>LOADOUT</SectionLabel>`.

Same dynamic add/remove pattern as SKILLS, but for equipment items.

---

### Section: NOTES

`<Card>` with `<SectionLabel>NOTES</SectionLabel>`.

A `<textarea>` styled with input tokens (`--input-bg`, `--input-border`, etc.). No `<Input>` wrapper — direct `<textarea>` with `resize: vertical`, `min-height: 80px`.

---

### Backend note for M3

M3 requires a `POST /campaigns/:campaignId/characters` endpoint that writes a character sheet to the database. The frontend submits the form as JSON. The endpoint should:

- Accept the full character sheet shape (stats, saves, HP, stress, skills, loadout, notes, entityId, class, pronouns)
- Write to `character_sheets` table
- Return the created character with its `id`
- Return `409` if the campaign already has a character (one per campaign rule)
- Membership check required (403 for non-members)

The Mothership character sheet Zod schema is already in `packages/game-systems` — use it for validation on both frontend submit and backend ingestion.

---

## Part 7: Routing Updates

Add two new routes to `App.svelte`:

```typescript
// /oracle-filter
// /campaigns/:campaignId/characters/new
```

Update the router match logic to handle these. The `campaignId` context is available on the character creation page from the URL — extract it the same way `CampaignDetail` extracts its `campaignId`.

### Router graduation note

The homegrown router (`writable(pathname)` + `navigate()`) is sufficient for M3. It will come under pressure before M6, when the play view requires a nav-free full-screen layout that the current single-level `App.svelte` switch statement cannot cleanly accommodate, and when nested route params compound the existing manual regex pattern.

The planned graduation target is **`svelte-spa-router` v5**, which supports Svelte 5. Migrate at the start of M5, before the play view is built.

One known tradeoff: `svelte-spa-router` uses hash-based URLs (`/#/campaigns`) rather than the `history.pushState` clean URLs the current router produces. This is a deliberate product decision that should be made consciously at migration time — not defaulted into. Hash URLs are simpler operationally (no server-side catch-all required) and are acceptable for a self-hosted product where the URL bar is rarely shared. If clean URLs are preferred, the Traefik catch-all config (already on the Phase 1 roadmap) must be in place first, and an alternative router will be needed — `svelte-spa-router` does not support history mode.

Do not migrate the router in M3. Note this as a task for M5.

---

## Part 8: File Summary

```
apps/zoltar-fe/src/
  lib/
    components/
      PageLayout.svelte           ← NEW
    data/
      oracle/
        types.ts                  ← NEW
        index.ts                  ← NEW
        survivors.json            ← NEW
        threats.json              ← NEW
        secrets.json              ← NEW
        vessel-type.json          ← NEW
        tone.json                 ← NEW
    oracle/
      state.svelte.ts             ← NEW
  pages/
    SignIn.svelte                 ← UPDATED (theme only)
    CampaignList.svelte           ← UPDATED (theme + breakpoint)
    CampaignDetail.svelte         ← UPDATED (theme + breakpoint)
    OracleFilter.svelte           ← NEW
    CharacterCreate.svelte        ← NEW
  App.svelte                     ← UPDATED (nav theme + new routes)
```

---

## Constraints

- No hardcoded hex values. All colors via semantic tokens.
- No primitive token references in components. Semantic tokens only.
- No Tailwind or utility class framework.
- All components are Svelte 5 with runes.
- Mobile-first. `min-width: 768px` is the only breakpoint introduced in M3.
- `PageLayout.svelte` must be used on all pages — do not repeat the centering/max-width pattern inline.
- Do not introduce Bits UI for any M3 component — none of these patterns require it.
- No layout or logic changes to existing pages beyond what is required to apply theme and breakpoint. Functional behavior is unchanged.

---

## Verification Checklist

1. **Token compliance** — open DevTools on any page. No hardcoded color values in computed styles. No `--primitive-*` references in any component.
2. **Mobile render** — all pages render correctly at 375px viewport.
3. **768px breakpoint** — at 768px+, all pages center to a 680px column. Campaign cards are 2-column. Oracle categories are 2-column.
4. **SignIn** — magic link flow works end-to-end (enter email → confirmation state shown). No regression.
5. **CampaignList** — inline new campaign form expands and collapses. Campaign cards are clickable and navigate correctly.
6. **CampaignDetail** — new adventure button disabled correctly for both preconditions. Completed adventures hidden/shown toggle works.
7. **OracleFilter** — all categories render. Select all / deselect all work per category. Count indicator colors update correctly. Begin button disabled state enforced. ≥768px shows two-column category grid.
8. **CharacterCreate** — all sections render. Entity ID auto-derives from name input. Skills and loadout add/remove rows work. Form submits and navigates back to campaign detail on success.
9. **`tsc --noEmit`** — no type errors.
