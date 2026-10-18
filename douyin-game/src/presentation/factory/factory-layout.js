'use strict';

const { PRODUCTION_CONFIG: CONFIG, PRODUCT_DEFINITIONS } = require('../../domain/production/production-config');

// Sprites already contain their own perspective. Only their ground anchors and
// the transport network are projected; the image itself remains undistorted.
const GROUND_SHEAR = -2 / 15;
const GROUND_RISE = 0.138;
const ORIGIN_X = 64;

function projectFactoryPoint(u, v, z = 0) {
  return [ORIGIN_X + u + GROUND_SHEAR * v, GROUND_RISE * u + v - z];
}

function factoryCameraOffset(scroll) {
  return [GROUND_SHEAR * scroll, scroll];
}

function unprojectFactoryPoint(x, y) {
  const u = (x - ORIGIN_X - GROUND_SHEAR * y) / (1 - GROUND_SHEAR * GROUND_RISE);
  return { u, v: y - GROUND_RISE * u };
}

// Match factoryAsset/drawMachine's bottom-aligned contain operation so every
// catalog anchor, rather than the image box, rests on the shared ground plane.
function anchoredSprite(id, u, v, w, h, getMeta) {
  const foot = projectFactoryPoint(u, v);
  const meta = getMeta && getMeta(id);
  const source = meta && meta.draw && meta.draw.sourceRect;
  const anchor = meta && meta.draw && meta.draw.anchor;
  if (!source || !anchor) {
    return { x: foot[0] - w / 2, y: foot[1] - h * 0.88, w, h,
      foot, ground: { u, v }, depth: foot[1] };
  }
  const scale = Math.min(w / source[2], h / source[3]);
  return {
    x: foot[0] - (w - source[2] * scale) / 2 - (anchor[0] - source[0]) * scale,
    y: foot[1] - h + source[3] * scale - (anchor[1] - source[1]) * scale,
    w, h, foot, ground: { u, v }, depth: foot[1]
  };
}

function groundMarker(u, v, w, h) {
  const foot = projectFactoryPoint(u, v);
  return { x: foot[0] - w / 2, y: foot[1] - h, w, h,
    foot, ground: { u, v }, depth: foot[1] };
}

function buildFactoryLayout(lines, getMeta) {
  const groups = [], scenes = [], slots = [];
  // Both lines should fit in the opening view, with a floor aisle between the
  // first nameplate and the next machine instead of touching hit regions.
  const lineStep = 196;
  let index = 0;
  for (const product of CONFIG.products) {
    const productLines = lines.filter(line => line.product === product);
    if (!productLines.length) continue;
    const firstV = 195 + index * lineStep;
    const groupFoot = projectFactoryPoint(16, firstV - 76);
    groups.push({ product, x: groupFoot[0], y: groupFoot[1], count: productLines.length,
      ground: { u: 16, v: firstV - 76 }, foot: groupFoot });
    for (const line of productLines) {
      const v = 195 + index * lineStep;
      const machineId = 'factory/' + PRODUCT_DEFINITIONS[product].machineId;
      const machine = anchoredSprite(machineId, 145, v, 150, 150, getMeta);
      const cache = anchoredSprite('factory/buffer-bin', 260, v + 8, 56, 48, getMeta);
      const left = Math.min(machine.x, cache.x) - 5;
      const top = Math.min(machine.y, cache.y) - 4;
      const right = Math.max(machine.x + machine.w, cache.x + cache.w) + 5;
      const bottom = Math.max(machine.y + machine.h + 24, cache.y + cache.h, machine.foot[1] + 30);
      scenes.push({ lineId: line.id, product, machine, cache,
        ground: machine.ground, foot: machine.foot, depth: machine.depth,
        cacheGround: cache.ground, cacheFoot: cache.foot,
        hit: { x: left, y: top, w: right - left, h: bottom - top } });
      index++;
    }
    if (productLines.length < CONFIG.maxLinesPerProduct) {
      // A small build pad beside the active workshop, outside its logistics.
      const pad = groundMarker(46, firstV + 40, 50, 44);
      slots.push({ ...pad, product, number: productLines.length + 1,
        hit: { x: pad.foot[0] - 29, y: pad.foot[1] - 54, w: 58, h: 88 } });
    }
  }
  const tail = Math.max(0, index - 1) * lineStep;
  // A second workshop's nameplate extends beyond its ground anchor. Keep the
  // shared packer beyond that label while retaining the compact opening scene.
  const sharedTail = tail + (index > 1 ? 12 : 0);
  const supply = anchoredSprite('factory/supply-body-clean', 252, 65, 100, 110, getMeta);
  const packaging = anchoredSprite('factory/packer-body-clean', 280, 300 + sharedTail, 118, 88, getMeta);
  const warehouse = anchoredSprite('factory/warehouse', 145, 390 + sharedTail, 168, 86, getMeta);
  const nextProduct = CONFIG.products.find(product => !lines.some(line => line.product === product));
  // The next workshop entrance is beyond the complete production loop. It no
  // longer inserts a full-width card between processing and shared packaging.
  const construction = nextProduct ? {
    ...groundMarker(295, 465 + sharedTail, 95, 48), product: nextProduct
  } : null;
  if (construction) construction.hit = { x: construction.x - 4, y: construction.foot[1] - 78,
    w: construction.w + 8, h: 112 };
  const groundHeight = (construction ? 520 : 440) + sharedTail;
  const room = { uMin: 44, uMax: 326, vMin: 0, vMax: groundHeight };
  const bottom = Math.max(warehouse.y + warehouse.h + 38,
    construction ? construction.y + construction.h + 44 : 0);
  const extent = [supply, packaging, warehouse, ...scenes.map(scene => scene.hit),
    ...slots.map(slot => slot.hit), ...(construction ? [construction.hit] : [])];
  const corners = [projectFactoryPoint(room.uMin, room.vMin), projectFactoryPoint(room.uMax, room.vMin),
    projectFactoryPoint(room.uMin, room.vMax), projectFactoryPoint(room.uMax, room.vMax)];
  const left = Math.min(...extent.map(rect => rect.x), ...corners.map(point => point[0])) - 24;
  const right = Math.max(...extent.map(rect => rect.x + rect.w), ...corners.map(point => point[0])) + 24;
  const top = Math.min(...extent.map(rect => rect.y), ...corners.map(point => point[1])) - 32;
  const boundsBottom = Math.max(bottom, ...corners.map(point => point[1])) + 20;
  return {
    bounds: { x: left, y: top, w: right - left, h: boundsBottom - top },
    groups, scenes, slots, construction, supply, packaging, warehouse,
    height: Math.ceil(bottom), groundHeight, room,
    ground: { shear: GROUND_SHEAR, rise: GROUND_RISE, originX: ORIGIN_X,
      uMin: room.uMin, uMax: room.uMax, vMin: room.vMin, vMax: room.vMax },
    camera: { xPerScroll: GROUND_SHEAR, yPerScroll: 1 },
    supplyGround: supply.ground, supplyFoot: supply.foot,
    packagingGround: packaging.ground, packagingFoot: packaging.foot,
    warehouseGround: warehouse.ground, warehouseFoot: warehouse.foot
  };
}

module.exports = { buildFactoryLayout, projectFactoryPoint, factoryCameraOffset, unprojectFactoryPoint };
