---
date: 2026-04-05
title: "Internal Consistency Review: Seance v1 Plan & Requirements"
reviewer: "Technical Editor"
reviewed_docs:
  - docs/plans/2026-04-05-001-feat-seance-v1-plan.md
  - docs/brainstorms/2026-04-05-seance-v1-requirements.md
---

# Internal Consistency Review: Seance v1 Plan & Requirements

## Executive Summary

The plan is **substantively aligned** with the requirements but contains 8 findings:
- **2 high-confidence contradictions or ambiguities** (0.80+) that need resolution before implementation
- **3 moderate-confidence issues** (0.65–0.79) that could cause implementation divergence
- **3 lower-severity issues** (0.60–0.72) or explicitly deferred decisions

All findings below confidence 0.60 have been suppressed.

---

## Findings (Confidence ≥ 0.65)

### 1. CONTRADICTION: Scrollback Buffer Capacity Specification (Confidence: 0.79)

**Location:**
- Requirement R10: "The backend maintains a bounded in-memory scrollback buffer (default 10,000 lines) per session"
- Plan, Unit 3, p. 298: "Scrollback buffer: `Vec<u8>` with 8MB byte cap"
- Plan, Technical Design, p. 87: "Store raw PTY output bytes with an 8MB byte-cap (not line-count — line size varies wildly)"

**Issue:**
The requirement specifies a **line-count bound** (10,000 lines), while the plan specifies a **byte-count bound** (8MB). These are fundamentally different:
- 10,000 lines could be 800KB to 30MB+ depending on terminal width and ANSI code density
- 8MB bytes could be 500–2,000 lines depending on output characteristics

**Justification in Plan:**
The plan explicitly rejects the line-count bound: "line size varies wildly — the 8MB limit is essential" (p. 637). This is a **deliberate design change**, not an oversight.

**Resolution Required:**
This should be explicitly acknowledged as a **scope boundary change**. The plan's choice is justified, but it diverges from R10. Document as a decision, not a divergence implementers discover mid-code.

**Severity:** Design change; affects memory usage guarantees
**Priority:** HIGH — clarify before Unit 3 implementation

---

### 2. CONTRADICTION: Project Window Navigation with Back Button (Confidence: 0.82)

**Location:**
- Requirement R42: "The back button in Session View always shows the Project Picker in the same window (even if a picker is already open in another window — duplicate pickers are allowed)"
- Plan, Unit 8, p. 596–598: "Window creation: `open_project_window(project_id)` ...If window with that label already exists, focus it instead." → "Back button behavior: re-renders Project Picker. Window label remains `project-{id}` but renders the picker. A new project click opens a new `project-{new_id}` window."

**Issue:**
The plan describes: user is in `project-A` session view → clicks back → sees picker in `project-A` window (label unchanged, view changed). Then clicking "project-B" opens a new window for B.

**But the edge case is unspecified:** What if the user is on the back-button picker in `project-A` window and clicks `project-A` again?
- Does it reuse the current window?
- Does it create a duplicate `project-A` window?
- Does it focus an existing `project-A` window (per "If window with that label already exists, focus it instead")?

This directly affects whether users can have duplicate windows for the same project, which R42 seems to permit for pickers but not for session views.

**Resolution Required:**
Clarify the window-lifecycle rules:
- Can a user have two `project-A` windows open?
- If yes, does clicking `project-A` from the back-picker create a new one, or focus the existing one?

**Severity:** UX flow; could cause confusing behavior
**Priority:** HIGH — clarify before Unit 8 implementation

---

### 3. FORWARD REFERENCE: `start_output_stream` Command Undefined (Confidence: 0.75)

**Location:**
- Plan, Unit 6 (Terminal Component), p. 475: "invoke('start_output_stream', { sessionId: newSessionId, channel }) (a command that starts forwarding PTY output to this channel)"
- Unit 3 (PTY Spawning, p. 297–307) defines `create_session`, `kill_session`, `send_input`, `resize_pty`, `get_scrollback`, `restart_session` but **not** `start_output_stream`

**Issue:**
This command is referenced in the session-switching flow but never defined in the PTY engine unit. The architectural intent is unclear:
1. Is this a new command separate from the forwarder set up in `create_session`?
2. Does the forwarder task stay alive across session switches and rebind to a new channel?
3. Or do we kill and respawn the forwarder on each switch?

