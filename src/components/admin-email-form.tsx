"use client";

import { SubmitButton } from "@/components/submit-button";

type AdminEmailFormProps = {
  action: (formData: FormData) => Promise<void>;
};

export function AdminEmailForm({ action }: AdminEmailFormProps) {
  return (
    <form action={action} className="form-grid admin-email-form">
      <label>
        发件人
        <select name="from" defaultValue="Online Soup <noreply@ai0506.com>">
          <option value="Online Soup <noreply@ai0506.com>">noreply — Online Soup &lt;noreply@ai0506.com&gt;</option>
          <option value="Support <support@ai0506.com>">support — Support &lt;support@ai0506.com&gt;</option>
        </select>
      </label>
      <label>
        收件邮箱
        <textarea
          maxLength={2000}
          name="to"
          placeholder="每行一个邮箱，或用英文逗号分隔"
          required
          rows={4}
        />
      </label>
      <label>
        邮件标题
        <input
          maxLength={120}
          name="subject"
          placeholder="例如：汤局通知"
          required
        />
      </label>
      <label>
        邮件内容
        <textarea
          maxLength={5000}
          name="body"
          placeholder="请输入要发送的正文"
          required
          rows={10}
        />
      </label>
      <SubmitButton pendingText="发送中...">发送邮件</SubmitButton>
    </form>
  );
}
