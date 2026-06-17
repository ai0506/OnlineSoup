import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

function redirectTo(path: string) {
  return new NextResponse(null, {
    status: 307,
    headers: { Location: path },
  });
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams
    .get("code")
    ?.trim()
    .toUpperCase();

  if (!code || !/^[A-Z0-9]{6}$/.test(code)) {
    return redirectTo("/?error=invalid_room_code");
  }

  if (hasSupabaseEnv()) {
    const supabase = await createClient();
    const { data: claimsData } = await supabase.auth.getClaims();
    const userId = claimsData?.claims?.sub;

    if (userId) {
      const { data: activeRoomCode } =
        await supabase.rpc("get_my_active_room");

      if (activeRoomCode) {
        const { data: activeRoom } = await supabase
          .from("rooms")
          .select("code")
          .eq("code", activeRoomCode)
          .neq("status", "closed")
          .maybeSingle();

        if (activeRoom) {
          return redirectTo(`/rooms/${activeRoom.code}`);
        }
      }
    } else {
      const cookieStore = await cookies();
      const guestCookies = cookieStore
        .getAll()
        .filter((cookie) => cookie.name.startsWith("guest_room_"))
        .sort((left, right) => {
          const leftCode = left.name.slice("guest_room_".length);
          const rightCode = right.name.slice("guest_room_".length);
          return Number(rightCode === code) - Number(leftCode === code);
        });

      for (const guestCookie of guestCookies) {
        const guestRoomCode = guestCookie.name.slice("guest_room_".length);
        const { data: isMember } = await supabase.rpc(
          "verify_guest_membership",
          {
            room_code: guestRoomCode,
            guest_token: guestCookie.value,
          },
        );

        if (isMember) {
          const { data: activeGuestRoom } = await supabase
            .from("rooms")
            .select("code")
            .eq("code", guestRoomCode)
            .neq("status", "closed")
            .maybeSingle();

          if (!activeGuestRoom) {
            continue;
          }

          return redirectTo(`/rooms/${activeGuestRoom.code}`);
        }
      }
    }
  }

  return redirectTo(`/rooms/${code}`);
}
