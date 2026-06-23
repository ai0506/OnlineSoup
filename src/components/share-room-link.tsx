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
      className="button secondary copy-code-button"
      onClick={copyLink}
      type="button"
    >
      {copied ? "已复制" : "分享链接"}
    </button>
  );
}
