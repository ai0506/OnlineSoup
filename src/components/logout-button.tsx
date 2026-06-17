"use client";

import { useState } from "react";

import { logout } from "@/app/auth/actions";

export function LogoutButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="link-button"
        onClick={() => setOpen(true)}
        type="button"
      >
        退出登录
      </button>
      {open && (
        <div
          aria-labelledby="logout-dialog-title"
          aria-modal="true"
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setOpen(false);
            }
          }}
          role="dialog"
        >
          <div className="dialog-panel">
            <h2 id="logout-dialog-title">退出登录？</h2>
            <p className="muted">退出后，需要重新登录才能创建和管理房间。</p>
            <div className="dialog-actions">
              <button
                className="button secondary"
                onClick={() => setOpen(false)}
                type="button"
              >
                取消
              </button>
              <form action={logout}>
                <button className="button danger" type="submit">
                  退出登录
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
