// Pure logic and I/O helpers for the progression-bar extension, kept separate from the
// ExtensionAPI/pi-tui wiring in extensions/progression-bar.ts so it can be imported and
// unit-tested standalone (progression-bar.test.ts) without needing pi-tui, which is only
// resolvable inside pi's own runtime.
//
// Lives outside extensions/ on purpose: pi's loader treats every direct .ts/.js file under
// extensions/ as its own extension (needs a default export). This file and its test have none,
// and putting them in extensions/ broke pi's launch — see git history / openspec changes for
// the incident. Don't move this back into extensions/.

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { isBashToolResult, isEditToolResult, isPowerShellToolResult, isWriteToolResult } from "@earendil-works/pi-coding-agent";

// --- Config (tunable, not architectural — see openspec/changes/add-gamification/design.md) ---

export const SIZE_XP: Record<"small" | "medium" | "large", number> = {
  small: 10,
  medium: 25,
  large: 50,
};

export const COMMIT_XP = 3;
export const STREAK_XP = 5;
export const PROMPT_QUEST_XP = 15;
export const PROMPT_QUEST_XP_CAP = 30;

const QUEST_NAME_MAX = 40;
export const QUEST_START_TOOL = "start_quest";
export const QUEST_RESOLVE_TOOL = "resolve_quest";

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

export const STATUS_KEY = "xp-bar";
export const WIDGET_KEY = "xp-bar-quests";
export const CELEBRATION_TYPE = "xp-celebration";

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

export function xpStateFile(): string {
  return path.join(os.homedir(), ".pi", "agent", "progression", "xp-state.json");
}

export function loadState(file: string): XpState {
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

export function saveState(file: string, state: XpState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n", "utf8");
}

// --- XP ledger (see openspec/changes/xp-ledger-and-command/design.md) ---

interface LedgerEntry {
  ts: string;
  source: string;
  amount: number;
  reason: string;
}

function xpLedgerFile(): string {
  return path.join(os.homedir(), ".pi", "agent", "progression", "xp-ledger.jsonl");
}

/** Appends one award to the durable ledger. Never throws — a ledger write must not block an award. */
export function appendLedger(entry: LedgerEntry): void {
  try {
    const file = xpLedgerFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(entry) + "\n", "utf8");
  } catch {
    // Ledger is a display aid, not the source of truth — swallow and move on.
  }
}

/** Best-effort tail read: skips a missing file and any unparseable trailing line. */
export function readRecentLedger(n = 10): LedgerEntry[] {
  const file = xpLedgerFile();
  if (!fs.existsSync(file)) return [];
  try {
    const lines = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim().length > 0);
    const recent = lines.slice(-n);
    const entries: LedgerEntry[] = [];
    for (const line of recent) {
      try {
        entries.push(JSON.parse(line) as LedgerEntry);
      } catch {
        // Skip a corrupt/truncated line rather than failing the whole read.
      }
    }
    return entries;
  } catch {
    return [];
  }
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

export function activeQuestLines(projectDir: string): string[] {
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

export function todayUtcIso(): string {
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

/** True when the event is an edit or write tool result — the "did work happen" signal for quest XP. */
export function isQuestEditActivity(event: ToolResultEvent): boolean {
  return isEditToolResult(event) || isWriteToolResult(event);
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

// --- Model-triggered quests (fully model-driven: see start_quest/resolve_quest in
// extensions/progression-bar.ts — nothing here inspects prompt text to start or end one) ---

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

/** Model-triggered-quest XP for a given edit count: 0 with no activity, else base + edits, capped. */
export function computeQuestPayout(edits: number): { xp: number; bonus: number } {
  const xp = edits === 0 ? 0 : Math.min(PROMPT_QUEST_XP + edits, PROMPT_QUEST_XP_CAP);
  return { xp, bonus: Math.max(xp - PROMPT_QUEST_XP, 0) };
}

export interface CelebrationData {
  kind: "rank-up" | "quest-done" | "quest-start" | "quest-resolved";
  rank?: string;
  description?: string;
  xp: number;
  /** Edit/write tool calls counted toward a resolved prompt-quest's XP (see fair-transparent-quest-xp). */
  edits?: number;
}

export function celebrationLine(data: CelebrationData): string {
  switch (data.kind) {
    case "rank-up":
      return `⚔ Sir Peppy: Well met! Thou hast risen to ${data.rank}! (${data.xp} XP total)`;
    case "quest-start":
      return `⚔ Sir Peppy: A new quest begins — "${data.description}"`;
    case "quest-resolved":
      return data.xp === 0
        ? `⚔ Sir Peppy: Quest dismissed — "${data.description}" (no changes were made, no XP)`
        : `⚔ Sir Peppy: Quest resolved — "${data.description}" (+${PROMPT_QUEST_XP} base, +${data.edits} edits = +${data.xp} XP)`;
    default:
      return `⚔ Sir Peppy: Quest complete — "${data.description}" (+${data.xp} XP)`;
  }
}
