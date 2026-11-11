'use strict';

const { spawn } = require('child_process');

// Every external binary in this project is spawned with an argv array and
// shell:false, so user content can never become shell syntax.
function spawnFile(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      shell: false,
      windowsHide: true,
      ...opts,
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on('data', (c) => stdoutChunks.push(c));
    child.stderr.on('data', (c) => stderrChunks.push(c));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      if (code === 0) resolve({ stdout, stderr, code });
      else {
        const err = new Error(`${bin} exited with code ${code}${signal ? ` (signal ${signal})` : ''}: ${stderr.slice(-2000)}`);
        err.code = 'PROCESS_FAILED';
        err.exitCode = code;
        err.stderr = stderr;
        reject(err);
      }
    });
  });
}

module.exports = { spawnFile };
