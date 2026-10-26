'use client';

import type { ReactNode } from 'react';
import type { TaskContext } from '@/lib/learn';
import type { MobileTab, RightTab, WcStatus } from '@/lib/ui';
import { C } from './learnContent';

export interface TourContext extends TaskContext {
  active: string | null;
  template: string;
  wc: WcStatus;
}

export interface TourStep {
  /** data-tour prvek, na který krok ukazuje (bez cíle = karta uprostřed). */
  target?: string;
  title: string;
  body: ReactNode;
  /** Co se má přepnout, aby byl cíl vidět. */
  rightTab?: RightTab;
  mobileTab?: MobileTab;
  /** Krok, který uživatel musí udělat sám – Další se odemkne až po splnění. */
  todo?: { label: ReactNode; done: (ctx: TourContext) => boolean };
  /** Krok potřebuje běžící WebContainer. */
  needsDocker?: boolean;
}

export const TOUR: TourStep[] = [
  {
    title: 'Vítej v MiniDockeru 👋',
    body: (
      <>
        <p>
          MiniDocker je virtuální <b>Docker v prohlížeči</b>. Napíšeš Dockerfile, sestavíš image, spustíš kontejner a
          aplikaci hned uvidíš.
        </p>
        <p>
          Teď tě provedu celou aplikací. U některých kroků budeš muset <b>něco udělat sám</b> – tlačítko Další se
          odemkne, až to splníš. Na konci dostaneš úkoly.
        </p>
      </>
    ),
  },
  {
    target: 'status',
    title: 'Stav virtuálního počítače',
    body: (
      <>
        <p>
          Docker tu běží ve <b>WebContaineru</b> – malém počítači s Node.js uvnitř prohlížeče. Kolečko ukazuje jeho stav:
        </p>
        <p>
          🟡 spouští se · 🟢 běží, můžeš stavět a spouštět · 🔴 chyba (použij Chrome nebo Edge)
        </p>
      </>
    ),
  },
  {
    target: 'template',
    title: 'Šablony projektů',
    body: (
      <>
        <p>Tady vybíráš ukázkový projekt: Node Express, statický web (nginx) nebo Compose web + api.</p>
        <p>Načtení šablony přepíše soubory projektu (images a kontejnery zůstanou).</p>
      </>
    ),
    todo: {
      label: (
        <>
          Vyber šablonu <b>Node Express</b>.
        </>
      ),
      done: (ctx) => ['Dockerfile', 'server.js', 'package.json'].every((f) => f in ctx.files),
    },
  },
  {
    target: 'explorer',
    mobileTab: 'files',
    title: 'Průzkumník souborů',
    body: (
      <>
        <p>
          Soubory projektu. Pro Docker je to <b>build kontext</b> – odsud může Dockerfile kopírovat soubory do image.
        </p>
        <p>
          <C>server.js</C> je webová aplikace, <C>package.json</C> její závislosti a <C>Dockerfile</C> recept, jak z ní
          udělat image.
        </p>
      </>
    ),
    todo: {
      label: (
        <>
          Klikni na soubor <C>server.js</C> a podívej se na aplikaci.
        </>
      ),
      done: (ctx) => ctx.active === 'server.js',
    },
  },
  {
    target: 'editor',
    title: 'Editor a Dockerfile',
    body: (
      <>
        <p>
          V editoru se soubory ukládají samy. <C>server.js</C> je malá Express aplikace, která poslouchá na portu z{' '}
          <C>process.env.PORT</C>. Teď se podívej na recept, jak z ní udělat image – <C>Dockerfile</C>:
        </p>
        <ul className="ml-4 list-disc space-y-0.5">
          <li>
            <C>FROM</C> – z jakého image vycházíme
          </li>
          <li>
            <C>WORKDIR</C> – pracovní složka uvnitř image
          </li>
          <li>
            <C>COPY</C> – zkopíruje soubory z projektu do image
          </li>
          <li>
            <C>RUN</C> – spustí příkaz při buildu (npm install)
          </li>
          <li>
            <C>ENV</C>, <C>EXPOSE</C> – proměnné prostředí a port
          </li>
          <li>
            <C>CMD</C> – co se spustí při startu kontejneru
          </li>
        </ul>
        <p>Chyby v Dockerfile se podtrhnou přímo v kódu.</p>
      </>
    ),
    todo: {
      label: (
        <>
          Otevři v průzkumníku soubor <C>Dockerfile</C>.
        </>
      ),
      done: (ctx) => ctx.active === 'Dockerfile',
    },
  },
  {
    target: 'explorer-actions',
    mobileTab: 'files',
    title: 'Nové soubory a složky',
    body: (
      <>
        <p>Těmito ikonami vytvoříš nový soubor nebo složku (ve složce, kterou máš vybranou).</p>
        <p>
          Přejmenování: vyber položku a stiskni <C>F2</C>. Smazání: ikona koše vedle položky nebo klávesa Delete.
        </p>
      </>
    ),
  },
  {
    target: 'build',
    title: 'Build: sestavení image',
    needsDocker: true,
    body: (
      <>
        <p>
          Tlačítko <b>Build</b> spustí v terminálu <C>docker build -t express-app .</C> – podle Dockerfile sestaví{' '}
          <b>image</b>, tedy hotový balíček aplikace se vším, co potřebuje.
        </p>
      </>
    ),
    todo: {
      label: (
        <>
          Klikni na <b>Build</b> a počkej, až build doběhne.
        </>
      ),
      done: (ctx) => ctx.ran(/^docker build\b/),
    },
  },
  {
    target: 'terminal',
    mobileTab: 'terminal',
    title: 'Terminál',
    body: (
      <>
        <p>
          Všechno, co tlačítka dělají, vidíš tady jako docker příkazy. Build vypsal kroky <C>Step 1/8</C>… – každá
          instrukce Dockerfile je jedna <b>vrstva</b>.
        </p>
        <p>
          Když build pustíš znovu bez změn, uvidíš <C>---&gt; Using cache</C>: nezměněné vrstvy se nestaví znovu.
        </p>
      </>
    ),
  },
  {
    target: 'docker-panel',
    rightTab: 'images',
    mobileTab: 'docker',
    title: 'Záložka Images',
    body: (
      <>
        <p>
          Tady jsou všechny sestavené image: název, velikost, počet vrstev a port z <C>EXPOSE</C>. Odkaz „Zobrazit
          vrstvy“ ukáže, z čeho se image skládá.
        </p>
        <p>Tlačítkem Run spustíš z image kontejner, košem image smažeš.</p>
      </>
    ),
  },
  {
    target: 'run',
    title: 'Run: spuštění kontejneru',
    needsDocker: true,
    body: (
      <>
        <p>
          <b>Kontejner</b> je běžící instance image. Tlačítko <b>Run</b> spustí{' '}
          <C>docker run -d -p 8080:3000 --name express-app express-app</C>.
        </p>
        <p>
          <C>-d</C> = na pozadí, <C>-p 8080:3000</C> = port hostitele : port v kontejneru, <C>--name</C> = jméno.
        </p>
      </>
    ),
    todo: {
      label: (
        <>
          Klikni na <b>Run</b>.
        </>
      ),
      done: (ctx) => ctx.ran(/^docker run\b/),
    },
  },
  {
    target: 'docker-panel',
    rightTab: 'containers',
    mobileTab: 'docker',
    title: 'Záložka Kontejnery',
    body: (
      <>
        <p>Každý kontejner má kartu se stavem (running / exited), image a porty.</p>
        <p>
          Tlačítka: <b>Stop/Start</b>, <b>Restart</b>, <b>Logy</b> (výstup aplikace), <b>Otevřít</b> (v prohlížeči) a{' '}
          <b>Smazat</b>.
        </p>
      </>
    ),
  },
  {
    target: 'docker-panel',
    rightTab: 'browser',
    mobileTab: 'docker',
    title: 'Záložka Prohlížeč',
    body: (
      <>
        <p>
          Jakmile aplikace v kontejneru naběhne, otevře se tady. Má adresní řádek (zkus <C>/api/info</C>), zpět, obnovit a
          otevření v novém okně.
        </p>
        <p>Nahoře přepínáš mezi všemi běžícími kontejnery.</p>
      </>
    ),
  },
  {
    target: 'terminal',
    mobileTab: 'terminal',
    title: 'Teď ty: první příkaz',
    needsDocker: true,
    body: (
      <>
        <p>Docker se hlavně ovládá z terminálu. Zkus si vypsat běžící kontejnery.</p>
        <p className="text-slate-400">
          Tipy: <C>↑/↓</C> historie, <C>Tab</C> doplní název, <C>Ctrl+C</C> přeruší, <C>help</C> vypíše všechny příkazy.
        </p>
      </>
    ),
    todo: {
      label: (
        <>
          Klikni do terminálu, napiš <C>docker ps</C> a stiskni Enter.
        </>
      ),
      done: (ctx) => ctx.ran(/^docker (container )?(ps|ls)\b/),
    },
  },
  {
    target: 'terminal',
    mobileTab: 'terminal',
    title: 'Zastav kontejner',
    needsDocker: true,
    body: (
      <>
        <p>
          Kontejner se zastavuje příkazem <C>docker stop</C> a jménem kontejneru. Zastavený kontejner zůstane v{' '}
          <C>docker ps -a</C> a jde znovu spustit přes <C>docker start</C>.
        </p>
      </>
    ),
    todo: {
      label: (
        <>
          Napiš <C>docker stop express-app</C>.
        </>
      ),
      done: (ctx) => ctx.ran(/^docker (container )?stop\b/),
    },
  },
  {
    target: 'compose',
    title: 'Docker Compose',
    body: (
      <>
        <p>
          Aplikace z více částí (web + API + databáze) se popisují v <C>docker-compose.yml</C>. <b>Compose Up</b> je
          všechny sestaví a spustí, <b>Compose Down</b> je zastaví a smaže.
        </p>
        <p>Ukázku najdeš v šabloně „Compose web + api“.</p>
      </>
    ),
  },
  {
    target: 'export',
    title: 'Export ZIP',
    body: <p>Stáhne celý projekt. Ten jde spustit i ve skutečném Dockeru na tvém počítači.</p>,
  },
  {
    target: 'reset',
    title: 'Reset',
    body: (
      <p>
        Smaže <b>úplně všechno</b>: soubory, images, kontejnery, historii i postup ve výuce. Používej opatrně.
      </p>
    ),
  },
  {
    target: 'docker-panel',
    rightTab: 'learn',
    mobileTab: 'docker',
    title: 'Výuka',
    body: (
      <>
        <p>
          Záložka <b>Výuka</b> má dvě části: <b>Příručku</b> (všechny pojmy a příkazy, k přečtení kdykoli) a <b>Úkoly</b>.
        </p>
        <p>Prohlídku si odtud můžeš kdykoli pustit znovu.</p>
      </>
    ),
  },
  {
    title: 'Teď je řada na tobě 🎯',
    body: (
      <>
        <p>Prohlídka je hotová. Čekají tě úkoly – od jednoduchých po vlastní Dockerfile a Docker Compose.</p>
        <p>
          Plníš je <b>sám</b>: píšeš příkazy do terminálu a upravuješ soubory. Aplikace sama pozná, že je úkol hotový.
          Když se zasekneš, odkryj si nápovědu.
        </p>
      </>
    ),
  },
];
