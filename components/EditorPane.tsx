'use client';

import Editor, { loader, type Monaco, type OnMount } from '@monaco-editor/react';
import { useEffect, useRef, useState } from 'react';
import { isComposeFile, parseCompose } from '@/lib/compose';
import { parseDockerfile } from '@/lib/dockerfile';
import { basename, extname } from '@/lib/paths';
import { projectStore, updateFile } from '@/lib/project';
import { useStore } from '@/lib/store';
import { IconCode } from './icons';

// Monaco se načítá ze stejného originu (public/monaco/vs) – CDN by pod COEP nemuselo projít.
loader.config({ paths: { vs: '/monaco/vs' } });

type MonacoEditor = Parameters<OnMount>[0];

export function isDockerfile(path: string): boolean {
  const b = basename(path);
  return /^Dockerfile(\..+)?$/i.test(b) || /\.dockerfile$/i.test(b) || /^Containerfile$/i.test(b);
}

function languageFor(path: string): string {
  if (isDockerfile(path)) return 'dockerfile';
  const b = basename(path);
  if (b === '.dockerignore' || b === '.gitignore' || b === '.env') return 'ini';
  const map: Record<string, string> = {
    '.yml': 'yaml',
    '.yaml': 'yaml',
    '.js': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.jsx': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.json': 'json',
    '.html': 'html',
    '.htm': 'html',
    '.css': 'css',
    '.md': 'markdown',
    '.sh': 'shell',
    '.xml': 'xml',
    '.svg': 'xml',
  };
  return map[extname(path)] ?? 'plaintext';
}

interface Problem {
  line: number;
  endLine?: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

function diagnose(path: string, text: string): Problem[] {
  if (isDockerfile(path)) return parseDockerfile(text).diagnostics;
  if (isComposeFile(path)) {
    return parseCompose(text, { file: path, projectName: 'app' }).issues.map((i) => ({
      line: i.line ?? 1,
      message: i.message,
      severity: i.severity,
    }));
  }
  return [];
}

export default function EditorPane() {
  const active = useStore(projectStore, (s) => s.active);
  const files = useStore(projectStore, (s) => s.files);
  const content = active ? files[active] : undefined;
  const [problems, setProblems] = useState<Problem[]>([]);
  const monacoRef = useRef<Monaco | null>(null);
  const editorRef = useRef<MonacoEditor | null>(null);
  const [mounted, setMounted] = useState(0);

  // Validace + podtržení chyb (Dockerfile, compose)
  useEffect(() => {
    if (!active || content === undefined) {
      setProblems([]);
      return;
    }
    const t = setTimeout(() => {
      const probs = diagnose(active, content);
      setProblems(probs);
      const monaco = monacoRef.current;
      const model = editorRef.current?.getModel();
      if (!monaco || !model) return;
      const sev = { error: monaco.MarkerSeverity.Error, warning: monaco.MarkerSeverity.Warning, info: monaco.MarkerSeverity.Info };
      const lineCount = model.getLineCount();
      monaco.editor.setModelMarkers(
        model,
        'minidocker',
        probs.map((p) => {
          const start = Math.min(Math.max(p.line, 1), lineCount);
          const end = Math.min(Math.max(p.endLine ?? p.line, start), lineCount);
          const startCol = model.getLineFirstNonWhitespaceColumn(start) || 1;
          return {
            startLineNumber: start,
            endLineNumber: end,
            startColumn: startCol,
            endColumn: Math.max(model.getLineMaxColumn(end), startCol + 1),
            message: p.message,
            severity: sev[p.severity],
            source: isDockerfile(active) ? 'Dockerfile' : 'compose',
          };
        }),
      );
    }, 250);
    return () => clearTimeout(t);
  }, [active, content, mounted]);

  if (!active || content === undefined) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[#1e1e1e] p-6 text-center text-sm text-slate-500">
        <IconCode width={32} height={32} className="text-slate-600" />
        <p>Vyberte soubor v průzkumníku, nebo vytvořte nový.</p>
      </div>
    );
  }

  const errors = problems.filter((p) => p.severity === 'error').length;
  const warnings = problems.filter((p) => p.severity === 'warning').length;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-[#1e1e1e]">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-panel px-3 text-[13px]">
        <span className="truncate font-mono text-slate-300">{active}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2 text-xs">
          {errors > 0 && <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-red-300">{errors} chyb</span>}
          {warnings > 0 && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300">{warnings} varování</span>}
          <span className="text-slate-500">{languageFor(active)}</span>
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          path={active}
          language={languageFor(active)}
          value={content}
          theme="vs-dark"
          onChange={(v) => updateFile(active, v ?? '')}
          onMount={(editor, monaco) => {
            editorRef.current = editor;
            monacoRef.current = monaco;
            setMounted((m) => m + 1);
          }}
          loading={<div className="p-4 text-sm text-slate-500">Načítám editor…</div>}
          options={{
            fontSize: 13,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            wordWrap: 'on',
            renderWhitespace: 'selection',
            fixedOverflowWidgets: true,
            padding: { top: 8 },
          }}
        />
      </div>
      {problems.length > 0 && (
        <ul className="max-h-28 shrink-0 overflow-auto border-t border-border bg-panel-2 py-1 text-xs">
          {problems.map((p, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => {
                  editorRef.current?.revealLineInCenter(p.line);
                  editorRef.current?.setPosition({ lineNumber: p.line, column: 1 });
                  editorRef.current?.focus();
                }}
                className="flex w-full items-start gap-2 px-3 py-0.5 text-left hover:bg-slate-800/60"
              >
                <span
                  className={
                    p.severity === 'error' ? 'text-red-400' : p.severity === 'warning' ? 'text-amber-400' : 'text-sky-400'
                  }
                >
                  {p.severity === 'error' ? '✖' : p.severity === 'warning' ? '⚠' : 'ℹ'}
                </span>
                <span className="shrink-0 text-slate-500">ř. {p.line}</span>
                <span className="text-slate-300">{p.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
