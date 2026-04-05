---
date: 2026-04-05
topic: e2e-test-suite
focus: comprehensive E2E test suite with Playwright
---

# Ideation: Comprehensive E2E Test Suite with Playwright

## Codebase Context

Séance is a Tauri v2 + React 19 desktop app for orchestrating AI coding agent sessions. Current test suite: 72 Rust tests, 12 vitest, 20 Playwright E2E. The E2E layer mocks Tauri APIs via `__TAURI_INTERNALS__` interception. The biggest production bug was a frontend-backend contract mismatch (missing `sessions` array) that E2E mocks didn't catch because mocks were hand-crafted to match frontend expectations, not backend reality.

Coverage gaps: terminal I/O, session kill/restart, settings workflow, project CRUD, error paths, status transitions (only running/exited tested of 6 states), multi-window behavior, Channel streaming.

## Ranked Ideas

### 1. Typed Mock Backend from Rust Types
**Description:** Generate TypeScript types and a stateful mock factory from Rust command definitions. Replace scattered inline mocks with a reusable, type-safe backend simulator that tracks sessions, projects, and settings.
**Rationale:** Eliminates contract drift — the #1 bug class. Every future test benefits from correct types and stateful behavior.
**Downsides:** Requires a codegen step or manual type maintenance. Adds build complexity.
**Confidence:** 90%
**Complexity:** Medium
**Status:** Explored (brainstormed 2026-04-05)

### 2. Terminal Output Verification
**Description:** Mock `subscribe_output` to emit realistic PTY sequences (ANSI codes, multi-chunk). Assert terminal content renders correctly via xterm.js DOM inspection.
**Rationale:** The app's core value is terminal interaction — zero tests verify this.
**Downsides:** xterm.js renders to canvas/WebGL, making content assertion tricky. May need DOM renderer fallback for tests.
**Confidence:** 80%
**Complexity:** Medium
**Status:** Unexplored

### 3. Session Status Transitions
**Description:** Simulate all 6 status states (running, thinking, waiting, done, error, exited) via mock hook events. Verify StatusIndicator colors/animations and session card updates.
**Rationale:** Status is the primary user feedback loop. Only 2 of 6 states are ever tested.
**Downsides:** Requires mock event emission infrastructure (transformCallback invocation).
**Confidence:** 85%
**Complexity:** Low
**Status:** Unexplored

### 4. Kill/Restart + Error Paths
**Description:** Test session kill→exited UI, restart→running recovery, plus error scenarios: spawn failure, invalid project, empty template.
**Rationale:** Only 1 of 20 current tests is an error path. Production bugs live in error handling.
**Downsides:** Error mocks need careful setup to avoid false positives.
**Confidence:** 85%
**Complexity:** Low
**Status:** Unexplored

### 5. Project CRUD & Settings
**Description:** Test add project (file picker mock), remove with confirmation dialog, settings save/reload.
**Rationale:** Common user flows with zero E2E coverage.
**Downsides:** File picker mocking requires intercepting Tauri plugin commands.
**Confidence:** 80%
**Complexity:** Low
**Status:** Unexplored

### 6. Visual Regression Screenshots
**Description:** Add Playwright `toHaveScreenshot()` for terminal rendering, status indicators, and avatar stacks.
**Rationale:** Catches CSS/layout regressions that DOM assertions miss. Low effort, high signal.
**Downsides:** Screenshot diffs can be flaky across OS/font versions. Needs baseline management.
**Confidence:** 75%
**Complexity:** Low
**Status:** Unexplored

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 1 | Test in real Tauri webview | Too expensive — requires full app build per test, immature tooling |
| 2 | Auto-generate tests from prop types | Shallow parametric tests, not meaningful E2E flows |
| 3 | CI diff of real backend vs mocks | Complex infra for marginal gain over contract generation |
| 4 | Cross-test state snapshot/restore | Over-engineered — stateful factory solves this more simply |
| 5 | Fixture factories with faker | Randomization adds flakiness; static fixtures sufficient for E2E |
| 6 | Command metadata registry | Subsumed by contract-first mock generation |
| 7 | Race condition detection in mocks | Too speculative — real races need real async |
| 8 | HTTP mock server replacing addInitScript | Major refactor for unclear gain |

## Session Log
- 2026-04-05: Initial ideation — 30+ candidates generated across 4 frames (pain/friction, missing capabilities, inversion/automation, leverage/compounding), 22 unique after dedupe, 6 survivors after adversarial filtering. Idea #1 selected for brainstorming.
