'use client';

import dynamic from 'next/dynamic';

// WebContainer, Monaco i xterm běží jen v prohlížeči → žádné SSR
const MiniDocker = dynamic(() => import('@/components/MiniDocker'), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh items-center justify-center bg-[#0b1020] text-slate-400">
      <div className="flex items-center gap-3">
        <span className="h-3 w-3 animate-pulse rounded-full bg-sky-400" />
        Načítám MiniDocker…
      </div>
    </div>
  ),
});

export default function Page() {
  return <MiniDocker />;
}
