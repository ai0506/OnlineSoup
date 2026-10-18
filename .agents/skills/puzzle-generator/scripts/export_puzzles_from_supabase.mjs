#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SELECT = "id, title, surface, bottom, difficulty, is_active, key_points, examples, facts, content_version";

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
    activeOnly: false,
    limit: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output" || arg === "-o") {
      args.output = argv[++index] ?? "";
    } else if (arg === "--active-only") {
      args.activeOnly = true;
    } else if (arg === "--limit") {
      const value = Number.parseInt(argv[++index] ?? "", 10);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error("--limit must be a positive integer");
      }
      args.limit = value;
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
    "Export OnlineSoup puzzles with Facts and version metadata for private review.",
    "The current admin JSON importer does not preserve Facts; this is not a lossless import file.",
    "",
    `Usage: node ${scriptName} --output <file> [--active-only] [--limit <n>]`,
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

  let query = admin.from("puzzles").select(DEFAULT_SELECT).order("id", { ascending: true });

  if (args.activeOnly) {
    query = query.eq("is_active", true);
  }

  if (args.limit !== undefined) {
    query = query.limit(args.limit);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Supabase export failed: ${error.message}`);
  }

  const outputPath = resolve(process.cwd(), args.output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(data ?? [], null, 2)}\n`, "utf8");

  console.log(`Exported ${(data ?? []).length} puzzles to ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
