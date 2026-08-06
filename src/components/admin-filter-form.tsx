"use client";

import { useRouter } from "next/navigation";
import { useTransition, type FormEvent, type ReactNode } from "react";

type AdminFilterFormProps = {
  children: ReactNode;
  className?: string;
};

export function AdminFilterForm({ children, className }: AdminFilterFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const params = new URLSearchParams();
    const formData = new FormData(form);

    for (const [key, value] of formData.entries()) {
      const normalizedValue =
        typeof value === "string" ? value.trim() : value.name.trim();

      if (normalizedValue) {
        params.append(key, normalizedValue);
      }
    }

    const query = params.toString();
    const action = form.getAttribute("action") ?? form.action;
    startTransition(() => router.push(`${action}${query ? `?${query}` : ""}`));
  }

  return (
    <form
      action="/admin"
      className={`${className ?? ""}${isPending ? " is-loading" : ""}`}
      onSubmit={handleSubmit}
    >
      {children}
      {isPending && (
        <p className="admin-filter-pending" role="status" aria-live="polite">
          正在查询…
        </p>
      )}
    </form>
  );
}
