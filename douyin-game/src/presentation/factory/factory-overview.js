'use strict';

const { PRODUCTION_CONFIG: CONFIG, PRODUCT_DEFINITIONS } = require('../../domain/production/production-config');

const COLORS = { text: '#4d2d18', muted: '#9b7c60', teal: '#237b72', mint: '#e3f0d8',
  cream: '#fff6e6', gold: '#fff0ce', goldText: '#956224', border: '#d7c3a1' };
const contains = (rect, point) => point.x >= rect.x && point.x <= rect.x + rect.w &&
  point.y >= rect.y && point.y <= rect.y + rect.h;
const stockText = amount => {
  if (amount < 10000) return String(amount);
  const [unit, label] = amount >= 1e11 ? [1e12, '万亿'] : amount >= 1e7 ? [1e8, '亿'] : [1e4, '万'];
  const value = amount / unit;
  return (value < 10 ? value.toFixed(1) : Math.round(value)) + label;
};

// The overview uses its own readable composition. No scene scale or production
// state changes when moving between this map and the detailed factory.
function overviewLayout(view) {
  const inset = 6, gap = 8, width = (view.w - inset * 2 - gap) / 2;
  const serviceHeight = 54, gridTop = view.y + 70;
  const gridHeight = view.h - 124, rowGap = 6, cardHeight = (gridHeight - rowGap * 2) / 3;
  return {
    // The upper-right corner belongs to the renderer's overview/detail switch.
    supply: { x: view.x + 4, y: view.y + 3, w: view.w - 124, h: serviceHeight },
    cards: CONFIG.products.map((product, index) => ({ product,
      x: view.x + inset + index % 2 * (width + gap),
      y: gridTop + Math.floor(index / 2) * (cardHeight + rowGap), w: width, h: cardHeight })),
    packaging: { x: view.x + inset, y: view.y + view.h - 44, w: width, h: 40 },
    warehouse: { x: view.x + inset + width + gap, y: view.y + view.h - 44, w: width, h: 40 }
  };
}

function lineStatus(state, line, bottleneck) {
  const batch = line.factory;
  const cacheLoad = (line.buffer || []).reduce((sum, item) => sum + item.baseUnits, 0);
  const blocked = batch.phase === 'waiting-cache' || batch.phase === 'waiting-supply' &&
    cacheLoad + batch.baseUnits > line.cacheCapacityBaseUnits;
  if (blocked) return { label: '缓存满', problem: true };
  if (batch.phase === 'waiting-supply' && state.shared.materials.baseUnits < batch.baseUnits)
    return { label: '缺料', problem: true };
  if (batch.phase === 'waiting-supply') return { label: '待供料', problem: bottleneck.kind === 'supply' };
  if ((line.buffer || []).some(item => item.status === 'waiting')) return { label: '待包装', problem: true };
  const labels = { supply: '备料', feeding: '进料', processing: '加工', discharging: '转运',
    transport: '转运', packaging: '包装', warehouse: '入库' };
  return { label: labels[batch.phase] || '流转中', problem: false };
}

function drawService(r, rect, image, title, detail, active) {
  r.roundRect(rect.x, rect.y, rect.w, rect.h, 9, active ? COLORS.gold : COLORS.cream,
    active ? '#d5ae68' : COLORS.border);
  r.factoryAsset(image, rect.x + 5, rect.y + 2, 37, rect.h - 5);
  const compact = rect.w < 200;
  r.text(title, rect.x + 46, rect.y + (compact ? 12 : 14), 12, COLORS.text, 'left', true);
  r.text(detail, rect.x + 46, rect.y + (compact ? 29 : 29), 12,
    active ? COLORS.goldText : COLORS.teal);
  r.text('›', rect.x + rect.w - 11, rect.y + rect.h / 2, 19, active ? COLORS.goldText : COLORS.teal, 'center', true);
}

function drawBuiltWorkshop(r, state, rect, lines, bottleneck, hits) {
  const active = lines.some(line => line.id === state.selectedLineId);
  const statuses = lines.map(line => lineStatus(state, line, bottleneck));
  const problem = statuses.some(status => status.problem);
  r.roundRect(rect.x, rect.y, rect.w, rect.h, 10, active ? '#f2f6e7' : COLORS.cream,
    active ? '#479d85' : COLORS.border);
  r.roundRect(rect.x + 5, rect.y + 6, 56, 49, 9, COLORS.mint);
  r.factoryAsset('factory/' + PRODUCT_DEFINITIONS[rect.product].machineId,
    rect.x + 4, rect.y + 5, 60, 53);
  r.text(PRODUCT_DEFINITIONS[rect.product].name, rect.x + 69, rect.y + 18, 14, COLORS.text, 'left', true);
  r.text(lines.length + '/' + CONFIG.maxLinesPerProduct + ' 条产线', rect.x + 69, rect.y + 39, 12, COLORS.muted);
  if (problem) {
    r.roundRect(rect.x + rect.w - 17, rect.y + 5, 12, 12, 6, '#e6b75e');
    r.text('!', rect.x + rect.w - 11, rect.y + 11, 11, '#70471d', 'center', true);
  }
  const defaultLine = lines.find(line => line.id === state.selectedLineId) || lines[0];
  hits.push({ rect, hit: { type: 'factory-overview-line', lineId: defaultLine.id, product: rect.product } });
  // A product can have at most two lines. Both remain individually selectable
  // with a 44px-tall target; the illustrated machine selects the current line.
  const cellWidth = (rect.w - 12) / lines.length;
  lines.forEach((line, index) => {
    const status = statuses[index], x = rect.x + 6 + index * cellWidth;
    const selected = line.id === state.selectedLineId;
    const badge = { x: x + 1, y: rect.y + rect.h - 29, w: cellWidth - 3, h: 23 };
    r.roundRect(badge.x, badge.y, badge.w, badge.h, 6,
      status.problem ? COLORS.gold : selected ? '#d1e7d4' : '#eee6d6');
    const number = line.id.match(/-([1-9][0-9]*)$/)?.[1] || String(index + 1);
    r.text(number + '号·' + status.label, badge.x + badge.w / 2, badge.y + 11.5, 12,
      status.problem ? COLORS.goldText : COLORS.teal, 'center', selected);
    hits.push({ rect: { x, y: rect.y + rect.h - 44, w: cellWidth, h: 44 },
      hit: { type: 'factory-overview-line', lineId: line.id, product: rect.product } });
  });
}

