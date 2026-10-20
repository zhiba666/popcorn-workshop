'use strict';

const { buildFactoryLayout, unprojectFactoryPoint } = require('./factory-layout');
const { drawFactoryRoom, drawFactoryRoute, drawFactoryShadow, factoryBoundaryEntities, projectFactoryRoute } = require('./factory-scene');
const { productionVisual, drawMachine, drawMachineTransfer, machineOutputPort, drawSupply, drawPacker } = require('./factory-animation');
const { drawRotaryTransfer, rotaryOutputPort, rotarySupplyVisual } = require('./factory-rotary');
const { drawCacheContents, drawBlueprint, drawConstruction, drawFirstStocked } = require('./factory-feedback-art');
const { drawFactoryControls } = require('./factory-hud');
const { drawFactoryOverview, drawFactorySceneLabels } = require('./factory-overview');

const MATERIAL = { original: 'loose-popcorn', caramel: 'caramel-popcorn', 'popcorn-ball': 'popcorn-ball',
  'crisp-stick': 'crisp-stick', wafer: 'wafer', 'sandwich-square': 'sandwich-square' };
const progress = (elapsed, duration) => Math.max(0, Math.min(1, elapsed / Math.max(.0001, duration)));
const pathLength = points => points.slice(1).reduce((sum, point, index) =>
  sum + Math.hypot(point[0] - points[index][0], point[1] - points[index][1]), 0);
const groundPoint = point => unprojectFactoryPoint(point[0], point[1]);

function prepareScenes(r, model, layout) {
  const supplyPrefix = [...layout.supply.feedRoute, ...layout.mainRoutes.supply.slice(1, 3)];
  return layout.scenes.map(scene => {
    const line = model.getLine(scene.lineId), machine = scene.machine;
    const outlet = line.product === 'sandwich-square' ? rotaryOutputPort(r, machine) : machineOutputPort(r, machine, line.product);
    const outputRoute = scene.outputRoute.map(point => ({ ...point }));
    if (outlet) {
      outputRoute[0] = groundPoint(outlet);
      if (['wafer', 'sandwich-square'].includes(line.product)) outputRoute[1].u = outputRoute[0].u;
      else outputRoute[1].v = outputRoute[0].v;
    }
    const binSlot = r.factorySlot('factory/buffer-bin', scene.cache, 'material');
    const supplyRoute = [...supplyPrefix, ...scene.feedRoute];
    const packRoute = [...scene.returnRoute, ...layout.mainRoutes.return.slice(1), ...layout.packaging.feedRoute.slice(1)];
    return { ...scene, line, binSlot, outputRoute, supplyRoute, packRoute,
      supplyPath: projectFactoryRoute(supplyRoute, scene.bridges.filter(bridge => bridge.role === 'feed')),
      outputPath: projectFactoryRoute(outputRoute),
      packPath: projectFactoryRoute(packRoute, scene.bridges.filter(bridge => bridge.role === 'return')),
      flow: productionVisual(line.factory, line.product) };
  });
}

