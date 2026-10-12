'use client';

import { useEffect, useState } from 'react';
import { runImage } from '@/lib/actions';
import { dockerStore, engine } from '@/lib/engine';
import { formatBytes, timeAgoCs } from '@/lib/format';
import { shortId } from '@/lib/hash';
import { useStore } from '@/lib/store';
import type { Container, Image } from '@/lib/types';
import { browserBack, browserReload, openInBrowser, terminalBridge, uiStore, type RightTab } from '@/lib/ui';
import {
  IconBack,
  IconBox,
  IconExternal,
  IconGlobe,
  IconLayers,
  IconLogs,
  IconPlay,
  IconRestart,
  IconStop,
  IconTrash,
} from './icons';

/** Překreslení relativních časů („před 2 min“). */
function useTick(ms = 10_000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

function SmallButton({
  onClick,
  children,
  title,
  tone = 'default',
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  title: string;
  tone?: 'default' | 'primary' | 'danger';
  disabled?: boolean;
}) {
  const tones = {
    default: 'text-slate-300 hover:bg-slate-700/70',
    primary: 'text-sky-300 hover:bg-sky-500/20',
    danger: 'text-slate-400 hover:bg-red-500/20 hover:text-red-300',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`flex h-7 items-center gap-1 rounded px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${tones}`}
    >
      {children}
    </button>
  );
}

function Empty({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <div className="text-slate-600">{icon}</div>
      <p className="text-sm font-medium text-slate-300">{title}</p>
      <p className="text-xs leading-relaxed text-slate-500">{hint}</p>
    </div>
  );
}

/* ---------------- Images ---------------- */

