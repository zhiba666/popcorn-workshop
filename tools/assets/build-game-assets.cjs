'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createBuildOutput } = require('./build-output.cjs');
const { getRuntimeRecipes, buildRuntimeAssets } = require('./runtime-recipes.cjs');
const { writeRuntimeCatalogs } = require('./runtime-catalogs.cjs');
const { buildReleaseAssets } = require('./build-release.cjs');
const { validateAssetMetadata } = require('./asset-metadata.cjs');

const root = path.resolve(__dirname, '../..');
const manifestRelative = 'douyin-game/src/generated/assets-manifest.js';
const customerOutputs = ['douyin-game/src/generated/customer-content.js', 'preview/_generated/customer-content.js'];
const ownershipRelative = 'assets/build-outputs.json';
const catalogOutputs = ['board/v1/manifest.json', 'entry/v1/manifest.json', 'factory-upgrade/v1/manifest.json',
  'customer-page/v1/manifest.json', 'customer-status/v1/manifest.json', 'factory/v1/manifest.js',
  'factory/v1/floor.js', 'decoration/v1/manifest.js'].map(relative => 'assets/runtime/' + relative);
const sceneOutput = /^douyin-game\/assets\/factory\/(logistics-|selection-ring\.png$|contact-shadow\.png$|nameplate\.png$|construction-platform\.png$|expansion-plus-sign\.png$|floor-stone-tile\.png$)/;

function files(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}

function copyInput(stageRoot, relative) {
  const source = path.join(root, relative), destination = path.join(stageRoot, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, dereference: false });
}

function readManifest(projectRoot) {
  const file = path.join(projectRoot, manifestRelative);
  delete require.cache[require.resolve(file)];
  return require(file);
}

function preflight() {
  if (process.platform !== 'win32') throw new Error('Asset baking requires Windows PowerShell and System.Drawing.');
  const expected = require('../../package.json').devDependencies.sharp;
  const actual = require('sharp').versions.sharp;
  if (actual !== expected) throw new Error('Run npm ci: sharp ' + expected + ' is required, found ' + actual);
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Drawing; if ($PSVersionTable.PSVersion.Major -lt 5) { throw 'Windows PowerShell 5 or later is required' }"], { stdio: 'pipe' });
}

function validateRelease(stageRoot, manifest) {
  const paths = new Set();
  for (const [id, item] of Object.entries(manifest)) {
    if (!/^assets\/[a-z0-9/-]+\.png$/.test(item.path) || paths.has(item.path)) throw new Error('Invalid or duplicate published path: ' + id);
    paths.add(item.path);
    const bytes = fs.readFileSync(path.join(stageRoot, 'douyin-game', item.path));
    if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Published image is not PNG: ' + id);
    validateAssetMetadata(item, { label: id, pixelSize: [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] });
    if (item.bytes !== bytes.length) throw new Error('Published image byte count mismatch: ' + id);
  }
}

async function buildAssets({ sceneOnly = false, check = false } = {}) {
  preflight();
  const runtimeRecipes = getRuntimeRecipes({ root });
  const previous = fs.existsSync(path.join(root, manifestRelative)) ? readManifest(root) : {};
  if (sceneOnly && !Object.keys(previous).length) throw new Error('Run npm run build:assets before a scene-only build.');
  const adoptPaths = [...runtimeRecipes.map(recipe => recipe.output), ...catalogOutputs,
    ...Object.values(previous).map(item => 'douyin-game/' + item.path), manifestRelative, ...customerOutputs];
  const transaction = createBuildOutput({ root,
    allowedRoots: ['assets/runtime', 'douyin-game/assets', 'douyin-game/src/generated', 'preview/_generated'],
    manifestPath: ownershipRelative, adoptPaths, scope: sceneOnly ? 'factory-scene' : 'full',
    prune: true, replaceScopes: sceneOnly ? ['factory-scene'] : ['*'] });
  try {
    for (const input of ['assets/source', 'assets/reference', 'assets/catalog.js', 'assets/recipes', 'content']) copyInput(transaction.stageRoot, input);
    if (sceneOnly) {
      for (const input of ['douyin-game/assets', manifestRelative]) copyInput(transaction.stageRoot, input);
    } else {
      writeRuntimeCatalogs({ root: transaction.stageRoot, outputRoot: transaction.stageRoot });
      await buildRuntimeAssets({ root: transaction.stageRoot, outputRoot: transaction.stageRoot });
      writeRuntimeCatalogs({ root: transaction.stageRoot, outputRoot: transaction.stageRoot, refreshBytes: true });
    }
    const result = buildReleaseAssets({ root: transaction.stageRoot, sceneOnly });
    const manifest = readManifest(transaction.stageRoot);
    validateRelease(transaction.stageRoot, manifest);
    const relativeFiles = sceneOnly
      ? [...Object.values(manifest).map(item => 'douyin-game/' + item.path).filter(relative => sceneOutput.test(relative)), manifestRelative, ...customerOutputs]
      : [...files(path.join(transaction.stageRoot, 'assets/runtime')).map(file => path.relative(transaction.stageRoot, file).replace(/\\/g, '/')),
        ...Object.values(manifest).map(item => 'douyin-game/' + item.path), manifestRelative, ...customerOutputs];
    const registered = [...new Set(relativeFiles)];
    for (const relative of registered) transaction.register(relative, { scope: sceneOutput.test(relative) ? 'factory-scene'
      : relative.startsWith('assets/runtime/') ? 'runtime'
      : relative === manifestRelative || customerOutputs.includes(relative) ? 'shared' : 'release' });
    if (check) {
      const planned = transaction.commit({ check: true });
      if (planned.written || planned.removed || planned.manifestChanged) {
        throw new Error('Generated assets are out of date: ' + [...planned.changes,
          ...(planned.manifestChanged ? [ownershipRelative] : [])].join(', ') + '. Run npm run build:assets.');
      }
      return { checked: registered.length, images: Object.keys(manifest).length };
    }
    const output = transaction.commit();
    return { ...result, destination: path.join(root, 'douyin-game'), ...output };
  } catch (error) { transaction.abort(); throw error; }
}

function runCli() {
  const arguments_ = process.argv.slice(2);
  if (arguments_.some(value => !['--factory-scene-only', '--check'].includes(value))) {
    console.error('Usage: node tools/assets/build-game-assets.cjs [--factory-scene-only] [--check]');
    process.exitCode = 1;
  } else {
    buildAssets({ sceneOnly: arguments_.includes('--factory-scene-only'), check: arguments_.includes('--check') })
      .then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
  }
}

module.exports = { buildAssets, runCli };
if (require.main === module) runCli();
