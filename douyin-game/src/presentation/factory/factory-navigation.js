'use strict';

const { PRODUCTION_CONFIG, PRODUCT_DEFINITIONS } = require('../../domain/production/production-config');

const COLORS = { text: '#4d2d18', muted: '#9b7c60', cream: '#fff6e6', teal: '#237b72' };
const NAVIGATION = { x: 19, y: 136, w: 352, h: 54, gap: 3 };
const BOTTLENECK = { x: 19, y: 190, w: 352, h: 44 };
const PREVIOUS_LINE = { x: 20, y: 711, w: 44, h: 54 };
const NEXT_LINE = { x: 326, y: 711, w: 44, h: 54 };

function within(point, rect) {
  return point.x >= rect.x && point.x <= rect.x + rect.w &&
    point.y >= rect.y && point.y <= rect.y + rect.h;
}

function rememberSelection(r, model) {
  const line = model.getLine();
  if (!r.factoryRecentProductLines) r.factoryRecentProductLines = Object.create(null);
  if (line) r.factoryRecentProductLines[line.product] = line.id;
  return line;
}

function bottleneckTarget(model, bottleneck) {
  if (bottleneck.kind === 'supply' || bottleneck.kind === 'packaging') {
    return { service: bottleneck.kind,
      label: bottleneck.kind === 'supply' ? '定位供料' : '定位包装' };
  }
  const affected = bottleneck.affectedLineIds || [], selected = model.getLine();
  const lineId = affected.includes(selected?.id) ? selected.id : affected.find(id => model.getLine(id));
  return { lineId: lineId || selected?.id, label: lineId ? '定位产线' : '回到产线' };
}

function drawLineArrow(r, rect, direction, enabled) {
  r.roundRect(rect.x, rect.y, rect.w, rect.h, 10,
    enabled ? '#e4f2e8' : '#efe5d2', enabled ? '#b6d7c5' : '#dfd0b8');
  r.text(direction < 0 ? '‹' : '›', rect.x + rect.w / 2, rect.y + rect.h * .34, 24,
    enabled ? COLORS.teal : '#baad94', 'center', true);
  r.text(direction < 0 ? '上一条' : '下一条', rect.x + rect.w / 2, rect.y + rect.h * .75, 10,
    enabled ? COLORS.teal : '#baad94', 'center');
}

function drawProductAvailability(r, rect, construction) {
  const x = rect.x + rect.w - 13, y = rect.y + 5;
  if (construction) {
    r.roundRect(x - 1, y - 1, 11, 11, 4, '#e8cc92');
    r.text('+', x + 4.5, y + 4.5, 12, '#80581f', 'center', true);
    return;
  }
  const c = r.ctx;
  c.save(); c.strokeStyle = '#ac9d86'; c.lineWidth = 1.3;
  c.beginPath(); c.arc(x + 4, y + 4, 2.7, Math.PI, 0); c.stroke();
  r.roundRect(x, y + 4, 8, 6, 1.5, '#ac9d86');
  c.restore();
}

