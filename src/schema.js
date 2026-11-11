'use strict';

const { Report } = require('./errors');

const NODE_TYPES = Object.freeze({
  background: {
    kind: 'source',
    params: {
      slot: { type: 'slotRef', required: true, of: 'video' },
      opacity: { type: 'number', min: 0, max: 1, default: 1 },
    },
  },
  logo: {
    kind: 'transform',
    inputs: 1,
    params: {
      slot: { type: 'slotRef', required: true, of: 'image' },
      x: { type: 'number', required: true, min: 0 },
      y: { type: 'number', required: true, min: 0 },
      start: { type: 'number', required: true, min: 0 },
      end: { type: 'number', required: true, min: 0 },
      fadeIn: { type: 'number', min: 0, default: 0 },
      fadeOut: { type: 'number', min: 0, default: 0 },
      opacity: { type: 'number', min: 0, max: 1, default: 1 },
    },
  },
  text: {
    kind: 'transform',
    inputs: 1,
    params: {
      variable: { type: 'variableRef', required: true },
      x: { type: 'number', required: true, min: 0 },
      y: { type: 'number', required: true, min: 0 },
      width: { type: 'number', required: true, min: 1 },
      height: { type: 'number', required: true, min: 1 },
      fontSize: { type: 'number', required: true, min: 1, max: 400 },
      color: { type: 'color', default: '#FFFFFF' },
      start: { type: 'number', required: true, min: 0 },
      end: { type: 'number', required: true, min: 0 },
      fadeIn: { type: 'number', min: 0, default: 0 },
      fadeOut: { type: 'number', min: 0, default: 0 },
      align: { type: 'enum', values: ['left', 'center', 'right'], default: 'left' },
      lineHeight: { type: 'number', min: 0.5, max: 3, default: 1.2 },
    },
  },
  endcard: {
    kind: 'transform',
    inputs: 1,
    params: {
      slot: { type: 'slotRef', required: true, of: 'image' },
      start: { type: 'number', required: true, min: 0 },
      fadeIn: { type: 'number', required: true, min: 0 },
    },
  },
  output: {
    kind: 'output',
    inputs: 1,
    params: {},
  },
});

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const ID_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkNumber(value, spec) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'must be a finite number';
  if (spec.min !== undefined && value < spec.min) return `must be >= ${spec.min}`;
  if (spec.max !== undefined && value > spec.max) return `must be <= ${spec.max}`;
  return null;
}

function validateNodeParams(node, template, report) {
  const registry = NODE_TYPES[node.type];
  const loc = { nodeId: node.id };
  for (const [key, spec] of Object.entries(registry.params)) {
    const provided = Object.prototype.hasOwnProperty.call(node.params, key);
    if (!provided) {
      if (spec.required) {
        report.error('PARAM_MISSING', `node "${node.id}" missing required param "${key}"`, loc);
      }
      continue;
    }
    const value = node.params[key];
    let bad = null;
    switch (spec.type) {
      case 'number':
        bad = checkNumber(value, spec);
        break;
      case 'string':
        if (typeof value !== 'string' || value.length === 0) bad = 'must be a non-empty string';
        break;
      case 'enum':
        if (!spec.values.includes(value)) bad = `must be one of ${spec.values.join(', ')}`;
        break;
      case 'color':
        if (typeof value !== 'string' || !COLOR_RE.test(value)) bad = 'must be a #RRGGBB color';
        break;
      case 'slotRef': {
        const slot = template.slots.find((s) => s.id === value);
        if (!slot) bad = `references unknown slot "${value}"`;
        else if (slot.kind !== spec.of) bad = `slot "${value}" must be of kind ${spec.of}`;
        break;
      }
      case 'variableRef':
        if (!template.variables.some((v) => v.id === value)) {
          bad = `references unknown variable "${value}"`;
        }
        break;
      default:
        bad = `unknown param type ${spec.type}`;
    }
    if (bad) report.error('PARAM_TYPE', `node "${node.id}" param "${key}": ${bad}`, loc);
  }
  const allowed = new Set(Object.keys(registry.params));
  for (const key of Object.keys(node.params)) {
    if (!allowed.has(key)) {
      report.error('PARAM_UNKNOWN', `node "${node.id}" has unknown param "${key}"`, loc);
    }
  }
}

