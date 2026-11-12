'use strict';

// Template contract checker — turns the documented contract into automated
// maintenance checks.
//
//   node scripts/check-contract.js              full check (renders positive cases)
//   node scripts/check-contract.js --static     no ffmpeg: registry/docs/examples only
//   node scripts/check-contract.js --json       machine-readable report on stdout
//   node scripts/check-contract.js --update-registry
//                                               refresh docs/contract/registry-snapshot.json
//
// A check only passes when every documented expectation is reproduced by the
// real compiler/validator. "No errors" alone is never accepted: positive
// cases must render and an independent probe must match the documented
// deliverable size/duration; negative cases must emit the documented codes.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { NODE_TYPES, validateTemplateShape } = require('../src/schema');
const { validateTemplate, verifyOutput } = require('../src/render');
const { probeMedia, FFMPEG } = require('../src/probe');
const { prepareTextImages } = require('../src/text-render');
const { compileGraph } = require('../src/compiler');
const { spawnFile } = require('../src/process');
const { initFonts } = require('../src/fonts');
const { findLegacyFields, migrateTemplate, LEGACY_RULES } = require('../src/legacy');
const { baseTemplate, packs } = require('./pack-definitions');

const ROOT = path.join(__dirname, '..');
const CONTRACT_DIR = path.join(ROOT, 'docs', 'contract');
const EXAMPLES_DIR = path.join(CONTRACT_DIR, 'examples');
const SNAPSHOT_PATH = path.join(CONTRACT_DIR, 'registry-snapshot.json');
const DOC_PATH = path.join(CONTRACT_DIR, 'TEMPLATE-CONTRACT.md');
const EVIDENCE_PATH = path.join(CONTRACT_DIR, 'evidence', 'check-report.json');

