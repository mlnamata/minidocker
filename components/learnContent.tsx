'use client';

import type { ReactNode } from 'react';
import type { TaskContext } from '@/lib/learn';
import { terminalBridge, uiStore } from '@/lib/ui';

/* ------------------------------------------------------------------ */
/* Pomocné komponenty pro texty výuky                                  */
/* ------------------------------------------------------------------ */

/** Inline kód. */
export function C({ children }: { children: ReactNode }) {
  return <code className="rounded bg-slate-800 px-1 py-px font-mono text-[12px] text-sky-200">{children}</code>;
}

/** Blok s příkazem. V tutoriálu jde spustit tlačítkem, u úkolů ne (ty si student píše sám). */
export function Cmd({ children, run }: { children: string; run?: boolean }) {
  return (
    <div className="my-2 flex items-start gap-2 rounded-md border border-slate-800 bg-slate-950 px-2.5 py-2">
      <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-[12px] leading-relaxed text-slate-200">{children}</pre>
      {run && (
        <button
          type="button"
          onClick={() => {
            uiStore.set({ mobileTab: 'terminal' });
            void terminalBridge.run(children);
          }}
          title="Spustit v terminálu"
          className="shrink-0 rounded border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-200 hover:bg-sky-500/25"
        >
          ▶ Vyzkoušet
        </button>
      )}
    </div>
  );
}

/** Ukázka souboru (Dockerfile, YAML…). */
export function Code({ children, title }: { children: string; title?: string }) {
  return (
    <div className="my-2 overflow-hidden rounded-md border border-slate-800 bg-slate-950">
      {title && <div className="border-b border-slate-800 px-2.5 py-1 font-mono text-[11px] text-slate-500">{title}</div>}
      <pre className="overflow-x-auto px-2.5 py-2 font-mono text-[12px] leading-relaxed text-slate-200">{children}</pre>
    </div>
  );
}

