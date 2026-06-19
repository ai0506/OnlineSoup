"use client";

import { useMemo, useState } from "react";

import { SubmitButton } from "@/components/submit-button";

type PuzzleDifficulty = "简单" | "中等" | "困难" | "抽象";
type ExampleAnswer = "是" | "否" | "与此无关" | "模糊问题";
type ExampleModel = "fact" | "inferential";

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
    model?: string;
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
  model: ExampleModel;
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
    model: example.model === "inferential" ? "inferential" : "fact",
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
  const factExamples = examples.filter((example) => example.model === "fact");
  const inferentialExamples = examples.filter(
    (example) => example.model === "inferential",
  );

  const updateExample = (
    key: string,
    patch: Partial<Omit<DraftExample, "key">>,
  ) => {
    setExamples((current) =>
      current.map((example) =>
        example.key === key ? { ...example, ...patch } : example,
      ),
    );
  };

  const moveExampleWithinModel = (
    key: string,
    model: ExampleModel,
    direction: -1 | 1,
  ) => {
    setExamples((current) => {
      const modelItems = current.filter((example) => example.model === model);
      const index = modelItems.findIndex((example) => example.key === key);
      const targetIndex = index + direction;

      if (index < 0 || targetIndex < 0 || targetIndex >= modelItems.length) {
        return current;
      }

      const orderedModelItems = [...modelItems];
      const [moved] = orderedModelItems.splice(index, 1);
      orderedModelItems.splice(targetIndex, 0, moved);

      let nextModelIndex = 0;
      return current.map((example) =>
        example.model === model ? orderedModelItems[nextModelIndex++] : example,
      );
    });
  };

  const moveExampleToModel = (key: string, targetModel: ExampleModel) => {
    setExamples((current) => {
      const moving = current.find((example) => example.key === key);
      if (!moving || moving.model === targetModel) return current;

      const withoutMoving = current.filter((example) => example.key !== key);
      const moved = { ...moving, model: targetModel };
      const lastTargetIndex = withoutMoving.reduce(
        (lastIndex, example, index) =>
          example.model === targetModel ? index : lastIndex,
        -1,
      );

      if (lastTargetIndex < 0) return [...withoutMoving, moved];

      return [
        ...withoutMoving.slice(0, lastTargetIndex + 1),
        moved,
        ...withoutMoving.slice(lastTargetIndex + 1),
      ];
    });
  };

  const renderExampleSection = (
    title: string,
    model: ExampleModel,
    items: DraftExample[],
  ) => {
    const targetModel = model === "fact" ? "inferential" : "fact";
    const targetTitle =
      targetModel === "fact" ? "事实模型示例问题" : "推断模型示例问题";

    return (
      <div className="admin-subform-example-group">
        <div className="admin-subform-heading">
          <span>{title}</span>
        </div>

        {items.map((example, index) => (
          <div className="admin-subform-card" key={example.key}>
            <input name="exampleModel" type="hidden" value={example.model} />
            <div className="admin-subform-title">
              <strong>示例问题 {index + 1}</strong>
              <div className="admin-example-actions">
                <button
                  className="button secondary small"
                  disabled={index === 0}
                  onClick={() => moveExampleWithinModel(example.key, model, -1)}
                  type="button"
                >
                  上移
                </button>
                <button
                  className="button secondary small"
                  disabled={index === items.length - 1}
                  onClick={() => moveExampleWithinModel(example.key, model, 1)}
                  type="button"
                >
                  下移
                </button>
                <button
                  className="button secondary small"
                  onClick={() => moveExampleToModel(example.key, targetModel)}
                  type="button"
                >
                  移动到{targetTitle}
                </button>
                <button
                  className="button danger-text small"
                  onClick={() =>
                    setExamples((current) =>
                      current.filter((item) => item.key !== example.key),
                    )
                  }
                  type="button"
                >
                  删除
                </button>
              </div>
            </div>
            <div className="admin-subform-row">
              <label>
                问题
                <input
                  name="exampleQuestion"
                  onChange={(event) =>
                    updateExample(example.key, { question: event.target.value })
                  }
                  placeholder="例如：男人遇到过海难吗？"
                  value={example.question}
                />
              </label>
              <label>
                选项
                <select
                  name="exampleAnswer"
                  onChange={(event) =>
                    updateExample(example.key, {
                      answer: event.target.value as ExampleAnswer,
                    })
                  }
                  value={example.answer}
                >
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
                name="exampleReason"
                onChange={(event) =>
                  updateExample(example.key, { reason: event.target.value })
                }
                rows={2}
                value={example.reason}
              />
            </label>
            <label>
              总结
              <input
                name="exampleSummary"
                onChange={(event) =>
                  updateExample(example.key, { summary: event.target.value })
                }
                value={example.summary}
              />
            </label>
          </div>
        ))}

        <button
          className="button secondary small admin-subform-add"
          onClick={() =>
            setExamples((current) => [
              ...current,
              {
                key: newKey("example"),
                model,
                question: "",
                answer: "是",
                reason: "",
                summary: "",
              },
            ])
          }
          type="button"
        >
          新增{title}
        </button>
      </div>
    );
  };

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

        {renderExampleSection("事实模型示例问题", "fact", factExamples)}
        {renderExampleSection("推断模型示例问题", "inferential", inferentialExamples)}
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
