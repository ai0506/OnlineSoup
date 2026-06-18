"use client";

import { FormEvent, useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

type ResetPasswordFormProps = {
  initialError?: string | null;
};

const errors: Record<string, string> = {
  invalid_email_callback: "邮箱验证链接无效或已过期，请重新发送重置密码邮件。",
  invalid_password: "两次密码必须一致，且长度为 6 到 72 位。",
  update_failed: "密码修改失败，请重新打开邮件中的链接。",
};

export function ResetPasswordForm({ initialError }: ResetPasswordFormProps) {
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [isReady, setIsReady] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    void supabase.auth.getUser().then(({ data, error: userError }) => {
      if (userError || !data.user) {
        setError("invalid_email_callback");
      } else {
        setEmail(data.user.email ?? null);
      }
      setIsReady(true);
    });
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    const confirmation = String(formData.get("confirmation") ?? "");

    if (password.length < 6 || password.length > 72 || password !== confirmation) {
      setError("invalid_password");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError("update_failed");
      setIsSubmitting(false);
      return;
    }

    await supabase.auth.signOut();
    window.location.assign("/login?message=password_updated");
  }

  if (!isReady) {
    return (
      <section className="form-card">
        <p className="eyebrow">账户安全</p>
        <h1>设置新密码</h1>
        <p className="lead">正在验证重置链接...</p>
      </section>
    );
  }

  const message = error ? errors[error] ?? "操作失败。" : null;
  const canSubmit =
    !error || error === "invalid_password" || error === "update_failed";

  return (
    <section className="form-card">
      <p className="eyebrow">账户安全</p>
      <h1>设置新密码</h1>
      <p className="lead">
        {email ? `为 ${email} 设置一个新的登录密码。` : "请先打开最新的重置密码邮件。"}
      </p>

      {message && <div className="error">{message}</div>}

      {canSubmit && (
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            新密码
            <input
              autoComplete="new-password"
              maxLength={72}
              minLength={6}
              name="password"
              required
              type="password"
            />
          </label>
          <label>
            再输入一次
            <input
              autoComplete="new-password"
              maxLength={72}
              minLength={6}
              name="confirmation"
              required
              type="password"
            />
          </label>
          <button className="button" disabled={isSubmitting} type="submit">
            {isSubmitting ? "保存中..." : "保存新密码"}
          </button>
        </form>
      )}
    </section>
  );
}
