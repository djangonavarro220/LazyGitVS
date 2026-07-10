const fs = require('fs');
const path = require('path');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function writeScreenshot({ Page, name, force = false, screenshots, shots, variant, variantName, sleep }) {
  if (!force && screenshots !== 'all') return undefined;
  await sleep(300);
  const res = await Page.captureScreenshot({ format: 'png', captureBeyondViewport: false });
  const image = Buffer.from(res.data, 'base64');
  if (image.length < PNG_SIGNATURE.length || !image.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('CDP screenshot is not a valid PNG');
  }
  const dir = variant ? path.join(shots, variantName) : shots;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${String(name).replace(/[^a-z0-9_-]+/gi, '-')}.png`);
  fs.writeFileSync(file, image);
  return file;
}

module.exports = { writeScreenshot };
