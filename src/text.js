'use strict';

const { createCanvas } = require('@napi-rs/canvas');
const { Report } = require('./errors');
const { canvasFamilyAlias, resolveFontFile } = require('./fonts');

const MAX_TEXT_LEN = 5000;

// One shared offscreen canvas for all measurements; metrics only.
const measureCanvas = createCanvas(10, 10);
const measureCtx = measureCanvas.getContext('2d');

function wrapText(ctx, text, boxWidth) {
  const paragraphs = String(text).split('\n');
  const lines = [];
  for (const paragraph of paragraphs) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }
    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width <= boxWidth || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

// Measures text against the exact box/font the renderer will use and returns
// the wrapped lines plus concrete overflow evidence.
function measureTextNode(template, node, text) {
  const p = node.params;
  const weight = template.font.weight || 'normal';
  const alias = canvasFamilyAlias(template.font.family, weight);
  if (!alias) {
    const err = new Error(`font not registered: ${template.font.family} (${weight})`);
    err.code = 'FONT_NOT_FOUND';
    throw err;
  }
  const fontFile = resolveFontFile(template.font.family, weight);
  measureCtx.font = `${weight === 'bold' ? 'bold ' : ''}${p.fontSize}px "${alias}"`;
  const lines = wrapText(measureCtx, text == null ? '' : String(text), p.width);
  const lineHeightPx = p.fontSize * p.lineHeight;
  const widths = lines.map((line) => measureCtx.measureText(line).width);
  const measuredWidth = Math.max(0, ...widths);
  const measuredHeight = lines.length * lineHeightPx;
  return {
    lines,
    widths,
    measuredWidth,
    measuredHeight,
    lineHeightPx,
    boxWidth: p.width,
    boxHeight: p.height,
    fontFile,
    fontFamily: template.font.family,
    fontWeight: weight,
    fontSize: p.fontSize,
    align: p.align || 'left',
    overflowX: measuredWidth > p.width + 1e-6,
    overflowY: measuredHeight > p.height + 1e-6,
    overflow: measuredWidth > p.width + 1e-6 || measuredHeight > p.height + 1e-6,
  };
}

function validateVariables(template, variables) {
  const report = new Report();
  for (const decl of template.variables) {
    const value = variables ? variables[decl.id] : undefined;
    const loc = { variableId: decl.id };
    if (typeof value !== 'string' || value.trim() === '') {
      report.error('VARIABLE_EMPTY', `variable "${decl.id}" must be a non-empty string`, loc);
      continue;
    }
    if (value.length > MAX_TEXT_LEN) {
      report.error('VARIABLE_TOO_LONG', `variable "${decl.id}" exceeds ${MAX_TEXT_LEN} characters`, loc);
    }
    if (decl.maxLength && value.length > decl.maxLength) {
      report.error('VARIABLE_TOO_LONG', `variable "${decl.id}" length ${value.length} > maxLength ${decl.maxLength}`, loc);
    }
  }
  return report;
}

function validateTextLayout(template, variables) {
  const report = new Report();
  const measurements = [];
  for (const node of template.nodes) {
    if (node.type !== 'text') continue;
    const value = variables[node.params.variable];
    let m;
    try {
      m = measureTextNode(template, node, value);
    } catch (err) {
      if (err.code === 'FONT_NOT_FOUND') {
        report.error('FONT_NOT_FOUND', err.message, { nodeId: node.id });
        continue;
      }
      throw err;
    }
    measurements.push({ nodeId: node.id, ...m });
    if (m.overflow) {
      const reasons = [];
      if (m.overflowX) reasons.push(`width ${m.measuredWidth.toFixed(1)}px > container ${m.boxWidth}px`);
      if (m.overflowY) reasons.push(`height ${m.measuredHeight.toFixed(1)}px > container ${m.boxHeight}px (${m.lines.length} lines)`);
      report.error(
        'TEXT_OVERFLOW',
        `text node "${node.id}" overflows its container: ${reasons.join('; ')}`,
        {
          nodeId: node.id,
          measuredWidth: Number(m.measuredWidth.toFixed(2)),
          measuredHeight: Number(m.measuredHeight.toFixed(2)),
          boxWidth: m.boxWidth,
          boxHeight: m.boxHeight,
          lines: m.lines.length,
        },
      );
    }
  }
  return { report, measurements };
}

module.exports = { measureTextNode, validateVariables, validateTextLayout, wrapText };
