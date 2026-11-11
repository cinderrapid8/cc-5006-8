'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { initFonts, listFonts } = require('./fonts');
const { JsonStore, AssetStore } = require('./store');
const { validateTemplateShape, validateReferences } = require('./schema');
const { probeMedia } = require('./probe');
const { validateTemplate, renderPreview, runRenderJob } = require('./render');

function createApp(dataRoot) {
  initFonts();
  const store = new JsonStore(dataRoot);
  const assetStore = new AssetStore(dataRoot);
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // serial job queue: deterministic ordering, no concurrent ffmpeg storms
  const queue = [];
  let draining = false;
  function enqueue(job) {
    queue.push(job);
    drain();
  }
  async function drain() {
    if (draining) return;
    draining = true;
    while (queue.length) {
      const job = queue.shift();
      await runRenderJob(job, { store, assetStore });
    }
    draining = false;
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/fonts', (_req, res) => res.json(listFonts()));

  // ---- templates -------------------------------------------------------
  app.post('/api/templates', (req, res) => {
    const template = req.body;
    const shape = validateTemplateShape(template);
    const refs = shape.ok ? validateReferences(template) : { errors: [] };
    const errors = [...shape.errors, ...refs.errors];
    if (errors.length) return res.status(400).json({ ok: false, errors });
    store.saveTemplate(template);
    res.json({ ok: true, template });
  });
  app.get('/api/templates', (_req, res) => res.json(store.listTemplates()));
  app.get('/api/templates/:id', (req, res) => {
    const t = store.getTemplate(req.params.id);
    if (!t) return res.status(404).json({ ok: false, error: 'template not found' });
    res.json(t);
  });

  // ---- variable tables -------------------------------------------------
  app.post('/api/variable-tables', (req, res) => {
    const table = req.body;
    if (!table || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(table.id || '') || typeof table.values !== 'object') {
      return res.status(400).json({ ok: false, error: 'table needs id and values object' });
    }
    store.saveVariableTable(table);
    res.json({ ok: true, table });
  });
  app.get('/api/variable-tables', (_req, res) => res.json(store.listVariableTables()));
  app.get('/api/variable-tables/:id', (req, res) => {
    const t = store.getVariableTable(req.params.id);
    if (!t) return res.status(404).json({ ok: false, error: 'table not found' });
    res.json(t);
  });

  // ---- assets: raw binary upload, independent probe on intake ----------
  app.post('/api/assets', async (req, res) => {
    try {
      const rawName = String(req.query.name || 'upload.bin');
      const ext = path.extname(rawName).toLowerCase();
      if (!/^\.[a-z0-9]{1,8}$/.test(ext)) {
        return res.status(400).json({ ok: false, error: 'filename extension rejected' });
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 512 * 1024 * 1024) {
          res.status(413).json({ ok: false, error: 'asset exceeds 512MB' });
          return req.destroy();
        }
        chunks.push(chunk);
      }
      const record = assetStore.register(rawName, ext, null);
      fs.writeFileSync(record.path, Buffer.concat(chunks));
      const info = await probeMedia(record.path);
      record.probe = info;
      const index = Object.fromEntries(assetStore.list().map((r) => [r.id, r]));
      fs.writeFileSync(assetStore.indexPath, JSON.stringify(index, null, 2));
      res.json({ ok: true, asset: record });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });
  app.get('/api/assets', (_req, res) => res.json(assetStore.list()));
  app.get('/api/assets/:id', (req, res) => {
    const record = assetStore.get(req.params.id);
    if (!record || !fs.existsSync(record.path)) return res.status(404).json({ ok: false, error: 'asset not found' });
    res.sendFile(path.resolve(record.path));
  });

  // ---- validation / preview / render -----------------------------------
  app.post('/api/validate', async (req, res) => {
    const { templateId, variables, bindings } = req.body || {};
    const template = store.getTemplate(templateId);
    if (!template) return res.status(404).json({ ok: false, error: 'template not found' });
    const result = await validateTemplate(template, variables || {}, bindings || {}, assetStore);
    res.json(result);
  });

  app.post('/api/preview', async (req, res) => {
    try {
      const { templateId, variables, bindings, time } = req.body || {};
      const template = store.getTemplate(templateId);
      if (!template) return res.status(404).json({ ok: false, error: 'template not found' });
      const result = await renderPreview(template, variables || {}, bindings || {}, assetStore, store, Number(time) || 0);
      if (!result.ok) return res.status(422).json({ ok: false, validation: result.validation });
      res.sendFile(path.resolve(result.outputPath));
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message, errors: err.errors });
    }
  });

  app.post('/api/jobs', async (req, res) => {
    const { templateId, variables, bindings, name } = req.body || {};
    const template = store.getTemplate(templateId);
    if (!template) return res.status(404).json({ ok: false, error: 'template not found' });

    // block formal render up-front when required material is missing
    const preflight = await validateTemplate(template, variables || {}, bindings || {}, assetStore);
    if (!preflight.ok) {
      return res.status(422).json({ ok: false, errors: preflight.errors, measurements: preflight.measurements });
    }
    const job = {
      id: `job_${crypto.randomBytes(8).toString('hex')}`,
      name: String(name || 'render task').slice(0, 120),
      templateId,
      variables: variables || {},
      bindings: bindings || {},
      status: 'queued',
      createdAt: new Date().toISOString(),
    };
    store.saveJob(job);
    enqueue(job);
    res.json({ ok: true, job });
  });

  app.get('/api/jobs', (_req, res) => res.json(store.listJobs().sort((a, b) => b.createdAt.localeCompare(a.createdAt))));
  app.get('/api/jobs/:id', (req, res) => {
    const job = store.getJob(req.params.id);
    if (!job) return res.status(404).json({ ok: false, error: 'job not found' });
    res.json(job);
  });
  app.get('/api/jobs/:id/output', (req, res) => {
    const job = store.getJob(req.params.id);
    const out = job && job.output && job.output.path;
    if (!out || !fs.existsSync(out)) return res.status(404).json({ ok: false, error: 'output not ready' });
    res.sendFile(path.resolve(out));
  });

  app.use(express.static(path.join(__dirname, '..', 'web')));
  return { app, store, assetStore };
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const dataRoot = process.env.DATA_ROOT || path.join(__dirname, '..', 'data');
  const { app } = createApp(dataRoot);
  app.listen(port, () => {
    console.log(`ad composer listening on http://localhost:${port} (data: ${dataRoot})`);
  });
}

module.exports = { createApp };
