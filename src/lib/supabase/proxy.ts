import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseEnv } from "@/lib/env";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, publishableKey } = getSupabaseEnv();

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (userId) {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", userId)
      .maybeSingle();

    // profile === null（无行，非字段缺失）说明账号已被删除
    if (!error && profile === null) {
      const { error: userError } = await supabase.auth.getUser();
      if (userError) {
        await supabase.auth.signOut();
        const signOutResponse = NextResponse.redirect(new URL("/login", request.url));
        response.cookies.getAll().forEach((cookie) => {
          signOutResponse.cookies.set(cookie);
        });
        return signOutResponse;
      }
    }

    const pathname = request.nextUrl.pathname;
    const allowedWithoutUsername =
      pathname === "/account/username" ||
      pathname === "/login" ||
      pathname === "/tutorial" ||
      pathname.startsWith("/auth/") ||
      pathname.startsWith("/reset-password");

    if (!error && !profile?.username && !allowedWithoutUsername) {
      const redirectResponse = NextResponse.redirect(
        new URL("/account/username", request.url),
      );
      response.cookies.getAll().forEach((cookie) => {
        redirectResponse.cookies.set(cookie);
      });
      return redirectResponse;
    }
  }

  return response;
}
