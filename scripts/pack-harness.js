'use strict';

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');
const { probeMedia } = require('../src/probe');
const { spawnFile } = require('../src/process');
const { FFMPEG } = require('../src/probe');
const { baseTemplate, packs, invalidTemplates } = require('./pack-definitions');

const PACKS_ROOT = path.join(__dirname, '..', 'packs');

function packDir(packId) {
  return path.join(PACKS_ROOT, packId);
}

// Minimal asset store backed by a plain map; records have the same shape as
// the server-side AssetStore so the compiler cannot tell the difference.
function createMemoryAssetStore() {
  const records = new Map();
  return {
    register(record) { records.set(record.id, record); return record; },
    get(id) { return records.get(id) || null; },
    list() { return [...records.values()]; },
  };
}

async function registerPackAssets(assetStore, packId, overrides = {}) {
  const pack = packs[packId];
  const bindings = {};
  for (const [slotId, file] of Object.entries(pack.assets)) {
    const realFile = overrides[slotId] || file;
    const filePath = path.join(packDir(packId), 'assets', realFile);
    const id = `${packId}_${path.parse(realFile).name}`;
    const info = await probeMedia(filePath);
    assetStore.register({ id, path: filePath, originalName: realFile, probe: info });
    bindings[slotId] = id;
  }
  return bindings;
}

async function flattenAlpha(assetStore, packId, bindings, slotId) {
  const record = assetStore.get(bindings[slotId]);
  const flatPath = path.join(packDir(packId), 'assets', 'flattened_rgb.png');
  // re-encode as rgb24 so ffprobe reports no alpha channel
  await spawnFile(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-i', record.path, '-pix_fmt', 'rgb24', flatPath]);
  const info = await probeMedia(flatPath);
  const id = `${packId}_flattened`;
  assetStore.register({ id, path: flatPath, originalName: 'flattened_rgb.png', probe: info });
  return { ...bindings, [slotId]: id };
}

function templateFor(packId, mutated) {
  const t = baseTemplate(`${packId}_ad`, `${packs[packId].label} template`, packs[packId].color);
  if (mutated) return mutated;
  return t;
}

function applyPatch(template, patch) {
  const copy = JSON.parse(JSON.stringify(template));
  const node = copy.nodes.find((n) => n.id === patch.node);
  if (patch.type) node.type = patch.type;
  if (patch.inputs) node.inputs = patch.inputs;
  return copy;
}

async function buildCaseContext(packId, caseDef) {
  const assetStore = createMemoryAssetStore();
  let template = templateFor(packId);
  let bindings = await registerPackAssets(assetStore, packId, caseDef.assetsOverride);
  let variables = { ...packs[packId].variables, ...(caseDef.variables || {}) };

  if (caseDef.invalidTemplate) {
    template = invalidTemplates[caseDef.invalidTemplate]();
  }
  if (caseDef.patch) {
    template = applyPatch(template, caseDef.patch);
  }
  if (caseDef.flattenAlpha) {
    bindings = await flattenAlpha(assetStore, packId, bindings, caseDef.flattenAlpha);
  }
  if (caseDef.unbind) {
    bindings = { ...bindings };
    for (const slotId of caseDef.unbind) delete bindings[slotId];
  }
  return { template, bindings, variables, assetStore };
}

function writeManifest(packId, extra) {
  const pack = packs[packId];
  const manifest = {
    packId,
    label: pack.label,
    canonical: {
      templateId: `${packId}_ad`,
      variables: pack.variables,
      bindings: pack.assets,
    },
    cases: pack.cases,
    ...extra,
  };
  fs.writeFileSync(path.join(packDir(packId), 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

module.exports = {
  PACKS_ROOT,
  packDir,
  createMemoryAssetStore,
  registerPackAssets,
  buildCaseContext,
  templateFor,
  writeManifest,
};
