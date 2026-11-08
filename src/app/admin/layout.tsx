import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Sarin Bot Admin Hub | ALS Dev Studio',
  description: 'Centro de control de ALS Dev Studio para negocios enlazados, WhatsApp e inteligencia artificial.',
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
