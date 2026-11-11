'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// Reject any id that could escape the data directory.
function assertSafeId(id) {
  if (!ID_RE.test(id)) {
    const err = new Error(`unsafe or invalid id: ${id}`);
    err.code = 'ID_UNSAFE';
    throw err;
  }
}

class JsonStore {
  constructor(root) {
    this.root = path.resolve(root);
    ensureDir(this.root);
    ensureDir(path.join(this.root, 'templates'));
    ensureDir(path.join(this.root, 'variable-tables'));
    ensureDir(path.join(this.root, 'jobs'));
    ensureDir(path.join(this.root, 'assets'));
    this.assetIndexPath = path.join(this.root, 'assets', 'index.json');
  }

  // ---- templates -------------------------------------------------------
  saveTemplate(template) {
    assertSafeId(template.id);
    writeJsonAtomic(path.join(this.root, 'templates', `${template.id}.json`), template);
    return template;
  }

  getTemplate(id) {
    assertSafeId(id);
    return readJson(path.join(this.root, 'templates', `${id}.json`), null);
  }

  listTemplates() {
    return fs.readdirSync(path.join(this.root, 'templates'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => readJson(path.join(this.root, 'templates', f)))
      .filter(Boolean);
  }

  // ---- variable tables -------------------------------------------------
  saveVariableTable(table) {
    assertSafeId(table.id);
    writeJsonAtomic(path.join(this.root, 'variable-tables', `${table.id}.json`), table);
    return table;
  }

  getVariableTable(id) {
    assertSafeId(id);
    return readJson(path.join(this.root, 'variable-tables', `${id}.json`), null);
  }

  listVariableTables() {
    return fs.readdirSync(path.join(this.root, 'variable-tables'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => readJson(path.join(this.root, 'variable-tables', f)))
      .filter(Boolean);
  }

  // ---- jobs ------------------------------------------------------------
  saveJob(job) {
    assertSafeId(job.id);
    writeJsonAtomic(path.join(this.root, 'jobs', `${job.id}.json`), job);
    return job;
  }

  getJob(id) {
    assertSafeId(id);
    return readJson(path.join(this.root, 'jobs', `${id}.json`), null);
  }

  listJobs() {
    return fs.readdirSync(path.join(this.root, 'jobs'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => readJson(path.join(this.root, 'jobs', f)))
      .filter(Boolean);
  }

  jobDir(id) {
    assertSafeId(id);
    const dir = path.join(this.root, 'jobs', id);
    ensureDir(dir);
    return dir;
  }
}

class AssetStore {
  constructor(root) {
    this.dir = path.join(root, 'assets');
    ensureDir(this.dir);
    this.indexPath = path.join(this.dir, 'index.json');
  }

  _index() {
    return readJson(this.indexPath, {});
  }

  _save(index) {
    writeJsonAtomic(this.indexPath, index);
  }

  register(originalName, ext, probe) {
    const id = `ast_${crypto.randomBytes(10).toString('hex')}`;
    const safeExt = /^\.[a-z0-9]{1,8}$/i.test(ext) ? ext.toLowerCase() : '.bin';
    const fileName = `${id}${safeExt}`;
    const record = {
      id,
      originalName: String(originalName).slice(0, 200),
      path: path.join(this.dir, fileName),
      safeExt,
      createdAt: new Date().toISOString(),
      probe,
    };
    const index = this._index();
    index[id] = record;
    this._save(index);
    return record;
  }

  get(id) {
    if (!ID_RE.test(id || '')) return null;
    return this._index()[id] || null;
  }

  list() {
    return Object.values(this._index());
  }
}

module.exports = { JsonStore, AssetStore, assertSafeId };
