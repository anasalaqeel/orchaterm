---
name: Orchaterm
description: A developer terminal styled as a meteorological chart room — sessions are stations reporting live state, relay paths are isobar lines, chart-ink teal is the only primary accent, red is reserved for error.
colors:
  brand: "#2f8f7a"
  brand-light: "#24705c"
  brand-hover: "#3fac93"
  brand-deep: "#236e5c"
  brand-deep-light: "#1a5445"
  ink: "#565d61"
  ink-light: "#6e7579"
  ink-border: "#3a3f42"
  ink-border-light: "#a8adb0"
  ink-gradient-hi: "#7a8085"
  ink-gradient-mid: "#454b4f"
  ink-gradient-lo: "#6b7176"
  chart-paper: "#e9e6da"
  chart-paper-light: "#f2efe4"
  success: "#4f9d5c"
  success-light: "#3f7a4a"
  warning: "#d0972f"
  warning-light: "#a8721f"
  error: "#c0392b"
  error-light: "#a8321f"
  error-hover: "#d1503f"
  info: "#2f6fa8"
  info-light: "#24557f"
  canvas: "#14171a"
  canvas-light: "#e8e3d3"
  surface: "#21262a"
  surface-light: "#ece7d8"
  surface-raised: "#282e33"
  surface-raised-light: "#e3ddc9"
  text-primary: "#e9e6da"
  text-primary-light: "#24272a"
  text-secondary: "#a3aaad"
  text-secondary-light: "#4d5457"
  text-tertiary: "#6b7276"
  text-tertiary-light: "#7a8184"
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
  chip: "1px"
  chip-lg: "2px"
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
    backgroundColor: "{colors.brand}"
    textColor: "{colors.chart-paper}"
    rounded: "{rounded.md}"
    padding: "8px 20px"
  button-primary-hover:
    backgroundColor: "#3fac93"
  station-tag:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "1px 5px"
    typography: "{typography.label}"
---

# Design System: Orchaterm

## Overview

**Creative North Star: "Meteorological Station Model"**

Orchaterm is styled as a meteorological chart room: printed chart paper, graphite-ink structure, and a chart-ink teal accent for every primary/active state — a restrained instrument palette, not an alarm palette. Every terminal session reports itself the way a weather station reports to a synoptic chart: dense, legible, at a glance, never as a chat log or a patch-panel jack. This is a **replacement** of this project's prior visual worlds — "Flight Strip Board" (an air-traffic-control theme: aluminum rack, radar-sweep green, straight routing vectors) and, before that, "Central Exchange" (a telegraph/switchboard theme: brass hardware, bakelite panels, patch cords). Both are now anti-reference, along with the original ClickUp-purple SaaS-dashboard look that preceded either: rounded soft cards, gradient accents, a single metal-hardware material, and cable/jack connector metaphors are all retired. An intermediate pass of this same world tried red as the primary accent and reserved it for the wrong job — red read as constant alarm on every button and active state; red is now exclusively the error color, and teal carries the primary/active role instead.

This is an **Operate**-mode surface: a working tool a solo developer runs for hours at a time, not a marketing surface. The world's materials (chart paper, graphite ink) express identity through color, radius, and a handful of named components (the station tag, the chart row, the isobar line) — never through decoration that would slow a developer down mid-task. Density, legibility, and native desktop conventions outrank expression wherever they conflict. Window chrome is a single row: workspace identity and tabs share one strip (the way a terminal multiplexer keeps its own chrome thin), not a separate header row stacked above the tabs.

