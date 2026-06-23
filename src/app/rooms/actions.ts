"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { redirectWithFlash } from "@/lib/flash";
import { createClient } from "@/lib/supabase/server";
import { guestJoinSchema, roomSchema } from "@/lib/validation";

function isMissingDatabaseFunction(
  error: { code?: string; message: string },
  functionName: string,
) {
  return (
    error.code === "PGRST202" ||
    error.message.includes(`function public.${functionName}`) ||
    error.message.includes(`Could not find the function ${functionName}`)
  );
}

export async function createRoom(
  _previousState: RoomActionState,
  formData: FormData,
): Promise<RoomActionState> {
  const parsed = roomSchema.safeParse({
    name: formData.get("name"),
    maxMembers: formData.get("maxMembers"),
    pointsPerSeat: formData.get("pointsPerSeat"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message;
    return { status: "error", message: firstError ?? "请检查房间名称、座位数量、积分和密码格式" };
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();

  if (!claimsData?.claims?.sub) {
    await redirectWithFlash("/login", {
      code: "login_required",
      kind: "error",
      scope: "login",
    });
  }

  const { data, error } = await supabase.rpc("create_room", {
    room_name: parsed.data.name,
    seat_count: parsed.data.maxMembers,
    seat_points: parsed.data.pointsPerSeat,
    room_password: parsed.data.password,
  });

  if (error) {
    console.error("create_room RPC failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      input: {
        name: parsed.data.name,
        maxMembers: parsed.data.maxMembers,
        pointsPerSeat: parsed.data.pointsPerSeat,
        hasPassword: Boolean(parsed.data.password),
      },
    });

    const errorMessages: Record<string, string> = {
      insufficient_points: "积分不足，无法为全部座位预存积分",
      profile_not_found: "积分账户尚未建立，请重新登录后再试",
      username_required: "请先设置用户名",
      active_room_exists: "你已经开启了一个房间，请先关闭当前房间",
      invalid_seat_count: "座位数量不合法，请填写 1 到 20 的整数",
      invalid_seat_points: "每位玩家积分需要填写 0 到 100 的整数",
      invalid_room_name: "房间名称需要 2 到 8 个字",
    };

    const matched = Object.keys(errorMessages).find((key) =>
      error.message.includes(key),
    );

    if (isMissingDatabaseFunction(error, "create_room")) {
      return { status: "error", message: "数据库尚未安装创建房间功能，请执行最新的 Supabase 迁移" };
    }

    return {
      status: "error",
      message: matched ? errorMessages[matched] : "创建房间失败，请稍后重试",
    };
  }

  // 创建扣积分后，刷新布局缓存让站点头部的积分立即更新
  revalidatePath("/", "layout");
  redirect(`/rooms/${data}`);
}

export type RoomActionState = {
  status: "idle" | "success" | "error";
  message?: string;
  navigateTo?: string;
  seatId?: string;
};

export async function verifyRoomPassword(
  _previousState: RoomActionState,
  formData: FormData,
): Promise<RoomActionState> {
  const code = String(formData.get("code") || "").trim().toUpperCase();
  const password = String(formData.get("password") || "");

  if (!/^[A-Z0-9]{6}$/.test(code) || !/^\d{6}$/.test(password)) {
    return { status: "error", message: "房间密码不正确" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("verify_room_password", {
    room_code: code,
    room_password: password,
  });

  if (error) {
    const message = isMissingDatabaseFunction(error, "verify_room_password")
      ? "数据库功能不是最新版本，请执行最新的 Supabase 迁移"
      : error.message.includes("room_not_found")
        ? "没有找到这个房间"
        : error.message.includes("room_not_joinable")
          ? "房间当前不可加入"
          : "房间密码不正确";
    return { status: "error", message };
  }

  const cookieStore = await cookies();
  cookieStore.set(`room_password_${code}`, password, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10,
    path: "/",
  });

  return { status: "success" };
}

export async function getRoomMembershipStatus(code: string) {
  const normalizedCode = code.trim().toUpperCase();
  const cookieStore = await cookies();
  const guestToken = cookieStore.get(`guest_room_${normalizedCode}`)?.value;
  const guestIdentity = cookieStore.get("guest_identity")?.value;

  const supabase = await createClient();
  let { data: exitReason, error: exitReasonError } = await supabase.rpc(
    "get_room_exit_reason",
    {
      room_code: normalizedCode,
      guest_token: guestToken,
      guest_identity: guestIdentity || null,
    },
  );

  if (
    exitReasonError &&
    isMissingDatabaseFunction(exitReasonError, "get_room_exit_reason")
  ) {
    const legacyResult = await supabase.rpc("get_room_exit_reason", {
      room_code: normalizedCode,
      guest_token: guestToken,
    });
    exitReason = legacyResult.data;
    exitReasonError = legacyResult.error;
  }

  if (exitReasonError) {
    console.error("get_room_exit_reason RPC failed", {
      code: exitReasonError.code,
      message: exitReasonError.message,
      roomCode: normalizedCode,
    });
  }

  if (exitReason === "closed" || exitReason === "kicked") {
    return exitReason;
  }

  const { data: claimsData } = await supabase.auth.getClaims();
  if (claimsData?.claims?.sub) {
    const { data: activeRoomCode } =
      await supabase.rpc("get_my_active_room");
    return activeRoomCode === normalizedCode ? "active" : "not_joined";
  }

  if (!guestToken) {
    return "not_joined";
  }

  const { data: isMember } = await supabase.rpc("verify_guest_membership", {
    room_code: normalizedCode,
    guest_token: guestToken,
  });

  return isMember ? "active" : "not_joined";
}

export async function joinRoom(
  _previousState: RoomActionState,
  formData: FormData,
): Promise<RoomActionState> {
  const code = String(formData.get("code") || "").trim().toUpperCase();
  const passwordValue = String(formData.get("password") || "");
  let password = passwordValue || undefined;

  if (
    !/^[A-Z0-9]{6}$/.test(code) ||
    (password !== undefined && !/^\d{6}$/.test(password))
  ) {
    return { status: "error", message: "请检查房间码和密码" };
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(claimsData?.claims?.sub);
  const cookieStore = await cookies();
  const verifiedPassword = cookieStore.get(`room_password_${code}`)?.value;
  if (!password && verifiedPassword && /^\d{6}$/.test(verifiedPassword)) {
    password = verifiedPassword;
  }
  const identityCookieName = "guest_identity";
  let guestIdentity: string | undefined;
  let data: unknown;
  let error: {
    code: string;
    message: string;
    details: string;
    hint: string;
  } | null;

  if (isAuthenticated) {
    const result = await supabase.rpc("join_room_as_member", {
      room_code: code,
      room_password: password || null,
    });
    data = result.data;
    error = result.error;
  } else {
    const parsed = guestJoinSchema.safeParse({
      code,
      nickname: formData.get("nickname"),
      password,
    });

    if (!parsed.success) {
      return {
        status: "error",
        message: "名字需要 3 到 8 位，只能使用英文字母、数字和下划线",
      };
    }

    guestIdentity =
      cookieStore.get(identityCookieName)?.value ||
      randomBytes(32).toString("hex");
    const result = await supabase.rpc("join_room_as_guest", {
      room_code: parsed.data.code,
      guest_nickname: parsed.data.nickname,
      room_password: parsed.data.password || null,
      guest_identity: guestIdentity,
    });
    data = result.data;
    error = result.error;
  }

  if (error) {
    console.error("Room join RPC failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      roomCode: code,
      isAuthenticated,
    });

    const knownErrors = [
      "room_not_found",
      "room_not_joinable",
      "wrong_password",
      "room_full",
      "owner_already_seated",
      "guest_kicked",
      "username_required",
      "nickname_registered",
      "nickname_in_room",
      "username_in_room",
      "registered_member_required",
      "room_device_in_use",
      "active_room_exists",
    ];
    const matched = knownErrors.find((key) =>
      error.message.includes(key),
    );
    const messages: Record<string, string> = {
      room_not_found: "没有找到这个房间",
      room_not_joinable: "房间当前不可加入",
      wrong_password: "房间密码不正确",
      room_full: "房间已经坐满了",
      owner_already_seated: "房主已经默认入座，无需再次加入",
      username_required: "请先设置用户名",
      nickname_registered: "这个名字已被注册用户使用，请换一个",
      nickname_in_room: "当前房间里已经有人使用这个名字",
      username_in_room: "房间里有访客正在使用你的用户名，请联系房主处理",
      registered_member_required: "登录用户需要使用账户身份加入房间",
      room_device_in_use: "这个账号已在其他设备进入该房间，请先在那个设备退出房间。",
      active_room_exists: "这个账号已在其他设备进入房间，请先退出当前房间。",
      join_failed: "加入房间失败，请稍后重试",
    };
    if (matched === "guest_kicked") {
      return {
        status: "error",
        message: "你已被踢出当前房间，当前房间关闭前无法再次加入",
      };
    }
    if (matched === "username_required") {
      return {
        status: "error",
        message: messages.username_required,
        navigateTo: "/account/username",
      };
    }
    return {
      status: "error",
      message: messages[matched ?? "join_failed"],
    };
  }

  const result = data as {
    seat_id: string;
    guest_token?: string;
    previous_room_codes?: string[];
  };
  for (const previousCode of result.previous_room_codes ?? []) {
    cookieStore.set(`guest_room_${previousCode}`, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 0,
      path: "/",
    });
  }
  if (!isAuthenticated && guestIdentity && result.guest_token) {
    cookieStore.set(identityCookieName, guestIdentity, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });
    cookieStore.set(`guest_room_${code}`, result.guest_token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });
  }
  cookieStore.set(`room_password_${code}`, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
  });

  return {
    status: "success",
    message: "加入成功，座位已为你保留。",
    seatId: result.seat_id,
  };
}

