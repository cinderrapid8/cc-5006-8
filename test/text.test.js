'use strict';

const { test, assert, minimalTemplate } = require('./helpers');
const { validateTextLayout, validateVariables, measureTextNode } = require('../src/text');

test('fitting text produces no overflow and concrete metrics', () => {
  const tpl = minimalTemplate();
  const node = tpl.nodes.find((n) => n.id === 'titleLayer');
  const m = measureTextNode(tpl, node, 'AURORA LIGHT');
  assert.equal(m.overflow, false);
  assert.ok(m.measuredWidth > 0 && m.measuredHeight > 0);
  assert.equal(m.fontFile.includes('DejaVuSans-Bold.ttf'), true);
});

test('long headline overflows and reports measured vs box dimensions', () => {
  const tpl = minimalTemplate();
  const report2 = validateTextLayout(tpl, {
    title: 'AURORA LIGHT PRESENTS THE BIGGEST MIDNIGHT SUN CELEBRATION EVENT OF THE ENTIRE DECADE WITH LIVE PERFORMANCES',
  });
  const err = report2.report.errors.find((e) => e.code === 'TEXT_OVERFLOW');
  assert.ok(err, 'expected TEXT_OVERFLOW');
  assert.equal(err.nodeId, 'titleLayer');
  assert.ok(err.measuredHeight > err.boxHeight || err.measuredWidth > err.boxWidth);
  assert.match(err.message, /container/);
});

test('word wrapping splits on spaces and honours explicit newlines', () => {
  const tpl = minimalTemplate();
  const node = tpl.nodes.find((n) => n.id === 'titleLayer');
  node.params.fontSize = 40;
  node.params.width = 240; // narrow box forces the second paragraph to wrap
  const m = measureTextNode(tpl, node, 'first line\nsecond wrapped line here');
  assert.ok(m.lines.length >= 3);
  assert.equal(m.lines[0], 'first line');
  assert.ok(m.lines.includes('second'));
});

test('empty and missing variables are rejected', () => {
  const tpl = minimalTemplate();
  const report = validateVariables(tpl, { title: '   ' });
  assert.ok(report.errors.some((e) => e.code === 'VARIABLE_EMPTY'));
  const report2 = validateVariables(tpl, {});
  assert.ok(report2.errors.some((e) => e.code === 'VARIABLE_EMPTY'));
});

test('maxLength is enforced with actual length in message', () => {
  const tpl = minimalTemplate();
  const report = validateVariables(tpl, { title: 'x'.repeat(201) });
  const err = report.errors.find((e) => e.code === 'VARIABLE_TOO_LONG');
  assert.ok(err);
  assert.match(err.message, /201/);
});
