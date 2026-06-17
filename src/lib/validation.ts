import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9_]{3,8}$/,
    "用户名需要 3 到 8 位，只能使用英文字母、数字和下划线",
  );

export const loginSchema = z.object({
  email: z.email("请输入有效邮箱"),
  password: z.string().min(6, "密码至少需要 6 位"),
});

// Accepts either an email address or a username (3-8 alphanumeric/underscore chars)
export const loginIdentitySchema = z.object({
  identity: z
    .string()
    .trim()
    .min(1, "请输入邮箱或用户名")
    .refine(
      (v) => v.includes("@") ? z.email().safeParse(v).success : /^[A-Za-z0-9_]{3,8}$/.test(v),
      "请输入有效邮箱，或 3 到 8 位英数字下划线的用户名",
    ),
  password: z.string().min(6, "密码至少需要 6 位"),
});

export const adminPasswordSchema = z.string().min(6, "密码至少需要 6 位").max(72, "密码最多 72 位");

export const adminCreateUserSchema = z.object({
  username: usernameSchema,
  password: adminPasswordSchema,
  points: z.coerce.number().int().min(0).max(1_000_000_000),
});

export const signupSchema = loginSchema.extend({
  username: usernameSchema,
});

export const roomSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "房间名至少 2 个字")
    .max(8, "房间名最多 8 个字"),
  maxMembers: z.coerce
    .number()
    .int()
    .min(1, "至少需要 1 个座位")
    .max(20, "座位数量最多 20"),
  pointsPerSeat: z.coerce
    .number()
    .int()
    .min(0, "每个座位积分不能为负数")
    .max(100, "每个座位最多 100 积分"),
  password: z
    .string()
    .optional()
    .transform((value) => value?.trim() || null)
    .refine(
      (value) => value === null || /^\d{6}$/.test(value),
      "房间密码必须是 6 位数字",
    ),
});

export const guestJoinSchema = z.object({
  code: z
    .string()
    .trim()
    .length(6, "房间码应为 6 位")
    .transform((value) => value.toUpperCase()),
  nickname: usernameSchema,
  password: z
    .string()
    .refine((value) => /^\d{6}$/.test(value), "房间密码必须是 6 位数字")
    .optional(),
});
