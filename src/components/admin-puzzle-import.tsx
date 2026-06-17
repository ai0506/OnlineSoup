"use client";

import { SubmitButton } from "@/components/submit-button";

type AdminPuzzleImportProps = {
  action: (formData: FormData) => void | Promise<void>;
};

export function AdminPuzzleImport({ action }: AdminPuzzleImportProps) {
  return (
    <form action={action} className="admin-puzzle-import-form">
      <input name="returnTab" type="hidden" value="puzzles" />
      <p className="muted">
        上传 JSON 文件后会<strong>清空当前全部题目</strong>（包括评分点和示例问题），
        再用文件中的内容重新建立题库；正在进行中的房间会被重置为未选题状态。
      </p>
      <label>
        题库 JSON 文件
        <input accept="application/json" name="file" required type="file" />
      </label>
      <label className="checkbox-line">
        <input name="confirmReplace" type="checkbox" required />
        我确认要清空现有题库并导入这份文件
      </label>
      <SubmitButton className="button danger" pendingText="导入中...">
        清空并导入
      </SubmitButton>
    </form>
  );
}