function validateTemplateShape(template) {
  const report = new Report();
  if (!isPlainObject(template)) {
    report.error('TEMPLATE_SHAPE', 'template must be an object');
    return report;
  }
  for (const key of ['id', 'name', 'width', 'height', 'fps', 'duration', 'font', 'slots', 'variables', 'nodes']) {
    if (!Object.prototype.hasOwnProperty.call(template, key)) {
      report.error('TEMPLATE_SHAPE', `template missing top-level field "${key}"`);
    }
  }
  if (!report.ok) return report;

  if (!ID_RE.test(template.id)) report.error('TEMPLATE_SHAPE', 'template id must match [A-Za-z][A-Za-z0-9_]{0,63}');
  if (typeof template.name !== 'string' || !template.name) report.error('TEMPLATE_SHAPE', 'name must be a non-empty string');
  for (const [key, max] of [['width', 7680], ['height', 4320]]) {
    const e = checkNumber(template[key], { min: 2, max });
    if (e) report.error('TEMPLATE_SHAPE', `${key}: ${e}`);
    else if (!Number.isInteger(template[key])) report.error('TEMPLATE_SHAPE', `${key} must be an integer`);
  }
  if (checkNumber(template.fps, { min: 1, max: 240 })) report.error('TEMPLATE_SHAPE', 'fps must be between 1 and 240');
  if (checkNumber(template.duration, { min: 0.1, max: 600 })) report.error('TEMPLATE_SHAPE', 'duration must be between 0.1 and 600 seconds');
  if (!isPlainObject(template.font) || typeof template.font.family !== 'string' || !template.font.family) {
    report.error('TEMPLATE_SHAPE', 'font.family must be a non-empty string');
  }
  if (template.font && template.font.weight !== undefined && !['normal', 'bold'].includes(template.font.weight)) {
    report.error('TEMPLATE_SHAPE', 'font.weight must be "normal" or "bold"');
  }

  if (!Array.isArray(template.slots)) report.error('TEMPLATE_SHAPE', 'slots must be an array');
  else {
    const slotIds = new Set();
    for (const slot of template.slots) {
      const loc = { slotId: slot && slot.id };
      if (!isPlainObject(slot)) { report.error('SLOT_SHAPE', 'slot must be an object'); continue; }
      if (!ID_RE.test(slot.id || '')) report.error('SLOT_SHAPE', `slot id "${slot.id}" invalid`, loc);
      if (slotIds.has(slot.id)) report.error('SLOT_DUPLICATE', `duplicate slot id "${slot.id}"`, loc);
      slotIds.add(slot.id);
      if (!['video', 'image'].includes(slot.kind)) report.error('SLOT_SHAPE', `slot "${slot.id}" kind must be video|image`, loc);
      if (!['exact', 'max'].includes(slot.match || 'exact')) report.error('SLOT_SHAPE', `slot "${slot.id}" match must be exact|max`, loc);
      for (const dim of ['width', 'height']) {
        const e = checkNumber(slot[dim], { min: 1 });
        if (e || !Number.isInteger(slot[dim])) report.error('SLOT_SHAPE', `slot "${slot.id}" ${dim} must be a positive integer`, loc);
      }
      if (slot.kind === 'video') {
        const e = checkNumber(slot.minDuration, { min: 0 });
        if (e) report.error('SLOT_SHAPE', `slot "${slot.id}" minDuration: ${e}`, loc);
      }
      if (slot.requiresAlpha !== undefined && typeof slot.requiresAlpha !== 'boolean') {
        report.error('SLOT_SHAPE', `slot "${slot.id}" requiresAlpha must be boolean`, loc);
      }
      if (typeof slot.required !== 'boolean') report.error('SLOT_SHAPE', `slot "${slot.id}" required must be boolean`, loc);
    }
  }

  if (!Array.isArray(template.variables)) report.error('TEMPLATE_SHAPE', 'variables must be an array');
  else {
    const varIds = new Set();
    for (const v of template.variables) {
      const loc = { variableId: v && v.id };
      if (!isPlainObject(v)) { report.error('VARIABLE_SHAPE', 'variable must be an object'); continue; }
      if (!ID_RE.test(v.id || '')) report.error('VARIABLE_SHAPE', `variable id "${v.id}" invalid`, loc);
      if (varIds.has(v.id)) report.error('VARIABLE_DUPLICATE', `duplicate variable id "${v.id}"`, loc);
      varIds.add(v.id);
      if (v.type !== 'text') report.error('VARIABLE_SHAPE', `variable "${v.id}" type must be text`, loc);
      if (typeof v.label !== 'string' || !v.label) report.error('VARIABLE_SHAPE', `variable "${v.id}" label required`, loc);
      if (v.maxLength !== undefined && (!Number.isInteger(v.maxLength) || v.maxLength < 1)) {
        report.error('VARIABLE_SHAPE', `variable "${v.id}" maxLength must be positive integer`, loc);
      }
    }
  }

  if (!Array.isArray(template.nodes) || template.nodes.length === 0) {
    report.error('TEMPLATE_SHAPE', 'nodes must be a non-empty array');
    return report;
  }
  const nodeIds = new Set();
  for (const node of template.nodes) {
    const loc = { nodeId: node && node.id };
    if (!isPlainObject(node)) { report.error('NODE_SHAPE', 'node must be an object'); continue; }
    if (!ID_RE.test(node.id || '')) report.error('NODE_SHAPE', `node id "${node.id}" invalid`, loc);
    if (nodeIds.has(node.id)) report.error('NODE_DUPLICATE', `duplicate node id "${node.id}"`, loc);
    nodeIds.add(node.id);
    if (!Object.prototype.hasOwnProperty.call(NODE_TYPES, node.type)) {
      report.error('NODE_TYPE_UNKNOWN', `node "${node.id}" has disallowed type "${node.type}"`, loc);
      continue;
    }
    if (!isPlainObject(node.params)) { report.error('NODE_SHAPE', `node "${node.id}" params must be an object`, loc); continue; }
    const registry = NODE_TYPES[node.type];
    if (registry.inputs > 0) {
      if (!Array.isArray(node.inputs) || node.inputs.length !== registry.inputs) {
        report.error('NODE_INPUTS', `node "${node.id}" must declare exactly ${registry.inputs} input(s)`, loc);
      }
    }
    validateNodeParams(node, template, report);
  }
  return report;
}

