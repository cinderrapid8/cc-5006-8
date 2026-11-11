'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, assert, minimalTemplate, makeMemoryAssetStore, registerAuroraAssets, fixturesExist, auroraVariables } = require('./helpers');
const { validateTemplate, verifyOutput } = require('../src/render');
const { prepareTextImages } = require('../src/text-render');
const { compileGraph } = require('../src/compiler');
const { spawnFile } = require('../src/process');
const { FFMPEG, probeMedia } = require('../src/probe');

function tmpJob() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'adcomp-e2e-'));
}

test('full pipeline renders an mp4 whose duration and size pass an independent probe',
  { skip: !fixturesExist(), timeout: 180000 },
  async () => {
    const tpl = minimalTemplate();
    const store = makeMemoryAssetStore();
    const bindings = await registerAuroraAssets(store);
    const validation = await validateTemplate(tpl, auroraVariables, bindings, store);
    assert.equal(validation.ok, true, JSON.stringify(validation.errors));

    const jobDir = tmpJob();
    const { images } = prepareTextImages(tpl, auroraVariables, jobDir);
    const graph = compileGraph(tpl, bindings, store, validation.measurements, jobDir, { textImages: images });
    const out = path.join(jobDir, 'output.mp4');
    await spawnFile(FFMPEG, [...graph.argv.slice(1), out], { cwd: jobDir });

    const verification = await verifyOutput(out, tpl);
    assert.equal(verification.ok, true, JSON.stringify(verification.problems));
    assert.equal(verification.probe.width, 1280);
    assert.equal(verification.probe.height, 720);
    assert.ok(Math.abs(verification.probe.duration - 10) <= 0.12);

    // alpha was flattened for h264 delivery
    assert.equal(verification.probe.pixFmt, 'yuv420p');
  });

test('preview frame is a valid PNG rendered with the same graph path',
  { skip: !fixturesExist(), timeout: 120000 },
  async () => {
    const tpl = minimalTemplate();
    const store = makeMemoryAssetStore();
    const bindings = await registerAuroraAssets(store);
    const validation = await validateTemplate(tpl, auroraVariables, bindings, store);
    const jobDir = tmpJob();
    const { images } = prepareTextImages(tpl, auroraVariables, jobDir);
    const graph = compileGraph(tpl, bindings, store, validation.measurements, jobDir, { textImages: images, previewAt: 4 });
    const out = path.join(jobDir, 'preview.png');
    await spawnFile(FFMPEG, [...graph.argv.slice(1), '-ss', '4', out], { cwd: jobDir });
    const info = await probeMedia(out);
    assert.equal(info.width, 1280);
    assert.equal(info.height, 720);
  });

test('invalid template never reaches ffmpeg in the full pipeline', { skip: !fixturesExist() }, async () => {
  const tpl = minimalTemplate();
  tpl.nodes[2].params.x = 900;
  tpl.nodes[2].params.width = 1120; // out of bounds
  const store = makeMemoryAssetStore();
  const bindings = await registerAuroraAssets(store);
  const validation = await validateTemplate(tpl, auroraVariables, bindings, store);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((e) => e.code === 'LAYER_OUT_OF_BOUNDS'));
});
