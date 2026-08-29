import Link from "next/link";
import { redirect } from "next/navigation";

import { PointsHistory } from "@/components/points-history";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { PointsTransaction } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PointsHistoryPage() {
  if (!hasSupabaseEnv()) {
    redirect("/");
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();

  if (!claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: historyData } = await supabase.rpc("get_my_points_history", {
    p_page: 1,
    p_page_size: 20,
  });

  const initialTransactions: PointsTransaction[] =
    (historyData?.transactions as PointsTransaction[]) ?? [];
  const initialTotal: number = (historyData?.total as number) ?? 0;

  return (
    <div className="profile-page">
      <section className="profile-section">
        <div className="points-history-page-header">
          <div>
            <p className="eyebrow">账户</p>
            <h1>积分流水</h1>
            <p className="muted">查看所有积分变动和每笔变动后的余额。</p>
          </div>
          <Link className="button secondary" href="/profile">
            返回个人资料
          </Link>
        </div>
      </section>

      <section className="profile-section">
        <PointsHistory
          initialTransactions={initialTransactions}
          initialTotal={initialTotal}
          pageSize={20}
        />
      </section>
    </div>
  );
}