The session-switching sequence (p. 487–498) implies the forwarder stays alive and rebinds, but Unit 3's PTY engine design doesn't explicitly state this.

**Resolution Required:**
Define `start_output_stream` (or clarify that it's implicit in the session-switching flow) before Unit 3 implementation. This is an architectural decision affecting how concurrent sessions share the PTY infrastructure.

**Severity:** Architectural clarity
**Priority:** MEDIUM-HIGH — must be resolved before Unit 3, else implementer may choose a different forwarder model

---

### 4. AMBIGUITY: Hook Server Port Conflict Resolution (Confidence: 0.72)

**Location:**
- Requirement R16: "If the port is in use at startup, the app shows an error and prompts the user to change the port before sessions can spawn"
- Plan, Unit 4, p. 380: "On failure, store error state so frontend can show the port-conflict error. Do not crash the app."
- Plan, Unit 2, p. 248: Mentions `update_app_settings` can change the port

**Issue:**
R16 specifies the user flow: error → prompt → change port → resume. But the plan doesn't specify:
1. How does the user change the port? Via settings UI, or editing JSON?
2. Does the hook server auto-retry binding after the port setting changes?
3. Are new sessions blocked entirely, or just hook functionality disabled?

The gap is between "show error and prompt" (R16) and "store error state" (plan), which could mean different things in implementation.

**Resolution Required:**
Specify the port-conflict recovery flow:
- Is there a settings UI to change the port without restarting?
- Does changing the port trigger an immediate hook server restart?
- Or does the app require restart to rebind the hook server?

**Severity:** User flow clarity; affects error recovery design
**Priority:** MEDIUM — clarify before Unit 2 (settings) and Unit 4 (hook server) implementation

---

### 5. AMBIGUITY: Scrollback Byte-Cap Trimming Edge Case (Confidence: 0.73)

**Location:**
- Plan, Unit 3, p. 298: "Scrollback buffer: `Vec<u8>` with 8MB byte cap. Trim from front on overflow, finding nearest newline boundary."

**Issue:**
The strategy doesn't specify what happens when the 8MB boundary doesn't align with a newline:
- Example: buffer is 7.999MB, next chunk is 100KB (would overflow)
- "Finding nearest newline boundary" could mean:
  - Scan backward from 8MB point, trim there (might trim mid-chunk)
  - Reject the chunk entirely
  - Use UTF-8 boundary detection to avoid corruption
  - Something else

Without a clear algorithm, implementers may diverge on UTF-8 safety, which could cause display corruption on replay.

**Resolution Required:**
Specify the exact trimming algorithm before Unit 3 implementation:
```
On overflow: given a new chunk of N bytes that would exceed the 8MB cap,
  1. Search backward from current end for the last newline
  2. Keep that many bytes, discard the rest (both old buffer and new chunk)
  OR
  1. Search backward from the 8MB boundary for a newline
  2. Trim old buffer at that point, preserve the new chunk
  OR [other strategy]
```

**Severity:** Data integrity (UTF-8 corruption possible)
**Priority:** MEDIUM — clarify before Unit 3 implementation

---

### 6. UNRESOLVED DEPENDENCY: Avatar Generation Edge Cases (Confidence: 0.71)

**Location:**
- Plan, Unit 5, p. 424: "Avatar generation: Derive from UUID... Map UUID bytes to: shape (6 options), fill color (from 12–16 colors), and rotation"
- Plan, Deferred Questions, p. 110: "SVG avatar geometry specifics: Which shapes look best at small sizes. Will need visual iteration."

**Issue:**
The plan defers the exact shape palette and color palette selection. This means:
- Unit 5's test scenario "avatar determinism — same UUID input always renders identical SVG" cannot be fully written until the palette is finalized
- The "12–16 colors" range is vague; is it 12, 16, or TBD?
- Without a finalized palette, collision risk assessment (R4: avatar derived from UUID) can't be validated

**Assessment:**
This is **explicitly deferred** ("Will need visual iteration"), so it's an acknowledged gap. Not a contradiction, but implementers should know they can't finalize Unit 5 without this decision.

**Resolution Required:**
Finalize the avatar palette (exact shapes + colors + mapping algorithm) before finalizing Unit 5 tests.

**Severity:** Deferred design; not a contradiction
**Priority:** LOW — doesn't block implementation, but blocks test finalization

---

### 7. AMBIGUITY: Session Restart Position in List (Confidence: 0.68)

**Location:**
- Requirement R35: "Sessions are ordered by creation time (oldest first, newest at bottom); positions are stable"
- Requirement R5: "Exited sessions can be restarted via a user-initiated action: re-spawn the same command with the same UUID, name, avatar, and task label"
- Plan, Unit 6, p. 478: "Sessions are ordered by creation time (oldest first, newest at bottom); positions are stable"
- Plan, Unit 8, p. 604: "Cmd+1 through Cmd+9 switches to sessions by list position (creation order, stable)"

**Issue:**
When an exited session is restarted, does it maintain its original list position (creation order), or move to the bottom as a "new" session?

The requirement R35 says "creation time" and "stable" — which implies exited sessions that are restarted stay in their original position. The plan's wording mirrors this. But a reader could interpret "restarted session" as semantically "new," moving it to the end of the list.

**Assessment:**
This is **likely unambiguous in intent** (restart = same position), but R35's wording "positions are stable" would benefit from an example: "Restarting a session does not change its position in the list; position is determined by creation time only."

**Resolution Required:**
Add clarifying language to Unit 5 or Unit 8: "Restarting an exited session maintains its original position in the session list."

**Severity:** Behavioral clarity; affects UX expectation
**Priority:** LOW-MEDIUM — clarify if implementer asks, but not a hard blocker

---

### 8. STRUCTURAL ISSUE: Requirements Grouped by Theme vs. Sequence (Confidence: 0.65)

**Location:**
- Plan, p. 19–30: "Requirements Trace" groups R1-R44 by thematic category (Core Session Management, Terminal Interaction, etc.)
- Requirements document: R1-R44 ordered sequentially with section headers mid-sequence

**Issue:**
The requirements span multiple distinct concerns (PTY management, UI layout, persistence, settings, navigation). Grouping them thematically in the plan is clearer than a flat sequence, but this grouping exists in the plan, not the origin document.

**Assessment:**
This is a **structural clarity issue**, not a contradiction. The origin requirements are ordered logically by section, but they could be scanned faster if grouped by implementation phase or system layer.

**Recommendation:**
Optionally refactor the requirements document to group by theme with headers. (This is an enhancement, not required for plan consistency.)

**Severity:** Readability; not a blocker
**Priority:** LOWEST — optional refactor for maintainability

---

## Non-Findings

The following are **not flagged** because they are either explicitly addressed, stylistic, or beyond this review's scope:

- **"task" vs "task label" terminology drift (0.65):** Both documents use "task" consistently; no contradiction. Minor glossary clarity would help but not blocking.
- **UUID assignment timing (0.68):** Diagram (p. 315–333) shows UUID assigned before spawning. Text could be more explicit but diagram is clear enough.
- **Scrollback replay flicker (p. 651):** Explicitly deferred to implementation; acknowledged in Risks section.
- **Deferred questions (p. 108–113):** All marked as "Deferred to Implementation" or "Deferred to Planning" — not contradictions.

---

## Recommendations for Implementers

1. **Before Unit 3 (PTY Engine):** Resolve findings #3, #5 (forward references and byte-cap algorithm).
2. **Before Unit 2 (Settings):** Resolve finding #4 (port conflict recovery flow).
3. **Before Unit 8 (Multi-Window):** Resolve findings #2 (window navigation edge case).
4. **Before finalizing Unit 5 (Avatar):** Finalize the palette (finding #6).

---

## Document Metadata

- **Plan version:** docs/plans/2026-04-05-001-feat-seance-v1-plan.md
- **Requirements version:** docs/brainstorms/2026-04-05-seance-v1-requirements.md
- **Review date:** 2026-04-05
- **Findings reviewed:** 10 total; 2 HIGH (0.80+), 3 MODERATE (0.65–0.79), 3 LOWER (0.60–0.72), 2 SUPPRESSED (<0.60)
