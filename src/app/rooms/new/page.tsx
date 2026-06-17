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

  return (
    <section className="form-card">
      <h1>创建房间</h1>
      <p className="lead">
        填好后即可邀请朋友加入。你当前有
        <strong> {profile?.points ?? 0} 积分</strong>。
      </p>
      <CreateRoomForm currentPoints={profile?.points ?? 0} />
    </section>
  );
}
