'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const { buildCustomerContent } = require('../content/build-customer-content.cjs');
const { normalizeAssetMetadata } = require('./asset-metadata.cjs');

// Preserve decoded pixels while reducing the local mini-game package size.
// Source and runtime artwork stay untouched.
function optimizeReleasePngs(game, entries) {
  const sharpModule = require.resolve('sharp');
  const optimize = `const fs = require('node:fs');
const sharp = require(${JSON.stringify(sharpModule)});
const files = JSON.parse(fs.readFileSync(0, 'utf8'));
(async () => { for (const file of files) {
  const original = fs.readFileSync(file);
  const encoded = await sharp(original).png({ compressionLevel: 9, adaptiveFiltering: true, palette: false }).toBuffer();
  if (encoded.length < original.length) fs.writeFileSync(file, encoded);
} })().catch(error => { console.error(error); process.exitCode = 1; });`;
  execFileSync(process.execPath, ['-e', optimize], {
    input: JSON.stringify(Object.values(entries).map(item => path.join(game, item.path))),
    stdio: ['pipe', 'inherit', 'inherit'],
  });
}

function buildReleaseAssets({ root, sceneOnly = false }) {
const game = path.join(root, 'douyin-game');
const gameManifestFile = path.join(game, 'src/generated/assets-manifest.js');

buildCustomerContent({ root });

// Scene artwork is authored in SVG, but the mini-game only loads PNGs. Keep
// logical coordinates unchanged and bake a 2x transparent raster for each piece.
function includeFactorySceneAssets(target) {
  const sourceRoot = path.join(root, 'assets/source/factory');
  const sceneCatalog = (relative, expression) => {
    const file = path.join(sourceRoot, relative);
    const source = fs.readFileSync(file, 'utf8').replace(/export const /g, 'const ')
      .replace(/export default [^;]+;/g, '')
      .replace(/import\.meta\.url/g, JSON.stringify(pathToFileURL(file).href));
    return vm.runInNewContext(source + '\n' + expression, { URL });
  };
  const logistics = sceneCatalog('logistics/v1/manifest.js', 'factoryLogisticsAssets');
  const states = sceneCatalog('states/v1/manifest.js', 'factoryStateAssets');
  const ui = sceneCatalog('ui/v1/manifest.js', 'factoryUIAssets');
  const expansion = sceneCatalog('expansion/v1/manifest.js', 'factoryExpansionAssets');
  const jobs = [];
  const add = (id, relative, item, extra = {}) => {
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) throw new Error('Invalid factory scene asset ID: ' + id);
    const size = item.size || [item.width, item.height];
    positiveSize(size, 'factory/' + id);
    const anchorPixels = item.anchor || size.map(value => value / 2);
    const output = 'assets/factory/' + id + '.png';
    const { src, width, height, id: unusedId, ...metadata } = item;
    target['factory/' + id] = { ...metadata, ...extra, size, sourceSize: size,
      rasterSize: size.map(value => value * 2), runtimePixelRatio: 2,
      anchor: anchorPixels.map((value, index) => value / size[index]), anchorPixels,
      transparent: true, path: output };
    const source = assetFile(sourceRoot, relative, sourceRoot, 'factory/' + id);
    jobs.push({ source, destination: path.join(game, output),
      width: size[0] * 2, height: size[1] * 2 });
  };
  for (const [id, item] of Object.entries(logistics.assets)) {
    add('logistics-' + id, 'logistics/v1/' + item.src, item, {
      projection: logistics.projection, stride: logistics.stride,
    });
  }
  for (const axis of ['h', 'v']) {
    add('logistics-foreground-rail-' + axis, 'logistics/v2/foreground-rail-' + axis + '.svg',
      { size: logistics.tileSize, anchor: logistics.anchor }, { projection: logistics.projection });
  }
  for (const id of ['selection-ring', 'contact-shadow']) add(id, 'states/v1/' + id + '.svg', states[id]);
  add('nameplate', 'ui/v1/nameplate.svg', ui.assets.nameplate);
  for (const id of ['construction-platform', 'expansion-plus-sign', 'floor-stone-tile']) {
    add(id, 'expansion/v1/' + id + '.svg', expansion.assets[id], { projection: expansion.projection });
  }

  const sharpModule = require.resolve('sharp');
  // A child process keeps this build synchronous while sharp completes its jobs.
  // Write only changed bytes, so the scene-only path leaves unrelated art intact.
  const rasterize = `const fs = require('node:fs'), path = require('node:path');
const sharp = require(${JSON.stringify(sharpModule)});
const jobs = JSON.parse(fs.readFileSync(0, 'utf8'));
(async () => { for (const job of jobs) {
  const bytes = await sharp(job.source, { density: 144 }).resize(job.width, job.height)
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false }).toBuffer();
  fs.mkdirSync(path.dirname(job.destination), { recursive: true });
  if (!fs.existsSync(job.destination) || !fs.readFileSync(job.destination).equals(bytes)) fs.writeFileSync(job.destination, bytes);
} })().catch(error => { console.error(error); process.exitCode = 1; });`;
  execFileSync(process.execPath, ['-e', rasterize], { input: JSON.stringify(jobs), stdio: ['pipe', 'inherit', 'inherit'] });
  return jobs.length;
}

