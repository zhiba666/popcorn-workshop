'use strict';

const { PRODUCTION_CONFIG: CONFIG, PRODUCT_DEFINITIONS } = require('../../domain/production/production-config');

// Project the ground only. Machine bitmaps retain their authored perspective.
const BASIS = Object.freeze({ xx: .9, xy: -.12, yx: .08, yy: .94, x: 290, y: 30 });
const DETERMINANT = BASIS.xx * BASIS.yy - BASIS.xy * BASIS.yx;
const WIDTH = 1320, HEIGHT = 2380, COURT_Y = 1960, MAX_LINES = 3;
const SUPPLY_X = 520, RETURN_X = 590;
const ROW_PRODUCTS = [['wafer', 'sandwich-square'], ['popcorn-ball', 'crisp-stick'], ['original', 'caramel']];
const LINE_DEPTHS = [535, 340, 140];
const PRODUCT_LAYOUT = Object.freeze({
  original: { width: 154 }, caramel: { width: 154 },
  'popcorn-ball': { width: 168 }, 'crisp-stick': { width: 176 },
  wafer: { width: 178, frontReturn: true }, 'sandwich-square': { width: 184, frontReturn: true }
});

function projectFactoryPoint(u, v, z = 0) {
  return [BASIS.xx * u + BASIS.xy * v + BASIS.x, BASIS.yx * u + BASIS.yy * v + BASIS.y - z];
}

function factoryCameraOffset(scroll) { return [BASIS.xy * scroll, BASIS.yy * scroll]; }

function unprojectFactoryPoint(x, y) {
  x -= BASIS.x; y -= BASIS.y;
  return { u: (BASIS.yy * x - BASIS.xy * y) / DETERMINANT,
    v: (-BASIS.yx * x + BASIS.xx * y) / DETERMINANT };
}

function union(rectangles, padding = 0) {
  const x = Math.min(...rectangles.map(rect => rect.x)) - padding;
  const y = Math.min(...rectangles.map(rect => rect.y)) - padding;
  return { x, y, w: Math.max(...rectangles.map(rect => rect.x + rect.w)) - x + padding,
    h: Math.max(...rectangles.map(rect => rect.y + rect.h)) - y + padding };
}

function projectedBounds(rect) {
  const points = [[rect.x, rect.y], [rect.x + rect.w, rect.y],
    [rect.x + rect.w, rect.y + rect.h], [rect.x, rect.y + rect.h]].map(([u, v]) => projectFactoryPoint(u, v));
  const x = Math.min(...points.map(value => value[0])), y = Math.min(...points.map(value => value[1]));
  return { x, y, w: Math.max(...points.map(value => value[0])) - x, h: Math.max(...points.map(value => value[1])) - y };
}

// Match factoryAsset/drawMachine's bottom-aligned contain operation. The
// catalog's contact anchor, rather than a PNG bounding box, rests on the pad.
function anchoredSprite(id, u, v, width, getMeta) {
  const foot = projectFactoryPoint(u, v), meta = getMeta && getMeta(id);
  const source = meta && meta.draw && meta.draw.sourceRect;
  const anchor = meta && meta.draw && meta.draw.anchor;
  const height = source ? width * source[3] / source[2] : width;
  const scale = source ? width / source[2] : 1;
  return { x: foot[0] - (source && anchor ? (anchor[0] - source[0]) * scale : width / 2),
    y: foot[1] - (source && anchor ? (anchor[1] - source[1]) * scale : height * .88),
    w: width, h: height, foot, ground: { u, v }, depth: foot[1], assetId: id };
}

function spritePoint(rect, meta, port, fallback) {
  const source = meta && meta.draw && meta.draw.sourceRect;
  const value = meta && meta.draw && meta.draw.ports && meta.draw.ports[port];
  if (!source || !value) return fallback;
  const scale = Math.min(rect.w / source[2], rect.h / source[3]);
  return unprojectFactoryPoint(rect.x + (rect.w - source[2] * scale) / 2 + (value[0] - source[0]) * scale,
    rect.y + rect.h - source[3] * scale + (value[1] - source[1]) * scale);
}

const point = (u, v) => ({ u, v });

