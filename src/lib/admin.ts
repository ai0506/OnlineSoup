import { redirect } from "next/navigation";

import {
  isAdminVerified,
} from "@/lib/admin-verification";
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

type RequireAdminOptions = {
  requireVerified?: boolean;
};

export async function requireAdmin(options: RequireAdminOptions = {}) {
  const { requireVerified = true } = options;
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

  if (requireVerified) {
    const { data: claimsData } = await supabase.auth.getClaims();
    const sessionId = claimsData?.claims?.session_id;
    if (
      typeof sessionId !== "string" ||
      !(await isAdminVerified(user.id, sessionId))
    ) {
      redirect("/admin/verify");
    }
  }

  return user;
}