function parseArgs(argv) {
  return {
    static: argv.includes('--static'),
    json: argv.includes('--json'),
    updateRegistry: argv.includes('--update-registry'),
  };
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ---- registry digest: the single source of truth is src/schema.js --------
function buildRegistryDigest() {
  return {
    contractVersion: '2026-03',
    topLevel: {
      required: ['id', 'name', 'width', 'height', 'fps', 'duration', 'font', 'slots', 'variables', 'nodes'],
      width: { min: 2, max: 7680, integer: true },
      height: { min: 2, max: 4320, integer: true },
      fps: { min: 1, max: 240 },
      duration: { min: 0.1, max: 600, unit: 'seconds' },
      font: { family: 'non-empty string', weight: ['normal', 'bold', 'optional'] },
    },
    paramTypes: ['number', 'string', 'enum', 'color', 'slotRef', 'variableRef'],
    nodeTypes: JSON.parse(JSON.stringify(NODE_TYPES)),
  };
}

// Every code the implementation actually raises, mapped to the source stage.
const DOCUMENTED_CODES = [
  ['TEMPLATE_SHAPE', 'schema.js'], ['SLOT_SHAPE', 'schema.js'], ['SLOT_DUPLICATE', 'schema.js'],
  ['VARIABLE_SHAPE', 'schema.js'], ['VARIABLE_DUPLICATE', 'schema.js'],
  ['NODE_SHAPE', 'schema.js'], ['NODE_DUPLICATE', 'schema.js'], ['NODE_TYPE_UNKNOWN', 'schema.js'],
  ['NODE_INPUTS', 'schema.js'], ['PARAM_MISSING', 'schema.js'], ['PARAM_TYPE', 'schema.js'],
  ['PARAM_UNKNOWN', 'schema.js'], ['REF_MISSING', 'schema.js'], ['REF_INVALID', 'schema.js'],
  ['REF_CYCLE', 'schema.js'], ['OUTPUT_COUNT', 'schema.js'],
  ['TIME_WINDOW', 'timeline.js'], ['TIME_OUT_OF_RANGE', 'timeline.js'],
  ['TRANSITION_OVERLAP', 'timeline.js'], ['TRANSITION_LENGTH', 'timeline.js'],
  ['LAYER_OUT_OF_BOUNDS', 'timeline.js'],
  ['ASSET_MISSING', 'assets.js'], ['ASSET_NOT_FOUND', 'assets.js'], ['ASSET_FILE_GONE', 'assets.js'],
  ['ASSET_UNREADABLE', 'assets.js'], ['ASSET_DIMENSIONS', 'assets.js'],
  ['ASSET_DURATION', 'assets.js'], ['ASSET_DURATION_SHORT', 'assets.js'],
  ['ASSET_ALPHA', 'assets.js'], ['SLOT_UNKNOWN', 'assets.js'],
  ['VARIABLE_EMPTY', 'text.js'], ['VARIABLE_TOO_LONG', 'text.js'],
  ['TEXT_OVERFLOW', 'text.js'], ['FONT_NOT_FOUND', 'text.js'],
];

// ---- minimal in-memory asset store, identical shape to the server store ---
function createMemoryAssetStore() {
  const records = new Map();
  return {
    register(record) { records.set(record.id, record); return record; },
    get(id) { return records.get(id) || null; },
    list() { return [...records.values()]; },
  };
}

async function registerAssets(packId, fileMap, packAssets = {}) {
  const assetStore = createMemoryAssetStore();
  const bindings = {};
  for (const [slotId, file] of Object.entries(fileMap)) {
    const source = packAssets[slotId] || { pack: packId, file };
    const filePath = path.join(ROOT, 'packs', source.pack, 'assets', source.file);
    if (!fs.existsSync(filePath)) throw new Error(`example asset missing on disk: ${filePath}`);
    const id = `${source.pack}_${path.parse(source.file).name}`;
    assetStore.register({ id, path: filePath, originalName: source.file, probe: await probeMedia(filePath) });
    bindings[slotId] = id;
  }
  return { assetStore, bindings };
}

function loadExamples() {
  return fs.readdirSync(EXAMPLES_DIR)
    .filter((f) => /^\d{2}-.*\.json$/.test(f))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(EXAMPLES_DIR, f), 'utf8')));
}

// Renders a validated template and returns the independent probe evidence.
async function renderAndProbe(template, variables, bindings, assetStore) {
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-'));
  try {
    const { images } = prepareTextImages(template, variables, jobDir);
    const graph = compileGraph(template, bindings, assetStore, [], jobDir, { textImages: images });
    const out = path.join(jobDir, 'output.mp4');
    await spawnFile(FFMPEG, [...graph.argv.slice(1), out], { cwd: jobDir });
    const verification = await verifyOutput(out, template);
    return { verification, probe: verification.probe, jobDir, graph };
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}

function makeCollector() {
  const failures = [];
  const checks = [];
  return {
    check(name, condition, detail = '') {
      checks.push({ name, ok: Boolean(condition), detail: String(detail) });
      if (!condition) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    },
    fail(name, detail) { this.check(name, false, detail); },
    get ok() { return failures.length === 0; },
    failures,
    checks,
  };
}

// ---- check 1: registry snapshot must match src/schema.js exactly ----------
function checkRegistry(col, args) {
  const digest = buildRegistryDigest();
  if (args.updateRegistry) {
    const snapshot = { generatedBy: 'scripts/check-contract.js --update-registry', ...digest };
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2) + '\n');
    col.check('registry snapshot updated', true, SNAPSHOT_PATH);
    return;
  }
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    col.fail('registry snapshot exists', SNAPSHOT_PATH);
    return;
  }
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
  const { generatedBy, ...snapshotBody } = snapshot;
  col.check(
    'registry snapshot equals src/schema.js NODE_TYPES',
    JSON.stringify(snapshotBody) === JSON.stringify(digest),
    'run `node scripts/check-contract.js --update-registry` after a registry change',
  );
  col.check(
    'registry node types stay the five-node whitelist',
    Object.keys(NODE_TYPES).sort().join(',') === 'background,endcard,logo,output,text',
    Object.keys(NODE_TYPES).sort().join(','),
  );
}

