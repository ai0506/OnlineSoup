import { OnboardingRoom } from "@/components/onboarding-room";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "上手教程 - 汤局",
};

export default async function OnboardingPage() {
  let userId: string | undefined;
  let username: string | undefined;
  let points = 0;

  if (hasSupabaseEnv()) {
    const supabase = await createClient();
    const { data: claimsData } = await supabase.auth.getClaims();
    userId = claimsData?.claims?.sub;
    if (userId) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("username, points")
        .eq("id", userId)
        .maybeSingle();
      username = profile?.username ?? undefined;
      points = profile?.points ?? 0;
    }
  }

  return <OnboardingRoom points={points} userId={userId} username={username ?? "你"} />;
}
