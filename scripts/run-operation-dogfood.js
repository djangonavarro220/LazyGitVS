#!/usr/bin/env node
const net = require('net');
const path = require('path');
const { spawnSync } = require('child_process');

const server = net.createServer();
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : undefined;
  server.close(() => {
    if (!port) throw new Error('Could not allocate a free CDP port');
    const dogfoodArgs = [process.execPath, path.join(__dirname, 'dogfood-ui.js')];
    const command = process.env.DISPLAY ? dogfoodArgs.shift() : 'xvfb-run';
    const args = process.env.DISPLAY ? dogfoodArgs : ['-a', ...dogfoodArgs];
    const result = spawnSync(command, args, {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit',
      env: { ...process.env, LGVS_DOGFOOD_VARIANT: 'no-vim', LGVS_DOGFOOD_OPERATION_STATUS: '1', LGVS_DOGFOOD_CDP_PORT: String(port) }
    });
    process.exit(result.status ?? 1);
  });
});
server.on('error', error => { throw error; });