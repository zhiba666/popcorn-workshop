import { factoryProducts as sourceProducts } from '../../assets/source/factory/expansion/v1/layout.js';
import { runtimeFactoryAssetsById } from '../../assets/runtime/factory/v1/manifest.js';

export const factoryProducts = Object.freeze(sourceProducts.map(product =>
  Object.freeze({ ...product, zone: `${product.name}工坊` })));

export const factoryLayoutPresets = Object.freeze({
  single: Object.freeze([1, 0, 0, 0, 0, 0]),
  opening: Object.freeze([1, 1, 0, 0, 0, 0]),
  six: Object.freeze([1, 1, 1, 1, 1, 1]),
  full: Object.freeze([2, 2, 2, 2, 2, 2]),
});

const WIDTH = 1220, HEIGHT = 1680, MAX_LINES = 2;
const SUPPLY_X = 520, RETURN_X = 590, ROW_STEP = 390;
const ROW_PRODUCTS = [['wafer', 'sandwich-square'], ['popcorn-ball', 'crisp-stick'], ['original', 'caramel']];

// One oblique ground plane for paving, pads, installations and service routes.
// Sprites remain upright; only their ground anchors are projected.
export function projectGround([u, v]) { return [.9 * u - .12 * v + 210, .08 * u + .94 * v + 30]; }
function unproject([x, y]) {
  x -= 210; y -= 30;
  return [(.94 * x + .12 * y) / .8556, (-.08 * x + .9 * y) / .8556];
}
function rect(x, y, w, h) { return { x, y, w, h, left: x, top: y, right: x + w, bottom: y + h }; }
function union(rectangles, padding = 0) {
  const left = Math.min(...rectangles.map(value => value.x)) - padding;
  const top = Math.min(...rectangles.map(value => value.y)) - padding;
  return rect(left, top, Math.max(...rectangles.map(value => value.x + value.w)) - left + padding,
    Math.max(...rectangles.map(value => value.y + value.h)) - top + padding);
}
function projectedBounds(area) {
  const corners = [[area.x, area.y], [area.x + area.w, area.y],
    [area.x + area.w, area.y + area.h], [area.x, area.y + area.h]].map(projectGround);
  const left = Math.min(...corners.map(p => p[0])), top = Math.min(...corners.map(p => p[1]));
  return rect(left, top, Math.max(...corners.map(p => p[0])) - left, Math.max(...corners.map(p => p[1])) - top);
}
const route = points => points.map(projectGround);

function spriteGeometry(assetId, cx, foot, width, anchor = .9) {
  const asset = runtimeFactoryAssetsById[assetId], [x0, y0, x1, y1] = asset.bounds;
  const scale = width / (x1 - x0), height = (y1 - y0) * scale;
  const left = cx - width / 2, top = foot - height * anchor;
  return { bounds: rect(left, top, width, height),
    point: point => [left + (point[0] - x0) * scale, top + (point[1] - y0) * scale],
    sourcePoint: point => [
      left + (point[0] - asset.originalBounds[0]) * width / (asset.originalBounds[2] - asset.originalBounds[0]),
      top + (point[1] - asset.originalBounds[1]) * height / (asset.originalBounds[3] - asset.originalBounds[1])],
  };
}

