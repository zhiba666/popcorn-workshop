import { factoryAnimationRigs, factoryDynamicBitmapAssets } from '../../assets/source/factory/animation/v1/rigs.js';
import { factoryBitmapAssets } from '../../assets/source/factory/manifest.js';
import { MACHINE_RIGS } from '../../assets/source/gameplay/machines/animation/v1/rigs.js';

const assets = new Map([...factoryBitmapAssets, ...factoryDynamicBitmapAssets].map(asset => [asset.id, asset]));
const productMachines = { original: 'air-popper', caramel: 'caramel-drum', 'popcorn-ball': 'ball-mold-press',
  'crisp-stick': 'sheeting-strip-cutter', wafer: 'flip-wafer-mold', 'sandwich-square': 'rotary-sandwich-assembler' };
const imagePromises = new Map();
const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
const smooth = value => { const x = clamp(value); return x * x * (3 - 2 * x); };
const productId = product => typeof product === 'string' ? product : product?.id;

function loadImage(src) {
  if (!imagePromises.has(src)) imagePromises.set(src, new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { imagePromises.delete(src); reject(new Error(`动画资源未载入：${src.split('/').pop()}`)); };
    img.src = src;
  }));
  return imagePromises.get(src);
}
function polygon(ctx, points) {
  ctx.beginPath();
  points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
}
function bitmap(ctx, resource, rect) {
  if (!resource) return;
  const [x0, y0, x1, y1] = resource.bounds;
  ctx.drawImage(resource.image, x0, y0, x1 - x0, y1 - y0, ...rect);
}
function fitBitmap(ctx, resource, x, y, width, height) {
  if (!resource) return;
  const [x0, y0, x1, y1] = resource.bounds;
  const scale = Math.min(width / (x1 - x0), height / (y1 - y0));
  const w = (x1 - x0) * scale, h = (y1 - y0) * scale;
  bitmap(ctx, resource, [x + (width - w) / 2, y + (height - h) / 2, w, h]);
}
function alphaBounds(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let left = canvas.width, top = canvas.height, right = 0, bottom = 0;
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    if (pixels[(y * canvas.width + x) * 4 + 3] <= 16) continue;
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
  }
  return right > left && bottom > top ? [left, top, right, bottom] : [0, 0, image.width, image.height];
}

async function loadProduct(id) {
  const image = await loadImage(new URL(`../../assets/source/gameplay/products/v9/${id}/lv-01.png`, import.meta.url).href);
  const packaged = { image, bounds: alphaBounds(image) };
  if (id === 'original' || id === 'caramel') {
    const definition = assets.get(id === 'original' ? 'loose-popcorn' : 'caramel-popcorn');
    return { packaged, raw: { image: await loadImage(definition.src), bounds: definition.bounds } };
  }
  const rig = MACHINE_RIGS.find(item => item.id === productMachines[id]);
  const layer = rig.layers.find(item => item.id === 'product-1');
  const source = await loadImage(rig.source);
  const xs = layer.polygon.map(point => point[0]), ys = layer.polygon.map(point => point[1]);
  const left = Math.floor(Math.min(...xs)), top = Math.floor(Math.min(...ys));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(Math.max(...xs)) - left; canvas.height = Math.ceil(Math.max(...ys)) - top;
  const ctx = canvas.getContext('2d');
  ctx.translate(-left, -top); polygon(ctx, layer.polygon); ctx.clip(); ctx.drawImage(source, 0, 0);
  return { packaged, raw: { image: canvas, bounds: [0, 0, canvas.width, canvas.height] } };
}

function mountCanvas(node) {
  const sprite = node.element.querySelector('.sprite');
  const original = [...sprite.childNodes];
  const canvas = document.createElement('canvas');
  canvas.className = 'workshop-shared-motion'; canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(node.width * dpr));
  canvas.height = Math.max(1, Math.round(node.height * dpr));
  const ctx = canvas.getContext('2d');
  sprite.replaceChildren(canvas);
  return { node, canvas, original, sprite, ctx, context() {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    // The runtime PNG derives from these same native bounds. Keep its crop, base and ports fixed.
    const [x0, y0, x1, y1] = node.asset.originalBounds;
    ctx.setTransform(canvas.width / (x1 - x0), 0, 0, canvas.height / (y1 - y0),
      -x0 * canvas.width / (x1 - x0), -y0 * canvas.height / (y1 - y0));
    return ctx;
  }, destroy() { if (canvas.parentNode === sprite) sprite.replaceChildren(...original); } };
}

