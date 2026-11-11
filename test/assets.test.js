'use strict';

const fs = require('fs');
const path = require('path');
const { test, assert, minimalTemplate, makeMemoryAssetStore, registerAuroraAssets, fixturesExist } = require('./helpers');
const { validateBindings } = require('../src/assets');
const { spawnFile } = require('../src/process');
const { FFMPEG } = require('../src/probe');

test('missing required slot blocks with ASSET_MISSING (no placeholder)', { skip: !fixturesExist() }, async () => {
  const tpl = minimalTemplate();
  const store = makeMemoryAssetStore();
  const bindings = await registerAuroraAssets(store);
  delete bindings.logo;
  const { report } = await validateBindings(tpl, bindings, store);
  const err = report.errors.find((e) => e.code === 'ASSET_MISSING');
  assert.ok(err);
  assert.equal(err.slotId, 'logo');
});

test('binding to unknown asset id is rejected', { skip: !fixturesExist() }, async () => {
  const tpl = minimalTemplate();
  const store = makeMemoryAssetStore();
  const bindings = await registerAuroraAssets(store);
  bindings.logo = 'ast_vanished';
  const { report } = await validateBindings(tpl, bindings, store);
  assert.ok(report.errors.some((e) => e.code === 'ASSET_NOT_FOUND'));
});

test('short background fails minDuration with measured seconds', { skip: !fixturesExist() }, async () => {
  const tpl = minimalTemplate();
  const store = makeMemoryAssetStore();
  const bindings = await registerAuroraAssets(store);
  const cobaltPath = path.join(__dirname, '..', 'packs', 'cobalt', 'assets', 'bg6.mp4');
  const { probeMedia } = require('../src/probe');
  store.register({ id: 'ast_background_bg6', path: cobaltPath, originalName: 'bg6.mp4', probe: await probeMedia(cobaltPath) });
  bindings.background = 'ast_background_bg6';
  const { report } = await validateBindings(tpl, bindings, store);
  const err = report.errors.find((e) => e.code === 'ASSET_DURATION_SHORT');
  assert.ok(err);
  assert.match(err.message, /6\.000s/);
  assert.equal(err.slotId, 'background');
});

test('logo without alpha channel fails ASSET_ALPHA', { skip: !fixturesExist() }, async () => {
  const tpl = minimalTemplate();
  const store = makeMemoryAssetStore();
  const bindings = await registerAuroraAssets(store);
  const flat = path.join(__dirname, '..', 'packs', 'aurora', 'assets', '_test_flat.png');
  await spawnFile(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-i',
    path.join(__dirname, '..', 'packs', 'aurora', 'assets', 'logo.png'), '-pix_fmt', 'rgb24', flat]);
  const { probeMedia } = require('../src/probe');
  store.register({ id: 'ast_flat', path: flat, originalName: 'flat.png', probe: await probeMedia(flat) });
  bindings.logo = 'ast_flat';
  const { report } = await validateBindings(tpl, bindings, store);
  assert.ok(report.errors.some((e) => e.code === 'ASSET_ALPHA'));
  fs.rmSync(flat, { force: true });
});

test('dimension mismatch is rejected', { skip: !fixturesExist() }, async () => {
  const tpl = minimalTemplate();
  const store = makeMemoryAssetStore();
  const bindings = await registerAuroraAssets(store);
  // endcard slot expects 1280x720; point it at the 320x180 logo instead
  bindings.endcard = bindings.logo;
  const { report } = await validateBindings(tpl, bindings, store);
  assert.ok(report.errors.some((e) => e.code === 'ASSET_DIMENSIONS' && e.slotId === 'endcard'));
});

test('binding to undeclared slot is rejected', { skip: !fixturesExist() }, async () => {
  const tpl = minimalTemplate();
  const store = makeMemoryAssetStore();
  const bindings = await registerAuroraAssets(store);
  bindings.ghostSlot = bindings.logo;
  const { report } = await validateBindings(tpl, bindings, store);
  assert.ok(report.errors.some((e) => e.code === 'SLOT_UNKNOWN'));
});

test('complete correct bindings pass', { skip: !fixturesExist() }, async () => {
  const tpl = minimalTemplate();
  const store = makeMemoryAssetStore();
  const bindings = await registerAuroraAssets(store);
  const { report, probes } = await validateBindings(tpl, bindings, store);
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.ok(probes.background && probes.logo && probes.endcard);
});
