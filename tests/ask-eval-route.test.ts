import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/internal/ask-eval/route";

const TOKEN = "t".repeat(40);

function request(token?: string, body: unknown = {}) {
  return new Request("http://localhost/api/internal/ask-eval", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "x-ask-eval-token": token } : {}) },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("internal ask eval route guard", () => {
  it("is invisible in production even with the right token", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ASK_EVAL_TOKEN", TOKEN);
    expect((await POST(request(TOKEN))).status).toBe(404);
  });

  it("is invisible when no token is configured", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("ASK_EVAL_TOKEN", "");
    expect((await POST(request(TOKEN))).status).toBe(404);
  });

  it("rejects missing, wrong, and too-short tokens", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("ASK_EVAL_TOKEN", TOKEN);
    expect((await POST(request())).status).toBe(404);
    expect((await POST(request("x".repeat(40)))).status).toBe(404);
    vi.stubEnv("ASK_EVAL_TOKEN", "short");
    expect((await POST(request("short"))).status).toBe(404);
  });

  it("validates the body before making any model call", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("ASK_EVAL_TOKEN", TOKEN);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await POST(request(TOKEN, { engine: "new" }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
