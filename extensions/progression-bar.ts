import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  SIZE_XP,
  COMMIT_XP,
  STREAK_XP,
  QUEST_START_TOOL,
  QUEST_RESOLVE_TOOL,
  STATUS_KEY,
  WIDGET_KEY,
  CELEBRATION_TYPE,
  type XpState,
  xpStateFile,
  loadState,
  saveState,
  appendLedger,
  readRecentLedger,
  activeQuestLines,
  rankForXp,
  xpBar,
  todayUtcIso,
  advanceStreak,
  isSuccessfulGitCommit,
  isQuestEditActivity,
  parseQuestCompletion,
  sanitizeQuestTitle,
  computeQuestPayout,
  type CelebrationData,
  celebrationLine,
} from "../lib/progression-bar-logic.ts";

// Re-exported for convenience within pi's runtime (where pi-tui, imported above, resolves fine).
// The test script imports directly from ../lib/progression-bar-logic.ts instead, to avoid pi-tui
// entirely — see that file's header for why these two modules must not live under extensions/.
export * from "../lib/progression-bar-logic.ts";

// --- Wiring ---
//
// This extension owns one row of the status line: XP, rank, streak, and model-triggered
// quests — see AGENTS.md's "quest lifecycle" for the step-by-step model contract. Pure
// logic lives in ../lib/progression-bar-logic.ts; everything below is ExtensionAPI plumbing.
//
// Sections (registered in this order):
//   1. Core: awardXp / updateStatus      — shared by every XP source
//   2. Quest resolution           — resolveQuest (called by the resolve_quest tool below) + celebration renderer
//   3. UI registrations                  — /quests widget, /xp history + its renderer
//   4. Quest tools                — start_quest, resolve_quest: both fully model-driven,
//                                           no automatic/mechanical trigger on either side. The
//                                           model decides a task is quest-worthy and calls
//                                           start_quest(title) in one step (deciding and naming
//                                           are the same action — no separate pending/untitled
//                                           phase, no fallback, no injected reminder); it later
//                                           decides the task is confirmed done and calls
//                                           resolve_quest(). No prompt text is ever inspected by
//                                           this extension to start or end a quest.
//   5. Session boundary                  — session_start (streak, quest reset)
//   6. tool_result                       — quest edit-tracking, commit XP, quest-tracker XP

