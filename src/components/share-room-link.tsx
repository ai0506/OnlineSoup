"use client";

import { useState } from "react";

type ShareRoomLinkProps = {
  code: string;
};

export function ShareRoomLink({ code }: ShareRoomLinkProps) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    const link = `${window.location.origin}/rooms/${code}`;
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(link);
      } else {
        const input = document.createElement("textarea");
        input.value = link;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      aria-label="复制房间分享链接"
      title={copied ? "链接已复制" : "复制分享链接"}
      className="button secondary copy-code-button"
      onClick={copyLink}
      type="button"
    >
      {copied ? (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
