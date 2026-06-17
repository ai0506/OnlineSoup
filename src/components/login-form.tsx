"use client";

import { useState } from "react";

import { login, signup } from "@/app/auth/actions";
import { FlashCookieCleaner } from "@/components/flash-cookie-cleaner";
import { SubmitButton } from "@/components/submit-button";

type LoginFormProps = {
  configured: boolean;
  errorMessage: string | null;
  hasFlash?: boolean;
  noticeMessage: string | null;
};

export function LoginForm({
  configured,
  errorMessage,
  hasFlash = false,
  noticeMessage,
}: LoginFormProps) {
  const [mode, setMode] = useState<"login" | "signup">("login");

  return (
    <section className="auth-page">
      {hasFlash && <FlashCookieCleaner />}
      {!configured && (
        <div className="error">
          尚未配置 Supabase，请先按 README 创建 <code>.env.local</code>。
        </div>
      )}
      {errorMessage && <div className="error">{errorMessage}</div>}
      {noticeMessage && <div className="notice">{noticeMessage}</div>}

      <div className="auth-toggle" role="group" aria-label="切换登录或注册">
        <button
          className={`auth-toggle-btn${mode === "login" ? " active" : ""}`}
          onClick={() => setMode("login")}
          type="button"
        >
          登录
        </button>
        <button
          className={`auth-toggle-btn${mode === "signup" ? " active" : ""}`}
          onClick={() => setMode("signup")}
          type="button"
        >
          注册
        </button>
      </div>

      {mode === "login" ? (
        <form action={login} className="form-card form-grid">
          <label>
            邮箱
            <input
              autoComplete="email"
              disabled={!configured}
              name="email"
              placeholder="you@example.com"
              required
              type="email"
            />
          </label>
          <label>
            密码
            <input
              autoComplete="current-password"
              disabled={!configured}
              minLength={6}
              name="password"
              placeholder="至少 6 位"
              required
              type="password"
            />
          </label>
          <SubmitButton pendingText="正在登录...">登录</SubmitButton>
          <p className="auth-switch">
            还没有账户？{" "}
            <button className="link-button" onClick={() => setMode("signup")} type="button">
              立即注册
            </button>
          </p>
        </form>
      ) : (
        <form action={signup} className="form-card form-grid">
          <label>
            用户名
            <input
              autoComplete="username"
              disabled={!configured}
              maxLength={8}
              minLength={3}
              name="username"
              pattern="[A-Za-z0-9_]{3,8}"
              placeholder="例如 Soup_01"
              required
            />
            <span className="help">3 到 8 位英文字母、数字或下划线，全站唯一。</span>
          </label>
          <label>
            邮箱
            <input
              autoComplete="email"
              disabled={!configured}
              name="email"
              placeholder="you@example.com"
              required
              type="email"
            />
          </label>
          <label>
            密码
            <input
              autoComplete="new-password"
              disabled={!configured}
              minLength={6}
              name="password"
              placeholder="至少 6 位"
              required
              type="password"
            />
          </label>
          <SubmitButton pendingText="正在注册...">注册新账户</SubmitButton>
          <p className="auth-switch">
            已有账户？{" "}
            <button className="link-button" onClick={() => setMode("login")} type="button">
              直接登录
            </button>
          </p>
        </form>
      )}
    </section>
  );
}
