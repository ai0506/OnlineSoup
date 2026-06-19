"use client";

import { useRef, useState, useTransition } from "react";

type AiErrorStatus = "open" | "reviewed" | "fixed" | "ignored";

type AdminAiErrorEditFormProps = {
  caseId: string;
  correctAnswer: string;
  note: string;
  status: AiErrorStatus;
  action: (formData: FormData) => void | Promise<void>;
};

const statusLabels: Record<AiErrorStatus, string> = {
  open: "待处理",
  reviewed: "已复核",
  fixed: "已修复",
  ignored: "忽略",
};

export function AdminAiErrorEditForm({
  caseId,
  correctAnswer,
  note,
  status,
  action,
}: AdminAiErrorEditFormProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const dialogRef = useRef<HTMLDialogElement>(null);

  function openDialog() {
    setOpen(true);
    setTimeout(() => dialogRef.current?.showModal(), 0);
  }

  function closeDialog() {
    dialogRef.current?.close();
    setOpen(false);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      await action(formData);
      closeDialog();
    });
  }

  return (
    <>
      <button className="button ghost admin-ai-error-trigger" onClick={openDialog} type="button">
        编辑案例
      </button>

      {open && (
        <dialog className="admin-ai-error-dialog" ref={dialogRef}>
          <div className="dialog-panel">
            <div className="dialog-header">
              <h3>编辑 AI 错误案例</h3>
              <button aria-label="关闭" className="button ghost icon-button" onClick={closeDialog} type="button">
                ✕
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <input name="caseId" type="hidden" value={caseId} />
              <div className="dialog-body">
                <label>
                  正确答案
                  <textarea
                    autoFocus
                    defaultValue={correctAnswer}
                    maxLength={1000}
                    name="correctAnswer"
                    required
                    rows={3}
                  />
                </label>
                <label>
                  备注
                  <textarea
                    defaultValue={note}
                    maxLength={1000}
                    name="note"
                    rows={2}
                  />
                </label>
                <label>
                  状态
                  <select defaultValue={status} name="status">
                    {(Object.entries(statusLabels) as [AiErrorStatus, string][]).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="dialog-footer">
                <button className="button ghost" onClick={closeDialog} type="button">
                  取消
                </button>
                <button className="button secondary" disabled={isPending} type="submit">
                  {isPending ? "保存中…" : "保存案例"}
                </button>
              </div>
            </form>
          </div>
        </dialog>
      )}
    </>
  );
}
