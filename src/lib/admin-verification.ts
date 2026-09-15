import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

export const ADMIN_VERIFICATION_COOKIE = "online_soup_admin_verified";
export const ADMIN_DEVICE_COOKIE = "online_soup_admin_device";
const ADMIN_VERIFICATION_MAX_AGE_SECONDS = 12 * 60 * 60;
const ADMIN_DEVICE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const cookieOptions = {
  httpOnly: true,
  maxAge: ADMIN_VERIFICATION_MAX_AGE_SECONDS,
  path: "/admin",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

const deviceCookieOptions = {
  httpOnly: true,
  maxAge: ADMIN_DEVICE_MAX_AGE_SECONDS,
  path: "/admin",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

function getVerificationSecret() {
  return process.env.ADMIN_VERIFICATION_SECRET ?? process.env.SUPABASE_SECRET_KEY;
}

function sign(payload: string) {
  const secret = getVerificationSecret();
  if (!secret) return null;
  return createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
}

function createAdminVerifiedCookie(userId: string, sessionId: string) {
  const expiresAt = Date.now() + ADMIN_VERIFICATION_MAX_AGE_SECONDS * 1000;
  const payload = `${userId}.${sessionId}.${expiresAt}`;
  const signature = sign(payload);
  if (!signature) {
    throw new Error("ADMIN_VERIFICATION_SECRET or SUPABASE_SECRET_KEY is required");
  }
  return {
    name: ADMIN_VERIFICATION_COOKIE,
    value: `${payload}.${signature}`,
    options: cookieOptions,
  };
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function setAdminVerified(userId: string, sessionId: string) {
  const cookieStore = await cookies();
  const cookie = createAdminVerifiedCookie(userId, sessionId);
  cookieStore.set(cookie.name, cookie.value, cookie.options);
}

export function setAdminVerifiedOnResponse(
  response: NextResponse,
  userId: string,
  sessionId: string,
) {
  const cookie = createAdminVerifiedCookie(userId, sessionId);
  response.cookies.set(cookie.name, cookie.value, cookie.options);
}

export async function setAdminDeviceTrusted(userId: string) {
  const cookieStore = await cookies();
  const deviceToken = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + ADMIN_DEVICE_MAX_AGE_SECONDS * 1000;
  const payload = `${userId}.${deviceToken}.${expiresAt}`;
  cookieStore.set(
    ADMIN_DEVICE_COOKIE,
    `${payload}.${sign(payload)}`,
    deviceCookieOptions,
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

  // Check device cookie first (long-lived, not session-bound)
  const deviceValue = cookieStore.get(ADMIN_DEVICE_COOKIE)?.value;
  if (deviceValue) {
    const parts = deviceValue.split(".");
    if (parts.length === 4) {
      const [cookieUserId, , expiresAtText, signature] = parts;
      const expiresAt = Number.parseInt(expiresAtText, 10);
      if (
        cookieUserId === userId &&
        Number.isFinite(expiresAt) &&
        expiresAt > Date.now()
      ) {
        const payload = `${parts[0]}.${parts[1]}.${expiresAtText}`;
        const expectedSignature = sign(payload);
        if (expectedSignature && safeEqual(expectedSignature, signature)) {
          return true;
        }
      }
    }
  }

  // Fall back to session-bound verification cookie
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
  const expectedSignature = sign(payload);
  return Boolean(expectedSignature && safeEqual(expectedSignature, signature));
}