if (sceneOnly) {
  const sceneManifest = require(gameManifestFile);
  for (const [id, item] of Object.entries(sceneManifest)) {
    if (/^assets\/factory\/(logistics-|selection-ring\.png$|contact-shadow\.png$|nameplate\.png$|construction-platform\.png$|expansion-plus-sign\.png$|floor-stone-tile\.png$)/.test(item.path)) {
      delete sceneManifest[id];
    }
  }
  const count = includeFactorySceneAssets(sceneManifest);
  normalizeManifest(sceneManifest);
  writeManifest(sceneManifest);
  return { factorySceneImages: count, destination: game };
}
const catalog = readRig(path.join(root, 'assets/catalog.js'), 'assetCatalog');
const assetPath = relative => path.join(root, 'assets', relative);
const boardFile = assetPath(catalog.catalogs.board);
const boardRoot = path.dirname(boardFile);
const board = JSON.parse(fs.readFileSync(boardFile, 'utf8'));
const entryFile = assetPath(catalog.catalogs.entry);
const entryRoot = path.dirname(entryFile);
const entry = JSON.parse(fs.readFileSync(entryFile, 'utf8'));
const factoryUpgradeFile = assetPath(catalog.catalogs.factoryUpgrade);
const factoryUpgradeRoot = path.dirname(factoryUpgradeFile);
const factoryUpgrade = JSON.parse(fs.readFileSync(factoryUpgradeFile, 'utf8'));
const customerPageFile = assetPath(catalog.catalogs.customerPage);
const customerPageRoot = path.dirname(customerPageFile);
const customerPage = JSON.parse(fs.readFileSync(customerPageFile, 'utf8'));
const customerStatusFile = assetPath(catalog.catalogs.customerStatus);
const customerStatusRoot = path.dirname(customerStatusFile);
const customerStatus = JSON.parse(fs.readFileSync(customerStatusFile, 'utf8'));
const releaseProducts = new Map(catalog.release.products.map(product => [product.id, product]));
const manifest = {};
const idPattern = new RegExp(catalog.naming.idPattern);
const filePattern = new RegExp(catalog.naming.filePattern);
const versionPattern = new RegExp(catalog.naming.versionPattern);
const levelPattern = new RegExp(catalog.naming.levelPattern);

function validateAssetDirectory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!idPattern.test(entry.name) || /^v\d+$/.test(entry.name) && !versionPattern.test(entry.name)) throw new Error('Invalid asset directory: ' + file);
      validateAssetDirectory(file);
    } else if (!filePattern.test(entry.name) || entry.name.startsWith('lv-') && !levelPattern.test(entry.name)) {
      throw new Error('Invalid asset filename: ' + file);
    }
  }
}
for (const key of ['source', 'runtime', 'reference']) validateAssetDirectory(assetPath(catalog.roots[key]));
const productIds = new Set();
for (const product of catalog.products) {
  if (!idPattern.test(product.id) || !idPattern.test(product.machine) || productIds.has(product.id)) throw new Error('Invalid or duplicate product: ' + product.id);
  productIds.add(product.id);
}
for (const product of catalog.release.products) {
  if (!productIds.has(product.id)) throw new Error('Unknown release product: ' + product.id);
}
const customerIds = new Set();
for (const customer of catalog.customers) {
  if (!idPattern.test(customer.id) || customerIds.has(customer.id)) throw new Error('Invalid or duplicate customer: ' + customer.id);
  customerIds.add(customer.id);
}
const releaseCustomers = new Set();
for (const id of catalog.release.customers) {
  if (!customerIds.has(id) || releaseCustomers.has(id)) throw new Error('Invalid or duplicate release customer: ' + id);
  releaseCustomers.add(id);
}

