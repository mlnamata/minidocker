import type { Metadata, Viewport } from 'next';
import '@xterm/xterm/css/xterm.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'MiniDocker – virtuální Docker v prohlížeči',
  description:
    'Napište Dockerfile a docker-compose.yml, sestavte image, spusťte kontejner a otevřete aplikaci – vše v prohlížeči díky WebContainers.',
  icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b1020',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="cs" className="dark">
      <body>{children}</body>
    </html>
  );
}
