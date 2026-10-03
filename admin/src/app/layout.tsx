import type { Metadata } from 'next';
import { Hanken_Grotesk, Instrument_Serif } from 'next/font/google';
import { UiProvider } from '@/components/ui';
import './globals.css';

const sans = Hanken_Grotesk({ subsets: ['latin', 'latin-ext'], weight: ['400', '500', '600', '700'], variable: '--font-sans' });
const serif = Instrument_Serif({ subsets: ['latin', 'latin-ext'], weight: '400', variable: '--font-serif' });

export const metadata: Metadata = {
  title: { default: 'Folio — Administration', template: '%s · Folio admin' },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${sans.variable} ${serif.variable}`}>
      <body>
        <UiProvider>{children}</UiProvider>
      </body>
    </html>
  );
}
