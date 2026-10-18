"use client";

import { useEffect, useId } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

type ConfirmDialogProps = {
  title: string;
  children: ReactNode;
  onClose: () => void;
};

// 挂到 body：触发按钮可能在带 transform 或会被点击外部关闭的浮层里
export function ConfirmDialog({ title, children, onClose }: ConfirmDialogProps) {
  const titleId = useId();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
    >
      <div className="dialog-panel">
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
