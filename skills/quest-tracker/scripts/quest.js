#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const SIZES = ["small", "medium", "large"];

// Mirrors the sessions/ path-keying convention: drive/separator chars -> "-",
// wrapped in leading/trailing "--" (e.g. "C:\Users\x" -> "--C--Users-x--").
function escapeProjectPath(absPath) {
  return "--" + absPath.replace(/[:\\/]/g, "-") + "--";
}

function storePathFor(projectDir) {
  const root = path.join(os.homedir(), ".pi", "agent", "progression", "quests");
  const folder = escapeProjectPath(path.resolve(projectDir));
  return path.join(root, folder, "tasks.json");
}

function loadStore(file) {
  if (!fs.existsSync(file)) {
    return { nextId: 1, quests: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`Corrupt tasks.json at ${file}: ${err.message}`);
  }
}

function saveStore(file, store) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2) + "\n", "utf8");
}

function cmdAdd(file, args) {
  const sizeIdx = args.indexOf("--size");
  if (sizeIdx === -1 || !args[sizeIdx + 1]) {
    throw new Error('Usage: quest.js add "<description>" --size <small|medium|large>');
  }
  const size = args[sizeIdx + 1];
  if (!SIZES.includes(size)) {
    throw new Error(`--size must be one of: ${SIZES.join(", ")}`);
  }
  const description = args.slice(0, sizeIdx).join(" ").trim();
  if (!description) {
    throw new Error("Quest description is required.");
  }

  const store = loadStore(file);
  const quest = {
    id: store.nextId++,
    description,
    size,
    status: "active",
    createdAt: new Date().toISOString(),
  };
  store.quests.push(quest);
  saveStore(file, store);
  console.log(`Quest #${quest.id} added [${size}]: ${description}`);
}

function cmdDone(file, args) {
  const id = Number(args[0]);
  if (!Number.isInteger(id)) {
    throw new Error("Usage: quest.js done <id>");
  }
  const store = loadStore(file);
  const quest = store.quests.find((q) => q.id === id);
  if (!quest) {
    throw new Error(`No quest with id ${id}`);
  }
  if (quest.status === "done") {
    console.log(`Quest #${id} is already done.`);
    return;
  }
  quest.status = "done";
  quest.completedAt = new Date().toISOString();
  saveStore(file, store);
  console.log(`Quest #${id} marked done [${quest.size}]: ${quest.description}`);
}

function cmdList(file, args) {
  const filter = args[0];
  if (filter && filter !== "active" && filter !== "done") {
    throw new Error("Usage: quest.js list [active|done]");
  }
  const store = loadStore(file);
  const quests = store.quests.filter((q) => !filter || q.status === filter);
  if (quests.length === 0) {
    console.log("No quests found.");
    return;
  }
  for (const q of quests) {
    const mark = q.status === "done" ? "x" : " ";
    console.log(`[${mark}] #${q.id} (${q.size}) ${q.description}`);
  }
}

function main() {
  const [, , cmd, ...rest] = process.argv;
  const file = storePathFor(process.cwd());

  switch (cmd) {
    case "add":
      cmdAdd(file, rest);
      break;
    case "done":
      cmdDone(file, rest);
      break;
    case "list":
      cmdList(file, rest);
      break;
    default:
      console.error("Usage: quest.js <add|done|list> ...");
      process.exit(1);
  }
}

try {
  main();
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
