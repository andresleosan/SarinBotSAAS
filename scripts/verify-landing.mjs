import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sarinWhatsAppUrl } from '../src/lib/sarin-contact.ts';

const output = fileURLToPath(new URL('../landing/out/', import.meta.url));
const html = await readFile(join(output, 'index.html'), 'utf8');
const links = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
const anchors = [...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map((match) => match[1]);
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
const appOrigin = 'https://sarinbotsaas.pages.dev';
const applicationLinks = [];
assert.ok(['bot-heading', 'servicio', 'planes', 'contacto'].every(id => ids.has(id)), 'The chatbot service, pricing and contact sections must be present.');
assert.ok(html.includes('Un chatbot para atender a tus clientes.'), 'The chatbot service heading must be present.');
assert.ok(!/Prueba pagada|SarinBot Esencial|data-offer-state|Sarin Bot Admin Hub/i.test(html), 'The chatbot landing must not retain appointment plans or an admin-only homepage.');
for (const link of anchors) {
  if (link.startsWith('#')) {
    assert.ok(ids.has(link.slice(1)), `Navigation has no target: ${link}`);
    continue;
  }
  if (link === '/') continue;
  assert.ok(!link.startsWith('/'), 'The static homepage must not point at an unserved relative application route.');
  const url = new URL(link);
  assert.ok(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash, 'Public destinations require clean HTTPS URLs.');
  if (url.origin === appOrigin) {
    assert.equal(url.pathname, '/admin', 'The secondary administration entry must lead to the console.');
    applicationLinks.push(url.pathname);
  } else {
    assert.ok(url.href === 'https://www.alsdevstudio.com/' || url.href === sarinWhatsAppUrl, 'An unapproved external destination was exported.');
  }
}
assert.deepEqual(applicationLinks, ['/admin'], 'The service landing requires one secondary administration entry.');
assert.ok(anchors.includes(sarinWhatsAppUrl), 'The service requires a working quotation contact.');
assert.ok(!html.includes('/_next/image?'), 'The export must not require the Next image server.');
const icons = ['sarin-face.ico', 'sarin-face-32.png', 'sarin-face-48.png', 'sarin-face-apple.png'];
for (const file of ['404.html', '_headers', 'robots.txt', 'sitemap.xml', 'brand/sarin-welcome.png', 'brand/sarin-flight.png', 'brand/sarin-face-mark.png', 'favicon.ico', ...icons]) await stat(join(output, file));
for (const icon of icons) {
  assert.ok(links.some((link) => link.split(/[?#]/)[0] === '/' + icon), `Missing icon metadata: ${icon}`);
}
assert.ok(!links.some((link) => link.includes('/favicon.svg')), 'The previous line-art favicon must not be selected.');

let files = 0;
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    assert.ok(!entry.isSymbolicLink(), 'The public artifact must not contain symlinks.');
    if (entry.isDirectory()) { await inspect(file); continue; }
    files++;
    assert.ok(!entry.name.startsWith('.env') && entry.name !== '_worker.js' && !/\.map$/.test(entry.name), 'Unexpected private/executable artifact.');
    if (/\.(js|html|txt)$/.test(entry.name)) {
      const content = await readFile(file, 'utf8');
      assert.ok(!/firebaseapp\.com|securetoken\.googleapis|firestore\.googleapis|FIREBASE_ADMIN_PRIVATE_KEY|CF_ACCESS_CLIENT_SECRET|DEEPSEEK_API_KEY|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content), `Backend content found in ${file}`);
    }
  }
}
await inspect(output);

for (const asset of html.matchAll(/(?:src|href)="(\/(?:_next|brand)\/[^"?#]+)"/g)) {
  const path = resolve(output, '.' + asset[1]);
  assert.ok(path.startsWith(output), 'Asset escapes output directory.');
  await stat(path);
}
console.log(`Bot service landing verified: ${files} public files, service, pricing, contact and administrative entry present, no backend configuration.`);
