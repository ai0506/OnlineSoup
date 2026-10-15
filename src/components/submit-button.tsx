"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";

type SubmitButtonProps = {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
};

// pending 要等下一次渲染才生效，这段时间内的重复点击仍会再次提交，用短时间窗口拦住
const REPEAT_CLICK_WINDOW_MS = 600;

export function SubmitButton({
  children,
  pendingText = "处理中...",
  className = "button",
  formAction,
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  const lastClickAt = useRef(0);

  return (
    <button
      className={className}
      disabled={pending}
      formAction={formAction}
      onClick={(event) => {
        const now = Date.now();
        if (now - lastClickAt.current < REPEAT_CLICK_WINDOW_MS) {
          event.preventDefault();
          return;
        }
        // 表单校验未通过时不会提交，不计入窗口，避免改完内容后点不动
        if (event.currentTarget.form?.checkValidity() === false) return;
        lastClickAt.current = now;
      }}
      type="submit"
    >
      {pending ? pendingText : children}
    </button>
  );
}
