import Link from "next/link";

import { LogoutButton } from "@/components/logout-button";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function SiteHeader() {
  let email: string | undefined;
  let username: string | null | undefined;
  let points: number | undefined;

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
      username = profile?.username;
      points = profile?.points;
    }
  }

  return (
    <header className="site-header">
      <Link className="brand" href="/">
        汤局
      </Link>
      <nav>
        <Link href="/">大厅</Link>
        <Link href="/tutorial">教程</Link>
        {email ? (
          <>
            <Link href="/rooms/new">创建房间</Link>
            {points !== undefined && (
              <span className="user-points">{points} 积分</span>
            )}
            <Link href="/account/username">{username ?? "设置用户名"}</Link>
            <LogoutButton />
          </>
        ) : (
          <Link href="/login">登录</Link>
        )}
      </nav>
    </header>
  );
}
