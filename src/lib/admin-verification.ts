import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

export const ADMIN_VERIFICATION_COOKIE = "online_soup_admin_verified";
const ADMIN_VERIFICATION_MAX_AGE_SECONDS = 12 * 60 * 60;

const cookieOptions = {
  httpOnly: true,
  maxAge: ADMIN_VERIFICATION_MAX_AGE_SECONDS,
  path: "/admin",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

function getVerificationSecret() {
  return (
    process.env.SUPABASE_SECRET_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    "online-soup-admin-verification-dev"
  );
}

function sign(payload: string) {
  return createHmac("sha256", getVerificationSecret())
    .update(payload)
    .digest("base64url");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function setAdminVerified(userId: string, sessionId: string) {
  const cookieStore = await cookies();
  const expiresAt = Date.now() + ADMIN_VERIFICATION_MAX_AGE_SECONDS * 1000;
  const payload = `${userId}.${sessionId}.${expiresAt}`;
  cookieStore.set(
    ADMIN_VERIFICATION_COOKIE,
    `${payload}.${sign(payload)}`,
    cookieOptions,
  );
}

export async function clearAdminVerified() {
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_VERIFICATION_COOKIE, "", {
    ...cookieOptions,
    maxAge: 0,
  });
}

export async function isAdminVerified(userId: string, sessionId: string) {
  const cookieStore = await cookies();
  const value = cookieStore.get(ADMIN_VERIFICATION_COOKIE)?.value;
  if (!value) return false;

  const parts = value.split(".");
  if (parts.length !== 4) return false;

  const [cookieUserId, cookieSessionId, expiresAtText, signature] = parts;
  const expiresAt = Number.parseInt(expiresAtText, 10);
  if (
    cookieUserId !== userId ||
    cookieSessionId !== sessionId ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    return false;
  }

  const payload = `${cookieUserId}.${cookieSessionId}.${expiresAtText}`;
  return safeEqual(sign(payload), signature);
}
