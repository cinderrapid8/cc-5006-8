'use strict';

const fs = require('fs');
const path = require('path');
const { ValidationError } = require('./errors');
const { validateTemplateShape, validateReferences } = require('./schema');
const { validateTimeline, validateLayerBounds } = require('./timeline');
const { validateBindings } = require('./assets');
const { validateVariables, validateTextLayout } = require('./text');
const { prepareTextImages } = require('./text-render');
const { compileGraph } = require('./compiler');
const { spawnFile } = require('./process');
const { probeMedia, FFMPEG, FFPROBE } = require('./probe');

// Full validation pipeline. Throws ValidationError with locatable issues.
async function validateTemplate(template, variables, bindings, assetStore) {
  const shape = validateTemplateShape(template);
  const refs = shape.ok ? validateReferences(template) : { errors: [], warnings: [] };
  const timeline = shape.ok ? validateTimeline(template) : { errors: [], warnings: [] };
  const bounds = shape.ok ? validateLayerBounds(template) : { errors: [], warnings: [] };
  const bindingResult = shape.ok ? await validateBindings(template, bindings, assetStore)
    : { report: { errors: [], warnings: [] }, probes: {} };
  const vars = shape.ok ? validateVariables(template, variables) : { errors: [], warnings: [] };
  const layout = shape.ok ? validateTextLayout(template, variables || {})
    : { report: { errors: [], warnings: [] }, measurements: [] };

  const errors = [
    ...shape.errors,
    ...refs.errors,
    ...timeline.errors,
    ...bounds.errors,
    ...bindingResult.report.errors,
    ...vars.errors,
    ...layout.report.errors,
  ];
  const warnings = [
    ...shape.warnings, ...refs.warnings, ...timeline.warnings, ...bounds.warnings,
    ...bindingResult.report.warnings, ...vars.warnings, ...layout.report.warnings,
  ];
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    measurements: layout.measurements,
    probes: bindingResult.probes,
  };
}

async function buildGraph(template, variables, bindings, assetStore, jobDir, options = {}) {
  const result = await validateTemplate(template, variables, bindings, assetStore);
  if (!result.ok) throw new ValidationError(result.errors);
  const { images } = prepareTextImages(template, variables, jobDir);
  return compileGraph(template, bindings, assetStore, result.measurements, jobDir, {
    textImages: images,
    ...options,
  });
}

// Independent acceptance probe — separate process from the compile/render path.
async function verifyOutput(outputPath, template) {
  const info = await probeMedia(outputPath);
  const checks = {
    duration: { expected: template.duration, actual: info.duration },
    width: { expected: template.width, actual: info.width },
    height: { expected: template.height, actual: info.height },
  };
  const problems = [];
  if (Math.abs(info.duration - template.duration) > 0.12) {
    problems.push(`duration ${info.duration}s != expected ${template.duration}s`);
  }
  if (info.width !== template.width || info.height !== template.height) {
    problems.push(`size ${info.width}x${info.height} != expected ${template.width}x${template.height}`);
  }
  return { ok: problems.length === 0, problems, probe: info, checks };
}

async function runRenderJob(job, deps) {
  const { store, assetStore } = deps;
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  store.saveJob(job);
  try {
    const template = store.getTemplate(job.templateId);
    const jobDir = path.join(store.root, 'jobs', job.id);
    fs.mkdirSync(jobDir, { recursive: true });

    const validation = await validateTemplate(template, job.variables, job.bindings, assetStore);
    job.validation = { ok: validation.ok, errors: validation.errors, warnings: validation.warnings };
    if (!validation.ok) {
      job.status = 'rejected';
      job.finishedAt = new Date().toISOString();
      store.saveJob(job);
      return job;
    }

    const { images: textImages } = prepareTextImages(template, job.variables, jobDir);
    const graph = compileGraph(template, job.bindings, assetStore, validation.measurements, jobDir, { textImages });
    const outputPath = path.join(jobDir, 'output.mp4');
    const argv = [...graph.argv.slice(1), outputPath]; // argv[0] is the logical name
    job.graph = { argv: [FFMPEG, ...argv], filterGraph: graph.filterGraph };
    store.saveJob(job);

    await spawnFile(FFMPEG, argv, { cwd: jobDir });

    const verification = await verifyOutput(outputPath, template);
    job.output = {
      path: outputPath,
      probe: verification.probe,
      checks: verification.checks,
      verified: verification.ok,
    };
    if (!verification.ok) {
      job.status = 'failed_verification';
      job.error = verification.problems.join('; ');
    } else {
      job.status = 'completed';
    }
    job.finishedAt = new Date().toISOString();
    store.saveJob(job);
    return job;
  } catch (err) {
    if (err instanceof ValidationError) {
      job.status = 'rejected';
      job.validation = { ok: false, errors: err.errors };
    } else {
      job.status = 'failed';
      job.error = err.message;
    }
    job.finishedAt = new Date().toISOString();
    store.saveJob(job);
    return job;
  }
}

async function renderPreview(template, variables, bindings, assetStore, store, timeSec) {
  const jobDir = path.join(store.root, 'jobs', `preview_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(jobDir, { recursive: true });
  const validation = await validateTemplate(template, variables, bindings, assetStore);
  if (!validation.ok) return { ok: false, validation };

  const t = Math.max(0, Math.min(timeSec ?? 0, template.duration - 0.05));
  const { images: textImages } = prepareTextImages(template, variables, jobDir);
  const graph = compileGraph(template, bindings, assetStore, validation.measurements, jobDir, { textImages, previewAt: t });
  const outputPath = path.join(jobDir, 'preview.png');
  const argv = [...graph.argv.slice(1), '-ss', String(t), outputPath];
  await spawnFile(FFMPEG, argv, { cwd: jobDir });
  return {
    ok: true,
    outputPath,
    validation,
    filterGraph: graph.filterGraph,
    argv: [FFMPEG, ...argv],
  };
}

module.exports = { validateTemplate, buildGraph, runRenderJob, renderPreview, verifyOutput, FFMPEG, FFPROBE };
