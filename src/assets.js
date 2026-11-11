'use strict';

const fs = require('fs');
const { Report } = require('./errors');
const { probeMedia } = require('./probe');

const DIM_TOLERANCE = 0; // declared pixel dimensions must match exactly (or be within max)
const DURATION_TOLERANCE = 0.05;

async function validateBindings(template, bindings, assetStore) {
  const report = new Report();
  const probes = {};

  for (const slot of template.slots) {
    const loc = { slotId: slot.id };
    const assetId = bindings ? bindings[slot.id] : undefined;

    if (!assetId) {
      if (slot.required) {
        report.error('ASSET_MISSING', `required slot "${slot.id}" has no asset bound (no placeholder substitution)`, loc);
      }
      continue;
    }

    const record = assetStore.get(assetId);
    if (!record) {
      report.error('ASSET_NOT_FOUND', `slot "${slot.id}" bound to unknown asset "${assetId}"`, loc);
      continue;
    }
    if (!fs.existsSync(record.path)) {
      report.error('ASSET_FILE_GONE', `asset "${assetId}" file is missing on disk`, loc);
      continue;
    }

    let info;
    try {
      info = await probeMedia(record.path);
    } catch (err) {
      report.error('ASSET_UNREADABLE', `slot "${slot.id}": ${err.message}`, loc);
      continue;
    }
    probes[slot.id] = { assetId, info };

    if (info.width === 0 || !info.width || !info.height) {
      report.error('ASSET_DIMENSIONS', `slot "${slot.id}": could not determine dimensions`, loc);
      continue;
    }

    const mode = slot.match || 'exact';
    if (mode === 'exact') {
      if (Math.abs(info.width - slot.width) > DIM_TOLERANCE || Math.abs(info.height - slot.height) > DIM_TOLERANCE) {
        report.error(
          'ASSET_DIMENSIONS',
          `slot "${slot.id}" needs exactly ${slot.width}x${slot.height}, asset "${assetId}" is ${info.width}x${info.height}`,
          loc,
        );
      }
    } else {
      if (info.width > slot.width || info.height > slot.height) {
        report.error(
          'ASSET_DIMENSIONS',
          `slot "${slot.id}" allows max ${slot.width}x${slot.height}, asset "${assetId}" is ${info.width}x${info.height}`,
          loc,
        );
      }
    }

    if (slot.kind === 'video') {
      if (info.duration === null) {
        report.error('ASSET_DURATION', `slot "${slot.id}": duration unknown`, loc);
      } else if (info.duration + DURATION_TOLERANCE < slot.minDuration) {
        report.error(
          'ASSET_DURATION_SHORT',
          `slot "${slot.id}" needs >= ${slot.minDuration}s, asset "${assetId}" is only ${info.duration.toFixed(3)}s`,
          loc,
        );
      }
    }

    if (slot.requiresAlpha && !info.hasAlpha) {
      report.error(
        'ASSET_ALPHA',
        `slot "${slot.id}" requires transparency but asset "${assetId}" pixel format "${info.pixFmt}" has no alpha channel`,
        loc,
      );
    }
  }

  // reject bindings to slots the template never declared
  if (bindings && typeof bindings === 'object') {
    const declared = new Set(template.slots.map((s) => s.id));
    for (const slotId of Object.keys(bindings)) {
      if (!declared.has(slotId)) {
        report.error('SLOT_UNKNOWN', `binding targets slot "${slotId}" which the template does not declare`, { slotId });
      }
    }
  }
  return { report, probes };
}

module.exports = { validateBindings, DURATION_TOLERANCE };
