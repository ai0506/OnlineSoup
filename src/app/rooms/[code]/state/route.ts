import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import type { RoomMemberState } from "@/lib/types";

type Context = { params: Promise<{ code: string }> };

export async function GET(_request: Request, { params }: Context) {
  const code = (await params).code.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    return NextResponse.json({ error: "房间码格式不正确" }, { status: 400 });
  }
  const cookieStore = await cookies();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_room_member_state", {
    p_room_code: code,
    p_guest_token: cookieStore.get(`guest_room_${code}`)?.value ?? null,
  });
  if (error) {
    const status = error.message.includes("room_device_in_use") || error.message.includes("membership") ? 403
      : error.message.includes("room_not_found") ? 404
        : error.message.includes("room_closed") ? 410 : 500;
    return NextResponse.json({ error: "无法读取房间状态" }, { status });
  }
  return NextResponse.json({ state: data as RoomMemberState }, { headers: { "Cache-Control": "no-store" } });
}
