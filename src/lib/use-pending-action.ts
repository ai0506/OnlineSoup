"use client";

import { useEffect, useRef, useState, useTransition } from "react";

type ServerAction = (formData: FormData) => void | Promise<void>;

/**
 * 管理端按钮直接调用 Server Action 时的提交状态：同一时间只允许一个请求，
 * 并告诉界面是哪个按钮在处理中。管理端 action 结束时会 redirect，
 * 部分情况下 await 拿不到返回，所以 resetOn（服务端回传的数据）变化时也会解除。
 */
export function usePendingAction<K extends string>(resetOn: unknown) {
  const [pendingKey, setPendingKey] = useState<K | null>(null);
  const [syncedResetOn, setSyncedResetOn] = useState(resetOn);
  const inFlight = useRef(false);
  const [, startTransition] = useTransition();

  if (syncedResetOn !== resetOn) {
    setSyncedResetOn(resetOn);
    setPendingKey(null);
  }

  useEffect(() => {
    inFlight.current = false;
  }, [resetOn]);

  function run(key: K, action: ServerAction, formData: FormData, onDone?: () => void) {
    // 用 ref 拦截连点：两次点击可能落在同一次渲染之前
    if (inFlight.current) return;
    inFlight.current = true;
    setPendingKey(key);
    startTransition(async () => {
      try {
        await action(formData);
        onDone?.();
      } finally {
        inFlight.current = false;
        setPendingKey(null);
      }
    });
  }

  return { busy: pendingKey !== null, pendingKey, run };
}
