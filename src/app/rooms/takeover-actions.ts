"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const confirmation = z.object({ code: z.string().regex(/^[A-Z0-9]{6}$/), version: z.string().regex(/^[a-f0-9]{64}$/) });
export type TakeoverState = { version: string; cliInUse: boolean; message: string };

export async function confirmCliRoomTakeover(previous: TakeoverState, form: FormData): Promise<TakeoverState> {
  const parsed = confirmation.safeParse({ code: form.get("code"), version: form.get("version") });
  if (!parsed.success) return { version: "", cliInUse: false, message: "确认信息无效，请返回大厅重新进入。" };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { version: "", cliInUse: false, message: "登录已失效，请返回大厅重新登录。" };
  const { data, error } = await supabase.rpc("confirm_cli_room_takeover", { p_room_code: parsed.data.code, p_session_version: parsed.data.version });
  if (!error && data === true) redirect(`/rooms/${parsed.data.code}`);
  if (error?.message === "SEAT_SESSION_CHANGED") {
    const current = await supabase.rpc("get_room_takeover_status", { p_room_code: parsed.data.code });
    return { version: current.data?.session_version ?? "", cliInUse: current.data?.cli_in_use === true,
      message: "座位的使用状态已变化，请重新确认后再进入。" };
  }
  // Never trust the action's previous state as an authorization or version source.
  void previous;
  return { version: parsed.data.version, cliInUse: true, message: "暂时无法进入，请重试或返回大厅。" };
}
