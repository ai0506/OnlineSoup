import { redirect } from "next/navigation";

import { setNewPassword } from "@/app/reset-password/actions";
import { FlashCookieCleaner } from "@/components/flash-cookie-cleaner";
import { SubmitButton } from "@/components/submit-button";
import { getFlashMessage } from "@/lib/flash";
import { createClient } from "@/lib/supabase/server";

type ResetPasswordPageProps = {
  searchParams: Promise<{ error?: string }>;
};

const errors: Record<string, string> = {
  invalid_password: "两次密码必须一致，且长度为 6 到 72 位。",
  update_failed: "密码修改失败，请重新打开邮件中的链接。",
};

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { error } = await searchParams;
  const flash = await getFlashMessage("reset-password");
  const errorCode = flash?.kind === "error" ? flash.code : error;

  return (
    <section className="form-card">
      {flash && <FlashCookieCleaner />}
      <p className="eyebrow">账户安全</p>
      <h1>设置新密码</h1>
      <p className="lead">为 {user.email} 设置一个新的登录密码。</p>

      {errorCode && <div className="error">{errors[errorCode] ?? "操作失败。"}</div>}

      <form action={setNewPassword} className="form-grid">
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
        <SubmitButton pendingText="保存中...">保存新密码</SubmitButton>
      </form>
    </section>
  );
}
