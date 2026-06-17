import { redirect } from "next/navigation";

import { flashRedirectPath } from "@/lib/flash";
import { createClient } from "@/lib/supabase/server";

function getAdminEmails() {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | undefined) {
  return Boolean(email && getAdminEmails().includes(email.toLowerCase()));
}

export async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(flashRedirectPath("/login", {
      code: "login_required",
      kind: "error",
      scope: "login",
    }));
  }

  if (!isAdminEmail(user.email)) {
    redirect("/");
  }

  return user;
}
