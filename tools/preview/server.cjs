'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildCustomerContent } = require('../content/build-customer-content.cjs');
const root = path.resolve(__dirname, '../..');
const game = path.join(root, 'douyin-game');
const previews = path.join(root, 'preview');
const gameAssets = path.join(game, 'assets');
const projectAssets = path.join(root, 'assets');
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function resolveFile(base, relative) {
  const file = path.resolve(base, relative);
  if (file !== base && !file.startsWith(base + path.sep)) {
    const error = new Error('Forbidden');
    error.statusCode = 403;
    throw error;
  }
  return file;
}

function browserBundle() {
  buildCustomerContent();
  const modules = new Map();
  const visit = relative => {
    if (modules.has(relative)) return;
    const source = fs.readFileSync(resolveFile(game, relative), 'utf8');
    const dependencies = {};
    modules.set(relative, { source, dependencies });
    for (const match of source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1])) + (path.extname(match[1]) ? '' : '.js');
      dependencies[match[1]] = resolved;
      visit(resolved);
    }
  };
  visit('game.js');
  const definitions = Array.from(modules, ([id, value]) => JSON.stringify(id) + ':[function(require,module,exports){\n' + value.source + '\n},' + JSON.stringify(value.dependencies) + ']').join(',\n');
  return '(function(modules){const cache={};function load(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;const [fn,deps]=modules[id];fn(name=>load(deps[name]),module,module.exports);return module.exports;}load("game.js");})({' + definitions + '});';
}

function assetFile(relative) {
  const firstPart = relative.split('/')[0];
  if (['source', 'runtime', 'reference', 'catalog.js'].includes(firstPart)) {
    return resolveFile(projectAssets, relative);
  }
  const published = resolveFile(gameAssets, relative);
  return fs.existsSync(published) ? published : resolveFile(projectAssets, relative);
}

function createPreviewHandler(defaultPage) {
  buildCustomerContent();
  return (request, response) => {
    let pathname;
    const queryStart = request.url.indexOf('?');
    const query = queryStart < 0 ? '' : request.url.slice(queryStart);
    try {
      pathname = decodeURIComponent(request.url.split('?')[0]);
    } catch {
      response.writeHead(400).end('Bad request');
      return;
    }
    if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').includes('..')) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const redirect = target => {
      const location = target.split('/').map(encodeURIComponent).join('/') + query;
      response.writeHead(307, { Location: location, 'Cache-Control': 'no-store' }).end();
    };
    const shortDirectory = pathname.split('/')[1];
    if (['game-preview', 'factory-preview', 'equipment-preview', 'customer-preview', 'merge-preview',
      'play', 'board', 'machines', 'customers', 'merge', 'factory'].includes(shortDirectory)) {
      // Resolve relative imports from their canonical URL, including the shared
      // animation and generated content modules introduced by the directory move.
      redirect('/preview' + pathname);
      return;
    }
    try {
      if (pathname === '/preview/_generated/customer-content.js') buildCustomerContent();
      if (['/bundle.js', '/preview/game-preview/bundle.js', '/preview/play/bundle.js'].includes(pathname)) {
        const bundle = browserBundle();
        response.writeHead(200, { 'Content-Type': contentTypes['.js'], 'Cache-Control': 'no-store' });
        response.end(bundle);
        return;
      }
      // Keep the actively edited factory workbench in place. A base URL lets
      // canonical entry URLs serve its current HTML without rewriting its files.
      const factoryEntry = pathname.match(/^\/preview\/factory\/(production|expansion)(?:\/(?:index\.html)?)?$/);
      if (factoryEntry) {
        const source = resolveFile(previews, 'factory-preview/' + (factoryEntry[1] === 'production' ? 'index.html' : 'expansion.html'));
        let html = fs.readFileSync(source, 'utf8');
        if (!/<base\b/i.test(html)) html = html.replace(/<head\b[^>]*>/i, '$&\n  <base href="/preview/factory-preview/">');
        response.writeHead(200, { 'Content-Type': contentTypes['.html'], 'Cache-Control': 'no-store' });
        response.end(html);
        return;
      }
      let file;
      const gameAssetPrefix = ['/preview/game-preview/assets', '/preview/play/assets']
        .find(prefix => pathname === prefix || pathname.startsWith(prefix + '/'));
      if (pathname === '/') {
        file = resolveFile(root, defaultPage);
      } else if (gameAssetPrefix) {
        file = resolveFile(gameAssets, pathname.slice(gameAssetPrefix.length).replace(/^\/+/, ''));
      } else if (pathname === '/assets' || pathname.startsWith('/assets/')) {
        file = assetFile(pathname.slice('/assets'.length).replace(/^\/+/, ''));
      } else {
        file = resolveFile(root, pathname.replace(/^\/+/, ''));
      }
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
        if (!pathname.endsWith('/')) {
          redirect(pathname + '/');
          return;
        }
        file = path.join(file, 'index.html');
      }
      fs.readFile(file, (error, data) => {
        if (error) {
          response.writeHead(404).end('Not found');
          return;
        }
        response.writeHead(200, { 'Content-Type': contentTypes[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        response.end(data);
      });
    } catch (error) {
      response.writeHead(error.statusCode || 500).end(error.message);
    }
  };
}

module.exports = { createPreviewHandler };