**Key Characteristics:**
- One accent carries meaning: chart-ink teal (`#2f8f7a` dark / `#24705c` light) for the primary action, current selection, and active state. Red (`#c0392b` dark / `#a8321f` light) is reserved exclusively for error/danger — never a primary or active-state color. Blue (`#2f6fa8` dark / `#24557f` light) is reserved for informational/relayed state.
- Tight, mechanical corner radii (3–9px) instead of soft SaaS rounding; small status chips are sharp (0–2px, on the `chip`/`chip-lg` micro-scale) — a chart mark's corner, not a pill.
- No colored `border-left` accent bars, no dashed "perforated tape" row dividers, and no curved cable connectors with terminal-jack circles — dependency edges are smooth isobar-style contour curves, and row dividers are a single solid ink rule.
- No metal-hardware material of any kind (no brass, no aluminum) — this world's only structural material is graphite ink on chart paper, deliberately distinct from both retired worlds.
- Two themes (dark = night chart room, light = day chart table), both drawn from the same chart-paper/ink/teal material set — dark or light is a shift, not a different world.
- Curated xterm theme presets (Dracula, Tokyo Night, Nord, Gruvbox, One Dark, Solarized, Catppuccin) are product functionality, not house identity — they are explicitly out of scope for this system and were left untouched.

## Colors

Restrained strategy: a near-black/near-paper neutral ground carries the surface, graphite ink carries structure, and chart-ink teal is the system's only primary/active accent — calm enough to sit on a button all day without reading as an alert.

### Primary
- **Chart-Ink Teal** (`#2f8f7a` dark / `#24705c` light): primary buttons, active nav/tab state, focus rings, cursor, selection glow. Never used decoratively.

### Secondary
- **Info Blue** (`#2f6fa8` dark / `#24557f` light): informational or relayed state only — a context handoff landing, an "incoming" badge, a relay-feed provenance mark. Never substituted for teal.

### Tertiary
- **Graphite Ink** (`#565d61` dark / `#6e7579` light): structure, not accent. Borders, dividers, station-tag chips, scrollbar thumb. Reads as instrument-grade neutral, always at low-to-mid alpha against the ground, never as a call to action.

### Neutral
- **Chart Paper** (`#e9e6da` dark / `#f2efe4` light): primary text color and, in the light theme, the surface ground itself.
- **Chart Room Canvas** (`#14171a` dark / `#e8e3d3` light): the outermost background.
- **Chart Room Surface** (`#21262a` dark / `#ece7d8` light): panels, sidebar, cards.
- **Chart Room Raised** (`#282e33` dark / `#e3ddc9` light): inner cards, station tags, code blocks.
- **Text Secondary** (`#a3aaad` dark / `#4d5457` light) / **Text Tertiary** (`#6b7276` dark / `#7a8184` light): de-emphasized text, tiered by the same cool-neutral hue as primary text.

### Semantic
- **Success** (`#4f9d5c` dark / `#3f7a4a` light) — clear-skies green.
- **Warning** (`#d0972f` dark / `#a8721f` light) — barometric-pressure amber.
- **Error** (`#c0392b` dark / `#a8321f` light) — alarm red, used only for error/danger states and never for a primary button, active nav, or any "everything is fine" state.
- **Info** (`#2f6fa8` dark / `#24557f` light) — shares the info-blue accent; informational and "incoming/relayed" are the same idea in this world.

### Named Rules
**The Teal-Is-Primary Rule.** Exactly one saturated accent carries primary/active meaning: chart-ink teal. Red is reserved exclusively for error/danger; using red for a button, active state, or anything that isn't an error is a regression to a rejected earlier pass of this same world.

**The Ink-Is-Structure Rule.** Graphite ink never carries meaning; it only renders structure — borders, dividers, tag chips. If a design needs to communicate state, reach for teal, a semantic color, or info-blue, not ink.

**The Isobar-Not-Cable Rule.** Dependency and relationship edges (`DependencyGraph`) render as smooth isobar-style contour curves, never straight routing vectors and never a curved cable ending in a terminal-jack circle. Row dividers (relay feed, agent summaries, quotes) are a single solid ink-tinted rule, never dashed.

## Typography

**Body Font:** Inter (system sans fallback stack)
**Mono Font:** Fira Code / JetBrains Mono (terminal and code)

**Character:** A plain, high-legibility system sans carries all UI chrome — Operate-mode surfaces earn no display voice. The world's identity lives in color, material, and named components, not in typeface; Inter stays because changing the base UI font is out of scope for a color/material world change and the product needs maximum legibility across long sessions.