function drawUnbuiltWorkshop(r, rect, nextProduct, hits) {
  const next = rect.product === nextProduct, definition = PRODUCT_DEFINITIONS[rect.product];
  r.roundRect(rect.x, rect.y, rect.w, rect.h, 10, next ? COLORS.gold : '#e9e2d4',
    next ? '#d7b778' : '#d4c9b7');
  r.ctx.save(); r.ctx.globalAlpha *= next ? .74 : .3;
  r.factoryAsset('factory/' + definition.machineId, rect.x + 4, rect.y + 5, 60, 53);
  r.ctx.restore();
  r.text(definition.name, rect.x + 69, rect.y + 18, 14, next ? COLORS.text : '#9b8c78', 'left', true);
  r.text('0/' + CONFIG.maxLinesPerProduct + ' 条产线', rect.x + 69, rect.y + 39, 12, COLORS.muted);
  if (next) {
    r.roundRect(rect.x + 7, rect.y + rect.h - 30, rect.w - 14, 24, 6, '#e6c785');
    r.text('去建设 ›', rect.x + rect.w / 2, rect.y + rect.h - 18, 13, '#714a27', 'center', true);
    hits.push({ rect, hit: { type: 'factory-overview-build', product: rect.product } });
  } else {
    const previous = CONFIG.products[CONFIG.products.indexOf(rect.product) - 1];
    r.text('先建' + PRODUCT_DEFINITIONS[previous].name + '工坊', rect.x + rect.w / 2,
      rect.y + rect.h - 18, 12, '#9b8c78', 'center');
  }
}

function drawFactoryOverview(r, model, visual) {
  const state = model.state, view = r.layout.factoryViewport, layout = overviewLayout(view);
  const bottleneck = model.productionBottleneck(), materials = state.shared.materials;
  const hits = [], nextProduct = CONFIG.products.find(product => !state.lines.some(line => line.product === product));
  r.roundRect(view.x, view.y, view.w, view.h, 12, '#e8dbbf');
  drawService(r, layout.supply, 'factory/supply-body-clean', '公共供料',
    '余料 ' + stockText(materials.baseUnits) + '/' + stockText(materials.capacityBaseUnits), bottleneck.kind === 'supply');
  hits.push({ rect: { ...layout.supply, y: view.y, h: 58 },
    hit: { type: 'factory-overview-service', service: 'supply' } });
  layout.cards.forEach(rect => {
    const lines = state.lines.filter(line => line.product === rect.product);
    if (lines.length) drawBuiltWorkshop(r, state, rect, lines, bottleneck, hits);
    else drawUnbuiltWorkshop(r, rect, nextProduct, hits);
  });
  drawService(r, layout.packaging, 'factory/packer-body-clean', '公共包装',
    bottleneck.queuedBatchCount ? '排队 ' + bottleneck.queuedBatchCount + ' 批' :
      state.shared.packaging.lineId ? '正在包装' : '暂无排队', bottleneck.kind === 'packaging');
  drawService(r, layout.warehouse, 'factory/warehouse', '仓储',
    '库存 ' + stockText(state.lines.reduce((sum, line) => sum + line.inventory, 0)), false);
  hits.push({ rect: { ...layout.packaging, h: 44 }, hit: { type: 'factory-overview-service', service: 'packaging' } });
  hits.push({ rect: { ...layout.warehouse, h: 44 }, hit: { type: 'factory-overview-service', service: 'warehouse' } });
  r.factoryOverviewHits = hits;
}

function hitFactoryOverview(r, point) {
  if (r.factoryViewMode !== 'overview') return null;
  // Later entries are the more specific line targets inside a workshop card.
  const entries = r.factoryOverviewHits || [];
  for (let index = entries.length - 1; index >= 0; index--) {
    if (contains(entries[index].rect, point)) return { ...entries[index].hit, scrollable: false };
  }
  return null;
}

function handleFactoryOverview(r, model, hit) {
  if (!hit) return null;
  if (hit.type === 'factory-overview-line' && model.getLine(hit.lineId))
    return { type: 'line', lineId: hit.lineId, factoryViewMode: 'detail', scrollable: false };
  if (hit.type === 'factory-overview-service' && ['supply', 'packaging', 'warehouse'].includes(hit.service))
    return { type: 'factory-focus-service', service: hit.service, factoryViewMode: 'detail' };
  if (hit.type === 'factory-overview-build' && model.nextProduct() === hit.product)
    return { type: 'product-construction-open', product: hit.product, scrollable: false };
  return null;
}

module.exports = { drawFactoryOverview, hitFactoryOverview, handleFactoryOverview };
