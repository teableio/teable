import type { Metadata } from 'next';
import '@teable/ui-lib/dist/global.shadcn.css';

export const metadata: Metadata = {
  title: 'Sheet Form Designer',
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
