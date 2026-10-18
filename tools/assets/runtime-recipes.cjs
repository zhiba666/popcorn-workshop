'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { loadRuntimeCatalogs } = require('./runtime-catalogs.cjs');
const { resizeRgbaLanczos } = require('./raster-resize.cjs');

// The catalogs contain the authored crop and canvas decisions. Keep those
// decisions here separate from the release packager: every input is source art,
// and every output is a PNG below assets/runtime in the supplied staging root.
function within(base, relative, label) {
  const absolute = path.resolve(base, relative);
  const remainder = path.relative(base, absolute);
  if (!remainder || remainder === '..' || remainder.startsWith('..' + path.sep) || path.isAbsolute(remainder)) {
    throw new Error('Path outside ' + label + ': ' + relative);
  }
  return absolute;
}

function validSize(size, label) {
  if (!Array.isArray(size) || size.length !== 2 || !size.every(value => Number.isInteger(value) && value > 0)) {
    throw new Error('Invalid pixel size: ' + label);
  }
  return [...size];
}

function getRuntimeRecipes({ root = path.resolve(__dirname, '../..') } = {}) {
  root = path.resolve(root);
  const recipes = [];
  const outputs = new Set();
  const sourceRoot = path.join(root, 'assets/source');
  const catalogs = loadRuntimeCatalogs({ root });
  const add = (source, output, pixelSize, extra = {}) => {
    source = path.resolve(root, source);
    within(sourceRoot, path.relative(sourceRoot, source), 'source artwork');
    const outputPath = output.replace(/\\/g, '/');
    within(path.join(root, 'assets/runtime'), path.relative(path.join(root, 'assets/runtime'), path.resolve(root, outputPath)), 'runtime output');
    if (!outputPath.endsWith('.png') || outputs.has(outputPath)) throw new Error('Invalid or duplicate runtime output: ' + outputPath);
    if (!fs.statSync(source).isFile()) throw new Error('Missing source artwork: ' + source);
    outputs.add(outputPath);
    recipes.push({ source: path.relative(root, source).replace(/\\/g, '/'), output: outputPath,
      pixelSize: validSize(pixelSize, outputPath), ...extra });
  };

  for (const [name, key] of [['board', 'board'], ['entry', 'entry'], ['factory-upgrade', 'factoryUpgrade'],
    ['customer-page', 'customerPage'], ['customer-status', 'customerStatus']]) {
    const relativeRoot = 'assets/runtime/' + name + '/v1';
    const catalog = catalogs.catalogs[key];
    for (const group of ['ui', 'icons', 'assets']) {
      for (const item of Object.values(catalog[group] || {})) {
        add(item.source, relativeRoot + '/' + item.runtime, item.pixelSize || item.size, {
          mode: item.scaleMode === 'cover' ? 'cover' : item.source.endsWith('.svg') ? 'contain' : 'width',
          ...(item.cropBounds ? { crop: item.cropBounds } : {}),
          ...(item.color ? { color: item.color } : {}),
          ...(item.sourceSize ? { sourceSize: item.sourceSize } : {}),
          // Rasterize vectors at their final resolution instead of enlarging a
          // small initial bitmap. This keeps thin strokes and rounded UI clear.
          ...(item.source.endsWith('.svg') ? { vector: true } : {}),
          ...(name === 'entry' ? { palette: true } : {}),
        });
      }
    }
    if (name === 'board') {
      for (const item of catalog.reusedAssets) {
        add(item.source, relativeRoot + '/' + item.output, item.pixelSize || item.size, {
          mode: 'contain', padding: item.padding || 0, crop: item.cropBounds,
          sourceSize: item.sourceSize, ...(item.source.endsWith('.svg') ? { vector: true } : {}),
        });
      }
    }
  }

  const factoryRoot = path.join(root, 'assets/runtime/factory/v1');
  for (const item of catalogs.factory) {
    const [left, top, right, bottom] = item.sourceCrop;
    add(path.resolve(factoryRoot, item.originalSource), 'assets/runtime/factory/v1/' + path.basename(item.src), item.pixelSize || item.size, {
      mode: 'stretch', resampler: 'integer-lanczos3', pngAdaptiveFiltering: true,
      crop: { x: left, y: top, width: right - left, height: bottom - top }, sourceSize: item.originalSize,
    });
  }
  add(catalogs.floor.source, 'assets/runtime/factory/v1/' + path.basename(catalogs.floor.src), catalogs.floor.pixelSize, {
    mode: 'stretch', resampler: 'integer-lanczos3', pngAdaptiveFiltering: true, sourceSize: catalogs.floor.sourceSize,
  });

  const decorationRoot = path.join(root, 'assets/runtime/decoration/v1');
  for (const item of catalogs.decoration) {
    const [left, top, right, bottom] = item.sourceCrop;
    add(path.resolve(decorationRoot, item.sourceSrc), 'assets/runtime/decoration/v1/' + path.basename(item.src), item.pixelSize || item.size, {
      mode: 'stretch', resampler: 'integer-lanczos3', pngAdaptiveFiltering: true, crop: { x: left, y: top, width: right - left, height: bottom - top },
      sourceSize: item.sourceSize,
    });
  }
  return recipes;
}

