'use strict';

// Generates the three brand data packages and their media fixtures.
// Everything is produced locally; no placeholder files are ever used.

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');
const { spawnFile } = require('../src/process');
const { FFMPEG } = require('../src/probe');

const ROOT = path.join(__dirname, '..', 'packs');
const W = 1280;
const H = 720;
const FPS = 30;

function writePng(file, width, height, draw) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  draw(ctx, width, height);
  fs.writeFileSync(file, canvas.toBuffer('image/png'));
}

async function makeBackground(out, seconds, hue) {
  // animated test source, yuv420p — stands in for a real campaign clip
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i',
    `testsrc2=size=${W}x${H}:rate=${FPS}:duration=${seconds}`,
    '-vf', `hue=h=${hue}:s=1.4,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-pix_fmt', 'yuv420p',
    out,
  ];
  await spawnFile(FFMPEG, args);
}

function makeLogo(out, { color, mark }) {
  // 320x180 RGBA PNG with a genuinely transparent background (pixels around mark)
  writePng(out, 320, 180, (ctx) => {
    ctx.clearRect(0, 0, 320, 180);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(90, 90, 56, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 40px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(mark, 150, 78);
    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = color;
    ctx.fillText('STUDIO', 150, 116);
  });
}

function makeEndcard(out, { brand, color, tagline }) {
  writePng(out, W, H, (ctx) => {
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, color);
    grad.addColorStop(1, '#10142c');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 96px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(brand, W / 2, H / 2 - 30);
    ctx.font = '36px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(tagline, W / 2, H / 2 + 50);
  });
}

async function main() {
  fs.rmSync(ROOT, { recursive: true, force: true });
  for (const pack of ['aurora', 'boreal', 'cobalt']) {
    fs.mkdirSync(path.join(ROOT, pack, 'assets'), { recursive: true });
    fs.mkdirSync(path.join(ROOT, pack, 'renders'), { recursive: true });
  }

  await makeBackground(path.join(ROOT, 'aurora/assets/bg12.mp4'), 12, 20);
  await makeBackground(path.join(ROOT, 'boreal/assets/bg12.mp4'), 12, 140);
  await makeBackground(path.join(ROOT, 'cobalt/assets/bg12.mp4'), 12, 260);
  await makeBackground(path.join(ROOT, 'cobalt/assets/bg6.mp4'), 6, 260);

  makeLogo(path.join(ROOT, 'aurora/assets/logo.png'), { color: '#e8503a', mark: 'A' });
  makeLogo(path.join(ROOT, 'boreal/assets/logo.png'), { color: '#1f9d6b', mark: 'B' });
  makeLogo(path.join(ROOT, 'cobalt/assets/logo.png'), { color: '#3a6ee8', mark: 'C' });

  makeEndcard(path.join(ROOT, 'aurora/assets/endcard.png'), { brand: 'AURORA', color: '#7a1e3f', tagline: 'Light up your day' });
  makeEndcard(path.join(ROOT, 'boreal/assets/endcard.png'), { brand: 'BOREAL', color: '#0f5132', tagline: 'Go further north' });
  makeEndcard(path.join(ROOT, 'cobalt/assets/endcard.png'), { brand: 'COBALT', color: '#163a7a', tagline: 'Engineered to last' });

  console.log('fixtures written to', ROOT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
