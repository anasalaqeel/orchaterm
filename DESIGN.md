---
name: Orchaterm
description: A developer terminal styled as a live telegraph/telephone exchange — sessions are jacks, relays are patch cords, state is a lamp.
colors:
  lamp: "#d1401f"
  lamp-light: "#b8391f"
  lamp-hover: "#e04d29"
  lamp-deep: "#a8331a"
  lamp-tint: "#e8a48f"
  brass: "#b08d57"
  brass-light: "#9c7a48"
  brass-border: "#4a3a22"
  brass-border-light: "#d9c9a8"
  brass-gradient-hi: "#d9bb85"
  brass-gradient-mid: "#8a6a3d"
  brass-gradient-lo: "#cfa66b"
  paper: "#f0e6d2"
  paper-light: "#f5efe0"
  success: "#7fa06a"
  success-light: "#4f7a3f"
  warning: "#d9932a"
  warning-light: "#a86a12"
  error: "#c73e2e"
  error-light: "#a3301f"
  error-hover: "#e0644f"
  info: "#8095ad"
  info-light: "#4a5f7a"
  canvas: "#100e0c"
  canvas-light: "#ece4d2"
  surface: "#1e1a14"
  surface-light: "#efe6d0"
  surface-raised: "#262019"
  surface-raised-light: "#e8dcc0"
  text-primary: "#f0e6d2"
  text-primary-light: "#241d12"
  text-secondary: "#b6a988"
  text-secondary-light: "#55492f"
  text-tertiary: "#7a6f58"
  text-tertiary-light: "#8a7a55"
  plum: "#9c5fa3"
  plum-hover: "#cf9bd6"
  plum-hover-light: "#e6c9ea"
  wire-blue: "#4a7ca3"
  patina-green: "#6b8f3f"
  teal: "#0e8a80"
  ochre: "#c98a1f"
  steel-gray: "#5a6570"
  on-accent: "#ffffff"
typography:
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    letterSpacing: "0.04em"
  mono:
    fontFamily: "'Fira Code', 'JetBrains Mono', Menlo, monospace"
    fontSize: "13px"
    fontWeight: 400
rounded:
  sm: "3px"
  md: "4px"
  lg: "6px"
  xl: "9px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.lamp}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
    padding: "8px 20px"
  button-primary-hover:
    backgroundColor: "#e04d29"
  jack-plate:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.brass}"
    rounded: "{rounded.sm}"
    padding: "1px 5px"
    typography: "{typography.label}"
---

# Design System: Orchaterm

## Overview

**Creative North Star: "The Central Exchange"**

Orchaterm is styled as a live telephone/telegraph exchange operator's desk, circa the early 1900s: brass jack fields, bakelite panels, waxed ticker paper, and a single indicator-lamp accent color. Every terminal session is a jack; relaying context between sessions is a patch cord, not a copy-paste; status is read from a lamp, lit or dark, not from a colored badge. The system replaces Orchaterm's original ClickUp-purple, soft-shadow SaaS-dashboard look — that look is now the explicit anti-reference (`SaaS Dashboard Standard` in the direction round this system was chosen from): rounded cards, gradient accents, and a violet brand color, all retired.

This is an **Operate**-mode surface: a working tool a solo developer runs for hours at a time, not a marketing surface. The world's materials (brass, bakelite, paper) express identity through color, radius, and a handful of named components (the jack plate, the lamp, the ticker row) — never through decoration that would slow a developer down mid-task. Density, legibility, and native desktop conventions outrank expression wherever they conflict.

**Key Characteristics:**
- One accent color throughout — the indicator lamp (`#d1401f` dark / `#b8391f` light) — used only for the primary action, current selection, and state, never as decoration.
- Tight, mechanical corner radii (3–9px) instead of soft SaaS rounding (previously 6–20px).
- No colored `border-left` accent bars on cards, rows, or callouts (see Do's and Don'ts) — state and provenance are read from a lamp dot or an icon color, in keeping with the world's own vocabulary.
- Two themes (dark = night shift, light = day shift/ticker paper), both drawn from the same brass/bakelite/lamp material set — dark or light is a shift, not a different world.
- Curated xterm theme presets (Dracula, Tokyo Night, Nord, Gruvbox, One Dark, Solarized, Catppuccin) are product functionality, not house identity — they are explicitly out of scope for this system and were left untouched.

## Colors

Restrained strategy: a near-black/near-paper neutral ground carries the surface, brass carries structure and hardware, and the lamp color is the only saturated accent — reserved for the primary action, active/selected state, and alerts.

### Primary
- **Indicator Lamp** (`#d1401f` dark / `#b8391f` light): the system's one accent. Primary buttons, active nav/tab state, focus rings, cursor, selection glow, "on" state. Never used decoratively.

