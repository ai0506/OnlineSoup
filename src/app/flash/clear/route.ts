import { NextResponse } from "next/server";

import { FLASH_COOKIE_NAME, flashCookieOptions } from "@/lib/flash";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(FLASH_COOKIE_NAME, "", {
    ...flashCookieOptions,
    maxAge: 0,
  });
  return response;
}