function ImageCard({ img }: { img: Image }) {
  const [open, setOpen] = useState(false);
  const tag = img.repoTags[0];
  const label = tag ?? '<none>:<none>';
  const ref = tag ? tag.replace(/:latest$/, '') : shortId(img.id);
  const cmd = [...(img.config.entrypoint ?? []), ...(img.config.cmd ?? [])].join(' ');
  return (
    <li className="rounded-lg border border-border bg-slate-900/60 p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[13px] font-semibold text-slate-100" title={img.repoTags.join(', ') || label}>
            {label}
            {img.repoTags.length > 1 && <span className="ml-1 text-xs font-normal text-slate-500">+{img.repoTags.length - 1}</span>}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
            <span className="font-mono">{shortId(img.id)}</span>
            <span>{img.layers.length} vrstev</span>
            <span>{formatBytes(img.size)}</span>
            <span title={new Date(img.created).toLocaleString('cs-CZ')}>{timeAgoCs(img.created)}</span>
          </div>
        </div>
        <div className="flex shrink-0 gap-0.5">
          <SmallButton onClick={() => void runImage(ref)} title={`docker run -d ${ref}`} tone="primary">
            <IconPlay width={12} height={12} /> Run
          </SmallButton>
          <SmallButton onClick={() => void terminalBridge.run(`docker rmi ${tag ? ref : shortId(img.id)}`)} title="docker rmi" tone="danger">
            <IconTrash width={13} height={13} />
            <span className="sr-only">Smazat</span>
          </SmallButton>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">{img.base}</span>
        {img.config.runtime === 'static' && (
          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">statický server</span>
        )}
        {img.config.exposed.map((p) => (
          <span key={p} className="rounded bg-sky-500/10 px-1.5 py-0.5 text-sky-300">
            EXPOSE {p}
          </span>
        ))}
        {cmd && img.config.runtime === 'node' && (
          <span className="truncate rounded bg-slate-800 px-1.5 py-0.5 font-mono text-slate-400" title={cmd}>
            {cmd}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mt-2 flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300"
      >
        <IconLayers width={12} height={12} /> {open ? 'Skrýt vrstvy' : 'Zobrazit vrstvy'}
      </button>
      {open && (
        <ol className="mt-1.5 space-y-0.5 border-l border-slate-700 pl-2 font-mono text-[11px]">
          {img.layers.map((l) => (
            <li key={l.id} className="flex gap-2">
              <span className="shrink-0 text-slate-500">{shortId(l.id)}</span>
              <span className="min-w-0 flex-1 truncate text-slate-300" title={l.createdBy}>
                {l.createdBy}
              </span>
              <span className="shrink-0 text-slate-500">{formatBytes(l.size)}</span>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

function ImagesTab() {
  const images = useStore(dockerStore, (s) => s.images);
  useTick();
  if (!images.length) {
    return (
      <Empty
        icon={<IconLayers width={32} height={32} />}
        title="Zatím žádné images"
        hint={
          <>
            Klikněte na <b>Build</b> nahoře nebo napište <code className="text-sky-300">docker build -t app .</code>
          </>
        }
      />
    );
  }
  return (
    <ul className="space-y-2 p-3">
      {images.map((img) => (
        <ImageCard key={img.id} img={img} />
      ))}
    </ul>
  );
}

/* ---------------- Kontejnery ---------------- */

function StatusBadge({ ct }: { ct: Container }) {
  if (ct.status === 'running') {
    return (
      <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> running
      </span>
    );
  }
  if (ct.status === 'exited') {
    return (
      <span className="rounded-full bg-slate-700/60 px-2 py-0.5 text-[11px] font-medium text-slate-300">
        exited ({ct.exitCode ?? 0})
      </span>
    );
  }
  return <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-300">created</span>;
}

function ContainerCard({ ct }: { ct: Container }) {
  const running = ct.status === 'running';
  return (
    <li className="rounded-lg border border-border bg-slate-900/60 p-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-semibold text-slate-100" title={ct.name}>
          {ct.name}
        </span>
        <StatusBadge ct={ct} />
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
        <span className="font-mono">{shortId(ct.id)}</span>
        <span className="truncate" title={engine.imageLabel(ct)}>
          image <span className="text-slate-300">{engine.imageLabel(ct)}</span>
        </span>
        <span>{timeAgoCs(ct.created)}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
        {ct.ports.map((p) => (
          <span key={`${p.host}-${p.container}`} className="rounded bg-sky-500/10 px-1.5 py-0.5 font-mono text-sky-300" title="host:kontejner (jen zobrazení)">
            {p.host}:{p.container}
          </span>
        ))}
        {running && ct.internalPort && (
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-400" title="Skutečný port ve WebContaineru">
            WC port {ct.internalPort}
          </span>
        )}
        {ct.compose && (
          <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-violet-300">
            compose: {ct.compose.project}/{ct.compose.service}
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-0.5 border-t border-slate-800 pt-2">
        {running ? (
          <SmallButton onClick={() => void terminalBridge.run(`docker stop ${ct.name}`)} title="docker stop">
            <IconStop width={12} height={12} /> Stop
          </SmallButton>
        ) : (
          <SmallButton onClick={() => void terminalBridge.run(`docker start ${ct.name}`)} title="docker start" tone="primary">
            <IconPlay width={12} height={12} /> Start
          </SmallButton>
        )}
        <SmallButton onClick={() => void terminalBridge.run(`docker restart ${ct.name}`)} title="docker restart">
          <IconRestart width={12} height={12} /> Restart
        </SmallButton>
        <SmallButton
          onClick={() => {
            uiStore.set({ mobileTab: 'terminal' });
            void terminalBridge.run(`docker logs --tail 200 ${ct.name}`);
          }}
          title="docker logs"
        >
          <IconLogs width={12} height={12} /> Logy
        </SmallButton>
        <SmallButton onClick={() => ct.url && openInBrowser(ct.url)} title={ct.url ?? 'Server zatím neposlouchá'} disabled={!ct.url} tone="primary">
          <IconGlobe width={12} height={12} /> Otevřít
        </SmallButton>
        <SmallButton onClick={() => void terminalBridge.run(`docker rm -f ${ct.name}`)} title="docker rm -f" tone="danger">
          <IconTrash width={12} height={12} /> Smazat
        </SmallButton>
      </div>
    </li>
  );
}

function ContainersTab() {
  const containers = useStore(dockerStore, (s) => s.containers);
  useTick(5_000);
  if (!containers.length) {
    return (
      <Empty
        icon={<IconBox width={32} height={32} />}
        title="Žádné kontejnery"
        hint={
          <>
            Klikněte na <b>Run</b> nebo napište <code className="text-sky-300">docker run -d -p 8080:3000 app</code>
          </>
        }
      />
    );
  }
  const sorted = [...containers].sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || b.created - a.created);
  return (
    <ul className="space-y-2 p-3">
      {sorted.map((ct) => (
        <ContainerCard key={ct.id} ct={ct} />
      ))}
    </ul>
  );
}

/* ---------------- Prohlížeč ---------------- */

function BrowserTab() {
  const url = useStore(uiStore, (s) => s.browserUrl);
  const nonce = useStore(uiStore, (s) => s.browserNonce);
  const index = useStore(uiStore, (s) => s.browserIndex);
  const containers = useStore(dockerStore, (s) => s.containers);
  const [address, setAddress] = useState(url);
  const withUrl = containers.filter((ct) => ct.status === 'running' && ct.url);

  useEffect(() => setAddress(url), [url]);

  const navigate = () => {
    let target = address.trim();
    if (!target) return;
    if (target.startsWith('/') && url) target = new URL(target, url).toString();
    else if (!/^https?:\/\//.test(target)) target = `https://${target}`;
    openInBrowser(target, false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border p-1.5">
        <button
          type="button"
          onClick={browserBack}
          disabled={index <= 0}
          title="Zpět"
          aria-label="Zpět"
          className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-30"
        >
          <IconBack />
        </button>
        <button
          type="button"
          onClick={browserReload}
          disabled={!url}
          title="Znovu načíst"
          aria-label="Znovu načíst"
          className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-30"
        >
          <IconRestart />
        </button>
        <form
          className="min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            navigate();
          }}
        >
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="URL běžícího kontejneru…"
            aria-label="Adresa"
            spellCheck={false}
            className="h-7 w-full rounded-md border border-slate-700 bg-slate-950 px-2 font-mono text-xs text-slate-200 placeholder:text-slate-600"
          />
        </form>
        <button
          type="button"
          onClick={() => url && window.open(url, '_blank', 'noopener')}
          disabled={!url}
          title="Otevřít v novém okně"
          aria-label="Otevřít v novém okně"
          className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-30"
        >
          <IconExternal />
        </button>
      </div>
      {withUrl.length > 0 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-1.5 py-1">
          {withUrl.map((ct) => (
            <button
              key={ct.id}
              type="button"
              onClick={() => openInBrowser(ct.url!, false)}
              className={`shrink-0 rounded px-2 py-0.5 text-[11px] ${
                url.startsWith(ct.url!) ? 'bg-sky-500/20 text-sky-200' : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              {ct.name}
              {ct.ports[0] ? ` :${ct.ports[0].host}` : ''}
            </button>
          ))}
        </div>
      )}
      <div className="relative min-h-0 flex-1 bg-white">
        {url ? (
          <iframe
            key={nonce}
            src={url}
            title="Náhled běžící aplikace"
            className="h-full w-full border-0"
            allow="cross-origin-isolated; clipboard-read; clipboard-write"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-panel-2">
            <Empty
              icon={<IconGlobe width={32} height={32} />}
              title="Žádná běžící aplikace"
              hint="Spusťte kontejner (Run / Compose Up) – po startu serveru se zde automaticky otevře."
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Panel se záložkami ---------------- */

export default function RightPanel() {
  const tab = useStore(uiStore, (s) => s.rightTab);
  const images = useStore(dockerStore, (s) => s.images);
  const containers = useStore(dockerStore, (s) => s.containers);
  const running = containers.filter((ct) => ct.status === 'running').length;

  const tabs: Array<{ id: RightTab; label: string; badge?: string }> = [
    { id: 'images', label: 'Images', badge: String(images.length) },
    { id: 'containers', label: 'Kontejnery', badge: containers.length ? `${running}/${containers.length}` : '0' },
    { id: 'browser', label: 'Prohlížeč' },
  ];

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-panel">
      <div role="tablist" className="flex h-9 shrink-0 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => uiStore.set({ rightTab: t.id })}
            className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 text-[13px] font-medium transition-colors ${
              tab === t.id ? 'border-sky-400 text-slate-100' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
            {t.badge !== undefined && (
              <span className="rounded-full bg-slate-800 px-1.5 text-[10px] text-slate-400">{t.badge}</span>
            )}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'images' && <ImagesTab />}
        {tab === 'containers' && <ContainersTab />}
        {/* Prohlížeč necháváme namountovaný, aby se iframe při přepínání záložek nenačítal znovu */}
        <div className={tab === 'browser' ? 'h-full' : 'hidden'}>
          <BrowserTab />
        </div>
      </div>
    </div>
  );
}
