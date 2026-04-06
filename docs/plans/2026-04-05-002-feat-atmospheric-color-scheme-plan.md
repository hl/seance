---
title: "feat: Atmospheric color scheme with light/dark mode"
type: feat
status: completed
date: 2026-04-05
origin: docs/brainstorms/2026-04-05-color-scheme-requirements.md
---

# feat: Atmospheric color scheme with light/dark mode

## Overview

Replace Seance's hardcoded neutral-gray palette with a thematic purple/amber color scheme that supports both dark and light modes. Add a three-way toggle (System/Dark/Light) to settings, with system-preference following by default and flash-free startup.

## Problem Frame

The app's UI is entirely monochrome neutral gray, hardcoded to dark mode with no theming infrastructure. The "seance" identity — mystical, atmospheric — is completely absent from the visual design. Users have no way to switch to a light appearance or follow their OS preference. (see origin: `docs/brainstorms/2026-04-05-color-scheme-requirements.md`)

## Requirements Trace

- R1. Semantic CSS custom property tokens, switched via `.dark` class on root
- R2. Replace ~77 hardcoded `neutral-*` classes across 13 components with semantic tokens
- R3. Terminal reads resolved app theme when `terminal_theme` is "system"; live-patches xterm.js theme
- R4. `app_theme` setting (system/dark/light) in Rust and TypeScript
- R5. System preference detection via `matchMedia` with live listener
- R6. Manual override when set to dark/light
- R7. Persist via existing Tauri settings backend
- R8. App Theme segmented control in Settings UI
- R9. Avatars render on dark circular backdrop in both modes
- R10. Flash prevention — correct theme class before first paint

## Scope Boundaries

- Terminal theme remains a separate setting; "system" derives from app theme (not its own listener)
- No custom theme editor, per-session theming, or user-configurable colors
- Semantic status colors (green/amber/blue/red) unchanged; `done`/`exited` neutrals remapped

## Context & Research

### Relevant Code and Patterns

- **Tailwind v4 CSS-first config**: `src/index.css` uses `@theme` directive, `@tailwindcss/vite` plugin. No JS config file.
- **Zustand stores**: `src/stores/appStore.ts`, `src/stores/sessionStore.ts` — vanilla `create` API, selector hooks, direct `invoke()` calls.
- **Settings pattern**: `src-tauri/src/models.rs` uses `#[serde(default = "fn_name")]` per field. `src-tauri/src/persistence.rs` does atomic JSON write, `unwrap_or_default()` on load.
- **Terminal hook**: `src/hooks/useTerminal.ts` — single long-lived `Terminal` instance with WebGL addon. Theme is hardcoded at creation.
- **No existing settings store**: `Settings.tsx` manages its own local state with `useState`.

### Institutional Learnings

- **Tauri IPC snake_case contract** (from `docs/solutions/integration-issues/`): Field names must match exactly between Rust and TypeScript — use `app_theme` on both sides, not `appTheme`.
- **Tailwind v4 `@theme`** (from `docs/solutions/best-practices/`): Custom values go in CSS `@theme` blocks, not JS config.

### External References

- **Tailwind v4 dark mode**: Use `@custom-variant dark (&:where(.dark, .dark *))` for class-based switching with `@theme` for semantic tokens. (`@theme` without `inline` — `inline` produces literal values, not `var()` references, which breaks dark mode switching.)
- **xterm.js theme**: `terminal.options.theme = newObject` triggers automatic WebGL repaint — no dispose/recreate needed.
- **Flash prevention**: Blocking `<script>` in `<head>` reading `localStorage` is the standard Tauri pattern.

## Key Technical Decisions

