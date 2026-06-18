import type { Metadata } from "next";

import { AuthHashHandler } from "@/components/auth-hash-handler";
import { SiteHeader } from "@/components/site-header";

import "./globals.css";

export const metadata: Metadata = {
  title: "汤局 - 多人海龟汤",
  description: "创建房间，邀请朋友一起推理。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <AuthHashHandler />
        <SiteHeader />
        <main className="page-shell">{children}</main>
      </body>
    </html>
  );
}