function makeShared() {
  const specifications = [
    { id: 'supply', assetId: 'supply-complete', name: '公共供料', groundAnchor: [300, 1430], width: 152 },
    { id: 'packer', assetId: 'packer-complete', name: '公共包装', groundAnchor: [620, 1430], width: 184 },
    { id: 'warehouse', assetId: 'warehouse', name: '统一仓储', groundAnchor: [915, 1490], width: 252 },
  ];
  const shared = {};
  for (const specification of specifications) {
    const [cx, foot] = projectGround(specification.groundAnchor);
    const geometry = spriteGeometry(specification.assetId, cx, foot, specification.width);
    const ports = runtimeFactoryAssetsById[specification.assetId].draw?.ports || {};
    shared[specification.id] = { ...specification, cx, foot, bounds: geometry.bounds,
      ...(ports.input ? { input: geometry.point(ports.input) } : {}),
      ...(ports.output ? { output: geometry.point(ports.output) } : {}) };
  }
  const { supply, packer, warehouse } = shared;
  const supplyOut = unproject(supply.output), packIn = unproject(packer.input), packOut = unproject(packer.output);
  supply.feedRoute = route([supplyOut, [supplyOut[0], 1470], [SUPPLY_X, 1470]]);
  packer.feedRoute = route([[RETURN_X, 1310], [packIn[0] - 26, 1310], [packIn[0] - 26, packIn[1]], packIn]);
  // The warehouse's opening is the loading destination; it has no exported port.
  const warehouseEntry = [warehouse.cx - warehouse.width * .22, warehouse.foot - 12];
  const warehouseIn = unproject(warehouseEntry);
  packer.warehouseRoute = route([packOut, [packOut[0] + 28, packOut[1]],
    [packOut[0] + 28, 1535], [warehouseIn[0], 1535], warehouseIn]);
  return shared;
}

function makeSlot(product, index, row, column, number, groundRect) {
  const front = number === 1;
  const groundAnchor = [column === 0 ? (front ? 305 : 220) : (front ? 780 : 905), groundRect.y + (front ? 335 : 140)];
  const [machineCx, foot] = projectGround(groundAnchor);
  const cacheWidth = 42, cacheOffset = product.width / 2 + cacheWidth / 2 + 12;
  // Cache offsets follow the same projected ground axis as the platform edges.
  const cacheGround = [groundAnchor[0] + (product.frontReturn ? -1 : 1) * cacheOffset / .9, groundAnchor[1] + 12];
  const [cacheCx, cacheFoot] = projectGround(cacheGround);
  const machine = spriteGeometry(product.machine, machineCx, foot, product.width, .88);
  const cache = spriteGeometry('buffer-bin', cacheCx, cacheFoot, cacheWidth);
  const input = machine.point(runtimeFactoryAssetsById[product.machine].draw.ports.input);
  const output = machine.sourcePoint(product.terminal);
  const inputGround = unproject(input), outputGround = unproject(output);
  const cacheEntry = [cacheCx, cacheFoot - 14], cacheExit = [cacheCx, cacheFoot + 5];
  const entryGround = unproject(cacheEntry), exitGround = unproject(cacheExit);
  const feedY = inputGround[1] - 24, returnY = groundAnchor[1] + (front ? 34 : 26);
  const feedRoute = route([[SUPPLY_X, feedY], [inputGround[0] - 24, feedY], [inputGround[0] - 24, inputGround[1]], inputGround]);
  const transferY = groundAnchor[1] + 16;
  const outputRoute = route(product.frontReturn ? [outputGround, [outputGround[0], transferY],
    [entryGround[0], transferY], entryGround] : [outputGround, [entryGround[0], outputGround[1]], entryGround]);
  const returnRoute = route([exitGround, [exitGround[0], returnY], [RETURN_X, returnY]]);
  const bounds = union([machine.bounds, cache.bounds]);
  const selectionBounds = rect(bounds.x - 10, bounds.y - 12, bounds.w + 20, bounds.h + 48);
  return { id: `${product.id}-${number}`, groupId: `${product.id}-workshop`, product, index, row, column, number,
    machineCx, foot, width: product.width, cacheCx, cacheFoot, cacheWidth, groundAnchor, cacheGround,
    x: selectionBounds.x, y: selectionBounds.y, bounds: selectionBounds, machineBounds: machine.bounds, cacheBounds: cache.bounds,
    ground: { machine: [machineCx, foot], cache: [cacheCx, cacheFoot], input, output, cacheEntry },
    feedRoute, outputRoute, returnRoute,
    bridges: [
      ...(column === 1 ? [{ role: 'feed', over: 'return', point: projectGround([RETURN_X, feedY]) }] : []),
      ...(column === 0 ? [{ role: 'return', over: 'feed', point: projectGround([SUPPLY_X, returnY]) }] : []),
    ],
  };
}

