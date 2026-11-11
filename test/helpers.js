'use strict';

const fs = require('fs');
const path = require('path');
const { initFonts } = require('../src/fonts');
const { probeMedia } = require('../src/probe');

initFonts();

const FIXTURES = path.join(__dirname, '..', 'packs');

function makeMemoryAssetStore() {
  const records = new Map();
  return {
    register(record) { records.set(record.id, record); return record; },
    get(id) { return records.get(id) || null; },
    list() { return [...records.values()]; },
  };
}

async function registerAuroraAssets(store, overrides = {}) {
  const files = {
    background: 'bg12.mp4',
    logo: 'logo.png',
    endcard: 'endcard.png',
    ...overrides,
  };
  const bindings = {};
  for (const [slot, file] of Object.entries(files)) {
    const filePath = path.join(FIXTURES, 'aurora', 'assets', file);
    const id = `ast_${slot}_${path.parse(file).name}`;
    store.register({ id, path: filePath, originalName: file, probe: await probeMedia(filePath) });
    bindings[slot] = id;
  }
  return bindings;
}

function minimalTemplate(overrides = {}) {
  return {
    id: 'tpl_test',
    name: 'Test template',
    width: 1280,
    height: 720,
    fps: 30,
    duration: 10,
    font: { family: 'DejaVu Sans', weight: 'bold' },
    slots: [
      { id: 'background', kind: 'video', width: 1280, height: 720, minDuration: 10, match: 'exact', required: true },
      { id: 'logo', kind: 'image', width: 320, height: 180, match: 'exact', required: true, requiresAlpha: true },
      { id: 'endcard', kind: 'image', width: 1280, height: 720, match: 'exact', required: true },
    ],
    variables: [
      { id: 'title', type: 'text', label: 'Headline', maxLength: 200 },
    ],
    nodes: [
      { id: 'bg', type: 'background', inputs: [], params: { slot: 'background', opacity: 1 } },
      { id: 'logoLayer', type: 'logo', inputs: ['bg'], params: {
        slot: 'logo', x: 40, y: 36, start: 0.3, end: 7.5, fadeIn: 0.5, fadeOut: 0.5, opacity: 1,
      } },
      { id: 'titleLayer', type: 'text', inputs: ['logoLayer'], params: {
        variable: 'title', x: 80, y: 250, width: 1120, height: 170, fontSize: 72, color: '#FFD166',
        start: 0.6, end: 7.8, fadeIn: 0.4, fadeOut: 0.4, align: 'center', lineHeight: 1.15,
      } },
      { id: 'endcardLayer', type: 'endcard', inputs: ['titleLayer'], params: { slot: 'endcard', start: 8, fadeIn: 0.6 } },
      { id: 'out', type: 'output', inputs: ['endcardLayer'], params: {} },
    ],
    ...overrides,
  };
}

const auroraVariables = { title: 'AURORA LIGHT' };

function fixturesExist() {
  return fs.existsSync(path.join(FIXTURES, 'aurora', 'assets', 'bg12.mp4'));
}

const test = require('node:test');
const assert = require('node:assert/strict');

module.exports = {
  test, assert, makeMemoryAssetStore, registerAuroraAssets,
  minimalTemplate, auroraVariables, fixturesExist, FIXTURES,
};
