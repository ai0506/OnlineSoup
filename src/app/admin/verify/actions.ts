"use server";

import { randomInt, randomUUID } from "node:crypto";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/admin";
import {
  clearAdminEmailVerificationChallenge,
  clearAdminVerified,
  getAdminEmailVerificationChallenge,
  hashAdminEmailVerificationCode,
  setAdminDeviceTrusted,
  setAdminEmailVerificationChallenge,
  setAdminVerified,
} from "@/lib/admin-verification";
import { sendAdminEmail } from "@/lib/email";
import { getClientIp, getDeviceLabel, getLocationLabel } from "@/lib/request-context";
import { createAdminClient } from "@/lib/supabase/admin";
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
  const { data: claimsData } = await supabase.auth.getClaims();
  const sessionId = claimsData?.claims?.session_id;
  if (typeof sessionId !== "string") {
    await clearAdminEmailVerificationChallenge();
    redirectVerify({ error: "send_failed" });
  }

  const challengeId = randomUUID();
  const code = randomInt(0, 100_000_000).toString().padStart(8, "0");
  const admin = createAdminClient();
  const { data: created, error: issueError } = await admin.rpc(
    "issue_admin_email_verification_challenge",
    {
      p_challenge_id: challengeId,
      p_code_hash: hashAdminEmailVerificationCode(challengeId, code),
      p_session_id: sessionId,
      p_user_id: user.id,
    },
  );

  if (issueError) {
    console.error("Issue admin verification code failed", {
      code: issueError.code,
      message: issueError.message,
    });
    redirectVerify({ error: "send_failed" });
  }

  if (!created) {
    redirectVerify({ error: "send_too_soon" });
  }

  try {
    await sendAdminEmail({
      to: [user.email],
      subject: "Online Soup 管理端验证码",
      text: `你的管理端验证码是：${code}\n\n验证码 10 分钟内有效，只能使用一次。若非本人操作，请忽略此邮件。`,
    });
  } catch (error) {
    await admin
      .from("admin_email_verification_challenges")
      .delete()
      .eq("id", challengeId);
    console.error("Send admin verification code failed", error);
    redirectVerify({ error: "send_failed" });
  }

  await setAdminEmailVerificationChallenge(challengeId);
  redirectVerify({ message: "code_sent" });
}

export async function verifyAdminEmailCode(formData: FormData) {
  const user = await requireAdmin({ requireVerified: false });
  const token = String(formData.get("token") ?? "").trim();
  const challengeId = await getAdminEmailVerificationChallenge();

  if (!user.email || !challengeId || !/^\d{8}$/.test(token)) {
    redirectVerify({ error: "invalid_code" });
  }

  const supabase = await createClient();
  const { data: verified, error } = await supabase.rpc(
    "consume_admin_email_verification_challenge",
    {
      p_challenge_id: challengeId,
      p_code_hash: hashAdminEmailVerificationCode(challengeId, token),
    },
  );

  if (error) {
    console.error("Verify admin email code failed", {
      code: error.code,
      message: error.message,
    });
    redirectVerify({ error: "verify_failed" });
  }

  if (!verified) {
    redirectVerify({ error: "verify_failed" });
  }

  const { data: claimsData } = await supabase.auth.getClaims();
  const sessionId = claimsData?.claims?.session_id;
  const verifiedUserId = claimsData?.claims?.sub;
  if (typeof sessionId !== "string" || verifiedUserId !== user.id) {
    await clearAdminVerified();
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

  await setAdminVerified(verifiedUserId, sessionId);
  await clearAdminEmailVerificationChallenge();

  if (formData.get("remember_device") === "on") {
    await setAdminDeviceTrusted(verifiedUserId);
  }

  redirect("/admin");
}
