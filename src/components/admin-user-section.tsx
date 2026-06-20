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
};

type AdminUserSectionProps = {
  users: AdminUserEntry[];
  createAdminUser: (formData: FormData) => Promise<void>;
  updateUserUsername: (formData: FormData) => Promise<void>;
  adjustUserPoints: (formData: FormData) => Promise<void>;
  updateUserPassword: (formData: FormData) => Promise<void>;
  sendPasswordReset: (formData: FormData) => Promise<void>;
  deleteAdminUser: (formData: FormData) => Promise<void>;
};

export function AdminUserSection({
  users,
  createAdminUser,
  updateUserUsername,
  adjustUserPoints,
  updateUserPassword,
  sendPasswordReset,
  deleteAdminUser,
}: AdminUserSectionProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [adjustingUser, setAdjustingUser] = useState<AdminUserEntry | null>(null);
  const [adjustDirection, setAdjustDirection] = useState<"add" | "subtract">("add");

  const deletingUser = deletingUserId
    ? users.find((u) => u.id === deletingUserId)
    : null;

  return (
    <>
      <div className="admin-section-heading">
        <div>
          <h2>账户管理</h2>
          <p className="muted">创建账户，或修改用户名、密码、积分。</p>
        </div>
        <button
          className="button"
          onClick={() => setCreateOpen(true)}
          type="button"
        >
          创建账户
        </button>
      </div>

      <div className="admin-list">
        {users.map((user) => {
          const emailless = isEmailless(user.email);
          const displayEmail = emailless
            ? "无邮箱账户"
            : (user.email ?? "无邮箱账户");

          return (
            <article className="admin-user-card" key={user.id}>
              <div className="admin-user-summary">
                <div>
                  <strong>{displayEmail}</strong>
                  <span>{user.username ?? "未设置用户名"}</span>
                </div>
                <div className="admin-user-summary-right">
                  <div className="points-badge">{user.points} 积分</div>
                  <button
                    className="button secondary small"
                    onClick={() => {
                      setAdjustDirection("add");
                      setAdjustingUser(user);
                    }}
                    type="button"
                  >
                    调整积分
                  </button>
                  <button
                    className="button danger small"
                    onClick={() => setDeletingUserId(user.id)}
                    type="button"
                  >
                    删除
                  </button>
                </div>
              </div>

              <div className="admin-user-actions">
                <form action={updateUserUsername} className="inline-admin-form">
                  <input name="userId" type="hidden" value={user.id} />
                  <label>
                    用户名
                    <input
                      defaultValue={user.username ?? ""}
                      maxLength={8}
                      minLength={3}
                      name="username"
                      pattern="[A-Za-z0-9_]{3,8}"
                      required
                    />
                  </label>
                  <SubmitButton pendingText="保存中...">保存用户名</SubmitButton>
                </form>

                <form action={updateUserPassword} className="inline-admin-form">
                  <input name="userId" type="hidden" value={user.id} />
                  <label>
                    新密码
                    <input
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

                {!emailless && (
                  <form action={sendPasswordReset} className="password-reset-form">
                    <input name="userId" type="hidden" value={user.id} />
                    <SubmitButton
                      className="button secondary"
                      pendingText="发送中..."
                    >
                      发送重置邮件
                    </SubmitButton>
                  </form>
                )}
              </div>
            </article>
          );
        })}

        {users.length === 0 && (
          <div className="card muted">没有找到匹配的账户。</div>
        )}
      </div>

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
            <form action={adjustUserPoints} className="form-grid" onSubmit={() => setAdjustingUser(null)}>
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
