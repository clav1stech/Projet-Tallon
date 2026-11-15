// ios/copy-web.mjs
// Copie dans ios/www la coquille hors ligne de la PWA (PRECACHE_URLS de sw.js) :
// l'app iOS embarque exactement ce que le service worker met en cache, sans
// seconde liste à maintenir. Les URL distantes (CDN des éditeurs) sont ignorées.
//
// Usage : node ios/copy-web.mjs  (depuis n'importe quel dossier)

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'ios', 'www');

// Même extraction que tests/dataIntegrity.test.js.
const source = readFileSync(join(root, 'sw.js'), 'utf8');
const block = source.match(/const PRECACHE_URLS = \[([\s\S]*?)\n\];/)?.[1];
if (!block) throw new Error('PRECACHE_URLS introuvable dans sw.js');
const files = [...block.matchAll(/^\s*'\.\/([^']+)'/gm)].map(match => match[1]);

const missing = files.filter(file => !existsSync(join(root, file)));
if (missing.length) throw new Error(`Fichiers précachés absents : ${missing.join(', ')}`);
if (!files.includes('index.html')) throw new Error('index.html absent de PRECACHE_URLS');

rmSync(out, { recursive: true, force: true });
for (const file of files) {
    mkdirSync(dirname(join(out, file)), { recursive: true });
    cpSync(join(root, file), join(out, file));
}
console.log(`${files.length} fichiers copiés dans ios/www`);
