'use strict';

const { test, assert, minimalTemplate } = require('./helpers');
const { validateTimeline, validateLayerBounds } = require('../src/timeline');

test('layer window outside program duration is rejected', () => {
  const tpl = minimalTemplate();
  tpl.nodes[1].params.end = 12; // program is 10s
  const report = validateTimeline(tpl);
  assert.ok(report.errors.some((e) => e.code === 'TIME_OUT_OF_RANGE' && e.nodeId === 'logoLayer'));
});

test('start >= end is rejected', () => {
  const tpl = minimalTemplate();
  tpl.nodes[1].params.start = 5;
  tpl.nodes[1].params.end = 5;
  const report = validateTimeline(tpl);
  assert.ok(report.errors.some((e) => e.code === 'TIME_WINDOW'));
});

test('transitions longer than the window are rejected', () => {
  const tpl = minimalTemplate();
  tpl.nodes[1].params.start = 1;
  tpl.nodes[1].params.end = 2;
  tpl.nodes[1].params.fadeIn = 0.8;
  tpl.nodes[1].params.fadeOut = 0.8;
  const report = validateTimeline(tpl);
  assert.ok(report.errors.some((e) => e.code === 'TRANSITION_OVERLAP'));
});

test('endcard fade-in crossing program end is rejected', () => {
  const tpl = minimalTemplate();
  tpl.nodes[3].params.start = 9.8;
  tpl.nodes[3].params.fadeIn = 1;
  const report = validateTimeline(tpl);
  assert.ok(report.errors.some((e) => e.code === 'TRANSITION_OVERLAP'));
});

test('endcard starting at or after program end is rejected', () => {
  const tpl = minimalTemplate();
  tpl.nodes[3].params.start = 10;
  const report = validateTimeline(tpl);
  assert.ok(report.errors.some((e) => e.code === 'TIME_OUT_OF_RANGE'));
});

test('text box crossing canvas edge is rejected', () => {
  const tpl = minimalTemplate();
  tpl.nodes[2].params.x = 900;
  tpl.nodes[2].params.width = 1120; // 900 + 1120 > 1280
  const report = validateLayerBounds(tpl);
  assert.ok(report.errors.some((e) => e.code === 'LAYER_OUT_OF_BOUNDS' && e.nodeId === 'titleLayer'));
});

test('valid timeline and bounds pass', () => {
  const tpl = minimalTemplate();
  assert.equal(validateTimeline(tpl).ok, true);
  assert.equal(validateLayerBounds(tpl).ok, true);
});
