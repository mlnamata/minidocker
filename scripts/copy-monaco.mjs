// Zkopíruje Monaco editor (AMD build) do public/monaco/vs, aby se načítal
// ze stejného originu. CDN by pod COEP: require-corp nemuselo projít.
import { cpSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

let pkgDir;
try {
  pkgDir = dirname(require.resolve('monaco-editor/package.json'));
} catch {
  console.warn('[copy-monaco] monaco-editor není nainstalován – přeskakuji.');
  process.exit(0);
}

const { version } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const src = join(pkgDir, 'min', 'vs');
const destRoot = join(root, 'public', 'monaco');
const dest = join(destRoot, 'vs');
const stamp = join(destRoot, '.version');

if (existsSync(stamp) && readFileSync(stamp, 'utf8') === version && existsSync(join(dest, 'loader.js'))) {
  process.exit(0);
}

rmSync(destRoot, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
writeFileSync(stamp, version);
console.log(`[copy-monaco] monaco-editor ${version} → public/monaco/vs`);
