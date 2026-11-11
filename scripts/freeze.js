'use strict';

// Freezes the three brand packages:
//  1. validates + renders each canonical template to renders/frozen.mp4
//  2. independently probes duration/size and records frame hashes
//  3. executes every negative case and asserts the expected error codes
//
// Re-running this script must produce byte-identical frame hashes.

const fs = require('fs');
const path = require('path');
const { validateTemplate } = require('../src/render');
const { compileGraph } = require('../src/compiler');
const { initFonts } = require('../src/fonts');
const { prepareTextImages } = require('../src/text-render');
const { spawnFile } = require('../src/process');
const { FFMPEG, probeMedia } = require('../src/probe');
const { packs } = require('./pack-definitions');
const {
  packDir, createMemoryAssetStore, registerPackAssets, templateFor,
  buildCaseContext, writeManifest,
} = require('./pack-harness');

// Single authoritative frame-hash routine. Both freeze and verify must call
// this exact function so byte-identical frames always map to one hash.
async function frameHashes(videoPath) {
  const args = ['-hide_banner', '-loglevel', 'error', '-i', videoPath, '-an', '-f', 'framemd5', 'pipe:1'];
  const { stdout } = await spawnFile(FFMPEG, args);
  // normalise line endings and drop comment/blank lines before hashing
  return stdout.replace(/\r\n/g, '\n').split('\n').filter((l) => l && !l.startsWith('#'));
}

async function hashFrames(videoPath) {
  const lines = await frameHashes(videoPath);
  return require('crypto').createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
}

async function renderFrozen(packId) {
  const assetStore = createMemoryAssetStore();
  const template = templateFor(packId);
  const bindings = await registerPackAssets(assetStore, packId);
  const variables = packs[packId].variables;

  const validation = await validateTemplate(template, variables, bindings, assetStore);
  if (!validation.ok) {
    throw new Error(`canonical template for ${packId} failed validation: ${JSON.stringify(validation.errors)}`);
  }

  const workDir = path.join(packDir(packId), 'renders', 'work');
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  const { images: textImages } = prepareTextImages(template, variables, workDir);
  const graph = compileGraph(template, bindings, assetStore, validation.measurements, workDir, { textImages });

  const out = path.join(packDir(packId), 'renders', 'frozen.mp4');
  const argv = [...graph.argv.slice(1), out];
  await spawnFile(FFMPEG, argv, { cwd: workDir });

  const probe = await probeMedia(out);
  const hashes = await frameHashes(out);
  const frameHashSha256 = await hashFrames(out);
  const frozen = {
    template: JSON.parse(JSON.stringify(template)),
    variables,
    output: 'renders/frozen.mp4',
    frameHashCount: hashes.length,
    frameHashSha256,
    probe: {
      width: probe.width,
      height: probe.height,
      duration: probe.duration,
      codec: probe.codec,
      pixFmt: probe.pixFmt,
    },
    frozenAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(packDir(packId), 'renders', 'frozen.json'), JSON.stringify(frozen, null, 2));
  return frozen;
}

async function runNegativeCases(packId) {
  const results = [];
  for (const caseDef of packs[packId].cases) {
    const ctx = await buildCaseContext(packId, caseDef);
    const validation = await validateTemplate(ctx.template, ctx.variables, ctx.bindings, ctx.assetStore);
    const codes = validation.errors.map((e) => e.code);
    const matched = caseDef.expectErrors.every((expected) => codes.includes(expected));
    results.push({
      caseId: caseDef.id,
      desc: caseDef.desc,
      rejected: !validation.ok,
      expected: caseDef.expectErrors,
      actualCodes: codes,
      locatable: validation.errors.every((e) => e.nodeId || e.slotId || e.variableId || e.path),
      matched,
      errors: validation.errors,
    });
    if (!matched) {
      throw new Error(`pack ${packId} case ${caseDef.id} expected ${caseDef.expectErrors}, got ${codes}`);
    }
    if (!results[results.length - 1].locatable) {
      throw new Error(`pack ${packId} case ${caseDef.id} produced an error without a location`);
    }
  }
  return results;
}

async function main() {
  initFonts();
  const summary = {};
  for (const packId of Object.keys(packs)) {
    console.log(`\n== ${packId}: freezing canonical render ==`);
    const frozen = await renderFrozen(packId);
    console.log(`   ${frozen.probe.width}x${frozen.probe.height} ${frozen.probe.duration}s, ${frozen.frameHashCount} frames, sha256 ${frozen.frameHashSha256.slice(0, 16)}…`);

    console.log(`== ${packId}: negative cases ==`);
    const caseResults = await runNegativeCases(packId);
    for (const r of caseResults) {
      console.log(`   [${r.matched ? 'OK' : 'FAIL'}] ${r.caseId}: ${r.actualCodes.join(', ')}`);
    }
    writeManifest(packId, { frozen: { output: frozen.output, probe: frozen.probe, frameHashSha256: frozen.frameHashSha256, frameHashCount: frozen.frameHashCount }, caseResults });
    summary[packId] = { frozen, cases: caseResults.length };
  }
  console.log('\nall packs frozen and negative cases passed');
  return summary;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { renderFrozen, runNegativeCases, frameHashes, hashFrames };
