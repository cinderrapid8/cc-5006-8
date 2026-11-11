'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, assert, minimalTemplate, makeMemoryAssetStore, registerAuroraAssets, fixturesExist, auroraVariables } = require('./helpers');
const { compileGraph, escFilter } = require('../src/compiler');
const { prepareTextImages } = require('../src/text-render');
const { validateTemplate } = require('../src/render');

function tmpJob() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'adcomp-'));
}

test('compiled argv is an array and never contains a shell string', { skip: !fixturesExist() }, async () => {
  const tpl = minimalTemplate();
  const store = makeMemoryAssetStore();
  const bindings = await registerAuroraAssets(store);
  const validation = await validateTemplate(tpl, auroraVariables, bindings, store);
  assert.equal(validation.ok, true);
  const jobDir = tmpJob();
  const { images } = prepareTextImages(tpl, auroraVariables, jobDir);
  const graph = compileGraph(tpl, bindings, store, validation.measurements, jobDir, { textImages: images });

  assert.ok(Array.isArray(graph.argv));
  for (const arg of graph.argv) {
    assert.equal(typeof arg, 'string');
    assert.equal(arg.includes(';'), false, `raw argv must not carry shell separators: ${arg}`);
    assert.equal(arg.includes('&&'), false);
    assert.equal(arg.includes('|'), false);
  }
  // filter graph lives in a script file, not interpolated into a shell line
  assert.ok(fs.existsSync(graph.filterFile));
  assert.ok(graph.argv.includes('-filter_complex_script'));
});

test('filter graph references only validated ffmpeg filters', { skip: !fixturesExist() }, async () => {
  const tpl = minimalTemplate();
  const store = makeMemoryAssetStore();
  const bindings = await registerAuroraAssets(store);
  const validation = await validateTemplate(tpl, auroraVariables, bindings, store);
  const jobDir = tmpJob();
  const { images } = prepareTextImages(tpl, auroraVariables, jobDir);
  const graph = compileGraph(tpl, bindings, store, validation.measurements, jobDir, { textImages: images });

  const allowed = new Set(['scale', 'setsar', 'format', 'colorchannelmixer', 'fade', 'overlay']);
  const used = [...graph.filterGraph.matchAll(/(?:^|,|\])([a-z0-9_]+)=/g)].map((m) => m[1]);
  for (const filterName of used) {
    assert.ok(allowed.has(filterName), `filter ${filterName} is not on the allow-list`);
  }
});

test('text layer image input is added for every text node', { skip: !fixturesExist() }, async () => {
  const tpl = minimalTemplate();
  const store = makeMemoryAssetStore();
  const bindings = await registerAuroraAssets(store);
  const validation = await validateTemplate(tpl, auroraVariables, bindings, store);
  const jobDir = tmpJob();
  const { images } = prepareTextImages(tpl, auroraVariables, jobDir);
  const graph = compileGraph(tpl, bindings, store, validation.measurements, jobDir, { textImages: images });
  // background + logo + text + endcard = 4 inputs
  assert.equal(graph.inputCount, 4);
  assert.ok(fs.existsSync(images.titleLayer));
});

test('compiler throws when a text layer image is missing', { skip: !fixturesExist() }, async () => {
  const tpl = minimalTemplate();
  const store = makeMemoryAssetStore();
  const bindings = await registerAuroraAssets(store);
  const validation = await validateTemplate(tpl, auroraVariables, bindings, store);
  const jobDir = tmpJob();
  assert.throws(
    () => compileGraph(tpl, bindings, store, validation.measurements, jobDir, { textImages: {} }),
    /pre-rendered text layer missing/,
  );
});

test('filter escaping neutralises filtergraph metacharacters', () => {
  const escaped = escFilter("a'b[c]:d;e");
  assert.equal(escaped, "a\\'b\\[c\\]\\:d\\;e");
});

test('topological sort orders inputs before consumers', () => {
  const { topoSort } = require('../src/compiler');
  const tpl = minimalTemplate();
  const order = topoSort(tpl.nodes).map((n) => n.id);
  assert.ok(order.indexOf('bg') < order.indexOf('logoLayer'));
  assert.ok(order.indexOf('logoLayer') < order.indexOf('titleLayer'));
  assert.ok(order.indexOf('titleLayer') < order.indexOf('endcardLayer'));
  assert.equal(order[order.length - 1], 'out');
});
