'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const samePath = (left, right) => process.platform === 'win32'
  ? left.toLowerCase() === right.toLowerCase() : left === right;

function relativePath(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || /[:\0]/.test(value)) {
    throw new Error('Invalid build output path: ' + value);
  }
  const normalized = value.replace(/\\/g, '/');
  if (normalized.split('/').some(part => !part || part === '.' || part === '..'
    || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error('Unsafe build output path: ' + value);
  }
  return normalized;
}

function within(base, file) {
  const relative = path.relative(base, file);
  return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function statIfPresent(file) {
  try { return fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function checkedPath(base, relative) {
  const baseStat = statIfPresent(base);
  if (!baseStat || !baseStat.isDirectory() || baseStat.isSymbolicLink()
    || !samePath(fs.realpathSync.native(base), base)) throw new Error('Unsafe build directory: ' + base);
  const file = path.resolve(base, relativePath(relative));
  if (!within(base, file)) throw new Error('Build output escapes root: ' + relative);
  let current = base;
  for (const segment of path.relative(base, file).split(path.sep)) {
    current = path.join(current, segment);
    const stat = statIfPresent(current);
    if (!stat) continue;
    if (stat.isSymbolicLink()) throw new Error('Build output uses a symbolic link: ' + current);
    if (!samePath(fs.realpathSync.native(current), current)) throw new Error('Build output is redirected: ' + current);
  }
  return file;
}

function fileState(file) {
  const stat = statIfPresent(file);
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Build output must be a regular file: ' + file);
  return { sha256: digest(fs.readFileSync(file)), mode: stat.mode, atimeMs: stat.atimeMs, mtimeMs: stat.mtimeMs };
}

function sameState(left, right) {
  return left === null || right === null ? left === right : left.sha256 === right.sha256;
}

/**
 * Stage a resource build without changing the last complete output package.
 *
 * Only explicitly registered files can be published. The ownership manifest is
 * machine-maintained build state, not a source catalog. Existing outputs may be
 * adopted on the first build only through adoptPaths; subsequent builds reject
 * edits to managed files. Use prune:false for an incremental/scene-only build,
 * or prune:true with replaceScopes:['factory-scene'] to retire only scene
 * outputs. Use replaceScopes:['*'] for a complete package replacement.
 * commit({check:true}) performs the same checks and returns planned counts,
 * without publishing outputs or changing the ownership manifest.
 */
function createBuildOutput(options) {
  if (!options || !options.root) throw new Error('Build output requires a workspace root');
  const requestedRoot = path.resolve(options.root);
  if (!fs.statSync(requestedRoot).isDirectory() || fs.lstatSync(requestedRoot).isSymbolicLink()) {
    throw new Error('Build root must be a real directory: ' + requestedRoot);
  }
  // Canonicalize Windows short-name aliases once; all later checks still reject
  // redirected or symbolic-link descendants of this explicit workspace root.
  const root = fs.realpathSync.native(requestedRoot);
  const roots = (options.allowedRoots || []).map(relativePath);
  const files = new Set((options.allowedFiles || []).map(relativePath));
  if (!roots.length && !files.size) throw new Error('Build output requires explicit allowed paths');
  const manifestRelative = relativePath(options.manifestPath || '.cache/assets-build-outputs.json');
  const manifestFile = checkedPath(root, manifestRelative);
  const scope = options.scope || 'full';
  const validScope = value => typeof value === 'string' && /^[a-z][a-z0-9-]*$/.test(value);
  if (!validScope(scope)) throw new Error('Invalid build output scope: ' + scope);
  const replacedScopes = new Set(options.replaceScopes || [scope]);
  if ([...replacedScopes].some(value => value !== '*' && !validScope(value))) throw new Error('Invalid replaced build scope');
  const allowed = relative => files.has(relative) || roots.some(directory => relative.startsWith(directory + '/'));
  const outputPath = relative => {
    relative = relativePath(relative);
    if (!allowed(relative) || relative === manifestRelative || relative === manifestRelative + '.lock') {
      throw new Error('Build output is not allowed: ' + relative);
    }
    return checkedPath(root, relative);
  };
  const adopted = new Set((options.adoptPaths || []).map(relative => {
    relative = relativePath(relative);
    outputPath(relative);
    return relative;
  }));
  const lockRelative = manifestRelative + '.lock';
  const lockFile = checkedPath(root, lockRelative);
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  const token = crypto.randomBytes(16).toString('hex');
  const lock = JSON.stringify({ version: 1, pid: process.pid, token });
  let lockHeld = false;
  let temporaryRoot;
  let closed = false;
  const cleanup = () => {
    if (temporaryRoot && fs.existsSync(temporaryRoot)) {
      const cache = checkedPath(root, '.cache');
      if (!within(cache, temporaryRoot) || !path.basename(temporaryRoot).startsWith('asset-build-')) {
        throw new Error('Refusing to remove an unsafe build temporary directory');
      }
      checkedPath(root, path.relative(root, temporaryRoot));
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
    if (lockHeld && fs.existsSync(lockFile)) {
      checkedPath(root, lockRelative);
      if (fs.readFileSync(lockFile, 'utf8') !== lock) throw new Error('Build lock changed while building');
      fs.unlinkSync(lockFile);
      lockHeld = false;
    }
  };
  try {
    try {
      const descriptor = fs.openSync(lockFile, 'wx');
      try { fs.writeFileSync(descriptor, lock); } finally { fs.closeSync(descriptor); }
      lockHeld = true;
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error('Another asset build owns the output lock: ' + lockFile);
      throw error;
    }
    const baseline = new Map();
    const capture = relative => {
      const file = checkedPath(root, relative);
      if (!fs.existsSync(file)) return;
      const stat = fs.lstatSync(file);
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(file)) capture(relative + '/' + entry);
      } else baseline.set(relative, fileState(file));
    };
    for (const directory of roots) capture(directory);
    for (const file of files) capture(file);
    const manifestBaseline = fileState(manifestFile);
    let previous = { schemaVersion: 1, outputs: {} };
    if (manifestBaseline) previous = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    if (previous.schemaVersion !== 1 || !previous.outputs || Array.isArray(previous.outputs)
      || typeof previous.outputs !== 'object') throw new Error('Invalid build ownership manifest: ' + manifestFile);
    const pathKeys = new Map();
    for (const [relative, entry] of Object.entries(previous.outputs)) {
      outputPath(relative);
      const key = process.platform === 'win32' ? relative.toLowerCase() : relative;
      if (pathKeys.has(key) || !entry || !/^[a-f0-9]{64}$/.test(entry.sha256) || !validScope(entry.scope)) {
        throw new Error('Invalid build ownership entry: ' + relative);
      }
      pathKeys.set(key, relative);
    }
    const cache = checkedPath(root, '.cache');
    fs.mkdirSync(cache, { recursive: true });
    temporaryRoot = fs.mkdtempSync(path.join(cache, 'asset-build-'));
    const stageRoot = path.join(temporaryRoot, 'stage');
    const backupRoot = path.join(temporaryRoot, 'backup');
    fs.mkdirSync(stageRoot);
    fs.mkdirSync(backupRoot);
    const registered = new Map();
    const registeredKeys = new Map();
    const ensureOpen = () => { if (closed) throw new Error('Build output transaction is closed'); };
    const register = (relative, settings = {}) => {
      ensureOpen();
      relative = relativePath(relative);
      outputPath(relative);
      const key = process.platform === 'win32' ? relative.toLowerCase() : relative;
      if (pathKeys.has(key) && pathKeys.get(key) !== relative) throw new Error('Owned output path has different casing: ' + relative);
      if (registeredKeys.has(key) && registeredKeys.get(key) !== relative) throw new Error('Duplicate output path with different casing: ' + relative);
      const outputScope = settings.scope || scope;
      if (!validScope(outputScope)) throw new Error('Invalid output scope: ' + outputScope);
      if (registered.has(relative) && registered.get(relative) !== outputScope) throw new Error('Conflicting output scope: ' + relative);
      registeredKeys.set(key, relative);
      registered.set(relative, outputScope);
      return checkedPath(stageRoot, relative);
    };
    const stagePath = (relative, settings) => {
      const file = register(relative, settings);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      return file;
    };
    const abort = () => { if (!closed) { closed = true; cleanup(); } };
    const commit = (settings = {}) => {
      ensureOpen();
      const applied = [];
      const createdDirectories = [];
      let published = false;
      try {
        if (settings.validate) {
          const result = settings.validate({ stageRoot, outputs: [...registered.keys()] });
          if (result && typeof result.then === 'function') throw new Error('Build output validation must finish synchronously before commit');
        }
        const staged = new Map();
        for (const [relative, outputScope] of registered) {
          const file = checkedPath(stageRoot, relative);
          const state = fileState(file);
          if (!state) throw new Error('Registered build output is missing: ' + relative);
          staged.set(relative, { sha256: state.sha256, scope: outputScope });
        }
        const next = { ...previous.outputs };
        const removed = [];
        if (options.prune !== false) {
          for (const [relative, entry] of Object.entries(previous.outputs)) {
            if (!staged.has(relative) && (replacedScopes.has('*') || replacedScopes.has(entry.scope))) {
              delete next[relative];
              removed.push(relative);
            }
          }
        }
        for (const [relative, entry] of staged) next[relative] = entry;
        const operations = [];
        let unchanged = 0;
        for (const relative of [...registered.keys(), ...removed]) {
          const destination = outputPath(relative);
          const initial = baseline.get(relative) || null;
          const current = fileState(destination);
          if (!sameState(initial, current)) throw new Error('Build output changed while building: ' + relative);
          const owned = previous.outputs[relative];
          const generated = staged.get(relative);
          // A second deterministic generator (for example the preview server's
          // content refresh) may already have produced exactly these bytes.
          // Adopt that result without rewriting it; differing edits still fail.
          if (generated && current && generated.sha256 === current.sha256) { unchanged++; continue; }
          if (owned && current && owned.sha256 !== current.sha256) throw new Error('Refusing to overwrite an edited generated output: ' + relative);
          if (generated && current && !owned && !adopted.has(relative)) throw new Error('Refusing to overwrite an unmanaged file: ' + relative);
          if (!generated && !current) continue;
          operations.push({ relative, destination, initial, generated: generated || null,
            source: generated ? checkedPath(stageRoot, relative) : null });
        }
        if (!sameState(manifestBaseline, fileState(checkedPath(root, manifestRelative)))) {
          throw new Error('Build ownership manifest changed while building');
        }
        const ownership = { schemaVersion: 1, outputs: Object.fromEntries(Object.entries(next).sort(([left], [right]) => left.localeCompare(right, 'en'))) };
        const ownershipBytes = Buffer.from(JSON.stringify(ownership, null, 2) + '\n');
        const manifestChanged = !manifestBaseline || digest(ownershipBytes) !== manifestBaseline.sha256;
        if (manifestChanged) {
          const stagedManifest = path.join(temporaryRoot, 'ownership.json');
          fs.writeFileSync(stagedManifest, ownershipBytes);
          operations.push({ relative: manifestRelative, destination: manifestFile, initial: manifestBaseline,
            generated: { sha256: digest(ownershipBytes) }, source: stagedManifest });
        }
        if (settings.check) {
          closed = true;
          cleanup();
          return { checked: true,
            written: operations.filter(operation => operation.source && operation.relative !== manifestRelative).length,
            removed: operations.filter(operation => !operation.source).length, unchanged, manifestChanged,
            changes: operations.filter(operation => operation.relative !== manifestRelative).map(operation => operation.relative),
            outputs: registered.size, ownedOutputs: Object.keys(next).length };
        }
        // Back up every destination before publishing anything. Replacement uses
        // rename on the same volume; rollback restores bytes and original mtimes.
        operations.forEach((operation, index) => {
          if (operation.initial) {
            operation.backup = path.join(backupRoot, String(index));
            fs.copyFileSync(operation.destination, operation.backup);
          }
        });
        for (const operation of operations) {
          checkedPath(root, operation.relative);
          if (!sameState(operation.initial, fileState(operation.destination))) throw new Error('Build output changed before publication: ' + operation.relative);
          const missing = [];
          for (let directory = path.dirname(operation.destination); !fs.existsSync(directory); directory = path.dirname(directory)) missing.push(directory);
          for (const directory of missing.reverse()) { fs.mkdirSync(directory); createdDirectories.push(directory); }
          if (operation.source) fs.renameSync(operation.source, operation.destination);
          else fs.unlinkSync(operation.destination);
          applied.push(operation);
        }
        published = true;
        closed = true;
        cleanup();
        return { written: operations.filter(operation => operation.source && operation.relative !== manifestRelative).length,
          removed: operations.filter(operation => !operation.source).length, unchanged, manifestChanged,
          outputs: registered.size, ownedOutputs: Object.keys(next).length };
      } catch (error) {
        if (published) {
          error.message = 'Build outputs were committed, but temporary cleanup failed: ' + error.message;
          throw error;
        }
        const failures = [];
        for (const operation of applied.reverse()) {
          try {
            checkedPath(root, operation.relative);
            if (!sameState(operation.generated, fileState(operation.destination))) {
              throw new Error('Published output changed before rollback: ' + operation.relative);
            }
            if (operation.backup) {
              fs.renameSync(operation.backup, operation.destination);
              fs.chmodSync(operation.destination, operation.initial.mode);
              fs.utimesSync(operation.destination, operation.initial.atimeMs / 1000, operation.initial.mtimeMs / 1000);
            } else if (fs.existsSync(operation.destination)) fs.unlinkSync(operation.destination);
          } catch (rollbackError) { failures.push(rollbackError.message); }
        }
        for (const directory of createdDirectories.reverse()) {
          try { if (fs.existsSync(directory) && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory); }
          catch (rollbackError) { failures.push(rollbackError.message); }
        }
        closed = true;
        if (failures.length) {
          // Preserve backups when the filesystem prevented rollback; never erase
          // the only recoverable copy of a previous complete output package.
          error.message += '\nBuild rollback requires recovery from ' + temporaryRoot + ': ' + failures.join('; ');
          temporaryRoot = undefined;
        }
        try { cleanup(); } catch (cleanupError) { error.message += '\n' + cleanupError.message; }
        throw error;
      }
    };
    return { root, stageRoot, register, stagePath, commit, abort,
      write(relative, bytes, settings) { const file = stagePath(relative, settings); fs.writeFileSync(file, bytes); return file; },
      copy(source, relative, settings) { const file = stagePath(relative, settings); fs.copyFileSync(source, file); return file; } };
  } catch (error) {
    try { cleanup(); } catch (cleanupError) { error.message += '\n' + cleanupError.message; }
    throw error;
  }
}

module.exports = { createBuildOutput };
