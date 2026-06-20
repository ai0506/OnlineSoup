type HeaderLike = {
  get(name: string): string | null;
};

const COUNTRY_NAMES: Record<string, string> = {
  CN: "中国",
  JP: "日本",
  US: "美国",
  CA: "加拿大",
  GB: "英国",
  SG: "新加坡",
  KR: "韩国",
  AU: "澳大利亚",
  DE: "德国",
  FR: "法国",
  NL: "荷兰",
  HK: "中国香港",
  TW: "中国台湾",
};

function decodeHeaderValue(value: string | null) {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

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

export function getLocationLabel(headersList: HeaderLike) {
  const countryCode = (
    headersList.get("x-vercel-ip-country") ||
    headersList.get("cf-ipcountry") ||
    ""
  ).toUpperCase();
  const country =
    COUNTRY_NAMES[countryCode] ||
    (countryCode.length === 2 ? countryCode : null);
  const city = decodeHeaderValue(headersList.get("x-vercel-ip-city"));
  const region = decodeHeaderValue(headersList.get("x-vercel-ip-country-region"));

  if (country && city) return `${country}${city}`;
  if (country && region) return `${country}${region}`;
  if (country) return country;
  return "未知地点";
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
