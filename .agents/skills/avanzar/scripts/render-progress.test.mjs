import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { renderProgress } from './render-progress.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'sarin-progress-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith('sarin-progress-'));
    return rm(root, { recursive: true, force: true });
  });
  for (const folder of ['docs/implementation/fresha', 'docs/product', '.agents/skills/avanzar/assets', 'public/fonts']) await mkdir(path.join(root, folder), { recursive: true });
  const requirements = Array.from({ length: 165 }, (_, i) => ({ id: `A${String(Math.floor(i / 10) + 1).padStart(2, '0')}.${String(i % 10 + 1).padStart(2, '0')}`, name: `Requisito ${i + 1}`, planningTaskIds: [], implementationTaskIds: ['T1'], acceptanceTaskIds: ['T1'], implementationResolved: false, status: 'pending', evidence: [] }));
  const state = { schemaVersion: 1, planVersion: 1, revision: 7, approval: { plan: { status: 'approved', approvedVersion: 1, reference: 'synthetic approval' } }, workspace: { controlRoot: root, codeRoot: null }, currentTaskId: null, tasks: [{ id: 'T1', phase: 'R0', kind: 'build', title: 'Synthetic task', requirementIds: requirements.map(r => r.id), dependsOn: [], plan: 'docs/plan.md', anchor: 't1', files: { create: [], modify: [], test: [] }, skills: ['ponytail'], acceptance: ['Resultado comprobable'], checks: [{ command: 'node --test', expected: 'Exit 0' }], status: 'pending', evidence: [] }], requirements };
  const statePath = path.join(root, 'docs/implementation/fresha/tasks.json');
  const outputPath = path.join(root, 'docs/implementation/fresha/progreso.html');
  const templatePath = path.join(root, '.agents/skills/avanzar/assets/progress.html');
  await writeFile(statePath, JSON.stringify(state));
  await writeFile(path.join(root, 'docs/product/fresha-admin-coverage-matrix.md'), requirements.map(r => `| ${r.id} | ${r.name} |`).join('\n'));
  await writeFile(path.join(root, 'public/fonts/dm-sans-latin.woff2'), 'synthetic-font');
  await writeFile(path.join(root, 'public/fonts/DM-Sans-OFL.txt'), 'Synthetic font license --> <script>must stay a comment</script>');
  await writeFile(templatePath, '<style>url(data:font/woff2;base64,__PROGRESS_FONT__)</style><script type="application/json" id="data">__PROGRESS_DATA__</script>');
  return { root, state, statePath, outputPath, templatePath };
}

test('renders the authoritative revision without modifying source and escapes script termination', async t => {
  const { root, state, statePath, outputPath } = await fixture(t);
  state.tasks[0].title = '</script><img src=x onerror=alert(1)>\u2028\u2029';
  await writeFile(statePath, JSON.stringify(state));
  const before = await readFile(statePath);
  const result = await renderProgress({ controlRoot: root, generatedAt: '2026-11-06T01:00:00.000Z' });
  const html = await readFile(outputPath, 'utf8');
  assert.deepEqual(await readFile(statePath), before);
  assert.equal(result.revision, 7);
  assert.equal(result.sourceSha256, hash(before));
  assert.equal(result.htmlSha256, hash(html));
  assert.equal(html.match(/<\/script>/g).length, 1);
  assert.ok(!html.includes('\u2028') && !html.includes('\u2029'));
  const payload = JSON.parse(html.match(/id="data">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(payload.state, state);
  assert.equal(payload.generatedAt, '2026-11-06T01:00:00.000Z');
  assert.equal(payload.sourceSha256, hash(before));
  assert.ok(html.includes(Buffer.from('synthetic-font').toString('base64')));
  assert.ok(html.includes('<!-- Embedded DM Sans license:\nSynthetic font license --&gt; &lt;script&gt;must stay a comment&lt;/script&gt;\n-->'));
});

test('invalid plan preserves an existing dashboard', async t => {
  const { root, state, statePath, outputPath } = await fixture(t);
  state.tasks[0].status = 'implemented';
  await writeFile(statePath, JSON.stringify(state));
  await writeFile(outputPath, 'last valid dashboard');
  await assert.rejects(renderProgress({ controlRoot: root }), /Missing completion evidence/);
  assert.equal(await readFile(outputPath, 'utf8'), 'last valid dashboard');
});

test('refuses a second control workspace and an incomplete original inventory', async t => {
  const { root, state, statePath } = await fixture(t);
  state.workspace.controlRoot = path.join(root, 'other-control');
  await writeFile(statePath, JSON.stringify(state));
  await assert.rejects(renderProgress({ controlRoot: root }), /controlRoot/);
  state.workspace.controlRoot = root;
  await writeFile(statePath, JSON.stringify(state));
  await writeFile(path.join(root, 'docs/product/fresha-admin-coverage-matrix.md'), '| A01.01 | Requisito 1 |');
  await assert.rejects(renderProgress({ controlRoot: root }), /165/);
});

test('rejects missing or duplicate template markers before replacing the dashboard', async t => {
  const { root, templatePath, outputPath } = await fixture(t);
  await writeFile(outputPath, 'last valid dashboard');
  await writeFile(templatePath, '__PROGRESS_DATA__ __PROGRESS_DATA__ __PROGRESS_FONT__');
  await assert.rejects(renderProgress({ controlRoot: root }), /exactly once/);
  assert.equal(await readFile(outputPath, 'utf8'), 'last valid dashboard');
});
