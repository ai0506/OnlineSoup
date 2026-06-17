"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const passwordSchema = z.string().min(6).max(72);

export async function setNewPassword(formData: FormData) {
  const password = passwordSchema.safeParse(formData.get("password"));
  const confirmation = formData.get("confirmation");

  if (!password.success || password.data !== confirmation) {
    redirect("/reset-password?error=invalid_password");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?error=invalid_email_callback");
  }

  const { error } = await supabase.auth.updateUser({
    password: password.data,
  });

  if (error) {
    redirect("/reset-password?error=update_failed");
  }

  await supabase.auth.signOut();
  redirect("/login");
}
