const { spawn } = require('node:child_process');
const path = require('node:path');

const electronBinary = require('electron');
const isLinux = process.platform === 'linux';
const command = isLinux ? 'xvfb-run' : electronBinary;
const args = isLinux
  ? ['-a', electronBinary, '.', '--smoke-test']
  : ['.', '--smoke-test'];

const child = spawn(command, args, {
  cwd: path.resolve(__dirname, '..'),
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
  stdio: 'inherit',
  windowsHide: true
});

const timeout = setTimeout(() => {
  console.error('Electron smoke test timed out after 60 seconds.');
  child.kill();
  process.exitCode = 1;
}, 60_000);

child.on('error', (error) => {
  clearTimeout(timeout);
  console.error('Unable to launch Electron smoke test:', error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  clearTimeout(timeout);
  if (signal) {
    console.error(`Electron smoke test ended by signal ${signal}`);
    process.exitCode = 1;
  } else if (code !== 0) {
    console.error(`Electron smoke test failed with exit code ${code}`);
    process.exitCode = code || 1;
  }
});
