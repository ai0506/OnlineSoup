import { createClient } from "@supabase/supabase-js";

import { getSupabaseEnv } from "@/lib/env";

export function createAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!secretKey) {
    throw new Error("缺少 SUPABASE_SECRET_KEY 环境变量");
  }

  const { url } = getSupabaseEnv();

  return createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
