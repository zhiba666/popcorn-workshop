import { factoryProducts as sourceProducts } from '../../assets/source/factory/expansion/v1/layout.js';
import { runtimeFactoryAssetsById } from '../../assets/runtime/factory/v1/manifest.js';

export const factoryProducts = Object.freeze(sourceProducts.map(product =>
  Object.freeze({ ...product, zone: `${product.name}工坊` })));

export const factoryLayoutPresets = Object.freeze({
  single: Object.freeze([1, 0, 0, 0, 0, 0]),
  opening: Object.freeze([1, 1, 0, 0, 0, 0]),
  six: Object.freeze([1, 1, 1, 1, 1, 1]),
  double: Object.freeze([2, 2, 2, 2, 2, 2]),
  full: Object.freeze([3, 3, 3, 3, 3, 3]),
});

const WIDTH = 1320, HEIGHT = 2380, MAX_LINES = 3;
const SUPPLY_X = 520, RETURN_X = 590, ROW_STEP = 620, COURT_Y = 1960;
const WORKSHOP_DEPTH = 570, LINE_STEP = 195, ORIGIN_X = 290;
const ROW_PRODUCTS = [['wafer', 'sandwich-square'], ['popcorn-ball', 'crisp-stick'], ['original', 'caramel']];

// One oblique ground plane for paving, pads, installations and service routes.
// Sprites remain upright; only their ground anchors are projected.
export function projectGround([u, v]) { return [.9 * u - .12 * v + ORIGIN_X, .08 * u + .94 * v + 30]; }
function unproject([x, y]) {
  x -= ORIGIN_X; y -= 30;
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
    { id: 'supply', assetId: 'supply-complete', name: '公共供料', groundAnchor: [300, COURT_Y + 150], width: 152 },
    { id: 'packer', assetId: 'packer-complete', name: '公共包装', groundAnchor: [620, COURT_Y + 150], width: 184 },
    { id: 'warehouse', assetId: 'warehouse', name: '统一仓储', groundAnchor: [885, COURT_Y + 210], width: 252 },
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
  supply.feedRoute = route([supplyOut, [supplyOut[0], COURT_Y + 190], [450, COURT_Y + 190]]);
  packer.feedRoute = route([[RETURN_X, COURT_Y + 30], [packIn[0] - 26, COURT_Y + 30], [packIn[0] - 26, packIn[1]], packIn]);
  // The warehouse's opening is the loading destination; it has no exported port.
  const warehouseEntry = [warehouse.cx - warehouse.width * .22, warehouse.foot - 12];
  const warehouseIn = unproject(warehouseEntry);
  packer.warehouseRoute = route([packOut, [packOut[0] + 28, packOut[1]],
    [packOut[0] + 28, COURT_Y + 255], [warehouseIn[0], COURT_Y + 255], warehouseIn]);
  return shared;
}

