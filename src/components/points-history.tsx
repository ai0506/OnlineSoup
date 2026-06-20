"use client";

import { useState } from "react";

import { createClient } from "@/lib/supabase/client";
import type { PointsTransaction, PointsTransactionType } from "@/lib/types";

const TYPE_LABELS: Record<PointsTransactionType, string> = {
  signup_bonus: "注册奖励",
  room_reservation: "创建房间",
  room_refund: "关闭退款",
  gift_sent: "赠出积分",
  seat_query: "AI 消耗",
  admin_adjustment: "管理员调整",
};

type PointsHistoryProps = {
  initialTransactions: PointsTransaction[];
  initialTotal: number;
  pageSize?: number;
};

export function PointsHistory({
  initialTransactions,
  initialTotal,
  pageSize = 20,
}: PointsHistoryProps) {
  const [page, setPage] = useState(1);
  const [transactions, setTransactions] = useState(initialTransactions);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function goToPage(nextPage: number) {
    if (nextPage === page || loading) return;
    setLoading(true);
    try {
      const supabase = createClient();
      const { data } = await supabase.rpc("get_my_points_history", {
        p_page: nextPage,
        p_page_size: pageSize,
      });
      if (data) {
        setTransactions(data.transactions ?? []);
        setTotal(data.total ?? 0);
        setPage(nextPage);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="points-history">
      {transactions.length === 0 ? (
        <p className="muted">暂无积分记录。</p>
      ) : (
        <table className="points-history-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>类型</th>
              <th>房间</th>
              <th>变动</th>
              <th>余额</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx) => (
              <tr key={tx.id}>
                <td className="muted">
                  {new Date(tx.created_at).toLocaleDateString("zh-CN", {
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td>{TYPE_LABELS[tx.type] ?? tx.type}</td>
                <td className="muted">{tx.room_name ?? "—"}</td>
                <td className={tx.amount >= 0 ? "points-gain" : "points-loss"}>
                  {tx.amount >= 0 ? `+${tx.amount}` : tx.amount}
                </td>
                <td>{tx.balance_after}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {totalPages > 1 && (
        <div className="points-history-pagination">
          <button
            className="button secondary"
            disabled={page <= 1 || loading}
            onClick={() => goToPage(page - 1)}
          >
            上一页
          </button>
          <span className="muted">
            {page} / {totalPages}
          </span>
          <button
            className="button secondary"
            disabled={page >= totalPages || loading}
            onClick={() => goToPage(page + 1)}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
