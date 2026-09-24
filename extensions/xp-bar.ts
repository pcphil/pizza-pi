import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { ExtensionAPI, ExtensionContext, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { isBashToolResult, isPowerShellToolResult } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

// --- Config (tunable, not architectural — see openspec/changes/add-gamification/design.md) ---

export const SIZE_XP: Record<"small" | "medium" | "large", number> = {
  small: 10,
  medium: 25,
  large: 50,
};

export const COMMIT_XP = 3;
export const STREAK_XP = 5;
export const PROMPT_QUEST_XP = 15;

const QUEST_NAME_MAX = 40;
const QUEST_TITLE_TOOL = "name_quest";

export const RANKS: { threshold: number; name: string }[] = [
  { threshold: 0, name: "Squire" },
  { threshold: 50, name: "Knight-Errant" },
  { threshold: 150, name: "Knight" },
  { threshold: 350, name: "Knight-Captain" },
  { threshold: 700, name: "Knight-Commander" },
  { threshold: 1200, name: "Paladin" },
];

const GIT_COMMIT_RE = /\bgit\s+commit(\s|$)/;
const QUEST_DONE_RE = /quest\.js\s+done\b/;
const QUEST_DONE_OUTPUT_RE = /Quest #(\d+) marked done \[(small|medium|large)\]: (.+)/i;

const STATUS_KEY = "xp-bar";
const WIDGET_KEY = "xp-bar-quests";
const CELEBRATION_TYPE = "xp-celebration";

// --- State ---

export interface StreakState {
  count: number;
  /** Last calendar day (UTC, "YYYY-MM-DD") a streak increment was recorded. */
  lastDate?: string;
}

export interface XpState {
  totalXp: number;
  streak: StreakState;
}

function defaultState(): XpState {
  return { totalXp: 0, streak: { count: 0 } };
}

function xpStateFile(): string {
  return path.join(os.homedir(), ".pi", "agent", "progression", "xp-state.json");
}

function loadState(file: string): XpState {
  if (!fs.existsSync(file)) return defaultState();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      totalXp: typeof parsed.totalXp === "number" ? parsed.totalXp : 0,
      streak: {
        count: typeof parsed.streak?.count === "number" ? parsed.streak.count : 0,
        lastDate: typeof parsed.streak?.lastDate === "string" ? parsed.streak.lastDate : undefined,
      },
    };
  } catch {
    return defaultState();
  }
}

function saveState(file: string, state: XpState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n", "utf8");
}

// Mirrors .pi/skills/quest-tracker/scripts/quest.js's path-keying so this
// extension can read the same per-project tasks.json for the widget.
function escapeProjectPath(absPath: string): string {
  return "--" + absPath.replace(/[:\\/]/g, "-") + "--";
}

function questsFileFor(projectDir: string): string {
  const root = path.join(os.homedir(), ".pi", "agent", "progression", "quests");
  return path.join(root, escapeProjectPath(path.resolve(projectDir)), "tasks.json");
}

interface QuestRecord {
  id: number;
  description: string;
  size: "small" | "medium" | "large";
  status: "active" | "done";
}

function activeQuestLines(projectDir: string): string[] {
  const file = questsFileFor(projectDir);
  if (!fs.existsSync(file)) return ["No quests yet — ask to add one."];
  try {
    const store = JSON.parse(fs.readFileSync(file, "utf8")) as { quests?: QuestRecord[] };
    const active = (store.quests ?? []).filter((q) => q.status === "active");
    if (active.length === 0) return ["No active quests."];
    return active.map((q) => `[ ] #${q.id} (${q.size}) ${q.description}`);
  } catch {
    return ["Could not read the quest list."];
  }
}

// --- Pure logic (kept separate from I/O and the ExtensionAPI wiring for testability) ---

export function rankForXp(totalXp: number): string {
  let name = RANKS[0].name;
  for (const rank of RANKS) {
    if (totalXp >= rank.threshold) name = rank.name;
  }
  return name;
}

/** Progress toward the next rank as a bar plus "have/need" counts; full bar at max rank. */
export function xpBar(totalXp: number, width = 10): string {
  let idx = 0;
  RANKS.forEach((r, i) => {
    if (totalXp >= r.threshold) idx = i;
  });
  const next = RANKS[idx + 1];
  if (!next) return `${"▰".repeat(width)} MAX`;
  const base = RANKS[idx].threshold;
  const span = next.threshold - base;
  const done = totalXp - base;
  const filled = Math.min(width, Math.floor((done / span) * width));
  return `${"▰".repeat(filled)}${"▱".repeat(width - filled)} ${done}/${span}`;
}

function todayUtcIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayIso(todayIso: string): string {
  const d = new Date(`${todayIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Once-per-calendar-day streak advance. Returns the new streak and whether this call earned streak XP. */
export function advanceStreak(streak: StreakState, todayIso: string): { streak: StreakState; earned: boolean } {
  if (streak.lastDate === todayIso) {
    return { streak, earned: false };
  }
  const continuing = streak.lastDate === yesterdayIso(todayIso);
  const count = continuing ? streak.count + 1 : 1;
  return { streak: { count, lastDate: todayIso }, earned: true };
}

export function isShellSuccess(event: ToolResultEvent): boolean {
  return (isBashToolResult(event) || isPowerShellToolResult(event)) && !event.isError;
}

export function isSuccessfulGitCommit(event: ToolResultEvent): boolean {
  if (!isShellSuccess(event)) return false;
  const command = event.input.command;
  return typeof command === "string" && GIT_COMMIT_RE.test(command);
}

export interface QuestCompletion {
  id: number;
  size: "small" | "medium" | "large";
  description: string;
}

/** Parses a genuine (not already-done) `quest.js done` success into the quest it completed. */
export function parseQuestCompletion(event: ToolResultEvent): QuestCompletion | undefined {
  if (!isShellSuccess(event)) return undefined;
  const command = event.input.command;
  if (typeof command !== "string" || !QUEST_DONE_RE.test(command)) return undefined;

  const text = event.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  const match = QUEST_DONE_OUTPUT_RE.exec(text);
  if (!match) return undefined;
  return {
    id: Number(match[1]),
    size: match[2].toLowerCase() as "small" | "medium" | "large",
    description: match[3].trim(),
  };
}

// --- Prompt-triggered quests (ephemeral; see openspec/changes/dynamic-quest-on-prompt/design.md) ---

const FILLER_RE = /^(?:(?:please|pls|kindly|can you|could you|would you|will you|let['’]?s|i want you to|i need you to|go ahead and|now|also|then)\b[\s,]*)+/i;

const ACTION_VERBS = new Set([
  "add", "build", "create", "write", "implement", "fix", "refactor", "rename", "remove", "delete",
  "update", "change", "move", "migrate", "install", "configure", "set", "run", "test", "debug",
  "deploy", "generate", "optimize", "optimise", "replace", "integrate", "make", "modify", "extract",
  "split", "merge", "convert", "improve", "clean", "wire", "hook", "scaffold", "patch", "upgrade",
  "revert", "rewrite", "simplify", "enable", "disable", "apply", "commit", "push", "publish",
  // file operations, including read-only ones: an imperative "read X" is a task, "what is in X?" is not
  "edit", "read", "open", "view", "inspect", "review", "check", "look", "find", "search", "list",
  "copy", "save", "insert", "append", "overwrite", "scan", "cat", "grep",
]);

function stripFiller(prompt: string): string {
  return prompt.trim().replace(FILLER_RE, "").trim();
}

function firstWord(text: string): string {
  return (/^[a-z']+/i.exec(text)?.[0] ?? "").toLowerCase();
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** True for imperative requests to act (fix, add, refactor...), false for questions, commands and chatter. */
export function isTaskPrompt(prompt: string): boolean {
  const text = prompt.trim();
  if (text.startsWith("/") || text.startsWith("!")) return false;
  const body = stripFiller(text);
  if (wordCount(body) < 3) return false;
  return ACTION_VERBS.has(firstWord(body));
}

/** Cleans a model-supplied quest title: single line, no wrapping quotes, bounded length. */
export function sanitizeQuestTitle(raw: string): string | undefined {
  let title = raw.split(/\r?\n/)[0].replace(/\s+/g, " ").trim().replace(/^["'`“”]+|["'`“”]+$/g, "").trim();
  if (!title) return undefined;
  if (title.length > QUEST_NAME_MAX) {
    const cut = title.slice(0, QUEST_NAME_MAX - 1);
    const lastSpace = cut.lastIndexOf(" ");
    title = `${(lastSpace > 10 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
  }
  return title;
}

/** Dynamic quest name from a task prompt; undefined when the prompt is not a task. */
export function deriveQuestName(prompt: string): string | undefined {
  if (!isTaskPrompt(prompt)) return undefined;
  const line = prompt.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  let name = stripFiller(line).replace(/\s+/g, " ").replace(/[?.!]+$/, "").trim();
  if (!name) return undefined;
  name = name.charAt(0).toUpperCase() + name.slice(1);
  if (name.length <= QUEST_NAME_MAX) return name;
  const cut = name.slice(0, QUEST_NAME_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 10 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

const RESOLUTION_RE =
  /\b(resolved|solved|fixed|all done|we['’]?re done|i['’]?m done|task complete|it works|works now|works great|all good|that['’]?s (?:it|all|fixed))\b/i;

/** Short, non-question, non-task statement that the task is finished. */
export function isResolution(prompt: string): boolean {
  const text = prompt.trim();
  if (text.includes("?") || wordCount(text) > 12) return false;
  if (isTaskPrompt(text)) return false;
  return RESOLUTION_RE.test(text);
}

/** Bare affirmative answer to "is the quest resolved?". */
export function isAffirmative(prompt: string): boolean {
  const text = prompt.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  return (
    /^(yes|yep|yeah|yup|y|sure|correct)( it is| it s| thanks| thank you)?$/.test(text) ||
    /^(solved|resolved|done|fixed)( thanks| thank you)?$/.test(text)
  );
}

interface CelebrationData {
  kind: "rank-up" | "quest-done" | "quest-start" | "quest-followup" | "quest-resolved";
  rank?: string;
  description?: string;
  xp: number;
}

function celebrationLine(data: CelebrationData): string {
  switch (data.kind) {
    case "rank-up":
      return `⚔ Sir Peppy: Well met! Thou hast risen to ${data.rank}! (${data.xp} XP total)`;
    case "quest-start":
      return `⚔ Sir Peppy: A new quest begins — "${data.description}"`;
    case "quest-followup":
      return `⚔ Sir Peppy: Is the quest "${data.description}" resolved, milord?`;
    case "quest-resolved":
      return `⚔ Sir Peppy: Quest resolved — "${data.description}" (+${data.xp} XP)`;
    default:
      return `⚔ Sir Peppy: Quest complete — "${data.description}" (+${data.xp} XP)`;
  }
}

// --- Wiring ---

export default function (pi: ExtensionAPI) {
  const file = xpStateFile();
  let widgetVisible = false;
  let activeQuest: string | undefined;
  let awaitingConfirm = false;
  /** True from quest start until the model titles it (or the turn begins without one). */
  let titleRequested = false;
  let titled = false;

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

  function resolveQuest(ctx: ExtensionContext): void {
    const description = activeQuest;
    activeQuest = undefined;
    titled = false;
    titleRequested = false;
    awaitingConfirm = false;
    const { state, rankChanged, rank } = awardXp(PROMPT_QUEST_XP);
    updateStatus(ctx, state);
    pi.appendEntry<CelebrationData>(CELEBRATION_TYPE, { kind: "quest-resolved", description, xp: PROMPT_QUEST_XP });
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

  pi.registerCommand("quests", {
    description: "Toggle the active quest list widget",
    handler: async (_args, ctx) => {
      widgetVisible = !widgetVisible;
      ctx.ui.setWidget(WIDGET_KEY, widgetVisible ? activeQuestLines(ctx.cwd) : undefined);
    },
  });

  pi.registerTool({
    name: QUEST_TITLE_TOOL,
    label: "Name Quest",
    description:
      "Give the current quest a short, fun, medieval-knight-flavoured title (max 40 chars) that hints at the user's task. Only call when asked to by a quest-start note.",
    parameters: Type.Object({
      title: Type.String({ description: "Playful quest title, e.g. \"Slaying the Streak Bug\"" }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const title = sanitizeQuestTitle(params.title);
      if (!activeQuest || titled || !title) {
        return { content: [{ type: "text", text: "No quest to title." }], details: {} };
      }
      activeQuest = title;
      titled = true;
      updateStatus(ctx, loadState(file));
      return { content: [{ type: "text", text: `Quest titled: ${title}` }], details: {} };
    },
  });

  pi.on("before_agent_start", async () => {
    if (!activeQuest || titled || !titleRequested) return;
    titleRequested = false;
    return {
      message: {
        customType: "quest-title-request",
        content: `A quest has begun for the user's task. Call the ${QUEST_TITLE_TOOL} tool once, now, with a short, fun, knightly title (max 40 chars). Then continue the task as normal.`,
        display: false,
      },
    };
  });

  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return { action: "continue" };
    const wasAwaiting = awaitingConfirm;
    awaitingConfirm = false;

    if (activeQuest) {
      if (isResolution(event.text) || (wasAwaiting && isAffirmative(event.text))) resolveQuest(ctx);
    } else {
      const name = deriveQuestName(event.text);
      if (name) {
        activeQuest = name;
        titled = false;
        titleRequested = true;
        updateStatus(ctx, loadState(file));
        pi.appendEntry<CelebrationData>(CELEBRATION_TYPE, { kind: "quest-start", description: name, xp: 0 });
      }
    }
    return { action: "continue" };
  });

  pi.on("agent_end", async () => {
    if (!activeQuest) return;
    awaitingConfirm = true;
    pi.appendEntry<CelebrationData>(CELEBRATION_TYPE, { kind: "quest-followup", description: activeQuest, xp: 0 });
  });

  pi.on("session_start", async (_event, ctx) => {
    activeQuest = undefined;
    titled = false;
    titleRequested = false;
    awaitingConfirm = false;
    const state = loadState(file);
    const { streak, earned } = advanceStreak(state.streak, todayUtcIso());
    let finalState = state;
    if (earned) {
      saveState(file, { ...state, streak });
      const result = awardXp(STREAK_XP);
      finalState = result.state;
      if (result.rankChanged) {
        pi.appendEntry<CelebrationData>(CELEBRATION_TYPE, { kind: "rank-up", rank: result.rank, xp: finalState.totalXp });
      }
    }
    updateStatus(ctx, finalState);
  });

  pi.on("tool_result", async (event, ctx) => {
    if (isSuccessfulGitCommit(event)) {
      const { state, rankChanged, rank } = awardXp(COMMIT_XP);
      updateStatus(ctx, state);
      if (rankChanged) {
        pi.appendEntry<CelebrationData>(CELEBRATION_TYPE, { kind: "rank-up", rank, xp: state.totalXp });
      }
      return;
    }

    const quest = parseQuestCompletion(event);
    if (quest) {
      const { state, rankChanged, rank } = awardXp(SIZE_XP[quest.size]);
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
