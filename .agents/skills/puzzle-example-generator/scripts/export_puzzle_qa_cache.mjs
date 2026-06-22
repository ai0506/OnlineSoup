#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function loadDotEnvFile(filePath) {
  if (!existsSync(filePath)) return;

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;

    const equalsIndex = trimmed.indexOf("=");
    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function parseArgs(argv) {
  const args = {
    output: "",
    puzzleTitle: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output" || arg === "-o") {
      args.output = argv[++index] ?? "";
    } else if (arg === "--puzzle-title") {
      args.puzzleTitle = argv[++index] ?? "";
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function usage() {
  const scriptName = fileURLToPath(import.meta.url);
  return [
    "Export OnlineSoup puzzle Q&A cache from Supabase as review JSON.",
    "",
    `Usage: node ${scriptName} --output <file> [--puzzle-title <title>]`,
    "",
    "Environment:",
    "- NEXT_PUBLIC_SUPABASE_URL",
    "- SUPABASE_SECRET_KEY",
    "",
    "The script also loads .env.local from the current working directory when present.",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  if (!args.output) {
    throw new Error("Missing required --output <file>");
  }

  loadDotEnvFile(resolve(process.cwd(), ".env.local"));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY");
  }

  const admin = createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  let puzzleQuery = admin
    .from("puzzles")
    .select("id,title,is_active")
    .order("id", { ascending: true });

  if (args.puzzleTitle) {
    puzzleQuery = puzzleQuery.eq("title", args.puzzleTitle);
  }

  const { data: puzzles, error: puzzleError } = await puzzleQuery;
  if (puzzleError) {
    throw new Error(`Supabase puzzle export failed: ${puzzleError.message}`);
  }

  const puzzleIds = (puzzles ?? []).map((puzzle) => puzzle.id);
  let cacheRows = [];

  if (puzzleIds.length > 0) {
    const { data, error } = await admin
      .from("puzzle_qa_cache")
      .select("id,puzzle_id,question_text,normalized_question,answer_type,status,hit_count,created_at,last_hit_at")
      .in("puzzle_id", puzzleIds)
      .order("puzzle_id", { ascending: true })
      .order("hit_count", { ascending: false })
      .order("id", { ascending: true });

    if (error) {
      throw new Error(`Supabase cache export failed: ${error.message}`);
    }

    cacheRows = data ?? [];
  }

  const cacheByPuzzle = new Map();
  for (const row of cacheRows) {
    if (!cacheByPuzzle.has(row.puzzle_id)) {
      cacheByPuzzle.set(row.puzzle_id, []);
    }
    cacheByPuzzle.get(row.puzzle_id).push({
      id: row.id,
      question_text: row.question_text,
      normalized_question: row.normalized_question,
      answer_type: row.answer_type,
      status: row.status,
      hit_count: row.hit_count,
      created_at: row.created_at,
      last_hit_at: row.last_hit_at,
    });
  }

  const output = (puzzles ?? []).map((puzzle) => {
    const entries = cacheByPuzzle.get(puzzle.id) ?? [];
    return {
      id: puzzle.id,
      title: puzzle.title,
      is_active: puzzle.is_active,
      cache_count: entries.length,
      yes_count: entries.filter((entry) => entry.answer_type === "yes").length,
      no_count: entries.filter((entry) => entry.answer_type === "no").length,
      pending_count: entries.filter((entry) => entry.status === "pending").length,
      approved_count: entries.filter((entry) => entry.status === "approved").length,
      total_hits: entries.reduce((sum, entry) => sum + (entry.hit_count ?? 0), 0),
      entries,
    };
  });

  const outputPath = resolve(process.cwd(), args.output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(`Exported ${cacheRows.length} cache entries for ${output.length} puzzles to ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