function validateReferences(template) {
  const report = new Report();
  const byId = new Map(template.nodes.map((n) => [n.id, n]));

  // structural reference checks: inputs must point at existing nodes, output must exist
  let outputCount = 0;
  for (const node of template.nodes) {
    const registry = NODE_TYPES[node.type];
    const loc = { nodeId: node.id };
    if (registry.kind === 'output') outputCount += 1;
    if (!Array.isArray(node.inputs)) continue;
    for (const ref of node.inputs) {
      if (!byId.has(ref)) {
        report.error('REF_MISSING', `node "${node.id}" references non-existent node "${ref}"`, loc);
      } else {
        const target = byId.get(ref);
        if (NODE_TYPES[target.type].kind === 'output') {
          report.error('REF_INVALID', `node "${node.id}" cannot consume output node "${ref}"`, loc);
        }
      }
    }
  }
  if (outputCount !== 1) {
    report.error('OUTPUT_COUNT', `template must have exactly one output node, found ${outputCount}`);
  }

  // cycle detection with DFS coloring; the stack gives a locatable cycle path
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map(template.nodes.map((n) => [n.id, WHITE]));
  const stack = [];
  const visit = (nodeId) => {
    color.set(nodeId, GRAY);
    stack.push(nodeId);
    const node = byId.get(nodeId);
    for (const ref of node.inputs || []) {
      if (!byId.has(ref) || NODE_TYPES[byId.get(ref).type].kind === 'output') continue;
      if (color.get(ref) === GRAY) {
        const cycleStart = stack.indexOf(ref);
        const path = [...stack.slice(cycleStart), ref].join(' -> ');
        report.error('REF_CYCLE', `circular reference detected: ${path}`, { nodeId: ref, path });
      } else if (color.get(ref) === WHITE) {
        visit(ref);
      }
    }
    stack.pop();
    color.set(nodeId, BLACK);
  };
  for (const node of template.nodes) if (color.get(node.id) === WHITE) visit(node.id);
  return report;
}

module.exports = { NODE_TYPES, ID_RE, COLOR_RE, validateTemplateShape, validateReferences };
