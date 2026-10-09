"use client";

import { useEffect } from "react";

// action=enter 表达的是“这一次点击要接管会话”的一次性意图。
// 留在地址栏里会让之后的每次刷新都变成强制接管，绕过“已被其他设备接管”的提示，
// 所以进入房间后把它从地址里去掉（replaceState 不触发导航，不额外请求）。
export function StripRoomEnterParam() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("action") !== "enter") return;
    url.searchParams.delete("action");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  return null;
}
