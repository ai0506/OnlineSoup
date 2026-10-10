import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCookie: vi.fn(),
  setCookie: vi.fn(),
  getClaims: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.getCookie, set: mocks.setCookie }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: mocks.getClaims },
    rpc: mocks.rpc,
  }),
}));

import { leaveRoom } from "@/app/rooms/actions";
import { decodeFlashMessage, FLASH_COOKIE_NAME } from "@/lib/flash";

function leave() {
  const form = new FormData();
  form.set("code", "abc123");
  return leaveRoom({ status: "idle" }, form);
}

describe("leaveRoom navigation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getCookie.mockReturnValue({ value: "guest-test-token" });
    mocks.getClaims.mockResolvedValue({ data: { claims: null } });
    mocks.rpc.mockResolvedValue({ error: null });
  });

  it("redirects from the server after releasing the guest seat and clearing its cookie", async () => {
    await expect(leave()).rejects.toMatchObject({
      digest: "NEXT_REDIRECT;replace;/;307;",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("leave_room_as_guest", {
      room_code: "ABC123",
      guest_token: "guest-test-token",
    });
    expect(mocks.setCookie).toHaveBeenCalledWith("guest_room_ABC123", "", {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 0,
      path: "/",
    });
    const flashCall = mocks.setCookie.mock.calls.find(([name]) => name === FLASH_COOKIE_NAME);
    expect(decodeFlashMessage(flashCall?.[1])).toEqual({
      code: "room_left", kind: "notice", scope: "home",
    });
    expect(flashCall?.[2]).toMatchObject({ httpOnly: true, maxAge: 60 });
  });

  it("also redirects registered members without deleting guest cookies", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "member-id" } } });
    await expect(leave()).rejects.toMatchObject({
      digest: "NEXT_REDIRECT;replace;/;307;",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("leave_room_as_member", { room_code: "ABC123" });
    expect(mocks.setCookie).toHaveBeenCalledTimes(1);
    expect(mocks.setCookie.mock.calls[0][0]).toBe(FLASH_COOKIE_NAME);
  });

  it("preserves the guest cookie and reports an error when leaving fails", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "temporary_failure" } });
    await expect(leave()).resolves.toEqual({ status: "error", message: "退出房间失败，请稍后重试" });
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });
});
