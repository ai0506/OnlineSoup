"use client";

import { useRouter } from "next/navigation";
import type { FormEvent, ReactNode } from "react";

type AdminFilterFormProps = {
  children: ReactNode;
  className?: string;
};

export function AdminFilterForm({ children, className }: AdminFilterFormProps) {
  const router = useRouter();

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
    router.push(`${action}${query ? `?${query}` : ""}`);
  }

  return (
    <form action="/admin" className={className} onSubmit={handleSubmit}>
      {children}
    </form>
  );
}
