export interface Template {
  id: string;
  label: string;
  /** Výchozí název projektu = název image / compose projektu. */
  name: string;
  files: Record<string, string>;
  open: string;
}

/* ------------------------------------------------------------------ */
/* 1) Node Express                                                     */
/* ------------------------------------------------------------------ */

const expressServer = `const express = require('express');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;
const startedAt = new Date();
let visits = 0;

const hostname = () => process.env.HOSTNAME || os.hostname();

app.get('/', (req, res) => {
  visits++;
  res.send(\`<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Express v MiniDockeru</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0;
           display: grid; place-items: center; min-height: 100vh; margin: 0; }
    .card { background: #1e293b; padding: 2rem 2.5rem; border-radius: 16px;
            box-shadow: 0 10px 40px #0006; max-width: 520px; }
    h1 { margin-top: 0; color: #38bdf8; }
    code { background: #0f172a; padding: 2px 6px; border-radius: 4px; }
    dt { color: #94a3b8; font-size: .85rem; }
    dd { margin: 0 0 .75rem; }
    a { color: #38bdf8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🐳 Ahoj z kontejneru!</h1>
    <p>Tahle Express aplikace běží v Node.js přímo ve vašem prohlížeči.</p>
    <dl>
      <dt>Hostname kontejneru</dt><dd><code>\${hostname()}</code></dd>
      <dt>Node.js</dt><dd><code>\${process.version}</code></dd>
      <dt>NODE_ENV</dt><dd><code>\${process.env.NODE_ENV || 'development'}</code></dd>
      <dt>Port</dt><dd><code>\${PORT}</code></dd>
      <dt>Počet návštěv</dt><dd><code>\${visits}</code></dd>
    </dl>
    <p>JSON API: <a href="/api/info">/api/info</a></p>
  </div>
</body>
</html>\`);
});

app.get('/api/info', (req, res) => {
  res.json({
    hostname: hostname(),
    node: process.version,
    env: process.env.NODE_ENV || 'development',
    uptime: Math.round(process.uptime()),
    startedAt,
    visits,
  });
});

app.listen(PORT, () => {
  console.log(\`🚀 Server běží na portu \${PORT}\`);
});
`;

const expressPackage = `{
  "name": "express-app",
  "version": "1.0.0",
  "private": true,
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.21.2"
  }
}
`;

const expressDockerfile = `# Node.js Express aplikace
FROM node:20-alpine

WORKDIR /app

# Nejdřív jen package.json → vrstva s npm install se cachuje,
# dokud se nezmění závislosti.
COPY package*.json ./
RUN npm install --omit=dev

# Zbytek zdrojáků
COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
`;

const nodeDockerignore = `node_modules
npm-debug.log
.git
`;

/* ------------------------------------------------------------------ */
/* 2) Statický web (nginx)                                             */
/* ------------------------------------------------------------------ */

const staticIndex = `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Statický web v nginx kontejneru</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header>
    <span class="logo">📦</span>
    <h1>Statický web</h1>
    <p>Servírováno z <code>nginx:alpine</code> kontejneru v MiniDockeru.</p>
  </header>

  <main>
    <section class="card">
      <h2>Jak to funguje?</h2>
      <ol>
        <li><code>COPY . /usr/share/nginx/html</code> zkopíruje soubory do image.</li>
        <li>Kontejner spustí statický HTTP server na portu 80.</li>
        <li>Upravte <code>index.html</code>, dejte <b>Run</b> a obnovte stránku.</li>
      </ol>
    </section>

    <section class="card">
      <h2>Interaktivita</h2>
      <p>Tlačítko bylo stisknuto <strong id="count">0</strong>×.</p>
      <button id="btn">Klikni na mě</button>
    </section>
  </main>

  <footer>Vytvořeno v MiniDockeru · <span id="time"></span></footer>
  <script src="app.js"></script>
</body>
</html>
`;

const staticCss = `:root {
  --bg: #0b1220;
  --card: #131c2e;
  --accent: #22d3ee;
  --text: #e5e7eb;
  --muted: #94a3b8;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  background: radial-gradient(circle at top, #1e293b, var(--bg));
  color: var(--text);
  min-height: 100vh;
}

header {
  text-align: center;
  padding: 3rem 1rem 1.5rem;
}

.logo { font-size: 3rem; }

h1 { margin: .5rem 0; color: var(--accent); }

main {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  max-width: 860px;
  margin: 0 auto;
  padding: 1rem;
}

.card {
  background: var(--card);
  border: 1px solid #1f2a40;
  border-radius: 14px;
  padding: 1.25rem 1.5rem;
}

code {
  background: #0b1220;
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--accent);
}

button {
  background: var(--accent);
  color: #062026;
  border: 0;
  padding: .6rem 1.2rem;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
}

footer {
  text-align: center;
  color: var(--muted);
  padding: 2rem;
  font-size: .9rem;
}
`;

const staticJs = `const btn = document.getElementById('btn');
const count = document.getElementById('count');
let clicks = 0;

btn.addEventListener('click', () => {
  clicks++;
  count.textContent = clicks;
});

document.getElementById('time').textContent = new Date().toLocaleString('cs-CZ');
`;

const staticDockerfile = `# Statický web servírovaný nginxem
FROM nginx:alpine

# Obsah projektu → výchozí složka nginxu
COPY . /usr/share/nginx/html

EXPOSE 80
`;

const staticDockerignore = `Dockerfile
.dockerignore
`;

