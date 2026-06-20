import Link from "next/link";
import { redirect } from "next/navigation";

import { PointsHistory } from "@/components/points-history";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { ProfilePageData, PointsTransaction } from "@/lib/types";

export const dynamic = "force-dynamic";

const DIFFICULTY_COLOR: Record<string, string> = {
  简单: "#16a34a",
  中等: "#d97706",
  困难: "#dc2626",
  抽象: "#7c3aed",
};

export default async function ProfilePage() {
  if (!hasSupabaseEnv()) {
    redirect("/");
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (!userId) {
    redirect("/login");
  }

  const { data: pageData, error: pageError } = await supabase.rpc(
    "get_my_profile_page"
  );

  if (pageError || !pageData) {
    redirect("/");
  }

  const data = pageData as ProfilePageData;

  const { data: historyData } = await supabase.rpc("get_my_points_history", {
    p_page: 1,
    p_page_size: 20,
  });

  const initialTransactions: PointsTransaction[] =
    (historyData?.transactions as PointsTransaction[]) ?? [];
  const initialTotal: number = (historyData?.total as number) ?? 0;

  const joinDate = new Date(data.profile.created_at).toLocaleDateString(
    "zh-CN",
    { year: "numeric", month: "long", day: "numeric" }
  );
  const lastLoginAt = data.profile.last_login_at
    ? new Date(data.profile.last_login_at).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="profile-page">
      {/* 用户信息卡片 */}
      <div className="card accent profile-card">
        <div className="profile-card-main">
          <div>
            <p className="profile-username">
              {data.profile.username ?? data.profile.display_name}
            </p>
            <p className="muted">{joinDate} 加入</p>
          </div>
          <div className="profile-points-badge">
            <strong>{data.profile.points}</strong>
            <span>积分</span>
          </div>
        </div>
        <div className="stat-row">
          <div className="stat">
            <strong>{data.stats.ask_count}</strong>
            提问次数
          </div>
          <div className="stat">
            <strong>{data.stats.hint_count}</strong>
            提示次数
          </div>
          <div className="stat">
            <strong>{data.stats.reason_count}</strong>
            推理次数
          </div>
        </div>
        <div className="profile-login-meta">
          <span>最近登录：{lastLoginAt ?? "暂无记录"}</span>
          <span>地点：{data.profile.last_login_location ?? "未知地点"}</span>
          <span>设备：{data.profile.last_login_device ?? "未知"}</span>
        </div>
        <div className="profile-card-actions">
          <Link className="button secondary" href="/account/username">
            修改用户名
          </Link>
        </div>
      </div>

      {/* 通关记录 */}
      <section className="profile-section">
        <h2>通关记录</h2>
        {data.solved_puzzles.length === 0 ? (
          <p className="muted">还没有通关过任何汤。快去房间里试试吧！</p>
        ) : (
          <ul className="solved-puzzle-list">
            {data.solved_puzzles.map((puzzle) => (
              <li key={puzzle.id} className="solved-puzzle-item">
                <div className="solved-puzzle-title">{puzzle.title}</div>
                <div className="solved-puzzle-meta">
                  <span
                    className="difficulty-tag"
                    style={{
                      color: DIFFICULTY_COLOR[puzzle.difficulty] ?? "#334155",
                    }}
                  >
                    {puzzle.difficulty}
                  </span>
                  <span className="muted">
                    {new Date(puzzle.solved_at).toLocaleDateString("zh-CN", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 积分流水 */}
      <section className="profile-section">
        <h2>积分流水</h2>
        <PointsHistory
          initialTransactions={initialTransactions}
          initialTotal={initialTotal}
          pageSize={20}
        />
      </section>
    </div>
  );
}
