import { sendAdminEmailCode, verifyAdminEmailCode } from "@/app/admin/verify/actions";
import { SubmitButton } from "@/components/submit-button";
import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

type AdminVerifyPageProps = {
  searchParams: Promise<{
    error?: string;
    message?: string;
  }>;
};

const errors: Record<string, string> = {
  missing_email: "当前管理员账号没有邮箱，无法完成二次验证。",
  send_failed: "验证码发送失败，请稍后重试。",
  invalid_code: "请输入邮件中的 6 到 8 位验证码，或点击邮件中的验证链接。",
  verify_failed: "验证码无效或已过期，请重新发送后再试。",
};

const messages: Record<string, string> = {
  code_sent: "验证邮件已发送到管理员邮箱，可输入验证码或直接点击邮件中的链接。",
};

export default async function AdminVerifyPage({ searchParams }: AdminVerifyPageProps) {
  const user = await requireAdmin({ requireVerified: false });
  const params = await searchParams;

  return (
    <section className="auth-page">
      <div className="form-card form-grid">
        <div>
          <p className="eyebrow">管理端二次认证</p>
          <h1>验证管理员邮箱</h1>
          <p className="muted">
            当前浏览器首次进入管理端，需要使用 {user.email} 收到的验证码或验证链接确认身份。
          </p>
        </div>

        {params.error && (
          <div className="error">{errors[params.error] ?? "验证失败，请稍后重试。"}</div>
        )}
        {params.message && (
          <div className="notice">{messages[params.message] ?? "操作成功。"}</div>
        )}

        <form action={sendAdminEmailCode}>
          <SubmitButton className="button secondary" pendingText="正在发送...">
            发送邮箱验证码
          </SubmitButton>
        </form>

        <form action={verifyAdminEmailCode} className="form-grid">
          <label>
            邮箱验证码
            <input
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={8}
              minLength={6}
              name="token"
              pattern="[0-9]{6,8}"
              placeholder="6 到 8 位验证码（可选）"
              required
            />
          </label>
          <label className="checkbox-label">
            <input name="remember_device" type="checkbox" />
            记住此设备（30 天内免验证）
          </label>
          <SubmitButton pendingText="正在验证...">进入管理端</SubmitButton>
        </form>
      </div>
    </section>
  );
}
