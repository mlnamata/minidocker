'use client';

import { useMemo, useState } from 'react';
import { basename, dirname, extname, join } from '@/lib/paths';
import {
  allDirs,
  createDir,
  createFile,
  deletePath,
  projectStore,
  renamePath,
  setActive,
  validateName,
} from '@/lib/project';
import { useStore } from '@/lib/store';
import { uiStore } from '@/lib/ui';
import { IconChevron, IconFile, IconFilePlus, IconFolder, IconFolderPlus, IconPencil, IconTrash } from './icons';

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children: TreeNode[];
}

function buildTree(files: Record<string, string>, dirs: Set<string>): TreeNode[] {
  const root: TreeNode = { name: '', path: '', type: 'dir', children: [] };
  const byPath = new Map<string, TreeNode>([['', root]]);
  const ensureDir = (p: string): TreeNode => {
    const existing = byPath.get(p);
    if (existing) return existing;
    const parent = ensureDir(dirname(p) === '.' ? '' : dirname(p));
    const node: TreeNode = { name: basename(p), path: p, type: 'dir', children: [] };
    parent.children.push(node);
    byPath.set(p, node);
    return node;
  };
  for (const d of dirs) ensureDir(d);
  for (const f of Object.keys(files)) {
    const parent = ensureDir(dirname(f) === '.' ? '' : dirname(f));
    parent.children.push({ name: basename(f), path: f, type: 'file', children: [] });
  }
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)));
    n.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

function fileColor(name: string): string {
  if (/^Dockerfile/i.test(name) || name === '.dockerignore') return 'text-sky-400';
  const ext = extname(name);
  if (ext === '.yml' || ext === '.yaml') return 'text-violet-400';
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs' || ext === '.ts') return 'text-yellow-300';
  if (ext === '.json') return 'text-amber-400';
  if (ext === '.html') return 'text-orange-400';
  if (ext === '.css') return 'text-cyan-300';
  if (ext === '.md') return 'text-slate-300';
  return 'text-slate-400';
}

type Editing = { mode: 'new-file' | 'new-dir'; parent: string } | { mode: 'rename'; path: string } | null;

function InlineInput({
  initial,
  depth,
  onSubmit,
  onCancel,
  icon,
}: {
  initial: string;
  depth: number;
  onSubmit: (value: string) => string | null;
  onCancel: () => void;
  icon: React.ReactNode;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    if (value === initial && initial) return onCancel();
    const err = onSubmit(value.trim());
    if (err) setError(err);
  };
  return (
    <div style={{ paddingLeft: 8 + depth * 12 }} className="pr-2 py-0.5">
      <div className="flex items-center gap-1.5">
        {icon}
        <input
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onFocus={(e) => {
            const dot = e.target.value.lastIndexOf('.');
            e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') onCancel();
          }}
          onBlur={() => (value.trim() && value !== initial ? submit() : onCancel())}
          className="min-w-0 flex-1 rounded border border-sky-500 bg-slate-950 px-1.5 py-0.5 text-[13px] text-slate-100 outline-none"
        />
      </div>
      {error && <div className="mt-1 rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] text-red-300">{error}</div>}
    </div>
  );
}

