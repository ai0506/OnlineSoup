"use client";

import { useState } from "react";

import { AdminAiErrorForm } from "@/components/admin-ai-error-form";
import {
  answerTypeLabels,
  b1VerdictLabels,
  getAskAnswerDetails,
  getAskVerdict,
  getMessagePreview,
  getReasoningCoverage,
  v2RouteLabels,
  type AskAnswerDetails,
  type AskV2Stage,
  type AuditVerdict,
} from "@/lib/admin-ask-audit";
import { formatAdminTime } from "@/lib/admin-time";

export type AdminMessageRoom = {
  code: string;
  name: string;
  status: "waiting" | "playing" | "closed";
};

export type AdminMessage = {
  id: number;
  room_id: string;
  seat_id: string;
  sender_name: string;
  sender_seat_number: number;
  sender_type: "registered" | "guest";
  message_type: "chat" | "system" | "ai";
  message_mode: "chat" | "ask" | "hint" | "reason";
  content: string;
  puzzle_id: number | null;
  reply_to_id: number | null;
  created_at: string;
  rooms: AdminMessageRoom | null;
};

export type AdminQuestionMessage = Pick<
  AdminMessage,
  "id" | "sender_name" | "sender_seat_number" | "sender_type" | "content" | "message_mode" | "created_at"
>;

export type AdminPuzzleFactRef = { id: string; text: string };

type AdminMessageAuditListProps = {
  createAiErrorCase: (formData: FormData) => Promise<void>;
  factsByPuzzle: Record<number, AdminPuzzleFactRef[]>;
  markedAiMessageIds: number[];
  messages: AdminMessage[];
  questionById: Record<number, AdminQuestionMessage>;
};

const modeLabels: Record<AdminMessage["message_mode"], string> = {
  chat: "聊天",
  ask: "询问",
  hint: "提示",
  reason: "推理",
};

function getKindLabel(message: AdminMessage) {
  if (message.message_type === "system") return "系统";
  const mode = modeLabels[message.message_mode];
  return message.message_type === "ai" ? `AI·${mode}` : mode;
}

function answerLabel(value: string | null) {
  return value ? (answerTypeLabels[value] ?? value) : "—";
}

function formatElapsed(value: number | null) {
  return value === null ? null : `${(value / 1000).toFixed(1)}s`;
}

function VerdictPill({ verdict }: { verdict: AuditVerdict }) {
  return <span className={`admin-pill admin-verdict-${verdict.tone}`}>{verdict.label}</span>;
}

function FactEvidence({ ids, facts }: { ids: string[]; facts: AdminPuzzleFactRef[] }) {
  if (ids.length === 0) return <span className="muted">无引用</span>;
  return (
    <ul className="admin-audit-evidence">
      {ids.map((id) => {
        const fact = facts.find((item) => item.id === id);
        return (
          <li key={id}>
            <span className="admin-table-code">{id}</span>
            {fact ? fact.text : <span className="muted">原文片段或已不存在的 Fact</span>}
          </li>
        );
      })}
    </ul>
  );
}

function StageBlock({
  title,
  stage,
  children,
}: {
  title: string;
  stage: AskV2Stage;
  children?: React.ReactNode;
}) {
  return (
    <div className="admin-audit-stage">
      <div className="admin-audit-stage-head">
        <strong>{title}</strong>
        {stage.answerType && <span className="admin-pill">{answerLabel(stage.answerType)}</span>}
        {formatElapsed(stage.elapsedMs) && (
          <span className="muted">{formatElapsed(stage.elapsedMs)}</span>
        )}
      </div>
      {stage.proposition && <p className="admin-audit-proposition">命题：{stage.proposition}</p>}
      {stage.reason && <p className="muted">理由：{stage.reason}</p>}
      {children}
    </div>
  );
}

