'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { optimizeReleasePngs } = require('../tools/assets/build-release.cjs');

const game = path.resolve(__dirname, '../douyin-game');

test('the unbundled Douyin directory stays below the conservative 20 MB limit', () => {
  function packagedBytes(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).reduce((sum, entry) => {
      // The Douyin IDE excludes Unix dot files/directories, node_modules and JS maps.
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name.endsWith('.js.map')) return sum;
      const file = path.join(directory, entry.name);
      return sum + (entry.isDirectory() ? packagedBytes(file) : fs.statSync(file).size);
    }, 0);
  }
  const bytes = packagedBytes(game);
  assert.ok(bytes < 20_000_000, `Douyin package contains ${bytes} bytes; it must stay below 20,000,000`);
});

test('release PNG optimization reduces real inputs without changing dimensions or RGBA pixels', async () => {
  const temporaryBase = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(temporaryBase, 'iaa-release-assets-'));
  try {
    const examples = [];
    for (const [name, relative] of [
      ['opaque-background', 'assets/ui/background-room.png'],
      ['transparent-customer', 'assets/customer-details/rabbit-courier.png'],
      ['factory-machine', 'assets/factory/air-popper-body-clean.png'],
    ]) {
      const decoded = await sharp(path.join(game, relative)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      examples.push({ name, ...decoded });
    }
    const width = 17, height = 13, boundary = Buffer.alloc(width * height * 4);
    const alphas = [0, 1, 127, 254, 255];
    for (let pixel = 0; pixel < width * height; pixel++) {
      boundary[pixel * 4] = pixel % 2 ? 231 : 19;
      boundary[pixel * 4 + 1] = 83;
      boundary[pixel * 4 + 2] = 147;
      boundary[pixel * 4 + 3] = alphas[pixel % alphas.length];
    }
    examples.push({ name: 'transparent-boundaries', data: boundary, info: { width, height, channels: 4 } });

    const entries = {};
    for (const example of examples) {
      const relative = example.name + '.png';
      // Force a real rewrite instead of checking already optimized release files.
      const uncompressed = await sharp(example.data, { raw: example.info })
        .png({ compressionLevel: 0, adaptiveFiltering: false, palette: false }).toBuffer();
      fs.writeFileSync(path.join(directory, relative), uncompressed);
      entries[example.name] = { path: relative };
      example.inputBytes = uncompressed.length;
    }

    optimizeReleasePngs(directory, entries);

    for (const example of examples) {
      const output = fs.readFileSync(path.join(directory, entries[example.name].path));
      assert.ok(output.length < example.inputBytes, `${example.name} must exercise the smaller-output branch`);
      const decoded = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.equal(decoded.info.width, example.info.width, `${example.name} width`);
      assert.equal(decoded.info.height, example.info.height, `${example.name} height`);
      assert.equal(decoded.data.equals(example.data), true, `${example.name} RGBA pixels`);
    }
  } finally {
    // Only remove the immediate system-temp child created above.
    assert.equal(path.dirname(directory), temporaryBase);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
