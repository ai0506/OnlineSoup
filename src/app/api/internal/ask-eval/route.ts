import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { askEvalRequestSchema, runAskEvalCase } from "@/lib/ask-eval";

export const runtime = "nodejs";
export const maxDuration = 60;

const noStore = { "Cache-Control": "no-store" };

function notFound() {
  return new NextResponse(null, { status: 404, headers: noStore });
}

/** Paid model calls: only on non-production deployments, only with the shared evaluation token. */
function isAuthorized(request: Request) {
  if (process.env.VERCEL_ENV === "production") return false;
  const expected = process.env.ASK_EVAL_TOKEN;
  const provided = request.headers.get("x-ask-eval-token");
  if (!expected || expected.length < 32 || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return notFound();

  const body = await request.json().catch(() => null);
  const parsed = askEvalRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: noStore });
  }

  try {
    const result = await runAskEvalCase(parsed.data);
    return NextResponse.json(
      { ...result, region: process.env.VERCEL_REGION ?? "local" },
      { headers: noStore },
    );
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith("Facts 校验失败") ? error.message : "eval_failed";
    return NextResponse.json({ error: message }, { status: 400, headers: noStore });
  }
}
