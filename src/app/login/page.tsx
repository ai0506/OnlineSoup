import { LoginForm } from "@/components/login-form";
import { hasSupabaseEnv } from "@/lib/env";
import { getFlashMessage } from "@/lib/flash";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
    message?: string;
  }>;
};

const loginErrors: Record<string, string> = {
  login_required: "请先登录后再创建房间",
  invalid_credentials_form: "请输入有效邮箱或用户名，密码至少需要 6 位",
  invalid_signup_form: "请填写有效邮箱、至少 6 位密码，以及 3 到 8 位英数字下划线用户名",
  invalid_credentials: "邮箱/用户名或密码不正确",
  username_taken: "这个用户名已经被使用，请换一个",
  database_migration_required: "数据库尚未安装用户名功能，请联系管理员",
  signup_failed: "注册失败，请稍后重试",
  invalid_email_callback: "邮箱验证链接无效或已过期",
};

const loginMessages: Record<string, string> = {
  signup_confirmation_sent: "注册成功，请打开验证邮件后再登录。",
  password_updated: "密码已更新，请使用新密码登录。",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error, message } = await searchParams;
  const flash = await getFlashMessage("login");
  const configured = hasSupabaseEnv();
  const errorCode = flash?.kind === "error" ? flash.code : error;
  const messageCode = flash?.kind === "notice" ? flash.code : message;
  const errorMessage = errorCode ? loginErrors[errorCode] ?? "操作失败，请稍后重试" : null;
  const noticeMessage = messageCode ? loginMessages[messageCode] ?? null : null;

  return (
    <LoginForm
      configured={configured}
      errorMessage={errorMessage}
      hasFlash={Boolean(flash)}
      noticeMessage={noticeMessage}
    />
  );
}
