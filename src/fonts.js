'use strict';

const fs = require('fs');
const path = require('path');
const { GlobalFonts } = require('@napi-rs/canvas');

// Explicit font catalog. Preview (canvas) and render (ffmpeg drawtext) both
// resolve through this same map, so layout metrics can never drift apart.
const DEFAULT_FONT_DIRS = [
  '/usr/share/fonts/truetype/dejavu',
  path.join(__dirname, '..', 'assets', 'fonts'),
];

const DEFAULT_CATALOG = {
  'DejaVu Sans::normal': 'DejaVuSans.ttf',
  'DejaVu Sans::bold': 'DejaVuSans-Bold.ttf',
  'DejaVu Serif::normal': 'DejaVuSerif.ttf',
  'DejaVu Serif::bold': 'DejaVuSerif-Bold.ttf',
  'DejaVu Sans Mono::normal': 'DejaVuSansMono.ttf',
  'DejaVu Sans Mono::bold': 'DejaVuSansMono-Bold.ttf',
};

const catalog = new Map();
const aliases = new Map();

function registerFont(family, weight, filePath) {
  if (!fs.existsSync(filePath)) return false;
  const key = `${family}::${weight}`;
  catalog.set(key, filePath);
  const alias = weight === 'bold' ? `${family} Bold` : family;
  GlobalFonts.registerFromPath(filePath, alias);
  aliases.set(key, alias);
  return true;
}

function initFonts() {
  const dirs = (process.env.FONT_DIRS ? process.env.FONT_DIRS.split(':') : []).concat(DEFAULT_FONT_DIRS);
  for (const [key, file] of Object.entries(DEFAULT_CATALOG)) {
    const [family, weight] = key.split('::');
    for (const dir of dirs) {
      if (registerFont(family, weight, path.join(dir, file))) break;
    }
  }
  // pick up any extra *.ttf dropped into assets/fonts using filename convention
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.ttf'))) {
      const bold = /bold/i.test(file);
      const family = file.replace(/\.ttf$/i, '').replace(/[-_]?bold$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2');
      registerFont(family, bold ? 'bold' : 'normal', path.join(dir, file));
    }
  }
}

function resolveFontFile(family, weight = 'normal') {
  const key = `${family}::${weight}`;
  const file = catalog.get(key);
  if (!file) {
    const err = new Error(`font not registered: ${family} (${weight})`);
    err.code = 'FONT_NOT_FOUND';
    err.fontKey = key;
    throw err;
  }
  return file;
}

function canvasFamilyAlias(family, weight = 'normal') {
  return aliases.get(`${family}::${weight}`);
}

function listFonts() {
  return [...catalog.keys()].map((key) => {
    const [family, weight] = key.split('::');
    return { family, weight, file: catalog.get(key) };
  });
}

module.exports = { initFonts, resolveFontFile, canvasFamilyAlias, listFonts };
