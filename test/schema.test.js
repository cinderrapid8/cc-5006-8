'use strict';

const { test, assert, minimalTemplate } = require('./helpers');
const { validateTemplateShape, validateReferences, NODE_TYPES } = require('../src/schema');

test('valid template passes shape validation', () => {
  const report = validateTemplateShape(minimalTemplate());
  assert.equal(report.ok, true, JSON.stringify(report.errors));
});

test('unknown node type is rejected — no arbitrary command nodes', () => {
  const tpl = minimalTemplate();
  tpl.nodes[0].type = 'shell_exec';
  const report = validateTemplateShape(tpl);
  assert.ok(report.errors.some((e) => e.code === 'NODE_TYPE_UNKNOWN'));
  assert.ok(report.errors[0].nodeId === 'bg');
});

test('wrong param type and unknown param are reported with node location', () => {
  const tpl = minimalTemplate();
  tpl.nodes[1].params.x = 'not-a-number';
  tpl.nodes[1].params.evil = 'rm -rf /';
  const report = validateTemplateShape(tpl);
  assert.ok(report.errors.some((e) => e.code === 'PARAM_TYPE' && e.nodeId === 'logoLayer'));
  assert.ok(report.errors.some((e) => e.code === 'PARAM_UNKNOWN' && e.nodeId === 'logoLayer'));
});

test('slot reference to unknown slot is rejected', () => {
  const tpl = minimalTemplate();
  tpl.nodes[0].params.slot = 'nonexistent';
  const report = validateTemplateShape(tpl);
  assert.ok(report.errors.some((e) => e.code === 'PARAM_TYPE'));
});

test('variable reference to undeclared variable is rejected', () => {
  const tpl = minimalTemplate();
  tpl.nodes[2].params.variable = 'ghost';
  const report = validateTemplateShape(tpl);
  assert.ok(report.errors.some((e) => e.code === 'PARAM_TYPE'));
});

test('enum and color params are strictly checked', () => {
  const tpl = minimalTemplate();
  tpl.nodes[2].params.align = 'diagonal';
  tpl.nodes[2].params.color = 'white';
  const report = validateTemplateShape(tpl);
  assert.equal(report.errors.filter((e) => e.code === 'PARAM_TYPE').length, 2);
});

test('missing required param is reported', () => {
  const tpl = minimalTemplate();
  delete tpl.nodes[2].params.fontSize;
  const report = validateTemplateShape(tpl);
  assert.ok(report.errors.some((e) => e.code === 'PARAM_MISSING'));
});

test('duplicate node ids and non-id-safe identifiers are rejected', () => {
  const tpl = minimalTemplate();
  tpl.nodes[1].id = 'bg';
  const report = validateTemplateShape(tpl);
  assert.ok(report.errors.some((e) => e.code === 'NODE_DUPLICATE'));

  const tpl2 = minimalTemplate();
  tpl2.id = '../escape';
  const report2 = validateTemplateShape(tpl2);
  assert.ok(report2.errors.some((e) => e.code === 'TEMPLATE_SHAPE'));
});

test('reference to non-existent node reports REF_MISSING with both ids', () => {
  const tpl = minimalTemplate();
  tpl.nodes[4].inputs = ['vanished'];
  const refs = validateReferences(tpl);
  const err = refs.errors.find((e) => e.code === 'REF_MISSING');
  assert.ok(err);
  assert.equal(err.nodeId, 'out');
  assert.match(err.message, /vanished/);
});

test('circular reference reports the cycle path', () => {
  const tpl = minimalTemplate();
  tpl.nodes[1].inputs = ['titleLayer']; // logoLayer <- titleLayer <- logoLayer
  const refs = validateReferences(tpl);
  const err = refs.errors.find((e) => e.code === 'REF_CYCLE');
  assert.ok(err, 'expected REF_CYCLE');
  assert.match(err.path, /logoLayer -> titleLayer -> logoLayer/);
});

test('exactly one output node is required', () => {
  const tpl = minimalTemplate();
  tpl.nodes = tpl.nodes.filter((n) => n.type !== 'output');
  const refs = validateReferences(tpl);
  assert.ok(refs.errors.some((e) => e.code === 'OUTPUT_COUNT'));
});

test('registry covers exactly the allowed node kinds', () => {
  assert.deepEqual(Object.keys(NODE_TYPES).sort(), ['background', 'endcard', 'logo', 'output', 'text']);
});
