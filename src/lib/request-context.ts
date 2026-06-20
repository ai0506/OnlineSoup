type HeaderLike = {
  get(name: string): string | null;
};

export function getClientIp(headersList: HeaderLike) {
  const forwardedFor = headersList.get("x-forwarded-for");
  const firstForwardedIp = forwardedFor?.split(",")[0]?.trim();
  return (
    firstForwardedIp ||
    headersList.get("x-real-ip") ||
    headersList.get("cf-connecting-ip") ||
    null
  );
}

export function getDeviceLabel(headersList: HeaderLike) {
  const userAgent = headersList.get("user-agent") ?? "";

  const os =
    /Windows NT/i.test(userAgent) ? "Windows"
    : /Mac OS X|Macintosh/i.test(userAgent) ? "macOS"
    : /Android/i.test(userAgent) ? "Android"
    : /iPhone|iPad|iPod/i.test(userAgent) ? "iOS"
    : /Linux/i.test(userAgent) ? "Linux"
    : "未知设备";

  const browser =
    /Edg\//i.test(userAgent) ? "Edge"
    : /Chrome\//i.test(userAgent) && !/Edg\//i.test(userAgent) ? "Chrome"
    : /Safari\//i.test(userAgent) && !/Chrome\//i.test(userAgent) ? "Safari"
    : /Firefox\//i.test(userAgent) ? "Firefox"
    : "浏览器";

  return `${os} / ${browser}`;
}