// Fixed navigation uses design coordinates; scene movement and zoom never move
// these controls. Only the model owns the currently selected production line.
function drawFactoryNavigation(r, model, visual = {}) {
  const selected = rememberSelection(r, model);
  if (!selected) { r.factoryNavigationUI = null; return; }
  const layout = r.layout || {};
  const navigation = { ...NAVIGATION, ...layout.factoryProducts };
  const bottleneckRect = { ...BOTTLENECK, ...layout.factoryBottleneck };
  const previousRect = { ...PREVIOUS_LINE, ...layout.factoryPrev };
  const nextRect = { ...NEXT_LINE, ...layout.factoryNext };
  const lines = model.state.lines, nextProduct = model.nextProduct();
  const bottleneck = model.productionBottleneck(), target = bottleneckTarget(model, bottleneck);
  const packaging = visual.factoryPresentation?.packaging || {};
  let bottleneckText = bottleneck.text;
  if (packaging.cleared) bottleneckText = '包装积压已消除，产线恢复流转';
  else if (packaging.recovering) bottleneckText = packaging.pending ? '本轮包装结束后提速' :
    '包装提速中 · 待包装 ' + bottleneck.queuedBatchCount + ' 批';
  const stripHeight = Math.min(32, bottleneckRect.h), stripY = bottleneckRect.y + (bottleneckRect.h - stripHeight) / 2;
  r.roundRect(bottleneckRect.x, stripY, bottleneckRect.w, stripHeight, 8, COLORS.cream, '#e6d8bf');
  r.text(bottleneckText, bottleneckRect.x + 9, bottleneckRect.y + bottleneckRect.h / 2, 13,
    ['supply', 'packaging'].includes(bottleneck.kind) || packaging.recovering || packaging.cleared ? COLORS.teal : COLORS.muted);
  r.text(target.label + ' ›', bottleneckRect.x + bottleneckRect.w - 10,
    bottleneckRect.y + bottleneckRect.h / 2, 13, COLORS.teal, 'right', true);

  const width = (navigation.w - navigation.gap * (PRODUCTION_CONFIG.products.length - 1)) /
    PRODUCTION_CONFIG.products.length;
  const products = PRODUCTION_CONFIG.products.map((product, index) => {
    const productLines = lines.filter(line => line.product === product);
    const built = productLines.length > 0, construction = !built && product === nextProduct;
    const active = r.productConstructionDialogOpen ? r.productConstructionProduct === product : selected.product === product;
    const rect = { x: navigation.x + index * (width + navigation.gap), y: navigation.y, w: width, h: navigation.h };
    r.roundRect(rect.x, rect.y, rect.w, rect.h, 9,
      active ? '#d7efdf' : built ? COLORS.cream : construction ? '#f8ecd1' : '#ece2d1',
      active ? '#3d9a80' : construction ? '#d4b771' : '#dacbb2');
    const recent = productLines.find(line => line.id === r.factoryRecentProductLines[product]) || productLines[0];
    r.contain('product/' + product + '/' + (recent?.outputLevel || 1), rect.x + (rect.w - 22) / 2,
      rect.y + 4, 22, 22, built || construction ? 1 : .35);
    r.text(PRODUCT_DEFINITIONS[product].name, rect.x + rect.w / 2, rect.y + rect.h - 13, 12,
      active ? COLORS.teal : built || construction ? COLORS.text : '#aa9b82', 'center', active);
    if (!built) drawProductAvailability(r, rect, construction);
    return { rect, product, built, construction };
  });
  const sceneLines = PRODUCTION_CONFIG.products.flatMap(product => lines.filter(line => line.product === product));
  const selectedIndex = sceneLines.findIndex(line => line.id === selected.id);
  const previous = selectedIndex > 0 ? sceneLines[selectedIndex - 1].id : null;
  const next = selectedIndex + 1 < sceneLines.length ? sceneLines[selectedIndex + 1].id : null;
  drawLineArrow(r, previousRect, -1, !!previous);
  drawLineArrow(r, nextRect, 1, !!next);
  r.factoryNavigationUI = { products, bottleneck, target, bottleneckRect, previousRect, nextRect,
    selectedLineId: selected.id, previous, next };
}

function hitFactoryNavigation(r, point) {
  const ui = r.factoryNavigationUI;
  if (!ui || r.page !== 'factory') return null;
  if (within(point, ui.bottleneckRect)) return { type: 'factory-bottleneck',
    kind: ui.bottleneck.kind, service: ui.target.service, lineId: ui.target.lineId };
  const item = ui.products.find(product => within(point, product.rect));
  if (item) return item.built || item.construction ? { type: 'factory-product', product: item.product } : null;
  if (ui.previous && within(point, ui.previousRect)) return { type: 'factory-line-prev',
    lineId: ui.previous, fromLineId: ui.selectedLineId };
  if (ui.next && within(point, ui.nextRect)) return { type: 'factory-line-next',
    lineId: ui.next, fromLineId: ui.selectedLineId };
  return null;
}

function focusSelectedLine(r, model, lineId) {
  const result = model.selectLine(lineId);
  if (!result.ok) return null;
  rememberSelection(r, model);
  r.factoryFollowCancelled = true;
  r.pendingFactoryServiceFocus = null;
  if (typeof r.focusLine === 'function') r.focusLine(lineId);
  return result;
}

function handleFactoryNavigation(r, model, hit) {
  if (!hit || !hit.type?.startsWith('factory-')) return null;
  rememberSelection(r, model);
  if (hit.type === 'factory-product') {
    const lines = model.state.lines.filter(line => line.product === hit.product);
    if (lines.length) {
      const line = lines.find(item => item.id === r.factoryRecentProductLines[hit.product]) || lines[0];
      return focusSelectedLine(r, model, line.id);
    }
    // Opening the next construction offer never spends currency. Later products
    // remain locked until their preceding workshop exists.
    if (hit.product === model.nextProduct()) return { ok: true, action: 'product-construction-open', product: hit.product };
    return null;
  }
  if (hit.type === 'factory-line-prev' || hit.type === 'factory-line-next') {
    if (hit.fromLineId !== model.state.selectedLineId) return null;
    return focusSelectedLine(r, model, hit.lineId);
  }
  if (hit.type === 'factory-bottleneck') {
    // Keep the destination the player actually pressed even if production
    // advances to another phase between the pointer's down and up frames.
    const target = { service: ['supply', 'packaging'].includes(hit.service) ? hit.service : null,
      lineId: model.getLine(hit.lineId)?.id };
    r.factoryFollowCancelled = true;
    if (target.service) {
      if (typeof r.stopFactoryScroll === 'function') r.stopFactoryScroll();
      r.pendingFactoryServiceFocus = target.service;
      return { ok: true, action: 'factory-focus', service: target.service,
        bottleneckKind: hit.kind };
    }
    return target.lineId ? focusSelectedLine(r, model, target.lineId) : null;
  }
  return null;
}

module.exports = { drawFactoryNavigation, hitFactoryNavigation, handleFactoryNavigation };
