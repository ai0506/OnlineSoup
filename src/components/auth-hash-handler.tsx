"use client";

import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";

export function AuthHashHandler() {
  useEffect(() => {
    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : "";

    if (!hash) return;

    const params = new URLSearchParams(hash);
    const type = params.get("type");
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");

    if (type !== "recovery" || !accessToken || !refreshToken) {
      return;
    }

    const supabase = createClient();
    void supabase.auth
      .setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      })
      .then(({ error }) => {
        window.history.replaceState(null, "", "/reset-password");
        if (error) {
          window.location.assign(
            "/login?error=invalid_email_callback",
          );
          return;
        }
        window.location.assign("/reset-password");
      });
  }, []);

  return null;
}