export function buildFactoryExpansionLayout(counts = factoryLayoutPresets.opening) {
  if (!Array.isArray(counts) || counts.length !== factoryProducts.length || counts.some(count => !Number.isInteger(count) || count < 0 || count > MAX_LINES))
    throw new RangeError('六种产品的装配数量必须各为0至2条。');
  const normalized = [...counts], next = factoryProducts.find((product, index) => normalized[index] === 0) || null;
  const groups = [], lines = [], slots = [];
  for (const [row, products] of ROW_PRODUCTS.entries()) for (const [column, productId] of products.entries()) {
    const index = factoryProducts.findIndex(product => product.id === productId), product = factoryProducts[index], count = normalized[index];
    const groundRect = { x: column === 0 ? 60 : 650, y: 90 + row * ROW_STEP, w: 400, h: 370 };
    const floorBounds = projectedBounds(groundRect);
    const group = { id: `${product.id}-workshop`, product, index, row, column, groundRect,
      built: count > 0, next: count === 0 && product === next, count, maxLines: MAX_LINES,
      ...floorBounds, floorBounds, machineSlots: [],
      labelAnchor: projectGround([groundRect.x + groundRect.w / 2, groundRect.y + groundRect.h - 6]) };
    for (let number = 1; number <= MAX_LINES; number++) {
      const built = number <= count, available = !built && (count > 0 ? number === count + 1 : number === 1 && product === next);
      const slot = { ...makeSlot(product, index, row, column, number, groundRect), built,
        type: built ? 'line' : number === 1 ? 'product-slot' : 'line-slot', disabled: !built && !available, next: available };
      group.machineSlots.push(slot); slots.push(slot); if (built) lines.push({ ...slot, type: 'line' });
    }
    group.bounds = union([floorBounds, ...group.machineSlots.map(slot => slot.bounds)], 8);
    group.center = [group.bounds.x + group.bounds.w / 2, group.bounds.y + group.bounds.h / 2];
    groups.push(group);
  }
  const shared = makeShared();
  const courtyardGround = { x: 60, y: 1280, w: 990, h: 350 };
  const courtBounds = union([projectedBounds(courtyardGround), ...Object.values(shared).map(device => device.bounds)], 24);
  const courtyard = { groundRect: courtyardGround, bounds: courtBounds,
    center: [courtBounds.x + courtBounds.w / 2, courtBounds.y + courtBounds.h / 2],
    labelAnchor: projectGround([265, 1548]), entry: projectGround([555, 1620]) };
  const mainRoutes = { supply: route([[SUPPLY_X, 1470], [SUPPLY_X, 115]]),
    return: route([[RETURN_X, 115], [RETURN_X, 1310]]), packToWarehouse: shared.packer.warehouseRoute };
  const builtGroups = groups.filter(group => group.built), framedGroups = builtGroups.length ? builtGroups : [groups.find(group => group.product === next)];
  return { width: WIDTH, height: HEIGHT, maxLinesPerProduct: MAX_LINES, counts: normalized,
    groups, lines, slots, next, bounds: rect(0, 0, WIDTH, HEIGHT), activeBounds: union([...framedGroups.map(group => group.bounds), courtBounds], 8),
    shared, courtyard, spine: { groundRect: { x: 485, y: 70, w: 150, h: 1260 } },
    mainRoutes, project: projectGround,
    supplyLabel: projectGround([SUPPLY_X, 92]), returnLabel: projectGround([RETURN_X, 92]),
    bridges: lines.flatMap(line => line.bridges.map(bridge => ({ ...bridge, lineId: line.id }))),
  };
}
