import { assetCatalog } from '../../assets/catalog.js';

const manifestUrl = new URL('../../assets/' + assetCatalog.catalogs.board, import.meta.url);
let catalogPromise;

function requiredEntry(map, key, kind) {
  const entry = map.get(key);
  if (!entry) throw new Error(`棋盘资源缺失：${kind} ${key}`);
  return entry;
}

function runtimeEntry(metadata, label, pixelRatio = 1) {
  const path = metadata?.runtime ?? metadata?.output;
  if (!path) throw new Error(`棋盘资源缺少运行文件：${label}`);
  const url = new URL(path, manifestUrl);
  if (!/\.png$/i.test(url.pathname)) {
    throw new Error(`棋盘运行资源必须使用 PNG：${label}`);
  }
  return { ...metadata, runtimePixelRatio: pixelRatio, url: url.href };
}

function drawNineSlice(context, image, entry, width, height) {
  const imageWidth = image.naturalWidth;
  const imageHeight = image.naturalHeight;
  const referenceSize = entry.nineSliceSize ?? entry.size ?? [imageWidth, imageHeight];
  if (!(referenceSize[0] > 0 && referenceSize[1] > 0) || !entry.nineSlice) {
    throw new Error(`棋盘资源缺少九宫格参数：${entry.url}`);
  }
  const slice = entry.nineSlice;
  let left = Math.max(0, Number(slice.left) || 0) * imageWidth / referenceSize[0];
  let right = Math.max(0, Number(slice.right) || 0) * imageWidth / referenceSize[0];
  let top = Math.max(0, Number(slice.top) || 0) * imageHeight / referenceSize[1];
  let bottom = Math.max(0, Number(slice.bottom) || 0) * imageHeight / referenceSize[1];
  if (left + right > imageWidth) {
    const factor = imageWidth / (left + right);
    left *= factor;
    right *= factor;
  }
  if (top + bottom > imageHeight) {
    const factor = imageHeight / (top + bottom);
    top *= factor;
    bottom *= factor;
  }
  const pixelRatio = Math.max(1, Number(entry.runtimePixelRatio) || 1);
  const borderScale = Math.max(0, Math.min(
    Number(slice.maxBorderScale ?? 1) / pixelRatio,
    width / imageWidth,
    height / imageHeight,
    left + right ? width / (left + right) : Infinity,
    top + bottom ? height / (top + bottom) : Infinity,
  ));
  const sourceX = [0, left, imageWidth - right, imageWidth];
  const sourceY = [0, top, imageHeight - bottom, imageHeight];
  const targetX = [0, left * borderScale, width - right * borderScale, width];
  const targetY = [0, top * borderScale, height - bottom * borderScale, height];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const sourceWidth = sourceX[column + 1] - sourceX[column];
      const sourceHeight = sourceY[row + 1] - sourceY[row];
      const targetWidth = targetX[column + 1] - targetX[column];
      const targetHeight = targetY[row + 1] - targetY[row];
      if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) continue;
      context.drawImage(image,
        sourceX[column], sourceY[row], sourceWidth, sourceHeight,
        targetX[column], targetY[row], targetWidth, targetHeight);
    }
  }
}

function drawSkin(context, image, entry, width, height) {
  if (entry.scaleMode === 'nine-slice') {
    drawNineSlice(context, image, entry, width, height);
    return;
  }
  const mode = entry.scaleMode ?? 'contain';
  if (mode !== 'cover' && mode !== 'contain') {
    throw new Error(`不支持的棋盘资源缩放方式：${mode}`);
  }
  const scale = (mode === 'cover' ? Math.max : Math.min)(
    width / image.naturalWidth, height / image.naturalHeight,
  );
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const [anchorX, anchorY] = entry.anchor ?? [0.5, 0.5];
  context.drawImage(image,
    (width - drawWidth) * anchorX, (height - drawHeight) * anchorY, drawWidth, drawHeight);
}

