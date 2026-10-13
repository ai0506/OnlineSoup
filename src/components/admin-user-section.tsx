"use client";

import { useState } from "react";

import { SubmitButton } from "@/components/submit-button";

const NOEMAIL_DOMAIN = "@noemail.internal";

function isEmailless(email: string | undefined) {
  return email?.endsWith(NOEMAIL_DOMAIN) ?? true;
}

export type AdminUserEntry = {
  id: string;
  email: string | undefined;
  username: string | null;
  points: number;
  createdAt: string;
  lastSignInAt: string | null;
};

export type AdminUserSort = "created" | "active";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "2-digit",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatDate(value: string | null) {
  return value ? dateFormatter.format(new Date(value)) : "—";
}

function sortTime(value: string | null) {
  return value ? new Date(value).getTime() : 0;
}

type AdminUserSectionProps = {
  users: AdminUserEntry[];
  createAdminUser: (formData: FormData) => Promise<void>;
  updateUserUsername: (formData: FormData) => Promise<void>;
  adjustUserPoints: (formData: FormData) => Promise<void>;
  updateUserPassword: (formData: FormData) => Promise<void>;
  sendPasswordReset: (formData: FormData) => Promise<void>;
  deleteAdminUser: (formData: FormData) => Promise<void>;
  initialSort: AdminUserSort;
  truncated?: boolean;
};

