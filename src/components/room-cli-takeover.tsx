"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { confirmCliRoomTakeover } from "@/app/rooms/takeover-actions";

export function RoomCliTakeover({ code, version }: { code: string; version: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(confirmCliRoomTakeover, { version, cliInUse: true, message: "" });
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !pending) router.replace("/"); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [pending, router]);
  return (
    <section className="join-landing">
      <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="cli-takeover-title">
        <div className="dialog-panel">
          <h2 id="cli-takeover-title">进入正在使用的座位？</h2>
          <p className="muted">你的账号正在通过 CLI 使用此房间的座位。继续进入后，CLI 端将无法继续操作此房间。确认进入吗？</p>
          {state.message && <p role="alert">{state.message}</p>}
          <form action={action}>
            <input type="hidden" name="code" value={code} />
            <input type="hidden" name="version" value={state.version} />
            <div className="dialog-actions">
              <button className="button secondary" type="button" autoFocus disabled={pending} onClick={() => router.replace("/")}>取消</button>
              {state.cliInUse ? <button className="button" type="submit" disabled={pending}>{pending ? "正在进入..." : "确认进入"}</button>
                : <Link className="button" href={`/rooms/${code}?action=enter`}>重新进入</Link>}
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
