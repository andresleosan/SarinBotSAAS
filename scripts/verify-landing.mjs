import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../landing/out/', import.meta.url));
const html = await readFile(join(output, 'index.html'), 'utf8');
const links = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
assert.ok(html.includes('aún no están disponibles') && html.includes('Próximamente'), 'The launch notice must be visible.');
assert.ok(!links.some((link) => /^\/(admin|dashboard|api|b)(\/|$)/.test(link)), 'Private routes must not be linked.');
assert.ok(!html.includes('/_next/image?'), 'The export must not require the Next image server.');
for (const file of ['404.html', '_headers', 'robots.txt', 'sitemap.xml', 'brand/sarin-welcome.png']) await stat(join(output, file));

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
      assert.ok(!/firebaseapp\.com|securetoken\.googleapis|FIREBASE_ADMIN_PRIVATE_KEY|CF_ACCESS_CLIENT_SECRET/.test(content), `Backend content found in ${file}`);
    }
  }
}
await inspect(output);

for (const asset of html.matchAll(/(?:src|href)="(\/(?:_next|brand)\/[^"?#]+)"/g)) {
  const path = resolve(output, '.' + asset[1]);
  assert.ok(path.startsWith(output), 'Asset escapes output directory.');
  await stat(path);
}
console.log(`Landing verified: ${files} public files, launch notice present, no private links or backend configuration.`);
