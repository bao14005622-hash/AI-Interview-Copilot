import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 面试招聘助手",
  description: "面向招聘团队的 AI 候选人分析前端原型。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
