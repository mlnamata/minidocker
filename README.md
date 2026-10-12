# 🐳 MiniDocker – virtuální Docker v prohlížeči

MiniDocker je jednoduchý Docker simulátor, který běží **celý v prohlížeči**. Napíšete `Dockerfile`
a `docker-compose.yml`, sestavíte image, spustíte kontejner a běžící aplikaci otevřete
v zabudovaném prohlížeči. Žádný backend: Node.js běží přímo ve stránce díky
[WebContainers](https://webcontainers.io).

- **Průzkumník souborů**: vytvoření, přejmenování (F2) a smazání souborů i složek
- **Monaco editor**: zvýraznění Dockerfile/YAML/JS/JSON/HTML/CSS, chyby podtržené přímo v kódu
- **Images / Kontejnery / Prohlížeč**: přehled images (vrstvy, velikost), správa kontejnerů, náhled aplikace
- **Terminál (xterm.js)**: simulované docker CLI, historie (↑/↓), doplňování (Tab), Ctrl+C; ostatní příkazy běží v `jsh`
- **Cache vrstev**: nezměněné instrukce se nespouští znovu (` ---> Using cache`)
- **Docker Compose**: `depends_on` (topologické řazení, detekce cyklu), porty, ENV, „DNS“ mezi službami
- **Perzistence**: projekt, images i kontejnery se ukládají do IndexedDB a obnoví se po reloadu
- **Export ZIP**: projekt jde spustit i ve skutečném Dockeru

## Rychlý start

Potřebujete Node.js 18.18+ (doporučeno 20+) a Chrome, Edge nebo jiný Chromium prohlížeč.

```bash
npm install
npm run dev
```

Otevřete <http://localhost:3000>. Při `npm install` se Monaco editor zkopíruje do `public/monaco`
(skript `scripts/copy-monaco.mjs`), aby se načítal ze stejného originu.

Produkční build:

```bash
npm run build
npm start
```

## Nasazení na Vercel

1. Pushněte repozitář na GitHub:
   ```bash
   git init
   git add .
   git commit -m "MiniDocker"
   git branch -M main
   git remote add origin https://github.com/<uzivatel>/minidocker.git
   git push -u origin main
   ```
2. Na [vercel.com/new](https://vercel.com/new) zvolte **Import Git Repository** a vyberte repozitář.
3. Framework se rozpozná automaticky (Next.js). Nic dalšího nastavovat nemusíte, stačí kliknout na **Deploy**.

### Proč jsou nutné hlavičky COOP/COEP

WebContainers potřebují `SharedArrayBuffer`, který prohlížeč povolí jen na stránce
v režimu *cross-origin isolated*. Proto server posílá:

```
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
```

Hlavičky jsou nastavené na dvou místech: v `next.config.js` (dev server i `next start`)
a ve `vercel.json` (Vercel). Když chybí, aplikace zobrazí srozumitelnou hlášku místo pádu.
Stránka musí běžet přes HTTPS nebo na `localhost`.

## Jak to funguje

| Docker | MiniDocker |
| --- | --- |
| Image | Snapshot souborového systému (binární export WebContaineru) + metadata (ENV, WORKDIR, CMD, ENTRYPOINT, EXPOSE) v IndexedDB |
| Vrstva | Každá instrukce = vrstva s ID = SHA-256 (rodičovská vrstva + instrukce + obsah vstupních souborů) |
| Build cache | Vrstvy, které mění FS (FROM, WORKDIR, COPY, ADD, RUN), mají vlastní snapshot. Build naváže na poslední shodnou vrstvu |
| Kontejner | Snapshot image namountovaný do `/containers/<id>/`, proces spuštěný přes `webcontainer.spawn` |
| Síť | Všechny kontejnery sdílí jednu WebContainer instanci. Port se aplikaci předá přes `ENV PORT`; při kolizi se posune |
| `-p 8080:3000` | Mapování se jen zobrazuje, skutečná URL je ta z WebContaineru (`server-ready`) |
| DNS v Compose | Každá služba dostane `<SLUŽBA>_URL=http://localhost:<port>`; hodnoty jako `http://api:4000` se přepíšou na skutečný port |

### Base images

| `FROM` | Chování |
| --- | --- |
| `node:*` | Spouští se nativně ve WebContaineru (verze Node.js je daná WebContainerem) |
| `nginx:*`, `httpd:*` | Nahrazeno malým Node HTTP serverem, který servíruje `/usr/share/nginx/html` (resp. `htdocs`) nebo `WORKDIR`; loguje ve formátu nginx |
| ostatní (`python`, `golang`…) | Chyba „není podporováno ve virtuálním Dockeru“ (podtržená v editoru) |

`RUN apk …`, `apt-get …` a další správci balíčků OS se přeskočí se žlutým varováním,
`RUN npm …` a ostatní shellové příkazy se skutečně spustí.

### Podporované příkazy

```
docker build -t <název> [-f Dockerfile] [--build-arg K=V] [--no-cache] <kontext>
docker run [-d] [-it] [-p 8080:3000] [--name n] [-e K=V] [--env-file f] [--rm] <image> [cmd…]
docker ps [-a] [-q]          docker images [-q]        docker history <image>
docker stop|start|restart|rm [-f] <kontejner…>        docker rmi [-f] <image…>
docker logs [-f] [--tail N] <kontejner>               docker exec [-it] <kontejner> <cmd…>
docker inspect <objekt>      docker pull <image>       docker tag <src> <cíl>
docker compose up [-d] [--build] | down [--rmi all] | ps [-a] | logs [-f] | build | stop | start | restart | config
clear, help, cd, pwd         (ostatní příkazy → jsh shell WebContaineru)
```

## Šablony

1. **Node Express**: `server.js`, `package.json`, `Dockerfile` (node:20-alpine, `npm install`, EXPOSE 3000)
2. **Statický web (nginx)**: `index.html`, `style.css`, `app.js`, `Dockerfile` (`FROM nginx:alpine`, `COPY . /usr/share/nginx/html`)
3. **Compose web + api**: frontend volá API přes `fetch('/api/hello')`, web server požadavek přepošle na Express API (`API_URL=http://api:4000`)

## Struktura projektu

```
app/                  Next.js App Router (layout, stránka, globální CSS)
components/           UI: TopBar, FileExplorer, EditorPane, RightPanel, TerminalPane
lib/dockerfile.ts     parser a validace Dockerfile
lib/compose.ts        parser docker-compose.yml, topologické řazení
lib/engine.ts         „Docker daemon“: build s cache vrstev, kontejnery, porty, logy
lib/cli.ts            docker CLI;  lib/composeCli.ts – docker compose
lib/shell.ts          shell nad xterm.js (editace řádku, historie, úlohy na popředí)
lib/project.ts        soubory projektu + synchronizace do WebContaineru
lib/storage.ts        IndexedDB (idb-keyval)
lib/templates.ts      šablony projektů
scripts/copy-monaco.mjs  kopie Monaco editoru do public/
```

## Omezení

- Jen Node.js runtime: žádné nativní binárky, `apk`/`apt`, Python ani Go.
- Volumes (`-v`, `volumes:`) jsou jen informativní, multi-stage buildy nejsou podporované.
- `RUN` s absolutními cestami mimo `WORKDIR` (např. `mkdir /data`) se neodrazí v image.
- Náhledová URL funguje, jen dokud je otevřená stránka MiniDockeru.
- WebContainers fungují nejlépe v Chromium prohlížečích; Firefox a Safari jsou omezené.

## Licence WebContainer API

`@webcontainer/api` je zdarma pro prototypy, osobní a open-source projekty. Pro komerční
produkční nasazení vyžaduje licenci od StackBlitz, viz
[webcontainers.io/enterprise](https://webcontainers.io/enterprise).
