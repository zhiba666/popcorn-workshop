'use strict';

const { PRODUCTION_CONFIG: CONFIG, PRODUCT_DEFINITIONS } = require('../../domain/production/production-config');
const { lineProductionFeedback } = require('./production-feedback');

const COLORS = { text: '#4d2d18', muted: '#9b7c60', teal: '#237b72', cream: '#fff8e9',
  gold: '#fff0ce', goldText: '#956224', border: '#d7c3a1' };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const contains = (rect, point) => point.x >= rect.x && point.x <= rect.x + rect.w &&
  point.y >= rect.y && point.y <= rect.y + rect.h;
const intersection = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const stockText = amount => amount < 10000 ? String(amount) :
  (amount / 10000 < 10 ? (amount / 10000).toFixed(1) : Math.round(amount / 10000)) + '万';
const numberOf = line => Number(String(line.id).split('-').pop()) || 1;

function screenRect(r, rect) {
  const point = r.factoryCamera.worldToDesign(rect);
  return { x: point.x, y: point.y, w: rect.w * r.factoryCamera.zoom, h: rect.h * r.factoryCamera.zoom };
}

function workshopAnchor(r, group) {
  const anchor = group.labelAnchor || group.center || [group.x, group.y];
  return r.factoryCamera.worldToDesign(Array.isArray(anchor) ? { x: anchor[0], y: anchor[1] } : anchor);
}

function drawLeader(r, from, target) {
  const c = r.ctx;
  c.save(); c.strokeStyle = '#5b9b82aa'; c.lineWidth = 1.1;
  c.beginPath(); c.moveTo(from.x, from.y); c.lineTo(target.x, target.y); c.stroke();
  c.restore();
}