// ---- check 2: the markdown document covers the whole living contract ------
function checkDocumentation(col) {
  const doc = fs.readFileSync(DOC_PATH, 'utf8');
  for (const type of Object.keys(NODE_TYPES)) col.check(`doc describes node "${type}"`, doc.includes(`\`${type}\``));
  for (const paramType of ['number', 'string', 'enum', 'color', 'slotRef', 'variableRef']) {
    col.check(`doc describes param type "${paramType}"`, doc.includes(`\`${paramType}\``));
  }
  for (const [code, stage] of DOCUMENTED_CODES) {
    col.check(`doc documents diagnostic "${code}" (${stage})`, doc.includes(code));
  }
  for (const rule of LEGACY_RULES) {
    col.check(`doc documents legacy field "${rule.scope}.${rule.field}" migration`, doc.includes(rule.field) && doc.includes(rule.replacement));
  }
  for (const constraint of ['minDuration', 'LAYER_OUT_OF_BOUNDS', 'TRANSITION_OVERLAP', 'TIME_OUT_OF_RANGE', '1280', '720', '300']) {
    col.check(`doc covers constraint/evidence "${constraint}"`, doc.includes(String(constraint)));
  }
}

// ---- check 3: every example really triggers its documented outcome --------
async function checkExamples(col, args) {
  const examples = loadExamples();
  col.check('example suite is non-empty', examples.length >= 6, `found ${examples.length}`);
  const kinds = new Set(examples.map((e) => e.kind));
  for (const kind of ['positive', 'negative', 'migration']) {
    col.check(`suite contains a "${kind}" example`, kinds.has(kind));
  }

  const evidence = [];
  for (const ex of examples) {
    const prefix = `example ${ex.id}`;

    // Guard against "default value pretends to pass": every example must
    // declare explicit, non-empty expectations before anything is executed.
    col.check(`${prefix}: declares an explicit expect block`,
      isPlainObject(ex.expect) && Object.keys(ex.expect).length > 0);
    if (ex.kind === 'negative') {
      col.check(`${prefix}: negative example names >=1 expected diagnostic`,
        Array.isArray(ex.expect.errors) && ex.expect.errors.length > 0,
        'an empty error list would make rejection unprovable');
      col.check(`${prefix}: negative example forbids rendering`, ex.expect.render === false);
    } else {
      col.check(`${prefix}: ${ex.kind} example requires a real render`, ex.expect.render === true);
      col.check(`${prefix}: ${ex.kind} example pins deliverable width/height`,
        isPlainObject(ex.expect.renderSize)
          && Number.isInteger(ex.expect.renderSize.width)
          && Number.isInteger(ex.expect.renderSize.height));
      col.check(`${prefix}: ${ex.kind} example pins deliverable duration`,
        Number.isFinite(ex.expect.renderDuration) && ex.expect.renderDuration > 0);
    }

    const { assetStore, bindings: fullBindings } = await registerAssets(ex.pack, ex.bindings, ex.packAssets);
    for (const slotId of ex.unbind || []) delete fullBindings[slotId];

    let template = ex.template;

    // migration examples are rejected by the current schema until migrated
    if (ex.kind === 'migration') {
      const legacy = findLegacyFields(template);
      const legacyRefs = legacy.map((l) => `${l.scope}.${l.id ? `${l.id}.` : ''}${l.field}`);
      col.check(`${prefix}: expected legacy fields detected`,
        legacy.length === (ex.expectLegacy.legacyFields.length),
        `got ${JSON.stringify(legacyRefs)}`);
      for (const ref of ex.expectLegacy.legacyFields) {
        col.check(`${prefix}: legacy occurrence "${ref}"`, legacyRefs.includes(ref));
      }
      const preShape = validateTemplateShape(template);
      col.check(`${prefix}: legacy template is rejected before migration`, !preShape.ok);
      const migration = migrateTemplate(template);
      col.check(`${prefix}: migration removed every legacy field`, findLegacyFields(migration.template).length === 0);
      const postShape = validateTemplateShape(migration.template);
      col.check(`${prefix}: migrated template passes shape validation`, postShape.ok, JSON.stringify(postShape.errors));
      template = migration.template;
      evidence.push({ example: ex.id, kind: ex.kind, migration: migration.changes });
    }

    const validation = await validateTemplate(template, ex.variables, fullBindings, assetStore);
    const codes = validation.errors.map((e) => e.code);

    if (ex.kind === 'negative') {
      col.check(`${prefix}: validation rejects`, !validation.ok, `codes=${codes.join(',')}`);
      for (const expected of ex.expect.errors) {
        col.check(`${prefix}: emits documented code "${expected}"`, codes.includes(expected), `codes=${codes.join(',')}`);
      }
      const allLocated = validation.errors.every((e) => e.nodeId || e.slotId || e.variableId || e.path);
      if (ex.expect.locatable) col.check(`${prefix}: every diagnostic carries a location`, allLocated);
      if (ex.expect.messagePattern) {
        const hit = validation.errors.some((e) => e.message.includes(ex.expect.messagePattern));
        col.check(`${prefix}: message contains "${ex.expect.messagePattern}"`, hit);
      }
      if (ex.expect.overflow) {
        const ov = validation.errors.find((e) => e.code === 'TEXT_OVERFLOW');
        col.check(`${prefix}: TEXT_OVERFLOW carries measured evidence`,
          ov && ov.lines === ex.expect.overflow.lines
            && ov.measuredHeight === ex.expect.overflow.measuredHeight
            && ov.boxHeight === ex.expect.overflow.boxHeight
            && ov.nodeId === ex.expect.overflow.nodeId,
          ov ? JSON.stringify({ lines: ov.lines, measuredHeight: ov.measuredHeight }) : 'no overflow error');
      }
      col.check(`${prefix}: negative case is never rendered`, ex.expect.render === false);
      evidence.push({ example: ex.id, kind: ex.kind, rejected: !validation.ok, codes, errors: validation.errors });
      continue;
    }

    // positive / migrated cases: must validate AND render AND pass an
    // independent probe matching the documented deliverable dimensions.
    col.check(`${prefix}: validation passes`, validation.ok, JSON.stringify(validation.errors));
    if (args.static) {
      evidence.push({ example: ex.id, kind: ex.kind, validated: validation.ok, rendered: false, reason: '--static' });
      continue;
    }
    const { verification, probe } = await renderAndProbe(template, ex.variables, fullBindings, assetStore);
    col.check(`${prefix}: independent render verification passes`, verification.ok, verification.problems.join('; '));
    col.check(`${prefix}: deliverable width matches doc`,
      probe.width === ex.expect.renderSize.width && probe.height === ex.expect.renderSize.height,
      `probe=${probe.width}x${probe.height}`);
    col.check(`${prefix}: deliverable duration matches doc`,
      Math.abs(probe.duration - ex.expect.renderDuration) <= 0.12,
      `probe=${probe.duration}s expected=${ex.expect.renderDuration}s`);
    evidence.push({
      example: ex.id,
      kind: ex.kind,
      validated: true,
      rendered: true,
      probe: { width: probe.width, height: probe.height, duration: probe.duration, pixFmt: probe.pixFmt, codec: probe.codec },
      expected: ex.expect.renderSize ? { ...ex.expect.renderSize, duration: ex.expect.renderDuration } : undefined,
    });
  }
  return evidence;
}

