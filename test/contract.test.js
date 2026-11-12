'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, assert, fixturesExist } = require('./helpers');
const { NODE_TYPES } = require('../src/schema');
const { buildRegistryDigest, DOCUMENTED_CODES, loadExamples } = require('../scripts/check-contract');
const { findLegacyFields, migrateTemplate } = require('../src/legacy');
const { baseTemplate } = require('../scripts/pack-definitions');

const ROOT = path.join(__dirname, '..');
const SNAPSHOT = path.join(ROOT, 'docs', 'contract', 'registry-snapshot.json');
const DOC = path.join(ROOT, 'docs', 'contract', 'TEMPLATE-CONTRACT.md');

test('registry snapshot is committed and identical to the live NODE_TYPES digest', () => {
  assert.ok(fs.existsSync(SNAPSHOT));
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  delete snapshot.generatedBy;
  assert.deepEqual(snapshot, buildRegistryDigest());
});

test('contract document covers every node type, param type and diagnostic code', () => {
  const doc = fs.readFileSync(DOC, 'utf8');
  for (const type of Object.keys(NODE_TYPES)) assert.ok(doc.includes(`\`${type}\``), `doc missing node ${type}`);
  for (const [code] of DOCUMENTED_CODES) assert.ok(doc.includes(code), `doc missing diagnostic ${code}`);
});

test('every documented diagnostic code is really emitted by the implementation', () => {
  const srcDir = path.join(ROOT, 'src');
  const emitted = new Set();
  for (const file of fs.readdirSync(srcDir).filter((f) => f.endsWith('.js'))) {
    const body = fs.readFileSync(path.join(srcDir, file), 'utf8');
    for (const m of body.matchAll(/'([A-Z_]{3,})'/g)) {
      if (!['PROCESS_FAILED', 'ID_UNSAFE', 'TEXT_LAYER_MISSING', 'PROBE_NO_VIDEO'].includes(m[1])) emitted.add(m[1]);
    }
  }
  for (const [code] of DOCUMENTED_CODES) {
    assert.ok(emitted.has(code), `documented code ${code} is not emitted by src/`);
  }
});

test('canonical example is deep-equal to the compiler baseTemplate', () => {
  const canonical = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'contract', 'examples', '01-canonical.json'), 'utf8'));
  assert.deepEqual(canonical.template, baseTemplate('aurora_ad', 'Aurora — long headline suite template', '#ffd166'));
});

test('example suite contains positive, negative (empty slot + cycle) and migration kinds', () => {
  const examples = loadExamples();
  const ids = new Set(examples.map((e) => e.id));
  for (const id of ['ex_canonical_aurora', 'ex_empty_slot', 'ex_ref_cycle', 'ex_long_title_overflow', 'ex_short_background', 'ex_legacy_migration']) {
    assert.ok(ids.has(id), `missing example ${id}`);
  }
  const empty = examples.find((e) => e.id === 'ex_empty_slot');
  assert.deepEqual(empty.expect.errors, ['ASSET_MISSING']);
  const cycle = examples.find((e) => e.id === 'ex_ref_cycle');
  assert.deepEqual(cycle.expect.errors, ['REF_CYCLE']);
  assert.match(cycle.expect.messagePattern, /logoLayer -> titleLayer -> logoLayer/);
});

test('legacy example: rejected before migration, validates and renders to 1280x720/10s after',
  { skip: !fixturesExist(), timeout: 180000 },
  async () => {
    const examples = loadExamples();
    const ex = examples.find((e) => e.id === 'ex_legacy_migration');
    const { validateTemplateShape } = require('../src/schema');
    assert.equal(validateTemplateShape(ex.template).ok, false);
    assert.equal(findLegacyFields(ex.template).length, ex.expectLegacy.legacyFields.length);

    const { template } = migrateTemplate(ex.template);
    assert.equal(validateTemplateShape(template).ok, true);

    const { validateTemplate } = require('../src/render');
    const { probeMedia } = require('../src/probe');
    const { prepareTextImages } = require('../src/text-render');
    const { compileGraph } = require('../src/compiler');
    const { spawnFile } = require('../src/process');
    const { FFMPEG } = require('../src/probe');
    const { initFonts } = require('../src/fonts');
    initFonts();

    const store = new Map();
    const bindings = {};
    for (const [slot, file] of Object.entries(ex.bindings)) {
      const filePath = path.join(ROOT, 'packs', ex.pack, 'assets', file);
      const id = `${ex.pack}_${path.parse(file).name}`;
      store.set(id, { id, path: filePath });
      bindings[slot] = id;
    }
    const assetStore = { get: (id) => store.get(id) || null };
    const validation = await validateTemplate(template, ex.variables, bindings, assetStore);
    assert.equal(validation.ok, true, JSON.stringify(validation.errors));

    const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-test-'));
    try {
      const { images } = prepareTextImages(template, ex.variables, jobDir);
      const graph = compileGraph(template, bindings, assetStore, [], jobDir, { textImages: images });
      const out = path.join(jobDir, 'output.mp4');
      await spawnFile(FFMPEG, [...graph.argv.slice(1), out], { cwd: jobDir });
      const probe = await probeMedia(out);
      assert.equal(probe.width, 1280);
      assert.equal(probe.height, 720);
      assert.ok(Math.abs(probe.duration - 10) <= 0.12);
      assert.equal(probe.pixFmt, 'yuv420p');
    } finally {
      fs.rmSync(jobDir, { recursive: true, force: true });
    }
  });

test('default brand templates carry no legacy fields', () => {
  const dir = path.join(ROOT, 'data', 'templates');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const template = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    assert.deepEqual(findLegacyFields(template), [], `${file} still contains legacy fields`);
  }
});

test('generated examples are reproducible from generate-examples.js', () => {
  const dir = path.join(ROOT, 'docs', 'contract', 'examples');
  const before = new Map(
    fs.readdirSync(dir).filter((f) => /^\d{2}-.*\.json$/.test(f)).map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]),
  );
  require(path.join(dir, 'generate-examples.js'));
  for (const [file, content] of before) {
    assert.equal(fs.readFileSync(path.join(dir, file), 'utf8'), content, `${file} drifted; run npm run contract:examples`);
  }
});
