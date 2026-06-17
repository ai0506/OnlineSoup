import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  FLASH_COOKIE_NAME,
  encodeFlashMessage,
  flashCookieOptions,
  type FlashKind,
} from "@/lib/flash";

function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

function getKind(value: string | null): FlashKind {
  return value === "error" ? "error" : "notice";
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code") ?? "operation_done";
  const scope = request.nextUrl.searchParams.get("scope") ?? "home";
  const nextPath = safeNextPath(request.nextUrl.searchParams.get("next"));
  const response = NextResponse.redirect(new URL(nextPath, request.url));

  response.cookies.set(
    FLASH_COOKIE_NAME,
    encodeFlashMessage({
      code,
      kind: getKind(request.nextUrl.searchParams.get("kind")),
      scope,
    }),
    flashCookieOptions,
  );

  return response;
}