function makeLineSlot(product, row, column, number, area, getMeta) {
  const spec = PRODUCT_LAYOUT[product], front = number === 1;
  const u = column === 0 ? (front ? 260 : spec.frontReturn ? 230 : 220)
    : spec.frontReturn ? (front ? 890 : 925) : (front ? 840 : 900);
  const v = area.y + LINE_DEPTHS[number - 1];
  const machineId = 'factory/' + PRODUCT_DEFINITIONS[product].machineId;
  const machine = anchoredSprite(machineId, u, v, spec.width, getMeta);
  const cacheWidth = 42, cacheOffset = (spec.width / 2 + cacheWidth / 2 + 18) / BASIS.xx;
  const cacheU = u + (spec.frontReturn ? -1 : 1) * cacheOffset;
  const cache = anchoredSprite('factory/buffer-bin', cacheU, v + 12, cacheWidth, getMeta);
  const meta = getMeta && getMeta(machineId);
  const input = spritePoint(machine, meta, 'input', point(u - 26, v - 125));
  const output = spritePoint(machine, meta, 'output', point(u + (spec.frontReturn ? -1 : 1) * 75, v + 6));
  const cacheEntry = unprojectFactoryPoint(cache.foot[0], cache.foot[1] - 14);
  const cacheExit = unprojectFactoryPoint(cache.foot[0], cache.foot[1] + 5);
  // Native contact anchors sit slightly differently from the test DOM crop.
  // Keep the front popper's inlet below the rear machine's feet, and the
  // wafer collector behind the next machine's upper silhouette.
  const feedY = input.v - (product === 'original' && front ? 20 : 24);
  const returnY = v + (front ? 34 : product === 'caramel' || product === 'wafer' ? 18 : 26);
  const feedRoute = [point(SUPPLY_X, feedY), point(input.u - 24, feedY), point(input.u - 24, input.v), input];
  const outputRoute = spec.frontReturn ? [output, point(output.u, v + 16), point(cacheEntry.u, v + 16), cacheEntry]
    : [output, point(cacheEntry.u, output.v), cacheEntry];
  const returnRoute = [cacheExit, point(cacheExit.u, returnY), point(RETURN_X, returnY)];
  const baseWidth = spec.width / BASIS.xx * 1.08;
  const bayGround = { x: u - baseWidth / 2, y: v - 18, w: baseWidth, h: front ? 52 : 60 };
  const cachePad = { x: cacheU - 30, y: v + 3, w: 60, h: 30 };
  const workBay = { x: column === 0 ? (front ? 70 : 56) : 710, y: v - 42,
    w: column === 0 ? (front ? 358 : 372) : 364, h: front ? 76 : 78 };
  const serviceX = column === 0 ? bayGround.x + bayGround.w - 4 : bayGround.x + 4;
  const hit = union([machine, cache], 10);
  hit.y -= 8; hit.h += 24;
  return { lineId: product + '-' + number, id: product + '-' + number, groupId: product + '-workshop',
    product, number, row, column, machine, cache, hit, ground: machine.ground, foot: machine.foot, depth: machine.depth,
    cacheGround: cache.ground, cacheFoot: cache.foot, bayGround, cachePad, workBay,
    serviceEdge: [point(serviceX, v - 11), point(serviceX, v + 29)], feedRoute, outputRoute, returnRoute,
    bridges: column === 1 ? [{ role: 'feed', over: 'return', ground: point(RETURN_X, feedY), point: projectFactoryPoint(RETURN_X, feedY) }]
      : [{ role: 'return', over: 'feed', ground: point(SUPPLY_X, returnY), point: projectFactoryPoint(SUPPLY_X, returnY) }] };
}

