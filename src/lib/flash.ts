import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export type FlashKind = "error" | "notice";

export type FlashMessage = {
  code: string;
  kind: FlashKind;
  scope: string;
};

export const FLASH_COOKIE_NAME = "online_soup_flash";

export const flashCookieOptions = {
  httpOnly: true,
  maxAge: 60,
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

export function encodeFlashMessage(message: FlashMessage) {
  return encodeURIComponent(JSON.stringify(message));
}

export function decodeFlashMessage(value: string | undefined) {
  if (!value) return null;

  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Partial<FlashMessage>;
    if (
      (parsed.kind === "error" || parsed.kind === "notice") &&
      typeof parsed.code === "string" &&
      typeof parsed.scope === "string"
    ) {
      return {
        code: parsed.code,
        kind: parsed.kind,
        scope: parsed.scope,
      };
    }
  } catch {
    return null;
  }

  return null;
}

export async function getFlashMessage(scope: string) {
  const cookieStore = await cookies();
  const message = decodeFlashMessage(cookieStore.get(FLASH_COOKIE_NAME)?.value);
  return message?.scope === scope ? message : null;
}

export async function setFlashMessage(message: FlashMessage) {
  const cookieStore = await cookies();
  cookieStore.set(FLASH_COOKIE_NAME, encodeFlashMessage(message), flashCookieOptions);
}

export function flashRedirectPath(path: string, message: FlashMessage) {
  const params = new URLSearchParams({
    code: message.code,
    kind: message.kind,
    next: path,
    scope: message.scope,
  });
  return `/flash/redirect?${params.toString()}`;
}

export async function redirectWithFlash(
  path: string,
  message: FlashMessage,
): Promise<never> {
  await setFlashMessage(message);
  redirect(path);
}