export default function FileExplorer() {
  const files = useStore(projectStore, (s) => s.files);
  const dirsList = useStore(projectStore, (s) => s.dirs);
  const active = useStore(projectStore, (s) => s.active);
  const name = useStore(projectStore, (s) => s.name);
  const selectedDir = useStore(uiStore, (s) => s.selectedDir);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Editing>(null);

  const dirs = useMemo(() => allDirs({ files, dirs: dirsList }), [files, dirsList]);
  const tree = useMemo(() => buildTree(files, dirs), [files, dirs]);
  const targetDir = dirs.has(selectedDir) ? selectedDir : '';

  const toggle = (p: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const startNew = (mode: 'new-file' | 'new-dir') => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(targetDir);
      return next;
    });
    setEditing({ mode, parent: targetDir });
  };

  const submitNew = (mode: 'new-file' | 'new-dir', parent: string, value: string): string | null => {
    const err = validateName(value);
    if (err) return err;
    const path = join(parent, value);
    const res = mode === 'new-file' ? createFile(path) : createDir(path);
    if (!res) {
      setEditing(null);
      if (mode === 'new-file') uiStore.set({ mobileTab: 'editor' });
      else uiStore.set({ selectedDir: path });
    }
    return res;
  };

  const submitRename = (path: string, value: string): string | null => {
    const err = validateName(value);
    if (err) return err;
    const parent = dirname(path) === '.' ? '' : dirname(path);
    const res = renamePath(path, join(parent, value));
    if (!res) setEditing(null);
    return res;
  };

  const remove = (node: TreeNode) => {
    const what = node.type === 'dir' ? `složku „${node.path}“ včetně obsahu` : `soubor „${node.path}“`;
    if (window.confirm(`Opravdu smazat ${what}?`)) deletePath(node.path);
  };

  const renderNew = (parent: string, depth: number) =>
    editing && editing.mode !== 'rename' && editing.parent === parent ? (
      <InlineInput
        key="__new"
        initial=""
        depth={depth}
        icon={editing.mode === 'new-file' ? <IconFile className="shrink-0 text-slate-400" /> : <IconFolder className="shrink-0 text-sky-300" />}
        onSubmit={(v) => submitNew(editing.mode as 'new-file' | 'new-dir', parent, v)}
        onCancel={() => setEditing(null)}
      />
    ) : null;

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const isDir = node.type === 'dir';
    const open = isDir && !collapsed.has(node.path);
    const isActive = !isDir && node.path === active;
    const isSelectedDir = isDir && node.path === selectedDir;

    if (editing?.mode === 'rename' && editing.path === node.path) {
      return (
        <InlineInput
          key={node.path}
          initial={node.name}
          depth={depth}
          icon={isDir ? <IconFolder className="shrink-0 text-sky-300" /> : <IconFile className={`shrink-0 ${fileColor(node.name)}`} />}
          onSubmit={(v) => submitRename(node.path, v)}
          onCancel={() => setEditing(null)}
        />
      );
    }

    return (
      <div key={node.path}>
        <div
          role="treeitem"
          aria-selected={isActive || isSelectedDir}
          aria-expanded={isDir ? open : undefined}
          tabIndex={0}
          onClick={() => {
            if (isDir) {
              toggle(node.path);
              uiStore.set({ selectedDir: node.path });
            } else {
              setActive(node.path);
              uiStore.set({ selectedDir: dirname(node.path) === '.' ? '' : dirname(node.path), mobileTab: 'editor' });
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.currentTarget as HTMLElement).click();
            if (e.key === 'F2') setEditing({ mode: 'rename', path: node.path });
            if (e.key === 'Delete') remove(node);
          }}
          style={{ paddingLeft: 8 + depth * 12 }}
          className={`group flex cursor-pointer items-center gap-1.5 py-[3px] pr-1 text-[13px] select-none ${
            isActive ? 'bg-sky-500/15 text-sky-100' : isSelectedDir ? 'bg-slate-800/60 text-slate-200' : 'text-slate-300 hover:bg-slate-800/50'
          }`}
        >
          {isDir ? (
            <>
              <IconChevron width={12} height={12} className={`shrink-0 text-slate-500 transition-transform ${open ? 'rotate-90' : ''}`} />
              <IconFolder className="shrink-0 text-sky-300" />
            </>
          ) : (
            <>
              <span className="w-3 shrink-0" />
              <IconFile className={`shrink-0 ${fileColor(node.name)}`} />
            </>
          )}
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          <span className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-lg:opacity-60">
            <button
              type="button"
              title="Přejmenovat (F2)"
              aria-label={`Přejmenovat ${node.name}`}
              onClick={(e) => {
                e.stopPropagation();
                setEditing({ mode: 'rename', path: node.path });
              }}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-700 hover:text-slate-100"
            >
              <IconPencil width={13} height={13} />
            </button>
            <button
              type="button"
              title="Smazat (Delete)"
              aria-label={`Smazat ${node.name}`}
              onClick={(e) => {
                e.stopPropagation();
                remove(node);
              }}
              className="rounded p-0.5 text-slate-400 hover:bg-red-500/20 hover:text-red-300"
            >
              <IconTrash width={13} height={13} />
            </button>
          </span>
        </div>
        {isDir && open && (
          <div role="group">
            {renderNew(node.path, depth + 1)}
            {node.children.map((ch) => renderNode(ch, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-panel">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border pl-3 pr-1.5">
        <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-slate-400" title={name}>
          Průzkumník
        </span>
        <div className="flex gap-0.5">
          <button
            type="button"
            title={`Nový soubor${targetDir ? ` v ${targetDir}/` : ''}`}
            aria-label="Nový soubor"
            onClick={() => startNew('new-file')}
            className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <IconFilePlus />
          </button>
          <button
            type="button"
            title={`Nová složka${targetDir ? ` v ${targetDir}/` : ''}`}
            aria-label="Nová složka"
            onClick={() => startNew('new-dir')}
            className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <IconFolderPlus />
          </button>
        </div>
      </div>
      <div
        role="tree"
        className="min-h-0 flex-1 overflow-auto py-1"
        onClick={(e) => {
          if (e.target === e.currentTarget) uiStore.set({ selectedDir: '' });
        }}
      >
        <div
          className={`flex items-center gap-1.5 px-2 py-[3px] text-[12px] font-semibold text-slate-400 ${selectedDir === '' ? 'text-slate-200' : ''}`}
          onClick={() => uiStore.set({ selectedDir: '' })}
        >
          <IconFolder width={14} height={14} className="text-slate-500" />
          <span className="truncate">{name}</span>
        </div>
        {renderNew('', 1)}
        {tree.map((n) => renderNode(n, 1))}
        {!tree.length && !editing && (
          <p className="px-3 py-4 text-xs text-slate-500">Projekt je prázdný. Vytvořte soubor nebo vyberte šablonu.</p>
        )}
      </div>
    </div>
  );
}