// ---- check 4: the brand templates in data/ equal the compiler base --------
function checkBrandBaseline(col) {
  const dataTemplatesDir = path.join(ROOT, 'data', 'templates');
  if (!fs.existsSync(dataTemplatesDir)) {
    col.check('data/templates present (run npm run bootstrap)', false, 'directory missing');
    return;
  }
  for (const packId of Object.keys(packs)) {
    const file = path.join(dataTemplatesDir, `${packId}_ad.json`);
    if (!fs.existsSync(file)) { col.fail(`${packId} default template exists`, file); continue; }
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    const expected = baseTemplate(`${packId}_ad`, `${packs[packId].label} template`, packs[packId].color);
    col.check(`data/templates/${packId}_ad.json equals compiler baseTemplate`,
      JSON.stringify(onDisk) === JSON.stringify(expected));
    // stale fields are not allowed to linger in default templates
    col.check(`${packId} default template contains no legacy fields`,
      findLegacyFields(onDisk).length === 0,
      JSON.stringify(findLegacyFields(onDisk).map((l) => l.field)));
  }
}

// ---- check 5: canonical doc example is byte-identical to the compiler base -
function checkCanonicalExample(col) {
  const canonical = JSON.parse(fs.readFileSync(path.join(EXAMPLES_DIR, '01-canonical.json'), 'utf8'));
  const expected = baseTemplate('aurora_ad', `${packs.aurora.label} template`, packs.aurora.color);
  col.check('01-canonical.json template equals compiler baseTemplate("aurora_ad")',
    JSON.stringify(canonical.template) === JSON.stringify(expected));
  col.check('canonical bindings match the aurora pack assets',
    JSON.stringify(canonical.bindings) === JSON.stringify(packs.aurora.assets));
  col.check('canonical variables match the aurora pack variables',
    JSON.stringify(canonical.variables) === JSON.stringify(packs.aurora.variables));
}