function makeSlot(product, index, row, column, number, groundRect) {
  const front = number === 1;
  // Keep both operating faces clear of the service aisle at the spine side.
  // Left-facing discharge assets keep their native orientation and cache side.
  const u = column === 0 ? (front ? 260 : product.frontReturn ? 230 : 220)
    : product.frontReturn ? (front ? 890 : 925) : (front ? 840 : 900);
  const groundAnchor = [u, groundRect.y + 535 - (number - 1) * LINE_STEP];
  const [machineCx, foot] = projectGround(groundAnchor);
  const cacheWidth = 42, cacheOffset = product.width / 2 + cacheWidth / 2 + 18;
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
  const rearReturnDepth = product.id === 'caramel' ? 18 : 26;
  const feedY = inputGround[1] - 24, returnY = groundAnchor[1] + (front ? 34 : rearReturnDepth);
  const feedRoute = route([[SUPPLY_X, feedY], [inputGround[0] - 24, feedY], [inputGround[0] - 24, inputGround[1]], inputGround]);
  const transferY = groundAnchor[1] + 16;
  const outputRoute = route(product.frontReturn ? [outputGround, [outputGround[0], transferY],
    [entryGround[0], transferY], entryGround] : [outputGround, [entryGround[0], outputGround[1]], entryGround]);
  const returnRoute = route([exitGround, [exitGround[0], returnY], [RETURN_X, returnY]]);
  const baseWidth = product.width / .9 * 1.08;
  const bayGround = { x: u - baseWidth / 2, y: groundAnchor[1] - 18, w: baseWidth, h: front ? 52 : 60 };
  const cachePad = { x: cacheGround[0] - 30, y: cacheGround[1] - 9, w: 60, h: 30 };
  const workBay = { x: column === 0 ? (front ? 70 : 56) : 710, y: groundAnchor[1] - 42,
    w: column === 0 ? (front ? 358 : 372) : 364, h: front ? 76 : 78 };
  const serviceX = column === 0 ? bayGround.x + bayGround.w - 4 : bayGround.x + 4;
  const serviceEdge = [[serviceX, groundAnchor[1] - 11], [serviceX, groundAnchor[1] + 29]];
  const bounds = union([machine.bounds, cache.bounds]);
  const selectionBounds = rect(bounds.x - 10, bounds.y - 12, bounds.w + 20, bounds.h + 48);
  return { id: `${product.id}-${number}`, groupId: `${product.id}-workshop`, product, index, row, column, number,
    machineCx, foot, width: product.width, cacheCx, cacheFoot, cacheWidth, groundAnchor, cacheGround,
    bayGround, cachePad, workBay, serviceEdge,
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
    throw new RangeError(`六种产品的装配数量必须各为0至${MAX_LINES}条。`);
  const normalized = [...counts], next = factoryProducts.find((product, index) => normalized[index] === 0) || null;
  const groups = [], lines = [], slots = [];
  for (const [row, products] of ROW_PRODUCTS.entries()) for (const [column, productId] of products.entries()) {
    const index = factoryProducts.findIndex(product => product.id === productId), product = factoryProducts[index], count = normalized[index];
    const groundRect = { x: column === 0 ? 40 : 650, y: 90 + row * ROW_STEP, w: 440, h: WORKSHOP_DEPTH };
    const floorBounds = projectedBounds(groundRect);
    const group = { id: `${product.id}-workshop`, product, index, row, column, groundRect,
      built: count > 0, next: count === 0 && product === next, count, maxLines: MAX_LINES,
      ...floorBounds, floorBounds, machineSlots: [],
      labelAnchor: projectGround([groundRect.x + (column === 0 ? 30 : groundRect.w - 30), groundRect.y + 350]) };
    for (let number = 1; number <= MAX_LINES; number++) {
      const built = number <= count, available = !built && (count > 0 ? number === count + 1 : number === 1 && product === next);
      const slot = { ...makeSlot(product, index, row, column, number, groundRect), built,
        type: built ? 'line' : number === 1 ? 'product-slot' : 'line-slot', disabled: !built && !available, next: available };
      group.machineSlots.push(slot); slots.push(slot); if (built) lines.push({ ...slot, type: 'line' });
    }
    group.bounds = union([floorBounds, ...group.machineSlots.map(slot => slot.bounds)], 8);
    // Low rails and retaining edges extend past the slab; framing includes
    // their raised posts and foreground shadows, not just the floor polygon.
    group.bounds = rect(group.bounds.x-12,group.bounds.y-30,group.bounds.w+24,group.bounds.h+48);
    group.workArea = {
      aisle: { x: column === 0 ? 434 : 658, y: groundRect.y + 95, w: column === 0 ? 42 : 46, h: WORKSHOP_DEPTH - 105 },
      entry: { x: column === 0 ? 434 : 650, y: groundRect.y + 310, w: column === 0 ? 46 : 54, h: 54 },
      bays: group.machineSlots.map(slot => ({ id: slot.id, number: slot.number,
        groundRect: slot.workBay, built: slot.built, next: slot.next })),
    };
    group.center = [group.bounds.x + group.bounds.w / 2, group.bounds.y + group.bounds.h / 2];
    groups.push(group);
  }
  const shared = makeShared();
  const courtyardGround = { x: 40, y: COURT_Y, w: 1050, h: 350 };
  const courtBounds = union([projectedBounds(courtyardGround), ...Object.values(shared).map(device => device.bounds)], 24);
  const courtyard = { groundRect: courtyardGround, bounds: courtBounds,
    center: [courtBounds.x + courtBounds.w / 2, courtBounds.y + courtBounds.h / 2],
    labelAnchor: projectGround([265, COURT_Y + 268]), entry: projectGround([565, COURT_Y + 340]) };
  const mainRoutes = { supply: route([[450, COURT_Y + 190], [450, COURT_Y], [SUPPLY_X, COURT_Y], [SUPPLY_X, 115]]),
    return: route([[RETURN_X, 115], [RETURN_X, COURT_Y + 30]]), packToWarehouse: shared.packer.warehouseRoute };
  const builtGroups = groups.filter(group => group.built), nextGroup=groups.find(group=>group.product===next);
  const framedGroups = [...builtGroups,...(nextGroup?[nextGroup]:[])];
  const siteBounds = union([...groups.map(group => group.bounds), courtBounds], 8);
  return { width: WIDTH, height: HEIGHT, maxLinesPerProduct: MAX_LINES, counts: normalized,
    groups, lines, slots, next, bounds: siteBounds, activeBounds: union([...framedGroups.map(group => group.bounds), courtBounds], 8),
    shared, courtyard, spine: { groundRect: { x: 485, y: 70, w: 150, h: COURT_Y - 20 } },
    mainRoutes, project: projectGround,
    supplyLabel: projectGround([SUPPLY_X, 92]), returnLabel: projectGround([RETURN_X, 92]),
    bridges: lines.flatMap(line => line.bridges.map(bridge => ({ ...bridge, lineId: line.id }))),
  };
}
