import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '旅人教育入职系统 - 工资申报',
  description: '工资申报系统复刻工程',
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
