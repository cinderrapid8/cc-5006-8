'use strict';

const { spawnFile } = require('./process');
const path = require('path');
const fs = require('fs');

function resolveFfmpeg() {
  const local = path.join(__dirname, '..', 'node_modules', 'ffmpeg-static', 'ffmpeg');
  if (fs.existsSync(local)) return local;
  return 'ffmpeg';
}

function resolveFfprobe() {
  // ffprobe-static may omit the host-arch binary; fall back through its
  // other linux builds, then finally to a system ffprobe on PATH.
  const candidates = [];
  try {
    candidates.push(require('ffprobe-static').path);
  } catch {
    /* package absent */
  }
  const binRoot = path.join(__dirname, '..', 'node_modules', 'ffprobe-static', 'bin', 'linux');
  for (const arch of fs.readdirSync(binRoot)) {
    candidates.push(path.join(binRoot, arch, 'ffprobe'));
  }
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      /* try next */
    }
  }
  return 'ffprobe';
}

const FFMPEG = resolveFfmpeg();
const FFPROBE = resolveFfprobe();

// Independent probe: spawns ffprobe directly (no shell), parses JSON output.
async function probeMedia(filePath) {
  const args = [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ];
  const { stdout } = await spawnFile(FFPROBE, args);
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    throw new Error(`ffprobe returned unparseable output for ${filePath}: ${err.message}`);
  }
  const video = (parsed.streams || []).find((s) => s.codec_type === 'video');
  if (!video) {
    const e = new Error(`no video stream in ${filePath}`);
    e.code = 'PROBE_NO_VIDEO';
    throw e;
  }
  const duration = parsed.format && parsed.format.duration
    ? Number(parsed.format.duration)
    : Number(video.duration);
  return {
    width: video.width,
    height: video.height,
    duration: Number.isFinite(duration) ? duration : null,
    codec: video.codec_name,
    pixFmt: video.pix_fmt || null,
    hasAlpha: ['rgba', 'argb', 'abgr', 'bgra', 'yuva420p', 'pal8'].includes(video.pix_fmt),
    isImage: (video.avg_frame_rate || '').startsWith('0/0') || /png|mjpeg|bmp/.test(video.codec_name),
    raw: parsed,
  };
}

module.exports = { probeMedia, FFMPEG, FFPROBE };
