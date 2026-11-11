'use strict';

const { Report } = require('./errors');
const { NODE_TYPES } = require('./schema');

const EPS = 1e-6;

// Checks layer time windows, transition lengths and total program duration together.
function validateTimeline(template) {
  const report = new Report();
  const D = template.duration;
  const loc = (nodeId) => ({ nodeId });

  for (const node of template.nodes) {
    const p = node.params;
    const type = node.type;

    if (type === 'logo' || type === 'text') {
      if (!(p.start < p.end - EPS)) {
        report.error('TIME_WINDOW', `node "${node.id}" requires start < end`, loc(node.id));
        continue;
      }
      if (p.start < -EPS || p.end > D + EPS) {
        report.error(
          'TIME_OUT_OF_RANGE',
          `node "${node.id}" window [${p.start}, ${p.end}] exceeds program duration ${D}`,
          loc(node.id),
        );
      }
      const windowLen = p.end - p.start;
      const transitionTotal = (p.fadeIn || 0) + (p.fadeOut || 0);
      if (transitionTotal > windowLen + EPS) {
        report.error(
          'TRANSITION_OVERLAP',
          `node "${node.id}" transitions ${transitionTotal}s do not fit in ${windowLen}s window`,
          loc(node.id),
        );
      }
    }

    if (type === 'endcard') {
      if (p.start < -EPS || p.start >= D - EPS) {
        report.error(
          'TIME_OUT_OF_RANGE',
          `endcard "${node.id}" start ${p.start} must be within [0, ${D})`,
          loc(node.id),
        );
      }
      if (p.start + p.fadeIn > D + EPS) {
        report.error(
          'TRANSITION_OVERLAP',
          `endcard "${node.id}" fade-in extends past program end (${p.start} + ${p.fadeIn} > ${D})`,
          loc(node.id),
        );
      }
      if (p.fadeIn <= EPS) {
        report.error('TRANSITION_LENGTH', `endcard "${node.id}" fadeIn must be > 0`, loc(node.id));
      }
    }

    if (type === 'background') {
      // background covers the whole program; asset minDuration is checked against D during binding
    }
  }
  return report;
}

// Layer bounds must stay inside the canvas (no off-canvas layers).
function validateLayerBounds(template) {
  const report = new Report();
  for (const node of template.nodes) {
    const p = node.params;
    if (node.type === 'text') {
      if (p.x + p.width > template.width + EPS || p.y + p.height > template.height + EPS) {
        report.error(
          'LAYER_OUT_OF_BOUNDS',
          `text "${node.id}" box (${p.x},${p.y} ${p.width}x${p.height}) exceeds canvas ${template.width}x${template.height}`,
          { nodeId: node.id },
        );
      }
    }
  }
  return report;
}

module.exports = { validateTimeline, validateLayerBounds, EPS };