### Secondary
- **Brass** (`#b08d57` dark / `#9c7a48` light): hardware, not accent. Borders, jack rings, corner plates, dividers, scrollbar thumb. Reads as structure, always at low-to-mid alpha against the ground, never as a call to action.

### Tertiary
- **Ticker Paper** (`#f0e6d2` dark / `#f5efe0` light): primary text color and, in the light theme, the surface ground itself. The material the system's "printed" elements (labels, ticker rows) are made of.

### Neutral
- **Bakelite Canvas** (`#100e0c` dark / `#ece4d2` light): the outermost background.
- **Bakelite Surface** (`#1e1a14` dark / `#efe6d0` light): panels, sidebar, cards.
- **Bakelite Raised** (`#262019` dark / `#e8dcc0` light): inner cards, jack plates, code blocks.
- **Text Secondary** (`#b6a988` dark / `#55492f` light) / **Text Tertiary** (`#7a6f58` dark / `#8a7a55` light): de-emphasized text, tiered by the same warm-neutral hue as primary text — never a cool gray.

### Semantic
- **Success** (`#7fa06a` dark / `#4f7a3f` light) — muted patina green, not a saturated status green.
- **Warning** (`#d9932a` dark / `#a86a12` light) — amber, incandescent-lamp toned.
- **Error** (`#c73e2e` dark / `#a3301f` light) — deep hazard red, paired with the hazard-stripe border pattern in Components.
- **Info** (`#8095ad` dark / `#4a5f7a` light) — steel-wire blue-gray, deliberately desaturated so it never competes with the lamp accent.

### Named Rules
**The One Lamp Rule.** Exactly one saturated accent color exists in the system: the indicator lamp. Every other color in a given view is either a neutral (bakelite/paper) or a semantic state color at reduced saturation. A second saturated "brand" color is a regression to the retired SaaS look.

**The Brass-Is-Structure Rule.** Brass never carries meaning (it is not a status color); it only ever renders hardware — borders, rings, dividers, plates. If a design needs to communicate state, reach for the lamp or a semantic color, not brass.

## Typography

**Body Font:** Inter (system sans fallback stack)
**Mono Font:** Fira Code / JetBrains Mono (terminal and code)

**Character:** A plain, high-legibility system sans carries all UI chrome — Operate-mode surfaces earn no display voice. The world's identity lives in color, material, and named components, not in typeface; Inter stays because changing the base UI font is out of scope for a color/material world change and the product needs maximum legibility across long sessions.

### Hierarchy
- **Title** (700–800 weight, 18–28px): page/section headings (e.g. "System Settings").
- **Body** (400 weight, 13px, 1.5 line-height): default UI text.
- **Label** (600 weight, 10–11px, 0.04–0.08em tracking, uppercase where used as a plate/tag): jack plates, section labels, status pills — the system's "engraved brass plate" typographic register.
- **Mono** (400 weight, 13px): terminal content, code, search input, ticker-tape relay rows.

### Named Rules
**The Stamped-Label Rule.** Any label meant to read as a physical marking (a jack plate, a section header in the sidebar, a status pill) is set uppercase, tracked (+0.04em or more), and small (10–11px) — the system's one recurring typographic device besides the mono/body split.

## Layout

Standard Operate-mode app shell: fixed-width collapsible sidebar (56px collapsed / 248px expanded, 220ms width transition) + flexible main content. Terminal grid uses absolute-positioned panes computed from a split tree, not CSS grid. Spacing follows the `--spacing-*` scale (4/8/16/24/32/48px). Density is high — this is a tool used for hours, not a marketing page; the pipeline/task-log/prompt-vault surfaces run tight paddings (8–14px) throughout.

## Elevation & Depth

Hybrid: mostly flat, tonal layering (canvas → surface → surface-raised) does most of the depth work, with soft dark shadows reserved for genuinely floating elements (popovers, modals, the floating collapse handle, the active split-pane border).

### Shadow Vocabulary
- **sm** (`0 1px 3px rgba(0,0,0,.55)` dark / lighter warm-neutral in light): resting card/row separation.
- **md** (`0 4px 14px rgba(0,0,0,.6)`): popovers, dropdowns, floating badges.
- **lg** (`0 10px 32px rgba(0,0,0,.7)`): modals.
- **brand** (`0 0 20px rgba(209,64,31,.28)`): the lamp glow — used only on the active/lit state of lamp-family elements (`.lamp[data-lit="true"]`, primary buttons on hover).
- **glow** (`0 0 36px rgba(176,141,87,.14)`): a faint brass ambient glow, used sparingly behind brand-adjacent chrome (e.g. logo loader).

### Named Rules
**The Lamp-Glow-Only Rule.** The colored glow shadow (`--shadow-brand`) is reserved for elements literally modeling a lit indicator lamp or the primary action. A glow on anything else is decoration and should use a neutral shadow instead.

