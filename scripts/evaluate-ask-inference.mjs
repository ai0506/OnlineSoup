// Explicit opt-in live evaluation: calls configured AI providers, never writes room/database data.
import { readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { askDeepSeekHost } from "../src/lib/deepseek.ts";

if (!process.argv.includes("--live")) {
  throw new Error("Run with --live to authorize paid AI calls. Optional: --output <path>");
}
const localEnv = parseEnv(await readFile(new URL("../.env.local", import.meta.url), "utf8"));
for (const [name, value] of Object.entries(localEnv)) {
  if (process.env[name] === undefined) process.env[name] = value;
}
// Evaluate primary prompt semantics without silently substituting a fallback model.
process.env.GLM_FALLBACK_ENABLED = "false";

// Private puzzle snapshots stay outside the public repository.
const fixturesIndex = process.argv.indexOf("--fixtures");
const fixturesPath = fixturesIndex >= 0 ? process.argv[fixturesIndex + 1]
  : new URL("../ai-error/fixtures/ask-inference-cases.json", import.meta.url);
if (!fixturesPath) throw new Error("--fixtures requires a JSON file path");
const cases = JSON.parse(await readFile(fixturesPath, "utf8"));
if (!Array.isArray(cases) || cases.length === 0) throw new Error("Expected a non-empty evaluation case array");

const requestDiagnostics = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  const body = JSON.parse(args[1]?.body ?? "{}");
  const system = body.messages?.[0]?.content ?? "";
  const stage = system.includes("Two independent readings") ? "arbitration"
    : system.includes("Inferential reading:") ? "inferential"
    : system.includes("Strict literal reading:") ? "strict" : "fact_summary";
  const response = await originalFetch(...args);
  const result = await response.clone().json().catch(() => null);
  const choice = result?.choices?.[0];
  requestDiagnostics.push({ stage, status: response.status, finishReason: choice?.finish_reason, thinking: body.thinking?.type ?? "provider_default", contentLength: choice?.message?.content?.length ?? 0 });
  return response;
};
const results = [];
const filterIndex = process.argv.indexOf("--filter");
const selected = filterIndex < 0 ? cases : cases.filter((item) => item.id.includes(process.argv[filterIndex + 1]));
for (const item of selected) {
  const started = Date.now();
  const diagnosticStart = requestDiagnostics.length;
  try {
    const result = await askDeepSeekHost({ mode: "ask", puzzle: item.puzzle, content: item.question, puzzleMessages: item.history });
    const payload = JSON.parse(result.content);
    const requests = requestDiagnostics.slice(diagnosticStart);
    const readingsComplete = requests.filter((r) => r.stage !== "fact_summary").every((r) => r.status === 200 && r.contentLength > 0 && r.finishReason !== "length");
    const pass = item.expected.includes(result.answerType) && readingsComplete;
    results.push({ id: item.id, question: item.question, expected: item.expected, pass, answerType: result.answerType, audit: payload.ask_audit, requests, elapsedMs: Date.now() - started });
    console.log(`${pass ? "PASS" : "FAIL"} ${item.id}: ${result.answerType} (strict=${payload.ask_audit.strict.answer_type}, inferential=${payload.ask_audit.inferential.answer_type})`);
  } catch (error) {
    // Provider errors can contain private diagnostics; save only the error class.
    const httpStatus = error?.message?.match(/请求失败：(\d{3})/)?.[1];
    const category = httpStatus ? `http_${httpStatus}` : /截断/.test(error?.message) ? "output_truncated"
      : /超时|abort/i.test(error?.message) ? "timeout"
      : error?.name === "ZodError" ? "schema_validation"
      : /JSON/.test(error?.message) ? "json_parse"
      : /没有返回内容/.test(error?.message) ? "empty_content" : "provider_error";
    results.push({ id: item.id, pass: false, error: error?.name ?? "Error", category, requests: requestDiagnostics.slice(diagnosticStart) });
    console.log(`ERROR ${item.id}`);
  }
}
const outputIndex = process.argv.indexOf("--output");
const report = { generatedAt: new Date().toISOString(), model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash", passed: results.filter((r) => r.pass).length, total: results.length, results };
if (outputIndex >= 0) await writeFile(process.argv[outputIndex + 1], JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(`Result: ${report.passed}/${report.total}`);
if (report.passed !== report.total) process.exitCode = 1;
