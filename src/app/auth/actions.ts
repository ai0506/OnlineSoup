"use server";

import { redirect } from "next/navigation";

import { loginSchema, signupSchema } from "@/lib/validation";
import { createClient } from "@/lib/supabase/server";

function messageUrl(path: string, key: "error" | "message", code: string) {
  return `${path}?${key}=${encodeURIComponent(code)}`;
}

export async function login(formData: FormData) {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    redirect(messageUrl("/login", "error", "invalid_credentials_form"));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    redirect(messageUrl("/login", "error", "invalid_credentials"));
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
    redirect(messageUrl("/login", "error", "invalid_signup_form"));
  }

  const supabase = await createClient();
  const { data: usernameAvailable, error: usernameCheckError } =
    await supabase.rpc("is_username_available", {
      requested_username: parsed.data.username,
    });

  if (usernameCheckError) {
    redirect(messageUrl("/login", "error", "database_migration_required"));
  }

  if (!usernameAvailable) {
    redirect(messageUrl("/login", "error", "username_taken"));
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    "http://localhost:3000";

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
    redirect(messageUrl("/login", "error", errorCode));
  }

  if (data.session) {
    redirect("/");
  }

  redirect(messageUrl("/login", "message", "signup_confirmation_sent"));
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
