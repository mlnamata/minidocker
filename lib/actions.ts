'use client';

import JSZip from 'jszip';
import { c } from './ansi';
import { COMPOSE_FILES } from './compose';
import { engine } from './engine';
import { slugify } from './format';
import { projectStore } from './project';
import { clearAll } from './storage';
import { terminalBridge } from './ui';

export function imageName(): string {
  return slugify(projectStore.get().name);
}

function hasRootDockerfile(): boolean {
  return 'Dockerfile' in projectStore.get().files;
}

function rootComposeFile(): string | undefined {
  const files = projectStore.get().files;
  return COMPOSE_FILES.find((f) => f in files);
}

/** První volný „hostitelský“ port (jen pro zobrazení mapování). */
export function freeHostPort(start = 8080): number {
  const used = new Set(engine.containers.filter((x) => x.status === 'running').flatMap((x) => x.ports.map((p) => p.host)));
  let p = start;
  while (used.has(p)) p++;
  return p;
}

export async function actionBuild(): Promise<void> {
  if (hasRootDockerfile()) {
    await terminalBridge.run(`docker build -t ${imageName()} .`);
  } else if (rootComposeFile()) {
    await terminalBridge.run('docker compose build');
  } else {
    terminalBridge.print(c.yellow('V kořeni projektu chybí Dockerfile i docker-compose.yml.'));
  }
}

/** Build + (re)start kontejneru se jménem projektu. */
export async function actionRun(): Promise<void> {
  if (!hasRootDockerfile()) {
    if (rootComposeFile()) await terminalBridge.run('docker compose up -d');
    else terminalBridge.print(c.yellow('V kořeni projektu chybí Dockerfile.'));
    return;
  }
  const name = imageName();
  const code = await terminalBridge.run(`docker build -t ${name} .`);
  if (code !== 0) return;
  const image = engine.findImage(name);
  if (!image) return;
  const existing = engine.findContainer(name);
  if (existing) await terminalBridge.run(`docker rm -f ${name}`);
  const containerPort = image.config.exposed[0];
  const publish = containerPort ? `-p ${freeHostPort()}:${containerPort} ` : '';
  await terminalBridge.run(`docker run -d ${publish}--name ${name} ${name}`);
}

export async function runImage(ref: string): Promise<void> {
  const image = engine.findImage(ref);
  const containerPort = image?.config.exposed[0];
  const publish = containerPort ? `-p ${freeHostPort()}:${containerPort} ` : '';
  await terminalBridge.run(`docker run -d ${publish}${ref}`);
}

export async function actionComposeUp(): Promise<void> {
  if (!rootComposeFile()) {
    terminalBridge.print(c.yellow('V kořeni projektu chybí docker-compose.yml (zkuste šablonu „Compose web + api“).'));
    return;
  }
  await terminalBridge.run('docker compose up');
}

export async function actionComposeDown(): Promise<void> {
  if (!rootComposeFile()) {
    terminalBridge.print(c.yellow('V kořeni projektu chybí docker-compose.yml.'));
    return;
  }
  await terminalBridge.run('docker compose down');
}

export async function actionExportZip(): Promise<void> {
  const { files, dirs, name } = projectStore.get();
  const zip = new JSZip();
  const root = zip.folder(slugify(name))!;
  for (const d of dirs) root.folder(d);
  for (const [path, content] of Object.entries(files)) root.file(path, content);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slugify(name)}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  const hint = hasRootDockerfile()
    ? `docker build -t ${slugify(name)} . && docker run -p 8080:${engine.findImage(slugify(name))?.config.exposed[0] ?? 3000} ${slugify(name)}`
    : 'docker compose up --build';
  terminalBridge.print(c.green(`✔ Exportováno ${slugify(name)}.zip`) + c.gray(` – ve skutečném Dockeru: ${hint}`));
}

export async function actionReset(): Promise<void> {
  if (!window.confirm('Opravdu smazat projekt, všechny images, kontejnery a historii? Tuto akci nelze vrátit.')) return;
  engine.killAll();
  await clearAll();
  window.location.reload();
}
