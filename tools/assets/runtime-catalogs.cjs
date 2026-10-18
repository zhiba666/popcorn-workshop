'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validateAssetMetadata } = require('./asset-metadata.cjs');

const recipeFile = 'assets/recipes/runtime-catalogs.json';
const catalogDirectories = Object.freeze({
  board: 'assets/runtime/board/v1',
  entry: 'assets/runtime/entry/v1',
  factoryUpgrade: 'assets/runtime/factory-upgrade/v1',
  customerPage: 'assets/runtime/customer-page/v1',
  customerStatus: 'assets/runtime/customer-status/v1',
});
const factoryDirectory = 'assets/runtime/factory/v1';
const decorationDirectory = 'assets/runtime/decoration/v1';
const generatedComment = '// Generated from assets/recipes/runtime-catalogs.json; do not edit.\n';

function within(base, relative, label) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error('Invalid ' + label + ' path: ' + relative);
  const file = path.resolve(base, relative);
  const remainder = path.relative(base, file);
  if (!remainder || remainder === '..' || remainder.startsWith('..' + path.sep) || path.isAbsolute(remainder)) {
    throw new Error('Path outside ' + label + ': ' + relative);
  }
  return file;
}

function pngSize(file, label) {
  const bytes = fs.readFileSync(file);
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Expected PNG for ' + label + ': ' + file);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

function sourceSize(file, label) {
  if (path.extname(file) === '.png') return pngSize(file, label);
  if (path.extname(file) !== '.svg') throw new Error('Unsupported source artwork for ' + label + ': ' + file);
  const root = fs.readFileSync(file, 'utf8').match(/<svg\b[^>]*>/s)?.[0];
  const width = root?.match(/\bwidth=["']([\d.]+)(?:px)?["']/);
  const height = root?.match(/\bheight=["']([\d.]+)(?:px)?["']/);
  if (width && height) return [Number(width[1]), Number(height[1])];
  const viewBox = root?.match(/\bviewBox=["']([^"']+)["']/);
  if (viewBox) {
    const dimensions = viewBox[1].trim().split(/[ ,]+/).map(Number);
    if (dimensions.length === 4 && dimensions.every(Number.isFinite)) return dimensions.slice(2);
  }
  throw new Error('Missing SVG viewport dimensions for ' + label + ': ' + file);
}

function runtimeEntries(catalogs) {
  const entries = [];
  const add = (item, directory, image, source, sourceRelativeToCatalog = false) => {
    entries.push({ item, directory, image, source, sourceRelativeToCatalog });
  };
  for (const [key, directory] of Object.entries(catalogDirectories)) {
    const catalog = catalogs.catalogs[key];
    if (!catalog || typeof catalog !== 'object' || catalog.basePath !== directory + '/') {
      throw new Error('Invalid runtime catalog in ' + recipeFile + ': ' + key);
    }
    for (const group of ['ui', 'icons', 'assets']) {
      for (const item of Object.values(catalog[group] || {})) add(item, directory, item.runtime, item.source);
    }
    if (key === 'board') {
      if (!Array.isArray(catalog.reusedAssets)) throw new Error('Missing board reusedAssets in ' + recipeFile);
      for (const item of catalog.reusedAssets) add(item, directory, item.output, item.source);
    }
  }
  if (!Array.isArray(catalogs.factory) || !Array.isArray(catalogs.decoration) || !catalogs.floor) {
    throw new Error('Missing factory, decoration or floor catalog in ' + recipeFile);
  }
  for (const item of catalogs.factory) add(item, factoryDirectory, item.src, item.originalSource, true);
  for (const item of catalogs.decoration) add(item, decorationDirectory, item.src, item.sourceSrc, true);
  add(catalogs.floor, factoryDirectory, catalogs.floor.src, catalogs.floor.source);
  return entries;
}

// Runtime manifests are generated views. Only this recipe and source artwork
// are read here, so deleting assets/runtime never removes an authoring input.
function loadRuntimeCatalogs({ root = path.resolve(__dirname, '../..') } = {}) {
  root = path.resolve(root);
  const file = path.join(root, recipeFile);
  const catalogs = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (catalogs.schemaVersion !== 1 || !catalogs.catalogs || typeof catalogs.catalogs !== 'object') {
    throw new Error('Unsupported runtime catalog recipe: ' + file);
  }
  const outputs = new Set();
  for (const entry of runtimeEntries(catalogs)) {
    const directory = path.join(root, entry.directory);
    const output = within(directory, entry.image, 'runtime catalog');
    if (path.extname(output) !== '.png' || outputs.has(output)) throw new Error('Invalid or duplicate runtime catalog image: ' + output);
    outputs.add(output);
    const source = entry.sourceRelativeToCatalog ? path.resolve(directory, entry.source) : path.resolve(root, entry.source);
    const sourceFile = within(path.join(root, 'assets/source'), path.relative(path.join(root, 'assets/source'), source), 'source artwork');
    validateAssetMetadata(entry.item, { label: path.relative(root, output).replace(/\\/g, '/'), sourceSize: sourceSize(sourceFile, entry.source) });
  }
  return catalogs;
}

function scriptArray(name, items, resolver, additionalExports) {
  return generatedComment + resolver + '\nexport const ' + name + ' = ' + JSON.stringify(items, null, 2)
    + '.map(resolveAsset);\n\n' + additionalExports;
}

function writeRuntimeCatalogs({ root = path.resolve(__dirname, '../..'), outputRoot, refreshBytes = false } = {}) {
  if (!outputRoot) throw new Error('Runtime catalogs require an explicit outputRoot');
  root = path.resolve(root);
  outputRoot = path.resolve(outputRoot);
  const catalogs = loadRuntimeCatalogs({ root });
  for (const entry of runtimeEntries(catalogs)) {
    const relative = entry.directory + '/' + entry.image.replace(/^\.\//, '');
    if (refreshBytes) {
      const image = within(path.join(outputRoot, entry.directory), entry.image, 'generated runtime image');
      validateAssetMetadata(entry.item, { label: relative, pixelSize: pngSize(image, relative) });
      if (Object.hasOwn(entry.item, 'bytes')) entry.item.bytes = fs.statSync(image).size;
    } else validateAssetMetadata(entry.item, { label: relative });
  }
  const files = [];
  const write = (relative, text) => {
    const file = within(outputRoot, relative, 'runtime catalog output');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) fs.writeFileSync(file, text);
    files.push(relative);
  };
  for (const [key, directory] of Object.entries(catalogDirectories)) {
    write(directory + '/manifest.json', JSON.stringify(catalogs.catalogs[key], null, 2) + '\n');
  }
  const factoryResolver = '// Bounds and draw coordinates use final PNG pixels; sourceCrop is [left, top, right, bottom] in source pixels.\n'
    + 'const resolveAsset = item => ({\n  ...item,\n  src: new URL(item.src, import.meta.url).href,\n'
    + '  originalSource: new URL(item.originalSource, import.meta.url).href,\n});\n';
  write(factoryDirectory + '/manifest.js', scriptArray('runtimeFactoryAssets', catalogs.factory, factoryResolver,
    'export const runtimeFactoryAssetsById = Object.fromEntries(runtimeFactoryAssets.map(asset => [asset.id, asset]));\n'));
  const decorationResolver = 'const resolveAsset = item => ({\n  ...item,\n  src: new URL(item.src, import.meta.url).href,\n'
    + '  sourceSrc: new URL(item.sourceSrc, import.meta.url).href,\n});\n';
  write(decorationDirectory + '/manifest.js', scriptArray('factoryDecorationAssets', catalogs.decoration, decorationResolver,
    'export default factoryDecorationAssets;\n'));
  write(factoryDirectory + '/floor.js', generatedComment + 'const floor = ' + JSON.stringify(catalogs.floor, null, 2) + ';\n\n'
    + 'export const runtimeFactoryFloor = {\n  ...floor,\n  src: new URL(floor.src, import.meta.url).href,\n'
    + '  originalSource: new URL(floor.originalSource, import.meta.url).href,\n};\n\nexport default runtimeFactoryFloor;\n');
  return { count: files.length, files };
}

module.exports = { loadRuntimeCatalogs, writeRuntimeCatalogs };
