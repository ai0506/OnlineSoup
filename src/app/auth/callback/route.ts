import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { isAdminEmail } from "@/lib/admin";
import { setAdminVerifiedOnResponse } from "@/lib/admin-verification";
import { flashRedirectPath } from "@/lib/flash";
import { getSupabaseEnv } from "@/lib/env";
import { getClientIp, getDeviceLabel, getLocationLabel } from "@/lib/request-context";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const origin = request.nextUrl.origin;
  const requestedNext = request.nextUrl.searchParams.get("next");
  const next = (() => {
    if (!requestedNext || !requestedNext.startsWith("/") || /\\|%2f|%5c/i.test(requestedNext)) {
      return "/";
    }
    try {
      const target = new URL(requestedNext, origin);
      return target.origin === origin
        ? `${target.pathname}${target.search}${target.hash}`
        : "/";
    } catch {
      return "/";
    }
  })();

  if (code) {
    const { url, publishableKey } = getSupabaseEnv();
    const pendingCookies: { name: string; value: string; options: Record<string, unknown> }[] = [];

    const supabase = createServerClient(url, publishableKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach((c) => pendingCookies.push(c as typeof pendingCookies[number]));
        },
      },
    });

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const { error: contextError } = await supabase.rpc("record_login_context", {
        p_ip: getClientIp(request.headers),
        p_device: getDeviceLabel(request.headers),
        p_location: getLocationLabel(request.headers),
      });
      if (contextError) {
        console.error("Record callback login context failed", {
          code: contextError.code,
          message: contextError.message,
        });
      }

      const response = NextResponse.redirect(`${origin}${next}`);
      pendingCookies.forEach(({ name, value, options }) => {
        response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2]);
      });

      if (next === "/admin/verify/complete") {
        const [
          { data: { user } },
          { data: claimsData },
        ] = await Promise.all([
          supabase.auth.getUser(),
          supabase.auth.getClaims(),
        ]);
        const sessionId = claimsData?.claims?.session_id;
        const userId = claimsData?.claims?.sub;

        if (
          !user ||
          !isAdminEmail(user.email) ||
          user.id !== userId ||
          typeof sessionId !== "string"
        ) {
          return NextResponse.redirect(`${origin}/admin/verify?error=verify_failed`);
        }

        setAdminVerifiedOnResponse(response, user.id, sessionId);
        response.headers.set("Location", `${origin}/admin`);
      }

      return response;
    }
  }

  return NextResponse.redirect(
    `${origin}${flashRedirectPath("/login", {
      code: "invalid_email_callback",
      kind: "error",
      scope: "login",
    })}`,
  );
}
