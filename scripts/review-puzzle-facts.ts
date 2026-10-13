// Usage: npx vite-node scripts/review-puzzle-facts.ts <draft.json> <review.md>
// Validates a local Facts draft and writes a Markdown review page. Drafts contain puzzle answers; keep them out of Git.
import { readFileSync, writeFileSync } from "node:fs";

import { validatePuzzleFacts } from "../src/lib/puzzle-facts";

type DraftPuzzle = {
  id: number;
  title: string;
  surface: string;
  bottom: string;
  facts: unknown;
};

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("Usage: npx vite-node scripts/review-puzzle-facts.ts <draft.json> <review.md>");
  process.exit(1);
}

const draft = JSON.parse(readFileSync(input, "utf8")) as { puzzles: DraftPuzzle[] };
const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");
const lines = ["# Facts 草稿审核", "", `来源：\`${input}\``, ""];
let failed = false;

for (const puzzle of draft.puzzles) {
  const { facts, errors, warnings } = validatePuzzleFacts(puzzle.facts, puzzle);
  failed ||= errors.length > 0;
  lines.push(
    `## #${puzzle.id}《${puzzle.title}》`,
    "",
    `**汤底**：${puzzle.bottom}`,
    "",
    `自动检查：${errors.length === 0 ? "通过" : `${errors.length} 个错误`}${warnings.length > 0 ? `，${warnings.length} 个提醒` : ""}`,
    "",
  );
  for (const error of errors) lines.push(`- 错误：${error}`);
  for (const warning of warnings) lines.push(`- 提醒：${warning}`);
  if (errors.length > 0 || warnings.length > 0) lines.push("");
  lines.push("| 编号 | 类型 | 内容 | 依据 | 状态 |", "| --- | --- | --- | --- | --- |");
  for (const fact of facts) {
    const basis = fact.kind === "explicit"
      ? `原文：${fact.quote ?? ""}`
      : `${(fact.depends_on ?? []).join("、")}${fact.note ? `（${fact.note}）` : ""}`;
    lines.push(`| ${fact.id} | ${fact.kind === "explicit" ? "明说" : "推导"} | ${cell(fact.text)} | ${cell(basis)} | ${fact.status} |`);
  }
  lines.push("");
}

writeFileSync(output, `${lines.join("\n")}\n`);
console.log(`${failed ? "存在错误" : "全部通过"}：${output}`);
process.exit(failed ? 1 : 0);
