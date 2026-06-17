"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { usernameSchema } from "@/lib/validation";

function resultUrl(type: "error" | "message", code: string) {
  return `/account/username?${type}=${encodeURIComponent(code)}`;
}

export async function updateUsername(formData: FormData) {
  const parsed = usernameSchema.safeParse(formData.get("username"));

  if (!parsed.success) {
    redirect(resultUrl("error", "invalid_username"));
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();

  if (!claimsData?.claims?.sub) {
    redirect("/login?error=login_required");
  }

  const { error } = await supabase.rpc("set_my_username", {
    requested_username: parsed.data,
  });

  if (error) {
    const code = error.message.includes("username_taken")
      ? "username_taken"
      : error.message.includes("active_room_exists")
        ? "active_room_exists"
        : error.message.includes("room_name_conflict")
          ? "room_name_conflict"
          : error.message.includes("invalid_username")
            ? "invalid_username"
            : "update_failed";
    redirect(resultUrl("error", code));
  }

  redirect(resultUrl("message", "username_updated"));
}
