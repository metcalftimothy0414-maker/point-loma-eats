import Link from 'next/link';

const LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/orders', label: 'Orders' },
  { href: '/restaurants', label: 'Restaurants' },
  { href: '/customers', label: 'Customers' },
  { href: '/installations', label: 'Installations' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/payments', label: 'Payments' },
  { href: '/refunds', label: 'Refunds' },
  { href: '/support', label: 'Support' },
  { href: '/menu-sync', label: 'Menu Sync' },
];

export function AdminNav() {
  return (
    <nav className="admin-nav">
      {LINKS.map((link) => (
        <Link key={link.href} href={link.href}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
