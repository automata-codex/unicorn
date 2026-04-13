# Design System

This document is the authoritative reference for the Zoltar frontend design system. Read it before writing any frontend code. All UI work must follow these conventions.

---

## Stack

- **Styling:** Svelte scoped `<style>` blocks. No utility framework (no Tailwind).
- **Theming:** CSS custom properties. Two-tier token system (see below).
- **Accessible primitives:** Bits UI for dialogs, dropdowns, tooltips, focus traps, and other accessibility-critical patterns. All visual styling of Bits UI primitives is owned by the application.
- **Mobile-first:** All layouts are designed at mobile size first and expanded for larger viewports via `min-width` media queries.

---

## Token Architecture

Tokens live in `apps/zoltar-fe/src/themes/`.

### `base.css` — Primitive tokens
Raw values. Color stops, type scale, spacing, radii. These never change between themes. **Components never reference primitives directly.**

### `themes/mothership.css` — Semantic tokens
Maps purpose onto primitives. This is what components use. Example:

```css
/* In mothership.css */
--color-warden-channel: var(--primitive-amber-400);

/* In a component */
border-left: 2px solid var(--color-warden-channel); /* correct */
border-left: 2px solid var(--primitive-amber-400);  /* wrong — never do this */
border-left: 2px solid #b8720a;                     /* wrong — never hardcode */
```

### Theme switching
The active theme is applied by setting `data-theme` on the root element:

```html
<html data-theme="mothership">
```

Future themes (fantasy, space-opera, etc.) are additional CSS files that redefine the semantic token layer. No component code changes when switching themes.

### Loading order
```html
<link rel="stylesheet" href="/themes/base.css" />
<link rel="stylesheet" href="/themes/mothership.css" />
```

---

## Semantic Token Reference

All tokens are defined on `[data-theme="mothership"]`. Use these in components.

### Backgrounds

| Token | Purpose |
|-------|---------|
| `--color-bg` | Page/app background |
| `--color-surface` | Card and panel backgrounds |
| `--color-surface-raised` | Inputs, entry rows, elevated elements |
| `--color-surface-deep` | Within-input background |

### Borders

| Token | Purpose |
|-------|---------|
| `--color-border-subtle` | Barely-there dividers between sections |
| `--color-border` | Default card and panel borders |
| `--color-border-input` | Input fields and entry rows |
| `--color-border-strong` | Outer containers, phone frame |

### Text

| Token | Purpose |
|-------|---------|
| `--color-text-primary` | Main content — GM narrative, entry names |
| `--color-text-secondary` | Player input text, stat values |
| `--color-text-tertiary` | Labels, category headers |
| `--color-text-ghost` | Near-invisible structural labels, placeholders |

### Accent (Amber)

| Token | Purpose |
|-------|---------|
| `--color-accent` | Primary interactive color, amber |
| `--color-accent-hover` | Hover state |
| `--color-accent-border` | Amber-tinted border |
| `--color-accent-bg` | Amber-tinted background |
| `--color-accent-bg-subtle` | Very subtle amber tint |
| `--color-accent-fg` | Text on amber backgrounds |

### Message Log Channels

| Token | Purpose |
|-------|---------|
| `--color-warden-channel` | Amber left border on warden messages |
| `--color-warden-surface` | Warden message background |
| `--color-warden-border` | Warden message outer border |
| `--color-player-channel` | Dim steel right border on player messages |
| `--color-player-surface` | Player message background |
| `--color-player-border` | Player message outer border |

Warden messages are left-anchored with a 2px left border using `--color-warden-channel`. Player messages are right-anchored with a 2px right border using `--color-player-channel`. The asymmetry is intentional — the warden's voice has authority the player's input does not.

### Inline Game Elements

| Token | Purpose |
|-------|---------|
| `--color-roll-prompt-bg` | Roll prompt chip background (d100 · INSTINCT) |
| `--color-roll-prompt-border` | Roll prompt chip border |
| `--color-roll-prompt-label` | Die notation label color |
| `--color-roll-prompt-text` | Skill/purpose label color |
| `--color-roll-result-bg` | Roll result chip background |
| `--color-roll-result-border` | Roll result chip border |
| `--color-roll-result-value` | The rolled number |

### Resource Bars

| Token | Purpose |
|-------|---------|
| `--color-hp` | HP bar fill |
| `--color-stress` | Stress bar fill |
| `--color-bar-track` | Empty bar track |

### Semantic States

| Token | Purpose |
|-------|---------|
| `--color-success` | Valid state, success, alive |
| `--color-success-text` | Success text |
| `--color-danger` | Invalid state, danger, dead |
| `--color-danger-text` | Danger text |
| `--color-danger-bg` | Danger background tint |
| `--color-presence-online` | Online presence indicator dot |

### Typography

| Token | Purpose |
|-------|---------|
| `--font-primary` | Monospace — used throughout in Mothership theme |
| `--font-ui` | Sans-serif fallback for non-game surfaces |

