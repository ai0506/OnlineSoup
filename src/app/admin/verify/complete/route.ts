import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/admin";
import {
  clearAdminVerified,
  setAdminVerified,
} from "@/lib/admin-verification";
import { getClientIp, getDeviceLabel, getLocationLabel } from "@/lib/request-context";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireAdmin({ requireVerified: false });
  const supabase = await createClient();

  const headersList = await headers();
  const { error: contextError } = await supabase.rpc("record_login_context", {
    p_ip: getClientIp(headersList),
    p_device: getDeviceLabel(headersList),
    p_location: getLocationLabel(headersList),
  });

  if (contextError) {
    console.error("Record admin verification link context failed", {
      code: contextError.code,
      message: contextError.message,
    });
  }

  const { data: claimsData } = await supabase.auth.getClaims();
  const sessionId = claimsData?.claims?.session_id;
  const verifiedUserId = claimsData?.claims?.sub ?? user.id;

  if (typeof sessionId !== "string" || typeof verifiedUserId !== "string") {
    await clearAdminVerified();
    redirect("/admin/verify?error=verify_failed");
  }

  await setAdminVerified(verifiedUserId, sessionId);
  redirect("/admin");
}
