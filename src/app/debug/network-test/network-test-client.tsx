"use client";

import { useMemo, useState, useSyncExternalStore } from "react";

import { createClient } from "@/lib/supabase/client";
import { getSupabaseEnv } from "@/lib/env";

type MetricId = "next" | "rest" | "rpc" | "auth" | "realtime";

type Sample = {
  ms: number;
  ok: boolean;
  error?: string;
};

type Metric = {
  id: MetricId;
  title: string;
  route: string;
  samples: Sample[];
};

const METRIC_INFO: Record<MetricId, Omit<Metric, "samples">> = {
  next: {
    id: "next",
    title: "Next.js Route Handler",
    route: "客户端 → Vercel/Next.js → 客户端",
  },
  rest: {
    id: "rest",
    title: "Supabase REST / SELECT",
    route: "客户端 → Supabase Cloud REST → 客户端",
  },
  rpc: {
    id: "rpc",
    title: "只读 RPC / is_username_available",
    route: "客户端 → Supabase Cloud RPC → 客户端",
  },
  auth: {
    id: "auth",
    title: "Supabase Auth / getUser",
    route: "客户端 → Supabase Cloud Auth → 客户端",
  },
  realtime: {
    id: "realtime",
    title: "Supabase Realtime 建连",
    route: "客户端 → Supabase Cloud WebSocket → 客户端",
  },
};

const METRIC_ORDER: MetricId[] = ["next", "rest", "rpc", "auth", "realtime"];
const REQUEST_TIMEOUT_MS = 12_000;

function percentile(samples: Sample[], p: number) {
  const values = samples.filter((sample) => sample.ok).map((sample) => sample.ms).sort((a, b) => a - b);
  if (!values.length) return null;
  return values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)];
}

function summarize(metric: Metric) {
  const successful = metric.samples.filter((sample) => sample.ok).map((sample) => sample.ms);
  return {
    latest: metric.samples.at(-1)?.ms ?? null,
    average: successful.length ? successful.reduce((sum, ms) => sum + ms, 0) / successful.length : null,
    min: successful.length ? Math.min(...successful) : null,
    max: successful.length ? Math.max(...successful) : null,
    p95: percentile(metric.samples, 0.95),
    failures: metric.samples.filter((sample) => !sample.ok).length,
    tests: metric.samples.length,
  };
}

function formatMs(value: number | null) {
  return value === null ? "—" : `${Math.round(value)} ms`;
}

