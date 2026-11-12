'use strict';

// Legacy template field registry and one-way migration.
//
// Fields that were renamed or replaced by a newer contract version live here,
// NOT in src/schema.js: the validator only speaks the current contract, while
// this module gives old material an explicit, test-covered upgrade path.
// migrateTemplate() must run before validation; a migrated template is
// expected to pass the same checks as a freshly authored one.

const LEGACY_RULES = Object.freeze([
  // ---- template-level ---------------------------------------------------
  {
    scope: 'template',
    field: 'lengthSec',
    replacement: 'duration',
    since: '2026-03',
    reason: '统一为秒级 duration 字段',
    convert: (v) => Number(v),
  },
  {
    scope: 'template',
    field: 'timebase',
    replacement: 'fps',
    since: '2026-03',
    reason: 'timebase 改为帧率 fps',
    convert: (v) => Number(v),
  },
  // ---- node params ------------------------------------------------------
  {
    scope: 'node',
    field: 'from',
    replacement: 'start',
    since: '2026-03',
    reason: '时间窗起点统一命名为 start（秒）',
  },
  {
    scope: 'node',
    field: 'to',
    replacement: 'end',
    since: '2026-03',
    reason: '时间窗终点统一命名为 end（秒）',
  },
  {
    scope: 'node',
    field: 'fadeInMs',
    replacement: 'fadeIn',
    since: '2026-03',
    reason: '转场时长改为秒，毫秒值除以 1000',
    convert: (v) => Number(v) / 1000,
  },
  {
    scope: 'node',
    field: 'fadeOutMs',
    replacement: 'fadeOut',
    since: '2026-03',
    reason: '转场时长改为秒，毫秒值除以 1000',
    convert: (v) => Number(v) / 1000,
  },
  {
    scope: 'node',
    field: 'alpha',
    replacement: 'opacity',
    since: '2026-03',
    reason: '不透明度统一命名为 opacity（0..1）',
  },
  {
    scope: 'node',
    field: 'fontColor',
    replacement: 'color',
    since: '2026-03',
    reason: '文本颜色统一命名为 color（#RRGGBB）',
  },
  // ---- variable declarations -------------------------------------------
  {
    scope: 'variable',
    field: 'maxChars',
    replacement: 'maxLength',
    since: '2026-03',
    reason: '变量长度限制统一命名为 maxLength',
    convert: (v) => Number(v),
  },
  // ---- slot declarations ------------------------------------------------
  {
    scope: 'slot',
    field: 'minLenSec',
    replacement: 'minDuration',
    since: '2026-03',
    reason: '视频槽最短时长统一命名为 minDuration（秒）',
    convert: (v) => Number(v),
  },
]);

const RULE_INDEX = new Map(LEGACY_RULES.map((rule) => [`${rule.scope}.${rule.field}`, rule]));

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Returns every legacy occurrence in a template without modifying it.
function findLegacyFields(template) {
  const found = [];
  if (!isPlainObject(template)) return found;

  for (const rule of LEGACY_RULES) {
    if (rule.scope === 'template' && Object.prototype.hasOwnProperty.call(template, rule.field)) {
      found.push({ scope: 'template', field: rule.field, replacement: rule.replacement, rule, container: template });
    }
  }
  for (const slot of Array.isArray(template.slots) ? template.slots : []) {
    if (!isPlainObject(slot)) continue;
    for (const rule of LEGACY_RULES) {
      if (rule.scope === 'slot' && Object.prototype.hasOwnProperty.call(slot, rule.field)) {
        found.push({ scope: 'slot', id: slot.id, field: rule.field, replacement: rule.replacement, rule, container: slot });
      }
    }
  }
  for (const variable of Array.isArray(template.variables) ? template.variables : []) {
    if (!isPlainObject(variable)) continue;
    for (const rule of LEGACY_RULES) {
      if (rule.scope === 'variable' && Object.prototype.hasOwnProperty.call(variable, rule.field)) {
        found.push({ scope: 'variable', id: variable.id, field: rule.field, replacement: rule.replacement, rule, container: variable });
      }
    }
  }
  for (const node of Array.isArray(template.nodes) ? template.nodes : []) {
    if (!isPlainObject(node) || !isPlainObject(node.params)) continue;
    for (const rule of LEGACY_RULES) {
      if (rule.scope === 'node' && Object.prototype.hasOwnProperty.call(node.params, rule.field)) {
        found.push({ scope: 'node', id: node.id, field: rule.field, replacement: rule.replacement, rule, container: node.params });
      }
    }
  }
  return found;
}

// Applies every legacy rule once. A replacement target that already exists is
// kept (the legacy field is dropped) and the collision is reported so the
// migration evidence stays auditable.
function migrateTemplate(template) {
  const migrated = JSON.parse(JSON.stringify(template));
  const occurrences = findLegacyFields(migrated);
  const changes = [];
  for (const occ of occurrences) {
    const { rule, container } = occ;
    const rawValue = container[rule.field];
    const newValue = rule.convert ? rule.convert(rawValue) : rawValue;
    const targetExists = Object.prototype.hasOwnProperty.call(container, rule.replacement);
    delete container[rule.field];
    if (!targetExists) container[rule.replacement] = newValue;
    changes.push({
      scope: occ.scope,
      id: occ.id || null,
      field: rule.field,
      replacement: rule.replacement,
      rawValue,
      appliedValue: targetExists ? container[rule.replacement] : newValue,
      collided: targetExists,
      since: rule.since,
      reason: rule.reason,
    });
  }
  return {
    template: migrated,
    migrated: changes.length > 0,
    changes,
  };
}

module.exports = { LEGACY_RULES, RULE_INDEX, findLegacyFields, migrateTemplate };