function buildFactoryLayout(lines, getMeta) {
  const groups = [], scenes = [], slots = [], allSlots = [];
  const nextProduct = CONFIG.products.find(product => !lines.some(line => line.product === product));
  let construction = null;
  for (const [row, products] of ROW_PRODUCTS.entries()) for (const [column, product] of products.entries()) {
    const productLines = lines.filter(line => line.product === product);
    const count = productLines.length, area = { x: column === 0 ? 40 : 650, y: 90 + row * 620, w: 440, h: 570 };
    const group = { id: product + '-workshop', product, row, column, index: CONFIG.products.indexOf(product), count,
      built: count > 0, next: !count && product === nextProduct, maxLines: MAX_LINES, groundRect: area,
      floorBounds: projectedBounds(area), machineSlots: [],
      labelAnchor: projectFactoryPoint(area.x + (column === 0 ? 30 : area.w - 30), area.y + 350) };
    for (let number = 1; number <= MAX_LINES; number++) {
      const line = productLines.find(item => (item.number || Number(item.id.split('-').pop())) === number);
      const available = !line && number === count + 1 && (count > 0 || group.next);
      const item = { ...makeLineSlot(product, row, column, number, area, getMeta), built: !!line, next: available,
        disabled: !line && !available };
      group.machineSlots.push(item); allSlots.push(item);
      if (line) scenes.push({ ...item, lineId: line.id });
      else if (available) {
        const pad = { ...item.machine, id: item.id, product, number, groupId: group.id,
          hit: { x: item.machine.foot[0] - 54, y: item.machine.foot[1] - 90, w: 108, h: 128 } };
        if (count) slots.push(pad); else construction = pad;
      }
    }
    const bounds = union([group.floorBounds, ...group.machineSlots.map(slot => slot.hit)], 8);
    group.bounds = { x: bounds.x - 12, y: bounds.y - 30, w: bounds.w + 24, h: bounds.h + 48 };
    group.center = [group.bounds.x + group.bounds.w / 2, group.bounds.y + group.bounds.h / 2];
    group.x = group.labelAnchor[0]; group.y = group.labelAnchor[1];
    group.ground = point(area.x, area.y); group.foot = projectFactoryPoint(area.x, area.y);
    group.workArea = { aisle: { x: column === 0 ? 434 : 658, y: area.y + 95, w: column === 0 ? 42 : 46, h: 465 },
      entry: { x: column === 0 ? 434 : 650, y: area.y + 310, w: column === 0 ? 46 : 54, h: 54 },
      bays: group.machineSlots.map(slot => ({ id: slot.id, number: slot.number, groundRect: slot.workBay, built: slot.built, next: slot.next })) };
    groups.push(group);
  }
  const supply = anchoredSprite('factory/supply-body-clean', 300, COURT_Y + 150, 152, getMeta);
  const packaging = anchoredSprite('factory/packer-body-clean', 620, COURT_Y + 150, 184, getMeta);
  const warehouse = anchoredSprite('factory/warehouse', 885, COURT_Y + 210, 252, getMeta);
  const supplyOut = spritePoint(supply, getMeta && getMeta(supply.assetId), 'output', point(450, COURT_Y + 190));
  const packIn = spritePoint(packaging, getMeta && getMeta(packaging.assetId), 'input', point(590, COURT_Y + 80));
  const packOut = spritePoint(packaging, getMeta && getMeta(packaging.assetId), 'output', point(710, COURT_Y + 150));
  const warehouseIn = unprojectFactoryPoint(warehouse.foot[0] - warehouse.w * .22, warehouse.foot[1] - 12);
  supply.feedRoute = [supplyOut, point(supplyOut.u, COURT_Y + 190), point(450, COURT_Y + 190)];
  packaging.feedRoute = [point(RETURN_X, COURT_Y + 30), point(packIn.u - 26, COURT_Y + 30), point(packIn.u - 26, packIn.v), packIn];
  packaging.warehouseRoute = [packOut, point(packOut.u + 28, packOut.v), point(packOut.u + 28, COURT_Y + 255),
    point(warehouseIn.u, COURT_Y + 255), warehouseIn];
  const courtyardGround = { x: 40, y: COURT_Y, w: 1050, h: 350 };
  const courtBounds = union([projectedBounds(courtyardGround), supply, packaging, warehouse], 24);
  const courtyard = { groundRect: courtyardGround, bounds: courtBounds,
    center: [courtBounds.x + courtBounds.w / 2, courtBounds.y + courtBounds.h / 2],
    labelAnchor: projectFactoryPoint(265, COURT_Y + 268), entry: projectFactoryPoint(565, COURT_Y + 340) };
  const bounds = union([...groups.map(group => group.bounds), courtBounds], 8);
  return { width: WIDTH, height: HEIGHT, groundHeight: COURT_Y + 350, maxLinesPerProduct: MAX_LINES,
    bounds, activeBounds: union([...groups.filter(group => group.built || group.next).map(group => group.bounds), courtBounds], 8),
    groups, scenes, slots, allSlots, construction, supply, packaging, warehouse, courtyard,
    shared: { supply, packer: packaging, warehouse }, nextProduct,
    spine: { groundRect: { x: 485, y: 70, w: 150, h: COURT_Y - 20 } },
    mainRoutes: { supply: [point(450, COURT_Y + 190), point(450, COURT_Y), point(SUPPLY_X, COURT_Y), point(SUPPLY_X, 115)],
      return: [point(RETURN_X, 115), point(RETURN_X, COURT_Y + 30)], packToWarehouse: packaging.warehouseRoute },
    bridges: scenes.flatMap(scene => scene.bridges.map(bridge => ({ ...bridge, lineId: scene.lineId }))),
    room: { uMin: 20, uMax: 1110, vMin: 70, vMax: COURT_Y + 350 }, ground: BASIS,
    camera: { xPerScroll: BASIS.xy, yPerScroll: BASIS.yy },
    supplyGround: supply.ground, supplyFoot: supply.foot, packagingGround: packaging.ground, packagingFoot: packaging.foot,
    warehouseGround: warehouse.ground, warehouseFoot: warehouse.foot };
}

module.exports = { buildFactoryLayout, projectFactoryPoint, factoryCameraOffset, unprojectFactoryPoint };