export async function closeRoom(
  _previousState: RoomActionState,
  formData: FormData,
): Promise<RoomActionState> {
  const code = String(formData.get("code") || "").trim().toUpperCase();
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();

  if (!claimsData?.claims?.sub) {
    return { status: "error", message: "请先登录" };
  }

  const { error } = await supabase.rpc("close_room", {
    room_code: code,
  });

  if (error) {
    const message =
      error.code === "PGRST202" || error.message.includes("close_room")
        ? "数据库功能不是最新版，请执行最新的 Supabase 迁移"
        : error.message.includes("room_not_found")
          ? "没有找到这个房间"
          : error.message.includes("not_room_owner")
            ? "只有房主可以关闭房间"
            : "关闭房间失败，请稍后重试";
    return { status: "error", message };
  }

  revalidatePath("/", "layout");
  return { status: "success", navigateTo: "/" };
}

export async function kickGuest(
  _previousState: RoomActionState,
  formData: FormData,
): Promise<RoomActionState> {
  const code = String(formData.get("code") || "").trim().toUpperCase();
  const seatId = String(formData.get("seatId") || "").trim();
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();

  if (!claimsData?.claims?.sub) {
    return { status: "error", message: "请先登录" };
  }

  const { error } = await supabase.rpc("kick_guest", {
    room_code: code,
    target_seat_id: seatId,
  });

  if (error) {
    const message = isMissingDatabaseFunction(error, "kick_guest")
      ? "数据库功能不是最新版，请执行最新的 Supabase 迁移"
      : error.message.includes("room_not_found")
        ? "没有找到这个房间"
        : error.message.includes("not_room_owner")
          ? "只有房主可以移出玩家"
          : error.message.includes("guest_membership_not_found")
            ? "这个玩家已经不在房间里"
            : "移出玩家失败，请稍后重试";
    return { status: "error", message };
  }

  return { status: "success" };
}