/* ------------------------------------------------------------------ */
/* 3) Compose: web + api                                               */
/* ------------------------------------------------------------------ */

const composeYml = `# Dvě služby: "web" (frontend + proxy na API) a "api" (Express).
# Spusťte tlačítkem Compose Up nebo příkazem: docker compose up
services:
  api:
    build: ./api
    ports:
      - "4000:4000"
    environment:
      GREETING: "Ahoj z API kontejneru!"

  web:
    build:
      context: ./web
      dockerfile: Dockerfile
    ports:
      - "8080:3000"
    environment:
      # Ve skutečném Dockeru funguje DNS název služby "api".
      # MiniDocker ho přepíše na http://localhost:<port služby api>.
      - API_URL=http://api:4000
    depends_on:
      - api
`;

const apiServer = `const express = require('express');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 4000;
let requests = 0;

app.get('/hello', (req, res) => {
  requests++;
  res.json({
    message: process.env.GREETING || 'Ahoj z API!',
    hostname: process.env.HOSTNAME || os.hostname(),
    requests,
    time: new Date().toISOString(),
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(\`API poslouchá na portu \${PORT}\`);
});
`;

const apiPackage = `{
  "name": "api",
  "version": "1.0.0",
  "private": true,
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.21.2"
  }
}
`;

const apiDockerfile = `FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 4000
CMD ["node", "server.js"]
`;

const webServer = `// Frontend server bez závislostí: servíruje public/ a /api/* přeposílá na API službu.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const API_URL = process.env.API_URL || 'http://localhost:4000';
const PUBLIC_DIR = path.join(__dirname, 'public');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
};

function proxyToApi(req, res) {
  const target = new URL(req.url.slice('/api'.length) || '/', API_URL);
  const upstream = http.request(
    target,
    { method: req.method, headers: { ...req.headers, host: target.host } },
    (apiRes) => {
      res.writeHead(apiRes.statusCode || 502, apiRes.headers);
      apiRes.pipe(res);
    },
  );
  upstream.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'API není dostupné', detail: err.message }));
  });
  req.pipe(upstream);
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  if (urlPath.endsWith('/')) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('404 – nenalezeno');
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

http
  .createServer((req, res) => {
    console.log(\`\${req.method} \${req.url}\`);
    if (req.url.startsWith('/api/')) return proxyToApi(req, res);
    serveStatic(req, res);
  })
  .listen(PORT, () => {
    console.log(\`Web poslouchá na portu \${PORT}, API_URL=\${API_URL}\`);
  });
`;

const webPackage = `{
  "name": "web",
  "version": "1.0.0",
  "private": true,
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  }
}
`;

const webDockerfile = `FROM node:20-alpine
WORKDIR /app

# Web nemá žádné npm závislosti → stačí zkopírovat zdrojáky
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
`;

const webIndex = `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Compose: web + api</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #111827; color: #f3f4f6;
           max-width: 640px; margin: 3rem auto; padding: 0 1rem; }
    h1 { color: #a78bfa; }
    button { background: #a78bfa; color: #1e1b4b; border: 0; padding: .6rem 1.2rem;
             border-radius: 8px; font-weight: 600; cursor: pointer; }
    pre { background: #1f2937; padding: 1rem; border-radius: 8px; overflow: auto; min-height: 6rem; }
    .muted { color: #9ca3af; }
  </style>
</head>
<body>
  <h1>🧩 web → api</h1>
  <p>Frontend volá <code>fetch('/api/hello')</code>, web server požadavek přepošle na službu <b>api</b>.</p>
  <button id="call">Zavolat API</button>
  <pre id="out" class="muted">Klikněte na tlačítko…</pre>
  <script src="app.js"></script>
</body>
</html>
`;

const webAppJs = `const out = document.getElementById('out');

async function callApi() {
  out.textContent = 'Načítám…';
  try {
    const res = await fetch('/api/hello');
    const data = await res.json();
    out.textContent = JSON.stringify(data, null, 2);
    out.classList.remove('muted');
  } catch (err) {
    out.textContent = 'Chyba: ' + err.message;
  }
}

document.getElementById('call').addEventListener('click', callApi);
callApi();
`;

export const TEMPLATES: Template[] = [
  {
    id: 'node-express',
    label: 'Node Express',
    name: 'express-app',
    open: 'Dockerfile',
    files: {
      'Dockerfile': expressDockerfile,
      '.dockerignore': nodeDockerignore,
      'package.json': expressPackage,
      'server.js': expressServer,
    },
  },
  {
    id: 'static-nginx',
    label: 'Statický web (nginx)',
    name: 'static-web',
    open: 'index.html',
    files: {
      'Dockerfile': staticDockerfile,
      '.dockerignore': staticDockerignore,
      'index.html': staticIndex,
      'style.css': staticCss,
      'app.js': staticJs,
    },
  },
  {
    id: 'compose',
    label: 'Compose web + api',
    name: 'compose-app',
    open: 'docker-compose.yml',
    files: {
      'docker-compose.yml': composeYml,
      'api/Dockerfile': apiDockerfile,
      'api/.dockerignore': nodeDockerignore,
      'api/package.json': apiPackage,
      'api/server.js': apiServer,
      'web/Dockerfile': webDockerfile,
      'web/.dockerignore': nodeDockerignore,
      'web/package.json': webPackage,
      'web/server.js': webServer,
      'web/public/index.html': webIndex,
      'web/public/app.js': webAppJs,
    },
  },
];

export function getTemplate(id: string): Template {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}