// Screen-space labels stay readable above the same scene and camera.
function drawFactoryOverview(r, model) {
  const view = r.layout.factorySceneViewport || r.layout.factoryViewport;
  const state = model.state, layout = r.factoryLayout, hits = [];
  if (!layout || !r.factoryCamera) { r.factoryOverviewHits = hits; return; }
  const bottleneck = model.productionBottleneck(), selected = model.getLine();
  const groups = layout.groups || [], nextProduct = model.nextProduct();
  const center = r.factoryCamera.worldToDesign({ x: layout.bounds.x + layout.bounds.w / 2,
    y: layout.bounds.y + layout.bounds.h / 2 }).x;
  const labels = groups.map(group => {
    const product = typeof group.product === 'string' ? group.product : group.product.id;
    const lines = state.lines.filter(line => line.product === product);
    const anchor = workshopAnchor(r, group), side = group.column === 0 || group.column === 1 ? group.column : anchor.x < center ? 0 : 1;
    const width = 86, height = 42;
    return { group, product, lines, anchor, side, rect: {
      x: clamp(anchor.x + (side ? 12 : -width - 12), view.x + 4, view.x + view.w - width - 4),
      y: clamp(anchor.y - height / 2, view.y + 64, view.y + view.h - height - 54), w: width, h: height } };
  });
  for (const side of [0, 1]) {
    const column = labels.filter(label => label.side === side).sort((a, b) => a.rect.y - b.rect.y);
    for (let index = 1; index < column.length; index++) column[index].rect.y =
      Math.max(column[index].rect.y, column[index - 1].rect.y + column[index - 1].rect.h + 4);
    if (column.length) {
      const overflow = Math.max(0, column[column.length - 1].rect.y + 42 - (view.y + view.h - 52));
      column.forEach(label => { label.rect.y -= overflow; });
    }
  }
  for (const label of labels) {
    const { product, lines, anchor, side, rect } = label;
    const built = lines.length > 0, next = product === nextProduct, active = (selected == null ? undefined : selected.product) === product;
    const problem = lines.some(line => {
      const blocked = bottleneck.blockedLineIds;
      if (blocked != null && blocked.includes(line.id)) return true;
      if (bottleneck.kind !== 'supply') return false;
      const affected = bottleneck.affectedLineIds;
      return affected == null ? undefined : affected.includes(line.id);
    });
    drawLeader(r, { x: side ? rect.x : rect.x + rect.w, y: rect.y + rect.h / 2 }, anchor);
    r.roundRect(rect.x, rect.y, rect.w, rect.h, 8,
      active ? '#e1f1df' : next || problem ? COLORS.gold : built ? COLORS.cream : '#eae7d8',
      active ? '#448d70' : next ? '#c9a05b' : COLORS.border);
    r.text(PRODUCT_DEFINITIONS[product].name, rect.x + rect.w / 2, rect.y + 13, 12,
      active ? COLORS.teal : built || next ? COLORS.text : '#9c927d', 'center', true);
    r.text(built ? lines.length + '/' + CONFIG.maxLinesPerProduct + '线' + (problem ? ' · !' : '  ›') :
      next ? '待建设  +' : '未解锁', rect.x + rect.w / 2, rect.y + 30, 11,
      problem ? COLORS.goldText : built ? COLORS.teal : COLORS.muted, 'center');
    if (built) {
      const line = lines.find(item => item.id === (selected == null ? undefined : selected.id)) ||
        lines.find(item => {
          const recent = r.factoryRecentProductLines;
          return item.id === (recent == null ? undefined : recent[product]);
        }) || lines[0];
      hits.push({ rect, hit: { type: 'factory-overview-line', lineId: line.id, product } });
    } else if (next) hits.push({ rect, hit: { type: 'factory-overview-build', product } });
  }
  const serviceY = view.y + view.h - 45, gap = 5, width = (view.w - 16 - gap * 2) / 3;
  const services = [
    { service: 'supply', title: '公共供料', detail: '余料 ' + stockText(state.shared.materials.baseUnits) },
    { service: 'packaging', title: '公共包装', detail: bottleneck.queuedBatchCount ? '排队 ' + bottleneck.queuedBatchCount + '批' : '正常流转' },
    { service: 'warehouse', title: '统一仓储', detail: '库存 ' + stockText(state.lines.reduce((sum, line) => sum + line.inventory, 0)) }
  ];
  services.forEach((service, index) => {
    const rect = { x: view.x + 8 + index * (width + gap), y: serviceY, w: width, h: 40 };
    const problem = bottleneck.kind === service.service;
    r.roundRect(rect.x, rect.y, rect.w, rect.h, 8, problem ? COLORS.gold : COLORS.cream,
      problem ? '#c9a05b' : COLORS.border);
    r.text(service.title + ' ›', rect.x + width / 2, rect.y + 12, 12, COLORS.teal, 'center', true);
    r.text(service.detail, rect.x + width / 2, rect.y + 28, 11,
      problem ? COLORS.goldText : COLORS.muted, 'center');
    hits.push({ rect: { ...rect, y: rect.y - 2, h: 44 }, hit: { type: 'factory-overview-service', service: service.service } });
  });
  r.factoryOverviewHits = hits;
}