// ---- check 6: generated examples are reproducible from the generator ------
function checkGeneratedExamples(col) {
  const before = new Map(
    fs.readdirSync(EXAMPLES_DIR).filter((f) => /^\d{2}-.*\.json$/.test(f))
      .map((f) => [f, fs.readFileSync(path.join(EXAMPLES_DIR, f), 'utf8')]),
  );
  require(path.join(EXAMPLES_DIR, 'generate-examples.js'));
  for (const [file, oldContent] of before) {
    const now = fs.readFileSync(path.join(EXAMPLES_DIR, file), 'utf8');
    col.check(`generated example ${file} is reproducible (re-run generator)`, now === oldContent);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  initFonts();
  const col = makeCollector();

  checkRegistry(col, args);
  if (args.updateRegistry) {
    process.stdout.write(args.json ? JSON.stringify({ ok: col.ok, checks: col.checks }, null, 2) : 'registry snapshot updated\n');
    process.exit(col.ok ? 0 : 1);
  }
  checkDocumentation(col);
  checkCanonicalExample(col);
  checkGeneratedExamples(col);
  const evidence = await checkExamples(col, args);
  checkBrandBaseline(col);

  const report = {
    at: new Date().toISOString(),
    mode: args.static ? 'static' : 'full',
    ok: col.ok,
    failureCount: col.failures.length,
    failures: col.failures,
    checks: col.checks,
    evidence,
  };
  fs.mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
  fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(report, null, 2) + '\n');

  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    const passed = col.checks.filter((c) => c.ok).length;
    for (const c of col.checks) console.log(`[${c.ok ? 'PASS' : 'FAIL'}] ${c.name}${c.detail && !c.ok ? ` — ${c.detail}` : ''}`);
    console.log(`\n${passed}/${col.checks.length} checks passed; evidence -> ${path.relative(ROOT, EVIDENCE_PATH)}`);
    if (!col.ok) {
      console.error(`\ncontract check failed:\n - ${col.failures.join('\n - ')}`);
    }
  }
  process.exit(col.ok ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { buildRegistryDigest, DOCUMENTED_CODES, loadExamples, renderAndProbe };
