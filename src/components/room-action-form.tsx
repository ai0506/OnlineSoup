"use client";

import { useActionState, useEffect, useState } from "react";

import type { RoomActionState } from "@/app/rooms/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SubmitButton } from "@/components/submit-button";

type RoomAction = (
  state: RoomActionState,
  formData: FormData,
) => Promise<RoomActionState>;

type RoomActionConfirm = {
  title: string;
  message: string;
  confirmText: string;
  confirmClassName?: string;
};

type RoomActionFormProps = {
  action: RoomAction;
  children?: React.ReactNode;
  className?: string;
  code: string;
  pendingText: string;
  buttonText: string;
  buttonClassName?: string;
  seatId?: string;
  onSuccess?: () => void;
  confirm?: RoomActionConfirm;
};

const initialState: RoomActionState = { status: "idle" };

export function RoomActionForm({
  action,
  children,
  className,
  code,
  pendingText,
  buttonText,
  buttonClassName,
  seatId,
  onSuccess,
  confirm,
}: RoomActionFormProps) {
  const [state, formAction] = useActionState(action, initialState);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (state.navigateTo) {
      // 用整页跳转替代软导航，确保关闭/退出房间后立即离开，
      // 并让服务端重新渲染顶部积分等布局信息。
      window.location.replace(state.navigateTo);
      return;
    }
    if (state.status === "success" && onSuccess) {
      onSuccess();
    }
    if (state.status === "success") {
      window.dispatchEvent(new Event("room-data-refresh"));
    }
  }, [state, onSuccess]);

  const form = (submitText: string, submitClassName?: string) => (
    <form action={formAction} className={className}>
      <input name="code" type="hidden" value={code} />
      {seatId && <input name="seatId" type="hidden" value={seatId} />}
      {children}
      <SubmitButton
        className={submitClassName}
        pendingText={pendingText}
      >
        {submitText}
      </SubmitButton>
      {state.status === "error" && (
        <div className="error" role="alert">
          {state.message}
        </div>
      )}
      {state.status === "success" && state.message && (
        <div className="notice">{state.message}</div>
      )}
    </form>
  );

  if (!confirm) {
    return form(buttonText, buttonClassName);
  }

  return (
    <>
      <button
        className={buttonClassName}
        onClick={() => setConfirmOpen(true)}
        type="button"
      >
        {buttonText}
      </button>
      {confirmOpen && (
        <ConfirmDialog onClose={() => setConfirmOpen(false)} title={confirm.title}>
          <p className="muted">{confirm.message}</p>
          <div className="dialog-actions">
            <button
              className="button secondary"
              onClick={() => setConfirmOpen(false)}
              type="button"
            >
              取消
            </button>
            {form(confirm.confirmText, confirm.confirmClassName ?? "button danger")}
          </div>
        </ConfirmDialog>
      )}
    </>
  );
}
