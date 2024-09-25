import type { Metadata } from 'next';
import '@teable/ui-lib/dist/global.shadcn.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Chart',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
