import { redirect } from "next/navigation";

import { updateUsername } from "@/app/account/username/actions";
import { FlashCookieCleaner } from "@/components/flash-cookie-cleaner";
import { SubmitButton } from "@/components/submit-button";
import { flashRedirectPath, getFlashMessage } from "@/lib/flash";
import { createClient } from "@/lib/supabase/server";

type UsernamePageProps = {
  searchParams: Promise<{ error?: string; message?: string }>;
};

const errors: Record<string, string> = {
  invalid_username:
    "用户名需要 3 到 8 位，只能使用英文字母、数字和下划线",
  username_taken: "这个用户名已经被使用，请换一个",
  active_room_exists: "请先退出或关闭当前房间，再修改用户名",
  room_name_conflict: "当前房间里已经有人使用这个名字，请先处理重名",
  update_failed: "用户名保存失败，请稍后重试",
};

export default async function UsernamePage({
  searchParams,
}: UsernamePageProps) {
  const params = await searchParams;
  const flash = await getFlashMessage("username");
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (!userId) {
    redirect(flashRedirectPath("/login", {
      code: "login_required",
      kind: "error",
      scope: "login",
    }));
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", userId)
    .single();

  return (
    <section className="form-card">
      {flash && <FlashCookieCleaner />}
      <p className="eyebrow">账户</p>
      <h1>{profile?.username ? "修改用户名" : "设置用户名"}</h1>
      <p className="lead">
        登录后进入房间会直接使用用户名。用户名忽略大小写且全站唯一。
      </p>
      {(flash?.kind === "error" || params.error) && (
        <div className="error">
          {errors[flash?.kind === "error" ? flash.code : params.error!] ?? errors.update_failed}
        </div>
      )}
      {(flash?.kind === "notice" ? flash.code : params.message) === "username_updated" && (
        <div className="notice">用户名已保存。</div>
      )}
      <form action={updateUsername} className="form-grid">
        <label>
          用户名
          <input
            autoComplete="username"
            defaultValue={profile?.username ?? ""}
            maxLength={8}
            minLength={3}
            name="username"
            pattern="[A-Za-z0-9_]{3,8}"
            required
          />
          <span className="help">
            3 到 8 位，只能使用英文字母、数字和下划线。
          </span>
        </label>
        <SubmitButton pendingText="正在保存...">保存用户名</SubmitButton>
      </form>
    </section>
  );
}
