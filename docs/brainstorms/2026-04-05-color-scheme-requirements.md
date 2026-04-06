---
date: 2026-04-05
topic: color-scheme
---

# Atmospheric Color Scheme with Light/Dark Mode

## Problem Frame

Seance's UI is entirely monochrome neutral gray (`neutral-950` through `neutral-100`), hardcoded to dark mode with no theming infrastructure. The app's name and purpose — AI agent session orchestration — has a strong thematic identity that the current palette completely ignores. Users also have no way to switch to a light appearance or follow their OS preference.

## Color Direction

The palette leans into the "seance" theme: **purple/violet as primary**, **amber/gold as secondary** — crystal and candlelight.

**Dark mode** — deep purple-black surfaces, soft violet accents, muted gold for warmth:

| Role | Hex | Description |
|---|---|---|
| Background | `#0f0a14` | Deep purple-black |
| Surface | `#1a1028` | Purple-tinted dark |
| Border | `#2d2340` | Muted purple border |
| Text primary | `#f0eaf5` | Warm near-white |
| Text secondary | `#9b8fb0` | Muted lavender |
| Accent primary | `#9b72cf` | Soft violet |
| Accent primary hover | `#b490e0` | Lighter violet |
| Accent secondary | `#d4a04a` | Muted gold |
| Accent secondary hover | `#e6b85c` | Brighter gold |

**Light mode** — warm parchment backgrounds, richer violet and amber accents:

| Role | Hex | Description |
|---|---|---|
| Background | `#faf6f0` | Warm parchment |
| Surface | `#f3ede4` | Slightly darker cream |
| Border | `#e0d5c7` | Warm tan border |
| Text primary | `#2a1f3d` | Dark purple-gray |
| Text secondary | `#6b5e7a` | Muted purple |
| Accent primary | `#7c4dba` | Richer violet |
| Accent primary hover | `#6a3fa5` | Deeper violet |
| Accent secondary | `#8a6820` | Dark amber (WCAG AA compliant) |
| Accent secondary hover | `#705510` | Deeper amber |

**Semantic status colors** — unchanged across themes, except `done` and `exited` which use neutrals:

| Status | Color | Themed? |
|---|---|---|
| Running | `bg-green-500` | No |
| Thinking | `bg-amber-500` | No |
| Waiting | `bg-blue-500` | No |
| Error | `bg-red-500` | No |
| Done | `bg-neutral-400` | Yes — remap to a theme-aware muted tone |
| Exited | `bg-neutral-600` | Yes — remap to a theme-aware muted tone |

## Requirements

**Theme Infrastructure**

- R1. Define all theme colors as CSS custom properties, switched via a class or attribute on the root element. The semantic token vocabulary must cover at minimum: background, surface, border, text-primary, text-secondary, text-muted, accent-primary, accent-primary-hover, accent-secondary, accent-secondary-hover, interactive-bg, interactive-bg-hover, disabled-bg, disabled-text. Planning should audit the codebase to determine the complete set.
- R2. Replace all hardcoded Tailwind neutral color classes across components (~90 usages across 13 files) with semantic CSS variable references. This is the highest-effort requirement — each usage must be mapped to the correct semantic token, not mechanically find-and-replaced.
- R3. When `terminal_theme` is set to "system", the terminal reads the **resolved app theme** (not its own media query) and applies a matching xterm.js theme. The app theme listener (R5) is the single source of truth for OS preference; terminal derives from it. Since the terminal instance is long-lived, theme changes must patch `terminal.options.theme` on the existing instance and force a repaint.

**Theme Toggle**

- R4. Add an `app_theme` setting with three values: `system` (default), `dark`, `light` — in both the Rust `AppSettings` struct (with `#[serde(default)]`) and the TypeScript `AppSettings` interface/defaults
- R5. When set to `system`, detect OS appearance via `window.matchMedia('(prefers-color-scheme: dark)')` and attach a change listener for live reactivity. This listener is the single source of truth — terminal and all other theme-dependent systems derive from it.
- R6. When set to `dark` or `light`, override the system preference
- R7. Persist the setting via the existing Tauri `update_app_settings` / `get_app_settings` backend

**Flash Prevention**

- R10. The correct theme class must be applied to the document before first paint to prevent a flash of wrong colors. This requires resolving the persisted setting synchronously before React hydrates (e.g., a blocking `<script>` in `<head>`, or Tauri's window creation API).

**Settings UI**

- R8. Add an "App Theme" control to the Settings page (above the existing Terminal Theme control), using a segmented control or radio group: System / Dark / Light

**Session Avatars**

- R9. Render avatar shapes on a dark circular background (`#0f0a14` or similar) in both light and dark modes. This preserves the existing vibrant palette without modification and makes avatars a consistent branded element. All avatar colors must meet WCAG AA 3:1 contrast ratio against the avatar backdrop.

## Success Criteria

- Both dark and light modes feel atmospheric and intentional — the app has a distinctive visual identity rooted in the seance theme, not generic gray
- Theme follows OS preference by default, with instant switching (no flash/flicker on change)
- All text meets WCAG AA contrast ratios (4.5:1 normal text, 3:1 large text/graphical elements) in both modes

## Scope Boundaries

- Terminal theme remains a separate setting; R3 defines how "system" connects to the app theme
- No custom theme editor or user-configurable colors
- No per-session or per-project theming
- Semantic status colors (green, amber, blue, red) are not themed; `done`/`exited` neutrals are remapped to theme-aware tokens

## Key Decisions

- **Purple primary + amber secondary**: Leans into the seance/mystical identity rather than being another generic dev tool palette
- **Warm parchment light mode**: Avoids the sterile white that makes most dark-first apps feel like an afterthought
- **Three-way toggle (System/Dark/Light)**: Standard pattern, defaults to system-following
- **Dark backdrop for avatars**: Keeps existing vibrant palette, zero maintenance, consistent brand element across modes
- **Darkened light-mode amber** (`#8a6820`): Original `#b8862d` failed WCAG AA against parchment backgrounds

## Outstanding Questions

### Deferred to Planning

- [Affects R1, R2][Technical] Best approach for Tailwind v4 theme integration — `@theme` with CSS variables, or a different pattern? Tailwind v4 has evolved; verify current best practice.
- [Affects R2][Needs research] Audit all components to catalog every hardcoded neutral color class and map each to a semantic token. Determine the full token vocabulary beyond the minimum listed in R1.
- [Affects R10][Technical] Best approach for flash prevention in a Tauri app — blocking `<script>` reading from localStorage, or Tauri window creation API, or another pattern?
- [Affects R3][Technical] Verify xterm.js WebGL addon behavior on live theme changes — may need `terminal.refresh()` to force repaint of existing content after `terminal.options.theme` update.

## Next Steps

-> `/ce:plan` for structured implementation planning
