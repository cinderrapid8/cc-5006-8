'use strict';

const fs = require('fs');
const path = require('path');
const { NODE_TYPES } = require('./schema');
const { measureTextNode } = require('./text');

const num = (v) => Number(v).toFixed(3).replace(/\.?0+$/, '');

// Filter-graph argument escaping. Everything we emit is one token inside an
// argv array (shell:false); this only escapes characters that ffmpeg's own
// filtergraph parser treats specially.
function escFilter(value) {
  return String(value).replace(/[\\:'",;\[\]]/g, (ch) => `\\${ch}`);
}

function topoSort(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const state = new Map(nodes.map((n) => [n.id, 0]));
  const order = [];
  const visit = (id, stack = []) => {
    if (state.get(id) === 1) {
      const cyc = [...stack, id].join(' -> ');
      const err = new Error(`cycle at compile time: ${cyc}`);
      err.code = 'REF_CYCLE';
      throw err;
    }
    if (state.get(id) === 2) return;
    state.set(id, 1);
    const node = byId.get(id);
    for (const ref of node.inputs || []) visit(ref, [...stack, id]);
    state.set(id, 2);
    order.push(id);
  };
  for (const n of nodes) visit(n.id);
  return order.map((id) => byId.get(id));
}

// Builds an executable media graph (ffmpeg argv + filter graph) from a
// previously validated template. No free-form commands exist anywhere:
// node types, params and references were all checked against the registry.
// Text layers arrive as pre-rendered transparent PNGs (same font/layout as
// the measurement step); ffmpeg only composites them on a time window.
function compileGraph(template, bindings, assetStore, measurements, jobDir, opts = {}) {
  const { textImages = {}, previewAt = null } = opts;
  const inputs = []; // { args: [...], sourceSlot }
  const filterLines = [];
  const labelOf = new Map();
  const supportFiles = [];

  const addInput = (slotId, args) => {
    const idx = inputs.length;
    inputs.push({ slotId, args });
    return idx;
  };

  const nodes = topoSort(template.nodes);
  const duration = num(template.duration);

  for (const node of nodes) {
    const p = node.params;

    if (node.type === 'background') {
      const record = assetStore.get(bindings[p.slot]);
      const idx = addInput(p.slot, ['-stream_loop', '-1', '-i', record.path]);
      let chain = `[${idx}:v]scale=${template.width}:${template.height},setsar=1,format=rgba`;
      if (p.opacity < 1) chain += `,colorchannelmixer=aa=${num(p.opacity)}`;
      const label = `v${idx}`;
      chain += `[${label}]`;
      filterLines.push(chain);
      labelOf.set(node.id, label);
    }

    if (node.type === 'logo') {
      const record = assetStore.get(bindings[p.slot]);
      const idx = addInput(p.slot, ['-loop', '1', '-framerate', String(template.fps), '-t', duration, '-i', record.path]);
      let chain = `[${idx}:v]format=rgba`;
      if (p.opacity < 1) chain += `,colorchannelmixer=aa=${num(p.opacity)}`;
      const fade = [];
      if (p.fadeIn > 0) fade.push(`fade=t=in:st=${num(p.start)}:d=${num(p.fadeIn)}:alpha=1`);
      if (p.fadeOut > 0) fade.push(`fade=t=out:st=${num(p.end - p.fadeOut)}:d=${num(p.fadeOut)}:alpha=1`);
      if (fade.length) chain += `,${fade.join(',')}`;
      const logoLabel = `logo${idx}`;
      chain += `[${logoLabel}]`;
      filterLines.push(chain);

      const baseLabel = labelOf.get(node.inputs[0]);
      const outLabel = `comp${idx}`;
      const enable = `between(t\\,${num(p.start)}\\,${num(p.end)})`;
      filterLines.push(
        `[${baseLabel}][${logoLabel}]overlay=x=${num(p.x)}:y=${num(p.y)}:enable='${enable}':eof_action=pass[${outLabel}]`,
      );
      labelOf.set(node.id, outLabel);
    }

    if (node.type === 'text') {
      const imagePath = textImages[node.id];
      if (!imagePath || !fs.existsSync(imagePath)) {
        const err = new Error(`pre-rendered text layer missing for node "${node.id}"`);
        err.code = 'TEXT_LAYER_MISSING';
        throw err;
      }
      const idx = addInput(`text:${node.id}`, ['-loop', '1', '-framerate', String(template.fps), '-t', duration, '-i', imagePath]);
      let chain = `[${idx}:v]format=rgba`;
      if (p.fadeIn > 0) chain += `,fade=t=in:st=${num(p.start)}:d=${num(p.fadeIn)}:alpha=1`;
      if (p.fadeOut > 0) chain += `,fade=t=out:st=${num(p.end - p.fadeOut)}:d=${num(p.fadeOut)}:alpha=1`;
      const textLabel = `txt${idx}`;
      chain += `[${textLabel}]`;
      filterLines.push(chain);

      const baseLabel = labelOf.get(node.inputs[0]);
      const outLabel = `textcomp${idx}`;
      const enable = `between(t\\,${num(p.start)}\\,${num(p.end)})`;
      filterLines.push(
        `[${baseLabel}][${textLabel}]overlay=x=${num(p.x)}:y=${num(p.y)}:enable='${enable}':eof_action=pass[${outLabel}]`,
      );
      labelOf.set(node.id, outLabel);
    }

    if (node.type === 'endcard') {
      const record = assetStore.get(bindings[p.slot]);
      const idx = addInput(p.slot, ['-loop', '1', '-framerate', String(template.fps), '-t', duration, '-i', record.path]);
      const cardLabel = `card${idx}`;
      filterLines.push(
        `[${idx}:v]scale=${template.width}:${template.height},setsar=1,format=rgba,fade=t=in:st=${num(p.start)}:d=${num(p.fadeIn)}:alpha=1[${cardLabel}]`,
      );
      const baseLabel = labelOf.get(node.inputs[0]);
      const outLabel = `cardcomp${idx}`;
      filterLines.push(
        `[${baseLabel}][${cardLabel}]overlay=x=0:y=0:enable='gte(t\\,${num(p.start)})':eof_action=pass[${outLabel}]`,
      );
      labelOf.set(node.id, outLabel);
    }

    if (node.type === 'output') {
      labelOf.set(node.id, labelOf.get(node.inputs[0]));
    }
  }

  const outputNode = nodes.find((n) => n.type === 'output');
  const finalLabel = labelOf.get(outputNode.id);
  const filterGraph = filterLines.join(';\n');
  const filterFile = path.join(jobDir, 'graph.filter');
  fs.writeFileSync(filterFile, filterGraph, 'utf8');
  supportFiles.push(filterFile);

  const argv = ['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error'];
  for (const input of inputs) argv.push(...input.args);
  argv.push('-filter_complex_script', filterFile, '-map', `[${finalLabel}]`);
  argv.push('-r', String(template.fps), '-t', duration, '-pix_fmt', 'yuv420p');

  if (previewAt === null) {
    argv.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-an', '-fflags', '+bitexact');
    argv.push('-flags:v', '+bitexact', '-movflags', '+faststart');
  } else {
    argv.push('-frames:v', '1');
  }

  return {
    argv,
    filterGraph,
    filterFile,
    supportFiles,
    finalLabel,
    inputCount: inputs.length,
    previewAt,
  };
}

module.exports = { compileGraph, topoSort, escFilter, num };
