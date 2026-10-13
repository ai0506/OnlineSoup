// Explicit opt-in live comparison of the old and new ask engines. Never writes room or database data.
// Usage:
//   npx vite-node -c vitest.config.ts scripts/evaluate-ask-v2.ts -- --live --target local
//   npx vite-node -c vitest.config.ts scripts/evaluate-ask-v2.ts -- --live --target https://<preview>.vercel.app
// Options: --engine old|new|both, --cases a.json,b.json, --facts draft.json, --filter text, --output path-prefix
// Cases and facts contain puzzle answers and must stay in git-ignored folders.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";

import type { AskEvalRequest, AskEvalResponse } from "../src/lib/ask-eval";
import { normalizeEvidenceText } from "../src/lib/puzzle-facts";

type EvalCase = {
  id: string;
  question: string;
  expected: string[];
  puzzle: AskEvalRequest["puzzle"];
  history?: AskEvalRequest["history"];
  source?: string;
};

type FactsDraft = { puzzles: Array<{ bottom: string; facts: unknown }> };

const args = process.argv.slice(2);
const option = (name: string, fallback?: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};

if (!args.includes("--live")) {
  throw new Error("Run with --live to authorize paid AI calls.");
}

if (existsSync(".env.local")) {
  for (const [name, value] of Object.entries(parseEnv(readFileSync(".env.local", "utf8")))) {
    if (process.env[name] === undefined && value !== undefined) process.env[name] = value;
  }
}

const target = option("target", "local")!;
const engines = (option("engine", "both") === "both" ? ["old", "new"] : [option("engine")]) as Array<"old" | "new">;
const casePaths = option("cases", "ai-error/fixtures/ask-v2-cases.json,ai-error/fixtures/ask-inference-cases.json")!.split(",");
const factsPath = option("facts", "ai-error/fixtures/puzzle-facts-draft.json")!;
const filter = option("filter");
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(2, 13).replace("T", "");
const outputPrefix = option("output", `ai-error/10-13/ask-v2-eval-${target === "local" ? "local" : "vercel"}-${stamp}`)!;

const cases = casePaths.flatMap((path) => JSON.parse(readFileSync(path, "utf8")) as EvalCase[])
  .filter((item) => !filter || item.id.includes(filter));
const draft = JSON.parse(readFileSync(factsPath, "utf8")) as FactsDraft;
const factsFor = (bottom: string) =>
  draft.puzzles.find((puzzle) => normalizeEvidenceText(puzzle.bottom) === normalizeEvidenceText(bottom))?.facts ?? [];

const token = process.env.ASK_EVAL_TOKEN
  ?? (existsSync(".agents/ask-eval.token") ? readFileSync(".agents/ask-eval.token", "utf8").trim() : undefined);
if (target !== "local" && !token) throw new Error("Missing ASK_EVAL_TOKEN (env or .agents/ask-eval.token)");
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  ?? (existsSync(".agents/vercel-bypass.secret") ? readFileSync(".agents/vercel-bypass.secret", "utf8").trim() : undefined);

async function runOne(request: AskEvalRequest): Promise<AskEvalResponse & { region?: string }> {
  if (target === "local") {
    const { runAskEvalCase } = await import("../src/lib/ask-eval");
    return { ...(await runAskEvalCase(request)), region: "local" };
  }
  const startedAt = Date.now();
  const response = await fetch(new URL("/api/internal/ask-eval", target), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ask-eval-token": token!,
      ...(bypass ? { "x-vercel-protection-bypass": bypass } : {}),
    },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} after ${Date.now() - startedAt}ms`);
  }
  return response.json() as Promise<AskEvalResponse & { region?: string }>;
}

type Row = {
  id: string;
  group: string;
  question: string;
  expected: string[];
  source?: string;
  results: Partial<Record<"old" | "new", (AskEvalResponse & { region?: string; pass: boolean; roundTripMs: number }) | { error: string; pass: false }>>;
};

const rows: Row[] = [];
for (const item of cases) {
  const group = item.puzzle.title === "生日" || item.puzzle.title === "雨伞与电梯" ? item.puzzle.title : "虚构边界题";
  const row: Row = { id: item.id, group, question: item.question, expected: item.expected, source: item.source, results: {} };
  for (const engine of engines) {
    const startedAt = Date.now();
    try {
      const result = await runOne({
        engine,
        puzzle: item.puzzle,
        facts: factsFor(item.puzzle.bottom),
        question: item.question,
        history: item.history ?? [],
      });
      const pass = !result.error && result.answerType !== null && item.expected.includes(result.answerType);
      row.results[engine] = { ...result, pass, roundTripMs: Date.now() - startedAt };
    } catch (error) {
      row.results[engine] = { error: error instanceof Error ? error.message : String(error), pass: false };
    }
  }
  rows.push(row);
  const line = engines.map((engine) => {
    const result = row.results[engine];
    if (!result) return "";
    if ("error" in result && typeof result.error === "string") return `${engine}=ERR`;
    const ok = result as AskEvalResponse & { pass: boolean };
    return `${engine}=${ok.answerType ?? `ERR:${ok.error?.code}`}${ok.pass ? "✓" : "✗"}`;
  }).join("  ");
  console.log(`${item.id}  expected=${item.expected.join("/")}  ${line}`);
}

const percentile = (values: number[], p: number) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};

const md: string[] = [
  `# Ask 新旧引擎试跑报告`,
  "",
  `- 时间：${new Date().toISOString()}；目标：${target}；用例：${rows.length}；Facts：\`${factsPath}\``,
  "",
  "## 准确率",
  "",
  "| 分组 | 用例数 | " + engines.map((engine) => `${engine === "old" ? "旧引擎" : "新引擎"}通过`).join(" | ") + " |",
  "| --- | --- | " + engines.map(() => "---").join(" | ") + " |",
];
for (const group of [...new Set(rows.map((row) => row.group)), "合计"]) {
  const subset = group === "合计" ? rows : rows.filter((row) => row.group === group);
  md.push(`| ${group} | ${subset.length} | ${engines.map((engine) => subset.filter((row) => row.results[engine]?.pass).length).join(" | ")} |`);
}

