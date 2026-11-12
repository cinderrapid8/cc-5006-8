'use strict';

const { test, assert, minimalTemplate } = require('./helpers');
const { findLegacyFields, migrateTemplate, LEGACY_RULES } = require('../src/legacy');
const { validateTemplateShape } = require('../src/schema');

function legacyTemplate() {
  const t = minimalTemplate();
  t.lengthSec = t.duration;
  delete t.duration;
  t.timebase = t.fps;
  delete t.fps;

  const bg = t.nodes.find((n) => n.id === 'bg');
  bg.params.alpha = bg.params.opacity;
  delete bg.params.opacity;

  const logo = t.nodes.find((n) => n.id === 'logoLayer');
  logo.params.from = logo.params.start;
  logo.params.to = logo.params.end;
  logo.params.fadeInMs = 500;
  logo.params.fadeOutMs = 500;
  delete logo.params.start;
  delete logo.params.end;
  delete logo.params.fadeIn;
  delete logo.params.fadeOut;

  const title = t.nodes.find((n) => n.id === 'titleLayer');
  title.params.fontColor = title.params.color;
  delete title.params.color;

  t.variables[0].maxChars = t.variables[0].maxLength;
  delete t.variables[0].maxLength;
  t.slots[0].minLenSec = t.slots[0].minDuration;
  delete t.slots[0].minDuration;
  return t;
}

test('findLegacyFields locates every scope with a stable scope.id.field key', () => {
  const found = findLegacyFields(legacyTemplate());
  const refs = found.map((l) => `${l.scope}.${l.id ? `${l.id}.` : ''}${l.field}`);
  for (const expected of [
    'template.lengthSec', 'template.timebase',
    'node.bg.alpha',
    'node.logoLayer.from', 'node.logoLayer.to',
    'node.logoLayer.fadeInMs', 'node.logoLayer.fadeOutMs',
    'node.titleLayer.fontColor',
    'variable.title.maxChars',
    'slot.background.minLenSec',
  ]) {
    assert.ok(refs.includes(expected), `missing ${expected}`);
  }
  assert.equal(findLegacyFields(minimalTemplate()).length, 0);
  assert.equal(findLegacyFields(null).length, 0);
});

test('legacy template is rejected by the current schema (no compat in the validator)', () => {
  const report = validateTemplateShape(legacyTemplate());
  assert.equal(report.ok, false);
  // missing renamed top-level fields (duration/fps) fail TEMPLATE_SHAPE and
  // short-circuit before node checks; nothing is silently accepted
  assert.ok(report.errors.some((e) => e.code === 'TEMPLATE_SHAPE'));

  // with top-level fields restored, the renamed node params surface as PARAM_UNKNOWN
  const nodeOnly = legacyTemplate();
  nodeOnly.duration = nodeOnly.lengthSec;
  nodeOnly.fps = nodeOnly.timebase;
  const nodeReport = validateTemplateShape(nodeOnly);
  assert.equal(nodeReport.ok, false);
  const unknownParams = nodeReport.errors.filter((e) => e.code === 'PARAM_UNKNOWN').map((e) => e.message);
  assert.ok(unknownParams.some((m) => m.includes('alpha')));
  assert.ok(unknownParams.some((m) => m.includes('fadeInMs')));
});

test('migration converts every legacy field and the result validates cleanly', () => {
  const result = migrateTemplate(legacyTemplate());
  assert.equal(result.migrated, true);
  assert.equal(findLegacyFields(result.template).length, 0);

  const t = result.template;
  assert.equal(t.duration, 10);
  assert.equal(t.fps, 30);
  assert.equal(t.slots[0].minDuration, 10);
  assert.equal(t.variables[0].maxLength, 200);

  const bg = t.nodes.find((n) => n.id === 'bg');
  assert.equal(bg.params.opacity, 1);
  assert.ok(!('alpha' in bg.params));

  const logo = t.nodes.find((n) => n.id === 'logoLayer');
  assert.equal(logo.params.start, 0.3);
  assert.equal(logo.params.end, 7.5);
  assert.equal(logo.params.fadeIn, 0.5);
  assert.equal(logo.params.fadeOut, 0.5);

  const title = t.nodes.find((n) => n.id === 'titleLayer');
  assert.equal(title.params.color, '#FFD166');

  const shape = validateTemplateShape(t);
  assert.equal(shape.ok, true, JSON.stringify(shape.errors));
});

test('migration is non-destructive: input template is never mutated', () => {
  const source = legacyTemplate();
  const snapshot = JSON.stringify(source);
  migrateTemplate(source);
  assert.equal(JSON.stringify(source), snapshot);
});

test('when the replacement already exists it is kept and the collision is reported', () => {
  const t = minimalTemplate();
  const logo = t.nodes.find((n) => n.id === 'logoLayer');
  logo.params.fadeInMs = 900; // current fadeIn=0.5 already present
  const result = migrateTemplate(t);
  const change = result.changes.find((c) => c.field === 'fadeInMs');
  assert.equal(change.collided, true);
  assert.equal(logo.params.fadeIn, 0.5);
  assert.equal(result.template.nodes.find((n) => n.id === 'logoLayer').params.fadeIn, 0.5);
  assert.ok(!('fadeInMs' in result.template.nodes.find((n) => n.id === 'logoLayer').params));
});

test('ms-to-seconds conversion and every documented legacy rule has a replacement', () => {
  const t = minimalTemplate();
  const title = t.nodes.find((n) => n.id === 'titleLayer');
  delete title.params.fadeOut;
  title.params.fadeOutMs = 250;
  const { template } = migrateTemplate(t);
  assert.equal(template.nodes.find((n) => n.id === 'titleLayer').params.fadeOut, 0.25);

  for (const rule of LEGACY_RULES) {
    assert.ok(rule.replacement && rule.since && rule.reason, `rule ${rule.field} missing metadata`);
  }
});