// Scene geometry is independent of construction order. The model remains the
// only authority for batches, queues, upgrades, stock and production time.
function drawFactoryView(r, model, visual = {}) {
  const state = model.state, selected = model.getLine();
  if (!selected) return;
  const key = state.lines.map(line => line.id).join('|');
  if (key !== r.factoryLineKey) {
    const initial = !r.factoryLayout;
    r.factoryLayout = buildFactoryLayout(state.lines, id => r.assets.meta(id));
    r.factoryLineKey = key;
    r.factoryCamera.minZoom = r.factoryOverviewZoom();
    r.factoryCamera.setBounds(r.factoryLayout.bounds);
    if (initial && r.factoryViewMode !== 'overview') r.focusLine(selected.id, true);
    r.lastFactorySelection = selected.id;
    r.factoryModeApplied = null;
  }
  const layout = r.factoryLayout, view = r.layout.factorySceneViewport, camera = r.factoryCamera;
  const overview = r.factoryViewMode === 'overview';
  if (r.factoryModeApplied !== r.factoryViewMode) {
    if (overview) {
      r.factoryDetailCamera = { x: camera.x, y: camera.y, zoom: camera.zoom };
      r.focusFactoryOverview(true);
    } else if (r.factoryModeApplied === 'overview') {
      if (r.factoryDetailCamera && !r.pendingFactoryFocus && !r.pendingFactoryServiceFocus)
        camera.setView(r.factoryDetailCamera);
      else if (!r.pendingFactoryServiceFocus) r.focusLine(selected.id, true);
    }
    r.factoryModeApplied = r.factoryViewMode;
  }
  r.factorySelectedProduct = selected.product;
  if (!overview && (selected.id !== r.lastFactorySelection || r.pendingFactoryFocus)) {
    r.focusLine(r.pendingFactoryFocus || selected.id);
    r.lastFactorySelection = selected.id;
  }
  if (r.pendingFactoryServiceFocus && !overview) {
    const target = { supply: layout.supply, packaging: layout.packaging, warehouse: layout.warehouse }[r.pendingFactoryServiceFocus];
    if (target) r.focusFactoryRect(target, false, Math.min(.9, Math.max(.65, camera.zoom)));
    r.pendingFactoryServiceFocus = null;
  }
  const presentation = visual.factoryPresentation || {}, journey = presentation.construction;
  if (!overview && journey && !r.factoryFollowCancelled && selected.id === journey.lineId) {
    const target = journey.completed || journey.phase === 'warehouse' ? 'warehouse' :
      ['packaging', 'waiting-packaging'].includes(journey.phase) ? 'packaging' : 'machine';
    const key = journey.lineId + ':' + journey.startedAt + ':' + target;
    if (key !== r.factoryJourneyFocusKey && r.factoryScrollEnabled()) {
      if (target === 'machine') r.focusLine(journey.lineId);
      else r.focusFactoryRect(target === 'warehouse' ? layout.warehouse : layout.packaging, false, .8);
      r.factoryJourneyFocusKey = key;
    }
  }
  const scenes = prepareScenes(r, model, layout), { supply, packaging, materials } = state.shared;
  const time = visual.time || 0, motionTime = visual.reducedMotion ? 0 : time;
  const bottleneck = model.productionBottleneck(), stockPath = projectFactoryRoute(layout.mainRoutes.packToWarehouse);
  const stockSlot = r.factorySlot('factory/warehouse', layout.warehouse, 'stock');
  const visible = camera.visibleBounds();
  const onScreen = rect => rect.x + rect.w > visible.left - 25 && rect.x < visible.right + 25 &&
    rect.y + rect.h > visible.top - 25 && rect.y < visible.bottom + 25;
  const c = r.ctx;
  c.save();
  r.roundRect(view.x, view.y, view.w, view.h, 12, '#b8c5a4'); c.clip();
  c.translate(view.x + view.w / 2, view.y + view.h / 2); c.scale(camera.zoom, camera.zoom); c.translate(-camera.x, -camera.y);
  drawFactoryRoom(r, layout, camera);
  const route = (points, role, options = {}) => drawFactoryRoute(r, points, {
    role, time: motionTime, detail: !overview, ...options });
  route(layout.mainRoutes.supply, 'feed', { tier: 'trunk', active: !!supply.lineId || scenes.some(scene => scene.line.factory.phase === 'feeding') });
  route(layout.supply.feedRoute, 'feed', { active: !!supply.lineId });
  route(layout.mainRoutes.return, 'return', { tier: 'trunk', active: !!packaging.lineId });
  route(layout.packaging.feedRoute, 'return', { active: !!packaging.lineId });
  route(layout.mainRoutes.packToWarehouse, 'return', { tier: 'trunk', active: state.lines.some(line => line.warehouse.length) });
  for (const scene of scenes) {
    const selectedRoute = scene.lineId === selected.id && !r.factoryServiceFocus;
    route(scene.feedRoute, 'feed', { active: scene.line.factory.phase === 'feeding', selected: selectedRoute,
      bridges: scene.bridges.filter(bridge => bridge.role === 'feed') });
    route(scene.outputRoute, 'output', { active: scene.flow.transferVisible, selected: selectedRoute });
    route(scene.returnRoute, 'return', { active: packaging.lineId === scene.lineId, selected: selectedRoute,
      bridges: scene.bridges.filter(bridge => bridge.role === 'return') });
  }
  // Transfers stay beneath equipment and depth-sorted rails, entering the real
  // sockets instead of floating in front of machine bodies.
  for (const scene of scenes) {
    const f = scene.line.factory, p = progress(f.elapsed, f.duration);
    if (f.phase === 'feeding') {
      const input = scene.line.product === 'sandwich-square' ? rotarySupplyVisual(p, pathLength(scene.supplyPath)) :
        { visible: true, progress: p, alpha: 1, materialId: 'factory/loose-popcorn' };
      if (input.visible && input.alpha > 0) {
        c.save(); c.globalAlpha *= input.alpha; r.transfer(scene.supplyPath, input.progress, input.materialId, 15); c.restore();
      }
    }
    if (scene.line.product === 'sandwich-square' && ['transport', 'waiting-cache'].includes(f.phase))
      drawRotaryTransfer(r, scene.machine, scene.outputPath, f.phase === 'waiting-cache' ? 1 : p, scene.line);
    else if (scene.flow.transferVisible)
      drawMachineTransfer(r, scene.machine, scene.outputPath, scene.flow.transferProgress, scene.line.product);
    if (packaging.lineId === scene.line.id) r.transfer(scene.packPath, progress(packaging.elapsed, packaging.duration),
      'factory/' + MATERIAL[scene.line.product], 15);
    scene.line.warehouse.forEach(item => r.transfer(stockPath, progress(item.elapsed, item.duration),
      'product/' + scene.line.product + '/' + item.outputLevel, 22));
  }
  const stocked = state.firstStockedProducts || [], entities = factoryBoundaryEntities(r, layout);
  for (const scene of scenes) {
    const line = scene.line, { machine, cache } = scene, active = line.id === selected.id && !r.factoryServiceFocus;
    if (onScreen(machine)) entities.push({ depth: machine.depth, draw() {
      drawFactoryShadow(r, machine.foot, machine.w * 1.08, 28);
      if (active) r.image('factory/selection-ring', machine.foot[0] - machine.w * .54, machine.foot[1] - 14, machine.w * 1.08, 42);
      if (overview && line.product !== selected.product)
        r.factoryAsset('factory/' + r.machineId(line.product), machine.x, machine.y, machine.w, machine.h);
      else drawMachine(r, r.machineId(line.product), machine.x, machine.y, machine.w, machine.h,
        scene.flow.renderPhase, scene.flow.renderProgress, time, visual.reducedMotion, line, stocked.includes(line.product));
      if (journey && journey.lineId === line.id && journey.installProgress < 1 && !visual.reducedMotion)
        drawConstruction(r, scene, journey.installProgress, false);
    } });
    if (onScreen(cache)) entities.push({ depth: cache.depth, draw() {
      if (active) r.image('factory/selection-ring', cache.foot[0] - 26, cache.foot[1] - 7, 52, 20);
      r.factoryAsset('factory/buffer-bin', cache.x, cache.y, cache.w, cache.h);
      drawCacheContents(r, scene, MATERIAL[line.product]);
    } });
  }
  for (const slot of layout.slots) if (onScreen(slot)) entities.push({ depth: slot.depth, draw() {
    drawBlueprint(r, slot, r.machineId(slot.product), '', { affordable: model.lineExpansionOffer(slot.product).affordable });
  } });
  const supplyRect = layout.supply, packRect = layout.packaging, warehouse = layout.warehouse;
  if (onScreen(supplyRect)) entities.push({ depth: supplyRect.depth, draw() {
    if (r.factoryServiceFocus === 'supply') r.image('factory/selection-ring', supplyRect.foot[0] - 80, supplyRect.foot[1] - 12, 160, 44);
    drawSupply(r, supplyRect.x, supplyRect.y, supplyRect.w, supplyRect.h, !!supply.lineId, time,
      materials.baseUnits / materials.capacityBaseUnits);
  } });
  if (onScreen(packRect)) entities.push({ depth: packRect.depth, draw() {
    if (r.factoryServiceFocus === 'packaging') r.image('factory/selection-ring', packRect.foot[0] - 100, packRect.foot[1] - 12, 200, 50);
    const line = model.getLine(packaging.lineId), batch = packaging.batch;
    drawPacker(r, packRect.x, packRect.y, packRect.w, packRect.h, line ? 'packaging' : 'idle',
      progress(packaging.elapsed, packaging.duration), (line == null ? undefined : line.product) || selected.product,
      (batch == null ? undefined : batch.outputLevel) || selected.outputLevel);
  } });
  if (onScreen(warehouse)) entities.push({ depth: warehouse.depth, draw() {
    if (r.factoryServiceFocus === 'warehouse') r.image('factory/selection-ring', warehouse.foot[0] - 130, warehouse.foot[1] - 10, 260, 48);
    r.factoryAsset('factory/warehouse', warehouse.x, warehouse.y, warehouse.w, warehouse.h);
    const products = layout.groups.filter(group => state.lines.some(line => line.product === group.product && line.inventory > 0));
    products.forEach((group, index) => {
      const line = state.lines.find(item => item.product === group.product && item.inventory > 0);
      r.contain('product/' + group.product + '/' + line.outputLevel,
        stockSlot.x + index * stockSlot.w / Math.max(1, products.length), stockSlot.y,
        stockSlot.w / Math.max(1, products.length), stockSlot.h);
    });
    if (journey != null && journey.completed) drawFirstStocked(r, warehouse, journey.stockProgress,
      visual.reducedMotion, { product: journey.product, outputLevel: journey.outputLevel, stockSlot });
  } });
  const construction = layout.construction;
  if (construction && onScreen(construction)) entities.push({ depth: construction.depth, draw() {
    drawBlueprint(r, construction, r.machineId(construction.product), '', { affordable: model.productConstructionOffer(construction.product).affordable });
  } });
  entities.sort((a, b) => a.depth - b.depth).forEach(entity => entity.draw());
  c.restore();
  if (overview) drawFactoryOverview(r, model, visual);
  else drawFactorySceneLabels(r, model, visual);
  drawFactoryControls(r, model, visual);
}

module.exports = { drawFactoryView };
