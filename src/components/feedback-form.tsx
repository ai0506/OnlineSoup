"use client";

import { useEffect, useRef, useState } from "react";

import { SubmitButton } from "@/components/submit-button";

type FeedbackCategory = "bug" | "ai" | "suggestion" | "puzzle" | "other";

type FeedbackFormProps = {
  action: (formData: FormData) => Promise<void>;
};

const CATEGORY_OPTIONS: { value: FeedbackCategory; label: string }[] = [
  { value: "bug", label: "功能异常" },
  { value: "ai", label: "AI 判定问题" },
  { value: "suggestion", label: "体验建议" },
  { value: "puzzle", label: "投稿汤" },
  { value: "other", label: "其他" },
];

const PLACEHOLDERS: Record<FeedbackCategory, string> = {
  bug: "说明你在哪个页面、做了什么操作、出现了什么结果。如果在房间里遇到，带上房间码会更好定位。",
  ai: "写下你的提问、AI 的回答，以及你认为正确的答案。",
  suggestion: "描述你希望改进的地方，以及理想中的效果。",
  puzzle: "汤面：\n\n汤底：\n\n（也可以补充难度、关键点或出处）",
  other: "写下你想告诉我们的内容。",
};

const MAX_LENGTH = 2000;

export function FeedbackForm({ action }: FeedbackFormProps) {
  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [content, setContent] = useState("");
  const pagePathRef = useRef<HTMLInputElement>(null);

  // 记录来源页面（例如从房间页新标签打开），便于后台定位问题场景
  useEffect(() => {
    const input = pagePathRef.current;
    if (!input || !document.referrer) return;
    try {
      const url = new URL(document.referrer);
      if (url.origin === window.location.origin && url.pathname !== "/feedback") {
        input.value = url.pathname;
      }
    } catch {
      // 来源不可解析时忽略
    }
  }, []);

  return (
    <form action={action} className="form-grid feedback-form">
      <input defaultValue="" name="pagePath" ref={pagePathRef} type="hidden" />
      <label>
        反馈类型
        <select
          name="category"
          onChange={(event) =>
            setCategory(event.target.value as FeedbackCategory)
          }
          value={category}
        >
          {CATEGORY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        反馈内容
        <textarea
          maxLength={MAX_LENGTH}
          name="content"
          onChange={(event) => setContent(event.target.value)}
          placeholder={PLACEHOLDERS[category]}
          required
          rows={12}
          value={content}
        />
        <span className="help feedback-counter">
          {content.length}/{MAX_LENGTH}
        </span>
      </label>
      <SubmitButton pendingText="正在提交...">提交反馈</SubmitButton>
    </form>
  );
}
