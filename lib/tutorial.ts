'use client';

import { c } from './ansi';
import { commandLog, type CommandRecord } from './commandLog';
import { dockerStore, normalizeRef } from './engine';
import { loadTemplate, projectStore } from './project';
import { KEYS, load, save } from './storage';
import { Store } from './store';
import type { Container, Image } from './types';
import { terminalBridge, uiStore } from './ui';

/* ------------------------------------------------------------------ */
/* Typy                                                                */
/* ------------------------------------------------------------------ */

/**
 * Blok výkladu. V textu lze použít `kód` a **tučné písmo**.
 */
export type Block =
  | { p: string }
  | { code: string }
  | { list: string[] }
  | { tip: string }
  | { table: Array<[string, string]> };

export interface CheckCtx {
  images: Image[];
  containers: Container[];
  files: Record<string, string>;
  template: string;
  activeFile: string | null;
  browserUrl: string;
  /** Byl od splnění předchozího úkolu úspěšně spuštěn příkaz odpovídající regexu? */
  ran: (re: RegExp) => boolean;
  image: (ref: string) => Image | undefined;
  container: (name: string) => Container | undefined;
}

interface TaskBase {
  id: string;
  /** Zadání úkolu (podporuje `kód` a **tučné**). */
  title: string;
  hint?: string;
}

export interface DoTask extends TaskBase {
  kind: 'do';
  /** Příkaz, který úkol splní (zobrazí se po kliknutí na „Ukázat řešení“). */
  solution?: string;
  /** Akce místo příkazu (např. načtení šablony). */
  action?: { label: string; run: () => void };
  check: (ctx: CheckCtx) => boolean;
}

export interface QuizTask extends TaskBase {
  kind: 'quiz';
  options: string[];
  answer: number;
  /** Vysvětlení, které se zobrazí po odpovědi. */
  explain: string;
}

export type Task = DoTask | QuizTask;

export interface Lesson {
  id: string;
  title: string;
  /** Krátké shrnutí, co se v lekci naučíte. */
  goal: string;
  theory: Block[];
  tasks: Task[];
}

/* ------------------------------------------------------------------ */
/* Pomocné funkce pro kontroly                                         */
/* ------------------------------------------------------------------ */

function useTemplate(id: string, label: string) {
  return {
    label: `Načíst šablonu „${label}“`,
    run: () => {
      const s = projectStore.get();
      if (s.template !== id && Object.keys(s.files).length) {
        const ok = window.confirm(`Načíst šablonu „${label}“? Aktuální soubory projektu budou nahrazeny (images a kontejnery zůstanou).`);
        if (!ok) return;
      }
      loadTemplate(id);
    },
  };
}

const running = (ct: Container | undefined) => ct?.status === 'running';

/** Kontejnery vytvořené z dané image. */
function fromImage(ctx: CheckCtx, ref: string): Container[] {
  const img = ctx.image(ref);
  return img ? ctx.containers.filter((ct) => ct.imageId === img.id) : [];
}

/* ------------------------------------------------------------------ */
/* Lekce                                                               */
/* ------------------------------------------------------------------ */