- **`@theme` (not `inline`) + `@custom-variant dark`**: Tailwind v4's CSS-first approach. `@theme` (without `inline`) emits CSS custom properties on `:root` and generates utilities that resolve via `var()` references — this is required for `.dark` class overrides to work. (`@theme inline` would produce literal values, breaking dark mode entirely.) `.dark` class on `<html>` gives synchronous control for flash prevention. Components use first-class utilities like `bg-bg`, `text-text-muted`.
- **`localStorage` mirror on save only**: Tauri's `invoke()` is async, so the blocking `<script>` cannot read from the Rust backend. Mirror `app_theme` to `localStorage` only when the user saves settings (not on preview changes). This prevents a flash-on-relaunch bug where an unsaved preview would persist in localStorage but not in the Tauri backend.
- **Zustand theme store with terminal settings**: A new `themeStore` manages: resolved theme ("dark"/"light"), user preference ("system"/"dark"/"light"), `matchMedia` listener lifecycle, `<html>` class toggling, and `terminal_theme` setting. Including `terminal_theme` in this store solves the data access problem for the terminal hook (which currently has no way to read settings). The store is the single source of truth after hydration.
- **`resolved` = final active theme**: Throughout this plan, "resolved" means the final active theme value ("dark" or "light") after evaluating the user's preference against the OS system preference. When preference is "system", resolved follows the OS; when "dark" or "light", resolved matches the preference directly.
- **No `dark:` prefix on neutral-replacement tokens**: All neutral color switching happens through CSS custom properties. Components never use `dark:bg-*` for themed neutrals. The exception: non-neutral accent colors used in sparse error/success states (red, green) use `dark:` variants rather than adding semantic tokens for rare one-off states.

## Open Questions

### Resolved During Planning

