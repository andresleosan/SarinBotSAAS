import { readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePlan } from './check-plan.mjs';

const scriptRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const normalizedPath = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);

function replaceMarker(template, marker, value) {
  if (template.split(marker).length !== 2) throw new Error(`Template must contain ${marker} exactly once.`);
  return template.replace(marker, () => value);
}

export async function renderProgress({ controlRoot = scriptRoot, generatedAt = new Date().toISOString() } = {}) {
  const root = await realpath(controlRoot);
  const statePath = path.join(root, 'docs/implementation/fresha/tasks.json');
  const source = await readFile(statePath);
  const state = JSON.parse(source.toString('utf8'));
  const declaredRoot = typeof state.workspace?.controlRoot === 'string' ? await realpath(state.workspace.controlRoot).catch(() => null) : null;
  if (!declaredRoot || normalizedPath(declaredRoot) !== normalizedPath(root)) {
    throw new Error('Run from the registered workspace.controlRoot; a worktree must not hold a second tasks.json.');
  }
  const matrix = await readFile(path.join(root, 'docs/product/fresha-admin-coverage-matrix.md'), 'utf8');
  const expectedRequirements = matrix.split(/\r?\n/).filter(line => /^\| A\d{2}\.\d{2} \|/.test(line)).map(line => ({ id: line.split('|')[1].trim(), name: line.split('|')[2].trim() }));
  if (expectedRequirements.length !== 165) throw new Error('Original inventory must contain exactly 165 requirements.');
  const errors = validatePlan(state, { expectedRequirements, controlRoot: root });
  if (errors.length) throw new Error(`Invalid plan; dashboard preserved:\n${errors.join('\n')}`);

  const template = await readFile(path.join(root, '.agents/skills/avanzar/assets/progress.html'), 'utf8');
  let font, fontRoot = root;
  try { font = await readFile(path.join(fontRoot, 'public/fonts/dm-sans-latin.woff2')); }
  catch (error) {
    if (error.code !== 'ENOENT' || !state.workspace.codeRoot) throw error;
    fontRoot = state.workspace.codeRoot;
    font = await readFile(path.join(fontRoot, 'public/fonts/dm-sans-latin.woff2'));
  }
  const fontLicense = (await readFile(path.join(fontRoot, 'public/fonts/DM-Sans-OFL.txt'), 'utf8')).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const sourceSha256 = sha256(source);
  const payload = JSON.stringify({ state, generatedAt, sourceSha256 }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const html = replaceMarker(replaceMarker(template, '__PROGRESS_FONT__', font.toString('base64')), '__PROGRESS_DATA__', payload) + `\n<!-- Embedded DM Sans license:\n${fontLicense}\n-->\n`;
  const outputPath = path.join(root, 'docs/implementation/fresha/progreso.html');
  const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, html, { flag: 'wx' });
    if (sha256(await readFile(statePath)) !== sourceSha256) throw new Error('tasks.json changed during generation; rerun against its current revision.');
    await rename(temporaryPath, outputPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return { outputPath, revision: state.revision, tasks: state.tasks.length, requirements: state.requirements.length, generatedAt, sourceSha256, htmlSha256: sha256(html) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) {
    console.error('Usage: node .agents/skills/avanzar/scripts/render-progress.mjs');
    process.exitCode = 1;
  } else {
    renderProgress().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
