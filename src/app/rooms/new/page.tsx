import { redirect } from "next/navigation";

import { CreateRoomForm } from "@/components/create-room-form";
import { flashRedirectPath } from "@/lib/flash";
import { createClient } from "@/lib/supabase/server";

export default async function NewRoomPage() {
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

  const { data: activeRoomCode } = await supabase.rpc("get_my_active_room");

  if (activeRoomCode) {
    redirect(`/rooms/${activeRoomCode}`);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("points, username")
    .eq("id", userId)
    .single();

  if (!profile?.username) {
    redirect("/account/username");
  }

  // 默认房间名为「{房主名}的房间」，房间名上限 8 字，"的房间" 占 3 字，
  // 因此房主名最多保留 5 字，超出部分截断。
  const defaultRoomName = `${profile.username.slice(0, 5)}的房间`;

  return (
    <section className="form-card">
      <h1>创建房间</h1>
      <p className="lead">
        填好后即可邀请朋友加入。你当前有
        <strong> {profile?.points ?? 0} 积分</strong>。
      </p>
      <CreateRoomForm currentPoints={profile?.points ?? 0} defaultRoomName={defaultRoomName} />
    </section>
  );
}