### Hierarchy
- **Title** (700–800 weight, 18–28px): page/section headings (e.g. "System Settings").
- **Body** (400 weight, 13px, 1.5 line-height): default UI text.
- **Label** (600 weight, 10–11px, 0.04–0.08em tracking, uppercase where used as a station tag): station tags, section labels, status pills — the system's "printed chart label" typographic register.
- **Mono** (400 weight, 13px): terminal content, code, search input, relay-feed rows.

### Named Rules
**The Station-Tag Rule.** Any label meant to read as a physical marking (a station tag, a section header in the sidebar, a status pill) is set uppercase, tracked (+0.04em or more), and small (10–11px) — the system's one recurring typographic device besides the mono/body split.

## Layout

Standard Operate-mode app shell: fixed-width collapsible sidebar (56px collapsed / 248px expanded, 220ms width transition) + flexible main content. Terminal grid uses absolute-positioned panes computed from a split tree, not CSS grid. Spacing follows the `--spacing-*` scale (4/8/16/24/32/48px). Density is high — this is a tool used for hours, not a marketing page; the pipeline/task-log/prompt-vault surfaces run tight paddings (8–14px) throughout.

### Named Rules
**The Single-Row Chrome Rule.** Workspace identity (icon, name, active space pill, the "Workspaces" back button) renders inside the terminal's own tab row, right-aligned, not in a separate header row stacked above the tabs. One row of window chrome between the OS titlebar and the terminal content, the way a dense terminal multiplexer keeps its own chrome thin — never two.

## Elevation & Depth

Hybrid: mostly flat, tonal layering (canvas → surface → surface-raised) does most of the depth work, with soft dark shadows reserved for genuinely floating elements (popovers, modals, the floating collapse handle, the active split-pane border).

### Shadow Vocabulary
- **sm** (`0 1px 3px rgba(0,0,0,.55)` dark / lighter cool-neutral in light): resting card/row separation.
- **md** (`0 4px 14px rgba(0,0,0,.6)`): popovers, dropdowns, floating badges.
- **lg** (`0 10px 32px rgba(0,0,0,.7)`): modals.
- **brand** (`0 0 20px rgba(47,143,122,.26)`): the teal glow — used only on the active/selected state of accent elements (primary buttons on hover, active nav).
- **glow** (`0 0 36px rgba(86,93,97,.16)`): a faint ink ambient glow, used sparingly behind brand-adjacent chrome (e.g. logo loader).

### Named Rules
**The Teal-Glow-Only Rule.** The colored glow shadow (`--shadow-brand`) is reserved for the primary action or a genuinely active/selected element. A glow on anything else is decoration and should use a neutral shadow instead.

## Shapes

Mechanical, instrument-scaled radii — chart-instrument chamfers, not soft SaaS bubble corners: `--radius-sm: 3px`, `md: 4px`, `lg: 6px`, `xl: 9px`. Small per-item status chips (session dots, tab dots) use the micro-scale (`chip: 1px`, `chip-lg: 2px`, sized by dot diameter) — a printed chart mark's corner, not a lamp or a badge. Workspace/session identity marks are drawn as small rounded-square chips (`--radius-sm`), never circular avatars. Borders are 1px (occasionally 1.5px on an active split-pane outline) and ink-tinted (`rgba(86,93,97,α)`) rather than pure white/black alpha.

## Components

### Buttons
- **Shape:** `--radius-md` (4px).
- **Primary:** teal background (`--color-brand`), chart-paper text, `8px 20px` padding; hover brightens toward `#3fac93`.
- **Secondary/Ghost:** transparent background, ink or neutral border, text-secondary color; hover lifts to `--bg-hover` with an ink border.
- **Danger/Stop:** transparent with `--color-error` border+text; hover fills to a low-alpha error tint.

### The Station Tag (signature component)
`.station-tag`: a small uppercase, tracked, mono label on an ink-bordered raised-surface chip. Marks a UI element with a printed-chart identity; quiet (55% opacity) until interacted with.

