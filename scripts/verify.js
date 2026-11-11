'use strict';

// Independent acceptance for every brand package:
//  - re-render from the frozen template into a fresh throwaway directory
//  - probe the deliverable with a separate ffprobe process (duration + size)
//  - compare every decoded frame against the frozen frame hashes

const fs = require('fs');
const path = require('path');
const { validateTemplate } = require('../src/render');
const { compileGraph } = require('../src/compiler');
const { initFonts } = require('../src/fonts');
const { prepareTextImages } = require('../src/text-render');
const { spawnFile } = require('../src/process');
const { FFMPEG, probeMedia } = require('../src/probe');
const { packs } = require('./pack-definitions');
const { packDir, createMemoryAssetStore, registerPackAssets, templateFor } = require('./pack-harness');
const { frameHashes, hashFrames } = require('./freeze');

async function verifyPack(packId) {
  const dir = packDir(packId);
  const frozenPath = path.join(dir, 'renders', 'frozen.json');
  if (!fs.existsSync(frozenPath)) throw new Error(`${packId}: frozen.json missing — run npm run freeze first`);
  const frozen = JSON.parse(fs.readFileSync(frozenPath, 'utf8'));

  const assetStore = createMemoryAssetStore();
  const bindings = await registerPackAssets(assetStore, packId);
  const template = templateFor(packId);
  const variables = packs[packId].variables;

  const validation = await validateTemplate(template, variables, bindings, assetStore);
  if (!validation.ok) throw new Error(`${packId}: template no longer validates`);

  const workDir = path.join(dir, 'renders', `verify_${Date.now().toString(36)}`);
  fs.mkdirSync(workDir, { recursive: true });
  const { images: textImages } = prepareTextImages(template, variables, workDir);
  const graph = compileGraph(template, bindings, assetStore, validation.measurements, workDir, { textImages });
  const out = path.join(workDir, 'verify.mp4');
  await spawnFile(FFMPEG, [...graph.argv.slice(1), out], { cwd: workDir });

  // 1. independent probe of the deliverable
  const probe = await probeMedia(out);
  const durationDelta = Math.abs(probe.duration - template.duration);
  const sizeOk = probe.width === template.width && probe.height === template.height;
  const durationOk = durationDelta <= 0.12;

  // 2. frame-by-frame hash match against the frozen render (same routine)
  const hashes = await frameHashes(out);
  const hashSha = await hashFrames(out);
  const framesOk = hashSha === frozen.frameHashSha256 && hashes.length === frozen.frameHashCount;

  const result = {
    packId,
    probe: { width: probe.width, height: probe.height, duration: probe.duration, pixFmt: probe.pixFmt, codec: probe.codec },
    expected: { width: template.width, height: template.height, duration: template.duration },
    durationDelta: Number(durationDelta.toFixed(3)),
    sizeOk,
    durationOk,
    frames: { expected: frozen.frameHashCount, actual: hashes.length, match: framesOk },
    frozenSha256: frozen.frameHashSha256,
    actualSha256: hashSha,
    ok: sizeOk && durationOk && framesOk,
  };
  fs.rmSync(workDir, { recursive: true, force: true });
  return result;
}

async function main() {
  initFonts();
  const results = [];
  let allOk = true;
  for (const packId of Object.keys(packs)) {
    const r = await verifyPack(packId);
    results.push(r);
    allOk = allOk && r.ok;
    console.log(
      `[${r.ok ? 'PASS' : 'FAIL'}] ${r.packId}: ${r.probe.width}x${r.probe.height} ` +
      `${r.probe.duration}s (Δ${r.durationDelta}s), frames ${r.frames.actual}/${r.frames.expected} match=${r.frames.match}`,
    );
  }
  fs.writeFileSync(
    path.join(path.dirname(packDir('aurora')), 'verify-report.json'),
    JSON.stringify({ at: new Date().toISOString(), allOk, results }, null, 2),
  );
  if (!allOk) process.exit(1);
  console.log('\nall deliverables match frozen templates');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { verifyPack };