function createCatalog(manifest) {
  const uiEntries = new Map(Object.entries(manifest.ui ?? {})
    .map(([key, metadata]) => [key, runtimeEntry(metadata, `ui ${key}`, manifest.runtimePixelRatio)]));
  const iconEntries = new Map(Object.entries(manifest.icons ?? {})
    .map(([key, metadata]) => [key, runtimeEntry(metadata, `icon ${key}`)]));
  const products = new Map();
  const launchers = new Map();
  const customers = new Map();
  const states = new Map();
  const effects = new Map();
  for (const metadata of manifest.reusedAssets ?? []) {
    const entry = runtimeEntry(metadata, metadata.source ?? metadata.type);
    switch (entry.type) {
      case 'product': products.set(`${entry.productIndex - 1}:${entry.level}`, entry); break;
      case 'launcher': launchers.set(`${entry.productIndex - 1}:${entry.level}`, entry); break;
      case 'customer': customers.set(entry.customerId, entry); break;
      case 'board-state': states.set(entry.stateId, entry); break;
      case 'effect': effects.set(entry.stateId, entry); break;
      default: break;
    }
  }
  const imageCache = new Map();
  const skinControllers = new WeakMap();
  const liveSkins = new Set();

  function getImage(entry) {
    if (!entry?.url) return Promise.reject(new Error('棋盘资源缺少 URL'));
    if (imageCache.has(entry.url)) return imageCache.get(entry.url);
    const promise = new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        image.onload = null;
        image.onerror = null;
        if (!image.naturalWidth || !image.naturalHeight) {
          reject(new Error(`棋盘资源尺寸无效：${entry.url}`));
          return;
        }
        resolve(image);
      };
      image.onerror = () => {
        image.onload = null;
        image.onerror = null;
        reject(new Error(`无法加载棋盘资源：${entry.url}`));
      };
      image.src = entry.url;
    });
    imageCache.set(entry.url, promise);
    promise.catch(() => {
      if (imageCache.get(entry.url) === promise) imageCache.delete(entry.url);
    });
    return promise;
  }

  function applySkin(container, entry) {
    if (!container?.ownerDocument || typeof container.prepend !== 'function') {
      throw new Error('棋盘皮肤需要一个 DOM 容器');
    }
    const existing = skinControllers.get(container);
    if (existing) {
      existing.update(entry);
      return existing;
    }
    const document = container.ownerDocument;
    const view = document.defaultView;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器不支持棋盘皮肤 Canvas');
    canvas.className = 'skin-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, {
      position: 'absolute', inset: '0', width: '100%', height: '100%',
      display: 'block', pointerEvents: 'none', zIndex: '-1',
    });
    const previousPosition = container.style.position;
    const previousIsolation = container.style.isolation;
    const setPosition = view.getComputedStyle(container).position === 'static';
    if (setPosition) container.style.position = 'relative';
    container.style.isolation = 'isolate';
    container.prepend(canvas);
    let image = null;
    let currentEntry = entry;
    let generation = 0;
    let disposed = false;

    function render() {
      if (disposed || !image) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!width || !height) return;
      const pixelRatio = Math.min(2, Math.max(1, view.devicePixelRatio || 1));
      const pixelWidth = Math.max(1, Math.round(width * pixelRatio));
      const pixelHeight = Math.max(1, Math.round(height * pixelRatio));
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);
      drawSkin(context, image, currentEntry, width, height);
    }

    function update(nextEntry) {
      if (disposed) throw new Error('棋盘皮肤已释放');
      const requestGeneration = ++generation;
      currentEntry = nextEntry;
      image = null;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      controller.ready = getImage(nextEntry).then(loadedImage => {
        if (!disposed && generation === requestGeneration) {
          image = loadedImage;
          render();
        }
        return controller;
      });
      return controller.ready;
    }

    const observer = view.ResizeObserver ? new view.ResizeObserver(render) : null;
    if (observer) observer.observe(container);
    view.addEventListener('resize', render);

    function dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      observer?.disconnect();
      view.removeEventListener('resize', render);
      canvas.remove();
      if (setPosition && container.style.position === 'relative') container.style.position = previousPosition;
      if (container.style.isolation === 'isolate') container.style.isolation = previousIsolation;
      skinControllers.delete(container);
      liveSkins.delete(controller);
    }

    const controller = { canvas, ready: null, render, update, dispose, destroy: dispose };
    skinControllers.set(container, controller);
    liveSkins.add(controller);
    update(entry);
    return controller;
  }

  function dispose() {
    for (const controller of liveSkins) controller.dispose();
    imageCache.clear();
  }

  return {
    manifest,
    ui: key => requiredEntry(uiEntries, key, 'ui'),
    icon: key => requiredEntry(iconEntries, key, 'icon'),
    product: (type, level) => requiredEntry(products, `${type}:${level}`, 'product'),
    launcher: (type, level) => requiredEntry(launchers, `${type}:${level}`, 'launcher'),
    customer: (id = 'rabbit-courier') => requiredEntry(customers, id, 'customer'),
    state: id => requiredEntry(states, id, 'state'),
    effect: id => requiredEntry(effects, id, 'effect'),
    getImage,
    preload: async entries => { await Promise.all(Array.from(entries, getImage)); },
    applySkin,
    dispose,
    destroy: dispose,
  };
}

export async function loadBoardResources() {
  if (!catalogPromise) {
    catalogPromise = (async () => {
      const response = await fetch(manifestUrl);
      if (!response.ok) throw new Error(`无法加载棋盘资源清单：HTTP ${response.status}`);
      const manifest = await response.json();
      if (manifest.schemaVersion !== 1) throw new Error(`不支持的棋盘资源清单版本：${manifest.schemaVersion}`);
      return createCatalog(manifest);
    })().catch(error => {
      catalogPromise = undefined;
      throw error;
    });
  }
  return catalogPromise;
}