export async function giftPoints(
  _previousState: RoomActionState,
  formData: FormData,
): Promise<RoomActionState> {
  const code = String(formData.get("code") || "").trim().toUpperCase();
  const seatId = String(formData.get("seatId") || "").trim();
  const rawAmount = Number(formData.get("amount"));

  if (!/^[A-Z0-9]{6}$/.test(code) || !seatId) {
    return { status: "error", message: "参数不合法" };
  }
  if (!Number.isInteger(rawAmount) || rawAmount < 1 || rawAmount > 9999) {
    return { status: "error", message: "赠送积分需要填写 1 到 9999 的整数" };
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) {
    return { status: "error", message: "请先登录" };
  }

  const { error } = await supabase.rpc("gift_points_to_seat", {
    room_code: code,
    target_seat_id: seatId,
    amount: rawAmount,
  });

  if (error) {
    const messages: Record<string, string> = {
      not_room_owner: "只有房主可以赠送积分",
      cannot_gift_to_own_seat: "不能赠送给自己的座位",
      insufficient_points: "个人积分不足",
      invalid_amount: "赠送积分数量不合法",
      seat_not_in_room: "找不到该座位",
      seat_is_empty: "该座位暂无玩家",
    };
    const matched = Object.keys(messages).find((k) => error.message.includes(k));
    return { status: "error", message: messages[matched ?? ""] ?? "赠送积分失败，请稍后重试" };
  }

  return { status: "success", message: "赠送成功" };
}

