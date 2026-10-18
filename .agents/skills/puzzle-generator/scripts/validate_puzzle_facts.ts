// Called by validate_puzzles.py; use the application's validator instead of copying its rules.
import { readFileSync } from "node:fs";
import { validatePuzzleFacts } from "../../../../src/lib/puzzle-facts";

const input = process.argv[2];
if (!input) throw new Error("Usage: vite-node validate_puzzle_facts.ts <puzzles.json>");
const data: unknown = JSON.parse(readFileSync(input, "utf8").replace(/^\uFEFF/, ""));
if (!Array.isArray(data)) throw new Error("Root JSON must be an array");

const results = data.map((item: unknown) => {
  const puzzle = item && typeof item === "object" ? item as Record<string, unknown> : {};
  const result = validatePuzzleFacts(puzzle.facts, {
    surface: typeof puzzle.surface === "string" ? puzzle.surface : "",
    bottom: typeof puzzle.bottom === "string" ? puzzle.bottom : "",
  });
  if (Array.isArray(puzzle.facts) && puzzle.facts.length > 60) {
    result.errors.push("facts 最多 60 条（admin_set_puzzle_facts 限制）");
  }
  return result;
});
process.stdout.write(`${JSON.stringify(results)}\n`);
