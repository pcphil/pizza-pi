## Why

Sir Peppy's persona is currently pure flavor (a session-start banner) with no feedback loop tied to real work. Two capabilities for exactly this — `quest-tracker` and `xp-bar` — already exist as dormant, empty spec directories, and two prior changes (`archive/2026-09-08-add-quest-system`, `archive/2026-09-08-add-experience-bar`) were archived without ever landing content. This proposal fills both in for real, based on a full design pass with the user (see `design.md`).

## What Changes

- A skill-managed, freeform quest list (`tasks.json`, per-project, size-tagged small/medium/large) that the user explicitly creates and completes quests in — the agent never auto-creates or auto-completes one.
- An XP/rank system, persisted globally (not per-project), that awards XP from three sources: quest completion (dominant), successful `git commit` (minor), and a daily session-start streak (minor, resets if a day is skipped).
- Display via an always-on footer status line (XP/rank/streak) plus an on-demand widget (active quest list), and a one-off Sir-Peppy-voiced celebration entry on level-up or quest completion.

## Capabilities

### New Capabilities
- `quest-tracker`: freeform, skill-managed, per-project quest list with explicit create/complete lifecycle and size tags.
- `xp-bar`: cumulative XP + knight-rank system fed by quest completions, commit successes, and session streaks, with status-line/widget display and celebration entries.

### Modified Capabilities
(none — both spec directories exist but are currently empty, so this is new spec content, not a delta to existing requirements)

## Impact

- New skill at `skills/quest-tracker/` — a *global* pi-agent skill (this repo root is `~/.pi/agent`, the fixed global skills location per pi's skill discovery rules) that reads/writes `tasks.json`, so it's available in every project, not just this one.
- New extension(s) in `extensions/`, following the `sir-peppy-banner.ts` pattern (`ExtensionAPI`, `pi.on(...)`, `pi.registerEntryRenderer`), adding: `session_start` (streak), `tool_result` (commit-success detection via `isBashToolResult`), `ctx.ui.setStatus`/`ctx.ui.setWidget` (display).
- New local state files under this pi-agent config root (gitignored, alongside `settings.json`/`auth.json`): one global XP/rank/streak store, and a `sessions/`-style per-project-path-keyed store for each project's `tasks.json` — neither is written into the user's actual project repos.
- No change to `sir-peppy-banner.ts` itself; its entry-renderer pattern is reused for celebrations.
