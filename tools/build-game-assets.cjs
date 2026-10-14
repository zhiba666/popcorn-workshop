'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const game = path.join(root, 'douyin-game');
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
for (const item of board.reusedAssets) {
  let id;
  const product = releaseProducts.get(item.productId);
  if (item.type === 'product' && product && item.level <= product.maxProductLevel) id = 'product/' + item.productId + '/' + item.level;
  if (item.type === 'launcher' && product && item.level <= product.maxLauncherLevel) id = 'launcher/' + item.productId + '/' + item.level;
  if (item.type === 'customer' && catalog.release.customers.includes(item.customerId)) id = 'customer/' + item.customerId;
  if (item.type === 'board-state') id = 'board-state/' + item.stateId;
  if (item.type === 'effect') id = 'effect/' + item.stateId;
  if (id) include(id, path.join(boardRoot, item.output), item.output, item);
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
include('factory/floor', path.join(factoryRoot, 'floor.png'), 'factory/floor.png', { size: [768,512] });

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
const cleanJobs = machineRigs.map(rig => {
  const item = manifest['factory/' + rig.id], convert = coordinates(item);
  item.animation = {
    phases: rig.phases,
    layers: rig.layers.map(layer => ({
      ...layer, polygon: layer.polygon.map(convert.point), pivot: convert.point(layer.pivot),
      motion: {
        ...layer.motion,
        ...(layer.motion.amplitude ? { amplitude: convert.vector(layer.motion.amplitude) } : {}),
        ...(layer.motion.path ? { path: layer.motion.path.map(convert.point) } : {}),
        ...(layer.motion.clipPolygon ? { clipPolygon: layer.motion.clipPolygon.map(convert.point) } : {}),
      },
    })).sort((a, b) => a.order - b.order),
  };
  const output = 'factory/' + rig.id + '-body-clean.png';
  manifest['factory/' + rig.id + '-body-clean'] = { ...item, animation: undefined, path: 'assets/' + output };
  return {
    source: path.resolve(factoryRoot, item.originalSource), clean: path.join(machineRoot, rig.id, 'body-clean.png'),
    destination: path.join(game, 'assets', output), crop: item.sourceCrop, size: item.size,
    patches: [...rig.eraseRegions, ...rig.layers.filter(layer => layer.cleanPatch).map(layer => layer.polygon)],
  };
});
// Bake authored clean patches before cropping, so overlays share the runtime image's exact geometry.
const encodedJobs = Buffer.from(JSON.stringify(cleanJobs), 'utf8').toString('base64');
const drawingScript = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Drawing
$jobs = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedJobs}')) | ConvertFrom-Json
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
  $baseImage.Dispose()
  $sourceImage.Dispose()
  $cleanImage.Dispose()
}
`;
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(drawingScript, 'utf16le').toString('base64')], { stdio: 'inherit' });

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
fs.mkdirSync(path.join(game, 'src'), { recursive: true });
for (const item of factoryUpgrade.reusedAssets || []) {
  if (item.type !== 'existing' || !manifest[item.id]) throw new Error('Unknown reused factory upgrade asset: ' + item.id);
}
for (const item of Object.values(manifest)) {
  if ('bytes' in item) item.bytes = fs.statSync(path.join(game, item.path)).size;
}
fs.writeFileSync(path.join(game, 'src/assets-manifest.js'), "'use strict';\n// Generated from the resource catalogs.\nmodule.exports = " + JSON.stringify(manifest, null, 2) + ';\n');
const bytes = Object.values(manifest).reduce((sum, item) => sum + fs.statSync(path.join(game, item.path)).size, 0);
console.log(JSON.stringify({ images: Object.keys(manifest).length, imageBytes: bytes, destination: game }));
