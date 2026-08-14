import type { Metadata } from 'next';
import './globals.css';
import { AdminNav } from '../components/AdminNav';

export const metadata: Metadata = {
  title: 'Point Loma Eats — Admin',
  description: 'Founder-only admin tools',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AdminNav />
        {children}
      </body>
    </html>
  );
}
