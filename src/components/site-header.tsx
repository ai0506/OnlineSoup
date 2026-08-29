import Link from "next/link";

import { SiteNav } from "@/components/site-nav";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function SiteHeader() {
  let email: string | undefined;
  let username: string | null = null;
  let points: number | null = null;
  let activeRoomCode: string | null = null;

  if (hasSupabaseEnv()) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    email = data?.claims?.email as string | undefined;
    const userId = data?.claims?.sub;
    if (userId) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("username, points")
        .eq("id", userId)
        .maybeSingle();
      username = profile?.username ?? null;
      points = profile?.points ?? null;

      // 已在房间时，创建房间会被重定向回原房间，顶部栏直接改成返回入口
      const { data: roomCode } = await supabase.rpc("get_my_active_room");
      activeRoomCode = (roomCode as string | null) ?? null;
    }
  }

  return (
    <header className="site-header">
      <Link className="brand" href="/">
        汤局
      </Link>
      <SiteNav
        activeRoomCode={activeRoomCode}
        points={points}
        signedIn={Boolean(email)}
        username={username}
      />
    </header>
  );
}
