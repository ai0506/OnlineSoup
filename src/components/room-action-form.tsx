"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import type { RoomActionState } from "@/app/rooms/actions";
import { SubmitButton } from "@/components/submit-button";

type RoomAction = (
  state: RoomActionState,
  formData: FormData,
) => Promise<RoomActionState>;

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
}: RoomActionFormProps) {
  const router = useRouter();
  const [state, formAction] = useActionState(action, initialState);

  useEffect(() => {
    if (state.navigateTo) {
      router.replace(state.navigateTo);
    }
    if (state.status === "success" && onSuccess) {
      onSuccess();
    }
    if (state.status === "success") {
      window.dispatchEvent(new Event("room-data-refresh"));
    }
  }, [router, state, onSuccess]);

  return (
    <form action={formAction} className={className}>
      <input name="code" type="hidden" value={code} />
      {seatId && <input name="seatId" type="hidden" value={seatId} />}
      {children}
      <SubmitButton
        className={buttonClassName}
        pendingText={pendingText}
      >
        {buttonText}
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
}
