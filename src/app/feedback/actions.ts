"use server";

import { headers } from "next/headers";

import { redirectWithFlash } from "@/lib/flash";
import { getDeviceLabel, getLocationLabel } from "@/lib/request-context";
import { createClient } from "@/lib/supabase/server";
import { feedbackSchema } from "@/lib/validation";

async function redirectFeedbackWithFlash(
  kind: "error" | "notice",
  code: string,
): Promise<never> {
  return await redirectWithFlash("/feedback", {
    code,
    kind,
    scope: "feedback",
  });
}

export async function submitFeedback(formData: FormData) {
  const parsed = feedbackSchema.safeParse({
    category: formData.get("category"),
    content: formData.get("content"),
  });

  if (!parsed.success) {
    return await redirectFeedbackWithFlash("error", "invalid_feedback");
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();

  if (!claimsData?.claims?.sub) {
    return await redirectWithFlash("/login", {
      code: "login_required_feedback",
      kind: "error",
      scope: "login",
    });
  }

  const headersList = await headers();
  const pagePath = String(formData.get("pagePath") ?? "").trim();

  const { error } = await supabase.rpc("submit_user_feedback", {
    p_category: parsed.data.category,
    p_content: parsed.data.content,
    p_page_path: pagePath.startsWith("/") ? pagePath : "",
    p_device_label: getDeviceLabel(headersList),
    p_location_label: getLocationLabel(headersList),
  });

  if (error) {
    if (error.message.includes("feedback_rate_limited")) {
      return await redirectFeedbackWithFlash("error", "feedback_rate_limited");
    }
    if (error.message.includes("not_authenticated")) {
      return await redirectWithFlash("/login", {
        code: "login_required_feedback",
        kind: "error",
        scope: "login",
      });
    }
    if (
      error.message.includes("invalid_category") ||
      error.message.includes("invalid_content")
    ) {
      return await redirectFeedbackWithFlash("error", "invalid_feedback");
    }

    console.error("Feedback submit failed", error);
    return await redirectFeedbackWithFlash("error", "feedback_failed");
  }

  return await redirectFeedbackWithFlash("notice", "feedback_submitted");
}