- **Tailwind v4 integration pattern**: `@theme` (not `inline`) for token registration + `@layer base { .dark { ... } }` for overrides. First-class utilities generated from `--color-*` namespace. `@theme inline` was considered but produces literal values instead of `var()` references, which breaks dark mode switching.
- **Flash prevention in Tauri**: Mirror to `localStorage` on save only, blocking `<script>` in `<head>`. Tauri invoke is async so cannot be used synchronously.
- **xterm.js WebGL repaint**: Auto-handled. Assigning a new theme object triggers `_handleColorChange()` → atlas rebuild → repaint. No `terminal.refresh()` or addon dispose needed.
- **Semantic token vocabulary**: Audit identified 27 semantic tokens across the codebase (expanded from R1's minimum of 14 based on audit of 13 component files). See Unit 1 approach for full list.
- **Terminal settings access**: `terminal_theme` is folded into the new `themeStore` alongside `app_theme`, so the terminal hook can subscribe via selector without needing a separate settings store or prop drilling.

### Deferred to Implementation

- **Exact ANSI color values for terminal light theme**: The xterm.js `ITheme` supports 16 ANSI colors beyond bg/fg/cursor. Good defaults should be chosen during implementation based on the parchment palette.
- **`neutral-400`/`neutral-600` → theme-aware done/exited colors**: Exact hex values for these status indicators in both modes — pick during implementation to ensure they read as "muted/inactive" in both themes.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
┌─────────────────────────────────────────────────────────┐
│  index.html <head>                                      │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Blocking <script>                                 │  │
│  │  1. Read localStorage("seance-theme")             │  │
│  │  2. Read matchMedia("prefers-color-scheme: dark") │  │
│  │  3. Resolve → add/remove .dark on <html>          │  │
│  └───────────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────────────┘
                     │ .dark class present before CSS loads
                     ▼
┌─────────────────────────────────────────────────────────┐
│  index.css                                              │
│  ┌─────────────────────────┐  ┌──────────────────────┐  │
│  │ @theme                    │  │ @layer base          │  │
│  │  --color-bg: #faf6f0     │  │  .dark {             │  │
│  │  --color-surface: ...    │  │    --color-bg: ...   │  │
│  │  --color-text: ...       │  │    --color-surface:  │  │
│  │  (light mode defaults)   │  │    (dark overrides)  │  │
│  └─────────────────────────┘  └──────────────────────┘  │
└────────────────────┬────────────────────────────────────┘
                     │ Utilities like bg-bg, text-text resolve via CSS vars
                     ▼
┌─────────────────────────────────────────────────────────┐
│  React App                                              │
│  ┌──────────────┐  ┌─────────────────────────────────┐  │
│  │ themeStore    │  │ Components                      │  │
│  │ (Zustand)     │  │  Use semantic utilities:        │  │
│  │               │  │  bg-bg, text-text, border-border│  │
│  │ • preference  │  │  (no dark: prefix needed)       │  │
│  │ • resolved    │  │                                 │  │
│  │ • matchMedia  │──┤  Settings: reads/writes pref    │  │
│  │   listener    │  │  Terminal: reads resolved theme  │  │
│  │ • toggles     │  │                                 │  │
│  │   .dark class │  └─────────────────────────────────┘  │
│  │ • mirrors to  │                                      │
│  │   localStorage│                                      │
│  └──────────────┘                                       │
└─────────────────────────────────────────────────────────┘
```

## Implementation Units

- [ ] **Unit 1: CSS theme infrastructure**

**Goal:** Define the complete semantic token vocabulary in `index.css` with Tailwind v4's `@theme` and class-based dark mode switching.

**Requirements:** R1

**Dependencies:** None — foundation for all other units.

**Files:**
- Modify: `src/index.css`

**Approach:**
- Add `@custom-variant dark (&:where(.dark, .dark *));` for class-based dark mode
- Use `@theme` (not `inline`) to register semantic color tokens. `@theme` emits CSS custom properties on `:root` and generates utilities with `var()` references, enabling `.dark` overrides. Light mode values are the defaults. Full token list (27 tokens, expanded from R1's minimum of 14 based on codebase audit):

| Token | Light value | Dark value | Usage |
|---|---|---|---|
| `--color-bg` | `#faf6f0` | `#0f0a14` | Page backgrounds |
| `--color-surface` | `#f3ede4` | `#1a1028` | Cards, modals, inputs |
| `--color-surface-hover` | `#ebe3d6` | `#241838` | Hovered cards/items |
| `--color-surface-active` | `#e3d9ca` | `#2d2044` | Selected items |
| `--color-surface-subtle` | `#f3ede480` | `#1a102880` | Preview areas (50% opacity) |
| `--color-surface-badge` | `#e8dfd4` | `#1a1028` | Badge/pill backgrounds |
| `--color-border` | `#e0d5c7` | `#2d2340` | Separators, outlines |
| `--color-border-input` | `#d4c7b6` | `#3d3358` | Form field borders |
| `--color-border-focus` | `#7c4dba` | `#9b72cf` | Focused input borders |
| `--color-border-hover` | `#c8b9a6` | `#4a3d6a` | Hovered borders |
| `--color-ring-focus` | `#7c4dba` | `#9b72cf` | Focus rings |
| `--color-text` | `#2a1f3d` | `#f0eaf5` | Headings, body text |
| `--color-text-hover` | `#1a1028` | `#ffffff` | Hovered interactive text |
| `--color-text-secondary` | `#6b5e7a` | `#b0a4c4` | Labels, badges, section headings |
| `--color-text-secondary-hover` | `#4d3f60` | `#c8bede` | Hovered secondary text |
| `--color-text-muted` | `#8a7d96` | `#7a6e90` | Descriptions, help text, icons |
| `--color-text-disabled` | `#a89cb4` | `#5a4e6e` | Very low emphasis |
| `--color-text-placeholder` | `#a89cb4` | `#5a4e6e` | Input placeholders |
| `--color-accent` | `#7c4dba` | `#9b72cf` | Primary accent |
| `--color-accent-hover` | `#6a3fa5` | `#b490e0` | Primary accent hover |
| `--color-accent-secondary` | `#8a6820` | `#d4a04a` | Secondary accent (amber) |
| `--color-accent-secondary-hover` | `#705510` | `#e6b85c` | Secondary accent hover |
| `--color-btn-primary-bg` | `#7c4dba` | `#f0eaf5` | Primary button background |
| `--color-btn-primary-text` | `#ffffff` | `#0f0a14` | Primary button text |
| `--color-btn-primary-bg-hover` | `#6a3fa5` | `#ffffff` | Primary button hover |
| `--color-interactive-hover` | `#e8dfd4` | `#241838` | Hovered icon buttons |
| `--color-status-done` | `#8a7d96` | `#7a6e90` | Done status indicator |
| `--color-status-exited` | `#a89cb4` | `#5a4e6e` | Exited status indicator |

- Dark overrides go in `@layer base { .dark { ... } }`
- Keep existing `--animate-pulse-status` and keyframes

**Patterns to follow:**
- Existing `@theme` block in `src/index.css` for animation token

**Test scenarios:**
- Test expectation: none — pure CSS token definitions, verified visually and through downstream units

**Verification:**
- Tailwind generates utilities like `bg-bg`, `text-text`, `border-border` without errors
- Adding/removing `.dark` class on `<html>` switches all token values

---

- [ ] **Unit 2: Flash prevention and initial theme detection**

**Goal:** Ensure the correct theme class is applied before first paint, eliminating flash of wrong theme.

**Requirements:** R10

**Dependencies:** Unit 1 (CSS tokens must exist)

**Files:**
- Modify: `index.html`

**Approach:**
- Add a blocking `<script>` in `<head>` before any CSS or module scripts
- Script reads `localStorage.getItem("seance-theme")` — values: `"system"`, `"dark"`, `"light"`, or `null`
- When value is `"dark"`, add `.dark` to `<html>`
- When value is `"light"`, do not add `.dark`
- When value is `"system"` or `null`, check `matchMedia('(prefers-color-scheme: dark)').matches`
- Also set `document.documentElement.style.colorScheme` to `"dark"` or `"light"` for native scrollbar/form control styling
- Remove hardcoded `bg-neutral-950 text-neutral-100` from `<body>` class, replace with `bg-bg text-text`

**Patterns to follow:**
- Standard Tauri FOUC prevention pattern

**Test scenarios:**
- Happy path: app launches with OS in dark mode, no stored preference → dark theme applied, no flash
- Happy path: app launches with stored preference "light" while OS is dark → light theme applied
- Edge case: `localStorage` unavailable or corrupted → falls back to OS preference detection

**Verification:**
- App starts with correct theme on first paint (no visible flicker)
- Body uses semantic token classes, not hardcoded neutrals

---

- [ ] **Unit 3: Theme store (Zustand)**

**Goal:** Create a centralized store for theme and terminal-theme state that manages preference, system detection, class toggling, and localStorage mirroring.

**Requirements:** R5, R6, R3 (provides terminal_theme access for Unit 7)

**Dependencies:** Unit 1 (CSS tokens), Unit 2 (localStorage key convention)

**Files:**
- Create: `src/stores/themeStore.ts`
- Test: `src/stores/__tests__/themeStore.test.ts`

**Approach:**
- Follow existing Zustand pattern from `appStore.ts` — vanilla `create` with selector hooks
- State: `preference` ("system" | "dark" | "light"), `resolved` ("dark" | "light"), `terminalTheme` ("system" | "dark" | "light")
- Actions: `setPreference(pref)` — updates preference, resolves theme, toggles `.dark` class on `<html>`, sets `document.documentElement.style.colorScheme`. Does NOT mirror to localStorage (that happens only on save — see Unit 5).
- Actions: `setTerminalTheme(theme)` — updates terminalTheme state
- Actions: `initialize(settings)` — called once in the root `App` component on mount (not in Settings.tsx). Receives the full `AppSettings` from Tauri `invoke("get_app_settings")`. Sets preference from `settings.app_theme`, terminalTheme from `settings.terminal_theme`, resolves theme, and mirrors to localStorage. This is the only place localStorage is written during initialization — ensuring it reflects the saved backend value, not a stale preview.
- On initialize: if preference is "system", attach `matchMedia` change listener. Listener calls internal `_resolve()` which recalculates and applies.
- On preference change to/from "system": attach/detach `matchMedia` listener as needed
- Expose `useThemeStore((s) => s.resolved)` for the terminal hook
- Expose `useThemeStore((s) => s.terminalTheme)` for the terminal hook

**Patterns to follow:**
- `src/stores/appStore.ts` — store shape, action pattern, selector usage
- `src/stores/sessionStore.ts` — `getState()` for access outside React

**Test scenarios:**
- Happy path: `setPreference("dark")` → resolved is "dark", `.dark` class on `<html>`
- Happy path: `setPreference("light")` → resolved is "light", no `.dark` class
- Happy path: `setPreference("system")` with OS in dark mode → resolved is "dark", `.dark` class applied
- Integration: OS preference changes while preference is "system" → resolved updates, class toggles
- Edge case: `setPreference("system")` → listener attached; then `setPreference("dark")` → old listener detached
- Edge case: `initialize` called with no saved pref → defaults to "system"

**Verification:**
- Theme store correctly manages `.dark` class lifecycle
- `matchMedia` listener is properly attached/detached (no leaks)
- `terminalTheme` is accessible via selector for the terminal hook

---

- [ ] **Unit 4: Rust backend `app_theme` setting**

**Goal:** Add `app_theme` field to the backend settings struct so the preference persists across restarts.

**Requirements:** R4, R7

**Dependencies:** None (can parallel with Units 1-3)

**Files:**
- Modify: `src-tauri/src/models.rs`

**Approach:**
- Add `app_theme: String` field with `#[serde(default = "default_app_theme")]`
- Add `fn default_app_theme() -> String { "system".to_string() }`
- Update `Default` impl to include `app_theme: default_app_theme()`
- Existing serde deserialization handles migration of old settings files automatically — missing field gets default

**Patterns to follow:**
- Existing `terminal_theme` field pattern in `models.rs` — identical structure

**Test scenarios:**
- Happy path: new settings file — `app_theme` defaults to "system"
- Happy path: existing settings file without `app_theme` — deserializes with default "system"
- Happy path: settings file with `app_theme: "dark"` — deserializes correctly

**Verification:**
- `get_app_settings` returns `app_theme` field
- `update_app_settings` persists `app_theme` to disk
- Old settings files load without error

---

- [ ] **Unit 5: Settings UI — App Theme control**

**Goal:** Add an App Theme toggle to the Settings page and wire it to both the Tauri backend and the theme store. Also wire theme store initialization from the app root.

**Requirements:** R8, R4

**Dependencies:** Unit 3 (theme store), Unit 4 (backend field)

**Files:**
- Modify: `src/components/Settings.tsx`
- Modify: `src/App.tsx` (add theme store initialization on mount)

**Approach:**
- Add `app_theme` to the TypeScript `AppSettings` interface and `DEFAULT_SETTINGS` (value: `"system"`)
- **App.tsx**: Add a `useEffect` on mount that calls `invoke("get_app_settings")` and passes the result to `useThemeStore.getState().initialize(settings)`. This is the single initialization point — it runs before any page component mounts, ensuring the theme store is populated with the backend-persisted values. This also mirrors the correct value to `localStorage`.
- **Settings.tsx**: Add an "App Theme" control above the Terminal Theme section — a segmented button group or radio with System / Dark / Light options
- On value change: update local form state (for save) AND immediately call `useThemeStore.getState().setPreference(value)` for instant preview. Do NOT write to localStorage here — that only happens on save.
- On save: persist to Tauri backend, then mirror to `localStorage("seance-theme")` so the flash-prevention script has the correct value on next launch. Also call `useThemeStore.getState().setTerminalTheme(settings.terminal_theme)` to sync terminal theme.
- Do NOT call `initialize()` in Settings — that is handled by App.tsx on mount.

**Patterns to follow:**
- Existing Terminal Theme `<select>` pattern in `Settings.tsx`
- Existing `useEffect` on mount pattern in `Settings.tsx` for loading settings

**Test scenarios:**
- Happy path: user selects "Dark" → theme switches immediately, saving persists the choice and mirrors to localStorage
- Happy path: user selects "System" → theme follows OS preference
- Happy path: user changes theme but does not save, then relaunches → app loads the previously saved theme (not the unsaved preview), no flash
- Edge case: user changes theme but does not save → theme previews immediately; on page reload, reverts to saved value (localStorage was not updated)
- Integration: App.tsx initialize runs before Settings loads → theme store has correct values from first render

**Verification:**
- App Theme control renders with correct current value
- Changing the control instantly switches the theme
- Saving persists to Tauri backend AND mirrors to localStorage
- Unsaved previews do not leak to localStorage

---

- [ ] **Unit 6: Component migration — replace hardcoded neutral classes**

**Goal:** Replace all ~77 hardcoded `neutral-*` Tailwind classes across 13 component files with semantic token utilities.

**Requirements:** R2

**Dependencies:** Unit 1 (CSS tokens must be defined)

**Files:**
- Modify: `src/components/Terminal.tsx`
- Modify: `src/components/Settings.tsx`
- Modify: `src/components/SessionView.tsx`
- Modify: `src/components/ProjectPicker.tsx`
- Modify: `src/components/ProjectCard.tsx`
- Modify: `src/components/SessionCard.tsx`
- Modify: `src/components/SessionPanel.tsx`
- Modify: `src/components/NewSessionInput.tsx`
- Modify: `src/components/CommandTemplateInput.tsx`
- Modify: `src/components/ProjectSettings.tsx`
- Modify: `src/components/StatusIndicator.tsx`
- Modify: `src/components/AvatarStack.tsx`

**Approach:**
- Complete token mapping (all 27 tokens from Unit 1 → neutral class replacements):

| Old class | New class | Semantic role | Where used |
|---|---|---|---|
| `bg-neutral-950` | `bg-bg` | Page background | All page wrappers, Terminal, index.html body |
| `bg-neutral-900` | `bg-surface` | Card/modal/input bg | ProjectCard, NewSessionInput, ProjectSettings |
| `hover:bg-neutral-800` | `hover:bg-surface-hover` | Hovered card/item | ProjectCard hover |
| `bg-neutral-800` (active) | `bg-surface-active` | Selected item | SessionCard active state |
| `hover:bg-neutral-800/50` | `hover:bg-surface-subtle` | Hovered item (50% opacity) | SessionCard inactive hover, SessionPanel new-session |
| `bg-neutral-800` (badge) | `bg-surface-badge` | Badge/pill bg | ProjectCard session count |
| `border-neutral-800` | `border-border` | Separators, outlines | All components with borders |
| `border-neutral-700` | `border-border-input` | Form field borders | Settings, NewSessionInput, CommandTemplateInput |
| `focus:border-neutral-500` | `focus:border-border-focus` | Focused input border | NewSessionInput |
| `border-neutral-600` (hover) | `border-border-hover` | Hovered dashed border | ProjectPicker add-project |
| `focus:ring-neutral-500` | `focus:ring-ring-focus` | Focus rings | Settings, CommandTemplateInput |
| `text-neutral-100` | `text-text` | Headings, body text | All components |
| `text-neutral-200` (hover) | `text-text-hover` | Hovered interactive text | Settings back btn, ProjectSettings cancel |
| `text-neutral-300` | `text-text-secondary` | Labels, section headings | SessionPanel, CommandTemplateInput, ProjectSettings |
| `text-neutral-400` | `text-text-secondary` | Badge text, secondary labels | ProjectCard badge, CommandTemplateInput |
| `hover:text-neutral-300` | `hover:text-text-secondary-hover` | Hovered secondary text | SessionView, ProjectPicker, SessionCard, SessionPanel |
| `text-neutral-500` | `text-text-muted` | Descriptions, help, icons | All components |
| `text-neutral-600` | `text-text-disabled` | Very low emphasis | ProjectPicker empty, SessionCard last-msg |
| `placeholder-neutral-600` | `placeholder-text-placeholder` | Input placeholders | NewSessionInput, CommandTemplateInput |
| `bg-neutral-100` (btn) | `bg-btn-primary-bg` | Primary action btn bg | Settings save, ProjectSettings save |
| `text-neutral-900` (btn) | `text-btn-primary-text` | Primary btn text | Settings save, ProjectSettings save |
| `hover:bg-white` (btn) | `hover:bg-btn-primary-bg-hover` | Primary btn hover | Settings save, ProjectSettings save |
| `bg-neutral-800` (icon hover) | `bg-interactive-hover` | Hovered icon buttons | SessionView, ProjectPicker, ProjectCard, ProjectSettings |
| `bg-neutral-700` (icon hover) | `bg-interactive-hover` | Hovered icon buttons (variant) | ProjectCard, SessionCard |
| `bg-neutral-800` (input) | `bg-surface` | Form control bg | Settings inputs, CommandTemplateInput |
| `bg-neutral-800/50` (preview) | `bg-surface-subtle` | Preview area | CommandTemplateInput preview |
| `bg-neutral-400` (done) | `bg-status-done` | Done status indicator | StatusIndicator |
| `bg-neutral-600` (exited) | `bg-status-exited` | Exited status indicator | StatusIndicator |
| `border-neutral-900` (avatar) | `border-surface` | Avatar ring border | AvatarStack |

- Leave non-neutral colors unchanged: `red-*`, `green-*`, `amber-*`, `blue-*` (semantic status colors — handled in Unit 9)
- Leave `hover:bg-red-900/50 hover:text-red-400` etc. unchanged for now (handled in Unit 9)

**Execution note:** Execution target: external-delegate — this is a high-volume, pattern-following migration. The complete mapping table above is the authoritative guide.

**Patterns to follow:**
- The semantic token mapping table in Unit 1

**Test scenarios:**
- Test expectation: none — visual migration verified by toggling between dark and light modes and checking every screen (project picker, session view, settings, modals)

**Verification:**
- Zero remaining `neutral-*` classes in component files (search should return 0 matches)
- All screens render correctly in both dark and light mode
- No visual regressions — elements that were previously distinct shades remain distinguishable

---

- [ ] **Unit 7: Terminal theme integration**

**Goal:** Wire the terminal to the app theme so it matches when `terminal_theme` is "system".

**Requirements:** R3

**Dependencies:** Unit 1 (CSS tokens), Unit 3 (theme store — provides both `resolved` and `terminalTheme`)

**Files:**
- Modify: `src/hooks/useTerminal.ts`

**Approach:**
- Subscribe to `useThemeStore((s) => s.resolved)` for the resolved app theme
- Subscribe to `useThemeStore((s) => s.terminalTheme)` for the terminal theme preference (populated by Unit 3's `initialize()` and Unit 5's save handler)
- When `terminalTheme` is "system": derive xterm.js theme from the resolved app theme
- Define dark and light terminal theme objects matching the app palette:
  - Dark: background `#0f0a14`, foreground `#f0eaf5`, cursor `#f0eaf5`, selection `#2d2340`
  - Light: background `#faf6f0`, foreground `#2a1f3d`, cursor `#2a1f3d`, selection `#d4c7b680`
- On resolved theme change: assign a new theme object to `terminal.options.theme` — WebGL addon auto-repaints
- When `terminalTheme` is "dark" or "light": use the corresponding theme object regardless of app theme (existing behavior, now with the new palette colors)

**Patterns to follow:**
- Existing `useTerminal.ts` hook structure — add to the existing `useEffect` or a new one for theme reactivity

**Test scenarios:**
- Happy path: terminal_theme "system" + app theme dark → terminal shows dark palette
- Happy path: terminal_theme "system" + app theme switches to light → terminal live-updates to light palette
- Happy path: terminal_theme "dark" + app theme light → terminal stays dark
- Edge case: theme changes while terminal has scrollback content → existing content repaints with new colors (WebGL auto-handles)

**Verification:**
- Terminal colors match app theme when terminal_theme is "system"
- Switching app theme while terminal is visible produces a smooth color transition
- No WebGL rendering artifacts after theme switch

---

- [ ] **Unit 8: Avatar dark backdrop**

**Goal:** Render session avatar shapes on a consistent dark circular background so vibrant colors work in both modes.

**Requirements:** R9

**Dependencies:** Unit 1 (CSS tokens — for the backdrop color)

**Files:**
- Modify: `src/components/SessionAvatar.tsx`

**Approach:**
- Add a dark circular background behind the avatar SVG shape
- Use the dark mode background color (`#0f0a14`) as the backdrop — this is a branded constant, not a theme-switching token
- The SVG `<circle>` or a CSS `rounded-full` wrapper with the dark background achieves this
- Verify all 16 avatar palette colors meet 3:1 contrast against `#0f0a14` (they were designed for `#0a0a0a` which is nearly identical — should pass)
- Update `AvatarStack.tsx` border color to use semantic `border-surface` token to match the card background in both modes

**Patterns to follow:**
- Existing SVG rendering pattern in `SessionAvatar.tsx`

**Test scenarios:**
- Happy path: avatar renders with dark circular backdrop in dark mode
- Happy path: avatar renders with dark circular backdrop in light mode — shape is clearly visible against parchment
- Edge case: all 16 palette colors verified legible against backdrop

**Verification:**
- Avatars look consistent across both modes
- Vibrant colors remain saturated and legible

---

- [ ] **Unit 9: Error toast and accent color theming**

**Goal:** Ensure error toasts, success messages, and destructive hover states work correctly in both themes.

**Requirements:** R1 (complete token coverage)

**Dependencies:** Unit 1 (CSS tokens), Unit 6 (component migration)

**Files:**
- Modify: `src/components/Terminal.tsx` (error toast)
- Modify: `src/components/SessionCard.tsx` (destructive hover states)

**Approach:**
- Use Tailwind's `dark:` variant for these sparse non-neutral colors (consistent with the decision to only use semantic tokens for neutrals; adding error/success tokens would be over-engineering for 3-4 one-off usages):
- `Terminal.tsx` error toast: light mode `bg-red-100/80 text-red-800`, dark mode `dark:bg-red-900/80 dark:text-red-200`
- `SessionCard.tsx` delete hover: light mode `hover:bg-red-100/50 hover:text-red-700`, dark mode `dark:hover:bg-red-900/50 dark:hover:text-red-400`
- Success text (`text-green-400` in Settings): light mode `text-green-700`, dark mode `dark:text-green-400` — verify legibility on parchment background

**Patterns to follow:**
- `dark:` variant for sparse non-neutral accent states (consistent with Key Technical Decisions)

**Test scenarios:**
- Happy path: error toast readable in both dark and light mode
- Happy path: delete hover state visible in both modes
- Happy path: success text ("Settings saved") legible on parchment background

**Verification:**
- All error/success/destructive states meet WCAG AA contrast in both modes

## System-Wide Impact

- **Interaction graph:** Theme store → `<html>` class toggle → CSS custom properties → all components. Theme store → terminal hook → xterm.js theme. Settings save → Tauri backend + localStorage mirror. App.tsx mount → theme store initialize (reads Tauri backend, mirrors to localStorage).
- **Error propagation:** If theme store fails to initialize, the blocking `<script>` in `<head>` provides a fallback (reads localStorage + matchMedia directly). Components degrade gracefully since CSS vars have default values in `@theme`.
- **State lifecycle risks:** Theme preference lives in three places: Tauri backend (persistent, written on save), localStorage (mirror, written on save + initialize), Zustand store (runtime, written on preview + initialize). The store is authoritative at runtime; localStorage is a read-only bootstrap cache updated only on save/initialize; Tauri backend is the durable store. Unsaved previews do not leak to localStorage, preventing flash-on-relaunch bugs.
- **API surface parity:** The `get_app_settings` / `update_app_settings` IPC commands gain a new `app_theme` field. No other API surfaces affected.
- **Unchanged invariants:** Session management, PTY streaming, project CRUD, and hook server are entirely unaffected. Status indicators for running/thinking/waiting/error retain their existing colors.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Tailwind v4 `@theme` opacity modifiers (`bg-bg/50`) may not compose with `var()` references in older WebViews | Test opacity modifiers early in Unit 1. Modern browsers use `color-mix()` with `var()` correctly; the `@supports` fallback uses literal values. Tauri's WebKit should support this, but verify. |
| Component migration (Unit 6) introduces visual regressions | Toggle dark/light on every screen after migration. Use the semantic token audit as a checklist. |
| Terminal WebGL theme switch causes brief flicker | xterm.js source confirms auto-repaint. If flicker occurs, add a brief CSS transition on the terminal container. |
| localStorage and Tauri settings diverge | localStorage is only written on save (not preview), so they stay in sync. On first launch after update, localStorage has no value → blocking script falls back to system preference (correct default). App.tsx initialization then mirrors the backend value to localStorage. |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-05-color-scheme-requirements.md](docs/brainstorms/2026-04-05-color-scheme-requirements.md)
- **Tailwind v4 dark mode docs:** tailwindcss.com/docs/dark-mode
- **Tailwind v4 theme variables:** tailwindcss.com/docs/theme
- **xterm.js ITheme interface:** xtermjs.org/docs/api/terminal/interfaces/itheme/
- **Institutional learning:** `docs/solutions/integration-issues/tauri-frontend-backend-field-naming-mismatches-2026-04-05.md` — snake_case IPC contract
- **Institutional learning:** `docs/solutions/best-practices/tauri-v2-pty-streaming-architecture-2026-04-05.md` — Tailwind v4 CSS-first config
