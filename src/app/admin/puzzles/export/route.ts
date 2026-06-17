import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  await requireAdmin();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("puzzles")
    .select("title, surface, bottom, difficulty, is_active, key_points, examples")
    .order("id", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "题库导出失败" }, { status: 500 });
  }

  const filename = `puzzles-${new Date().toISOString().slice(0, 10)}.json`;

  return new NextResponse(JSON.stringify(data ?? [], null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
