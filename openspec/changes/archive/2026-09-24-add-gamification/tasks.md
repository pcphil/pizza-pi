## 1. Quest tracker skill & storage

- [x] 1.1 Define `tasks.json` schema: `{ id, description, size, status, createdAt, completedAt? }`
- [x] 1.2 Add pi-agent skill (`skills/quest-tracker/`, a *global* skill since this repo root is `~/.pi/agent`) that creates a quest from an explicit user instruction
- [x] 1.3 Add skill command to mark a quest done from an explicit user instruction
- [x] 1.4 Add skill command to list active/completed quests for the current project
- [x] 1.5 Implement centralized, path-keyed storage for `tasks.json` under the pi agent config root (mirroring `sessions/`'s keying)

## 2. XP/rank engine

- [x] 2.1 Define global XP state schema: `{ totalXp, streak: { count, lastDate } }` (rank is derived from `totalXp`, not stored) at `~/.pi/agent/progression/xp-state.json` (quests live alongside under `progression/quests/`)
- [x] 2.2 Implement read/write helpers for the global XP store (plain `fs` JSON, no built-in KV API available)
- [x] 2.3 Define size-tier → XP mapping (small/medium/large) and rank name/threshold table
- [x] 2.4 Wire quest completion (detected via successful `quest.js done` bash call whose output confirms a real status transition) to award tiered XP
- [x] 2.5 Add `tool_result` listener detecting a successful `git commit` (bash or powershell) and awarding minor commit XP
- [x] 2.6 Add `session_start` listener implementing once-per-calendar-day streak increment/reset and minor streak XP

## 3. Display & celebration

- [x] 3.1 Add `ctx.ui.setStatus` readout for XP/rank/streak, updated whenever XP state changes
- [x] 3.2 Add on-demand `ctx.ui.setWidget` view of the active quest list (toggled via new `/quests` command)
- [x] 3.3 Add celebratory entry (via `registerEntryRenderer`, following `sir-peppy-banner.ts`'s pattern) on rank change
- [x] 3.4 Add celebratory entry on quest completion

## 4. Extension wiring

- [x] 4.1 Create new extension file(s) in `extensions/` implementing the above (`extensions/xp-bar.ts`)
- [x] 4.2 Verify no interference with the existing `sir-peppy-banner.ts` session_start hook / entry renderer registration (distinct event-handler slots, distinct `registerEntryRenderer` customType keys — pi supports multiple handlers per event)