async function renderRecipe(sharp, root, recipe) {
  const source = within(path.join(root, 'assets/source'), path.relative(path.join(root, 'assets/source'), path.join(root, recipe.source)), 'source artwork');
  const pixelSize = validSize(recipe.pixelSize, recipe.output);
  const metadata = await sharp(source).metadata();
  if (recipe.sourceSize && recipe.sourceSize.some((value, index) => value !== [metadata.width, metadata.height][index])) {
    throw new Error('Source artwork dimensions changed without updating its recipe: ' + recipe.source);
  }
  const crop = recipe.crop || { x: 0, y: 0, width: metadata.width, height: metadata.height };
  if (!['x', 'y', 'width', 'height'].every(key => Number.isInteger(crop[key])) || crop.x < 0 || crop.y < 0
    || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > metadata.width || crop.y + crop.height > metadata.height) {
    throw new Error('Invalid source crop: ' + recipe.output);
  }
  let input = source;
  if (recipe.color) input = Buffer.from(fs.readFileSync(source, 'utf8').replace(/currentColor/g, recipe.color));
  const padding = recipe.padding || 0;
  const width = pixelSize[0] - padding * 2, height = pixelSize[1] - padding * 2;
  if (width <= 0 || height <= 0) throw new Error('Padding exceeds output canvas: ' + recipe.output);
  // A vector crop is measured in SVG units, so scale it with the raster density.
  const vectorScale = recipe.vector ? Math.max(width / crop.width, height / crop.height, 1) : 1;
  const density = 72 * vectorScale;
  let pipeline = sharp(input, { density });
  if (crop.x || crop.y || crop.width !== metadata.width || crop.height !== metadata.height) {
    pipeline = pipeline.extract({ left: Math.round(crop.x * vectorScale), top: Math.round(crop.y * vectorScale),
      width: Math.round(crop.width * vectorScale), height: Math.round(crop.height * vectorScale) });
  }
  if (recipe.resampler === 'integer-lanczos3') {
    const decoded = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixels = resizeRgbaLanczos(decoded.data, decoded.info.width, decoded.info.height, width, height);
    pipeline = sharp(pixels, { raw: { width, height, channels: 4 } });
  } else {
    pipeline = recipe.mode === 'width' ? pipeline.resize({ width, kernel: 'lanczos3' })
      : pipeline.resize(width, height, { fit: recipe.mode === 'stretch' ? 'fill' : recipe.mode,
        kernel: 'lanczos3', background: { r: 0, g: 0, b: 0, alpha: 0 } });
  }
  if (padding) pipeline = pipeline.extend({ top: padding, bottom: padding, left: padding, right: padding,
    background: { r: 0, g: 0, b: 0, alpha: 0 } });
  const rendered = await pipeline.png({ compressionLevel: 9, adaptiveFiltering: Boolean(recipe.pngAdaptiveFiltering), palette: Boolean(recipe.palette),
    ...(recipe.palette ? { colours: 256, quality: 100, effort: 10, dither: 1 } : {}) }).toBuffer({ resolveWithObject: true });
  if (rendered.info.width !== pixelSize[0] || rendered.info.height !== pixelSize[1]) {
    throw new Error('Recipe output dimensions differ from its catalog: ' + recipe.output);
  }
  return rendered.data;
}

async function buildRuntimeAssets({ root = path.resolve(__dirname, '../..'), outputRoot } = {}) {
  if (!outputRoot) throw new Error('Runtime assets require an explicit staging outputRoot');
  root = path.resolve(root);
  outputRoot = path.resolve(outputRoot);
  const sharp = require('sharp');
  const recipes = getRuntimeRecipes({ root });
  const files = [];
  const inputs = {};
  for (const recipe of recipes) {
    if (!inputs[recipe.source]) inputs[recipe.source] = createHash('sha256').update(fs.readFileSync(path.join(root, recipe.source))).digest('hex');
    const destination = within(outputRoot, recipe.output, 'staging output');
    const bytes = await renderRecipe(sharp, root, recipe);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes);
    files.push(recipe.output);
  }
  return { count: files.length, files, recipes, sourceHashes: inputs,
    recipeHash: createHash('sha256').update(JSON.stringify(recipes)).digest('hex') };
}

module.exports = { getRuntimeRecipes, buildRuntimeAssets };
