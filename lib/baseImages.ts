import type { BaseFlavor, ImageConfig } from './types';

/** Kam se do image zapisuje náš statický server (nginx/httpd náhrada). */
export const STATIC_SERVER_PATH = '/.minidocker/static-server.js';

const NGINX_VERSION = '1.27.2';
const HTTPD_VERSION = '2.4.62';

/**
 * Malý Node HTTP server, který ve virtuálním Dockeru zastupuje nginx/httpd.
 * Loguje ve formátu nginx access logu.
 */
export const STATIC_SERVER_JS = `// MiniDocker: náhrada nginx/httpd – statický HTTP server v Node.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.MD_DOC_ROOT || process.cwd());
const PORT = Number(process.env.PORT || 80);
const FLAVOR = process.env.MD_FLAVOR || 'nginx';
const SERVER = FLAVOR === 'httpd' ? 'Apache/${HTTPD_VERSION} (Unix)' : 'nginx/${NGINX_VERSION}';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.xml': 'application/xml',
};

const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function accessTime(d) {
  return pad(d.getUTCDate()) + '/' + MONTHS[d.getUTCMonth()] + '/' + d.getUTCFullYear() + ':' +
    pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + ' +0000';
}
function noticeTime(d) {
  return d.getUTCFullYear() + '/' + pad(d.getUTCMonth() + 1) + '/' + pad(d.getUTCDate()) + ' ' +
    pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
}

function errorPage(status, title) {
  if (FLAVOR === 'httpd') {
    return '<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML 2.0//EN">\\n<html><head><title>' + status + ' ' + title +
      '</title></head><body><h1>' + title + '</h1><p>The requested URL was not found on this server.</p></body></html>\\n';
  }
  return '<html>\\n<head><title>' + status + ' ' + title + '</title></head>\\n<body>\\n<center><h1>' + status + ' ' +
    title + '</h1></center>\\n<hr><center>' + SERVER + '</center>\\n</body>\\n</html>\\n';
}

function send(req, res, status, body, type, extra) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, Object.assign({ 'Content-Type': type, 'Content-Length': buf.length, Server: SERVER }, extra || {}));
  res.end(req.method === 'HEAD' ? undefined : buf);
  console.log('172.17.0.1 - - [' + accessTime(new Date()) + '] "' + req.method + ' ' + req.url + ' HTTP/1.1" ' +
    status + ' ' + buf.length + ' "' + (req.headers.referer || '-') + '" "' + (req.headers['user-agent'] || '-') + '"');
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    return send(req, res, 400, errorPage(400, 'Bad Request'), 'text/html');
  }
  let file = path.join(ROOT, pathname);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    return send(req, res, 403, errorPage(403, 'Forbidden'), 'text/html');
  }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) {
      if (!pathname.endsWith('/')) {
        return send(req, res, 301, errorPage(301, 'Moved Permanently'), 'text/html', { Location: pathname + '/' });
      }
      file = path.join(file, 'index.html');
    }
    fs.readFile(file, (err2, data) => {
      if (err2) return send(req, res, 404, errorPage(404, 'Not Found'), 'text/html');
      send(req, res, 200, data, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
    });
  });
});

server.listen(PORT, () => {
  const t = noticeTime(new Date());
  if (FLAVOR === 'httpd') {
    console.log('AH00558: httpd: Could not reliably determine the server\\'s fully qualified domain name');
    console.log('[' + new Date().toUTCString() + '] [mpm_event:notice] AH00489: ' + SERVER + ' configured -- resuming normal operations');
    console.log('[' + new Date().toUTCString() + '] [core:notice] AH00094: Command line: \\'httpd -D FOREGROUND\\'');
  } else {
    console.log('/docker-entrypoint.sh: Configuration complete; ready for start up');
    console.log(t + ' [notice] 1#1: ' + SERVER + ' (MiniDocker static server)');
    console.log(t + ' [notice] 1#1: start worker processes');
  }
  console.log('[minidocker] servíruji ' + ROOT + ' na portu ' + PORT);
});
`;

const NGINX_INDEX = `<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
<style>
html { color-scheme: light dark; }
body { width: 35em; margin: 0 auto;
font-family: Tahoma, Verdana, Arial, sans-serif; }
</style>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and
working. Further configuration is required.</p>

<p>For online documentation and support please refer to
<a href="http://nginx.org/">nginx.org</a>.<br/>
Commercial support is available at
<a href="http://nginx.com/">nginx.com</a>.</p>

<p><em>Thank you for using nginx.</em></p>
<p><small>(MiniDocker: statický server v Node.js)</small></p>
</body>
</html>
`;

const NGINX_50X = `<!DOCTYPE html>
<html>
<head><title>Error</title></head>
<body>
<h1>An error occurred.</h1>
<p>Sorry, the page you are looking for is currently unavailable.<br/>
Please try again later.</p>
</body>
</html>
`;

const HTTPD_INDEX = `<html><body><h1>It works!</h1></body></html>
`;

export interface BaseDefinition {
  flavor: BaseFlavor;
  files: Record<string, string>;
  config: ImageConfig;
  size: number;
}

/** Definice base image: soubory, výchozí konfigurace a odhad velikosti. */
export function baseDefinition(flavor: BaseFlavor, tag: string): BaseDefinition {
  const alpine = tag.includes('alpine');
  const slim = tag.includes('slim');
  const common = { labels: {}, entrypoint: null as string[] | null };

  if (flavor === 'nginx') {
    return {
      flavor,
      size: alpine ? 52_500_000 : 192_000_000,
      files: {
        '/usr/share/nginx/html/index.html': NGINX_INDEX,
        '/usr/share/nginx/html/50x.html': NGINX_50X,
        [STATIC_SERVER_PATH]: STATIC_SERVER_JS,
      },
      config: {
        ...common,
        runtime: 'static',
        flavor,
        env: { NGINX_VERSION },
        workdir: '/',
        entrypoint: ['/docker-entrypoint.sh'],
        cmd: ['nginx', '-g', 'daemon off;'],
        exposed: [80],
        docRoot: '/usr/share/nginx/html',
      },
    };
  }
  if (flavor === 'httpd') {
    return {
      flavor,
      size: alpine ? 61_000_000 : 148_000_000,
      files: {
        '/usr/local/apache2/htdocs/index.html': HTTPD_INDEX,
        [STATIC_SERVER_PATH]: STATIC_SERVER_JS,
      },
      config: {
        ...common,
        runtime: 'static',
        flavor,
        env: { HTTPD_PREFIX: '/usr/local/apache2', HTTPD_VERSION },
        workdir: '/usr/local/apache2',
        cmd: ['httpd-foreground'],
        exposed: [80],
        docRoot: '/usr/local/apache2/htdocs',
      },
    };
  }
  const major = tag.match(/^\d+/)?.[0];
  return {
    flavor,
    size: alpine ? 135_000_000 : slim ? 220_000_000 : 1_100_000_000,
    files: {},
    config: {
      ...common,
      runtime: 'node',
      flavor,
      env: { NODE_VERSION: major ? `${major}.x` : 'latest', YARN_VERSION: '1.22.22' },
      workdir: '/',
      entrypoint: ['docker-entrypoint.sh'],
      cmd: ['node'],
      exposed: [],
    },
  };
}
