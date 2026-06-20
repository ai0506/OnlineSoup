import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { flashRedirectPath } from "@/lib/flash";
import { getSupabaseEnv } from "@/lib/env";
import { getClientIp, getDeviceLabel, getLocationLabel } from "@/lib/request-context";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const origin = request.nextUrl.origin;
  const requestedNext = request.nextUrl.searchParams.get("next");
  const next =
    requestedNext?.startsWith("/") && !requestedNext.startsWith("//")
      ? requestedNext
      : "/";

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