md.push("", "## 时延与调用", "", "| 引擎 | 判定 P50 | 判定 P95 | 总耗时 P50 | 总耗时 P95 | 最长 | 平均调用数 | 输入 token | 其中缓存命中 | 输出 token | 失败 |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const engine of engines) {
  const ok = rows.map((row) => row.results[engine]).filter((result): result is AskEvalResponse & { pass: boolean; roundTripMs: number } => !!result && !("error" in result && typeof result.error === "string"));
  const judge = ok.filter((result) => !result.error).map((result) => result.judgeElapsedMs);
  const total = ok.filter((result) => !result.error).map((result) => result.roundTripMs);
  const usage = ok.flatMap((result) => result.usage as Array<{ usage?: { prompt_tokens?: number; prompt_cache_hit_tokens?: number; completion_tokens?: number } | null }>);
  const sum = (pick: (entry: (typeof usage)[number]) => number | undefined) => usage.reduce((acc, entry) => acc + (pick(entry) ?? 0), 0);
  const failures = rows.length - ok.filter((result) => !result.error).length;
  md.push(`| ${engine === "old" ? "旧" : "新"} | ${percentile(judge, 50)}ms | ${percentile(judge, 95)}ms | ${percentile(total, 50)}ms | ${percentile(total, 95)}ms | ${Math.max(0, ...total)}ms | ${(usage.length / Math.max(1, ok.length)).toFixed(1)} | ${sum((entry) => entry.usage?.prompt_tokens)} | ${sum((entry) => entry.usage?.prompt_cache_hit_tokens)} | ${sum((entry) => entry.usage?.completion_tokens)} | ${failures} |`);
}

if (engines.includes("new")) {
  const routes = new Map<string, number>();
  const errors = new Map<string, number>();
  for (const row of rows) {
    const result = row.results.new as (AskEvalResponse & { audit: { route?: string } | null }) | undefined;
    if (!result || ("error" in result && typeof result.error === "string")) continue;
    if (result.error) errors.set(`${result.error.stage}/${result.error.code}`, (errors.get(`${result.error.stage}/${result.error.code}`) ?? 0) + 1);
    else routes.set(result.audit?.route ?? "unknown", (routes.get(result.audit?.route ?? "unknown") ?? 0) + 1);
  }
  md.push("", "## 新引擎路径分布", "", ...[...routes].map(([route, count]) => `- ${route}：${count}`));
  if (errors.size > 0) md.push("", "新引擎失败：", ...[...errors].map(([key, count]) => `- ${key}：${count}`));
}

md.push("", "## 未通过或两引擎不一致的用例", "", "| 用例 | 问题 | 期望 | " + engines.map((engine) => engine === "old" ? "旧" : "新").join(" | ") + " | 来源 |", "| --- | --- | --- | " + engines.map(() => "---").join(" | ") + " | --- |");
for (const row of rows) {
  const answers = engines.map((engine) => {
    const result = row.results[engine];
    if (!result) return "-";
    if ("error" in result && typeof result.error === "string") return `请求失败`;
    const ok = result as AskEvalResponse & { pass: boolean };
    return ok.error ? `失败 ${ok.error.stage ?? ""}/${ok.error.code}` : `${ok.answerType}${ok.pass ? " ✓" : " ✗"}`;
  });
  const anyFail = engines.some((engine) => !row.results[engine]?.pass);
  const differ = new Set(answers.map((answer) => answer.replace(/ [✓✗]$/, ""))).size > 1;
  if (anyFail || differ) md.push(`| ${row.id} | ${row.question.replace(/\|/g, "\\|")} | ${row.expected.join("/")} | ${answers.join(" | ")} | ${row.source ?? ""} |`);
}

writeFileSync(`${outputPrefix}.json`, `${JSON.stringify({ target, generatedAt: new Date().toISOString(), rows }, null, 2)}\n`);
writeFileSync(`${outputPrefix}.md`, `${md.join("\n")}\n`);
console.log(`\nReport: ${outputPrefix}.md`);
