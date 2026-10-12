'use client';

import {
  actionBuild,
  actionComposeDown,
  actionComposeUp,
  actionExportZip,
  actionReset,
  actionRun,
} from '@/lib/actions';
import { loadTemplate, projectStore } from '@/lib/project';
import { useStore } from '@/lib/store';
import { TEMPLATES } from '@/lib/templates';
import { uiStore } from '@/lib/ui';
import { IconBox, IconDown, IconHammer, IconPlay, IconReset, IconUp, IconZip } from './icons';

function ToolButton({
  onClick,
  icon,
  label,
  title,
  variant = 'default',
  disabled,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  title: string;
  variant?: 'default' | 'primary' | 'danger';
  disabled?: boolean;
}) {
  const styles = {
    default: 'border-slate-700 bg-slate-800/70 text-slate-200 hover:bg-slate-700',
    primary: 'border-sky-500/50 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25',
    danger: 'border-transparent text-slate-400 hover:bg-red-500/15 hover:text-red-300',
  }[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${styles}`}
    >
      {icon}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

const STATUS = {
  idle: { color: 'bg-slate-500', label: 'Čekám' },
  booting: { color: 'bg-amber-400 animate-pulse', label: 'Spouštím WebContainer…' },
  ready: { color: 'bg-emerald-400', label: 'WebContainer běží' },
  error: { color: 'bg-red-500', label: 'WebContainer selhal' },
  unsupported: { color: 'bg-red-500', label: 'Nepodporované prostředí' },
};

export default function TopBar() {
  const template = useStore(projectStore, (s) => s.template);
  const wc = useStore(uiStore, (s) => s.wc);
  const ready = wc === 'ready';
  const status = STATUS[wc];

  const onTemplate = (id: string) => {
    if (id === template) return;
    const ok = window.confirm('Načíst šablonu? Aktuální soubory projektu budou nahrazeny (images a kontejnery zůstanou).');
    if (ok) loadTemplate(id);
  };

  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-border bg-panel px-3 py-2">
      <div className="mr-1 flex shrink-0 items-center gap-2">
        <IconBox width={20} height={20} className="text-sky-400" />
        <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">MiniDocker</span>
      </div>

      <select
        value={template}
        onChange={(e) => onTemplate(e.target.value)}
        aria-label="Šablona projektu"
        className="h-8 shrink-0 rounded-md border border-slate-700 bg-slate-900 px-2 text-[13px] text-slate-200"
      >
        {TEMPLATES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>

      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <ToolButton onClick={actionBuild} icon={<IconHammer />} label="Build" title="docker build -t <projekt> ." disabled={!ready} />
        <ToolButton
          onClick={actionRun}
          icon={<IconPlay />}
          label="Run"
          title="Build + docker run -d -p 8080:<port> (u compose projektu docker compose up -d)"
          variant="primary"
          disabled={!ready}
        />
        <span className="mx-1 h-5 w-px shrink-0 bg-slate-700" />
        <ToolButton onClick={actionComposeUp} icon={<IconUp />} label="Compose Up" title="docker compose up" disabled={!ready} />
        <ToolButton onClick={actionComposeDown} icon={<IconDown />} label="Compose Down" title="docker compose down" disabled={!ready} />
        <span className="mx-1 h-5 w-px shrink-0 bg-slate-700" />
        <ToolButton onClick={actionExportZip} icon={<IconZip />} label="Export ZIP" title="Stáhnout projekt jako ZIP (spustitelný i ve skutečném Dockeru)" />
        <ToolButton onClick={actionReset} icon={<IconReset />} label="Reset" title="Smazat vše (projekt, images, kontejnery)" variant="danger" />
      </div>

      <div className="flex shrink-0 items-center gap-2 pl-1 text-xs text-slate-400" title={status.label}>
        <span className={`h-2.5 w-2.5 rounded-full ${status.color}`} />
        <span className="hidden xl:inline">{status.label}</span>
      </div>
    </header>
  );
}