export const LESSONS: Lesson[] = [
  /* ---------------- 1 ---------------- */
  {
    id: 'intro',
    title: 'Co je Docker',
    goal: 'Pochopíte rozdíl mezi image a kontejnerem a vyzkoušíte první příkazy.',
    theory: [
      {
        p: '**Docker** zabalí aplikaci se vším, co ke svému běhu potřebuje (runtime, knihovny, konfiguraci), do jednoho balíčku. Ten pak poběží stejně na vašem notebooku, na serveru spolužáka i v cloudu – konec „u mě to funguje“.',
      },
      {
        table: [
          ['Image', 'Neměnná šablona: souborový systém + metadata (jaký příkaz spustit, jaké porty…). Něco jako recept nebo třída v programování.'],
          ['Kontejner', 'Spuštěná instance image – izolovaný proces s vlastním souborovým systémem. Jako upečený koláč podle receptu nebo objekt dané třídy.'],
          ['Dockerfile', 'Textový soubor s instrukcemi, jak image sestavit.'],
          ['Registry', 'Úložiště hotových images (např. Docker Hub), odkud se stahují base images jako `node` nebo `nginx`.'],
        ],
      },
      {
        p: 'Z jedné image můžete spustit libovolný počet kontejnerů. Kontejner je oproti virtuálnímu stroji lehký: nemá vlastní jádro OS, jen izolovaný proces – proto startuje za zlomek sekundy.',
      },
      {
        tip: 'MiniDocker simuluje Docker přímo v prohlížeči. Příkazy pište do **terminálu dole** – chovají se jako skutečné `docker` příkazy. Úkoly se odškrtnou samy, jakmile je splníte.',
      },
    ],
    tasks: [
      {
        id: 'intro-version',
        kind: 'do',
        title: 'Ověřte, že Docker běží: spusťte `docker version`.',
        hint: 'Klikněte do terminálu dole, napište příkaz a stiskněte Enter.',
        solution: 'docker version',
        check: (ctx) => ctx.ran(/^docker (version|--version|-v)\b/),
      },
      {
        id: 'intro-pull',
        kind: 'do',
        title: 'Stáhněte base image Node.js z registry: `docker pull node:20-alpine`.',
        hint: '`pull` stáhne image z registry (Docker Hubu). `alpine` znamená malou linuxovou distribuci – image je pak menší.',
        solution: 'docker pull node:20-alpine',
        check: (ctx) => ctx.ran(/^docker (image )?pull node(:\S+)?$/),
      },
      {
        id: 'intro-images',
        kind: 'do',
        title: 'Vypište lokální images příkazem `docker images`.',
        solution: 'docker images',
        check: (ctx) => ctx.ran(/^docker (images|image (ls|list))\b/),
      },
      {
        id: 'intro-quiz',
        kind: 'quiz',
        title: 'Jaký je vztah mezi image a kontejnerem?',
        options: [
          'Kontejner je spuštěná instance image.',
          'Image je běžící proces, kontejner je jeho záloha na disku.',
          'Je to totéž, jen se tomu různě říká.',
        ],
        answer: 0,
        explain: 'Image je neměnná šablona, kontejner je z ní spuštěný proces. Z jedné image může běžet mnoho kontejnerů.',
      },
    ],
  },

  /* ---------------- 2 ---------------- */
  {
    id: 'build',
    title: 'Dockerfile a build image',
    goal: 'Přečtete Dockerfile, sestavíte z něj image a prohlédnete si její vrstvy.',
    theory: [
      { p: '**Dockerfile** je recept na image. Každý řádek je jedna instrukce, které se provádějí shora dolů:' },
      {
        table: [
          ['FROM node:20-alpine', 'Základ (base image), na kterém stavíme.'],
          ['WORKDIR /app', 'Pracovní složka uvnitř image (vytvoří se, když neexistuje).'],
          ['COPY package*.json ./', 'Zkopíruje soubory z projektu (build kontextu) do image.'],
          ['RUN npm install', 'Spustí příkaz při buildu – výsledek se uloží do image.'],
          ['ENV NODE_ENV=production', 'Nastaví proměnnou prostředí.'],
          ['EXPOSE 3000', 'Dokumentuje, na jakém portu aplikace poslouchá.'],
          ['CMD ["node", "server.js"]', 'Výchozí příkaz, který se spustí při startu kontejneru.'],
        ],
      },
      {
        p: 'Image se skládá z **vrstev** – každá instrukce vytvoří jednu. Docker si vrstvy pamatuje (cache): když se instrukce ani soubory, které používá, nezměnily, vrstva se znovu nestaví.',
      },
      { p: 'Image sestavíte příkazem:' },
      { code: 'docker build -t moje-app .' },
      {
        list: [
          '`-t moje-app` – název (tag) image; bez verze se doplní `:latest`.',
          '`.` – **build kontext**: složka, jejíž soubory může Dockerfile kopírovat (tečka = aktuální složka).',
        ],
      },
    ],
    tasks: [
      {
        id: 'build-template',
        kind: 'do',
        title: 'Načtěte šablonu **Node Express** (výběr šablony vlevo nahoře, nebo tlačítkem níže).',
        action: useTemplate('node-express', 'Node Express'),
        check: (ctx) => ctx.template === 'node-express' && 'Dockerfile' in ctx.files && 'server.js' in ctx.files,
      },
      {
        id: 'build-read',
        kind: 'quiz',
        title: 'Otevřete v průzkumníku `Dockerfile` a přečtěte si ho. Jaký příkaz se spustí při startu kontejneru?',
        options: ['`npm install --omit=dev`', '`node server.js`', '`FROM node:20-alpine`'],
        answer: 1,
        explain: 'Výchozí příkaz určuje `CMD ["node", "server.js"]`. `RUN npm install` se naopak spouští jen jednou – při buildu image.',
      },
      {
        id: 'build-build',
        kind: 'do',
        title: 'Sestavte image s názvem `moje-app`.',
        hint: 'Použijte `docker build` s přepínačem `-t` a nezapomeňte na tečku (build kontext) na konci.',
        solution: 'docker build -t moje-app .',
        check: (ctx) => !!ctx.image('moje-app'),
      },
      {
        id: 'build-history',
        kind: 'do',
        title: 'Zobrazte vrstvy image příkazem `docker history moje-app`.',
        hint: 'Každý řádek je jedna vrstva. Všimněte si, že některé instrukce (ENV, EXPOSE, CMD) mají velikost 0 B – mění jen metadata.',
        solution: 'docker history moje-app',
        check: (ctx) => ctx.ran(/^docker (image )?history moje-app(:latest)?$/),
      },
      {
        id: 'build-cache',
        kind: 'do',
        title: 'Spusťte stejný build ještě jednou a všimněte si řádků `---> Using cache`.',
        hint: 'Nic jste nezměnili, takže Docker použije všechny vrstvy z cache a build je téměř okamžitý.',
        solution: 'docker build -t moje-app .',
        check: (ctx) => ctx.ran(/^docker (image )?build\b.*-t moje-app\b/) || ctx.ran(/^docker (image )?build\b.*--tag moje-app\b/),
      },
      {
        id: 'build-quiz',
        kind: 'quiz',
        title: 'Proč Dockerfile kopíruje nejdřív jen `package.json`, spustí `npm install` a teprve potom kopíruje zbytek kódu?',
        options: [
          'Aby se vrstva s `npm install` vzala z cache, když se změní jen kód aplikace.',
          'Protože `COPY` neumí zkopírovat víc souborů najednou.',
          'Aby byl výsledný image menší.',
        ],
        answer: 0,
        explain: 'Instalace závislostí je pomalá. Když se změní jen `server.js`, zneplatní se až vrstva `COPY . .` a `npm install` se nespouští znovu.',
      },
    ],
  },

  /* ---------------- 3 ---------------- */
  {
    id: 'run',
    title: 'Spuštění kontejneru',
    goal: 'Spustíte kontejner na pozadí, namapujete port a podíváte se do logů.',
    theory: [
      { p: 'Kontejner z image vytvoříte a spustíte příkazem `docker run`. Nejčastější přepínače:' },
      {
        table: [
          ['-d', 'Detached – kontejner běží na pozadí a terminál zůstane volný.'],
          ['-p 8080:3000', 'Publikuje port: `hostitel:kontejner`. Požadavky na port 8080 počítače jdou na port 3000 v kontejneru.'],
          ['--name web', 'Pojmenuje kontejner, abyste se na něj nemuseli odkazovat přes ID.'],
          ['-e KLÍČ=hodnota', 'Nastaví proměnnou prostředí.'],
          ['--rm', 'Po skončení kontejner automaticky smaže.'],
        ],
      },
      { code: 'docker run -d -p 8080:3000 --name web moje-app' },
      {
        p: 'Běžící kontejnery vypíše `docker ps`, výstup aplikace (vše, co píše na stdout/stderr) ukáže `docker logs <kontejner>`.',
      },
      {
        tip: 'V MiniDockeru se mapování portu jen zobrazuje – aplikaci otevřete v záložce **Prohlížeč** nebo tlačítkem **Otevřít** u kontejneru.',
      },
    ],
    tasks: [
      {
        id: 'run-run',
        kind: 'do',
        title: 'Spusťte image `moje-app` na pozadí jako kontejner `web` s mapováním portu `8080:3000`.',
        hint: 'Potřebujete přepínače `-d`, `-p` a `--name`. Název image je až na konci.',
        solution: 'docker run -d -p 8080:3000 --name web moje-app',
        check: (ctx) => {
          const ct = ctx.container('web');
          return running(ct) && !!ct?.ports.some((p) => p.host === 8080 && p.container === 3000) && !!ctx.image('moje-app') && ct?.imageId === ctx.image('moje-app')?.id;
        },
      },
      {
        id: 'run-ps',
        kind: 'do',
        title: 'Vypište běžící kontejnery.',
        hint: 'Sloupec PORTS ukazuje mapování, STATUS jak dlouho kontejner běží.',
        solution: 'docker ps',
        check: (ctx) => ctx.ran(/^docker (ps|container (ls|list))\b/),
      },
      {
        id: 'run-browser',
        kind: 'do',
        title: 'Otevřete aplikaci v záložce **Prohlížeč** (tlačítko **Otevřít** u kontejneru `web` v záložce Kontejnery). Zkuste stránku několikrát načíst.',
        check: (ctx) => {
          const url = ctx.container('web')?.url;
          return !!url && ctx.browserUrl.startsWith(url);
        },
      },
      {
        id: 'run-logs',
        kind: 'do',
        title: 'Podívejte se do logů kontejneru `web`.',
        hint: 'Uvidíte, co aplikace vypsala při startu, a každý váš požadavek z prohlížeče.',
        solution: 'docker logs web',
        check: (ctx) => ctx.ran(/^docker (container )?logs( -\S+| --tail \S+)* web$/),
      },
      {
        id: 'run-quiz',
        kind: 'quiz',
        title: 'Co znamená přepínač `-p 8080:3000`?',
        options: [
          'Port 3000 na hostiteli se přesměruje na port 8080 v kontejneru.',
          'Port 8080 na hostiteli se přesměruje na port 3000 v kontejneru.',
          'Kontejner smí použít porty 3000 až 8080.',
        ],
        answer: 1,
        explain: 'Pořadí je vždy `hostitel:kontejner`. Aplikace v kontejneru poslouchá na 3000, zvenku na ni přistoupíte přes 8080.',
      },
    ],
  },

  /* ---------------- 4 ---------------- */
  {
    id: 'lifecycle',
    title: 'Životní cyklus kontejneru',
    goal: 'Kontejner zastavíte, znovu spustíte, spustíte v něm příkaz a nakonec ho smažete.',
    theory: [
      { p: 'Kontejner prochází stavy **created → running → exited**. Zastavený kontejner nezmizí – zůstane, dokud ho nesmažete.' },
      {
        table: [
          ['docker stop web', 'Pošle procesu signál k ukončení → stav `exited`.'],
          ['docker start web', 'Znovu spustí existující (zastavený) kontejner.'],
          ['docker restart web', 'Stop + start.'],
          ['docker ps -a', 'Vypíše i zastavené kontejnery.'],
          ['docker exec web <příkaz>', 'Spustí další příkaz uvnitř běžícího kontejneru (třeba `ls` nebo `sh`).'],
          ['docker rm web', 'Smaže zastavený kontejner (`-f` i běžící).'],
        ],
      },
      {
        p: 'Soubory, které aplikace za běhu zapíše, patří jen danému kontejneru. Po `docker rm` jsou pryč – image zůstává nezměněná. Data, která mají přežít, se ukládají do **volumes**.',
      },
    ],
    tasks: [
      {
        id: 'life-stop',
        kind: 'do',
        title: 'Zastavte kontejner `web`.',
        solution: 'docker stop web',
        check: (ctx) => ctx.container('web')?.status === 'exited',
      },
      {
        id: 'life-psa',
        kind: 'do',
        title: 'Ověřte, že kontejner pořád existuje – vypište i zastavené kontejnery.',
        hint: '`docker ps` ukazuje jen běžící kontejnery. Potřebujete přepínač pro „všechny“.',
        solution: 'docker ps -a',
        check: (ctx) => ctx.ran(/^docker (ps|container (ls|list))( -\S+)* (-a|--all)\b/),
      },
      {
        id: 'life-start',
        kind: 'do',
        title: 'Znovu spusťte zastavený kontejner `web`.',
        solution: 'docker start web',
        check: (ctx) => running(ctx.container('web')) && ctx.ran(/^docker (container )?(start|restart) (.* )?web\b/),
      },
      {
        id: 'life-exec',
        kind: 'do',
        title: 'Spusťte uvnitř běžícího kontejneru `web` příkaz `ls`, abyste viděli soubory v image.',
        hint: 'Syntaxe je `docker exec <kontejner> <příkaz>`. Soubory jsou ve WORKDIR (`/app`).',
        solution: 'docker exec web ls',
        check: (ctx) => ctx.ran(/^docker (container )?exec( -\S+)* web \S+/),
      },
      {
        id: 'life-rm',
        kind: 'do',
        title: 'Smažte kontejner `web` (i když běží).',
        hint: 'Běžící kontejner smažete jen s přepínačem `-f` (force), jinak ho musíte nejdřív zastavit.',
        solution: 'docker rm -f web',
        check: (ctx) => !ctx.container('web'),
      },
      {
        id: 'life-quiz',
        kind: 'quiz',
        title: 'Co se stane se soubory, které aplikace zapsala uvnitř kontejneru, po `docker rm`?',
        options: [
          'Uloží se zpět do image.',
          'Zůstanou ve složce projektu na hostiteli.',
          'Zmizí – patřily jen tomu kontejneru.',
        ],
        answer: 2,
        explain: 'Každý kontejner má vlastní zapisovatelnou vrstvu nad image. Smazáním kontejneru zmizí i ona. Pro trvalá data se používají volumes.',
      },
    ],
  },

  /* ---------------- 5 ---------------- */
  {
    id: 'env',
    title: 'Změny, tagy a proměnné prostředí',
    goal: 'Upravíte Dockerfile, vytvoříte novou verzi image a konfiguraci přepíšete při spuštění.',
    theory: [
      {
        p: 'Image je neměnná. Když změníte kód nebo Dockerfile, musíte image **znovu sestavit** a kontejner spustit znovu. Cache vrstev zajistí, že se postaví jen to, co se změnilo.',
      },
      {
        p: '**Tagy** označují verze: `moje-app:latest`, `moje-app:v2`… Jedna image může mít víc tagů – `docker tag` jen přidá nové jméno, nic nekopíruje.',
      },
      { code: 'docker tag moje-app moje-app:v2' },
      {
        p: 'Konfigurace se do kontejneru předává **proměnnými prostředí**. `ENV` v Dockerfile nastaví výchozí hodnotu, přepínač `-e` u `docker run` ji přepíše – stejnou image tak můžete spustit pro vývoj i produkci.',
      },
      { code: 'docker run -d -e NODE_ENV=development moje-app' },
    ],
    tasks: [
      {
        id: 'env-edit',
        kind: 'do',
        title: 'Upravte `Dockerfile`: pod řádek `ENV NODE_ENV=production` přidejte `ENV APP_VERSION=2`.',
        hint: 'Změna se uloží automaticky.',
        check: (ctx) => /^\s*ENV\s+APP_VERSION[=\s]\s*\S+/m.test(ctx.files['Dockerfile'] ?? ''),
      },
      {
        id: 'env-rebuild',
        kind: 'do',
        title: 'Znovu sestavte image `moje-app`. Které vrstvy se vzaly z cache a které se stavěly znovu?',
        hint: 'Vrstvy před změněným řádkem zůstanou v cache, ostatní se postaví znovu.',
        solution: 'docker build -t moje-app .',
        check: (ctx) => !!ctx.image('moje-app')?.config.env.APP_VERSION,
      },
      {
        id: 'env-tag',
        kind: 'do',
        title: 'Označte novou image tagem `moje-app:v2`.',
        solution: 'docker tag moje-app moje-app:v2',
        check: (ctx) => !!ctx.image('moje-app:v2')?.config.env.APP_VERSION,
      },
      {
        id: 'env-run',
        kind: 'do',
        title: 'Spusťte `moje-app:v2` jako kontejner `web-dev` s portem `8081:3000` a proměnnou `NODE_ENV=development`.',
        hint: 'Přepínač `-e` patří před název image.',
        solution: 'docker run -d -p 8081:3000 -e NODE_ENV=development --name web-dev moje-app:v2',
        check: (ctx) => {
          const ct = ctx.container('web-dev');
          return running(ct) && ct?.env.NODE_ENV === 'development' && ct?.imageId === ctx.image('moje-app:v2')?.id;
        },
      },
      {
        id: 'env-inspect',
        kind: 'do',
        title: 'Prohlédněte si detail kontejneru příkazem `docker inspect web-dev` a najděte v něm proměnné prostředí.',
        solution: 'docker inspect web-dev',
        check: (ctx) => ctx.ran(/^docker (container )?inspect( -\S+)* web-dev$/),
      },
      {
        id: 'env-quiz',
        kind: 'quiz',
        title: 'Dockerfile obsahuje `ENV NODE_ENV=production` a kontejner spustíte s `-e NODE_ENV=development`. Jakou hodnotu uvidí aplikace?',
        options: ['production', 'development', 'Kontejner se nespustí kvůli konfliktu.'],
        answer: 1,
        explain: 'Hodnota z `-e` při spuštění přepíše výchozí hodnotu z `ENV`. Otevřete si `web-dev` v prohlížeči – stránka ukazuje NODE_ENV.',
      },
    ],
  },

  /* ---------------- 6 ---------------- */
  {
    id: 'own',
    title: 'Vlastní Dockerfile od nuly',
    goal: 'Napíšete vlastní mini aplikaci i Dockerfile a zjistíte, proč některé kontejnery hned skončí.',
    theory: [
      { p: 'Teď si celý postup zkusíte sami. Ve složce `hello/` vytvoříte jednoduchý skript a k němu Dockerfile:' },
      {
        code: 'FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nCMD ["node", "index.js"]',
      },
      {
        p: '`CMD` ve formě JSON pole (**exec forma**) spustí proces přímo, bez shellu – doporučený způsob. Build kontext tentokrát nebude kořen projektu, ale složka `hello`:',
      },
      { code: 'docker build -t hello ./hello' },
      {
        p: 'Kontejner běží **jen tak dlouho, dokud běží jeho hlavní proces**. Webový server běží pořád, ale skript, který něco vypíše a skončí, ukončí i kontejner (stav `exited (0)`).',
      },
    ],
    tasks: [
      {
        id: 'own-js',
        kind: 'do',
        title: 'Vytvořte soubor `hello/index.js`, který něco vypíše pomocí `console.log(…)`.',
        hint: 'V průzkumníku klikněte na ikonu nové složky (`hello`), složku vyberte a pak vytvořte soubor `index.js`. Obsah třeba: `console.log("Ahoj z mého kontejneru!");`',
        check: (ctx) => /console\.log\s*\(/.test(ctx.files['hello/index.js'] ?? ''),
      },
      {
        id: 'own-dockerfile',
        kind: 'do',
        title: 'Vytvořte `hello/Dockerfile` s instrukcemi `FROM node:…`, `WORKDIR`, `COPY` a `CMD` (viz výklad).',
        hint: 'Editor podtrhne chyby přímo v kódu.',
        check: (ctx) => {
          const df = ctx.files['hello/Dockerfile'] ?? '';
          return /^\s*FROM\s+node\b/im.test(df) && /^\s*WORKDIR\s+\S+/im.test(df) && /^\s*COPY\s+\S+\s+\S+/im.test(df) && /^\s*(CMD|ENTRYPOINT)\s+\S+/im.test(df);
        },
      },
      {
        id: 'own-build',
        kind: 'do',
        title: 'Sestavte image `hello` s build kontextem `./hello`.',
        solution: 'docker build -t hello ./hello',
        check: (ctx) => !!ctx.image('hello'),
      },
      {
        id: 'own-run',
        kind: 'do',
        title: 'Spusťte kontejner z image `hello` (tentokrát bez `-d`, ať vidíte výstup). Měl by vypsat vaši zprávu a skončit.',
        solution: 'docker run --name hello-run hello',
        check: (ctx) => fromImage(ctx, 'hello').some((ct) => ct.status === 'exited' && ct.exitCode === 0),
      },
      {
        id: 'own-psa',
        kind: 'do',
        title: 'Vypište všechny kontejnery a najděte ten svůj ve stavu `Exited (0)`.',
        solution: 'docker ps -a',
        check: (ctx) => ctx.ran(/^docker (ps|container (ls|list))( -\S+)* (-a|--all)\b/),
      },
      {
        id: 'own-quiz',
        kind: 'quiz',
        title: 'Proč kontejner `hello` hned skončil, zatímco `web-dev` běží dál?',
        options: [
          'Kontejner běží jen do té doby, dokud běží jeho hlavní proces (CMD).',
          'Kontejner bez přepínače `-p` Docker po chvíli ukončí.',
          'Skript spadl na chybu.',
        ],
        answer: 0,
        explain: 'Exit code 0 znamená úspěch. Skript doběhl, hlavní proces skončil, a tím skončil i kontejner. Webový server naopak čeká na požadavky donekonečna.',
      },
    ],
  },

  /* ---------------- 7 ---------------- */
  {
    id: 'compose',
    title: 'Docker Compose',
    goal: 'Spustíte aplikaci ze dvou služeb (web + API) jedním příkazem.',
    theory: [
      {
        p: 'Reálné aplikace mají víc částí: frontend, API, databázi… Spouštět každou ručně přes `docker run` je otravné. **Docker Compose** popíše všechny služby v jednom souboru `docker-compose.yml`:',
      },
      {
        code: 'services:\n  api:\n    build: ./api\n    environment:\n      - PORT=4000\n  web:\n    build: ./web\n    ports:\n      - "8080:3000"\n    environment:\n      - API_URL=http://api:4000\n    depends_on:\n      - api',
      },
      {
        list: [
          '`build` – složka s Dockerfile (místo toho může být `image: node:20`).',
          '`depends_on` – pořadí spuštění: nejdřív `api`, pak `web`.',
          'Služby se navzájem najdou **podle názvu služby** – `http://api:4000` funguje jako DNS jméno.',
        ],
      },
      {
        table: [
          ['docker compose up -d', 'Sestaví (pokud je třeba) a spustí všechny služby na pozadí.'],
          ['docker compose ps', 'Stav služeb.'],
          ['docker compose logs api', 'Logy jedné nebo všech služeb.'],
          ['docker compose down', 'Zastaví a smaže kontejnery projektu.'],
        ],
      },
    ],
    tasks: [
      {
        id: 'compose-template',
        kind: 'do',
        title: 'Načtěte šablonu **Compose web + api** a prohlédněte si `docker-compose.yml`.',
        hint: 'Vaše složka `hello/` se přitom smaže – image `hello` ale zůstane.',
        action: useTemplate('compose', 'Compose web + api'),
        check: (ctx) => ctx.template === 'compose' && 'docker-compose.yml' in ctx.files,
      },
      {
        id: 'compose-up',
        kind: 'do',
        title: 'Spusťte všechny služby na pozadí.',
        hint: 'Compose nejdřív sestaví obě images a pak spustí kontejnery v pořadí podle `depends_on`.',
        solution: 'docker compose up -d',
        check: (ctx) => ctx.containers.filter((ct) => ct.compose && ct.status === 'running').length >= 2,
      },
      {
        id: 'compose-ps',
        kind: 'do',
        title: 'Zobrazte stav služeb projektu.',
        solution: 'docker compose ps',
        check: (ctx) => ctx.ran(/^docker compose( -\S+ \S+)* ps\b/),
      },
      {
        id: 'compose-browser',
        kind: 'do',
        title: 'Otevřete službu `web` v Prohlížeči a klikněte na tlačítko, které zavolá API.',
        check: (ctx) => {
          const web = ctx.containers.find((ct) => ct.compose?.service === 'web' && ct.url);
          return !!web?.url && ctx.browserUrl.startsWith(web.url);
        },
      },
      {
        id: 'compose-logs',
        kind: 'do',
        title: 'Podívejte se do logů služby `api` – uvidíte v nich požadavky, které poslal web.',
        solution: 'docker compose logs api',
        check: (ctx) => ctx.ran(/^docker compose( -\S+ \S+)* logs( -\S+)* api\b/),
      },
      {
        id: 'compose-down',
        kind: 'do',
        title: 'Zastavte a odstraňte celý projekt.',
        solution: 'docker compose down',
        check: (ctx) => ctx.ran(/^docker compose( -\S+ \S+)* down\b/) && !ctx.containers.some((ct) => ct.compose),
      },
      {
        id: 'compose-quiz',
        kind: 'quiz',
        title: 'Jak kontejner `web` najde kontejner `api`?',
        options: [
          'Musí znát jeho IP adresu, kterou vypíše `docker inspect`.',
          'Přes název služby – Compose ho zaregistruje jako DNS jméno (`http://api:4000`).',
          'Nijak, kontejnery spolu komunikovat nemohou.',
        ],
        answer: 1,
        explain: 'Compose vytvoří společnou síť a každá služba je v ní dostupná pod svým názvem. IP adresy se mohou měnit, názvy služeb ne.',
      },
    ],
  },

  /* ---------------- 8 ---------------- */
  {
    id: 'cleanup',
    title: 'Úklid',
    goal: 'Smažete nepotřebné kontejnery a images a zopakujete si, co je co.',
    theory: [
      { p: 'Images i zastavené kontejnery zabírají místo na disku, proto je dobré občas uklidit:' },
      {
        table: [
          ['docker rm <kontejner…>', 'Smaže kontejnery (můžete jich uvést víc najednou).'],
          ['docker rmi <image…>', 'Smaže images. Image, ze které vznikl nějaký kontejner, nejde smazat bez `-f`.'],
          ['docker rmi moje-app:v2', 'Odebere jen tag `v2`; pokud má image další tagy, zůstane.'],
        ],
      },
      { tip: 'Ve skutečném Dockeru se hodí i `docker system prune`, které smaže všechno nepoužívané najednou.' },
    ],
    tasks: [
      {
        id: 'clean-stop',
        kind: 'do',
        title: 'Zastavte a smažte kontejner `web-dev`.',
        solution: 'docker rm -f web-dev',
        check: (ctx) => !ctx.container('web-dev'),
      },
      {
        id: 'clean-exited',
        kind: 'do',
        title: 'Smažte všechny zastavené kontejnery (třeba ten z image `hello`).',
        hint: 'Názvy najdete v `docker ps -a`. `docker rm` přijímá víc názvů najednou.',
        solution: 'docker rm hello-run',
        check: (ctx) => !ctx.containers.some((ct) => ct.status === 'exited'),
      },
      {
        id: 'clean-rmi',
        kind: 'do',
        title: 'Smažte image `hello` a tag `moje-app:v2`.',
        solution: 'docker rmi hello moje-app:v2',
        check: (ctx) => !ctx.image('hello') && !ctx.image('moje-app:v2'),
      },
      {
        id: 'clean-images',
        kind: 'do',
        title: 'Zkontrolujte výsledek příkazem `docker images`.',
        solution: 'docker images',
        check: (ctx) => ctx.ran(/^docker (images|image (ls|list))\b/),
      },
      {
        id: 'clean-quiz',
        kind: 'quiz',
        title: 'Jaký je rozdíl mezi `docker rm` a `docker rmi`?',
        options: [
          '`rm` maže kontejnery, `rmi` maže images.',
          '`rm` maže images, `rmi` maže kontejnery.',
          '`rmi` je jen starší název pro `rm`.',
        ],
        answer: 0,
        explain: '`rmi` = remove image. Hotovo – zvládli jste základy Dockeru! Projekt si můžete stáhnout tlačítkem Export ZIP a spustit ve skutečném Dockeru.',
      },
    ],
  },
];

export const ALL_TASKS: Task[] = LESSONS.flatMap((l) => l.tasks);

/* ------------------------------------------------------------------ */
/* Stav a vyhodnocování                                                */
/* ------------------------------------------------------------------ */

export interface TaskProgress {
  /** Čas splnění. */
  t: number;
  skipped?: boolean;
}

export interface TutorialState {
  done: Record<string, TaskProgress>;
  /** Index zobrazené lekce. */
  lesson: number;
  /** Postup už je načtený z IndexedDB. */
  loaded: boolean;
}

export const tutorialStore = new Store<TutorialState>({ done: {}, lesson: 0, loaded: false });

/** Text bez značek `kód` a **tučné**. */
export function plain(text: string): string {
  return text.replace(/\*\*|`/g, '');
}

/** Normalizace příkazu pro porovnání: `docker-compose` → `docker compose`, jedna mezera. */
function segments(rec: CommandRecord): string[] {
  return rec.cmd
    .split(/\s*(?:&&|\|\||;)\s*/)
    .map((s) =>
      s
        .replace(/\s+/g, ' ')
        .replace(/^docker-compose\b/, 'docker compose')
        .trim(),
    )
    .filter(Boolean);
}

function makeCtx(since: number): CheckCtx {
  const { images, containers } = dockerStore.get();
  const { files, template, active } = projectStore.get();
  const commands = commandLog.get().entries.filter((e) => e.t >= since && (e.code === 0 || e.code === 130));
  return {
    images,
    containers,
    files,
    template,
    activeFile: active,
    browserUrl: uiStore.get().browserUrl,
    ran: (re) => commands.some((rec) => segments(rec).some((s) => re.test(s))),
    image: (ref) => {
      const tagged = normalizeRef(ref);
      return images.find((i) => i.repoTags.includes(tagged));
    },
    container: (name) => containers.find((ct) => ct.name === name),
  };
}

/** Index první lekce, která ještě není celá hotová. */
export function firstOpenLesson(done: Record<string, TaskProgress>): number {
  const i = LESSONS.findIndex((l) => l.tasks.some((t) => !done[t.id]));
  return i === -1 ? LESSONS.length - 1 : i;
}

/**
 * Projde úkoly celého tutoriálu v pořadí. Úkol typu „do“ se může splnit jen
 * tehdy, když jsou hotové (nebo přeskočené) všechny předchozí úkoly – jinak by
 * se např. „smažte kontejner“ odškrtlo hned na začátku. Příkazy se počítají až
 * od splnění předchozího úkolu (aby šlo poznat třeba „stop a pak znovu start“).
 */
function evaluate(): void {
  const state = tutorialStore.get();
  if (!state.loaded) return;
  const done = { ...state.done };
  let changed = false;
  let since = 0;
  for (const task of ALL_TASKS) {
    const progress = done[task.id];
    if (progress) {
      since = Math.max(since, progress.t);
      continue;
    }
    if (task.kind === 'quiz') continue; // kvíz neblokuje následující úkoly
    let ok = false;
    try {
      ok = task.check(makeCtx(since));
    } catch (e) {
      console.warn('[tutorial] kontrola úkolu selhala', task.id, e);
    }
    if (!ok) break;
    const t = Date.now();
    done[task.id] = { t };
    since = t;
    changed = true;
    terminalBridge.print(c.green(`✔ Úkol splněn: ${plain(task.title)}`));
  }
  if (changed) setDone(done);
}

function setDone(done: Record<string, TaskProgress>) {
  tutorialStore.set({ done });
  persist();
}

function persist() {
  const { done, lesson } = tutorialStore.get();
  void save(KEYS.tutorial, { done, lesson });
}

/** Je úkol k dispozici (všechny předchozí „do“ úkoly tutoriálu jsou hotové)? */
export function isTaskOpen(taskId: string, done: Record<string, TaskProgress>): boolean {
  for (const t of ALL_TASKS) {
    if (t.id === taskId) return true;
    if (t.kind === 'do' && !done[t.id]) return false;
  }
  return false;
}

export function answerQuiz(task: QuizTask, option: number): boolean {
  const ok = option === task.answer;
  if (ok && !tutorialStore.get().done[task.id]) {
    setDone({ ...tutorialStore.get().done, [task.id]: { t: Date.now() } });
  }
  return ok;
}

export function skipTask(taskId: string): void {
  setDone({ ...tutorialStore.get().done, [taskId]: { t: Date.now(), skipped: true } });
  scheduleEvaluate();
}

export function setLesson(index: number): void {
  tutorialStore.set({ lesson: Math.max(0, Math.min(LESSONS.length - 1, index)) });
  persist();
}

export function resetTutorial(): void {
  tutorialStore.set({ done: {}, lesson: 0 });
  commandLog.set({ entries: [] });
  persist();
}

let scheduled = false;
function scheduleEvaluate() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    evaluate();
  }, 50);
}

let started = false;

/** Načte uložený postup a začne sledovat stav Dockeru, projektu a terminálu. */
export async function startTutorial(): Promise<void> {
  if (started) return;
  started = true;
  const saved = await load<{ done: Record<string, TaskProgress>; lesson: number }>(KEYS.tutorial);
  tutorialStore.set({
    done: saved?.done ?? {},
    lesson: Math.max(0, Math.min(LESSONS.length - 1, saved?.lesson ?? 0)),
    loaded: true,
  });
  dockerStore.subscribe(scheduleEvaluate);
  projectStore.subscribe(scheduleEvaluate);
  uiStore.subscribe(scheduleEvaluate);
  commandLog.subscribe(scheduleEvaluate);
  scheduleEvaluate();
}
