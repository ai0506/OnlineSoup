"use client";

import { useState } from "react";

type CopyRoomCodeProps = {
  code: string;
};

export function CopyRoomCode({ code }: CopyRoomCodeProps) {
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(code);
      } else {
        const input = document.createElement("textarea");
        input.value = code;
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
      aria-label={`复制房间码 ${code}`}
      className="button secondary copy-code-button"
      onClick={copyCode}
      type="button"
    >
      {copied ? "已复制" : "复制"}
    </button>
  );
}
