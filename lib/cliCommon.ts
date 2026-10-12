'use client';

import type { WebContainer, WebContainerProcess } from '@webcontainer/api';
import { c } from './ansi';
import { engine } from './engine';
import { humanDuration, truncate } from './format';
import { quoteArg } from './shellwords';
import type { Container, LogEntry, Out } from './types';

/** Úloha na popředí terminálu (sledování logů, interaktivní proces…). */
export interface ForegroundJob {
  /** Surové stisky kláves (pro stdin procesu). */
  onData?: (data: string) => void;
  /** Ctrl+C */
  onInterrupt: () => void;
  /** Odpojení bez zastavení (klávesa „d“ nebo spuštění jiného příkazu tlačítkem). */
  onDetach?: () => void;
  onResize?: (cols: number, rows: number) => void;
  /** Klávesa „d“ odpojí (docker compose up). */
  detachKey?: boolean;
  done: Promise<unknown>;
}

export interface CliContext {
  out: Out;
  cols: number;
  rows: number;
  /** Aktuální složka v projektu ('' = kořen). */
  cwd: string;
  setCwd: (dir: string) => void;
  /** Přeruší se Ctrl+C (pro úlohy bez vlastního ForegroundJob, např. build). */
  signal: AbortSignal;
  attach: (job: ForegroundJob) => Promise<void>;
}

export const w = (ctx: CliContext, s = '') => ctx.out.write(s + '\n');
export const fail = (ctx: CliContext, msg: string) => {
  ctx.out.write(c.red(msg) + '\n');
  return 1;
};
export const daemonError = (ctx: CliContext, msg: string) => fail(ctx, `Error response from daemon: ${msg}`);

export async function waitReady(ctx: CliContext): Promise<WebContainer | null> {
  if (engine.wc) return engine.wc;
  w(ctx, c.gray('⏳ Čekám na start WebContaineru…'));
  try {
    return await engine.ready;
  } catch (e) {
    fail(ctx, `WebContainer není k dispozici: ${(e as Error)?.message ?? e}`);
    return null;
  }
}

export function formatCommand(cmd: string[]): string {
  const s = cmd.map(quoteArg).join(' ');
  return `"${truncate(s, 20)}"`;
}

export function formatPorts(ct: Container): string {
  if (ct.status !== 'running') return '';
  const mapped = ct.ports.map((p) => `${p.hostIp ?? '0.0.0.0'}:${p.host}->${p.container}/tcp`);
  if (!mapped.length && ct.internalPort) return `${ct.internalPort}/tcp`;
  return mapped.join(', ');
}

export function formatStatus(ct: Container): string {
  const now = Date.now();
  if (ct.status === 'running') return `Up ${humanDuration(now - (ct.startedAt ?? now))}`;
  if (ct.status === 'exited') return `Exited (${ct.exitCode ?? 0}) ${humanDuration(now - (ct.finishedAt ?? now))} ago`;
  return 'Created';
}

/** Výpis logů kontejnerů s volitelným prefixem a sledováním (-f). */
export async function streamLogs(
  ctx: CliContext,
  targets: Array<{ ct: Container; prefix?: string }>,
  opts: { follow: boolean; tail?: number; timestamps?: boolean; untilExit?: boolean },
): Promise<void> {
  const fmt = (prefix: string | undefined, e: LogEntry) =>
    `${prefix ? prefix + ' ' : ''}${opts.timestamps ? c.gray(new Date(e.t).toISOString()) + ' ' : ''}${e.line}\n`;

  const merged = targets
    .flatMap(({ ct, prefix }) => {
      const logs = engine.getLogs(ct.id);
      const sliced = opts.tail !== undefined && opts.tail >= 0 ? logs.slice(-opts.tail) : logs;
      return sliced.map((e) => ({ e, prefix }));
    })
    .sort((a, b) => a.e.t - b.e.t);
  for (const { e, prefix } of merged) ctx.out.write(fmt(prefix, e));
  if (!opts.follow) return;

  const live = targets.filter(({ ct }) => engine.containers.find((x) => x.id === ct.id)?.status === 'running');
  if (!live.length) return;

  await new Promise<void>((resolve) => {
    const unsubs: Array<() => void> = [];
    const remaining = new Set(live.map(({ ct }) => ct.id));
    const finish = () => {
      unsubs.forEach((u) => u());
      resolve();
    };
    for (const { ct, prefix } of live) unsubs.push(engine.onLog(ct.id, (e) => ctx.out.write(fmt(prefix, e))));
    unsubs.push(
      engine.onExit((ct) => {
        if (!remaining.has(ct.id)) return;
        remaining.delete(ct.id);
        if (!remaining.size) finish();
      }),
    );
    void ctx.attach({
      onInterrupt: finish,
      onDetach: finish,
      done: new Promise<void>((r) => unsubs.push(r)),
    });
  });
}

/** Připojí interaktivní proces k terminálu (stdin/stdout, resize, Ctrl+C). */
export async function attachProcess(
  ctx: CliContext,
  proc: WebContainerProcess,
  o: { tee?: (chunk: string) => void; interactive?: boolean } = {},
): Promise<number> {
  const writer = proc.input.getWriter();
  let interrupts = 0;
  void proc.output
    .pipeTo(
      new WritableStream({
        write(chunk) {
          ctx.out.write(chunk);
          o.tee?.(chunk);
        },
      }),
    )
    .catch(() => undefined);
  const exit = proc.exit;
  await ctx.attach({
    onData: o.interactive === false ? undefined : (d) => void writer.write(d).catch(() => undefined),
    onInterrupt: () => {
      interrupts++;
      if (interrupts >= 2) proc.kill();
      else void writer.write('\x03').catch(() => undefined);
    },
    onResize: (cols, rows) => proc.resize({ cols, rows }),
    done: exit,
  });
  try {
    writer.releaseLock();
  } catch {
    /* ignore */
  }
  return exit;
}
