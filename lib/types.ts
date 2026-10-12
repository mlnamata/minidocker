export type Runtime = 'node' | 'static';
export type BaseFlavor = 'node' | 'nginx' | 'httpd';

export interface ImageConfig {
  runtime: Runtime;
  flavor: BaseFlavor;
  env: Record<string, string>;
  workdir: string;
  /** Ve formátu Dockeru: shell forma = ['/bin/sh', '-c', '...'] */
  cmd: string[] | null;
  entrypoint: string[] | null;
  exposed: number[];
  labels: Record<string, string>;
  /** Pro nginx/httpd: složka, kterou servíruje statický server. */
  docRoot?: string;
}

export interface Layer {
  id: string;
  createdBy: string;
  size: number;
  /** Mění instrukce souborový systém (má vlastní snapshot)? */
  fs: boolean;
}

export interface Image {
  id: string;
  repoTags: string[];
  created: number;
  base: string;
  /** Odhad velikosti base image (MB) + skutečná velikost souborů. */
  size: number;
  layers: Layer[];
  config: ImageConfig;
  /** ID vrstvy, jejíž snapshot je finální souborový systém image. */
  snapshotLayer: string;
}

export interface PortMapping {
  host: number;
  container: number;
  hostIp?: string;
}

export type ContainerStatus = 'created' | 'running' | 'exited';

export interface Container {
  id: string;
  name: string;
  image: string;
  imageId: string;
  status: ContainerStatus;
  exitCode: number | null;
  created: number;
  startedAt: number | null;
  finishedAt: number | null;
  ports: PortMapping[];
  /** Port, na kterém kontejner skutečně poslouchá ve WebContaineru. */
  internalPort: number | null;
  url: string | null;
  env: Record<string, string>;
  command: string[];
  workdir: string;
  compose?: { project: string; service: string; number: number };
  autoRemove?: boolean;
  /** Má se po startu serveru automaticky otevřít v záložce Prohlížeč? */
  openOnReady?: boolean;
  /** Příkaz zadal uživatel (`docker run image cmd…`) → nepoužije se statický server. */
  userCmd?: boolean;
}

export interface LogEntry {
  t: number;
  line: string;
}

export interface Out {
  write(text: string): void;
}

export interface ProjectState {
  name: string;
  template: string;
  files: Record<string, string>;
  dirs: string[];
  active: string | null;
  loaded: boolean;
}
