'use strict';

// Loads the three brand packages into a running-style data root:
// probes and registers every media asset, saves templates and variable
// tables, so the web editor has real material immediately.

const fs = require('fs');
const path = require('path');
const { initFonts } = require('../src/fonts');
const { JsonStore, AssetStore } = require('../src/store');
const { probeMedia } = require('../src/probe');
const { packs, baseTemplate } = require('./pack-definitions');

async function main() {
  initFonts();
  const dataRoot = process.env.DATA_ROOT || path.join(__dirname, '..', 'data');
  const store = new JsonStore(dataRoot);
  const assetStore = new AssetStore(dataRoot);
  const packsRoot = path.join(__dirname, '..', 'packs');

  for (const [packId, pack] of Object.entries(packs)) {
    const template = baseTemplate(`${packId}_ad`, `${pack.label} template`, pack.color);
    store.saveTemplate(template);
    store.saveVariableTable({
      id: `${packId}_canonical_vars`,
      templateId: template.id,
      values: pack.variables,
    });

    const bindings = {};
    for (const [slotId, file] of Object.entries(pack.assets)) {
      const filePath = path.join(packsRoot, packId, 'assets', file);
      const info = await probeMedia(filePath);
      const record = assetStore.register(file, path.extname(file), info);
      fs.copyFileSync(filePath, record.path);
      bindings[slotId] = record.id;
    }
    store.saveVariableTable({
      id: `${packId}_canonical_bindings`,
      templateId: template.id,
      kind: 'bindings',
      values: bindings,
    });
    console.log(`${packId}: template + ${Object.keys(bindings).length} assets registered`);
  }
  console.log('bootstrap complete at', dataRoot);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
