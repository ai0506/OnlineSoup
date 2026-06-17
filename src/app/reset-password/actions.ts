"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { redirectWithFlash } from "@/lib/flash";
import { createClient } from "@/lib/supabase/server";

const passwordSchema = z.string().min(6).max(72);

export async function setNewPassword(formData: FormData) {
  const password = passwordSchema.safeParse(formData.get("password"));
  const confirmation = formData.get("confirmation");

  if (!password.success || password.data !== confirmation) {
    await redirectWithFlash("/reset-password", {
      code: "invalid_password",
      kind: "error",
      scope: "reset-password",
    });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    await redirectWithFlash("/login", {
      code: "invalid_email_callback",
      kind: "error",
      scope: "login",
    });
  }

  const { error } = await supabase.auth.updateUser({
    password: password.data,
  });

  if (error) {
    await redirectWithFlash("/reset-password", {
      code: "update_failed",
      kind: "error",
      scope: "reset-password",
    });
  }

  await supabase.auth.signOut();
  redirect("/login");
}