export async function moveSeat(
  _previousState: RoomActionState,
  formData: FormData,
): Promise<RoomActionState> {
  const code = String(formData.get("code") || "").trim().toUpperCase();
  const sourceSeatId = String(formData.get("sourceSeatId") || "").trim();
  const targetSeatId = String(formData.get("targetSeatId") || "").trim();

  if (!/^[A-Z0-9]{6}$/.test(code) || !sourceSeatId || !targetSeatId) {
    return { status: "error", message: "参数不合法" };
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) {
    return { status: "error", message: "请先登录" };
  }

  const { error } = await supabase.rpc("move_seat", {
    room_code: code,
    source_seat_id: sourceSeatId,
    target_seat_id: targetSeatId,
  });

  if (error) {
    console.error("move_seat RPC failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      roomCode: code,
      sourceSeatId,
      targetSeatId,
    });

    const messages: Record<string, string> = {
      not_room_owner: "只有房主可以移动玩家",
      cannot_move_owner_seat: "房主座位不可移动",
      source_seat_empty: "该座位没有玩家",
      target_seat_occupied: "目标座位已有玩家",
      seat_not_in_room: "找不到该座位",
      same_seat: "请选择不同的座位",
    };
    const matched = Object.keys(messages).find((k) => error.message.includes(k));
    return { status: "error", message: messages[matched ?? ""] ?? "移动失败，请稍后重试" };
  }

  return { status: "success" };
}

export async function getRoomCurrentPuzzle(roomCode: string) {
  const code = roomCode.trim().toUpperCase();
  const supabase = await createClient();
  const cookieStore = await cookies();
  const guestToken = cookieStore.get(`guest_room_${code}`)?.value;

  const { data, error } = await supabase.rpc("get_room_current_puzzle", {
    room_code: code,
    guest_token: guestToken || null,
  });

  if (error) {
    console.error("get_room_current_puzzle RPC failed", { message: error.message });
    return null;
  }

  return data as import("@/lib/types").CurrentPuzzle | null;
}

export async function getPuzzleList(roomCode: string) {
  const code = roomCode.trim().toUpperCase();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_puzzle_list", {
    room_code: code,
  });

  if (error) {
    console.error("get_puzzle_list RPC failed", { message: error.message });
    return null;
  }

  return (data as import("@/lib/types").PuzzleListItem[] | null) ?? [];
}

