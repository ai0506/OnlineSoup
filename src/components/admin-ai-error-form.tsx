"use client";

import { useRef, useState, useTransition } from "react";

type AdminAiErrorFormProps = {
  aiMessageId: number;
  action: (formData: FormData) => void | Promise<void>;
};

export function AdminAiErrorForm({ aiMessageId, action }: AdminAiErrorFormProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const dialogRef = useRef<HTMLDialogElement>(null);

  function openDialog() {
    setOpen(true);
    // 等 DOM 更新后再 showModal
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
        标记错误
      </button>

      {open && (
        <dialog className="admin-ai-error-dialog" ref={dialogRef}>
          <div className="dialog-panel">
            <div className="dialog-header">
              <h3>标记 AI 错误案例</h3>
              <button aria-label="关闭" className="button ghost icon-button" onClick={closeDialog} type="button">
                ✕
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <input name="aiMessageId" type="hidden" value={aiMessageId} />
              <div className="dialog-body">
                <label>
                  正确答案
                  <textarea
                    autoFocus
                    maxLength={1000}
                    name="correctAnswer"
                    placeholder={'例如：这里应该回答“否”，因为……'}
                    required
                    rows={3}
                  />
                </label>
                <label>
                  备注
                  <textarea
                    maxLength={1000}
                    name="note"
                    placeholder="可选：记录为什么判错、希望之后怎么改"
                    rows={2}
                  />
                </label>
              </div>
              <div className="dialog-footer">
                <button className="button ghost" onClick={closeDialog} type="button">
                  取消
                </button>
                <button className="button secondary" disabled={isPending} type="submit">
                  {isPending ? "提交中…" : "确认标记"}
                </button>
              </div>
            </form>
          </div>
        </dialog>
      )}
    </>
  );
}