## Shapes

Mechanical, hardware-scaled radii — brass/bakelite panel chamfers, not soft SaaS bubble corners: `--radius-sm: 3px`, `md: 4px`, `lg: 6px`, `xl: 9px`. True circular elements (lamps, avatars, badges) use `--radius-full` and are drawn as actual circles (a socket ring, a lamp), never a decorative pill unless the underlying object genuinely is round. Borders are 1px (occasionally 1.5px on an active split-pane outline) and brass-tinted (`rgba(176,141,87,α)`) rather than pure white/black alpha.

## Components

### Buttons
- **Shape:** `--radius-md` (4px).
- **Primary:** lamp background (`--color-brand`), paper text, `8px 20px` padding; hover brightens toward `#e04d29`.
- **Secondary/Ghost:** transparent background, brass or neutral border, text-secondary color; hover lifts to `--bg-hover` with brass border.
- **Danger/Stop:** transparent with `--color-error` border+text; hover fills to a low-alpha error tint.

### The Lamp (signature component)
The system's status vocabulary, defined once in `index.css` as `.lamp` / `.lamp[data-lit="true"]`: an 8px circle, dark-outlined, that glows via `box-shadow: 0 0 6px 1px var(--lamp-color)` only when lit. Used for session/agent state (idle/active/awaiting-input), provenance dots on system/relay messages, and anywhere a colored badge or border-left accent would previously have appeared.

### The Jack Plate (signature component)
`.brass-plate`: a small uppercase, tracked, mono label on a brass-bordered raised-surface chip (`JACK 4F2A`). Marks each terminal pane with its jack identity, quiet (55% opacity) until the pane is interacted with.

### Terminal Pane
- Framed as a jack module: brass corner plate top-left, near-black bakelite ground (`#100E0C`) regardless of theme (the terminal surface itself is always "night"), 4px/6px padding.
- Error state (`TERMINAL FAILED TO START`): hazard-toned — deep red border at 0.45 alpha, uppercase tracked title, no default blue "retry" button (retry uses the lamp color).
- Selection: brass-tinted (`rgba(176,141,87,.28)`), not the retired cyan.

### Cards / Rows (relay feed, system rows, conductor rows, task cards)
- **Corner Style:** `--radius-sm` (3px).
- **Background:** `--bg-tertiary`.
- **Border:** none by default; a **hazard border** (`.hazard-border`, dashed inset over a solid error-color edge) is the only bordered treatment, reserved for critical/error states.
- **Provenance/status:** a lamp dot (see above), never a colored `border-left`.
- Agent-summary and system rows additionally use the mono font and dashed top/bottom rules — the "ticker tape" register — rather than a card shadow.

### Inputs / Fields
- **Style:** 1px brass/neutral border, `--bg-input` fill, `--radius-md`.
- **Focus:** border shifts to `--border-color-focus` (lamp-tinted).

### Navigation (Sidebar)
- Workspace/session avatars are drawn as literal jack sockets: a circle (`--radius-full`) with a 1.5px brass ring and an inset shadow (reads as a socket hole), not a rounded square.
- Active nav item: solid lamp-color fill, white text.
- Tab bar: active tab gets a 2px lamp-colored top border; grouped/split tabs use a low-alpha lamp tint background.

## Do's and Don'ts

### Do:
- **Do** keep the lamp color (`--color-brand`) to primary actions, active state, and lit indicators only — everywhere else, use a neutral or a desaturated semantic color.
- **Do** use `.lamp` for any per-item state indicator (session state, message provenance, pipeline task status) instead of inventing a new colored-dot or badge pattern.
- **Do** keep radii at the tightened hardware scale (`--radius-sm/md/lg/xl`) — do not reintroduce 10–20px "soft card" rounding.
- **Do** tint borders, dividers, and scrollbars from brass (`rgba(176,141,87,α)`) rather than plain white/black alpha.
- **Do** leave the xterm theme presets (Dracula, Nord, Tokyo Night, etc.) and their exact hex values untouched — they are user-facing product functionality, not house style.

### Don't:
- **Don't** add a colored `border-left`/`border-right` accent bar to a card, row, callout, or alert — this pattern was removed everywhere it existed (GroupChat rows, TaskCard) in favor of the lamp/icon vocabulary. It is banned, not merely discouraged.
- **Don't** reintroduce gradient text, glass/blur as decoration, or a second saturated accent color alongside the lamp.
- **Don't** use the lamp-glow shadow (`--shadow-brand`) on anything that isn't a literal lit-lamp element or the primary action — it is not a general-purpose "important" glow.
- **Don't** style Settings/Pipeline/Prompt-Vault/Task-Log form controls, buttons, or badges with ad hoc hex colors — every color in this codebase should trace back to a CSS custom property defined in `src/index.css`.