function timeoutSignal() {
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

async function measure(task: (signal: AbortSignal) => Promise<void>): Promise<Sample> {
  const started = performance.now();
  try {
    await task(timeoutSignal());
    return { ms: performance.now() - started, ok: true };
  } catch (error) {
    return {
      ms: performance.now() - started,
      ok: false,
      error: error instanceof Error ? error.message : "请求失败",
    };
  }
}

function noCacheHeaders(publishableKey: string) {
  return {
    apikey: publishableKey,
    Accept: "application/json",
    "Cache-Control": "no-cache, no-store",
    Pragma: "no-cache",
  };
}

export function NetworkTestClient() {
  const supabase = useMemo(() => createClient(), []);
  const { url: supabaseUrl, publishableKey } = useMemo(() => getSupabaseEnv(), []);
  const [metrics, setMetrics] = useState<Metric[]>(() =>
    METRIC_ORDER.map((id) => ({ ...METRIC_INFO[id], samples: [] })),
  );
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const clientHostname = useSyncExternalStore(
    () => () => undefined,
    () => window.location.hostname,
    () => "未知",
  );
  const supabaseHostname = useMemo(() => new URL(supabaseUrl).hostname, [supabaseUrl]);

  const runNext = () => measure(async (signal) => {
    const response = await fetch(`/debug/network-test/ping?cb=${crypto.randomUUID()}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache, no-store", Pragma: "no-cache" },
      signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await response.json();
  });

  const runRest = () => measure(async (signal) => {
    const endpoint = new URL("/rest/v1/rooms", supabaseUrl);
    endpoint.searchParams.set("select", "id");
    endpoint.searchParams.set("limit", "1");
    endpoint.searchParams.set("_cb", crypto.randomUUID());
    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: noCacheHeaders(publishableKey),
      signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await response.json();
  });

  const runRpc = () => measure(async (signal) => {
    const endpoint = new URL("/rest/v1/rpc/is_username_available", supabaseUrl);
    endpoint.searchParams.set("_cb", crypto.randomUUID());
    const response = await fetch(endpoint, {
      method: "POST",
      cache: "no-store",
      headers: { ...noCacheHeaders(publishableKey), "Content-Type": "application/json" },
      body: JSON.stringify({ requested_username: `zz${Math.random().toString(36).slice(2, 8)}` }),
      signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await response.json();
  });

  const runAuth = () => measure(async (signal) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const endpoint = new URL("/auth/v1/user", supabaseUrl);
    endpoint.searchParams.set("_cb", crypto.randomUUID());
    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: {
        ...noCacheHeaders(publishableKey),
        ...(sessionData.session?.access_token
          ? { Authorization: `Bearer ${sessionData.session.access_token}` }
          : {}),
      },
      signal,
    });
    if (!response.ok) throw new Error(response.status === 401 ? "未登录（Auth 请求已到达）" : `HTTP ${response.status}`);
    await response.json();
  });

  const runRealtime = () => measure((signal) => new Promise<void>((resolve, reject) => {
    const channel = supabase.channel(`network-test-${crypto.randomUUID()}`);
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      void supabase.removeChannel(channel);
      if (error) reject(error);
      else resolve();
    };
    signal.addEventListener("abort", () => finish(new Error("请求超时")), { once: true });
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") finish();
      if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) finish(new Error(status));
    });
  }));

  const runOne = async () => {
    const samples = await Promise.all([runNext(), runRest(), runRpc(), runAuth(), runRealtime()]);
    setMetrics((current) => current.map((metric, index) => ({
      ...metric,
      samples: [...metric.samples, samples[index]],
    })));
  };

  const runTests = async (count: number) => {
    if (running) return;
    setRunning(true);
    setNotice("");
    try {
      for (let index = 0; index < count; index += 1) {
        setProgress(`${index + 1} / ${count}`);
        await runOne();
      }
      setLastRunAt(new Date().toISOString());
      setNotice(`已完成 ${count} 轮。Realtime 当前只测建连，不发送广播 RTT。`);
    } finally {
      setRunning(false);
      setProgress("");
    }
  };

  const exportPayload = {
    schema: "onlinesoup.network-test.v1",
    capturedAt: lastRunAt,
    clientHostname,
    supabaseHostname,
    cacheBypass: true,
    realtimeRtt: "skipped: no persistent business data or reliable isolated echo channel",
    metrics: Object.fromEntries(metrics.map((metric) => [metric.id, {
      ...METRIC_INFO[metric.id],
      summary: summarize(metric),
      samples: metric.samples,
    }])),
  };

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(exportPayload, null, 2));
      setNotice("JSON 已复制到剪贴板。结果不包含密钥、JWT 或 Cookie。 ");
    } catch {
      setNotice("浏览器未允许访问剪贴板，请改用“导出 JSON”。");
    }
  };

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `onlinesoup-network-test-${new Date().toISOString().replaceAll(":", "-")}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <section className="network-test-page">
      <div className="network-test-heading">
        <div>
          <p className="eyebrow">TEMPORARY DEBUG TOOL</p>
          <h1>网络性能测试</h1>
          <p className="lead">比较当前 Next.js/Vercel 与 Supabase Cloud 的端到端访问表现。每次请求都附带随机参数并使用 no-store。</p>
        </div>
        <div className="network-test-actions">
          <button className="button" type="button" onClick={() => void runTests(1)} disabled={running}>Run once</button>
          <button className="button secondary" type="button" onClick={() => void runTests(20)} disabled={running}>Run 20 tests</button>
        </div>
      </div>

      <div className="network-test-meta card">
        <div><span>测试时间</span><strong>{lastRunAt ? new Date(lastRunAt).toLocaleString("zh-CN") : "尚未运行"}</strong></div>
        <div><span>当前 hostname</span><strong>{clientHostname}</strong></div>
        <div><span>Supabase hostname</span><strong>{supabaseHostname}</strong></div>
        <div><span>运行状态</span><strong>{running ? `进行中 ${progress}` : "就绪"}</strong></div>
      </div>

      <div className="network-test-toolbar">
        <span className="network-test-notice" role="status">{notice}</span>
        <div className="network-test-export-actions">
          <button className="button ghost" type="button" onClick={() => void copyJson()} disabled={running}>复制 JSON</button>
          <button className="button ghost" type="button" onClick={downloadJson} disabled={running}>导出 JSON</button>
        </div>
      </div>

      <div className="network-test-grid">
        {metrics.map((metric) => {
          const summary = summarize(metric);
          const latest = metric.samples.at(-1);
          return (
            <article className="card network-test-card" key={metric.id}>
              <div className="network-test-card-heading">
                <div><h2>{metric.title}</h2><p>{metric.route}</p></div>
                <span className={`network-test-status ${latest ? (latest.ok ? "ok" : "failed") : "idle"}`}>{latest ? (latest.ok ? "OK" : "失败") : "未测试"}</span>
              </div>
              <div className="network-test-stats">
                <div><span>latest</span><strong>{formatMs(summary.latest)}</strong></div>
                <div><span>average</span><strong>{formatMs(summary.average)}</strong></div>
                <div><span>min</span><strong>{formatMs(summary.min)}</strong></div>
                <div><span>max</span><strong>{formatMs(summary.max)}</strong></div>
                <div><span>p95</span><strong>{formatMs(summary.p95)}</strong></div>
                <div><span>failures</span><strong>{summary.failures} / {summary.tests}</strong></div>
              </div>
              <p className="network-test-card-note">{latest?.error ?? (metric.id === "realtime" ? "只测 WebSocket channel 建连与清理；未产生业务数据。" : "" )}</p>
            </article>
          );
        })}
      </div>

      <div className="card network-test-safety">
        <strong>测试边界</strong>
        <p>REST 只读取公开 rooms 的一行 id；RPC 只调用稳定的 is_username_available；Auth 不改变会话；Realtime 使用随机临时频道并在完成后移除。导出结果只含耗时、状态和 hostname。</p>
      </div>
    </section>
  );
}
