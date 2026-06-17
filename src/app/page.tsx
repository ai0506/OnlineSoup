import Link from "next/link";
import { cookies } from "next/headers";

import { FlashCookieCleaner } from "@/components/flash-cookie-cleaner";
import { hasSupabaseEnv } from "@/lib/env";
import { getFlashMessage } from "@/lib/flash";
import { createClient } from "@/lib/supabase/server";

type HomePageProps = {
  searchParams: Promise<{ error?: string; notice?: string }>;
};

const homeErrors: Record<string, string> = {
  invalid_room_code: "请输入正确的 6 位房间码",
};

const homeNotices: Record<string, string> = {
  room_closed: "房间已关闭",
  room_left: "你已退出房间",
  room_kicked: "你已被房主移出房间",
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const { error, notice } = await searchParams;
  const flash = await getFlashMessage("home");
  const errorCode = flash?.kind === "error" ? flash.code : error;
  const noticeCode = flash?.kind === "notice" ? flash.code : notice;
  const errorMessage = errorCode ? homeErrors[errorCode] ?? "操作失败，请稍后重试" : null;
  const noticeMessage = noticeCode ? homeNotices[noticeCode] ?? null : null;

  let userId: string | undefined;
  let memberRoomCode: string | undefined;

  if (hasSupabaseEnv()) {
    const supabase = await createClient();
    const { data: claimsData } = await supabase.auth.getClaims();
    userId = claimsData?.claims?.sub;

    if (userId) {
      const { data } = await supabase.rpc("get_my_active_room");
      memberRoomCode = data ?? undefined;
    }
  }

  // 离开/被踢/房间关闭时不检测 cookie，避免残留 cookie 造成误判
  const isExiting =
    noticeCode === "room_left" || noticeCode === "room_kicked" || noticeCode === "room_closed";

  let guestRoomCode: string | undefined;
  if (!memberRoomCode && !userId && !isExiting) {
    const cookieStore = await cookies();
    const guestCookie = cookieStore
      .getAll()
      .find((c) => c.name.startsWith("guest_room_"));
    if (guestCookie) {
      guestRoomCode = guestCookie.name.slice("guest_room_".length);
    }
  }

  const activeRoomCode = memberRoomCode ?? guestRoomCode;

  return (
    <>
      {flash && <FlashCookieCleaner />}
      {errorMessage && <div className="error">{errorMessage}</div>}
      {noticeMessage && <div className="notice">{noticeMessage}</div>}
      <section className="join-landing">
        <div className="join-heading">
          <h1>{activeRoomCode ? "你已在房间中" : "加入房间"}</h1>
        </div>
        {activeRoomCode ? (
          <div className="active-room-notice">
            <p className="muted">
              请先返回当前房间，或退出后再加入其他房间。
            </p>
            <Link className="button" href={`/rooms/${activeRoomCode}`}>
              返回房间
            </Link>
          </div>
        ) : (
          <form action="/rooms/go" className="form-grid" method="get">
            <input
              aria-label="房间码"
              autoCapitalize="characters"
              autoComplete="off"
              autoFocus
              className="room-code-input"
              maxLength={6}
              minLength={6}
              name="code"
              placeholder="输入房间码"
              required
            />
            <button className="button" type="submit">
              继续
            </button>
          </form>
        )}
        {!activeRoomCode && (
          <div className="join-secondary-action">
            {userId ? (
              <Link href="/rooms/new">创建房间</Link>
            ) : (
              <Link href="/login">登录并创建房间</Link>
            )}
          </div>
        )}
      </section>
    </>
  );
}