function drawFactorySceneLabels(r, model) {
  if (r.factoryViewMode === 'overview') return;
  const layout = r.factoryLayout, selected = model.getLine(), view = r.layout.factorySceneViewport;
  if (!layout || !selected || !view) return;
  const visible = { ...view, y: view.y + 64, h: view.h - 64 };
  const scenes = layout.scenes || [], selectedScene = scenes.find(scene => scene.lineId === selected.id);
  const service = r.factoryServiceFocus;
  const serviceRects = { supply: layout.supply, packaging: layout.packaging, warehouse: layout.warehouse };
  const targetWorld = service ? serviceRects[service] :
    r.factorySelectedPart === 'cache' ? (selectedScene == null ? undefined : selectedScene.cache) :
      (selectedScene == null ? undefined : selectedScene.machine);
  if (!targetWorld) return;
  const target = screenRect(r, targetWorld);
  const targetVisible = intersection(target, visible);
  if (targetVisible < Math.min(120, target.w * target.h * .2)) return;

  for (const scene of scenes) {
    if (scene.product !== selected.product || service) continue;
    const line = model.getLine(scene.lineId), rect = screenRect(r, scene.machine);
    if (!line || intersection(rect, visible) < rect.w * rect.h * .35) continue;
    const active = line.id === selected.id;
    const x = clamp(rect.x + rect.w - 12, view.x + 20, view.x + view.w - 20), y = rect.y + 8;
    if (y < visible.y + 8 || y > view.y + view.h - 10) continue;
    r.roundRect(x - 18, y - 10, 36, 20, 6, active ? '#d9efdc' : '#fff7e7', active ? '#548f70' : '#d8c7a7');
    r.text(numberOf(line) + '号', x, y, 11, COLORS.teal, 'center', active);
    if (active) {
      const cache = screenRect(r, scene.cache);
      if (intersection(cache, visible) >= cache.w * cache.h * .5 && cache.w >= 16) {
        const cx = cache.x + cache.w / 2, cy = cache.y + cache.h + 10;
        if (cy + 9 < view.y + view.h) {
          r.roundRect(cx - 21, cy - 9, 42, 18, 5, '#fff8e9', '#a5bc92');
          r.text(numberOf(line) + '号缓存', cx, cy, 10, COLORS.teal, 'center');
        }
      }
    }
  }

  const obstacles = [...scenes.flatMap(scene => [scene.machine, scene.cache]),
    layout.supply, layout.packaging, layout.warehouse].filter(rect => rect && rect !== targetWorld)
    .map(rect => screenRect(r, rect));
  if (r.layout.factoryHome) obstacles.push(r.layout.factoryHome);
  const width = 132, height = 44, gap = 8;
  const middle = { x: target.x + target.w / 2, y: target.y + target.h / 2 };
  const candidates = [
    { x: target.x + target.w + gap, y: target.y + 24 },
    { x: target.x - width - gap, y: target.y + 24 },
    { x: middle.x - width / 2, y: target.y - height - gap },
    { x: middle.x - width / 2, y: target.y + target.h + gap }
  ].map((candidate, index) => {
    const rect = { x: clamp(candidate.x, view.x + 8, view.x + view.w - width - 8),
      y: clamp(candidate.y, visible.y + 4, view.y + view.h - height - 8), w: width, h: height };
    const overlap = obstacles.reduce((sum, obstacle) => sum + intersection(rect, obstacle), 0);
    const own = intersection(rect, target);
    return { rect, overlap, own, score: own * 100 + overlap * 4 + index };
  }).sort((a, b) => a.score - b.score);
  const placement = candidates[0];
  if (placement.overlap > 90 || placement.own > 44) return;
  const rect = placement.rect;
  drawLeader(r, { x: clamp(middle.x, rect.x, rect.x + rect.w), y: clamp(middle.y, rect.y, rect.y + rect.h) },
    { x: clamp(rect.x + rect.w / 2, target.x, target.x + target.w),
      y: clamp(rect.y + rect.h / 2, target.y, target.y + target.h) });
  r.roundRect(rect.x, rect.y, rect.w, rect.h, 8, COLORS.cream, '#7ca883');
  const title = service ? { supply: '公共供料', packaging: '公共包装', warehouse: '统一仓储' }[service] :
    PRODUCT_DEFINITIONS[selected.product].name + ' · ' + numberOf(selected) + '号' + (r.factorySelectedPart === 'cache' ? '缓存' : '线');
  const feedback = lineProductionFeedback(model.state, selected);
  const description = service ? service === 'warehouse' ? '全厂成品入库' : '所有产线共用' :
    'Lv.' + selected.outputLevel + ' · ' + (r.factorySelectedPart === 'cache' ? '本线独立缓存' : feedback.text.split(' · ')[0]);
  r.text(title, rect.x + 9, rect.y + 14, 12, COLORS.teal, 'left', true);
  r.text(description, rect.x + 9, rect.y + 31, 11, COLORS.muted);
}

function hitFactoryOverview(r, point) {
  if (r.factoryViewMode !== 'overview') return null;
  const entries = r.factoryOverviewHits || [];
  for (let index = entries.length - 1; index >= 0; index--) {
    const rect = entries[index].rect, padding = Math.max(0, (44 / (r.scale || 1) - rect.h) / 2);
    if (contains({ ...rect, y: rect.y - padding, h: rect.h + padding * 2 }, point))
      return { ...entries[index].hit, scrollable: true };
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

module.exports = { drawFactoryOverview, drawFactorySceneLabels, hitFactoryOverview, handleFactoryOverview };
