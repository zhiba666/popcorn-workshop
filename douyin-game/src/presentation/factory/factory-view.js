'use strict';

const { buildFactoryLayout, projectFactoryPoint, unprojectFactoryPoint } = require('./factory-layout');
const { drawFactoryRoom, drawFactoryRoute, drawFactoryShadow, drawFactoryNameplate } = require('./factory-scene');
const { productionVisual, drawMachine, drawMachineTransfer, machineOutputPort, machineOutputDirection, drawSupply, drawPacker } = require('./factory-animation');
const { drawRotaryTransfer, rotaryOutputPort, rotaryInputPort, rotarySupplyVisual } = require('./factory-rotary');
const { drawCacheContents, drawPackagingSignal, drawBlueprint, drawConstruction, drawFirstStocked } = require('./factory-feedback-art');
const { drawFactoryControls } = require('./factory-hud');
const { drawFactoryOverview } = require('./factory-overview');

const MATERIAL = { original: 'loose-popcorn', caramel: 'caramel-popcorn', 'popcorn-ball': 'popcorn-ball',
  'crisp-stick': 'crisp-stick', wafer: 'wafer', 'sandwich-square': 'sandwich-square' };
const groundPoint = ([x, y]) => unprojectFactoryPoint(x, y);
const SUPPLY_LANE = 76;
const projectPath = points => points.map(p => projectFactoryPoint(p.u, p.v));
const pathLength = points => points.slice(1).reduce((sum, point, index) =>
  sum + Math.hypot(point[0] - points[index][0], point[1] - points[index][1]), 0);
const progress = (elapsed, duration) => Math.max(0, Math.min(1, elapsed / Math.max(.0001, duration)));
function focusFactoryRect(r, rect) {
  r.focusFactoryRect(rect);
}

function machineOutputRoute(outlet, bin, tangent = null) {
  const start = projectFactoryPoint(outlet.u, outlet.v), end = projectFactoryPoint(bin.u, bin.v);
  // Continue the native slide tangent before turning into the low output lane.
  const path = [start, tangent ? [start[0] + tangent[0] * 3, start[1] + tangent[1] * 3] :
    [start[0] - 2.5, start[1] + 2.5 * 67 / 78]];
  const appendCurve = (a, b, target) => {
    const origin = path[path.length - 1];
    for (let index = 1; index <= 8; index++) {
      const t = index / 8, q = 1 - t;
      path.push([q ** 3 * origin[0] + 3 * q * q * t * a[0] + 3 * q * t * t * b[0] + t ** 3 * target[0],
        q ** 3 * origin[1] + 3 * q * q * t * a[1] + 3 * q * t * t * b[1] + t ** 3 * target[1]]);
    }
  };
  const laneY = start[1] + 9.5;
  appendCurve(tangent ? [start[0] + tangent[0] * 10, start[1] + tangent[1] * 10] :
    [start[0] - 8, start[1] + 8 * 67 / 78],
    [start[0] + (tangent ? 4 : -6), laneY], [start[0] + 10, laneY]);
  path.push([end[0] - 27, laneY]);
  appendCurve([end[0] - 12, laneY], [end[0] - 14, end[1]], end);
  return path.map(groundPoint);
}

function drawRotaryRoute(r, route, active) {
  const points = projectPath(route), c = r.ctx;
  // Crop full-scale sections of the existing belt instead of squeezing a
  // separate textured component into every small part of the exit bend.
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index], dx = b[0] - a[0], dy = b[1] - a[1];
    const length = Math.hypot(dx, dy), count = Math.max(1, Math.ceil(length / 42)), span = length / count;
    if (!length) continue;
    for (let section = 0; section < count; section++) {
      const t = (section + 0.5) / count;
      c.save(); c.translate(a[0] + dx * t, a[1] + dy * t); c.rotate(Math.atan2(dy, dx));
      c.beginPath(); c.rect(-span / 2 - 0.75, -29, span + 1.5, 58); c.clip();
      c.rotate(-Math.atan(.138));
      r.image('factory/logistics-straight-h', -28.8, -28.8, 57.6, 57.6, active ? 1 : .88);
      c.restore();
    }
  }
}

