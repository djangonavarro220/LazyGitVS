const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function assertPng(file, source) {
  const image = fs.readFileSync(file);
  if (image.length < PNG_SIGNATURE.length || !image.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error(`${source} screenshot is not a valid PNG`);
  }
}

async function writeScreenshot({ Page, name, force = false, screenshots, shots, variant, variantName, sleep }) {
  if (!force && screenshots !== 'all') return undefined;
  await sleep(300);
  const res = await Page.captureScreenshot({ format: 'png', captureBeyondViewport: false });
  const image = Buffer.from(res.data, 'base64');
  const dir = variant ? path.join(shots, variantName) : shots;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${String(name).replace(/[^a-z0-9_-]+/gi, '-')}.png`);
  fs.writeFileSync(file, image);
  assertPng(file, 'CDP');
  return file;
}

async function writeNativeScreenshot({ name, shots, display, xauthority, sleep, capture = ({ display, xauthority, file }) => execFileSync('import', ['-display', display, '-window', 'root', file], { env: { ...process.env, XAUTHORITY: xauthority } }) }) {
  await sleep(300);
  fs.mkdirSync(shots, { recursive: true });
  const file = path.join(shots, `${String(name).replace(/[^a-z0-9_-]+/gi, '-')}.png`);
  capture({ display, xauthority, file });
  assertPng(file, 'Native');
  return file;
}

module.exports = { writeNativeScreenshot, writeScreenshot };
