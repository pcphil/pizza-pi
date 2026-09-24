---
name: quest-tracker
description: Creates, completes, and lists freeform quests (size-tagged small/medium/large tasks) in this project's quest list, feeding the xp-bar gamification system. Use only when the user explicitly asks to add a quest, mark a quest done, or list quests.
---

# Quest Tracker

Manages this project's quest list: a JSON file of user-described tasks, stored centrally under `~/.pi/agent/progression/quests/` and keyed by this project's absolute path (same escaping convention as `sessions/`), so nothing is written into the project's own repo. Completing a quest is the primary XP source for the `xp-bar` system (see `openspec/specs/xp-bar/`); XP is awarded by that system when it observes a quest's status flip to `done`, not by this skill.

**Explicit-only, both directions.** Add a quest only when the user directly asks for one. Mark a quest done only when the user directly says to. Never create or complete a quest because you inferred it from a TODO comment or from finishing related work — at most, suggest it and let the user confirm.

## Add a quest

```bash
node scripts/quest.js add "<description>" --size <small|medium|large>
```

## Mark a quest done

```bash
node scripts/quest.js done <id>
```

## List quests

```bash
node scripts/quest.js list [active|done]
```

Omit the filter to list every quest, active and done.
