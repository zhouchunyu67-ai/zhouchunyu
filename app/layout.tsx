import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Frame Vault · 本地素材终端",
  description: "本地离线识别、预览和整理图片与视频素材。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