function AskAuditDetail({
  details,
  facts,
}: {
  details: AskAnswerDetails;
  facts: AdminPuzzleFactRef[];
}) {
  const { audit } = details;

  if (audit.kind === "v2") {
    return (
      <div className="admin-audit-stages">
        <p className="admin-audit-route">
          路线：{v2RouteLabels[audit.route] ?? audit.route}
          {" · "}最终 {answerLabel(audit.finalAnswerType)}
          {audit.finalSource === "arbitration" ? "（采用仲裁）" : "（采用 A）"}
        </p>
        {audit.a && <StageBlock stage={audit.a} title="A 判定" />}
        {audit.b1 &&
          (audit.b1.status === "done" ? (
            <StageBlock stage={audit.b1} title={`B1 证据核对${audit.b1.used ? "" : "（未采用）"}`}>
              <p>
                结论：
                <strong>{b1VerdictLabels[audit.b1.verdict ?? ""] ?? audit.b1.verdict ?? "—"}</strong>
              </p>
              <FactEvidence facts={facts} ids={audit.b1.evidence} />
            </StageBlock>
          ) : (
            <div className="admin-audit-stage">
              <div className="admin-audit-stage-head">
                <strong>B1 证据核对</strong>
                <span className="admin-pill">
                  {audit.b1.status === "failed" ? "失败" : "未执行"}
                </span>
              </div>
              {audit.b1.error && <p className="muted">{audit.b1.error}</p>}
            </div>
          ))}
        {audit.arbitration && <StageBlock stage={audit.arbitration} title="仲裁" />}
      </div>
    );
  }

  if (audit.kind === "v1") {
    return (
      <div className="admin-audit-stages">
        {audit.v2Failure && (
          <p className="admin-audit-warning">
            v2 在 {audit.v2Failure.stage ?? "未知阶段"} 失败（{audit.v2Failure.code}），本条由 v1 回答。
          </p>
        )}
        {audit.entries.length === 0 && <p className="muted">没有审计记录。</p>}
        {audit.entries.map((item) => (
          <div className="admin-audit-stage" key={item.label}>
            <div className="admin-audit-stage-head">
              <strong>{item.label}</strong>
              <span className="admin-pill">{item.text}</span>
              <span className="muted">{item.answerType}</span>
            </div>
            {item.reason && <p className="muted">理由：{item.reason}</p>}
            {item.factSummary && <p>{item.factSummary}</p>}
          </div>
        ))}
      </div>
    );
  }

  return (
    <p className="muted">
      {audit.kind === "truncated" ? "审计内容过长，写入时已省略。" : "没有审计记录。"}
    </p>
  );
}

function MessageDetail({
  createAiErrorCase,
  facts,
  marked,
  message,
  onClose,
  question,
}: {
  createAiErrorCase: (formData: FormData) => Promise<void>;
  facts: AdminPuzzleFactRef[];
  marked: boolean;
  message: AdminMessage;
  onClose: () => void;
  question: AdminQuestionMessage | undefined;
}) {
  const askDetails = message.message_type === "ai" && message.message_mode === "ask"
    ? getAskAnswerDetails(message.content)
    : null;
  const coverage = message.message_type === "ai" && message.message_mode === "reason"
    ? getReasoningCoverage(message.content)
    : [];
  const canMark = askDetails !== null || coverage.length > 0;

  return (
    <>
      <div className="admin-audit-detail-head">
        <div>
          <strong className="admin-table-code">{message.rooms?.code ?? "未知房间"}</strong>
          <span className="muted"> {message.rooms?.name ?? "房间信息缺失"}</span>
          <p className="muted">
            {formatAdminTime(message.created_at)} · {message.sender_name} [{message.sender_seat_number}]
            {message.sender_type === "registered" ? " 已注册" : " 访客"} · {getKindLabel(message)}
            {message.puzzle_id && ` · 题目 #${message.puzzle_id}`}
          </p>
        </div>
        <div className="admin-audit-detail-actions">
          {canMark &&
            (marked ? (
              <span className="admin-ai-error-marked-badge">已收录</span>
            ) : (
              <AdminAiErrorForm
                action={createAiErrorCase}
                aiMessageId={message.id}
                reasoningCoverage={coverage.length > 0 ? coverage : undefined}
              />
            ))}
          <button
            aria-label="关闭详情"
            className="admin-panel-close admin-audit-detail-close"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
      </div>

      {question && (
        <div className="admin-question-row">
          <span className="admin-question-label">
            {question.sender_name} [{question.sender_seat_number}] · {modeLabels[question.message_mode]}
            {" · "}
            {formatAdminTime(question.created_at)}
          </span>
          <p className="admin-question-content">{question.content}</p>
        </div>
      )}

      {askDetails ? (
        <>
          <div className="admin-ask-answer">
            <div className="admin-ask-answer-summary">
              <div>
                <span>最终回答</span>
                <strong>{askDetails.text}</strong>
              </div>
              <VerdictPill verdict={getAskVerdict(askDetails)} />
            </div>
            {askDetails.factSummary && (
              <p className="admin-ask-fact">
                事实总结：{askDetails.factSummary}
                {askDetails.factSummarySource !== "unknown" &&
                  ` · 来源：${askDetails.factSummarySource === "glm" ? "GLM" : "DeepSeek"}`}
              </p>
            )}
          </div>
          {askDetails.cacheHit && (
            <div className="admin-audit-stage">
              <div className="admin-audit-stage-head">
                <strong>缓存来源</strong>
                <span className="admin-pill">#{askDetails.cacheHit.entryId}</span>
                <span className="muted">
                  {askDetails.cacheHit.matchType === "exact"
                    ? "完全相同"
                    : askDetails.cacheHit.matchType === "equivalent"
                      ? "相似等价"
                      : "未知匹配"}
                </span>
              </div>
              <p>{askDetails.cacheHit.questionText}</p>
              <p className="muted">
                答案 {answerLabel(askDetails.cacheHit.answerType)}
                {askDetails.cacheHit.normalizedQuestion &&
                  ` · 规范化：${askDetails.cacheHit.normalizedQuestion}`}
              </p>
            </div>
          )}
          <AskAuditDetail details={askDetails} facts={facts} />
        </>
      ) : (
        <p className="admin-audit-text">{getMessagePreview(message.content)}</p>
      )}

      {coverage.length > 0 && (
        <div className="admin-reasoning-coverage">
          {coverage.map((item) => (
            <div
              className={`admin-coverage-item${item.covered ? " covered" : ""}`}
              key={item.id}
            >
              <strong>#{item.id}</strong>
              <span>{item.covered ? "已覆盖" : "未覆盖"}</span>
              {item.text && <p>{item.text}</p>}
            </div>
          ))}
        </div>
      )}

      <details className="admin-collapsible">
        <summary>原始内容</summary>
        <pre className="admin-message-content">{message.content}</pre>
      </details>
    </>
  );
}

