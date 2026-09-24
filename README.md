# pizza-pi

A custom template/config for the [pi coding agent](https://pi.dev) (`@earendil-works/pi-coding-agent` + `@earendil-works/pi-tui`). This directory is pi's global config root (`~/.pi/agent`), so everything here applies to every project.

## Features

### Sir Peppy persona
`AGENTS.md` defines the agent persona and operating rules: it guides and explains rather than jumping straight to edits, works one confirmed step at a time, and asks before destructive actions. It runs against local models (LM Studio) as well as cloud providers.

### Session banner
`extensions/sir-peppy-banner.ts` renders an ASCII banner at the start of each session.

### XP bar and ranks
`extensions/xp-bar.ts` adds a gamified status line: `⚔ Rank ▰▰▱▱ 12/50 · 30 XP · 🔥3 · ⚑ Quest title`.

- **Global progress:** XP, rank and streak are shared across every project.
- **XP sources:**
  - completing a quest-tracker quest: 10 / 25 / 50 XP for small / medium / large
  - resolving a prompt quest: 15 XP
  - a successful `git commit`: 3 XP
  - the first session of each day: 5 XP
- **Ranks:** Squire → Knight-Errant → Knight → Knight-Captain → Knight-Commander → Paladin.
- **Streak:** a daily streak that resets if a day is skipped.
- **Celebrations:** Sir-Peppy-voiced entries on rank-ups, quest starts, and quest completions.
- **`/quests`:** toggles a widget listing the project's active quests.

### Prompt quests
When you ask the agent to do something (fix, add, refactor, edit, read a file, and so on), a quest starts automatically and shows in the status line after the streak. Questions and simple Q&A do not start one.

- **Fun titles:** the quest starts with a plain name derived from your prompt, then the model swaps in a playful knightly title by calling the `name_quest` tool.
- **Confirmation:** when a turn ends with a quest active, Sir Peppy asks whether it is resolved. Reply "yes", or say something like "that's resolved" or "it works", to clear it and earn XP.
- **Persistence:** the quest stays active across turns and follow-up prompts, and is dropped on a new session. It is held in memory only.

### Quest tracker skill
`skills/quest-tracker/` manages a per-project list of size-tagged quests (small / medium / large). Quests are created and completed only when you explicitly ask. Completing one is the main XP source. Data lives in `progression/quests/`, keyed by project path, so nothing is written into your repos.

### OpenSpec workflow
Larger features go through spec-driven changes in `openspec/`: propose, apply, archive (via the `opsx:*` commands). Current live specs are in `openspec/specs/` (`xp-bar`, `quest-tracker`).

## Layout

| Path | Purpose |
|---|---|
| `extensions/` | pi TUI extensions (banner, XP bar) |
| `skills/` | Global pi skills (quest-tracker) |
| `openspec/` | Change proposals, archived changes, live specs |
| `progression/` | Local XP and quest state (gitignored) |
| `sessions/` | Per-project session transcripts (gitignored) |
| `models-store.json`, `auth.json`, `settings.json` | Local runtime config (gitignored) |
