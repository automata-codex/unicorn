# M3 Implementation Plan — Oracle Tables, Character Creation & Frontend Theming

**Spec:** `docs/specs/zoltar/m3-oracle-tables-et-al.md`
**Created:** 2026-04-14

Pause after each phase for manual code review and git commit.

---

## Current State

- Base components exist: `Button`, `Card`, `Input`, `Select`, `SectionLabel`, `ResourceBar`, `StatusDot`
- Design tokens (base.css, mothership.css) and typography classes are loaded and working
- M2 pages (`SignIn`, `CampaignList`, `CampaignDetail`) exist functionally but are unstyled
- `App.svelte` has unstyled nav and routes for `/signin`, `/campaigns`, `/campaigns/:id`, `/dev/components`
- Router is a simple `writable(pathname)` + `navigate()` in `lib/router.svelte.ts`
- `MothershipCharacterSheetSchema` exists in `packages/game-systems`
- Backend has `characterSheets` table (JSONB data model) but no character controller/service/repository
- No `PageLayout` component, no oracle data files, no oracle state module

---

## Phase 1 — Scaffolding: PageLayout, Routing & Placeholder Pages

Structural changes only. Quick to review.

### 1a. `PageLayout.svelte`

Create `apps/zoltar-fe/src/lib/components/PageLayout.svelte` per spec Part 3:
- Mobile: full viewport, `--color-bg` background, `--space-7` padding
- 768px+: flex column, centered, children max-width `680px`
- Default slot, no props

### 1b. Routing updates

Update `App.svelte` to add route matching for:
- `/oracle-filter` -> `OracleFilter.svelte` (placeholder for now)
- `/campaigns/:campaignId/characters/new` -> `CharacterCreate.svelte` (placeholder for now)

Create placeholder pages (`OracleFilter.svelte`, `CharacterCreate.svelte`) that render a heading so the routes are testable.

### Verification

- `npm run dev` — app loads, no console errors
- Navigate to `/oracle-filter` and `/campaigns/test-id/characters/new` — placeholder pages render
- `tsc --noEmit` passes

---

## Phase 2 — Oracle Data Layer: Types & JSON Files

Content-heavy phase — 5 JSON files with narrative content that benefits from focused review.

### 2a. Oracle types

Create `apps/zoltar-fe/src/lib/data/oracle/types.ts` — `OracleEntry`, `OracleTable`, `OracleCategory` types (spec Part 1).

### 2b. Oracle JSON files

Create five JSON files in `apps/zoltar-fe/src/lib/data/oracle/`, each conforming to `OracleTable` shape:
- `survivors.json` — 8+ entries, Mothership sci-fi horror survivor archetypes
- `threats.json` — 8+ entries, threats (biological, corporate, environmental, etc.)
- `secrets.json` — 8+ entries, hidden truths and conspiracies
- `vessel-type.json` — 6+ entries, ship/station types
- `tone.json` — 6+ entries, tonal modes (dread, paranoia, body horror, etc.)

Each entry needs: `id` (stable slug), `player_text` (short label), `claude_text` (1-3 sentence narrative seed), `interfaces` (cross-category links), `tags`.

### 2c. Oracle index

Create `apps/zoltar-fe/src/lib/data/oracle/index.ts` — maps JSON to `builtInOracleCategories: OracleCategory[]`.

### Verification

- JSON files parse without error
- `tsc --noEmit` passes
- `builtInOracleCategories` has 5 categories with correct entry counts

---

## Phase 3 — Oracle Filter State Module & Tests

Pure TypeScript logic, independent from the UI.

### 3a. State module

Create `apps/zoltar-fe/src/lib/oracle/state.svelte.ts` per spec Part 2:
- `OracleFilterState` type with `active: Record<string, Set<string>>`
- `createOracleFilterState(categories)` — accepts `OracleCategory[]`, all entries start active
- Helper functions: `isAllActive`, `isNoneActive`, `activeCount`, `toggleEntry`, `selectAll`, `deselectAll`
- Derived "begin gate" boolean: every category must have >= 1 active entry

