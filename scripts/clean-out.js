#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'out');
if (path.dirname(outDir) !== root || path.basename(outDir) !== 'out') {
  throw new Error(`Refusing to clean unexpected output path: ${outDir}`);
}
fs.rmSync(outDir, { recursive: true, force: true });
