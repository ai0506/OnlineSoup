// 管理端表格统一的紧凑时间格式（26/10/13 16:05），固定北京时间，服务端和浏览器输出一致
const adminTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "2-digit",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatAdminTime(value: string | null | undefined, empty = "—") {
  return value ? adminTimeFormatter.format(new Date(value)) : empty;
}
