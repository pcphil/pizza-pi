## Context

This repo is the pi coding agent's own config root (persona, extensions, model registry), not an application. `AGENTS.md` already claims a knightly, gamified feel and a "second brain" role, but nothing currently tracks real work. `openspec/specs/quest-tracker/` and `openspec/specs/xp-bar/` exist as empty placeholders from two prior, never-completed changes. This design was reached via a full grilling session with the user (21 questions, all resolved) rather than assumed.

Research into `@earendil-works/pi-coding-agent`'s `ExtensionAPI` (docs/extensions.md) found:
- No todo/task-lifecycle hook exists — ruled out "todo completed → XP" as a source.
- `tool_result` fires after any tool call and, via `isBashToolResult`, exposes exit code + command text — this is how commit-success detection works.
- No built-in cross-session KV store; `pi.appendEntry` is scoped to one session's file. Global state needs the extension to roll its own `fs` JSON store.
- `ctx.ui.setStatus(id, text)` and `ctx.ui.setWidget(id, lines[])` exist for persistent TUI surfaces, distinct from the one-off `registerEntryRenderer` pattern `sir-peppy-banner.ts` uses for the startup banner.

## Goals / Non-Goals

**Goals:**
- Tie XP/quests to real, verifiable signals (explicit user action, or a bash exit code), not vibes.
- Keep quest authorship and completion entirely user-driven — no agent self-grading.
- Make XP an identity stat that persists across every project, not reset per repo.
- Reuse existing extension patterns (`sir-peppy-banner.ts`) rather than inventing new plumbing where avoidable.

**Non-Goals:**
- Test-pass detection as an XP source (v1). Would require hardcoding test-runner command patterns (`npm test`, `cargo test`, `pytest`, `vitest run`, `go test`, ...) across arbitrary project types; deferred until quest-completion + commit-success prove the mechanic is worth the added maintenance surface.
- Anti-farming / dedupe on commit XP (e.g. by commit SHA). This is a single-player system for the user's own benefit; farming only hurts the person doing it.
- Agent-authored or agent-completed quests. Explicitly out of scope to keep quest completion a meaningful signal.
- Cross-repo/team sharing of any kind (no relation to OpenSpec's own multi-repo "Stores" feature).

## Decisions

1. **Quests are freeform, not derived from OpenSpec changes.** A skill manages a JSON task list; task content is whatever the user describes, not tied to `openspec/changes/`.
2. **Quest storage is per-project but centralized**, keyed by project path under this pi-agent config root — same convention `sessions/` already uses (`sessions/--C--Users-chung-projects-<name>--`) — so no file is ever written into the user's actual project repo.
3. **XP/rank/streak storage is global** (one store, not per-project) — reasoning: the agent/persona is one continuous identity across projects (per `AGENTS.md`'s "second brain" framing).
4. **XP sources for v1, weighted so quest completion dominates:**
   - Quest completion — size-tiered (small/medium/large → increasing XP), primary source.
   - Successful `git commit` (bash exit code 0, command text matches `git commit`) — minor.
   - Daily session-start streak (first `session_start` per calendar day increments a streak counter; a skipped day resets it) — minor.
5. **Lifecycle is explicit-only both directions**: quests are created only by direct user instruction to the skill, and completed only by direct user instruction — never inferred or auto-marked by the agent.
6. **Display is two-tier**: `ctx.ui.setStatus` for an always-on compact readout (XP, rank, streak), `ctx.ui.setWidget` for the active quest list, shown on demand rather than permanently — avoids crowding the TUI.
7. **Celebrations are one-off entries** (reusing the `registerEntryRenderer` pattern from `sir-peppy-banner.ts`) fired on level-up and on quest completion, in Sir Peppy's voice — this is deliberately the one place flavor is load-bearing, since the payoff moment is the point of gamifying at all.
8. Exact XP values per size tier, rank thresholds, and rank names are left to implementation/`tasks.md` rather than fixed here — tunable, not architectural.

## Risks / Trade-offs

- **Global XP + per-project quests is an asymmetric persistence model.** Accepted deliberately (see Decision 3) — the alternative (either fully global or fully per-project) was judged to misrepresent one of the two concepts.
- **No anti-farming means a user could inflate commit-XP trivially.** Accepted (Non-Goals) since there's no second party to mislead.
- **Dropping test-pass detection means one of the three originally-considered passive sources never ships in v1.** Revisit only if usage shows quest-completion + commit-success isn't enough signal.
- **Rolling a custom `fs`-based JSON store** (no built-in KV API) means the extension owns read/write/corruption handling itself — keep the schema minimal to limit this surface.
