"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { redirectWithFlash } from "@/lib/flash";
import { getClientIp, getDeviceLabel } from "@/lib/request-context";
import { getSiteOrigin } from "@/lib/site-url";
import { loginIdentitySchema, signupSchema } from "@/lib/validation";
import { createAdminClient } from "@/lib/supabase/admin";
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

export async function login(formData: FormData) {
  const parsed = loginIdentitySchema.safeParse({
    identity: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return await redirectLoginWithFlash("error", "invalid_credentials_form");
  }

  const { identity, password } = parsed.data;

  let email: string;
  if (identity.includes("@")) {
    email = identity;
  } else {
    // Username login: look up the actual email via admin API so it works
    // for both email accounts and no-email accounts.
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("id")
      .ilike("username", identity)
      .single();

    if (!profile) {
      return await redirectLoginWithFlash("error", "invalid_credentials");
    }

    const { data: userData } = await admin.auth.admin.getUserById(profile.id);
    if (!userData?.user?.email) {
      return await redirectLoginWithFlash("error", "invalid_credentials");
    }

    email = userData.user.email;
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return await redirectLoginWithFlash("error", "invalid_credentials");
  }

  const headersList = await headers();
  const { error: contextError } = await supabase.rpc("record_login_context", {
    p_ip: getClientIp(headersList),
    p_device: getDeviceLabel(headersList),
  });

  if (contextError) {
    console.error("Record login context failed", {
      code: contextError.code,
      message: contextError.message,
    });
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