export function AdminUserSection({
  users,
  createAdminUser,
  updateUserUsername,
  adjustUserPoints,
  updateUserPassword,
  sendPasswordReset,
  deleteAdminUser,
  initialSort,
  truncated,
}: AdminUserSectionProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [sort, setSort] = useState<AdminUserSort>(initialSort);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [adjustingUser, setAdjustingUser] = useState<AdminUserEntry | null>(null);
  const [editingUser, setEditingUser] = useState<AdminUserEntry | null>(null);
  const [adjustDirection, setAdjustDirection] = useState<"add" | "subtract">("add");
  // 提交后先本地更新积分/用户名，避免等服务端整页刷新才看到变化；服务端数据回来后自动覆盖
  const [optimisticPoints, setOptimisticPoints] = useState<Record<string, number>>({});
  const [optimisticUsernames, setOptimisticUsernames] = useState<Record<string, string>>({});
  const [syncedUsers, setSyncedUsers] = useState(users);

  if (syncedUsers !== users) {
    setSyncedUsers(users);
    setOptimisticPoints({});
    setOptimisticUsernames({});
  }

  const sortedUsers = [...users].sort((a, b) =>
    sort === "active"
      ? sortTime(b.lastSignInAt) - sortTime(a.lastSignInAt)
      : sortTime(b.createdAt) - sortTime(a.createdAt),
  );

  function changeSort(next: AdminUserSort) {
    setSort(next);
    // 写回地址栏，刷新或操作后跳回时保持当前排序
    const url = new URL(window.location.href);
    url.searchParams.set("sort", next);
    window.history.replaceState(null, "", url);
  }

  const deletingUser = deletingUserId
    ? users.find((u) => u.id === deletingUserId)
    : null;

  return (
    <>
      <div className="admin-table-toolbar">
        <div className="admin-subtabs" role="group" aria-label="账户排序">
          <button
            aria-pressed={sort === "created"}
            className={`admin-subtab${sort === "created" ? " active" : ""}`}
            onClick={() => changeSort("created")}
            type="button"
          >
            最新注册
          </button>
          <button
            aria-pressed={sort === "active"}
            className={`admin-subtab${sort === "active" ? " active" : ""}`}
            onClick={() => changeSort("active")}
            type="button"
          >
            最近登录
          </button>
        </div>
        <button
          className="button ghost small"
          onClick={() => setCreateOpen(true)}
          type="button"
        >
          + 创建账户
        </button>
      </div>
      {truncated && (
        <p className="admin-truncated-hint">
          已达到本次查询上限（1000 个账户），可能还有账户未显示，请用搜索缩小范围查看。
        </p>
      )}

      {users.length === 0 ? (
        <div className="card muted">没有找到匹配的账户。</div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>用户名</th>
                <th>邮箱</th>
                <th className="admin-table-num">积分</th>
                <th>注册时间</th>
                <th>最近登录</th>
                <th className="admin-table-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {sortedUsers.map((user) => {
                const emailless = isEmailless(user.email);
                const displayUsername = optimisticUsernames[user.id] ?? user.username;
                const displayPoints = optimisticPoints[user.id] ?? user.points;

                return (
                  <tr key={user.id}>
                    <td>
                      {displayUsername ? (
                        <strong>{displayUsername}</strong>
                      ) : (
                        <span className="muted">未设置用户名</span>
                      )}
                    </td>
                    <td className={emailless ? "muted" : undefined}>
                      {emailless ? "无邮箱" : user.email}
                    </td>
                    <td className="admin-table-num">{displayPoints}</td>
                    <td className="muted">{formatDate(user.createdAt)}</td>
                    <td className="muted">
                      {user.lastSignInAt ? formatDate(user.lastSignInAt) : "从未登录"}
                    </td>
                    <td className="admin-table-actions">
                      <button
                        className="button ghost small"
                        onClick={() => setEditingUser({ ...user, username: displayUsername })}
                        type="button"
                      >
                        编辑
                      </button>
                      <button
                        className="button ghost small"
                        onClick={() => {
                          setAdjustDirection("add");
                          setAdjustingUser({ ...user, points: displayPoints });
                        }}
                        type="button"
                      >
                        调整积分
                      </button>
                      <button
                        className="button danger-text small"
                        onClick={() => setDeletingUserId(user.id)}
                        type="button"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit account modal */}
      {editingUser && (
        <div
          aria-label="编辑账户"
          aria-modal="true"
          className="dialog-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setEditingUser(null);
          }}
          role="dialog"
        >
          <div className="dialog-panel admin-user-edit-panel">
            <h2>编辑账户</h2>
            <p className="muted">
              {editingUser.username ?? "未设置用户名"}
              &nbsp;·&nbsp;
              {isEmailless(editingUser.email) ? "无邮箱账户" : editingUser.email}
            </p>
            <form
              action={updateUserUsername}
              className="inline-admin-form"
              onSubmit={(event) => {
                const value = (
                  event.currentTarget.elements.namedItem(
                    "username",
                  ) as HTMLInputElement | null
                )?.value.trim();
                if (value) {
                  setOptimisticUsernames((prev) => ({ ...prev, [editingUser.id]: value }));
                }
                setEditingUser(null);
              }}
            >
              <input name="userId" type="hidden" value={editingUser.id} />
              <label>
                用户名
                <input
                  defaultValue={editingUser.username ?? ""}
                  maxLength={8}
                  minLength={3}
                  name="username"
                  pattern="[A-Za-z0-9_]{3,8}"
                  required
                />
              </label>
              <SubmitButton pendingText="保存中...">保存</SubmitButton>
            </form>

            <form
              action={updateUserPassword}
              className="inline-admin-form"
              onSubmit={() => setEditingUser(null)}
            >
              <input name="userId" type="hidden" value={editingUser.id} />
              <label>
                新密码
                <input
                  autoComplete="new-password"
                  maxLength={72}
                  minLength={6}
                  name="password"
                  placeholder="至少 6 位"
                  required
                  type="password"
                />
              </label>
              <SubmitButton pendingText="保存中...">修改密码</SubmitButton>
            </form>

            <div className="dialog-actions">
              {!isEmailless(editingUser.email) && (
                <form
                  action={sendPasswordReset}
                  onSubmit={() => setEditingUser(null)}
                >
                  <input name="userId" type="hidden" value={editingUser.id} />
                  <SubmitButton className="button secondary" pendingText="发送中...">
                    发送重置邮件
                  </SubmitButton>
                </form>
              )}
              <button
                className="button secondary"
                onClick={() => setEditingUser(null)}
                type="button"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Adjust points modal */}
      {adjustingUser && (
        <div
          aria-label="调整用户积分"
          aria-modal="true"
          className="dialog-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setAdjustingUser(null);
          }}
          role="dialog"
        >
          <div className="dialog-panel">
            <h2>调整积分</h2>
            <p className="muted">
              {adjustingUser.username ?? adjustingUser.email ?? adjustingUser.id}
              &nbsp;·&nbsp;当前 {adjustingUser.points} 积分
            </p>
            <form
              action={adjustUserPoints}
              className="form-grid"
              onSubmit={(event) => {
                const quantity = Number(
                  (
                    event.currentTarget.elements.namedItem(
                      "_quantity",
                    ) as HTMLInputElement | null
                  )?.value ?? 0,
                );
                if (quantity > 0) {
                  const delta = adjustDirection === "subtract" ? -quantity : quantity;
                  setOptimisticPoints((prev) => ({
                    ...prev,
                    [adjustingUser.id]: adjustingUser.points + delta,
                  }));
                }
                setAdjustingUser(null);
              }}
            >
              <input name="userId" type="hidden" value={adjustingUser.id} />
              <label>
                操作
                <select
                  name="_direction"
                  value={adjustDirection}
                  onChange={(e) =>
                    setAdjustDirection(e.target.value as "add" | "subtract")
                  }
                >
                  <option value="add">赠送积分</option>
                  <option value="subtract">扣除积分</option>
                </select>
              </label>
              <label>
                数量
                <input
                  key={adjustDirection}
                  max={1_000_000_000}
                  min={1}
                  name="_quantity"
                  onWheel={(e) => e.currentTarget.blur()}
                  placeholder="请输入正整数"
                  required
                  type="number"
                />
              </label>
              <label>
                备注（可选）
                <input
                  maxLength={200}
                  name="note"
                  placeholder="调整原因，最多 200 字"
                />
              </label>
              {/* 将方向和数量合并为有符号 amount */}
              <AdjustAmountInput direction={adjustDirection} />
              <div className="dialog-actions">
                <button
                  className="button secondary"
                  onClick={() => setAdjustingUser(null)}
                  type="button"
                >
                  取消
                </button>
                <SubmitButton
                  className={adjustDirection === "subtract" ? "button danger" : "button"}
                  pendingText="提交中..."
                >
                  {adjustDirection === "add" ? "赠送" : "扣除"}
                </SubmitButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create account modal */}
      {createOpen && (
        <div
          aria-label="创建无邮箱账户"
          aria-modal="true"
          className="dialog-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setCreateOpen(false);
          }}
          role="dialog"
        >
          <div className="dialog-panel">
            <h2>创建账户</h2>
            <form action={createAdminUser} className="form-grid">
              <label>
                用户名
                <input
                  autoComplete="off"
                  maxLength={8}
                  minLength={3}
                  name="username"
                  pattern="[A-Za-z0-9_]{3,8}"
                  placeholder="例如 Player01"
                  required
                />
              </label>
              <label>
                初始密码
                <input
                  autoComplete="new-password"
                  minLength={6}
                  name="password"
                  placeholder="至少 6 位"
                  required
                  type="password"
                />
              </label>
              <label>
                初始积分
                <input
                  defaultValue={100}
                  max={1_000_000_000}
                  min={0}
                  name="points"
                  onWheel={(e) => e.currentTarget.blur()}
                  required
                  type="number"
                />
              </label>
              <div className="dialog-actions">
                <button
                  className="button secondary"
                  onClick={() => setCreateOpen(false)}
                  type="button"
                >
                  取消
                </button>
                <SubmitButton pendingText="创建中...">创建账户</SubmitButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deletingUser && (
        <div
          aria-label="确认删除账户"
          aria-modal="true"
          className="dialog-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDeletingUserId(null);
          }}
          role="dialog"
        >
          <div className="dialog-panel">
            <h2>确认删除账户？</h2>
            <p>
              将永久删除账户{" "}
              <strong>
                {deletingUser.username ?? deletingUser.email ?? deletingUser.id}
              </strong>
              ，包括所有积分记录和房间数据，无法恢复。
            </p>
            <div className="dialog-actions">
              <button
                className="button secondary"
                onClick={() => setDeletingUserId(null)}
                type="button"
              >
                取消
              </button>
              <form action={deleteAdminUser}>
                <input name="userId" type="hidden" value={deletingUser.id} />
                <SubmitButton className="button danger" pendingText="删除中...">
                  确认删除
                </SubmitButton>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// 把方向 select + 数量 input 合并成一个有符号 hidden input 供 Server Action 读取
function AdjustAmountInput({ direction }: { direction: "add" | "subtract" }) {
  return (
    <input
      name="amount"
      type="hidden"
      // 值由表单提交时动态计算，这里设占位符；实际值通过 formData 事件注入
      data-direction={direction}
      ref={(el) => {
        if (!el) return;
        const form = el.closest("form");
        if (!form) return;
        const handler = () => {
          const qty = Number((form.querySelector("[name='_quantity']") as HTMLInputElement)?.value ?? 0);
          el.value = String(direction === "subtract" ? -qty : qty);
        };
        form.removeEventListener("submit", handler);
        form.addEventListener("submit", handler);
      }}
    />
  );
}