export async function openPuzzle(
  _previousState: RoomActionState,
  formData: FormData,
): Promise<RoomActionState> {
  const code = String(formData.get("code") || "").trim().toUpperCase();
  const puzzleId = Number(formData.get("puzzleId"));

  if (!/^[A-Z0-9]{6}$/.test(code) || !Number.isInteger(puzzleId) || puzzleId <= 0) {
    return { status: "error", message: "参数不合法" };
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) {
    return { status: "error", message: "请先登录" };
  }

  const { error } = await supabase.rpc("open_puzzle", {
    room_code: code,
    p_puzzle_id: puzzleId,
  });

  if (error) {
    console.error("open_puzzle RPC failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      roomCode: code,
      puzzleId,
    });
    const messages: Record<string, string> = {
      not_room_owner: "只有房主可以选择题目",
      puzzle_not_found: "找不到该题目",
      room_not_found: "没有找到这个房间",
      room_closed: "房间已关闭",
      owner_seat_not_found: "房主座位异常，请刷新后重试",
    };
    const matched = Object.keys(messages).find((k) => error.message.includes(k));
    return { status: "error", message: messages[matched ?? ""] ?? "操作失败，请稍后重试" };
  }

  return { status: "success" };
}

export async function closePuzzle(
  _previousState: RoomActionState,
  formData: FormData,
): Promise<RoomActionState> {
  const code = String(formData.get("code") || "").trim().toUpperCase();

  if (!/^[A-Z0-9]{6}$/.test(code)) {
    return { status: "error", message: "参数不合法" };
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) {
    return { status: "error", message: "请先登录" };
  }

  const { error } = await supabase.rpc("close_puzzle", { room_code: code });

  if (error) {
    const messages: Record<string, string> = {
      not_room_owner: "只有房主可以停止题目",
      no_active_puzzle: "当前没有进行中的题目",
    };
    const matched = Object.keys(messages).find((k) => error.message.includes(k));
    return { status: "error", message: messages[matched ?? ""] ?? "操作失败，请稍后重试" };
  }

  return { status: "success" };
}

export async function checkSeatSessionActive(roomCode: string): Promise<boolean> {
  const code = roomCode.trim().toUpperCase();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_my_seat_session_active", {
    p_room_code: code,
  });
  if (error) return true; // fail open: don't displace on RPC error
  return data === true;
}

export async function leaveRoom(
  _previousState: RoomActionState,
  formData: FormData,
): Promise<RoomActionState> {
  const code = String(formData.get("code") || "").trim().toUpperCase();
  const cookieStore = await cookies();
  const cookieName = `guest_room_${code}`;
  const guestToken = cookieStore.get(cookieName)?.value;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(claimsData?.claims?.sub);

  if (!isAuthenticated && !guestToken) {
    return { status: "error", message: "没有找到你的房间座位凭证" };
  }

  const { error } = isAuthenticated
    ? await supabase.rpc("leave_room_as_member", { room_code: code })
    : await supabase.rpc("leave_room_as_guest", {
        room_code: code,
        guest_token: guestToken!,
      });

  if (error) {
    const message =
      error.code === "PGRST202" ||
        error.message.includes(
          isAuthenticated ? "leave_room_as_member" : "leave_room_as_guest",
        )
        ? "数据库功能不是最新版，请执行最新的 Supabase 迁移"
        : error.message.includes("membership_not_found")
          ? "你的座位已经失效或已退出"
          : error.message.includes("room_owner_must_close")
            ? "房主需要关闭房间，不能直接退出"
            : "退出房间失败，请稍后重试";
    return { status: "error", message };
  }

  if (!isAuthenticated) {
    cookieStore.set(cookieName, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 0,
      path: "/",
    });
  }

  return { status: "success", navigateTo: "/?notice=room_left" };
}
