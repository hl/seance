---
date: 2026-04-05
topic: e2e-missing-flows
---

# E2E Missing User Flows

## Problem Frame

19 Playwright tests exist but only cover session creation, switching, navigation, and slug validation. Critical user flows — kill, restart, project CRUD, settings save, status transitions, name updates, multi-project — have zero E2E coverage.

## Requirements

**Session Lifecycle**
- R1. Kill session: click kill button on a running session card → status changes to "exited", kill button disappears, restart button appears
- R2. Restart session: click restart button on an exited session → status changes to "running", terminal reactivates

**Project CRUD**
- R3. Add project: click "+ Add Project" → mock file picker returns path → project settings modal opens → save template → project card appears in picker
- R4. Remove project: click remove button on project card → confirmation prompt → project disappears from list

**Settings**
- R5. Global settings save: open settings → change hook port and font size → save → reopen settings → values persisted
- R6. Project settings save: open project settings from session view header → edit command template → save → reopen → template persisted

**Status Transitions via Events**
- R7. Status transitions: emit mock status events (running→thinking→waiting→done→error) → session card status indicator updates for each state
- R8. Session name update: emit mock name-updated event → session card name changes from placeholder to the new name

**Multi-Project**
- R9. Multiple projects: create two projects → create sessions in each → navigate between them → each project shows only its own sessions

## Success Criteria
- All 9 flows pass as Playwright tests using MockBackend
- Total Playwright count increases from 19 to ~28

## Scope Boundaries
- No real PTY or backend — all via MockBackend
- No visual regression screenshots
- No Channel streaming simulation

## Next Steps
→ Proceed directly to work