function RowSummary({
  message,
  question,
}: {
  message: AdminMessage;
  question: AdminQuestionMessage | undefined;
}) {
  const preview = getMessagePreview(message.content);
  if (message.message_type === "ai" && question) {
    return (
      <>
        <span className="muted">{question.content}</span> → {preview}
      </>
    );
  }
  return <>{preview}</>;
}

function RowVerdict({ marked, message }: { marked: boolean; message: AdminMessage }) {
  let verdict: AuditVerdict | null = null;
  if (message.message_type === "ai" && message.message_mode === "ask") {
    const details = getAskAnswerDetails(message.content);
    if (details) verdict = getAskVerdict(details);
  } else if (message.message_type === "ai" && message.message_mode === "reason") {
    const coverage = getReasoningCoverage(message.content);
    if (coverage.length > 0) {
      const covered = coverage.filter((item) => item.covered).length;
      verdict = {
        label: `覆盖 ${covered}/${coverage.length}`,
        tone: covered === coverage.length ? "ok" : "muted",
      };
    }
  }
  return (
    <>
      {verdict && <VerdictPill verdict={verdict} />}
      {marked && <span className="admin-pill admin-verdict-marked">已收录</span>}
    </>
  );
}

export function AdminMessageAuditList({
  createAiErrorCase,
  factsByPuzzle,
  markedAiMessageIds,
  messages,
  questionById,
}: AdminMessageAuditListProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = messages.find((message) => message.id === selectedId) ?? null;
  const marked = new Set(markedAiMessageIds);

  if (messages.length === 0) {
    return <div className="card muted">没有找到匹配的消息。</div>;
  }

  return (
    <div className={`admin-audit-layout${selected ? " has-selection" : ""}`}>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>房间</th>
              <th>发送者</th>
              <th>类型</th>
              <th>内容</th>
              <th>结论</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((message) => {
              const question = message.reply_to_id
                ? questionById[message.reply_to_id]
                : undefined;
              return (
                <tr
                  aria-selected={message.id === selectedId}
                  className={`admin-table-expandable${message.id === selectedId ? " open" : ""}`}
                  key={message.id}
                  onClick={() => setSelectedId(message.id)}
                >
                  <td className="muted">{formatAdminTime(message.created_at)}</td>
                  <td className="admin-table-code">{message.rooms?.code ?? "—"}</td>
                  <td className="admin-table-clip">{message.sender_name}</td>
                  <td>
                    <span className={`admin-pill admin-kind-${message.message_type}`}>
                      {getKindLabel(message)}
                    </span>
                  </td>
                  <td className="admin-table-clip admin-table-grow">
                    <RowSummary message={message} question={question} />
                  </td>
                  <td>
                    <RowVerdict marked={marked.has(message.id)} message={message} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <aside className="admin-audit-detail">
        {selected ? (
          <MessageDetail
            createAiErrorCase={createAiErrorCase}
            facts={selected.puzzle_id ? (factsByPuzzle[selected.puzzle_id] ?? []) : []}
            marked={marked.has(selected.id)}
            message={selected}
            onClose={() => setSelectedId(null)}
            question={selected.reply_to_id ? questionById[selected.reply_to_id] : undefined}
          />
        ) : (
          <p className="muted">点击左侧一条消息查看详情。</p>
        )}
      </aside>
    </div>
  );
}