// Scene coordinates, camera movement and pointer hit regions share one ground
// projection. Production continues to be owned exclusively by the game model.
function drawFactoryView(r, model, visual) {
  const state = model.state, selected = model.getLine(), batch = selected.factory;
  const stocked = state.firstStockedProducts || [];
  const key = state.lines.map(line => line.id).join('|');
  const initialLayout = !r.factoryLayout;
  if (key !== r.factoryLineKey) {
    const oldScene = r.factoryLayout && r.factoryLayout.scenes.find(scene => scene.lineId === selected.id);
    r.factoryLayout = buildFactoryLayout(state.lines, id => r.assets.meta(id));
    const nextScene = r.factoryLayout.scenes.find(scene => scene.lineId === selected.id);
    if (oldScene && nextScene) r.factoryCamera.setView({
      x: r.factoryCamera.x + nextScene.foot[0] - oldScene.foot[0],
      y: r.factoryCamera.y + nextScene.foot[1] - oldScene.foot[1] });
    r.factoryLineKey = key;
    r.factoryCamera.setBounds(r.factoryLayout.bounds);
    if (initialLayout && r.factoryViewMode !== 'overview') {
      const scenes = r.factoryLayout.scenes, index = scenes.findIndex(scene => scene.lineId === selected.id);
      const nearby = [scenes[index], scenes[index + 1] || scenes[index - 1]].filter(Boolean).map(scene => scene.hit);
      if (nearby.length) {
        const left = Math.min(...nearby.map(rect => rect.x)), top = Math.min(...nearby.map(rect => rect.y));
        const right = Math.max(...nearby.map(rect => rect.x + rect.w)), bottom = Math.max(...nearby.map(rect => rect.y + rect.h));
        r.focusFactoryRect({ x: left, y: top, w: right - left, h: bottom - top }, true, 1);
        r.lastFactorySelection = selected.id;
      }
    }
  }
  r.factorySelectedProduct = selected.product;
  if (r.factoryViewMode !== 'overview' && (selected.id !== r.lastFactorySelection || r.pendingFactoryFocus)) {
    r.focusLine(r.pendingFactoryFocus || selected.id, initialLayout);
    r.lastFactorySelection = selected.id;
  }
  const layout = r.factoryLayout, view = r.layout.factorySceneViewport;
  if (r.factoryViewMode === 'overview') {
    drawFactoryOverview(r, model, visual);
    drawFactoryControls(r, model, visual);
    return;
  }
  const time = visual.time || 0, beltTime = visual.reducedMotion ? 0 : time;
  const presentation = visual.factoryPresentation || {};
  const journey = presentation.construction;
  const { supply, packaging, materials } = state.shared;
  const supplyRect = layout.supply, packRect = layout.packaging, warehouse = layout.warehouse;
  const supplyPort = groundPoint(r.factoryPoint('factory/supply-body-clean', supplyRect, 'output'));
  const packPort = groundPoint(r.factoryPoint('factory/packer-body-clean', packRect, 'input'));
  const packExit = groundPoint(r.factoryPoint('factory/packer-body-clean', packRect, 'output'));
  const stockSlot = r.factorySlot('factory/warehouse', warehouse, 'stock');
  const stockPort = groundPoint([stockSlot.x + stockSlot.w / 2, stockSlot.y + stockSlot.h / 2]);
  const stockRoute = [packExit, { u: packExit.u, v: layout.warehouseGround.v - 28 },
    { u: stockPort.u, v: layout.warehouseGround.v - 28 }, stockPort];
  const scenes = layout.scenes.map(scene => {
    const line = model.getLine(scene.lineId), id = 'factory/' + r.machineId(line.product);
    const rotary = line.product === 'sandwich-square';
    const inlet = groundPoint(rotary ? rotaryInputPort(r, scene.machine) : r.factoryPoint(id, scene.machine, 'input'));
    const outlet = groundPoint(line.product === 'sandwich-square' ? rotaryOutputPort(r, scene.machine) :
      machineOutputPort(r, scene.machine, line.product) || r.factoryPoint(id, scene.machine, 'output'));
    const binSlot = r.factorySlot('factory/buffer-bin', scene.cache, 'material');
    const bin = groundPoint([binSlot.x + binSlot.w / 2, binSlot.y + binSlot.h / 2]);
    const feedV = rotary ? Math.min(scene.ground.v - 45, inlet.v - 16) : scene.ground.v - 45;
    const feedRoute = [{ u: SUPPLY_LANE, v: feedV }, { u: inlet.u, v: feedV }, inlet];
    const supplyRoute = [supplyPort, { u: SUPPLY_LANE, v: supplyPort.v }, ...feedRoute];
    const outputRoute = machineOutputRoute(outlet, bin,
      rotary ? null : machineOutputDirection(r, scene.machine, line.product));
    const packRoute = [bin, { u: 312, v: bin.v }, { u: 312, v: packPort.v }, packPort];
    return { ...scene, line, binSlot, feedRoute, supplyRoute, outputRoute, packRoute,
      flow: productionVisual(line.factory, line.product) };
  });
  const bottleneck = model.productionBottleneck();
  const packagingStatus = { queuedBatches: bottleneck.queuedBatchCount, ...(presentation.packaging || {}) };
  if (r.pendingFactoryServiceFocus) {
    focusFactoryRect(r, { packaging: packRect, supply: supplyRect, warehouse }[r.pendingFactoryServiceFocus]);
    r.pendingFactoryServiceFocus = null;
  }
  if (journey && !r.factoryFollowCancelled && selected.id === journey.lineId) {
    const focus = journey.completed || journey.phase === 'warehouse' ? 'warehouse' :
      ['packaging', 'waiting-packaging'].includes(journey.phase) ? 'packaging' : 'machine';
    const focusKey = journey.lineId + ':' + journey.startedAt + ':' + focus;
    if (focusKey !== r.factoryJourneyFocusKey && r.factoryScrollEnabled()) {
      if (focus === 'machine') r.focusLine(journey.lineId);
      else focusFactoryRect(r, focus === 'warehouse' ? warehouse : packRect);
      r.factoryJourneyFocusKey = focusKey;
    }
  }
  const c = r.ctx;
  c.save();
  r.roundRect(view.x, view.y, view.w, view.h, 12); c.clip();
  const camera = r.factoryCamera;
  c.translate(view.x + view.w / 2, view.y + view.h / 2);
  c.scale(camera.zoom, camera.zoom);
  c.translate(-camera.x, -camera.y);
  drawFactoryRoom(r, layout, camera);
  const bases = [supplyRect, ...scenes.map(scene => scene.machine), packRect, warehouse];
  bases.forEach(rect => {
    drawFactoryShadow(r, rect.foot, rect.w * 1.13, 37);
    if (rect !== warehouse) r.factoryAsset('factory/platform', rect.foot[0] - rect.w * .56,
      rect.foot[1] - 15, rect.w * 1.12, 43);
  });
  const lastScene = scenes[scenes.length - 1];
  drawFactoryRoute(r, [supplyPort, { u: SUPPLY_LANE, v: supplyPort.v },
    ...lastScene.feedRoute], { time: beltTime, active: !!supply.lineId || lastScene.line.factory.phase === 'feeding' });
  // The right-hand collector is shared by all lines. Draw it once so a second
  // line does not double the rails or animate seams over the same belt twice.
  const collector = [
    { u: 312, v: scenes[0].packRoute[0].v + 24 },
    { u: 312, v: packPort.v }, packPort
  ];
  drawFactoryRoute(r, collector, { time: beltTime, active: !!packaging.lineId });
  scenes.forEach((scene, index) => {
    if (scene !== lastScene) {
      drawFactoryRoute(r, scene.feedRoute, { time: beltTime, active: scene.line.factory.phase === 'feeding' });
      const join = projectFactoryPoint(SUPPLY_LANE, scene.feedRoute[0].v);
      r.image('factory/logistics-junction-east', join[0] - 28.8, join[1] - 28.8, 57.6, 57.6);
    }
    if (scene.line.product === 'sandwich-square') drawRotaryRoute(r, scene.outputRoute, scene.line.factory.phase === 'transport');
    else drawFactoryRoute(r, scene.outputRoute, { time: beltTime,
      active: scene.flow.transferVisible && scene.flow.transferProgress < 1 });
    // Keep the first branch's elbow continuous with the collector, then join
    // later branches at their own cache height without repainting the spine.
    const branch = scene.packRoute.slice(0, 2);
    if (!index) branch.push({ u: 312, v: Math.min(packPort.v, branch[1].v + 24) });
    drawFactoryRoute(r, branch, { time: beltTime, active: packaging.lineId === scene.line.id });
    if (index) {
      const join = projectFactoryPoint(312, branch[1].v);
      r.image('factory/logistics-junction-west', join[0] - 28.8, join[1] - 28.8, 57.6, 57.6);
    }
  });
  drawFactoryRoute(r, stockRoute, { time: beltTime, active: state.lines.some(line => line.warehouse.length) });
  const entities = [];
  entities.push({ depth: supplyRect.depth, draw() {
    if (r.factoryServiceFocus === 'supply') r.image('factory/selection-ring', supplyRect.foot[0] - 61, supplyRect.foot[1] - 12, 122, 42);
    drawSupply(r, supplyRect.x, supplyRect.y, supplyRect.w, supplyRect.h, !!supply.lineId, time,
      materials.baseUnits / materials.capacityBaseUnits);
    drawFactoryNameplate(r, '公共供料', supplyRect.foot[0] - 49, supplyRect.y + supplyRect.h - 1, 98);
  } });
  scenes.forEach(scene => {
    const line = scene.line, { machine, cache } = scene;
    entities.push({ depth: machine.depth, draw() {
      const active = line.id === state.selectedLineId;
      if (active) r.image('factory/selection-ring', machine.foot[0] - 79, machine.foot[1] - 17, 158, 53);
      drawMachine(r, r.machineId(line.product), machine.x, machine.y, machine.w, machine.h, scene.flow.renderPhase,
        scene.flow.renderProgress, time, visual.reducedMotion, line, stocked.includes(line.product));
      if (journey && journey.lineId === line.id && journey.installProgress < 1 && !visual.reducedMotion)
        drawConstruction(r, scene, journey.installProgress, false);
      drawFactoryNameplate(r, r.lineName(line), machine.foot[0] - 65, machine.y + machine.h - 3, 130, active);
    } });
    entities.push({ depth: cache.depth, draw() {
      r.factoryAsset('factory/buffer-bin', cache.x, cache.y, cache.w, cache.h);
      drawCacheContents(r, scene, MATERIAL[line.product]);
      if (bottleneck.blockedLineIds.includes(line.id)) {
        r.roundRect(cache.foot[0] - 22, cache.y - 12, 44, 17, 5, '#fff0ce', '#dcb879');
        r.text('待包装', cache.foot[0], cache.y - 3.5, 10, '#a56a26', 'center', true);
      }
    } });
  });
  layout.slots.forEach(slot => entities.push({ depth: slot.depth, draw() {
    drawBlueprint(r, slot, r.machineId(slot.product), '增线', { affordable: model.lineExpansionOffer(slot.product).affordable });
  } }));
  const packingLine = model.getLine(packaging.lineId);
  entities.push({ depth: packRect.depth, draw() {
    if (r.factoryServiceFocus === 'packaging') r.image('factory/selection-ring', packRect.foot[0] - 68, packRect.foot[1] - 12, 136, 45);
    drawPacker(r, packRect.x, packRect.y, packRect.w, packRect.h, packingLine ? 'packaging' : 'idle',
      progress(packaging.elapsed, packaging.duration), packingLine ? packingLine.product : selected.product,
      packaging.batch ? packaging.batch.outputLevel : selected.outputLevel);
    drawFactoryNameplate(r, '公共包装', packRect.foot[0] - 51, packRect.y + packRect.h - 1, 102);
    drawPackagingSignal(r, packRect, packagingStatus, time, visual.reducedMotion);
  } });
  entities.push({ depth: warehouse.depth, draw() {
    if (r.factoryServiceFocus === 'warehouse') r.image('factory/selection-ring', warehouse.foot[0] - 85, warehouse.foot[1] - 10, 170, 48);
    r.factoryAsset('factory/warehouse', warehouse.x, warehouse.y, warehouse.w, warehouse.h);
    layout.groups.forEach((group, index) => {
      const line = state.lines.find(item => item.product === group.product && item.inventory > 0);
      if (line) r.contain('product/' + group.product + '/' + line.outputLevel,
        stockSlot.x + index * stockSlot.w / layout.groups.length, stockSlot.y,
        stockSlot.w / layout.groups.length, stockSlot.h);
    });
    drawFactoryNameplate(r, '仓储', warehouse.foot[0] - 51, warehouse.y + warehouse.h - 1, 102);
    if (journey && journey.completed) drawFirstStocked(r, warehouse, journey.stockProgress,
      visual.reducedMotion, { product: journey.product, outputLevel: journey.outputLevel, stockSlot });
  } });
  if (layout.construction) {
    const slot = layout.construction;
    entities.push({ depth: slot.depth, draw() {
      r.image('factory/construction-platform', slot.x, slot.y + 10, slot.w, 65);
      drawBlueprint(r, slot, r.machineId(slot.product), '扩建' + r.productName(slot.product),
        { affordable: model.productConstructionOffer(slot.product).affordable });
    } });
  }
  entities.sort((a, b) => a.depth - b.depth).forEach(entity => entity.draw());
  scenes.forEach(scene => {
    const f = scene.line.factory, p = progress(f.elapsed, f.duration);
    if (f.phase === 'feeding') {
      const route = projectPath(scene.supplyRoute);
      const input = scene.line.product === 'sandwich-square' ? rotarySupplyVisual(p, pathLength(route)) :
        { visible: true, progress: p, alpha: 1, materialId: 'factory/loose-popcorn' };
      if (input.visible && input.alpha > 0) {
        c.save(); c.globalAlpha *= input.alpha;
        r.transfer(route, input.progress, input.materialId, 15); c.restore();
      }
    }
    if (scene.line.product === 'sandwich-square' && ['transport', 'waiting-cache'].includes(f.phase)) {
      // A full cache leaves the pending batch stationary at the arrival point.
      drawRotaryTransfer(r, scene.machine, projectPath(scene.outputRoute), f.phase === 'waiting-cache' ? 1 : p, scene.line);
    } else if (scene.flow.transferVisible) {
      drawMachineTransfer(r, scene.machine, projectPath(scene.outputRoute), scene.flow.transferProgress, scene.line.product);
    }
    if (packaging.lineId === scene.line.id) r.transfer(projectPath(scene.packRoute),
      progress(packaging.elapsed, packaging.duration), 'factory/' + MATERIAL[scene.line.product], 15);
    scene.line.warehouse.forEach(item => r.transfer(projectPath(stockRoute), progress(item.elapsed, item.duration),
      'product/' + scene.line.product + '/' + item.outputLevel, 19));
  });
  c.restore();
  drawFactoryControls(r, model, visual);
}

module.exports = { drawFactoryView };