function Table({ rows, head }: { rows: Array<[ReactNode, ReactNode]>; head?: [string, string] }) {
  return (
    <table className="my-2 w-full border-collapse text-[12px]">
      {head && (
        <thead>
          <tr className="text-left text-slate-500">
            <th className="border-b border-slate-800 py-1 pr-2 font-medium">{head[0]}</th>
            <th className="border-b border-slate-800 py-1 font-medium">{head[1]}</th>
          </tr>
        </thead>
      )}
      <tbody>
        {rows.map(([a, b], i) => (
          <tr key={i} className="align-top">
            <td className="border-b border-slate-800/60 py-1.5 pr-3 whitespace-nowrap">{a}</td>
            <td className="border-b border-slate-800/60 py-1.5 text-slate-300">{b}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Tip({ children }: { children: ReactNode }) {
  return (
    <div className="my-2 rounded-md border border-amber-500/25 bg-amber-500/5 px-2.5 py-2 text-[12px] text-amber-100/90">
      💡 {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tutoriál                                                            */
/* ------------------------------------------------------------------ */

export interface TutorialStep {
  title: string;
  /** data-tour prvek, který se během kroku zvýrazní. */
  target?: string;
  body: ReactNode;
}

export const TUTORIAL: TutorialStep[] = [
  {
    title: 'Vítej v MiniDockeru 👋',
    body: (
      <>
        <p>
          MiniDocker je <b>Docker simulátor, který běží celý v tvém prohlížeči</b>. Napíšeš <C>Dockerfile</C>, sestavíš z
          něj image, spustíš kontejner a výslednou aplikaci hned uvidíš – bez instalace čehokoli.
        </p>
        <p>Výuka má dvě části:</p>
        <ol className="ml-4 list-decimal space-y-1">
          <li>
            <b>Tutoriál</b> (právě v něm jsi) – krok za krokem ti vysvětlí, co je Docker a jak se v aplikaci pracuje. U
            ukázek najdeš tlačítko <b>▶ Vyzkoušet</b>, které příkaz spustí za tebe.
          </li>
          <li>
            <b>Úkoly</b> – dostaneš zadání a musíš ho splnit <b>sám</b>: psát příkazy, upravovat soubory. Aplikace sama
            pozná, že je úkol hotový. Když se zasekneš, můžeš si odkrýt nápovědu.
          </li>
        </ol>
        <Tip>Mezi kroky se pohybuj tlačítky Další / Zpět. Postup se ukládá, takže můžeš kdykoli odejít a pokračovat.</Tip>
      </>
    ),
  },
  {
    title: 'Co je Docker?',
    body: (
      <>
        <p>
          Docker zabalí aplikaci <b>i se vším, co potřebuje ke spuštění</b> (runtime, knihovny, konfigurace) do jednoho
          balíčku. Ten pak běží stejně na tvém notebooku, u spolužáka i na serveru. Konec věty „u mě to funguje“.
        </p>
        <Table
          head={['Pojem', 'Co to je']}
          rows={[
            [<b key="d">Dockerfile</b>, 'Textový recept: z čeho vyjít, co zkopírovat, co nainstalovat a jak aplikaci spustit.'],
            [<b key="i">Image</b>, 'Hotový „zmrazený“ balíček sestavený podle receptu. Nedá se měnit, jen znovu sestavit.'],
            [<b key="c">Kontejner</b>, 'Spuštěná instance image – běžící proces s vlastním souborovým systémem. Z jednoho image můžeš spustit kontejnerů kolik chceš.'],
            [<b key="v">Vrstva</b>, 'Každá instrukce v Dockerfile vytvoří vrstvu. Nezměněné vrstvy se při dalším buildu vezmou z cache.'],
            [<b key="r">Registry</b>, 'Úložiště image (např. Docker Hub), odkud se stahují základní image jako node:20-alpine.'],
          ]}
        />
        <Tip>
          Přirovnání z programování: <b>image = třída</b>, <b>kontejner = objekt</b> (instance třídy).
        </Tip>
      </>
    ),
  },
  {
    title: 'Horní lišta',
    target: 'topbar',
    body: (
      <>
        <p>Nahoře najdeš rychlé akce. Každé tlačítko jen spustí odpovídající docker příkaz v terminálu, takže vždy vidíš, co se doopravdy děje.</p>
        <Table
          rows={[
            [<b key="t">Šablona</b>, 'Výběr ukázkového projektu: Node Express, statický web (nginx), Compose web + api. Načtení přepíše soubory projektu.'],
            [<b key="b">Build</b>, <>Sestaví image z <C>Dockerfile</C> v kořeni projektu.</>],
            [<b key="r">Run</b>, 'Build + spuštění kontejneru na pozadí s mapováním portu.'],
            [<b key="u">Compose Up / Down</b>, <>Spustí / zastaví celou sadu služeb z <C>docker-compose.yml</C>.</>],
            [<b key="z">Export ZIP</b>, 'Stáhne projekt – jde spustit i ve skutečném Dockeru.'],
            [<b key="x">Reset</b>, 'Smaže úplně vše: projekt, images, kontejnery, historii i postup ve výuce.'],
            [<b key="w">Kolečko vpravo</b>, 'Stav WebContaineru (virtuálního počítače). Zelená = můžeš stavět a spouštět.'],
          ]}
        />
      </>
    ),
  },
  {
    title: 'Průzkumník souborů',
    target: 'explorer',
    body: (
      <>
        <p>Vlevo jsou soubory projektu. Tohle je <b>build kontext</b> – soubory, které může Dockerfile zkopírovat do image.</p>
        <ul className="ml-4 list-disc space-y-1">
          <li>Ikonami nahoře vytvoříš nový soubor nebo složku (ve vybrané složce).</li>
          <li>
            Přejmenování: vyber položku a stiskni <C>F2</C> (nebo dvojklik). Smazání přes ikonu koše.
          </li>
          <li>Kliknutím na soubor ho otevřeš v editoru.</li>
        </ul>
        <p>
          Soubor <C>.dockerignore</C> funguje jako <C>.gitignore</C>: co je v něm, to se do image nezkopíruje (typicky{' '}
          <C>node_modules</C>).
        </p>
      </>
    ),
  },
  {
    title: 'Editor',
    target: 'editor',
    body: (
      <>
        <p>
          Uprostřed je editor Monaco (stejný jako ve VS Code). Zvýrazňuje syntaxi Dockerfile, YAML, JS, JSON, HTML i CSS a
          změny se ukládají automaticky.
        </p>
        <p>
          Chyby v <C>Dockerfile</C> a <C>docker-compose.yml</C> se <b>podtrhnou přímo v kódu</b> – najeď na ně myší a
          uvidíš, co je špatně (např. neznámá instrukce nebo nepodporovaný base image).
        </p>
      </>
    ),
  },
  {
    title: 'Dockerfile krok za krokem',
    target: 'editor',
    body: (
      <>
        <p>Šablona Node Express obsahuje tento Dockerfile. Projdi si, co každá řádka dělá:</p>
        <Code title="Dockerfile">{`FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]`}</Code>
        <Table
          head={['Instrukce', 'Význam']}
          rows={[
            [<C key="1">FROM</C>, 'Základní image, ze kterého vycházíš. Musí být první.'],
            [<C key="2">WORKDIR</C>, 'Pracovní složka uvnitř image (jako cd). Další příkazy běží v ní.'],
            [<C key="3">COPY src dst</C>, 'Zkopíruje soubory z build kontextu do image.'],
            [<C key="4">RUN</C>, 'Spustí příkaz během buildu (instalace závislostí, kompilace…).'],
            [<C key="5">ENV K=V</C>, 'Nastaví proměnnou prostředí pro build i běžící kontejner.'],
            [<C key="6">EXPOSE</C>, 'Dokumentuje, na kterém portu aplikace poslouchá.'],
            [<C key="7">CMD</C>, 'Výchozí příkaz, který se spustí při startu kontejneru.'],
            [<C key="8">ARG, ENTRYPOINT, LABEL, ADD</C>, 'Další podporované instrukce (argumenty buildu, pevný spouštěcí příkaz, metadata…).'],
          ]}
        />
        <Tip>
          Proč se nejdřív kopíruje jen <C>package*.json</C> a teprve potom zbytek? Vrstva s <C>npm install</C> se tak
          vezme z cache, dokud nezměníš závislosti – i když měníš kód.
        </Tip>
      </>
    ),
  },
  {
    title: 'Build: z Dockerfile image',
    target: 'tab-images',
    body: (
      <>
        <p>Image sestavíš příkazem:</p>
        <Cmd run>docker build -t express-app .</Cmd>
        <Table
          rows={[
            [<C key="t">-t express-app</C>, <>Název (tag) image. Bez dvojtečky se doplní <C>:latest</C>, verzi zadáš třeba <C>-t app:2.0</C>.</>],
            [<C key="d">.</C>, 'Build kontext – složka, ze které se kopírují soubory (tečka = kořen projektu).'],
            [<C key="f">-f cesta</C>, 'Jiný Dockerfile než ./Dockerfile.'],
            [<C key="n">--no-cache</C>, 'Postaví vše znovu, bez cache.'],
          ]}
        />
        <p>
          V terminálu uvidíš jednotlivé kroky (<C>Step 1/8</C>…). Když build spustíš podruhé bez změn, u kroků se objeví{' '}
          <C>---&gt; Using cache</C>. Hotový image se objeví v záložce <b>Images</b> – rozklikni „Zobrazit vrstvy“.
        </p>
      </>
    ),
  },
  {
    title: 'Run: z image kontejner',
    target: 'tab-containers',
    body: (
      <>
        <p>Kontejner spustíš příkazem:</p>
        <Cmd run>docker run -d -p 8080:3000 --name ukazka express-app</Cmd>
        <Table
          head={['Přepínač', 'Význam']}
          rows={[
            [<C key="d">-d</C>, 'Detached – kontejner běží na pozadí a terminál zůstane volný.'],
            [<C key="p">-p 8080:3000</C>, <>Mapování portu <b>hostitel:kontejner</b>. Aplikace v kontejneru poslouchá na 3000, zvenku je na 8080.</>],
            [<C key="n">--name ukazka</C>, 'Vlastní jméno kontejneru (jinak dostane náhodné, např. brave_turing).'],
            [<C key="e">-e KLÍČ=hodnota</C>, 'Proměnná prostředí (přepíše ENV z Dockerfile).'],
            [<C key="r">--rm</C>, 'Po ukončení se kontejner sám smaže.'],
            [<C key="i">-it</C>, 'Interaktivní režim s terminálem.'],
          ]}
        />
        <p>
          Kontejner se objeví v záložce <b>Kontejnery</b>. Tlačítka na kartě umí Stop/Start, Restart, Logy, Otevřít a
          Smazat.
        </p>
      </>
    ),
  },
  {
    title: 'Prohlížeč',
    target: 'tab-browser',
    body: (
      <>
        <p>
          Jakmile server v kontejneru začne poslouchat, otevře se automaticky v záložce <b>Prohlížeč</b>. Funguje jako
          malý prohlížeč: adresní řádek, zpět, obnovit a otevření v novém okně.
        </p>
        <p>
          Do adresy můžeš psát i relativní cesty, třeba <C>/api/info</C>. Nad stránkou jsou přepínače mezi všemi
          běžícími kontejnery.
        </p>
        <Tip>
          Mapování <C>-p 8080:3000</C> se v MiniDockeru jen zobrazuje. Skutečnou adresu přidělí WebContainer – proto
          aplikace má poslouchat na <C>process.env.PORT</C>.
        </Tip>
      </>
    ),
  },
  {
    title: 'Terminál',
    target: 'terminal',
    body: (
      <>
        <p>Dole je terminál, ve kterém budeš při úkolech pracovat nejvíc.</p>
        <Table
          rows={[
            [<C key="h">↑ / ↓</C>, 'Procházení historie příkazů.'],
            [<C key="t">Tab</C>, 'Doplnění příkazu, názvu kontejneru nebo image.'],
            [<C key="c">Ctrl+C</C>, <>Přeruší běžící příkaz (např. <C>docker logs -f</C>).</>],
            [<C key="l">clear</C>, 'Vyčistí obrazovku.'],
            [<C key="x">help</C>, 'Seznam podporovaných docker příkazů.'],
            [<C key="s">ls, cat, cd, node, npm…</C>, <>Ostatní příkazy běží v shellu <C>jsh</C> nad soubory projektu.</>],
          ]}
        />
        <p>Zkus si vypsat nápovědu:</p>
        <Cmd run>help</Cmd>
      </>
    ),
  },
  {
    title: 'Správa kontejnerů a image',
    target: 'terminal',
    body: (
      <>
        <p>Nejčastější příkazy, které budeš v úkolech potřebovat:</p>
        <Table
          head={['Příkaz', 'Co dělá']}
          rows={[
            [<C key="1">docker ps</C>, <>Běžící kontejnery (<C>-a</C> i zastavené, <C>-q</C> jen ID).</>],
            [<C key="2">docker images</C>, 'Seznam image.'],
            [<C key="3">docker logs [-f] jméno</C>, <>Výstup aplikace v kontejneru (<C>-f</C> = sledovat živě).</>],
            [<C key="4">docker exec jméno příkaz</C>, <>Spustí příkaz uvnitř běžícího kontejneru, např. <C>ls</C>.</>],
            [<C key="5">docker stop / start / restart</C>, 'Zastaví, znovu spustí nebo restartuje kontejner.'],
            [<C key="6">docker rm [-f] jméno</C>, <>Smaže kontejner (běžící jen s <C>-f</C>).</>],
            [<C key="7">docker rmi image</C>, 'Smaže image.'],
            [<C key="8">docker history image</C>, 'Vrstvy image a jejich velikost.'],
            [<C key="9">docker inspect objekt</C>, 'Všechny detaily kontejneru nebo image v JSON.'],
            [<C key="10">docker tag zdroj cíl</C>, 'Další název pro existující image.'],
          ]}
        />
        <Cmd run>docker ps -a</Cmd>
      </>
    ),
  },
  {
    title: 'Docker Compose',
    body: (
      <>
        <p>
          Reálné aplikace mají víc částí (web, API, databáze). <b>Docker Compose</b> je popíše v jednom souboru{' '}
          <C>docker-compose.yml</C> a spustí jedním příkazem.
        </p>
        <Code title="docker-compose.yml">{`services:
  api:
    build: ./api          # složka s Dockerfile
    environment:
      - GREETING=Ahoj
  web:
    build: ./web
    ports:
      - "8080:3000"       # hostitel:kontejner
    environment:
      - API_URL=http://api:4000
    depends_on:
      - api               # web startuje až po api`}</Code>
        <Table
          head={['Příkaz', 'Co dělá']}
          rows={[
            [<C key="1">docker compose up -d</C>, <>Sestaví a spustí všechny služby (<C>--build</C> vynutí nový build).</>],
            [<C key="2">docker compose ps</C>, 'Kontejnery tohoto compose projektu.'],
            [<C key="3">docker compose logs</C>, 'Logy všech služeb najednou.'],
            [<C key="4">docker compose down</C>, <>Zastaví a smaže kontejnery (<C>--rmi all</C> i image).</>],
            [<C key="5">docker compose config</C>, 'Zkontroluje a vypíše výslednou konfiguraci.'],
          ]}
        />
        <p>
          Služby se mezi sebou najdou podle jména – <C>http://api:4000</C> funguje jako DNS. Hotový příklad je v šabloně{' '}
          <b>Compose web + api</b>.
        </p>
      </>
    ),
  },
  {
    title: 'Co MiniDocker neumí',
    body: (
      <>
        <p>Je to simulátor, takže má pár omezení:</p>
        <ul className="ml-4 list-disc space-y-1">
          <li>
            Podporované base image jsou <C>node:*</C>, <C>nginx:*</C> a <C>httpd:*</C>. Python, Go a další nejdou.
          </li>
          <li>
            <C>RUN apk …</C> nebo <C>apt-get …</C> se přeskočí se žlutým varováním; <C>npm</C> a shellové příkazy se
            spustí doopravdy.
          </li>
          <li>Volumes jsou jen informativní, multi-stage buildy nejsou podporované.</li>
          <li>Funguje nejlépe v Chrome nebo Edge.</li>
        </ul>
        <p>Všechno, co se tu naučíš (příkazy, Dockerfile, compose), ale platí i pro skutečný Docker.</p>
      </>
    ),
  },
  {
    title: 'Hotovo – jdeme na úkoly! 🎯',
    target: 'tab-learn',
    body: (
      <>
        <p>Teď je řada na tobě. Čeká tě sada úkolů od jednoduchých po náročnější:</p>
        <ul className="ml-4 list-disc space-y-1">
          <li>build a spuštění kontejneru, porty, logy, exec,</li>
          <li>proměnné prostředí a úpravy Dockerfile,</li>
          <li>vlastní Dockerfile od nuly, statický web, Docker Compose.</li>
        </ul>
        <p>
          U úkolů už <b>žádné tlačítko „Vyzkoušet“ není</b> – příkazy píšeš do terminálu sám. Aktuální úkol uvidíš i v
          liště nahoře, a jakmile ho splníš, aplikace ti to hned oznámí.
        </p>
        <Tip>Tutoriál si můžeš kdykoli zopakovat přepínačem „Tutoriál“ v záložce Výuka.</Tip>
      </>
    ),
  },
];

/* ------------------------------------------------------------------ */
/* Úkoly                                                               */
/* ------------------------------------------------------------------ */

export interface Task {
  id: string;
  title: string;
  level: 1 | 2 | 3;
  goal: ReactNode;
  hints: ReactNode[];
  /** Automatická kontrola nad stavem aplikace. */
  check?: (ctx: TaskContext) => boolean;
  /** Úkol s odpovědí – vrací true, nebo text chyby. */
  answer?: { label: string; verify: (value: string, ctx: TaskContext) => true | string };
  /** Krátké vysvětlení zobrazené po splnění. */
  learned?: ReactNode;
}

const running = (ctx: TaskContext, name: string) => ctx.container(name)?.status === 'running';
const hasPort = (ctx: TaskContext, name: string, host: number, container: number) =>
  !!ctx.container(name)?.ports.some((p) => p.host === host && p.container === container);
const fromImage = (ctx: TaskContext, ref: string) => {
  const img = ctx.image(ref);
  return img ? ctx.containers.filter((ct) => ct.imageId === img.id) : [];
};

export const TASKS: Task[] = [
  {
    id: 'build',
    title: 'První image',
    level: 1,
    goal: (
      <>
        <p>
          Načti šablonu <b>Node Express</b> (pokud ji nemáš) a sestav z ní image s názvem <C>moje-app</C>.
        </p>
        <p className="text-slate-400">Použij terminál, ne tlačítko Build – to by image pojmenovalo jinak.</p>
      </>
    ),
    hints: [
      <>Image se staví příkazem <C>docker build</C>. Název se zadává přepínačem <C>-t</C>.</>,
      <>Nezapomeň na build kontext na konci příkazu – kořen projektu je <C>.</C></>,
    ],
    check: (ctx) => !!ctx.image('moje-app'),
    learned: <>Image <C>moje-app:latest</C> je v záložce Images. Tag <C>:latest</C> se doplnil sám.</>,
  },
  {
    id: 'run',
    title: 'Spusť kontejner',
    level: 1,
    goal: (
      <>
        <p>
          Spusť z image <C>moje-app</C> kontejner na pozadí. Musí se jmenovat <C>web</C> a port <C>3000</C> z kontejneru
          namapuj na port <C>8080</C> hostitele.
        </p>
        <p className="text-slate-400">Potom si aplikaci prohlédni v záložce Prohlížeč.</p>
      </>
    ),
    hints: [
      <>Kontejner se spouští příkazem <C>docker run</C>, na pozadí běží s <C>-d</C>.</>,
      <>Jméno nastavíš přes <C>--name</C>, port přes <C>-p hostitel:kontejner</C>.</>,
      <>Název image patří až na konec, za všechny přepínače.</>,
    ],
    check: (ctx) => running(ctx, 'web') && hasPort(ctx, 'web', 8080, 3000) && ctx.imageOf(ctx.container('web')!)?.repoTags.includes('moje-app:latest') === true,
    learned: <>Z jednoho image můžeš takhle spustit libovolně kontejnerů – každý potřebuje jiné jméno a jiný hostitelský port.</>,
  },
  {
    id: 'ps-id',
    title: 'Najdi ID kontejneru',
    level: 1,
    goal: (
      <>
        <p>
          Každý kontejner má unikátní ID. Vypiš si v terminálu běžící kontejnery a do pole níže napiš <b>ID kontejneru{' '}
          <C>web</C></b> (stačí zkrácené ID, jak ho ukazuje výpis).
        </p>
      </>
    ),
    hints: [
      <>Běžící kontejnery vypíše <C>docker ps</C>.</>,
      <>ID je první sloupec výpisu (<C>CONTAINER ID</C>).</>,
    ],
    answer: {
      label: 'ID kontejneru web',
      verify: (value, ctx) => {
        const ct = ctx.container('web');
        if (!ct) return 'Kontejner web neexistuje – vrať se k předchozímu úkolu.';
        const v = value.trim().toLowerCase();
        if (v.length < 4) return 'Napiš aspoň 4 znaky ID.';
        return ct.id.startsWith(v) ? true : 'To není ID kontejneru web. Zkontroluj výpis docker ps.';
      },
    },
    learned: <>Místo jména můžeš v příkazech používat i ID – stačí jeho začátek, pokud je jednoznačný.</>,
  },
  {
    id: 'logs',
    title: 'Co píše aplikace?',
    level: 1,
    goal: (
      <>
        <p>
          Otevři aplikaci v Prohlížeči a pár stránek načti (třeba <C>/api/info</C>). Pak si <b>v terminálu</b> vypiš logy
          kontejneru <C>web</C>.
        </p>
      </>
    ),
    hints: [<>Logy vypíše <C>docker logs</C> následovaný jménem kontejneru.</>, <>S přepínačem <C>-f</C> se logy sledují živě, ukončíš to Ctrl+C.</>],
    check: (ctx) => ctx.ran(/^docker (container )?logs\b.*\bweb\b/),
    learned: <>Logy jsou standardní výstup procesu v kontejneru – vše, co aplikace vypíše přes <C>console.log</C>.</>,
  },
  {
    id: 'exec',
    title: 'Nahlédni dovnitř',
    level: 2,
    goal: (
      <>
        <p>
          Spusť <b>uvnitř běžícího kontejneru</b> <C>web</C> příkaz <C>ls</C>, který vypíše soubory v jeho pracovní složce.
        </p>
        <p className="text-slate-400">Všimni si, že tam chybí soubory z .dockerignore.</p>
      </>
    ),
    hints: [<>Příkaz v běžícím kontejneru spustíš přes <C>docker exec</C>.</>, <>Pořadí je: <C>docker exec</C> jméno-kontejneru příkaz.</>],
    check: (ctx) => ctx.ran(/^docker (container )?exec\b.*\bweb\b.*\bls\b/),
    learned: <>Pracovní složka je ta z <C>WORKDIR</C> v Dockerfile, tedy <C>/app</C>.</>,
  },
  {
    id: 'stop-rm',
    title: 'Úklid kontejneru',
    level: 1,
    goal: (
      <>
        <p>
          Kontejner <C>web</C> nejdřív <b>zastav</b> a potom ho <b>smaž</b>. Použij dva samostatné příkazy (bez přepínače{' '}
          <C>-f</C>).
        </p>
      </>
    ),
    hints: [
      <>Zastavení: <C>docker stop</C>, smazání: <C>docker rm</C>.</>,
      <>Běžící kontejner bez <C>-f</C> smazat nejde – proto ho nejdřív zastav.</>,
    ],
    check: (ctx) =>
      !ctx.container('web') && ctx.ran(/^docker (container )?stop\b.*\bweb\b/) && ctx.ran(/^docker (container )?rm\b(?!.*(-f|--force)\b).*\bweb\b/),
    learned: <>Zastavený kontejner (<C>docker ps -a</C>) jde znovu spustit přes <C>docker start</C>, smazaný už ne.</>,
  },
  {
    id: 'env',
    title: 'Proměnné prostředí',
    level: 2,
    goal: (
      <>
        <p>
          Spusť z <C>moje-app</C> nový kontejner na pozadí se jménem <C>staging</C> a portem <C>8081:3000</C>. Proměnnou{' '}
          <C>NODE_ENV</C> nastav na hodnotu <C>staging</C>.
        </p>
        <p className="text-slate-400">V prohlížeči pak ověř, že stránka ukazuje NODE_ENV = staging.</p>
      </>
    ),
    hints: [
      <>Proměnnou prostředí předáš přepínačem <C>-e KLÍČ=hodnota</C>.</>,
      <>V Dockerfile je <C>ENV NODE_ENV=production</C> – hodnota z <C>-e</C> ji při spuštění přepíše.</>,
    ],
    check: (ctx) => running(ctx, 'staging') && hasPort(ctx, 'staging', 8081, 3000) && ctx.container('staging')!.env.NODE_ENV === 'staging',
    learned: <>Stejný image tak může běžet jako vývojový, testovací i produkční – liší se jen konfigurací.</>,
  },
  {
    id: 'version',
    title: 'Nová verze image',
    level: 2,
    goal: (
      <>
        <p>
          Uprav <C>Dockerfile</C>: přidej proměnnou prostředí <C>APP_VERSION</C> s hodnotou <C>2.0</C>. Pak sestav image
          s názvem <C>moje-app</C> a tagem <C>2.0</C>.
        </p>
      </>
    ),
    hints: [
      <>Proměnná se v Dockerfile nastavuje instrukcí <C>ENV</C>, stejně jako NODE_ENV.</>,
      <>Tag se píše za dvojtečku: <C>-t název:tag</C>.</>,
    ],
    check: (ctx) => ctx.image('moje-app:2.0')?.config.env.APP_VERSION === '2.0',
    learned: <>Teď máš dvě verze: <C>moje-app:latest</C> a <C>moje-app:2.0</C>. Starou verzi můžeš kdykoli spustit znovu.</>,
  },
  {
    id: 'layers',
    title: 'Kolik má vrstev?',
    level: 2,
    goal: (
      <>
        <p>
          Zjisti, <b>kolik vrstev</b> má image <C>moje-app:2.0</C>, a napiš číslo do pole níže.
        </p>
      </>
    ),
    hints: [<>Vrstvy ukáže příkaz <C>docker history</C>, nebo karta image v záložce Images.</>, <>Každá instrukce Dockerfile = jedna vrstva (včetně FROM).</>],
    answer: {
      label: 'Počet vrstev',
      verify: (value, ctx) => {
        const img = ctx.image('moje-app:2.0');
        if (!img) return 'Image moje-app:2.0 neexistuje – vrať se k předchozímu úkolu.';
        if (!/^\d+$/.test(value.trim())) return 'Napiš jen číslo.';
        return Number(value) === img.layers.length ? true : 'Tohle nesedí. Spočítej řádky ve výpisu docker history.';
      },
    },
    learned: <>Když změníš jen <C>server.js</C>, při buildu se přestaví jen vrstvy od <C>COPY . .</C> dál. Zbytek je z cache.</>,
  },
  {
    id: 'hello',
    title: 'Vlastní Dockerfile od nuly',
    level: 3,
    goal: (
      <>
        <p>
          Vytvoř složku <C>hello</C> a v ní:
        </p>
        <ul className="ml-4 list-disc">
          <li>
            <C>server.js</C> – HTTP server (modul <C>http</C>, bez npm balíčků), který na portu <C>process.env.PORT</C>{' '}
            vrací text „Ahoj z mého kontejneru“,
          </li>
          <li>
            <C>Dockerfile</C> – na bázi <C>node:20-alpine</C>, který server zkopíruje a spustí.
          </li>
        </ul>
        <p>
          Sestav image <C>hello</C> (build kontext je složka <C>hello</C>) a spusť z něj kontejner na pozadí. Server musí
          opravdu běžet.
        </p>
      </>
    ),
    hints: [
      <>
        Server: <C>require(&apos;http&apos;).createServer((req, res) =&gt; res.end(&apos;…&apos;)).listen(process.env.PORT || 3000)</C>
      </>,
      <>Dockerfile potřebuje aspoň FROM, WORKDIR, COPY a CMD. Inspiruj se tím v kořeni projektu.</>,
      <>
        Build kontext je poslední argument <C>docker build</C> – místo tečky napiš cestu ke složce.
      </>,
    ],
    check: (ctx) =>
      'hello/Dockerfile' in ctx.files &&
      'hello/server.js' in ctx.files &&
      ctx.image('hello')?.config.runtime === 'node' &&
      fromImage(ctx, 'hello').some((ct) => ct.status === 'running' && !!ct.url),
    learned: <>Napsal jsi kompletní Dockerfile sám. Přesně takhle se kontejnerizují i skutečné aplikace.</>,
  },
  {
    id: 'static',
    title: 'Statický web v nginx',
    level: 3,
    goal: (
      <>
        <p>
          Vytvoř složku <C>site</C> s vlastní stránkou <C>index.html</C> a <C>Dockerfile</C>, který vychází z{' '}
          <C>nginx:alpine</C> a zkopíruje stránku tam, odkud ji nginx servíruje. Sestav image <C>site</C> a spusť ho na
          pozadí.
        </p>
      </>
    ),
    hints: [
      <>nginx servíruje soubory ze složky <C>/usr/share/nginx/html</C>.</>,
      <>Stačí dvě instrukce: <C>FROM</C> a <C>COPY</C>. CMD ani WORKDIR nepotřebuješ – nginx ho už má.</>,
      <>nginx poslouchá v kontejneru na portu <C>80</C>.</>,
    ],
    check: (ctx) =>
      'site/index.html' in ctx.files &&
      ctx.image('site')?.config.runtime === 'static' &&
      fromImage(ctx, 'site').some((ct) => ct.status === 'running'),
    learned: <>Pro statický web nepotřebuješ žádný kód serveru – stačí hotový image webového serveru a tvoje soubory.</>,
  },
  {
    id: 'compose',
    title: 'Docker Compose',
    level: 3,
    goal: (
      <>
        <p>
          V kořeni projektu vytvoř <C>docker-compose.yml</C> se dvěma službami:
        </p>
        <ul className="ml-4 list-disc">
          <li>
            <C>hello</C> – build ze složky <C>hello</C>, port <C>8082:3000</C>,
          </li>
          <li>
            <C>site</C> – build ze složky <C>site</C>, port <C>8083:80</C>, startuje až po službě <C>hello</C>.
          </li>
        </ul>
        <p>Obě služby spusť jedním příkazem na pozadí.</p>
      </>
    ),
    hints: [
      <>
        Soubor začíná klíčem <C>services:</C>, pod ním jsou jména služeb a jejich <C>build</C>, <C>ports</C>,{' '}
        <C>depends_on</C>.
      </>,
      <>Pozor na odsazení v YAML – používej mezery, ne tabulátory. Chyby uvidíš podtržené v editoru.</>,
      <>
        Spuštění: <C>docker compose up</C> s přepínačem pro běh na pozadí. Konfiguraci zkontroluje{' '}
        <C>docker compose config</C>.
      </>,
    ],
    check: (ctx) => {
      const hello = ctx.containers.find((ct) => ct.compose?.service === 'hello' && ct.status === 'running');
      const site = ctx.containers.find((ct) => ct.compose?.service === 'site' && ct.status === 'running');
      return !!hello && !!site && hello.compose!.project === site.compose!.project && hello.ports.some((p) => p.host === 8082) && site.ports.some((p) => p.host === 8083);
    },
    learned: <>Jeden soubor, jeden příkaz a běží celá aplikace. Pořadí startu určilo <C>depends_on</C>.</>,
  },
  {
    id: 'cleanup',
    title: 'Velký úklid',
    level: 2,
    goal: (
      <>
        <p>Na závěr po sobě ukliď:</p>
        <ul className="ml-4 list-disc">
          <li>zastav a odstraň compose služby,</li>
          <li>smaž všechny ostatní kontejnery (i zastavené),</li>
          <li>
            smaž image <C>moje-app:2.0</C>.
          </li>
        </ul>
        <p className="text-slate-400">Hotovo je, když <C>docker ps -a</C> nic nevypíše.</p>
      </>
    ),
    hints: [
      <>Compose služby uklidí <C>docker compose down</C>.</>,
      <>Běžící kontejner smažeš rovnou pomocí <C>docker rm -f</C>. Seznam všech ID dá <C>docker ps -aq</C>.</>,
      <>Image se maže příkazem <C>docker rmi</C>.</>,
    ],
    check: (ctx) => ctx.containers.length === 0 && !ctx.image('moje-app:2.0') && ctx.ran(/^docker compose\b.*\bdown\b/),
    learned: <>Gratuluju, zvládl jsi celý kurz MiniDockeru! 🎉</>,
  },
];
