"use client";

import { useRef, useState, useTransition } from "react";

type ReasoningCoverageItem = {
  id: number;
  text?: string;
  covered: boolean;
};

type AdminAiErrorFormProps = {
  aiMessageId: number;
  action: (formData: FormData) => void | Promise<void>;
  reasoningCoverage?: ReasoningCoverageItem[];
};

export function AdminAiErrorForm({ aiMessageId, action, reasoningCoverage }: AdminAiErrorFormProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isReasoning = Array.isArray(reasoningCoverage) && reasoningCoverage.length > 0;

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

    if (isReasoning && reasoningCoverage) {
      const corrections = reasoningCoverage.map((item) => ({
        id: item.id,
        correct: formData.get(`coverage_${item.id}`) === "true",
      }));
      formData.set("correctAnswer", JSON.stringify(corrections));
      formData.delete("messageMode");
      formData.set("messageMode", "reason");
    }

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
              <h3>标记 AI {isReasoning ? "推理" : "询问"}错误案例</h3>
              <button aria-label="关闭" className="button ghost icon-button" onClick={closeDialog} type="button">
                ✕
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <input name="aiMessageId" type="hidden" value={aiMessageId} />
              <div className="dialog-body">
                {isReasoning && reasoningCoverage ? (
                  <>
                    <p className="admin-ai-error-reason-hint">
                      请为每个评分点指定正确答案。AI 给出的值已预填，修改有误的项。
                    </p>
                    <div className="admin-reasoning-correction-list">
                      {reasoningCoverage.map((item) => (
                        <div className="admin-reasoning-correction-item" key={item.id}>
                          <div className="admin-reasoning-correction-info">
                            <span className="admin-reasoning-correction-id">#{item.id}</span>
                            {item.text && <span className="admin-reasoning-correction-text">{item.text}</span>}
                            <span className={`admin-reasoning-ai-badge${item.covered ? " covered" : ""}`}>
                              AI: {item.covered ? "已覆盖" : "未覆盖"}
                            </span>
                          </div>
                          <select
                            className="admin-reasoning-correction-select"
                            defaultValue={item.covered ? "true" : "false"}
                            name={`coverage_${item.id}`}
                          >
                            <option value="true">已覆盖</option>
                            <option value="false">未覆盖</option>
                          </select>
                        </div>
                      ))}
                    </div>
                    <label>
                      备注
                      <textarea
                        autoFocus
                        maxLength={1000}
                        name="note"
                        placeholder="可选：记录为什么判错、希望之后怎么改"
                        rows={2}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      正确答案
                      <textarea
                        autoFocus
                        maxLength={2000}
                        name="correctAnswer"
                        placeholder={'例如：这里应该回答"否"，因为……'}
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
                  </>
                )}
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
