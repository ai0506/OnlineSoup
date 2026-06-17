"use server";

import { redirect } from "next/navigation";

import { redirectWithFlash } from "@/lib/flash";
import { getSiteOrigin } from "@/lib/site-url";
import { loginIdentitySchema, signupSchema } from "@/lib/validation";
import { createClient } from "@/lib/supabase/server";

async function redirectLoginWithFlash(
  kind: "error" | "notice",
  code: string,
): Promise<never> {
  return await redirectWithFlash("/login", {
    code,
    kind,
    scope: "login",
  });
}

const NOEMAIL_DOMAIN = "@noemail.internal";

export async function login(formData: FormData) {
  const parsed = loginIdentitySchema.safeParse({
    identity: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return await redirectLoginWithFlash("error", "invalid_credentials_form");
  }

  const { identity, password } = parsed.data;
  const email = identity.includes("@")
    ? identity
    : identity.toLowerCase() + NOEMAIL_DOMAIN;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return await redirectLoginWithFlash("error", "invalid_credentials");
  }

  redirect("/");
}

export async function signup(formData: FormData) {
  const parsed = signupSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    username: formData.get("username"),
  });

  if (!parsed.success) {
    return await redirectLoginWithFlash("error", "invalid_signup_form");
  }

  const supabase = await createClient();
  const { data: usernameAvailable, error: usernameCheckError } =
    await supabase.rpc("is_username_available", {
      requested_username: parsed.data.username,
    });

  if (usernameCheckError) {
    return await redirectLoginWithFlash("error", "database_migration_required");
  }

  if (!usernameAvailable) {
    return await redirectLoginWithFlash("error", "username_taken");
  }

  const siteUrl = await getSiteOrigin();

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${siteUrl}/auth/callback`,
      data: {
        username: parsed.data.username,
      },
    },
  });

  if (error) {
    console.error("Supabase signup failed", {
      code: error.code,
      message: error.message,
    });
    const { data: stillAvailable } = await supabase.rpc(
      "is_username_available",
      {
        requested_username: parsed.data.username,
      },
    );
    const errorCode = stillAvailable === false
      ? "username_taken"
      : "signup_failed";
    return await redirectLoginWithFlash("error", errorCode);
  }

  if (data.session) {
    redirect("/");
  }

  return await redirectLoginWithFlash("notice", "signup_confirmation_sent");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
