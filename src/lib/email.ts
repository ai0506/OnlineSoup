type SendEmailInput = {
  to: string[];
  subject: string;
  text: string;
};

type ResendErrorBody = {
  message?: string;
  name?: string;
};

export class EmailConfigError extends Error {
  constructor() {
    super("email_not_configured");
  }
}

export class EmailSendError extends Error {
  constructor(message = "email_send_failed") {
    super(message);
  }
}

export async function sendAdminEmail({ to, subject, text }: SendEmailInput) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ADMIN_EMAIL_FROM ?? process.env.RESEND_FROM;

  if (!apiKey || !from) {
    throw new EmailConfigError();
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      text,
      tags: [
        {
          name: "source",
          value: "admin_panel",
        },
      ],
    }),
  });

  if (!response.ok) {
    let errorBody: ResendErrorBody | null = null;
    try {
      errorBody = (await response.json()) as ResendErrorBody;
    } catch {
      errorBody = null;
    }

    throw new EmailSendError(
      errorBody?.message ?? `email_send_failed_${response.status}`,
    );
  }
}
