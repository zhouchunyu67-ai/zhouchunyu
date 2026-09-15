import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Frame Vault · 本地素材终端",
  description: "离线优先的本地创作素材工作台，支持多媒体整理、New.bi AI 生成、外部目录同步和加密跨电脑迁移。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
