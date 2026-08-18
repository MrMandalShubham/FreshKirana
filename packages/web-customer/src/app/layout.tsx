import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FreshKirana',
  description: 'Your neighbourhood kirana, ordered in two minutes.',
  manifest: '/manifest.webmanifest',
  applicationName: 'FreshKirana',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Not `maximumScale: 1` — blocking pinch-zoom fails WCAG 1.4.4 and is
  // exactly the accessibility shortcut §4.5 rules out.
  themeColor: '#1f7a4d',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
