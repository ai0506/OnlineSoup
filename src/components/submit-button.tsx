"use client";

import { useFormStatus } from "react-dom";

type SubmitButtonProps = {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
};

export function SubmitButton({
  children,
  pendingText = "处理中...",
  className = "button",
  formAction,
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      className={className}
      disabled={pending}
      formAction={formAction}
      type="submit"
    >
      {pending ? pendingText : children}
    </button>
  );
}