function assetFile(base, relative, allowedRoot, label) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error('Invalid asset path: ' + label);
  const file = path.resolve(base, relative), within = path.relative(allowedRoot, file);
  if (!within || within === '..' || within.startsWith('..' + path.sep) || path.isAbsolute(within)) throw new Error('Asset path outside its catalog: ' + label);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('Missing asset file: ' + file);
  return file;
}
function positiveSize(size, label) {
  if (!Array.isArray(size) || size.length !== 2 || !size.every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid asset size: ' + label);
  return size;
}
function pngSize(file, label) {
  const bytes = fs.readFileSync(file);
  if (!file.endsWith('.png') || bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Resource must be PNG: ' + label);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}
function validateCustomerUi(catalogue, directory, label) {
  if (catalogue.schemaVersion !== 1 || !Number.isFinite(catalogue.runtimePixelRatio) || catalogue.runtimePixelRatio <= 0
    || !catalogue.ui || typeof catalogue.ui !== 'object') throw new Error('Invalid customer UI manifest: ' + label);
  for (const [id, item] of Object.entries(catalogue.ui)) {
    if (!idPattern.test(id) || !item || typeof item !== 'object') throw new Error('Invalid customer UI asset: ' + id);
    const file = assetFile(directory, item.runtime, directory, label + '/' + id);
    assetFile(root, item.source, assetPath(catalog.roots.source), label + '/' + id + ' source');
    const size = positiveSize(item.size, label + '/' + id), actual = pngSize(file, label + '/' + id);
    if (size.some((value, index) => value !== actual[index])) throw new Error('Customer UI PNG size mismatch: ' + id);
    if (item.scaleMode === 'nine-slice' && !item.nineSlice) throw new Error('Missing customer UI nine-slice: ' + id);
    for (const [key, reference] of [['nineSlice', item.nineSliceSize || size], ['contentInsets', size]]) {
      if (!item[key]) continue;
      positiveSize(reference, label + '/' + id + ' ' + key);
      const insets = item[key];
      if (!['left', 'top', 'right', 'bottom'].every(side => Number.isFinite(insets[side]) && insets[side] >= 0)
        || insets.left + insets.right >= reference[0] || insets.top + insets.bottom >= reference[1]) {
        throw new Error('Invalid customer UI ' + key + ': ' + id);
      }
    }
    if (item.bounds) {
      const bounds = item.bounds;
      if (!['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key]) && bounds[key] >= 0)
        || bounds.x + bounds.width > size[0] || bounds.y + bounds.height > size[1]) throw new Error('Invalid customer UI bounds: ' + id);
    }
  }
}
validateCustomerUi(customerPage, customerPageRoot, 'customer-page');
validateCustomerUi(customerStatus, customerStatusRoot, 'customer-status');
function validateEntryAsset(id, item) {
  if (!/^(scene|ui|icons)\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id) || !item || typeof item !== 'object') throw new Error('Invalid entry resource: ' + id);
  if (typeof item.runtime !== 'string' || !/^(scene|ui|icons)\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.png$/.test(item.runtime)) throw new Error('Invalid entry runtime path: ' + id);
  const file = assetFile(entryRoot, item.runtime, entryRoot, id);
  assetFile(root, item.source, assetPath(catalog.roots.source), id + ' source');
  const bytes = fs.readFileSync(file);
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Entry runtime must be PNG: ' + id);
  const size = positiveSize(item.size, id);
  positiveSize(item.sourceSize, id + ' source');
  if (size[0] !== bytes.readUInt32BE(16) || size[1] !== bytes.readUInt32BE(20)) throw new Error('Entry PNG size mismatch: ' + id);
}
if (entry.schemaVersion !== 1 || entry.basePath !== 'assets/runtime/entry/v1/'
  || !Number.isFinite(entry.runtimePixelRatio) || entry.runtimePixelRatio <= 0
  || !entry.assets || typeof entry.assets !== 'object' || Array.isArray(entry.assets)) throw new Error('Invalid entry manifest');
positiveSize(entry.designSize, 'entry design');
const entryOutputs = new Set();
for (const [id, item] of Object.entries(entry.assets)) {
  validateEntryAsset(id, item);
  if (entryOutputs.has(item.runtime)) throw new Error('Duplicate entry runtime path: ' + item.runtime);
  entryOutputs.add(item.runtime);
}
function validateUpgradeAsset(id, item) {
  if (!idPattern.test(id) || !item || typeof item !== 'object') throw new Error('Invalid factory upgrade entry: ' + id);
  const file = assetFile(factoryUpgradeRoot, item.runtime, factoryUpgradeRoot, id);
  assetFile(root, item.source, assetPath(catalog.roots.source), id + ' source');
  const bytes = fs.readFileSync(file);
  if (!file.endsWith('.png') || bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Factory upgrade runtime must be PNG: ' + id);
  const size = positiveSize(item.size, id);
  if (size[0] !== bytes.readUInt32BE(16) || size[1] !== bytes.readUInt32BE(20)) throw new Error('Factory upgrade PNG size mismatch: ' + id);
  const checkInsets = (insets, reference, kind) => {
    if (!['left', 'top', 'right', 'bottom'].every(side => Number.isFinite(insets[side]) && insets[side] >= 0)
      || insets.left + insets.right >= reference[0] || insets.top + insets.bottom >= reference[1]) throw new Error('Invalid factory upgrade ' + kind + ': ' + id);
  };
  if (item.scaleMode === 'nine-slice' && !item.nineSlice) throw new Error('Missing factory upgrade nine-slice: ' + id);
  if (item.nineSlice) checkInsets(item.nineSlice, positiveSize(item.nineSliceSize || size, id + ' nine-slice'), 'nine-slice');
  if (item.contentInsets) checkInsets(item.contentInsets, size, 'content insets');
  if (item.bounds) {
    const b = item.bounds;
    if (!['x', 'y', 'width', 'height'].every(key => Number.isFinite(b[key]) && b[key] >= 0)
      || b.x + b.width > size[0] || b.y + b.height > size[1]) throw new Error('Invalid factory upgrade bounds: ' + id);
  }
}
if (factoryUpgrade.schemaVersion !== 1 || !Number.isFinite(factoryUpgrade.runtimePixelRatio) || factoryUpgrade.runtimePixelRatio <= 0
  || !factoryUpgrade.ui || !factoryUpgrade.icons) throw new Error('Invalid factory upgrade manifest');
for (const entries of [factoryUpgrade.ui, factoryUpgrade.icons]) {
  for (const [id, item] of Object.entries(entries)) validateUpgradeAsset(id, item);
}

function include(id, source, output, metadata = {}) {
  if (manifest[id]) throw new Error('Duplicate asset ID: ' + id);
  if (!id.split('/').every(segment => idPattern.test(segment) || /^[1-9][0-9]*$/.test(segment))) throw new Error('Invalid asset ID: ' + id);
  if (!output.split('/').every(segment => /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+)?$/.test(segment))) throw new Error('Invalid output path: ' + output);
  const destination = path.join(game, 'assets', output);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  const { source: unusedSource, runtime: unusedRuntime, output: unusedOutput, ...meta } = metadata;
  manifest[id] = { ...meta, path: 'assets/' + output.replace(/\\/g, '/') };
}
for (const [id, item] of Object.entries(board.ui)) include('ui/' + id, path.join(boardRoot, item.runtime), 'ui/' + path.basename(item.runtime), { ...item, runtimePixelRatio: board.runtimePixelRatio });
for (const [id, item] of Object.entries(board.icons)) include('icon/' + id, path.join(boardRoot, item.runtime), 'icons/' + path.basename(item.runtime), item);
for (const [id, item] of Object.entries(entry.assets)) include('entry/' + id, path.join(entryRoot, item.runtime), 'entry/' + item.runtime, { ...item, runtimePixelRatio: entry.runtimePixelRatio });
for (const [id, item] of Object.entries(factoryUpgrade.ui)) include('ui/upgrade-' + id, path.join(factoryUpgradeRoot, item.runtime), 'factory-upgrade/' + item.runtime, { ...item, runtimePixelRatio: factoryUpgrade.runtimePixelRatio });
for (const [id, item] of Object.entries(factoryUpgrade.icons)) include('icon/upgrade-' + id, path.join(factoryUpgradeRoot, item.runtime), 'factory-upgrade/' + item.runtime, item);
for (const [id, item] of Object.entries(customerPage.ui)) include('customer-ui/' + id, path.join(customerPageRoot, item.runtime), 'customer-ui/' + id + '.png', { ...item, runtimePixelRatio: customerPage.runtimePixelRatio });
for (const [id, item] of Object.entries(customerStatus.ui)) include('customer-selection/' + id, path.join(customerStatusRoot, item.runtime), 'customer-selection/' + id + '.png', { ...item, runtimePixelRatio: customerStatus.runtimePixelRatio });
for (const item of board.reusedAssets) {
  let id;
  const product = releaseProducts.get(item.productId);
  if (item.type === 'product' && product && item.level <= product.maxProductLevel) id = 'product/' + item.productId + '/' + item.level;
  if (item.type === 'launcher' && product && item.level <= product.maxLauncherLevel) id = 'launcher/' + item.productId + '/' + item.level;
  if (item.type === 'customer-status' && item.subtype === 'badge') id = 'customer-badge/' + item.statusId;
  if (item.type === 'board-state') id = 'board-state/' + item.stateId;
  if (item.type === 'effect') id = 'effect/' + item.stateId;
  if (id) include(id, path.join(boardRoot, item.output), item.output, item);
}
// Keep the approved preview's complete transparent canvas while reducing its
// high-resolution artwork to display-sized game resources. Original PNGs stay intact.
const customerJobs = [];
for (const customer of catalog.customers.filter(customer => releaseCustomers.has(customer.id))) {
  for (const kind of [
    { id: 'customer', source: 'source/characters/customers/v2', output: 'customers', size: [256, 256] },
    { id: 'customer-detail', source: 'source/characters/customer-details/v1', output: 'customer-details', size: [400, 500] },
    { id: 'customer-silhouette', source: 'source/ui/customer-status/v1/silhouettes', output: 'customer-silhouettes', size: [256, 256] },
  ]) {
    const id = kind.id + '/' + customer.id;
    const source = assetFile(assetPath(kind.source), customer.id + '.png', assetPath(catalog.roots.source), id);
    const sourceSize = pngSize(source, id), output = kind.output + '/' + customer.id + '.png';
    if (manifest[id]) throw new Error('Duplicate asset ID: ' + id);
    manifest[id] = { size: kind.size, sourceSize, anchor: [0.5, 0.5], scaleMode: 'contain',
      transparent: true, customerId: customer.id, customerIndex: customer.index, bytes: 0, path: 'assets/' + output };
    const destination = path.join(game, 'assets', output);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    customerJobs.push({ source, destination, size: kind.size, crop: [0, 0, ...sourceSize] });
  }
}
const factoryFile = assetPath(catalog.catalogs.factory);
const factoryRoot = path.dirname(factoryFile);
const factorySource = fs.readFileSync(factoryFile, 'utf8');
const factoryItems = JSON.parse(factorySource.match(/export const runtimeFactoryAssets = (\[[\s\S]*?\])\.map\(resolveAsset\);/)[1]);
const factoryIds = catalog.release.factoryAssets;
for (const id of factoryIds) {
  const item = factoryItems.find(item => item.id === id);
  if (!item) throw new Error('Missing factory resource: ' + id);
  include('factory/' + id, path.join(factoryRoot, item.src), 'factory/' + id + '.png', item);
}
function readRig(file, expression) {
  const source = fs.readFileSync(file, 'utf8').replace(/export const /g, 'const ')
    .replace(/import\.meta\.url/g, JSON.stringify(pathToFileURL(file).href));
  return vm.runInNewContext(source + '\n' + expression, { URL });
}
function coordinates(item) {
  const [cx, cy] = item.sourceCrop, [sx, sy] = item.scale;
  return {
    point: ([x, y]) => [(x - cx) * sx, (y - cy) * sy],
    vector: ([x, y]) => [x * sx, y * sy],
    rect: ([x, y, w, h]) => [(x - cx) * sx, (y - cy) * sy, w * sx, h * sy],
  };
}
const machineFile = assetPath(catalog.catalogs.machineRigs);
const machineRoot = path.dirname(machineFile);
const machineIds = new Set(catalog.products.filter(product => releaseProducts.has(product.id)).map(product => product.machine));
const machineRigs = readRig(machineFile, 'MACHINE_RIGS').filter(rig => machineIds.has(rig.id));
// Match the approved preview's moving-part footprint repairs before cropping.
// Coordinates remain in the authored artwork's space (equipment-preview/mechanics.js).
const ballMoldRepairs = [
  { mode: 'erase', polygon: [[612,141],[655,150],[678,165],[653,236],[686,244],[707,267],[716,329],[701,355],[644,362],[574,355],[529,338],[532,299],[540,261],[576,237],[591,239],[599,195]] },
  { mode: 'patch', polygon: [[540,177],[704,199],[704,278],[540,257]], source: [414,161,140,106], destination: [540,180,164,99] },
  { mode: 'erase', polygon: [[518,287],[588,298],[599,354],[523,349]] },
  { mode: 'erase', polygon: [[709,326],[815,338],[829,375],[715,363]] },
  { mode: 'replace', polygon: [[519,489],[546,482],[583,489],[617,508],[660,491],[693,518],[695,544],[740,549],[757,518],[793,511],[830,535],[837,563],[879,574],[888,543],[921,539],[957,560],[963,604],[946,631],[942,658],[883,658],[882,630],[818,638],[762,637],[759,610],[745,594],[689,582],[675,617],[619,616],[614,585],[578,567],[565,595],[536,596],[519,586]] },
];
const cleanJobs = machineRigs.map(rig => {
  const item = manifest['factory/' + rig.id], convert = coordinates(item);
  item.animation = {
    phases: rig.phases,
    layers: rig.layers.map(layer => ({
      ...layer, polygon: layer.polygon.map(convert.point), pivot: convert.point(layer.pivot),
      ...(layer.closedPolygon ? { closedSource: undefined, closedAsset: 'factory/' + rig.id + '-closed',
        closedPolygon: layer.closedPolygon.map(convert.point) } : {}),
      motion: {
        ...layer.motion,
        ...(layer.motion.amplitude ? { amplitude: convert.vector(layer.motion.amplitude) } : {}),
        ...(layer.motion.radius ? { radius: convert.vector(layer.motion.radius) } : {}),
        ...(layer.motion.center ? { center: convert.point(layer.motion.center) } : {}),
        ...(layer.motion.path ? { path: layer.motion.path.map(convert.point) } : {}),
        ...(layer.motion.clipPolygon ? { clipPolygon: layer.motion.clipPolygon.map(convert.point) } : {}),
      },
    })).sort((a, b) => a.order - b.order),
  };
  const output = 'factory/' + rig.id + '-body-clean.png';
  manifest['factory/' + rig.id + '-body-clean'] = { ...item, animation: undefined, path: 'assets/' + output };
  let rotary = null;
  if (rig.indexedTable) {
    const textures = [
      { suffix: 'food-top', center: [560,480], halfSize: [36.5,17.5] },
      { suffix: 'food-cap', center: [898,652], halfSize: [38.5,20.5] },
    ];
    const tips = [
      { suffix: 'nozzle-tip', polygon: [[840,438],[860,438],[861,451],[857,461],[851,465],[845,462],[840,453]] },
      { suffix: 'press-tip', polygon: [[1004,583],[1034,583],[1033,613],[1028,631],[1019,636],[1009,632],[1003,618]] },
    ];
    for (const part of [...textures, ...tips]) {
      part.asset = 'factory/' + rig.id + '-' + part.suffix;
      if (part.polygon) {
        const left = Math.floor(Math.min(...part.polygon.map(point => point[0]))),
          top = Math.floor(Math.min(...part.polygon.map(point => point[1])));
        part.rect = [left, top, Math.ceil(Math.max(...part.polygon.map(point => point[0]))) - left,
          Math.ceil(Math.max(...part.polygon.map(point => point[1]))) - top];
      }
      manifest[part.asset] = { size: part.rect ? part.rect.slice(2) : [192,192], sourceSize: [rig.width, rig.height], path: 'assets/' + part.asset + '.png' };
      part.destination = path.join(game, manifest[part.asset].path);
    }
    item.animation.indexedTable = { ...rig.indexedTable, blankSource: undefined,
      coordinateSpace: 'source', tipCoordinateSpace: 'source',
      blankAsset: 'factory/' + rig.id + '-body-clean',
      topTextureAsset: textures[0].asset, capTextureAsset: textures[1].asset,
      nozzleTipAsset: tips[0].asset, pressTipAsset: tips[1].asset,
      nozzleTipRect: tips[0].rect, pressTipRect: tips[1].rect,
      outputPath: rig.layers.find(layer => layer.id === 'product-1').motion.path };
    rotary = { blankSource: path.join(machineRoot, rig.id, 'board-blank.png'), textures, tips,
      clears: [
        { polygon: [[837,437],[864,437],[865,453],[860,466],[850,469],[839,463],[837,451]], sampleOffset: -32 },
        { polygon: [[1000,580],[1037,580],[1038,615],[1032,635],[1019,639],[1005,634],[998,620]], sampleOffset: -56 },
      ] };
  }
  let flip = null;
  if (rig.flipAssembly) {
    const assembly = rig.flipAssembly;
    const derived = suffix => {
      const id = 'factory/' + rig.id + '-' + suffix;
      manifest[id] = { ...item, animation: undefined, path: 'assets/' + id + '.png' };
      return id;
    };
    const closedAsset = derived('closed'), frameAsset = derived('frame-clean'),
      frontAsset = derived('flip-front'), rearAsset = derived('flip-rear');
    item.animation.flipAssembly = { ...assembly, source: undefined, frameSource: undefined,
      closedAsset, frameAsset, frontAsset, rearAsset,
      polygon: assembly.polygon.map(convert.point), erasePolygon: assembly.erasePolygon.map(convert.point),
      fixedCutouts: assembly.fixedCutouts.map(region => region.map(convert.point)), axis: assembly.axis.map(convert.point) };
    const left = Math.max(0, Math.floor(Math.min(...assembly.polygon.map(point => point[0]))) - 1),
      top = Math.max(0, Math.floor(Math.min(...assembly.polygon.map(point => point[1]))) - 1);
    const right = Math.min(rig.width, Math.ceil(Math.max(...assembly.polygon.map(point => point[0]))) + 1),
      bottom = Math.min(rig.height, Math.ceil(Math.max(...assembly.polygon.map(point => point[1]))) + 1);
    flip = { ...assembly, box: [left, top, right - left, bottom - top],
      closedSource: path.join(machineRoot, rig.id, 'state-closed.png'),
      frameSource: path.join(machineRoot, rig.id, 'frame-clean.png'),
      closedDestination: path.join(game, manifest[closedAsset].path), frameDestination: path.join(game, manifest[frameAsset].path),
      frontDestination: path.join(game, manifest[frontAsset].path), rearDestination: path.join(game, manifest[rearAsset].path) };
  }
  const materialProduct = {
    'ball-mold-press': { id: 'popcorn-ball', label: '未包装爆米花球' },
    'sheeting-strip-cutter': { id: 'crisp-stick', label: '未包装脆棒' },
    'flip-wafer-mold': { id: 'wafer', label: '未包装薄脆' },
    'rotary-sandwich-assembler': { id: 'sandwich-square', label: '未包装夹心脆方' },
  }[rig.id];
  let material = null;
  if (materialProduct) {
    const polygon = rig.layers.find(layer => layer.id === 'product-1').polygon;
    const padding = 2, left = Math.floor(Math.min(...polygon.map(point => point[0]))),
      top = Math.floor(Math.min(...polygon.map(point => point[1])));
    const width = Math.ceil(Math.max(...polygon.map(point => point[0]))) - left,
      height = Math.ceil(Math.max(...polygon.map(point => point[1]))) - top;
    const pathInGame = 'assets/factory/' + materialProduct.id + '.png';
    manifest['factory/' + materialProduct.id] = { ...materialProduct, group: 'materials', type: 'png',
      size: [width + padding * 2, height + padding * 2], sourceSize: [rig.width, rig.height],
      draw: { sourceRect: [padding, padding, width, height] }, path: pathInGame };
    material = { polygon, crop: [left - padding, top - padding, width + padding * 2, height + padding * 2],
      maskFood: ['sheeting-strip-cutter', 'flip-wafer-mold', 'rotary-sandwich-assembler'].includes(rig.id),
      destination: path.join(game, pathInGame) };
  }
  let repairs = rig.id === 'ball-mold-press' ? ballMoldRepairs : [];
  if (rig.id === 'sheeting-strip-cutter') {
    const polygon = rig.layers.find(layer => layer.id === 'crosscut-blade').polygon;
    repairs = [{ mode: 'erase', polygon },
      { mode: 'patch', polygon, source: [881,835,178,78], destination: [832,704,234,121] }];
  }
  return {
    source: path.resolve(factoryRoot, item.originalSource), clean: path.join(machineRoot, rig.id, 'body-clean.png'),
    destination: path.join(game, 'assets', output), crop: item.sourceCrop, size: item.size,
    patches: [...rig.eraseRegions, ...rig.layers.filter(layer => layer.cleanPatch).map(layer => layer.polygon)],
    repairs, material, flip, rotary,
  };
});
// Bake authored clean patches before cropping, so overlays share the runtime image's exact geometry.
const encodedJobs = Buffer.from(JSON.stringify(cleanJobs), 'utf8').toString('base64');
const encodedCustomerJobs = Buffer.from(JSON.stringify(customerJobs), 'utf8').toString('base64');
const drawingScript = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Drawing
$jobs = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedJobs}')) | ConvertFrom-Json
$customerJobs = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedCustomerJobs}')) | ConvertFrom-Json
function New-PolygonPath($region) {
  $shape = [Drawing.Drawing2D.GraphicsPath]::new()
  $points = [Drawing.PointF[]]@($region | ForEach-Object { [Drawing.PointF]::new([single]$_[0], [single]$_[1]) })
  $shape.AddPolygon($points)
  return ,$shape
}
function Save-RuntimeImage($source, $job, $destination) {
  $image = [Drawing.Bitmap]::new([int]$job.size[0], [int]$job.size[1], [Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [Drawing.Graphics]::FromImage($image)
  $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
  $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $destinationRect = [Drawing.Rectangle]::new(0, 0, [int]$job.size[0], [int]$job.size[1])
  $sourceRect = [Drawing.Rectangle]::new([int]$job.crop[0], [int]$job.crop[1], [int]($job.crop[2] - $job.crop[0]), [int]($job.crop[3] - $job.crop[1]))
  $graphics.DrawImage($source, $destinationRect, $sourceRect, [Drawing.GraphicsUnit]::Pixel)
  $graphics.Dispose()
  $image.Save($destination, [Drawing.Imaging.ImageFormat]::Png)
  $image.Dispose()
}
foreach ($job in $customerJobs) {
  $customerImage = [Drawing.Image]::FromFile($job.source)
  Save-RuntimeImage $customerImage $job $job.destination
  $customerImage.Dispose()
}
foreach ($job in $jobs) {
  $sourceImage = [Drawing.Image]::FromFile($job.source)
  $cleanImage = [Drawing.Image]::FromFile($job.clean)
  $baseImage = [Drawing.Bitmap]::new($sourceImage.Width, $sourceImage.Height, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [Drawing.Graphics]::FromImage($baseImage)
  $graphics.DrawImageUnscaled($sourceImage, 0, 0)
  foreach ($region in $job.patches) {
    $polygon = [Drawing.Drawing2D.GraphicsPath]::new()
    $points = [Drawing.PointF[]]@($region | ForEach-Object { [Drawing.PointF]::new([single]$_[0], [single]$_[1]) })
    $polygon.AddPolygon($points)
    $graphics.SetClip($polygon)
    $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
    $graphics.DrawImageUnscaled($cleanImage, 0, 0)
    $graphics.ResetClip()
    $polygon.Dispose()
  }
  foreach ($repair in $job.repairs) {
    $polygon = [Drawing.Drawing2D.GraphicsPath]::new()
    $points = [Drawing.PointF[]]@($repair.polygon | ForEach-Object { [Drawing.PointF]::new([single]$_[0], [single]$_[1]) })
    $polygon.AddPolygon($points)
    $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
    if ($repair.mode -eq 'erase') {
      $brush = [Drawing.SolidBrush]::new([Drawing.Color]::Transparent)
      $graphics.FillPath($brush, $polygon)
      $brush.Dispose()
    } else {
      $graphics.SetClip($polygon)
      if ($repair.mode -eq 'patch') {
        $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceOver
        $destinationRect = [Drawing.Rectangle]::new([int]$repair.destination[0], [int]$repair.destination[1], [int]$repair.destination[2], [int]$repair.destination[3])
        $sourceRect = [Drawing.Rectangle]::new([int]$repair.source[0], [int]$repair.source[1], [int]$repair.source[2], [int]$repair.source[3])
        $graphics.DrawImage($cleanImage, $destinationRect, $sourceRect, [Drawing.GraphicsUnit]::Pixel)
      } else {
        $graphics.DrawImageUnscaled($cleanImage, 0, 0)
      }
      $graphics.ResetClip()
    }
    $polygon.Dispose()
  }
  if ($null -ne $job.rotary) {
    # The approved rotary backdrop replaces the whole table; only the two silver tips are cleared.
    $blank = [Drawing.Image]::FromFile($job.rotary.blankSource)
    $graphics.ResetClip()
    $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
    $graphics.DrawImageUnscaled($blank, 0, 0)
    $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceOver
    foreach ($clear in $job.rotary.clears) {
      $clearPath = New-PolygonPath $clear.polygon
      $graphics.SetClip($clearPath, [Drawing.Drawing2D.CombineMode]::Replace)
      $graphics.DrawImageUnscaled($blank, -[int]$clear.sampleOffset, 0)
      $clearPath.Dispose()
    }
    $graphics.ResetClip()
    $blank.Dispose()
  }
  $graphics.Dispose()
  $outputImage = [Drawing.Bitmap]::new([int]$job.size[0], [int]$job.size[1], [Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $outputGraphics = [Drawing.Graphics]::FromImage($outputImage)
  $outputGraphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
  $outputGraphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $outputGraphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $destinationRect = [Drawing.Rectangle]::new(0, 0, [int]$job.size[0], [int]$job.size[1])
  $sourceRect = [Drawing.Rectangle]::new([int]$job.crop[0], [int]$job.crop[1], [int]($job.crop[2] - $job.crop[0]), [int]($job.crop[3] - $job.crop[1]))
  $outputGraphics.DrawImage($baseImage, $destinationRect, $sourceRect, [Drawing.GraphicsUnit]::Pixel)
  $outputGraphics.Dispose()
  $outputImage.Save($job.destination, [Drawing.Imaging.ImageFormat]::Png)
  $outputImage.Dispose()
  if ($null -ne $job.rotary) {
    foreach ($texture in $job.rotary.textures) {
      # Inverse projection of the authored horizontal face, matching textureFromTop at 192 pixels.
      $textureImage = [Drawing.Bitmap]::new(192, 192, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
      $textureGraphics = [Drawing.Graphics]::FromImage($textureImage)
      $a = 48 / $texture.halfSize[0]; $b = -48 / $texture.halfSize[0]
      $c = 48 / $texture.halfSize[1]; $d = 48 / $texture.halfSize[1]
      $x = 96 - 48 * ($texture.center[0] / $texture.halfSize[0] + $texture.center[1] / $texture.halfSize[1])
      $y = 96 + 48 * ($texture.center[0] / $texture.halfSize[0] - $texture.center[1] / $texture.halfSize[1])
      $matrix = [Drawing.Drawing2D.Matrix]::new([single]$a,[single]$b,[single]$c,[single]$d,[single]$x,[single]$y)
      $textureGraphics.Transform = $matrix
      $textureGraphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::Bilinear
      $textureGraphics.DrawImage($sourceImage, 0, 0, $sourceImage.Width, $sourceImage.Height)
      $textureGraphics.Dispose(); $matrix.Dispose()
      $textureImage.Save($texture.destination, [Drawing.Imaging.ImageFormat]::Png)
      $textureImage.Dispose()
    }
    foreach ($tip in $job.rotary.tips) {
      $tipImage = [Drawing.Bitmap]::new([int]$tip.rect[2], [int]$tip.rect[3], [Drawing.Imaging.PixelFormat]::Format32bppArgb)
      $tipGraphics = [Drawing.Graphics]::FromImage($tipImage)
      $tipGraphics.TranslateTransform(-[single]$tip.rect[0], -[single]$tip.rect[1])
      $tipPath = New-PolygonPath $tip.polygon
      $tipGraphics.SetClip($tipPath)
      $tipGraphics.DrawImageUnscaled($sourceImage, 0, 0)
      $tipGraphics.Dispose(); $tipPath.Dispose()
      $tipImage.Save($tip.destination, [Drawing.Imaging.ImageFormat]::Png)
      $tipImage.Dispose()
    }
  }
  if ($null -ne $job.flip) {
    $flip = $job.flip
    $closed = [Drawing.Image]::FromFile($flip.closedSource)
    $frame = [Drawing.Image]::FromFile($flip.frameSource)
    Save-RuntimeImage $closed $job $flip.closedDestination

    # Match the preview frameBase: replace the turning assembly while preserving the fixed chute.
    $frameBase = $baseImage.Clone()
    $frameGraphics = [Drawing.Graphics]::FromImage($frameBase)
    $erasePath = New-PolygonPath $flip.erasePolygon
    $frameRegion = [Drawing.Region]::new($erasePath)
    foreach ($cutout in $flip.fixedCutouts) {
      $cutoutPath = New-PolygonPath $cutout
      $frameRegion.Exclude($cutoutPath)
      $cutoutPath.Dispose()
    }
    $frameGraphics.SetClip($frameRegion, [Drawing.Drawing2D.CombineMode]::Replace)
    $frameGraphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
    $frameGraphics.DrawImageUnscaled($frame, 0, 0)
    $frameGraphics.Dispose(); $frameRegion.Dispose(); $erasePath.Dispose()
    Save-RuntimeImage $frameBase $job $flip.frameDestination
    $frameBase.Dispose(); $frame.Dispose()

    # Bake prepareFlip's opaque front/rear shells, so the game needs no offscreen canvas.
    $front = [Drawing.Bitmap]::new($sourceImage.Width, $sourceImage.Height, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $frontGraphics = [Drawing.Graphics]::FromImage($front)
    $assemblyPath = New-PolygonPath $flip.polygon
    $frontRegion = [Drawing.Region]::new($assemblyPath)
    foreach ($cutout in $flip.fixedCutouts) {
      $cutoutPath = New-PolygonPath $cutout
      $frontRegion.Exclude($cutoutPath)
      $cutoutPath.Dispose()
    }
    $frontGraphics.SetClip($frontRegion, [Drawing.Drawing2D.CombineMode]::Replace)
    $frontGraphics.DrawImageUnscaled($closed, 0, 0)
    $frontGraphics.Dispose(); $frontRegion.Dispose()
    $rawFront = $front.Clone()
    $frontGraphics = [Drawing.Graphics]::FromImage($front)
    foreach ($cutout in $flip.fixedCutouts) {
      $cutoutPath = New-PolygonPath $cutout
      $patchRegion = [Drawing.Region]::new($assemblyPath)
      $patchRegion.Intersect($cutoutPath)
      $frontGraphics.SetClip($patchRegion, [Drawing.Drawing2D.CombineMode]::Replace)
      $frontGraphics.DrawImage($rawFront, [Drawing.Rectangle]::new(515,581,295,235), [Drawing.Rectangle]::new(750,716,102,28), [Drawing.GraphicsUnit]::Pixel)
      $patchRegion.Dispose(); $cutoutPath.Dispose()
    }
    $frontGraphics.Dispose(); $assemblyPath.Dispose()
    Save-RuntimeImage $front $job $flip.frontDestination

    $rear = [Drawing.Bitmap]::new($sourceImage.Width, $sourceImage.Height, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $rearGraphics = [Drawing.Graphics]::FromImage($rear)
    $rearGraphics.DrawImage($rawFront, [Drawing.Rectangle]::new([int]$flip.box[0],[int]$flip.box[1],[int]$flip.box[2],[int]$flip.box[3]), [Drawing.Rectangle]::new(656,457,242,79), [Drawing.GraphicsUnit]::Pixel)
    $rearGraphics.Dispose()
    for ($y = [int]$flip.box[1]; $y -lt $flip.box[1] + $flip.box[3]; $y++) {
      $progress = ($y - $flip.box[1] + 0.5) / $flip.box[3]
      $shade = if ($progress -lt 0.5) { (1 - $progress * 2) * 22 / 255 } else { ($progress * 2 - 1) * 69 / 255 }
      $shadeColor = if ($progress -lt 0.5) { @(255,255,255) } else { @(0,21,57) }
      for ($x = [int]$flip.box[0]; $x -lt $flip.box[0] + $flip.box[2]; $x++) {
        $alpha = $front.GetPixel($x,$y).A
        if ($alpha -eq 0) { $rear.SetPixel($x,$y,[Drawing.Color]::Transparent); continue }
        $pixel = $rear.GetPixel($x,$y)
        $r = [int][Math]::Round($pixel.R * (1 - $shade) + $shadeColor[0] * $shade)
        $g = [int][Math]::Round($pixel.G * (1 - $shade) + $shadeColor[1] * $shade)
        $b = [int][Math]::Round($pixel.B * (1 - $shade) + $shadeColor[2] * $shade)
        if ($alpha -gt 20) {
          if ($alpha -ge 128) { $alpha = 255 }
          $outer = $front.GetPixel($x - 6,$y).A -lt 20 -or $front.GetPixel($x + 6,$y).A -lt 20 -or $front.GetPixel($x,$y - 6).A -lt 20 -or $front.GetPixel($x,$y + 6).A -lt 20
          $rim = $front.GetPixel($x - 13,$y).A -lt 20 -or $front.GetPixel($x,$y - 13).A -lt 20
          if ($outer) { $r = 14; $g = 35; $b = 53 }
          elseif ($rim) {
            $r = [int][Math]::Round($r * 0.55 + 68 * 0.45)
            $g = [int][Math]::Round($g * 0.55 + 203 * 0.45)
            $b = [int][Math]::Round($b * 0.55 + 251 * 0.45)
          }
        }
        $rear.SetPixel($x,$y,[Drawing.Color]::FromArgb($alpha,$r,$g,$b))
      }
    }
    Save-RuntimeImage $rear $job $flip.rearDestination
    $rear.Dispose(); $front.Dispose(); $rawFront.Dispose(); $closed.Dispose()
  }
  if ($null -ne $job.material) {
    $material = $job.material
    $materialImage = [Drawing.Bitmap]::new([int]$material.crop[2], [int]$material.crop[3], [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $materialGraphics = [Drawing.Graphics]::FromImage($materialImage)
    $polygon = [Drawing.Drawing2D.GraphicsPath]::new()
    $points = [Drawing.PointF[]]@($material.polygon | ForEach-Object { [Drawing.PointF]::new([single]($_[0] - $material.crop[0]), [single]($_[1] - $material.crop[1])) })
    $polygon.AddPolygon($points)
    $materialGraphics.SetClip($polygon)
    $materialGraphics.DrawImageUnscaled($sourceImage, -[int]$material.crop[0], -[int]$material.crop[1])
    $polygon.Dispose()
    $materialGraphics.Dispose()
    if ($material.maskFood) {
      # Reuse the preview's food mask so neutral steel/tray pixels do not travel with the product.
      for ($y = 0; $y -lt $materialImage.Height; $y++) {
        for ($x = 0; $x -lt $materialImage.Width; $x++) {
          $pixel = $materialImage.GetPixel($x, $y)
          $warmHighlight = $pixel.G -ge 225 -and $pixel.R -ge $pixel.B
          if (-not $warmHighlight -and $pixel.B -gt $pixel.G * 0.94 -and $pixel.R -lt $pixel.G * 1.13) {
            $materialImage.SetPixel($x, $y, [Drawing.Color]::FromArgb(0, $pixel.R, $pixel.G, $pixel.B))
          }
        }
      }
    }
    $materialImage.Save($material.destination, [Drawing.Imaging.ImageFormat]::Png)
    $materialImage.Dispose()
  }
  $baseImage.Dispose()
  $sourceImage.Dispose()
  $cleanImage.Dispose()
}
`;
// Rig polygons can exceed Windows' command-line limit. Stream the same script
// through stdin instead of embedding its artwork data in the process arguments.
const drawingLoader = '& ([scriptblock]::Create([Console]::In.ReadToEnd()))';
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand',
  Buffer.from(drawingLoader, 'utf16le').toString('base64')], { input: drawingScript, stdio: ['pipe', 'inherit', 'inherit'] });

const factoryRigs = readRig(assetPath(catalog.catalogs.factoryRigs), 'factoryAnimationRigs');
const supply = manifest['factory/supply-body-clean'], supplyConvert = coordinates(supply);
supply.animation = {
  glass: factoryRigs.supply.glass.map(supplyConvert.point),
  motor: { rect: supplyConvert.rect(factoryRigs.supply.motor.rect), pivot: supplyConvert.point(factoryRigs.supply.motor.pivot) },
};
const packer = manifest['factory/packer-body-clean'], packerConvert = coordinates(packer);
const p = factoryRigs.packer.piston;
packer.animation = {
  opening: factoryRigs.packer.opening.map(packerConvert.point),
  foreground: factoryRigs.packer.foreground.map(region => region.map(packerConvert.point)),
  head: { rect: packerConvert.rect(factoryRigs.packer.head.rect), travel: factoryRigs.packer.head.travel * packer.scale[1] },
  piston: { centerX: packerConvert.point([p.centerX, 0])[0], rodWidth: p.rodWidth * packer.scale[0],
    guide: packerConvert.rect(p.guide), attachmentY: packerConvert.point([0, p.attachmentY])[1],
    topOccluder: p.topOccluder.map(packerConvert.point) },
};
fs.mkdirSync(path.dirname(gameManifestFile), { recursive: true });
for (const item of factoryUpgrade.reusedAssets || []) {
  if (item.type !== 'existing' || !manifest[item.id]) throw new Error('Unknown reused factory upgrade asset: ' + item.id);
}
optimizeReleasePngs(game, manifest);
includeFactorySceneAssets(manifest);
normalizeManifest(manifest);
writeManifest(manifest);
const bytes = Object.values(manifest).reduce((sum, item) => sum + item.bytes, 0);
return { images: Object.keys(manifest).length, imageBytes: bytes, destination: game };

function normalizeManifest(entries) {
  for (const [id, item] of Object.entries(entries)) {
    const file = path.join(game, item.path);
    const pixelSize = pngSize(file, id);
    const anchorSpace = item.originalSize ? 'pixels' : 'normalized';
    entries[id] = normalizeAssetMetadata(item, { label: id, pixelSize,
      sourceSize: item.sourceSize || item.originalSize, anchorSpace,
      logicalSize: item.logicalSize || pixelSize.map(value => value / (item.runtimePixelRatio || 1)) });
    entries[id].bytes = fs.statSync(file).size;
  }
}
function writeManifest(entries) {
  fs.mkdirSync(path.dirname(gameManifestFile), { recursive: true });
  fs.writeFileSync(gameManifestFile, "'use strict';\n// Generated from the resource catalogs.\nmodule.exports = " + JSON.stringify(entries, null, 2) + ';\n');
}
}

module.exports = { buildReleaseAssets, optimizeReleasePngs };
