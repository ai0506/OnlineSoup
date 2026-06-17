"use client";

import { useEffect } from "react";

export function FlashCookieCleaner() {
  useEffect(() => {
    void fetch("/flash/clear", { method: "POST" });
  }, []);

  return null;
}
