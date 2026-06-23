"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/admin";
import {
  clearAdminVerified,
  setAdminVerified,
} from "@/lib/admin-verification";
import { getClientIp, getDeviceLabel, getLocationLabel } from "@/lib/request-context";
import { getSiteOrigin } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

function redirectVerify(params: Record<string, string>): never {
  const search = new URLSearchParams(params);
  redirect(`/admin/verify?${search.toString()}`);
}

export async function sendAdminEmailCode() {
  const user = await requireAdmin({ requireVerified: false });
  if (!user.email) {
    redirectVerify({ error: "missing_email" });
  }

  const supabase = await createClient();
  const siteUrl = await getSiteOrigin();
  const { error } = await supabase.auth.signInWithOtp({
    email: user.email,
    options: {
      emailRedirectTo: `${siteUrl}/auth/callback?next=/admin/verify/complete`,
      shouldCreateUser: false,
    },
  });

  if (error) {
    console.error("Send admin verification code failed", {
      code: error.code,
      message: error.message,
    });
    redirectVerify({ error: "send_failed" });
  }

  redirectVerify({ message: "code_sent" });
}

export async function verifyAdminEmailCode(formData: FormData) {
  const user = await requireAdmin({ requireVerified: false });
  const token = String(formData.get("token") ?? "").trim();

  if (!user.email || !/^\d{6}$/.test(token)) {
    redirectVerify({ error: "invalid_code" });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    email: user.email,
    token,
    type: "email",
  });

  if (error) {
    console.error("Verify admin email code failed", {
      code: error.code,
      message: error.message,
    });
    redirectVerify({ error: "verify_failed" });
  }

  const headersList = await headers();
  const { error: contextError } = await supabase.rpc("record_login_context", {
    p_ip: getClientIp(headersList),
    p_device: getDeviceLabel(headersList),
    p_location: getLocationLabel(headersList),
  });

  if (contextError) {
    console.error("Record admin verification login context failed", {
      code: contextError.code,
      message: contextError.message,
    });
  }

  const { data: claimsData } = await supabase.auth.getClaims();
  const sessionId = claimsData?.claims?.session_id;
  const verifiedUserId = claimsData?.claims?.sub ?? user.id;

  if (typeof sessionId !== "string" || typeof verifiedUserId !== "string") {
    await clearAdminVerified();
    redirectVerify({ error: "verify_failed" });
  }

  await setAdminVerified(verifiedUserId, sessionId);
  redirect("/admin");
}
