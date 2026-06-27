"use client";

import { useEffect, useState } from "react";

type NoticeMessageProps = {
  type: "notice" | "error";
  message: string;
};

export function NoticeMessage({ type, message }: NoticeMessageProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div className={type} role="alert">
      <span>{message}</span>
      <button
        aria-label="关闭"
        className="notice-close"
        onClick={() => setVisible(false)}
        type="button"
      >
        ×
      </button>
    </div>
  );
}