function drawSupply(ctx, resources, time, active) {
  const rig = factoryAnimationRigs.supply, body = resources.get(rig.body), grain = resources.get(rig.material);
  ctx.save(); polygon(ctx, rig.glass); ctx.clip();
  for (let i = 0; i < 28; i++) {
    const row = Math.floor(i / 7), col = i % 7;
    const jiggle = active ? Math.sin(time * 4.2 + i * 2.3) * 2.8 : 0;
    const x = 260 + col * 94 + (row % 2) * 28 + Math.sin(i * 4.3) * 12;
    const y = 621 - row * 55 + col * 17 + Math.cos(i * 3.7) * 11 + jiggle;
    ctx.save(); ctx.translate(x, y); ctx.rotate((i % 5 - 2) * .18); bitmap(ctx, grain, [-52, -47, 104, 95]); ctx.restore();
  }
  ctx.restore(); ctx.drawImage(body.image, 0, 0);
  const [x, y, w, h] = rig.motor.rect;
  const vibrate = active ? Math.sin(time * 22) * 1.6 : 0;
  bitmap(ctx, resources.get(rig.motor.asset), [x + vibrate, y, w, h]);
}

function drawPacker(ctx, resources, products, state) {
  const rig = factoryAnimationRigs.packer, body = resources.get(rig.body);
  const progress = clamp(state?.progress), active = state?.active !== false;
  const product = products.get(productId(state?.product)) || products.values().next().value;
  const strokeAmount = !active ? 0 : progress < .44 ? smooth((progress - .18) / .26)
    : progress < .60 ? 1 : 1 - smooth((progress - .60) / .22);
  const stroke = rig.head.travel * strokeAmount;
  ctx.drawImage(body.image, 0, 0);
  ctx.save(); polygon(ctx, rig.opening); ctx.clip();
  if (active && progress > .04 && progress < .96 && product) {
    const entering = smooth(progress / .18), leaving = smooth((progress - .82) / .14);
    const x = 785 - (1 - entering) * 140 + leaving * 130, y = 647 + leaving * 86;
    const scale = 1 - strokeAmount * .035;
    ctx.save(); ctx.translate(x + 75, y + 84); ctx.scale(scale, scale);
    fitBitmap(ctx, progress < .55 ? product.raw : product.packaged, -75, -84, 150, 168); ctx.restore();
  }
  const piston = rig.piston, [gx, gy, gw, gh] = piston.guide, rodX = piston.centerX - piston.rodWidth / 2;
  const metal = ctx.createLinearGradient(rodX, 0, rodX + piston.rodWidth, 0);
  metal.addColorStop(0, '#526b70'); metal.addColorStop(.25, '#d8e8de'); metal.addColorStop(.45, '#fafae8');
  metal.addColorStop(.7, '#89a5a3'); metal.addColorStop(1, '#52696c');
  ctx.fillStyle = metal; ctx.beginPath(); ctx.roundRect(rodX, gy + gh - 6, piston.rodWidth,
    piston.attachmentY + stroke - (gy + gh - 6), 5); ctx.fill();
  const guide = ctx.createLinearGradient(gx, 0, gx + gw, 0);
  guide.addColorStop(0, '#986621'); guide.addColorStop(.3, '#f9d374'); guide.addColorStop(.5, '#ffe6a2'); guide.addColorStop(1, '#a97026');
  ctx.fillStyle = guide; ctx.strokeStyle = '#765326'; ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.roundRect(gx, gy, gw, gh, 6); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#b47a2b'; ctx.beginPath(); ctx.ellipse(piston.centerX, gy + gh - 3, gw / 2 - 2, 3.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save(); polygon(ctx, piston.topOccluder); ctx.clip(); ctx.drawImage(body.image, 0, 0); ctx.restore();
  const [x, y, w, h] = rig.head.rect; bitmap(ctx, resources.get(rig.head.asset), [x, y + stroke, w, h]);
  ctx.restore();
  for (const region of rig.foreground) { ctx.save(); polygon(ctx, region); ctx.clip(); ctx.drawImage(body.image, 0, 0); ctx.restore(); }
}