export default function (pi: ExtensionAPI) {
  const file = xpStateFile();
  let widgetVisible = false;
  /** The quest name shown in the status line — unset until the model starts one via start_quest. */
  let activeQuest: string | undefined;
  /** Edit/write tool calls seen while the current quest has been active. */
  let questEditCount = 0;

  // ===== 1. Core: awardXp / updateStatus =====

  function awardXp(amount: number): { state: XpState; rankChanged: boolean; rank: string } {
    const before = loadState(file);
    const beforeRank = rankForXp(before.totalXp);
    const after: XpState = { ...before, totalXp: before.totalXp + amount };
    saveState(file, after);
    const rank = rankForXp(after.totalXp);
    return { state: after, rankChanged: rank !== beforeRank, rank };
  }

  function updateStatus(ctx: ExtensionContext, state: XpState): void {
    const rank = rankForXp(state.totalXp);
    const streakPart = state.streak.count > 0 ? ` · 🔥${state.streak.count}` : "";
    const questPart = activeQuest ? ` · ⚑ ${activeQuest}` : "";
    ctx.ui.setStatus(STATUS_KEY, `⚔ ${rank} ${xpBar(state.totalXp)} · ${state.totalXp} XP${streakPart}${questPart}`);
  }

  // ===== 2. Quest resolution =====

  function resolveQuest(ctx: ExtensionContext): void {
    const description = activeQuest;
    const edits = questEditCount;
    activeQuest = undefined;
    questEditCount = 0;
    const { xp, bonus } = computeQuestPayout(edits);

    if (xp === 0) {
      updateStatus(ctx, loadState(file));
      pi.appendEntry<CelebrationData>(CELEBRATION_TYPE, { kind: "quest-resolved", description, xp: 0, edits: 0 });
      return;
    }
    const { state, rankChanged, rank } = awardXp(xp);
    appendLedger({ ts: new Date().toISOString(), source: "prompt-quest", amount: xp, reason: description ?? "quest" });
    updateStatus(ctx, state);
    pi.appendEntry<CelebrationData>(CELEBRATION_TYPE, { kind: "quest-resolved", description, xp, edits: bonus });
    if (rankChanged) {
      pi.appendEntry<CelebrationData>(CELEBRATION_TYPE, { kind: "rank-up", rank, xp: state.totalXp });
    }
  }

  pi.registerEntryRenderer<CelebrationData>(CELEBRATION_TYPE, (entry, _options, theme) => {
    const box = new Box(0, 0);
    if (entry.data) {
      box.addChild(new Text(theme.fg("warning", celebrationLine(entry.data)), 0, 0));
    }
    return box;
  });

  // ===== 3. UI registrations: /quests widget, /xp history =====

  pi.registerCommand("quests", {
    description: "Toggle the active quest list widget",
    handler: async (_args, ctx) => {
      widgetVisible = !widgetVisible;
      ctx.ui.setWidget(WIDGET_KEY, widgetVisible ? activeQuestLines(ctx.cwd) : undefined);
    },
  });

  pi.registerEntryRenderer<{ lines: string[] }>("xp-history", (entry, _options, theme) => {
    const box = new Box(0, 0);
    for (const line of entry.data?.lines ?? []) {
      box.addChild(new Text(theme.fg("warning", line), 0, 0));
    }
    return box;
  });

  pi.registerCommand("xp", {
    description: "Show current XP/rank plus recent award history",
    handler: async () => {
      const state = loadState(file);
      const rank = rankForXp(state.totalXp);
      const lines = [`⚔ ${rank} · ${state.totalXp} XP total`];
      const recent = readRecentLedger(10);
      if (recent.length === 0) {
        lines.push("No history yet.");
      } else {
        for (const entry of recent.slice().reverse()) {
          lines.push(`+${entry.amount} ${entry.source} — ${entry.reason}`);
        }
      }
      pi.appendEntry<{ lines: string[] }>("xp-history", { lines });
    },
  });

  // ===== 4. Quest tools: start_quest, resolve_quest =====

  // Fully model-driven: no automatic/mechanical start on any prompt. The model itself judges a
  // task is quest-worthy and calls this — deciding and naming happen in the one call, no
  // separate "pending, untitled" phase to fall back on if it's skipped. If the model never
  // calls it, no quest exists for that turn, full stop — same trade-off already accepted for
  // resolve_quest: judgment calls can be skipped, and that's fine, not a bug to patch around.
  pi.registerTool({
    name: QUEST_START_TOOL,
    label: "Start Quest",
    description:
      "Start a quest for the user's current task, with a short, fun, medieval-knight-flavoured title (max 40 chars) that hints at it. Call this yourself whenever you judge the task substantial enough to be worth tracking — your own judgment call, not automatic. Don't call it for simple questions or small talk.",
    parameters: Type.Object({
      title: Type.String({ description: "Playful quest title, e.g. \"Slaying the Streak Bug\"" }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const title = sanitizeQuestTitle(params.title);
      if (activeQuest || !title) {
        return { content: [{ type: "text", text: "No quest to start." }], details: {} };
      }
      activeQuest = title;
      questEditCount = 0;
      updateStatus(ctx, loadState(file));
      pi.appendEntry<CelebrationData>(CELEBRATION_TYPE, { kind: "quest-start", description: title, xp: 0 });
      return { content: [{ type: "text", text: `Quest started: ${title}` }], details: {} };
    },
  });

  // Model-driven resolution: no regex/phrase-list on the user's reply any more. The model itself
  // calls this whenever it judges the user's words confirm the task is done — whether it asked
  // first (per AGENTS.md's "Ask" step) or the user said so unprompted. Symmetric with
  // start_quest: the model decides, the model calls the tool, no hidden classification pass.
  pi.registerTool({
    name: QUEST_RESOLVE_TOOL,
    label: "Resolve Quest",
    description:
      "Resolve the current quest. Call this once you judge, from the user's own words, that the task is confirmed done — whether you asked and they confirmed, or they said so unprompted. Your own judgment call; no fixed phrase required.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      if (!activeQuest) {
        return { content: [{ type: "text", text: "No quest to resolve." }], details: {} };
      }
      resolveQuest(ctx);
      return { content: [{ type: "text", text: "Quest resolved." }], details: {} };
    },
  });

  // ===== 5. Session boundary =====

  pi.on("session_start", async (_event, ctx) => {
    activeQuest = undefined;
    questEditCount = 0;
    const state = loadState(file);
    const { streak, earned } = advanceStreak(state.streak, todayUtcIso());
    let finalState = state;
    if (earned) {
      saveState(file, { ...state, streak });
      const result = awardXp(STREAK_XP);
      finalState = result.state;
      appendLedger({ ts: new Date().toISOString(), source: "streak", amount: STREAK_XP, reason: `day ${streak.count}` });
      if (result.rankChanged) {
        pi.appendEntry<CelebrationData>(CELEBRATION_TYPE, { kind: "rank-up", rank: result.rank, xp: finalState.totalXp });
      }
    }
    updateStatus(ctx, finalState);
  });

  // ===== 6. tool_result: quest edit-tracking, commit XP, quest-tracker XP =====

  pi.on("tool_result", async (event, ctx) => {
    if (activeQuest && isQuestEditActivity(event)) {
      questEditCount += 1;
    }

    if (isSuccessfulGitCommit(event)) {
      const { state, rankChanged, rank } = awardXp(COMMIT_XP);
      appendLedger({ ts: new Date().toISOString(), source: "commit", amount: COMMIT_XP, reason: "git commit" });
      updateStatus(ctx, state);
      if (rankChanged) {
        pi.appendEntry<CelebrationData>(CELEBRATION_TYPE, { kind: "rank-up", rank, xp: state.totalXp });
      }
      return;
    }

    const quest = parseQuestCompletion(event);
    if (quest) {
      const { state, rankChanged, rank } = awardXp(SIZE_XP[quest.size]);
      appendLedger({
        ts: new Date().toISOString(),
        source: "quest-tracker",
        amount: SIZE_XP[quest.size],
        reason: quest.description,
      });
      updateStatus(ctx, state);
      pi.appendEntry<CelebrationData>(CELEBRATION_TYPE, {
        kind: "quest-done",
        description: quest.description,
        xp: SIZE_XP[quest.size],
      });
      if (rankChanged) {
        pi.appendEntry<CelebrationData>(CELEBRATION_TYPE, { kind: "rank-up", rank, xp: state.totalXp });
      }
      if (widgetVisible) {
        ctx.ui.setWidget(WIDGET_KEY, activeQuestLines(ctx.cwd));
      }
    }
  });
}