### Terminal Pane
- Graphite chart-room ground (`#14171a`) regardless of theme (the terminal surface itself is always "night"), 4px/6px padding. No floating corner tag by default — the pane's own tab carries identity.
- Error state (`TERMINAL FAILED TO START`): hazard-toned — deep red border at 0.45 alpha, uppercase tracked title; the "Retry" button uses teal, the same as any other primary action, not red — red stays reserved for the error framing around it.
- Selection: ink-tinted (`rgba(86,93,97,.28)`), not the retired cyan.

### Cards / Rows (relay feed, system rows, conductor rows, task cards)
- **Corner Style:** `--radius-sm` (3px).
- **Background:** `--bg-tertiary`.
- **Border:** none by default; a **hazard border** (`.hazard-border`, dashed inset over a solid error-color edge) is the only bordered treatment, reserved for critical/error states.
- **Provenance/status:** the row's own ink-tinted top rule plus a small square status chip where needed — never a colored `border-left`, never a dashed top+bottom pair.
- Agent-summary and system rows use the mono font and a single solid top rule — the "chart entry in a log" register — rather than a card shadow or perforated-tape borders.

### Dependency Graph
- Edges render as smooth isobar-style contour curves in graphite ink, never straight routing vectors and never a curved cable terminating in a jack circle — a chart-line register, not a patch panel or a signal-vector diagram.

### Inputs / Fields
- **Style:** 1px ink/neutral border, `--bg-input` fill, `--radius-md`.
- **Focus:** border shifts to `--border-color-focus` (teal-tinted).

### Navigation (Sidebar)
- Workspace/session identity is drawn as a small rounded-square chip (`--radius-sm`): either an uploaded icon or a plain colored letter — never a circular avatar or dot.
- Active nav item: solid teal fill, white text.
- Tab bar: no border/dot status indicator; per-tab color is set via the right-click context menu's "TAB COLOR" swatch row and shown only there, keeping the tab strip itself clean. Workspace identity, the active space pill, and the "Workspaces" back button render inside this same row, right-aligned — there is no separate header row above the tabs.

## Do's and Don'ts

### Do:
- **Do** keep teal to primary actions, active state, and selection only; keep red to error/danger only — never use red for a button, active nav item, or anything that isn't an error.
- **Do** keep radii at the tightened hardware scale (`--radius-sm/md/lg/xl`) for panels and controls, and sharp (0–2px) for small status chips — do not reintroduce 10–20px "soft card" rounding or circular status dots.
- **Do** tint borders, dividers, and scrollbars from graphite ink (`rgba(86,93,97,α)`) rather than plain white/black alpha, and never reach for a metal-hardware material (brass, aluminum) — this world has none.
- **Do** keep window chrome to a single row — workspace identity and the "Workspaces" back button live inside the tab row, never in a header row stacked above it.
- **Do** leave the xterm theme presets (Dracula, Nord, Tokyo Night, etc.) and their exact hex values untouched — they are user-facing product functionality, not house style.

### Don't:
- **Don't** use red (`--color-error`) for a primary button, active nav/tab state, focus ring, or cursor — an earlier pass of this world did exactly that and it read as constant alarm; red means error, full stop.
- **Don't** add a colored `border-left`/`border-right` accent bar to a card, row, callout, or alert — this pattern is banned, not merely discouraged.
- **Don't** use a dashed "perforated tape" pair of borders on a row — use a single solid ink-tinted rule instead.
- **Don't** draw a straight routing vector or a curved cable with a terminal-jack circle for dependency/relationship edges — use a smooth isobar-style contour curve.
- **Don't** draw workspace, session, or agent identity as a circular avatar or a glowing dot — use a small rounded-square chip or the item's own color-tinted background.
- **Don't** reintroduce gradient text, glass/blur as decoration, or a second saturated primary accent alongside teal.
- **Don't** use the teal-glow shadow (`--shadow-brand`) on anything that isn't the primary action or a genuinely active/selected element — it is not a general-purpose "important" glow.
- **Don't** stack a separate workspace-identity header row above the terminal tab row — one row of chrome, not two.
- **Don't** style Settings/Pipeline/Prompt-Vault/Task-Log form controls, buttons, or badges with ad hoc hex colors — every color in this codebase should trace back to a CSS custom property defined in `src/index.css`.
