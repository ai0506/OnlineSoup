"use client";

import { useActionState, useEffect, useState } from "react";

import { updateRoomPassword } from "@/app/rooms/actions";
import type { RoomActionState } from "@/app/rooms/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";

const initialState: RoomActionState = { status: "idle" };

type RoomPasswordButtonProps = {
  code: string;
  hasPassword: boolean;
};

export function RoomPasswordButton({ code, hasPassword }: RoomPasswordButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="button secondary" onClick={() => setOpen(true)} type="button">
        修改密码
      </button>
      {open && (
        <RoomPasswordDialog code={code} hasPassword={hasPassword} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

// 每次打开都重新挂载，避免沿用上一次的提交结果
function RoomPasswordDialog({
  code,
  hasPassword,
  onClose,
}: RoomPasswordButtonProps & { onClose: () => void }) {
  const [state, formAction, isPending] = useActionState(updateRoomPassword, initialState);

  useEffect(() => {
    if (state.status === "success") onClose();
  }, [state, onClose]);

  return (
    <ConfirmDialog onClose={onClose} title="修改房间密码">
      <p className="muted">
        {hasPassword
          ? "设置新的 6 位数字密码，旧密码会立即失效；已在房间里的成员不受影响。"
          : "当前房间无需密码。设置后，新加入的玩家需要输入密码。"}
      </p>
      <form action={formAction} className="form-grid room-password-form">
        <input name="code" type="hidden" value={code} />
        <input
          aria-label="新密码"
          autoComplete="off"
          autoFocus
          inputMode="numeric"
          maxLength={6}
          minLength={6}
          name="password"
          pattern="[0-9]{6}"
          placeholder="输入 6 位数字"
          required
        />
        {state.status === "error" && (
          <div className="error" role="alert">{state.message}</div>
        )}
        <div className="dialog-actions">
          {hasPassword && (
            <button
              className="button ghost room-password-clear"
              disabled={isPending}
              formNoValidate
              name="mode"
              type="submit"
              value="clear"
            >
              改为无需密码
            </button>
          )}
          <button className="button secondary" disabled={isPending} onClick={onClose} type="button">
            取消
          </button>
          <button className="button" disabled={isPending} name="mode" type="submit" value="set">
            {isPending ? "正在保存..." : "保存密码"}
          </button>
        </div>
      </form>
    </ConfirmDialog>
  );
}