function drawBuffer(ctx, node, resources, products, state, time) {
  const base = resources.get('buffer-bin'), rig = factoryAnimationRigs.buffer;
  const resource = products.get(productId(state?.product) || productId(node.product))?.raw;
  const amount = clamp(state?.cacheAmount), count = Math.ceil(amount * 8);
  ctx.drawImage(base.image, 0, 0);
  if (!count || !resource) return;
  ctx.save(); polygon(ctx, rig.opening); ctx.clip();
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / 3), col = i % 3;
    const receiving = ['discharge', 'discharging', 'to-cache'].includes(state?.phase);
    const bounce = receiving && i === count - 1 ? Math.sin(clamp(state.progress) * Math.PI) * 32 : 0;
    const x = 435 + col * 165 + (row % 2) * 34, y = 550 - row * 85 + col * 27 - bounce;
    ctx.save(); ctx.translate(x, y); ctx.rotate((i % 3 - 1) * .13);
    fitBitmap(ctx, resource, -94, -88, 188, 176); ctx.restore();
  }
  ctx.restore();
  for (const region of [rig.frontRim, ...rig.foreground]) {
    ctx.save(); polygon(ctx, region); ctx.clip(); ctx.drawImage(base.image, 0, 0); ctx.restore();
  }
}

function drawWarehouse(ctx, resources, products, shipment) {
  const base = resources.get('warehouse'); ctx.drawImage(base.image, 0, 0);
  if (!shipment?.active) return;
  const resource = products.get(productId(shipment.product))?.packaged;
  if (!resource) return;
  const arrival = smooth(clamp(shipment.progress)), y = 570 - Math.sin(arrival * Math.PI) * 18;
  ctx.save(); ctx.globalAlpha = Math.min(1, arrival * 5);
  fitBitmap(ctx, resource, 458, y, 150, 205); ctx.restore();
  // Reapply the front upright and shelf so an arriving package sits inside the rack.
  for (const region of [[[355, 518], [403, 521], [403, 805], [355, 795]],
    [[378, 759], [670, 813], [670, 846], [378, 800]]]) {
    ctx.save(); polygon(ctx, region); ctx.clip(); ctx.drawImage(base.image, 0, 0); ctx.restore();
  }
}

// Decorative scene playback only. It never changes preview levels, resources or production state.
// time is seconds; pack = { active, progress, product }; lineStates is a Map of owner line IDs
// to { phase, progress, cacheAmount: 0..1, product }. Optional shipment = { active, progress, product }.
export async function createSharedMotion(nodes) {
  const list = [...nodes.values()].filter(node => node.type === 'cache' || ['supply', 'packer', 'warehouse'].includes(node.id));
  const ids = ['supply-body-clean', 'packer-body-clean', 'supply-motor-cap', 'packer-head', 'loose-popcorn', 'buffer-bin', 'warehouse'];
  const resources = new Map(), products = new Map();
  const productIds = [...new Set(list.filter(node => node.type === 'cache').map(node => productId(node.product)).filter(Boolean))];
  await Promise.all([
    ...ids.map(async id => { const definition = assets.get(id); resources.set(id, { image: await loadImage(definition.src), bounds: definition.bounds }); }),
    ...productIds.map(async id => products.set(id, await loadProduct(id))),
  ]);
  const surfaces = list.map(mountCanvas);
  let destroyed = false;
  const api = {
    draw(time, state = {}, { visible = () => true } = {}) {
      if (destroyed) return;
      for (const surface of surfaces) {
        const node = surface.node;
        if (!visible(node)) continue;
        const ctx = surface.context();
        if (node.id === 'supply') drawSupply(ctx, resources, time, state.supplyActive !== false);
        else if (node.id === 'packer') drawPacker(ctx, resources, products, state.pack);
        else if (node.id === 'warehouse') drawWarehouse(ctx, resources, products, state.shipment);
        else drawBuffer(ctx, node, resources, products, state.lineStates?.get(node.lineId || node.id.replace(/-buffer$/, '')), time);
      }
    },
    destroy() { if (destroyed) return; destroyed = true; surfaces.forEach(surface => surface.destroy()); },
  };
  // A complete first frame replaces each static image before the first scheduled animation frame.
  api.draw(0, { pack: { active: false } });
  return api;
}
