"use server";

import { redirectWithFlash } from "@/lib/flash";
import { createClient } from "@/lib/supabase/server";
import { usernameSchema } from "@/lib/validation";

async function redirectUsernameWithFlash(
  kind: "error" | "notice",
  code: string,
): Promise<never> {
  return await redirectWithFlash("/account/username", {
    code,
    kind,
    scope: "username",
  });
}

export async function updateUsername(formData: FormData) {
  const parsed = usernameSchema.safeParse(formData.get("username"));

  if (!parsed.success) {
    return await redirectUsernameWithFlash("error", "invalid_username");
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();

  if (!claimsData?.claims?.sub) {
    await redirectWithFlash("/login", {
      code: "login_required",
      kind: "error",
      scope: "login",
    });
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
    return await redirectUsernameWithFlash("error", code);
  }

  return await redirectUsernameWithFlash("notice", "username_updated");
}
