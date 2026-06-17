"use client";

import { useMemo, useState } from "react";

import { SubmitButton } from "@/components/submit-button";

type PuzzleDifficulty = "简单" | "中等" | "困难" | "抽象";
type ExampleAnswer = "是" | "否" | "与此无关" | "模糊问题";

export type AdminPuzzleFormValue = {
  id?: number;
  title?: string;
  surface?: string;
  bottom?: string;
  difficulty?: PuzzleDifficulty;
  is_active?: boolean;
  key_points?: Array<{
    id?: number;
    text?: string;
    accept?: string[];
  }> | null;
  examples?: Array<{
    question?: string;
    answer?: string;
    reason?: string;
    summary?: string | null;
  }> | null;
};

type DraftPoint = {
  key: string;
  text: string;
  accept: string;
};

type DraftExample = {
  key: string;
  question: string;
  answer: ExampleAnswer;
  reason: string;
  summary: string;
};

type AdminPuzzleFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  className?: string;
  mode: "create" | "edit";
  puzzle?: AdminPuzzleFormValue;
  returnTab?: "accounts" | "puzzles";
};

const difficulties: PuzzleDifficulty[] = ["简单", "中等", "困难", "抽象"];
const exampleAnswers: ExampleAnswer[] = ["是", "否", "与此无关", "模糊问题"];

function newKey(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizePoints(puzzle?: AdminPuzzleFormValue): DraftPoint[] {
  return (puzzle?.key_points ?? []).map((point, index) => ({
    key: `point-${point.id ?? index}`,
    text: point.text ?? "",
    accept: (point.accept ?? []).join(", "),
  }));
}

function normalizeExamples(puzzle?: AdminPuzzleFormValue): DraftExample[] {
  return (puzzle?.examples ?? []).map((example, index) => ({
    key: `example-${index}`,
    question: example.question ?? "",
    answer: exampleAnswers.includes(example.answer as ExampleAnswer)
      ? (example.answer as ExampleAnswer)
      : "是",
    reason: example.reason ?? "",
    summary: example.summary ?? "",
  }));
}

export function AdminPuzzleForm({
  action,
  className,
  mode,
  puzzle,
  returnTab,
}: AdminPuzzleFormProps) {
  const initialPoints = useMemo(() => normalizePoints(puzzle), [puzzle]);
  const initialExamples = useMemo(() => normalizeExamples(puzzle), [puzzle]);
  const [points, setPoints] = useState<DraftPoint[]>(initialPoints);
  const [examples, setExamples] = useState<DraftExample[]>(initialExamples);

  return (
    <form action={action} className={className}>
      {returnTab && <input name="returnTab" type="hidden" value={returnTab} />}
      {puzzle?.id && <input name="puzzleId" type="hidden" value={puzzle.id} />}

      <div className="admin-puzzle-grid">
        <label>
          标题
          <input
            defaultValue={puzzle?.title ?? ""}
            maxLength={60}
            name="title"
            required
          />
        </label>
        <label>
          难度
          <select name="difficulty" required defaultValue={puzzle?.difficulty ?? "中等"}>
            {difficulties.map((difficulty) => (
              <option key={difficulty} value={difficulty}>
                {difficulty}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label>
        题面
        <textarea
          defaultValue={puzzle?.surface ?? ""}
          maxLength={1000}
          minLength={5}
          name="surface"
          required
          rows={3}
        />
      </label>

      <label>
        汤底
        <textarea
          defaultValue={puzzle?.bottom ?? ""}
          maxLength={2000}
          minLength={5}
          name="bottom"
          required
          rows={4}
        />
      </label>

      <div className="admin-subform-section">
        <div className="admin-subform-heading">
          <span>评分点</span>
        </div>

        {points.map((point, index) => (
          <div className="admin-subform-card" key={point.key}>
            <div className="admin-subform-title">
              <strong>评分点 {index + 1}</strong>
              <button
                className="button danger-text small"
                onClick={() =>
                  setPoints((items) => items.filter((item) => item.key !== point.key))
                }
                type="button"
              >
                删除
              </button>
            </div>
            <div className="admin-subform-row">
              <label>
                内容
                <input
                  defaultValue={point.text}
                  name="pointText"
                  placeholder="例如：男人曾经遇到海难"
                />
              </label>
              <label>
                Accept:
                <input
                  defaultValue={point.accept}
                  name="pointAccept"
                  placeholder="例如：海难, 船难, 荒岛"
                />
              </label>
            </div>
          </div>
        ))}

        <button
          className="button secondary small admin-subform-add"
          onClick={() =>
            setPoints((items) => [
              ...items,
              { key: newKey("point"), text: "", accept: "" },
            ])
          }
          type="button"
        >
          新增评分点
        </button>
      </div>

      <div className="admin-subform-section">
        <div className="admin-subform-heading">
          <span>示例问题</span>
        </div>

        {examples.map((example, index) => (
          <div className="admin-subform-card" key={example.key}>
            <div className="admin-subform-title">
              <strong>示例问题 {index + 1}</strong>
              <button
                className="button danger-text small"
                onClick={() =>
                  setExamples((items) =>
                    items.filter((item) => item.key !== example.key),
                  )
                }
                type="button"
              >
                删除
              </button>
            </div>
            <div className="admin-subform-row">
              <label>
                问题
                <input
                  defaultValue={example.question}
                  name="exampleQuestion"
                  placeholder="例如：男人遇到过海难吗？"
                />
              </label>
              <label>
                选项
                <select name="exampleAnswer" defaultValue={example.answer}>
                  {exampleAnswers.map((answer) => (
                    <option key={answer} value={answer}>
                      {answer}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              原因
              <textarea
                defaultValue={example.reason}
                name="exampleReason"
                rows={2}
              />
            </label>
            <label>
              总结
              <input defaultValue={example.summary} name="exampleSummary" />
            </label>
          </div>
        ))}

        <button
          className="button secondary small admin-subform-add"
          onClick={() =>
            setExamples((items) => [
              ...items,
              {
                key: newKey("example"),
                question: "",
                answer: "是",
                reason: "",
                summary: "",
              },
            ])
          }
          type="button"
        >
          新增示例问题
        </button>
      </div>

      {mode === "edit" && (
        <label className="checkbox-line">
          <input
            defaultChecked={puzzle?.is_active ?? true}
            name="isActive"
            type="checkbox"
          />
          可在房间内选择
        </label>
      )}

      <SubmitButton pendingText={mode === "create" ? "新增中..." : "保存中..."}>
        {mode === "create" ? "保存新题目" : "保存题目"}
      </SubmitButton>
    </form>
  );
}
