import { redirect } from "next/navigation";

import { submitFeedback } from "@/app/feedback/actions";
import { FeedbackForm } from "@/components/feedback-form";
import { FlashCookieCleaner } from "@/components/flash-cookie-cleaner";
import { hasSupabaseEnv } from "@/lib/env";
import { flashRedirectPath, getFlashMessage } from "@/lib/flash";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type FeedbackPageProps = {
  searchParams: Promise<{ error?: string; message?: string }>;
};

const errors: Record<string, string> = {
  invalid_feedback: "请选择反馈类型，并填写 1 到 2000 字的反馈内容。",
  feedback_rate_limited: "发送太频繁，请稍后再试。",
  feedback_failed: "反馈提交失败，请稍后重试。",
};

export default async function FeedbackPage({
  searchParams,
}: FeedbackPageProps) {
  if (!hasSupabaseEnv()) {
    redirect("/");
  }

  const params = await searchParams;
  const flash = await getFlashMessage("feedback");
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();

  if (!claimsData?.claims?.sub) {
    redirect(
      flashRedirectPath("/login", {
        code: "login_required_feedback",
        kind: "error",
        scope: "login",
      }),
    );
  }

  const errorCode = flash?.kind === "error" ? flash.code : params.error;
  const messageCode = flash?.kind === "notice" ? flash.code : params.message;

  return (
    <section className="form-card feedback-card">
      {flash && <FlashCookieCleaner />}
      <p className="eyebrow">意见反馈</p>
      <h1>告诉我们你的想法</h1>
      <p className="lead">
        遇到问题、有改进建议，或者想投稿一道汤，都可以写在这里。这个页面可以单独打开，不会影响你正在进行的房间。
      </p>

      {errorCode && (
        <div className="error">{errors[errorCode] ?? errors.feedback_failed}</div>
      )}
      {messageCode === "feedback_submitted" && (
        <div className="notice">
          反馈已提交，感谢你的反馈。我们会在后台逐条查看。
        </div>
      )}

      <FeedbackForm action={submitFeedback} />
    </section>
  );
}
