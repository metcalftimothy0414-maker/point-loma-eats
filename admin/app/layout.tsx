import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Point Loma Eats — Admin',
  description: 'Founder-only admin tools',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