### 3b. Unit tests

- Oracle state module: test `createOracleFilterState`, `toggleEntry`, `selectAll`, `deselectAll`, begin gate logic
- Types: verify JSON files parse against `OracleTable` shape (Zod or manual check)

### Verification

- All tests pass
- `tsc --noEmit` passes

---

## Phase 4 — Theme Existing Pages

Apply Mothership theme to all M2 pages and the App nav. Visual changes only — no logic or data-fetching changes.

### 4a. `App.svelte` nav bar (spec 4.1)

- Mobile: full-width bar with `ZOLTAR` wordmark left, email + ghost sign-out button right
- 768px+: nav constrains to 680px centered
- Replace loading state with full-screen centered layout, `--color-text-ghost` indicator
- Tokens: `--color-surface` bg, `--color-border-subtle` bottom border, `--color-accent` wordmark, etc.

### 4b. `SignIn.svelte` (spec 4.2)

- Vertically/horizontally centered layout
- `ZOLTAR` wordmark above, `CREW ACCESS` title in Card
- Replace raw inputs with `<Input>` and `<Button fullWidth>` components
- Link-sent state: `LINK TRANSMITTED -- CHECK YOUR INBOX`
- Dev note: `MAILHOG -> LOCALHOST:8025`
- Mobile: card fills width with padding; 768px+: card max-width 400px centered

### 4c. `CampaignList.svelte` (spec 4.3)

- Wrap in `<PageLayout>`, screen label `CAMPAIGNS`
- Campaign cards using `<Card>` with `type-campaign-name`, clickable (full card navigates)
- Mobile: stacked; 768px+: two-column grid
- Inline new campaign form: collapsed = ghost `+ NEW CAMPAIGN` button; expanded = Input + Button + Cancel
- Empty state: `NO CAMPAIGNS -- CREATE ONE BELOW`

### 4d. `CampaignDetail.svelte` (spec 4.4)

- Wrap in `<PageLayout>`
- Back link: ghost `<Button>` with `<- CAMPAIGNS`
- Character section in `<Card>`: empty state (`NO CREW ASSIGNED` + `CREATE CHARACTER` button) or character display
- Adventures section in `<Card>`: new adventure button with disabled states + explanations
- Adventure list with status badges using semantic color tokens (replace hardcoded hex)
- Completed adventures hidden by default with `SHOW COMPLETED (n)` toggle

### Verification

- All pages render correctly at 375px mobile viewport
- At 768px+, content centers to 680px column, campaign cards go 2-column
- No hardcoded hex values in DevTools computed styles
- SignIn flow works end-to-end (email -> confirmation state)
- Campaign list: inline form expands/collapses, cards navigate correctly
- Campaign detail: completed adventures toggle works
- `tsc --noEmit` passes

---

## Phase 5 — Oracle Filtering UI

Build the full oracle filtering page using the data layer and state module from Phase 1.

### 5a. `OracleFilter.svelte` (spec Part 5)

Replace placeholder with full implementation:
- `<PageLayout>` wrapper, screen label `ORACLE FILTER`
- Instruction text: `CONFIGURE ORACLE POOL -- ONE ENTRY WILL BE DRAWN PER CATEGORY`
- Per category: collapsible `<Card>` with:
  - Header: `<SectionLabel>`, count indicator (`x/y` with success/danger coloring), Select All / Deselect All ghost buttons, chevron
  - Body: scrollable entry list (max-height ~3 entries), toggle rows with `player_text`
- 768px+: two-column category grid
- `BEGIN` button at bottom: disabled when any category has 0 active entries, enabled otherwise
- On submit: log selections to console + show confirmation state (no backend wiring in M3)
- Initial state: all categories expanded, all entries active
- Receives `categories` as prop; caller passes `builtInOracleCategories`