### Font Sizes

| Token | px | Use |
|-------|----|-----|
| `--font-size-2xs` | 8px | Metadata, icon labels |
| `--font-size-xs` | 9px | Category labels (SURVIVORS, STATS) |
| `--font-size-sm` | 10px | Hints, small UI text |
| `--font-size-md` | 11px | Body, entry names, buttons |
| `--font-size-base` | 12px | Message text, form values |
| `--font-size-lg` | 13px | Stat values, character name |
| `--font-size-xl` | 14px | Screen titles |
| `--font-size-2xl` | 16px | Campaign name |
| `--font-size-3xl` | 20px | Hero text |

### Letter Spacing

| Token | Value | Use |
|-------|-------|-----|
| `--tracking-tight` | 0.02em | Names, prose |
| `--tracking-base` | 0.06em | Buttons, interactive labels |
| `--tracking-wide` | 0.10em | Secondary labels |
| `--tracking-wider` | 0.12em | Category section headers |
| `--tracking-widest` | 0.14em | Screen-level labels (NEW ADVENTURE) |

### Spacing

| Token | px |
|-------|----|
| `--space-1` | 4px |
| `--space-2` | 6px |
| `--space-3` | 8px |
| `--space-4` | 10px |
| `--space-5` | 12px |
| `--space-6` | 14px |
| `--space-7` | 16px |
| `--space-8` | 20px |
| `--space-9` | 24px |
| `--space-10` | 32px |

### Border Radius

| Token | px | Use |
|-------|----|-----|
| `--radius-sm` | 4px | Chips, inputs, small elements |
| `--radius-md` | 6px | Buttons |
| `--radius-lg` | 8px | Cards, panels |
| `--radius-xl` | 12px | Large cards |
| `--radius-full` | 9999px | Pills, presence indicators |

### Component Tokens

These are pre-composed for common patterns. Use them in components rather than assembling from individual semantic tokens.

```css
/* Input fields */
--input-bg
--input-border
--input-text
--input-placeholder
--input-radius
--input-padding

/* Primary button */
--btn-primary-bg
--btn-primary-bg-hover
--btn-primary-text
--btn-primary-radius

/* Ghost button */
--btn-ghost-bg
--btn-ghost-text
--btn-ghost-text-active

/* Disabled state (applies to buttons and interactive elements) */
--btn-disabled-bg
--btn-disabled-border
--btn-disabled-text

/* Card */
--card-bg
--card-border
--card-radius
--card-padding

/* Section label (SURVIVORS, STATS, IDENTITY, etc.) */
--label-text
--label-size
--label-tracking
```

---

## Component Conventions

### Section labels
All uppercase section headers (IDENTITY, STATS, SAVES, etc.) use:
```css
font-family: var(--font-primary);
font-size: var(--label-size);
color: var(--label-text);
letter-spacing: var(--label-tracking);
```

### Cards
Cards use `--card-bg`, `--card-border`, `--card-radius`, `--card-padding`. No shadows.

### Inputs
All text and number inputs use component tokens. No custom input styling beyond token application.

### Disabled states
Interactive elements that are disabled due to preconditions (e.g. no character exists, adventure already active) must:
1. Use `--btn-disabled-*` tokens
2. Show a visible explanation of why — do not hide the affordance

### Collapsible panels
Status panel and dice zone in the play view are collapsed by default. Collapsed state shows a minimal indicator. A chevron rotates 180° when expanded.

### Message log
- Warden messages: left-aligned, `border-left: 2px solid var(--color-warden-channel)`, `border-radius: 0 var(--radius-sm) var(--radius-sm) 0`
- Player messages: right-aligned, `border-right: 2px solid var(--color-player-channel)`, `border-radius: var(--radius-sm) 0 var(--radius-sm) var(--radius-sm)`, max-width 82%
- Roll prompt chips: inline in warden messages, use `--color-roll-prompt-*` tokens
- Roll result chips: centered in log, use `--color-roll-result-*` tokens

### Oracle filtering UI
- Each category is a collapsible card
- Entry list inside each category has `max-height` set to show ~3 entries, `overflow-y: scroll`, `overscroll-behavior: contain`
- Count indicator (`x/y`) uses `--color-success` when ≥1 active, `--color-danger` when 0
- Submission is gated: begin button disabled until all categories have ≥1 active entry

### Character creation form
- Single scrollable form, no stepped wizard
- Default values: 30 for all stats and saves, 20 for max HP
- Entity ID auto-generated from name (lowercase, underscores), editable but de-emphasized
- Skills: dynamic add/remove list, not comma-separated input
- No validation in Phase 1

### Campaign detail
- One character per campaign (card with add slot when empty)
- One active adventure at a time
- New adventure affordance disabled with explanation when: no character exists, or an adventure is in `synthesizing`, `ready`, or `in_progress` state
- Completed adventures hidden by default, toggled visible with a button
