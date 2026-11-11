'use strict';

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');
const { canvasFamilyAlias, resolveFontFile } = require('./fonts');
const { measureTextNode } = require('./text');

// Renders a text node to a transparent RGBA PNG using the exact font file,
// size, line height, alignment and box used by the measurement step.
// The renderer (ffmpeg) only overlays this image; it never lays out text,
// so preview and render cannot diverge typographically.
function renderTextLayerImage(template, node, text, outFile) {
  const p = node.params;
  const m = measureTextNode(template, node, text);
  const width = Math.max(1, Math.ceil(p.width));
  const height = Math.max(1, Math.ceil(p.height));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);

  const alias = canvasFamilyAlias(m.fontFamily, m.fontWeight);
  ctx.font = `${m.fontWeight === 'bold' ? 'bold ' : ''}${m.fontSize}px "${alias}"`;
  ctx.fillStyle = p.color;
  ctx.textBaseline = 'top';

  m.lines.forEach((line, i) => {
    const y = i * m.lineHeightPx;
    let x = 0;
    const lineWidth = m.widths[i];
    if (m.align === 'center') x = (p.width - lineWidth) / 2;
    else if (m.align === 'right') x = p.width - lineWidth;
    ctx.fillText(line, x, y);
  });

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, canvas.toBuffer('image/png'));
  return { outFile, measurement: m };
}

// Produces one PNG per text node and returns a nodeId -> file map plus
// the measurements needed by the compiler and by overflow reporting.
function prepareTextImages(template, variables, jobDir) {
  const layerDir = path.join(jobDir, 'text-layers');
  fs.mkdirSync(layerDir, { recursive: true });
  const images = {};
  const measurements = [];
  for (const node of template.nodes) {
    if (node.type !== 'text') continue;
    const outFile = path.join(layerDir, `${node.id}.png`);
    const { measurement } = renderTextLayerImage(
      template, node, variables[node.params.variable], outFile,
    );
    images[node.id] = outFile;
    measurements.push({ nodeId: node.id, ...measurement });
  }
  return { images, measurements };
}

module.exports = { renderTextLayerImage, prepareTextImages };