### Verification

- All 5 categories render with correct entry counts
- Select all / deselect all work per category
- Count indicator: green when >= 1, red when 0
- Begin button disabled when any category is empty, enabled otherwise
- 768px+: two-column category grid
- Collapsing/expanding categories works, chevron rotates
- `tsc --noEmit` passes

---

## Phase 6 — Character Creation (Frontend + Backend)

### 6a. Backend: character endpoint

Create character module following the established pattern (controller/service/repository):

- `POST /api/v1/campaigns/:campaignId/characters`
  - SessionGuard + membership check (403 for non-members)
  - Validate body against `MothershipCharacterSheetSchema` from `@uv/game-systems`
  - Write to `characterSheets` table
  - Return 409 if campaign already has a character
  - Return created character with `id`

Files:
- `apps/zoltar-be/src/character/character.controller.ts`
- `apps/zoltar-be/src/character/character.service.ts`
- `apps/zoltar-be/src/character/character.repository.ts`
- `apps/zoltar-be/src/character/character.module.ts`

### 6b. Frontend: `CharacterCreate.svelte` (spec Part 6)

Replace placeholder with full implementation:
- `<PageLayout>` wrapper, screen label `CHARACTER CREATION`
- Single scrollable form, all sections visible
- Sections (each in a `<Card>` with `<SectionLabel>`):
  - **IDENTITY:** Name, Class (`<Select>`), Pronouns, Entity ID (auto-derived from name, editable, de-emphasized)
  - **STATS:** 2-column grid, 6 number inputs (Strength, Speed, Intellect, Combat, Instinct, Sanity), default 30
  - **SAVES:** 2-column grid, 4 number inputs (Fear, Body, Armor, Armor Max), default 30
  - **HIT POINTS:** Current HP (20) + Max HP (20) side by side
  - **STRESS:** Current Stress (0) + Max Stress (3) side by side
  - **SKILLS:** Dynamic add/remove list with `+ ADD SKILL` button
  - **LOADOUT:** Dynamic add/remove list with `+ ADD ITEM` button (same pattern as skills)
  - **NOTES:** `<textarea>` styled with input tokens, resize vertical, min-height 80px
- `CONFIRM CREW` submit button at bottom
- On submit: POST to backend, on success navigate to `/campaigns/:campaignId`

### 6c. Backend unit tests

- Character service: test membership check, 409 on duplicate, successful creation
- Character repository: integration test with test database (if test DB infrastructure exists; otherwise unit test with mocked repo)
- Zod validation: test valid and invalid character sheet shapes

### Verification

- Navigate from CampaignDetail `CREATE CHARACTER` button to character creation form
- All sections render, number inputs have correct defaults
- Entity ID auto-derives from name (lowercase, spaces to underscores, strip special chars)
- Skills and loadout add/remove rows work
- Form submits successfully, navigates back to campaign detail
- Submitting for a campaign that already has a character returns 409
- `tsc --noEmit` passes (frontend)
- Backend tests pass

---

## Phase 7 — Final Verification & Polish

### 7a. Full verification checklist (spec Part 9)

Walk through every item in the spec's verification checklist:
1. Token compliance: no hardcoded color values, no `--primitive-*` references
2. Mobile render: all pages at 375px
3. 768px breakpoint: centered column, 2-column grids
4. SignIn flow end-to-end
5. CampaignList: inline form, card navigation
6. CampaignDetail: adventure button disabled states, completed toggle
7. OracleFilter: categories, toggles, count colors, begin gate, 2-column grid
8. CharacterCreate: all sections, entity ID derivation, dynamic lists, form submit
9. `tsc --noEmit` passes

### 7b. Fix any issues found

Address any bugs, type errors, or visual inconsistencies discovered during verification.

### Verification

- All 9 verification checklist items pass
- Clean `tsc --noEmit`
- No console errors or warnings
