// Scratch test script for progression-bar's pure logic (lib/progression-bar-logic.ts) — no
// framework, just Node's built-in test runner. Run with:
//   npm test
// or directly:
//   node --experimental-strip-types --test lib/progression-bar.test.ts
//
// Lives outside extensions/ on purpose — see progression-bar-logic.ts's header comment. Don't
// move this or progression-bar-logic.ts into extensions/: pi's loader treats every direct file
// there as its own extension (needs a default export), and this file has none.
//
// Needs a node_modules/@earendil-works junction to pi's global install for the pi-coding-agent
// import progression-bar-logic.ts uses (isBashToolResult etc.) — pi-tui is NOT needed here,
// which is the whole point of the split (pi-tui is only resolvable inside pi's own runtime).
//
// Covers only exported pure functions; everything wired through pi.on/registerTool/registerCommand
// needs a live pi session instead (see openspec/changes/*/tasks.md "Verify" sections).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeQuestTitle,
  computeQuestPayout,
  rankForXp,
  xpBar,
  advanceStreak,
  PROMPT_QUEST_XP,
  PROMPT_QUEST_XP_CAP,
} from "./progression-bar-logic.ts";

// isTaskPrompt/isResolution/isAffirmative/deriveQuestName are all gone: both starting and
// resolving a quest are fully model-driven now (start_quest/resolve_quest tools in
// extensions/progression-bar.ts) — no prompt-text inspection or regex/phrase-list on either side.

test("sanitizeQuestTitle: strips quotes/newlines, truncates on a word boundary", () => {
  assert.equal(sanitizeQuestTitle('"Slaying the Streak Bug"'), "Slaying the Streak Bug");
  assert.equal(sanitizeQuestTitle("Fine\nignored second line"), "Fine");
  assert.equal(sanitizeQuestTitle("   "), undefined);
  const long = sanitizeQuestTitle("A".repeat(60));
  assert.ok(long && long.length <= 40, long);
});

test("computeQuestPayout: zero edits pays nothing, otherwise base+edits capped", () => {
  assert.deepEqual(computeQuestPayout(0), { xp: 0, bonus: 0 });
  assert.deepEqual(computeQuestPayout(1), { xp: PROMPT_QUEST_XP + 1, bonus: 1 });
  assert.deepEqual(computeQuestPayout(6), { xp: PROMPT_QUEST_XP + 6, bonus: 6 });
  // at/over the cap: xp pins at PROMPT_QUEST_XP_CAP, bonus is the capped remainder,
  // so PROMPT_QUEST_XP + bonus === xp always holds (what the celebration line displays).
  for (const edits of [15, 30, 100]) {
    const { xp, bonus } = computeQuestPayout(edits);
    assert.equal(xp, PROMPT_QUEST_XP_CAP, String(edits));
    assert.equal(PROMPT_QUEST_XP + bonus, xp, String(edits));
  }
});

test("rankForXp / xpBar: thresholds and bar rendering", () => {
  assert.equal(rankForXp(0), "Squire");
  assert.equal(rankForXp(49), "Squire");
  assert.equal(rankForXp(50), "Knight-Errant");
  assert.equal(rankForXp(1200), "Paladin");
  assert.match(xpBar(0, 10), /^▱{10} 0\/50$/);
  assert.match(xpBar(1200, 10), /MAX$/);
});

test("advanceStreak: increments once per day, breaks on a skipped day", () => {
  const day1 = advanceStreak({ count: 0 }, "2026-01-01");
  assert.equal(day1.earned, true);
  assert.equal(day1.streak.count, 1);

  const sameDay = advanceStreak(day1.streak, "2026-01-01");
  assert.equal(sameDay.earned, false);
  assert.equal(sameDay.streak.count, 1);

  const nextDay = advanceStreak(day1.streak, "2026-01-02");
  assert.equal(nextDay.earned, true);
  assert.equal(nextDay.streak.count, 2);

  const skipped = advanceStreak(nextDay.streak, "2026-01-10");
  assert.equal(skipped.earned, true);
  assert.equal(skipped.streak.count, 1);
});
