'use strict';

const { drawMachine, drawSupply, drawPacker } = require('./factory-animation');
const { buildFactoryLayout } = require('./factory-layout');
const { createEntryLayout, entryHitTest, drawEntry } = require('./entry-scene');

const DESIGN_WIDTH = 390;
const DESIGN_HEIGHT = 844;
const DESIGN_TOP_SPACE = 40;
const DESIGN_BOTTOM_SPACE = 13;
const COLORS = { text: '#4d2d18', muted: '#9b7c60', cream: '#fff6e6', teal: '#237b72', red: '#ba3843' };
const PRODUCT_NAMES = { original: '原味', caramel: '焦糖' };
const MACHINE_IDS = { original: 'air-popper', caramel: 'caramel-drum' };
const displaySeconds = value => Math.round(value * 100) / 100;
const sharedSeconds = value => Number(Number(value).toFixed(3));
const lineNumber = id => Number(String(id).split('-').pop()) || 1;
const displayStock = value => {
  if (value < 10000) return String(value);
  const [unit, suffix] = value >= 1e11 ? [1e12, '万亿'] : value >= 1e7 ? [1e8, '亿'] : [1e4, '万'];
  const amount = value / unit;
  return (amount < 10 ? amount.toFixed(1) : Math.round(amount)) + suffix;
};
const PHASE_LABELS = { 'waiting-supply': '待供料', 'waiting-cache': '缓存已满', supply: '供料准备', feeding: '输送进料', processing: '加工中', discharging: '出料到缓存', transport: '送往缓存', 'waiting-packaging': '待包装', packaging: '包装成品', warehouse: '入库' };
const productionLabel = line => line.factory.phase === 'waiting-supply' &&
  (line.buffer || []).reduce((sum, batch) => sum + batch.baseUnits, 0) + line.factory.baseUnits > line.cacheCapacityBaseUnits ?
  PHASE_LABELS['waiting-cache'] : PHASE_LABELS[line.factory.phase];

// Canvas-only presentation: the model owns production, stock, orders and saves.
class Renderer {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.assets = assets;
    this.entryOpen = true;
    this.entrySettingsOpen = false;
    this.page = 'board';
    this.upgradeDialogOpen = false;
    this.capacityBuyEnabled = false;
    this.outputBuyEnabled = false;
    this.upgradeLineId = null;
    this.sharedUpgradeDialogOpen = false;
    this.sharedUpgradeFocus = null;
    this.sharedBuyEnabled = { supply: false, packaging: false };
    this.sharedUpgradeLevels = { supply: 1, packaging: 1 };
    this.offlineSummaryOpen = false;
    this.lineExpansionDialogOpen = false;
    this.lineExpansionProduct = null;
    this.lineExpansionBuyEnabled = false;
    this.factoryScroll = 0;
    this.factoryLayout = null;
    this.factoryLineKey = '';
    this.lastFactorySelection = null;
    this.pendingFactoryFocus = null;
    this.visibleOrderId = null;
    this.orderPreviousEnabled = false;
    this.orderNextEnabled = false;
    this.orderDeliverEnabled = false;
    this.setViewport(390, 844);
  }

  setViewport(width, height, safeTop = 0, safeBottom = 0, menuBounds = null) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.safeTop = Math.max(0, safeTop || 0);
    this.safeBottom = Math.max(0, safeBottom || 0);
    this.menuBounds = menuBounds;
    // The design already reserves space above the title and below navigation.
    // Reuse it for native safe areas instead of applying both sets of insets.
    this.scale = Math.min(this.width / DESIGN_WIDTH, this.height / DESIGN_HEIGHT,
      Math.max(1, this.height - this.safeTop - this.safeBottom) / (DESIGN_HEIGHT - DESIGN_TOP_SPACE - DESIGN_BOTTOM_SPACE));
    this.offsetX = (this.width - DESIGN_WIDTH * this.scale) / 2;
    const minY = this.safeTop - DESIGN_TOP_SPACE * this.scale;
    const maxY = this.height - this.safeBottom - (DESIGN_HEIGHT - DESIGN_BOTTOM_SPACE) * this.scale;
    this.offsetY = Math.max(minY, Math.min(maxY, (this.height - DESIGN_HEIGHT * this.scale) / 2));
    this.layout = {
      board: { x: 34, y: 247, pitch: 46, size: 43, columns: 7, rows: 9 },
      orderArea: { x: 19, y: 119, w: 352, h: 98 },
      orderPrev: { x: 21, y: 167, w: 28, h: 44 },
      orderNext: { x: 341, y: 167, w: 28, h: 44 },
      orderPrevHit: { x: 19, y: 164, w: 44, h: 53 },
      orderNextHit: { x: 327, y: 164, w: 44, h: 53 },
      deliver: { x: 232, y: 168, w: 94, h: 43 },
      discard: { x: 287, y: 698, w: 73, h: 45 },
      factoryNav: { x: 19, y: 779, w: 169, h: 52 },
      boardNav: { x: 202, y: 779, w: 169, h: 52 },
      accelerate: { x: 103, y: 719, w: 64, h: 48 },
      upgradeOpen: { x: 174, y: 719, w: 108, h: 48 },
      lineExpansionOpen: { x: 289, y: 719, w: 68, h: 48 },
      factoryViewport: { x: 19, y: 273, w: 352, h: 383 },
      sharedUpgradeOpen: { x: 265, y: 223, w: 98, h: 44 },
      sharedUpgradePanel: { x: 27, y: 166, w: 336, h: 574 },
      sharedUpgradeTitle: { x: 91, y: 146, w: 208, h: 54 },
      sharedUpgradeClose: { x: 303, y: 174, w: 44, h: 44 },
      sharedSupplyCard: { x: 42, y: 240, w: 306, h: 215 },
      sharedPackagingCard: { x: 42, y: 467, w: 306, h: 215 },
      sharedSupplyBuy: { x: 55, y: 384, w: 280, h: 48 },
      sharedPackagingBuy: { x: 55, y: 611, w: 280, h: 48 },
      lineExpansionPanel: { x: 27, y: 182, w: 336, h: 535 },
      lineExpansionClose: { x: 305, y: 190, w: 44, h: 44 },
      lineExpansionBuy: { x: 61, y: 628, w: 268, h: 48 },
      upgradePanel: { x: 14, y: 123, w: 362, h: 708 },
      upgradeTitle: { x: 90, y: 102, w: 210, h: 54 },
      upgradeClose: { x: 331, y: 124, w: 44, h: 44 },
      capacityCard: { x: 28, y: 252, w: 334, h: 205 },
      outputCard: { x: 28, y: 469, w: 334, h: 336 },
      capacityBuy: { x: 41, y: 383, w: 308, h: 44 },
      outputBuy: { x: 41, y: 723, w: 308, h: 44 },
      offlinePanel: { x: 27, y: 246, w: 336, h: 360 },
      offlineClose: { x: 61, y: 536, w: 268, h: 48 },
    };
    const orderArrowWidth = Math.max(44, 44 / this.scale);
    const orderArrowHeight = Math.min(this.layout.orderArea.h, Math.max(53, 44 / this.scale));
    this.layout.orderPrevHit = { x: 19, y: 217 - orderArrowHeight, w: orderArrowWidth, h: orderArrowHeight };
    this.layout.orderNextHit = { x: 371 - orderArrowWidth, y: 217 - orderArrowHeight, w: orderArrowWidth, h: orderArrowHeight };
    this.layout.deliver.w = Math.max(52, Math.min(94, this.layout.orderNextHit.x - this.layout.deliver.x - 2));
    createEntryLayout(this);
  }

  logicalPoint(x, y) { return { x: (x - this.offsetX) / this.scale, y: (y - this.offsetY) / this.scale }; }
  screenPoint(x, y) { return { x: this.offsetX + x * this.scale, y: this.offsetY + y * this.scale }; }

  hitTest(x, y) {
    if (this.entryOpen) return entryHitTest(this, x, y);
    const p = this.logicalPoint(x, y);
    const within = r => p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h;
    const minimumHitArea = r => {
      const px = Math.max(0, (44 / this.scale - r.w) / 2), py = Math.max(0, (44 / this.scale - r.h) / 2);
      return within({ x: r.x - px, y: r.y - py, w: r.w + px * 2, h: r.h + py * 2 });
    };
    if (this.offlineSummaryOpen) {
      return minimumHitArea(this.layout.offlineClose) ? { type: 'offline-close' } : null;
    }
    if (this.sharedUpgradeDialogOpen) {
      if (minimumHitArea(this.layout.sharedUpgradeClose)) return { type: 'shared-upgrade-close' };
      for (const service of ['supply', 'packaging']) {
        const button = this.layout[service === 'supply' ? 'sharedSupplyBuy' : 'sharedPackagingBuy'];
        if (minimumHitArea(button)) return this.sharedBuyEnabled[service] ?
          { type: 'shared-upgrade-buy', service, level: this.sharedUpgradeLevels[service] } : null;
      }
      if (!within(this.layout.sharedUpgradePanel) && !within(this.layout.sharedUpgradeTitle)) return { type: 'shared-upgrade-close' };
      return null;
    }
    if (this.lineExpansionDialogOpen) {
      if (minimumHitArea(this.layout.lineExpansionClose)) return { type: 'line-expansion-close' };
      if (minimumHitArea(this.layout.lineExpansionBuy)) return this.lineExpansionBuyEnabled ?
        { type: 'line-expansion-buy', product: this.lineExpansionProduct } : null;
      if (!within(this.layout.lineExpansionPanel)) return { type: 'line-expansion-close' };
      return null;
    }
    if (this.upgradeDialogOpen) {
      const touchTarget = r => {
        const padding = Math.max(0, (44 / this.scale - r.h) / 2);
        return within({ x: r.x - padding, y: r.y - padding, w: r.w + padding * 2, h: r.h + padding * 2 });
      };
      if (touchTarget(this.layout.upgradeClose)) return { type: 'upgrade-close' };
      if (touchTarget(this.layout.capacityBuy)) return this.capacityBuyEnabled ? { type: 'capacity-buy', lineId: this.upgradeLineId } : null;
      if (touchTarget(this.layout.outputBuy)) return this.outputBuyEnabled ? { type: 'output-buy', lineId: this.upgradeLineId } : null;
      if (!within(this.layout.upgradePanel) && !within(this.layout.upgradeTitle)) return { type: 'upgrade-close' };
      return null;
    }
    if (within(this.layout.factoryNav)) return { type: 'page', page: 'factory' };
    if (within(this.layout.boardNav)) return { type: 'page', page: 'board' };
    if (within(this.layout.orderArea)) {
      const orderId = this.visibleOrderId;
      if (within(this.layout.orderPrevHit) && this.orderPreviousEnabled) return { type: 'order-prev', orderId };
      if (within(this.layout.orderNextHit) && this.orderNextEnabled) return { type: 'order-next', orderId };
      if (within(this.layout.deliver) && this.orderDeliverEnabled) return { type: 'deliver', orderId };
      return { type: 'order-swipe', orderId };
    }
    if (this.page === 'factory' && minimumHitArea(this.layout.upgradeOpen)) return { type: 'upgrade-open' };
    if (this.page === 'factory' && minimumHitArea(this.layout.accelerate)) return { type: 'accelerate' };
    if (this.page === 'factory' && minimumHitArea(this.layout.lineExpansionOpen)) {
      return { type: 'line-expansion-open', product: this.factorySelectedProduct, scrollable: false };
    }
    if (this.page === 'factory' && minimumHitArea(this.layout.sharedUpgradeOpen)) {
      return { type: 'shared-upgrade-open' };
    }
    if (this.page === 'factory') {
      if (within(this.layout.factoryViewport) && this.factoryLayout) {
        const world = { x: p.x, y: p.y - this.layout.factoryViewport.y + this.factoryScroll };
        const worldWithin = r => world.x >= r.x && world.x <= r.x + r.w && world.y >= r.y && world.y <= r.y + r.h;
        if (worldWithin({ ...this.factoryLayout.supply, h: this.factoryLayout.supply.h + 30 })) {
          return { type: 'shared-upgrade-open', service: 'supply', scrollable: true };
        }
        if (worldWithin({ ...this.factoryLayout.packaging, x: this.factoryLayout.packaging.x - 3,
          w: this.factoryLayout.packaging.w + 3, h: this.factoryLayout.packaging.h + 48 })) {
          return { type: 'shared-upgrade-open', service: 'packaging', scrollable: true };
        }
        const scene = this.factoryLayout.scenes.find(scene => worldWithin(scene.hit));
        if (scene) return { type: 'line', lineId: scene.lineId, scrollable: true };
        const slot = this.factoryLayout.slots.find(worldWithin);
        if (slot) return { type: 'line-expansion-open', product: slot.product, scrollable: true };
        return { type: 'factory-scroll', scrollable: true };
      }
    }
    if (this.page === 'board') {
      if (within(this.layout.discard)) return { type: 'discard' };
      const b = this.layout.board;
      const col = Math.floor((p.x - b.x) / b.pitch);
      const row = Math.floor((p.y - b.y) / b.pitch);
      if (col >= 0 && col < b.columns && row >= 0 && row < b.rows) return { type: 'cell', index: row * b.columns + col };
    }
    return null;
  }

  cellRect(index) {
    const b = this.layout.board;
    return { x: b.x + (index % 7) * b.pitch, y: b.y + Math.floor(index / 7) * b.pitch, w: b.size, h: b.size };
  }

  begin() {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#e8d7bd';
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const dpr = this.canvas.width / this.width;
    c.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, dpr * this.offsetX, dpr * this.offsetY);
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    c.globalAlpha = 1;
  }

  image(id, x, y, w, h, alpha = 1) {
    const img = this.assets && this.assets.get(id);
    if (!img) return false;
    const c = this.ctx;
    c.save();
    c.globalAlpha *= alpha;
    c.drawImage(img, x, y, w, h);
    c.restore();
    return true;
  }

  contain(id, x, y, w, h, alpha = 1) {
    const img = this.assets && this.assets.get(id);
    if (!img) return false;
    const meta = this.assets.meta(id) || {};
    const size = meta.size || [img.width, img.height];
    const ratio = Math.min(w / size[0], h / size[1]);
    return this.image(id, x + (w - size[0] * ratio) / 2, y + (h - size[1] * ratio) / 2, size[0] * ratio, size[1] * ratio, alpha);
  }

  slice(id, x, y, w, h, alpha = 1) {
    const img = this.assets && this.assets.get(id);
    if (!img) return false;
    const m = this.assets.meta(id) || {};
    const n = m.nineSlice;
    if (!n) return this.image(id, x, y, w, h, alpha);
    const size = m.size || [img.width, img.height];
    const sw = img.width || size[0], sh = img.height || size[1];
    const ns = m.nineSliceSize || size;
    const l = n.left * sw / ns[0], r = n.right * sw / ns[0];
    const t = n.top * sh / ns[1], b = n.bottom * sh / ns[1];
    const k = Math.min(w / sw, h / sh, n.maxBorderScale === undefined ? 1 : n.maxBorderScale);
    const dx = [x, x + l * k, x + w - r * k, x + w];
    const dy = [y, y + t * k, y + h - b * k, y + h];
    const sx = [0, l, sw - r, sw], sy = [0, t, sh - b, sh];
    const c = this.ctx;
    c.save();
    c.globalAlpha *= alpha;
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
      if (sx[col + 1] > sx[col] && sy[row + 1] > sy[row] && dx[col + 1] > dx[col] && dy[row + 1] > dy[row]) {
        c.drawImage(img, sx[col], sy[row], sx[col + 1] - sx[col], sy[row + 1] - sy[row], dx[col], dy[row], dx[col + 1] - dx[col], dy[row + 1] - dy[row]);
      }
    }
    c.restore();
    return true;
  }

  roundRect(x, y, w, h, radius, fill, stroke) {
    const c = this.ctx, r = Math.min(radius, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.stroke(); }
  }

  text(value, x, y, size = 14, color = COLORS.text, align = 'left', bold = false) {
    const c = this.ctx;
    c.font = (bold ? 'bold ' : '') + size + 'px "PingFang SC", "Microsoft YaHei", sans-serif';
    c.fillStyle = color; c.textAlign = align; c.textBaseline = 'middle';
    c.fillText(String(value), x, y);
  }

  badge(value, x, y, w = 22, fill = '#765238', size = 11) {
    this.roundRect(x, y, w, 17, 5, fill);
    this.text(value, x + w / 2, y + 8.5, size, COLORS.cream, 'center', true);
  }

  productName(product) { return PRODUCT_NAMES[product] || PRODUCT_NAMES.original; }

  lineName(line) {
    const number = line.id.match(/-([1-9][0-9]*)$/);
    return this.productName(line.product) + ' · ' + (number ? number[1] : '1') + '号线';
  }

  itemAsset(item) { return item.kind + '/' + (item.product || 'original') + '/' + item.level; }

  itemLine(state, item) {
    const lines = state.lines || [], selected = lines.find(line => line.id === state.selectedLineId);
    if (item && item.kind === 'launcher') return lines.find(line => line.id === item.lineId);
    return item && (!selected || selected.product !== item.product) ?
      lines.find(line => line.product === item.product) : selected;
  }

  button(id, label, r, enabled = true, icon) {
    const c = this.ctx;
    c.save(); c.globalAlpha = enabled ? 1 : 0.48;
    this.slice(id, r.x, r.y, r.w, r.h);
    const center = r.x + r.w / 2;
    if (icon) this.contain(icon, center - 29, r.y + 12, 18, 18);
    this.text(label, center + (icon ? 10 : 0), r.y + r.h / 2 - 1, 15, COLORS.cream, 'center', true);
    c.restore();
  }

  background(factory) {
    this.ctx.fillStyle = '#f1e8d8'; this.ctx.fillRect(0, 0, 390, 844);
    this.image('ui/background-table', 0, 196, 390, 648);
    this.image('ui/background-room', 0, 0, 390, 150);
    if (factory) {
      this.ctx.save();
      this.roundRect(19, 235, 352, 432, 15, '#efe0c7'); this.ctx.clip();
      this.image('factory/floor', 19, 235, 352, 432);
      this.image('factory/wall-back', 19, 232, 352, 113, 0.85);
      this.image('factory/wall-left', 17, 234, 37, 434, 0.9);
      this.ctx.restore();
    }
  }

  header(state) {
    this.contain('ui/title-sign', 17, 41, 159, 67);
    this.text(state.page === 'factory' ? '工 厂' : '棋 盘', 96.5, 83, 26, COLORS.cream, 'center', true);
    const menu = this.menuBounds;
    const overlapsWallet = menu && menu.left < this.offsetX + 372 * this.scale &&
      menu.right > this.offsetX + 226 * this.scale;
    const walletY = overlapsWallet ? Math.max(68, Math.min(81, (menu.bottom - this.offsetY) / this.scale + 4)) : 68;
    this.slice('ui/currency-pill', 226, walletY, 146, 35);
    this.contain('icon/coin', 226, walletY - 4, 40, 40);
    this.text(Number(state.coins || 0).toLocaleString('en-US'), 313, walletY + 16, 18, COLORS.text, 'center', true);
  }

  order(model, visual = {}) {
    const state = model.state, focused = model.getOrder();
    const orders = state.orders, index = orders.findIndex(order => order.id === focused.id);
    this.visibleOrderId = focused.id;
    this.orderPreviousEnabled = index > 0;
    this.orderNextEnabled = index < orders.length - 1;
    this.orderDeliverEnabled = model.orderReady(focused.id);
    const g = visual.gesture || {}, area = this.layout.orderArea, spacing = area.w + 12;
    let dx = g.orderDragging && g.hit && g.hit.orderId === focused.id ? (g.x - g.startX) / this.scale : 0;
    dx = Math.max(-spacing, Math.min(spacing, dx));
    if ((index === 0 && dx > 0) || (index === orders.length - 1 && dx < 0)) dx = Math.max(-34, Math.min(34, dx));
    this.ctx.save();
    this.ctx.beginPath(); this.ctx.rect(area.x, area.y, area.w, area.h); this.ctx.clip();
    this.orderCard(model, focused, index, orders.length, dx);
    if (dx > 0 && index > 0) this.orderCard(model, orders[index - 1], index - 1, orders.length, dx - spacing);
    if (dx < 0 && index < orders.length - 1) this.orderCard(model, orders[index + 1], index + 1, orders.length, dx + spacing);
    this.ctx.restore();
  }

  orderCard(model, order, index, total, offset = 0) {
    const progress = model.orderProgress(order.id), requirements = progress.requirements;
    const serviceCount = model.customerServiceCount('rabbit-courier');
    this.ctx.save(); this.ctx.translate(offset, 0);
    const area = this.layout.orderArea;
    this.slice('ui/panel-cream', area.x, area.y, area.w, area.h);
    this.slice('ui/portrait-well', 51, 126, 50, 81);
    this.contain('customer/rabbit-courier', 51, 124, 50, 83);
    this.text('兔快递员', 109, 135, 14, COLORS.text, 'left', true);
    this.text('已服务' + displayStock(serviceCount) + '次', 109, 149, 11, COLORS.muted);
    requirements.forEach((requirement, itemIndex) => {
      const found = requirement.boardUnits === 1;
      const x = requirements.length === 1 ? 136 : 109 + itemIndex * 62;
      this.contain('product/' + requirement.product + '/' + requirement.level, x, 155, 47, 45);
      this.badge(requirement.level, x + 30, 179, 17, '#765238', 10);
      if (found) this.contain('icon/check', x - 2, 178, 17, 17);
      this.text((found ? '1' : '0') + '/1', x + 24, 207, 13, found ? COLORS.teal : COLORS.text, 'center', true);
    });
    this.ctx.strokeStyle = '#deccb3'; this.ctx.lineWidth = 1;
    this.ctx.beginPath(); this.ctx.moveTo(228, 128); this.ctx.lineTo(228, 207); this.ctx.stroke();
    this.contain('icon/coin', 236, 130, 24, 24);
    this.text('+' + order.reward, 264, 143, 17, COLORS.text, 'left', true);
    this.roundRect(328, 127, 33, 24, 7, '#e5d8bc');
    this.text((index + 1) + '/' + total, 344.5, 139, 12, COLORS.text, 'center', true);
    const status = progress.ready ? '交付' : progress.status === 'materials-ready' ? '材料够' : '待备料';
    this.button('ui/button-teal', status, this.layout.deliver, progress.ready);
    for (const [direction, enabled] of [['Prev', index > 0], ['Next', index < total - 1]]) {
      const r = this.layout['order' + direction];
      this.roundRect(r.x, r.y, r.w, r.h, 8, enabled ? '#d5c6a8' : '#e9dec8');
      this.text(direction === 'Prev' ? '‹' : '›', r.x + r.w / 2, r.y + r.h / 2 - 1, 31,
        enabled ? COLORS.teal : '#c0b49c', 'center', true);
    }
    this.ctx.restore();
  }

  item(item, r, inventory, alpha = 1) {
    if (!item) return;
    this.contain(this.itemAsset(item), r.x + 1, r.y - 1, r.w - 2, r.h + 1, alpha);
    const c = this.ctx; c.save(); c.globalAlpha *= alpha;
    if (item.kind === 'launcher') {
      this.badge('L' + item.level, r.x + r.w - 20, r.y, 20, '#235e52', 10);
      this.badge(lineNumber(item.lineId) + '号', r.x, r.y + r.h - 15, 18, '#235e52', 8);
      const stock = inventory >= 1000000 ? Math.floor(inventory / 1000000) + 'm' : inventory >= 1000 ? Math.floor(inventory / 1000) + 'k' : inventory;
      this.badge(stock, r.x + r.w - 23, r.y + r.h - 15, 23, '#1b5063', String(stock).length > 3 ? 8 : 10);
    } else this.badge(item.level, r.x + r.w - 18, r.y + r.h - 15, 18, '#765238', 10);
    c.restore();
  }

  board(model, visual) {
    const s = model.state, board = s.board;
    const selected = board[s.selectedCell];
    const g = visual.gesture || {};
    const dragging = !!(g.dragging || g.isDragging);
    const sourceIndex = g.sourceIndex === undefined ? (g.from === undefined ? g.index : g.from) : g.sourceIndex;
    const supplyLine = model.getLine();
    this.text(this.lineName(supplyLine) + '库存 ' + displayStock(supplyLine.inventory) +
      ' · 出厂 Lv.' + supplyLine.outputLevel, 195, 226, 12, COLORS.muted, 'center');
    this.slice('ui/board-frame', 19, 236, 352, 438);
    let suggestedKey = null;
    if (!selected || selected.kind !== 'product') {
      const counts = {};
      board.forEach(item => {
        if (item && item.kind === 'product' && item.level < 5) {
          const key = item.product + '/' + item.level;
          counts[key] = (counts[key] || 0) + 1;
        }
      });
      suggestedKey = Object.keys(counts).find(key => counts[key] > 1);
    }
    board.forEach((item, index) => {
      const r = this.cellRect(index);
      this.slice('ui/board-cell', r.x, r.y, r.w, r.h);
      if (item && item.kind === 'product' && s.order.requirements.some(requirement =>
        requirement.product === item.product && requirement.level === item.level)) this.contain('board-state/cell-order-match', r.x - 4, r.y - 4, r.w + 8, r.h + 8);
      if (item && item.kind === 'product' && item.level < 5 && ((selected && selected.kind === 'product' &&
        selected.product === item.product && selected.level === item.level && index !== s.selectedCell) || suggestedKey === item.product + '/' + item.level)) {
        this.contain('board-state/cell-mergeable', r.x - 4, r.y - 4, r.w + 8, r.h + 8, 0.82);
      }
      if (index === s.selectedCell) this.contain('board-state/cell-selected', r.x - 4, r.y - 4, r.w + 8, r.h + 8);
      const flying = (visual.effects || []).some(e => e.type === 'launch' && e.index === index && item && item.id === e.itemId &&
        (visual.time || 0) - e.startedAt < e.duration);
      const line = this.itemLine(s, item);
      if (!flying) this.item(item, r, line ? line.inventory : 0, dragging && index === sourceIndex ? 0.25 : 1);
    });
    if (dragging && board[sourceIndex] && typeof g.x === 'number' && typeof g.y === 'number') {
      const p = this.logicalPoint(g.x, g.y);
      const hit = this.hitTest(g.x, g.y);
      if (hit && hit.type === 'cell' && hit.index !== sourceIndex) {
        const target = board[hit.index], from = board[sourceIndex];
        const valid = !target || (from.kind === 'product' && target.kind === 'product' &&
          from.product === target.product && from.level === target.level && from.level < 5);
        const r = this.cellRect(hit.index);
        this.contain(valid ? 'effect/focus-ring' : 'effect/invalid-target', r.x - 5, r.y - 5, r.w + 10, r.h + 10);
      }
      this.ctx.save(); this.ctx.shadowColor = '#4d2d1866'; this.ctx.shadowBlur = 10; this.ctx.shadowOffsetY = 3;
      const line = this.itemLine(s, board[sourceIndex]);
      this.item(board[sourceIndex], { x: p.x - 24, y: p.y - 28, w: 48, h: 48 }, line ? line.inventory : 0);
      this.ctx.restore();
    }
    this.details(s, selected);
  }

  details(state, item) {
    this.slice('ui/panel-cream', 19, 684, 352, 79);
    this.slice('ui/portrait-well', 29, 693, 61, 60);
    this.contain(item ? this.itemAsset(item) : 'icon/popcorn', 34, 695, 50, 55);
    const isLauncher = item && item.kind === 'launcher';
    const line = this.itemLine(state, item);
    const name = this.productName(item ? item.product : line && line.product);
    this.text(item ? (isLauncher ? name + ' · ' + lineNumber(item.lineId) + '号发射器' : name + ' · Lv.' + item.level) : '爆米花工厂', 101, 708, 14, COLORS.text, 'left', true);
    let subtitle = '点发射器取货，拖动同级合成';
    if (isLauncher && line) subtitle = '出厂 Lv.' + line.outputLevel + ' · 库存 ' + line.inventory;
    else if (item) {
      const matches = state.order.requirements.some(requirement => requirement.product === item.product && requirement.level === item.level);
      subtitle = matches ? '棋盘成品可交付' : item.level === 5 ? '本轮最高等级' : '同种同级二合一，可跨线合成';
    }
    this.text(subtitle, 101, 733, 11, COLORS.muted);
    this.button('ui/button-red', '丢弃', this.layout.discard, !!item && !isLauncher, 'icon/trash');
  }

  // Belts only visualize the model's current transfer; they do not advance stock.
  belt(points) {
    const c = this.ctx;
    c.save(); c.lineJoin = 'round'; c.lineCap = 'round';
    [ [18, '#bfaa83'], [13, '#245c60'], [8, '#3f8883'] ].forEach(style => {
      c.lineWidth = style[0]; c.strokeStyle = style[1]; c.beginPath();
      points.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke();
    });
    c.restore();
  }

  transfer(points, progress, id = 'factory/loose-popcorn', size = 20) {
    const lengths = []; let total = 0;
    for (let i = 1; i < points.length; i++) { const l = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]); lengths.push(l); total += l; }
    const at = Math.max(0, Math.min(1, progress)) * total;
    let distance = at;
    for (let i = 0; i < lengths.length; i++) {
      if (distance <= lengths[i] || i === lengths.length - 1) {
        const t = lengths[i] ? distance / lengths[i] : 0;
        const x = points[i][0] + (points[i + 1][0] - points[i][0]) * t;
        const y = points[i][1] + (points[i + 1][1] - points[i][1]) * t;
        this.contain(id, x - size / 2, y - size / 2, size, size);
        return;
      }
      distance -= lengths[i];
    }
  }

  factoryAsset(id, x, y, w, h, options) {
    const img = this.assets.get(id);
    if (!img) return;
    const m = this.assets.meta(id) || {};
    const src = m.draw && m.draw.sourceRect;
    if (!src) { this.contain(id, x, y, w, h); return; }
    const k = Math.min(w / src[2], h / src[3]);
    const dw = src[2] * k, dh = src[3] * k;
    this.ctx.save();
    if (options && options.rotate) {
      this.ctx.translate(x + w / 2, y + h); this.ctx.rotate(options.rotate);
      this.ctx.drawImage(img, src[0], src[1], src[2], src[3], -dw / 2, -dh, dw, dh);
    } else this.ctx.drawImage(img, src[0], src[1], src[2], src[3], x + (w - dw) / 2, y + h - dh, dw, dh);
    this.ctx.restore();
  }

  factoryPoint(id, r, port) {
    const meta = this.assets.meta(id) || {};
    const source = meta.draw && meta.draw.sourceRect;
    const point = meta.draw && meta.draw.ports && meta.draw.ports[port];
    if (!source || !point) return [r.x + r.w / 2, r.y + r.h / 2];
    const scale = Math.min(r.w / source[2], r.h / source[3]);
    return [r.x + (r.w - source[2] * scale) / 2 + (point[0] - source[0]) * scale,
      r.y + r.h - source[3] * scale + (point[1] - source[1]) * scale];
  }

  factorySlot(id, r, slot) {
    const meta = this.assets.meta(id) || {};
    const source = meta.draw && meta.draw.sourceRect;
    const bounds = meta.draw && meta.draw.slots && meta.draw.slots[slot];
    if (!source || !bounds) return r;
    const scale = Math.min(r.w / source[2], r.h / source[3]);
    return { x: r.x + (r.w - source[2] * scale) / 2 + (bounds[0] - source[0]) * scale,
      y: r.y + r.h - source[3] * scale + (bounds[1] - source[1]) * scale,
      w: bounds[2] * scale, h: bounds[3] * scale };
  }

  label(value, x, y, w, active) {
    this.roundRect(x, y, w, 23, 7, active ? '#237b72' : '#695c47');
    this.text(value, x + w / 2, y + 11, 11, '#fff6e6', 'center', true);
  }

  setFactoryScroll(value) {
    const max = this.factoryLayout ? Math.max(0, this.factoryLayout.height - this.layout.factoryViewport.h) : 0;
    this.factoryScroll = Math.max(0, Math.min(max, value));
  }

  scrollFactory(distance) { this.setFactoryScroll(this.factoryScroll + distance / this.scale); }

  focusLine(lineId) {
    this.pendingFactoryFocus = lineId;
    const scene = this.factoryLayout && this.factoryLayout.scenes.find(scene => scene.lineId === lineId);
    if (scene) {
      this.setFactoryScroll(scene === this.factoryLayout.scenes[0] ? 0 :
        scene.machine.y + scene.machine.h / 2 - this.layout.factoryViewport.h / 2);
      this.pendingFactoryFocus = null;
    }
  }

  factory(model, visual) {
    const s = model.state, selected = model.getLine(), f = selected.factory;
    const key = s.lines.map(line => line.id).join('|');
    if (key !== this.factoryLineKey) {
      this.factoryLayout = buildFactoryLayout(s.lines);
      this.factoryLineKey = key;
      this.setFactoryScroll(this.factoryScroll);
    }
    this.factorySelectedProduct = selected.product;
    if (selected.id !== this.lastFactorySelection || this.pendingFactoryFocus) {
      this.focusLine(this.pendingFactoryFocus || selected.id);
      this.lastFactorySelection = selected.id;
    }
    const layout = this.factoryLayout, view = this.layout.factoryViewport, time = visual.time || 0;
    const supply = s.shared.supply, packaging = s.shared.packaging, materials = s.shared.materials;
    const supplyRect = layout.supply, packRect = layout.packaging, warehouseRect = layout.warehouse;
    const stockSlot = this.factorySlot('factory/warehouse', warehouseRect, 'stock');
    const supplyPoint = this.factoryPoint('factory/supply-body-clean', supplyRect, 'output');
    const packInput = this.factoryPoint('factory/packer-body-clean', packRect, 'input');
    const packOutput = this.factoryPoint('factory/packer-body-clean', packRect, 'output');
    const stockPath = [packOutput, [336, packRect.y + 96], [182, packRect.y + 96],
      [stockSlot.x + stockSlot.w / 2, stockSlot.y + stockSlot.h / 2]];
    const bottleneck = model.productionBottleneck();
    this.roundRect(19, 221, 352, 50, 10, '#fff6e6');
    this.text('已投产 ' + s.lines.length + ' 条线 · 上下滑动查看', 25, 233, 12, COLORS.muted);
    this.text(bottleneck.text, 25, 253, 12,
      ['supply', 'packaging'].includes(bottleneck.kind) ? COLORS.teal : COLORS.muted);
    this.button('ui/upgrade-button-green', '公共升级', this.layout.sharedUpgradeOpen);
    this.ctx.save();
    this.ctx.beginPath(); this.ctx.rect(view.x, view.y, view.w, view.h); this.ctx.clip();
    this.ctx.translate(0, view.y - this.factoryScroll);
    for (let y = 0; y < layout.height; y += 235) this.image('factory/floor', 19, y, 352, 235);
    this.image('factory/wall-back', 19, 0, 352, 113, .85);
    this.image('factory/wall-left', 17, 0, 37, layout.height, .9);
    const scenes = layout.scenes.map(scene => {
      const line = model.getLine(scene.lineId), id = 'factory/' + MACHINE_IDS[line.product];
      const input = this.factoryPoint(id, scene.machine, 'input'), output = this.factoryPoint(id, scene.machine, 'output');
      return { ...scene, line, id,
        supplyPath: [supplyPoint, [49, supplyPoint[1]], [49, input[1]], input],
        outputPath: [output, [225, output[1]], [262, scene.cache.y + 19]],
        packPath: [[262, scene.cache.y + 19], [336, scene.cache.y + 19], [336, packInput[1]], packInput] };
    });
    scenes.forEach(scene => { this.belt(scene.supplyPath); this.belt(scene.outputPath); this.belt(scene.packPath); });
    this.belt(stockPath);
    layout.groups.forEach(group => {
      this.slice('ui/panel-cream', 64, group.y - 12, 252, 30);
      this.text(this.productName(group.product) + '工坊', 78, group.y + 3, 15, COLORS.text, 'left', true);
      this.text(group.count + '/' + model.lineExpansionOffer(group.product).maxLines + '条线', 301, group.y + 3, 13, COLORS.teal, 'right', true);
    });
    this.factoryAsset('factory/platform', supplyRect.x - 7, supplyRect.y + 79, 126, 40);
    drawSupply(this, supplyRect.x, supplyRect.y, supplyRect.w, supplyRect.h, !!supply.lineId, time,
      materials.baseUnits / materials.capacityBaseUnits);
    this.label('供料' + (supply.level || 1) + '档 · 原料' + materials.baseUnits, 219, supplyRect.y + 104, 120, !!supply.lineId);
    scenes.forEach(scene => {
      const line = scene.line, batch = line.factory, phase = batch.phase, { machine, cache } = scene;
      const p = Math.max(0, Math.min(1, batch.elapsed / Math.max(.0001, batch.duration)));
      const active = line.id === s.selectedLineId;
      this.factoryAsset('factory/platform', machine.x - 8, machine.y + 98, 154, 40);
      if (active) this.roundRect(machine.x - 4, machine.y + 3, machine.w + 4, machine.h + 9, 8, null, '#43bfd0');
      drawMachine(this, MACHINE_IDS[line.product], machine.x, machine.y, machine.w, machine.h, phase, p, time);
      this.factoryAsset('factory/buffer-bin', cache.x, cache.y, cache.w, cache.h);
      const material = 'factory/' + (line.product === 'caramel' ? 'caramel-popcorn' : 'loose-popcorn');
      if (line.buffer.length || ['discharging', 'transport', 'waiting-cache'].includes(phase))
        this.contain(material, cache.x + 13, cache.y + 4, 37, 27);
      this.label(this.productName(line.product) + ' · ' + lineNumber(line.id) + '号 · ' + productionLabel(line),
        63, machine.y + 120, 145, active);
      this.text('出厂 Lv.' + line.outputLevel + ' · 库存 ' + displayStock(line.inventory), 64, machine.y + 154, 12, COLORS.text);
      if (phase === 'feeding') this.transfer(scene.supplyPath, p, 'factory/loose-popcorn', 18);
      if (phase === 'discharging' || phase === 'transport') this.transfer(scene.outputPath, p, material, 20);
      line.warehouse.forEach(item => this.transfer(stockPath, Math.max(0, Math.min(1, item.elapsed / item.duration)),
        'product/' + line.product + '/' + item.outputLevel, 22));
    });
    layout.slots.forEach(slot => {
      const offer = model.lineExpansionOffer(slot.product);
      this.slice('ui/panel-cream', slot.x, slot.y, slot.w, slot.h);
      this.contain('factory/' + MACHINE_IDS[slot.product], slot.x + 5, slot.y + 8, 65, 58, .4);
      this.text('增开' + this.productName(slot.product) + slot.number + '号线', slot.x + 82, slot.y + 22, 16, COLORS.teal, 'left', true);
      this.contain('icon/coin', slot.x + 82, slot.y + 38, 23, 23);
      this.text(offer.cost + ' · 一级起步', slot.x + 110, slot.y + 50, 13, COLORS.text);
      this.text('+', slot.x + slot.w - 22, slot.y + 40, 28, COLORS.teal, 'center', true);
    });
    const packingLine = model.getLine(packaging.lineId);
    drawPacker(this, packRect.x, packRect.y, packRect.w, packRect.h,
      packingLine ? 'packaging' : 'idle', packaging.elapsed / Math.max(.0001, packaging.duration),
      packingLine ? packingLine.product : selected.product, packaging.batch ? packaging.batch.outputLevel : selected.outputLevel);
    this.label(packingLine ? this.productName(packingLine.product) + lineNumber(packingLine.id) + '号 · 包装' + (packaging.level || 1) + '档' :
      '公共包装 · ' + (packaging.level || 1) + '档',
      241, packRect.y + 77, 122, !!packingLine);
    this.text(packaging.batch ? packaging.batch.batchUnits + '份成品 / 批' : '成品按批包装',
      302, packRect.y + 113, 12, COLORS.text, 'center');
    this.factoryAsset('factory/warehouse', warehouseRect.x, warehouseRect.y, warehouseRect.w, warehouseRect.h);
    layout.groups.forEach((group, index) => {
      const stocked = s.lines.find(line => line.product === group.product && line.inventory > 0);
      if (stocked)
        this.contain('product/' + group.product + '/' + stocked.outputLevel, stockSlot.x + index * stockSlot.w / layout.groups.length,
          stockSlot.y, stockSlot.w / layout.groups.length, stockSlot.h);
    });
    this.label('仓储 · 各线独立记账', 77, warehouseRect.y + 72, 155, s.lines.some(line => line.warehouse.length));
    this.ctx.restore();
    const maxScroll = Math.max(1, layout.height - view.h), thumbH = Math.max(34, view.h * view.h / layout.height);
    this.roundRect(366, view.y + 5, 3, view.h - 10, 1.5, '#8b795342');
    this.roundRect(366, view.y + 5 + (view.h - 10 - thumbH) * this.factoryScroll / maxScroll, 3, thumbH, 1.5, '#2d9b87');
    const progress = Math.max(0, Math.min(1, f.elapsed / Math.max(.0001, f.duration)));
    this.slice('ui/panel-cream', 19, 666, 352, 107);
    this.contain('factory/' + MACHINE_IDS[selected.product], 28, 680, 65, 70);
    this.text(this.lineName(selected), 104, 686, 15, COLORS.text, 'left', true);
    this.text('库存 ' + displayStock(selected.inventory), 350, 686, 13, COLORS.text, 'right', true);
    this.text(productionLabel(selected) + ' · Lv.' + f.outputLevel + ' / ' + f.batchUnits + '份 · 缓存 ' + selected.buffer.length + '批',
      104, 705, 12, COLORS.muted);
    this.roundRect(104, 713, 253, 3, 1.5, '#ded0b7');
    this.roundRect(104, 713, Math.max(2, 253 * progress), 3, 1.5, '#2d9b87');
    this.button('ui/button-teal', '加速', this.layout.accelerate, f.phase === 'processing');
    this.button('ui/upgrade-button-green', '流水线升级', this.layout.upgradeOpen);
    this.button('ui/button-teal', '扩线', this.layout.lineExpansionOpen);
  }

  upgradePurchaseButton(offer, kind, r, coins) {
    const enabled = !offer.maxed && offer.affordable;
    const gold = kind === 'output';
    const label = offer.maxed ? (gold ? '出厂已达 Lv.' + offer.level : '产能已满 · ' + offer.level + '档') :
      enabled ? (gold ? '出厂升阶' : '提升产能') : '还差 ' + Math.max(0, offer.cost - coins) + ' 金币';
    this.slice(gold ? 'ui/upgrade-button-gold' : 'ui/upgrade-button-green', r.x, r.y, r.w, r.h, enabled ? 1 : .55);
    const color = enabled && !gold ? '#fff8e7' : '#5f341c';
    if (offer.maxed) {
      this.text(label, r.x + r.w / 2, r.y + r.h / 2, 18, color, 'center', true);
      return;
    }
    this.contain('icon/coin', r.x + 55, r.y + 7, 30, 30, enabled ? 1 : .65);
    this.text(offer.cost, r.x + 98, r.y + r.h / 2, 23, color, 'left', true);
    this.ctx.fillStyle = gold || !enabled ? '#95622460' : '#ffffff60';
    this.ctx.fillRect(r.x + 148, r.y + 11, 1, r.h - 22);
    this.text(label, r.x + 230, r.y + r.h / 2, enabled ? 19 : 15, color, 'center', true);
  }

  upgradeDialog(model) {
    const line = model.getLine(), capacity = model.capacityOffer(), output = model.outputOffer();
    const r = this.layout.upgradePanel, title = this.layout.upgradeTitle, close = this.layout.upgradeClose;
    this.capacityBuyEnabled = !capacity.maxed && capacity.affordable;
    this.outputBuyEnabled = !output.maxed && output.affordable;
    this.upgradeLineId = line.id;
    this.ctx.fillStyle = '#3f3028a8';
    this.ctx.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
    this.slice('ui/upgrade-panel-cream', r.x, r.y, r.w, r.h);
    this.slice('ui/upgrade-title-sign', title.x, title.y, title.w, title.h);
    this.text('流水线升级', 195, 128, 24, '#5f341c', 'center', true);
    this.contain('ui/upgrade-button-close', close.x, close.y, close.w, close.h);
    this.slice('ui/upgrade-well-mint', 31, 161, 100, 82);
    this.contain('factory/' + MACHINE_IDS[line.product], 29, 157, 104, 90);
    this.text(this.lineName(line), 146, 180, 20, '#5f341c', 'left', true);
    this.slice('ui/upgrade-inset-cream', 144, 203, 211, 34);
    this.contain('icon/upgrade-level', 150, 209, 23, 23);
    this.text('出厂 Lv.' + line.outputLevel, 179, 220, 13, '#8f7656', 'left', true);
    this.ctx.fillStyle = '#d7c5a3'; this.ctx.fillRect(255, 211, 1, 18);
    this.contain('icon/upgrade-inventory', 260, 211, 19, 19);
    this.text((line.inventory >= 1e11 ? '' : '库存 ') + displayStock(line.inventory) + '份', 282, 220, 12, '#5f341c', 'left', true);
    this.upgradeCapacityCard(capacity, model.state.coins);
    this.upgradeOutputCard(output, line, model.state.coins);
    this.ctx.fillStyle = '#ddc8a6';
    this.ctx.fillRect(83, 815, 55, 1); this.ctx.fillRect(252, 815, 55, 1);
    this.text('仅升级当前流水线', 195, 816, 11, '#8f7656', 'center');
  }

  upgradeCapacityCard(offer, coins) {
    const r = this.layout.capacityCard;
    this.slice('ui/upgrade-card-mint', r.x, r.y, r.w, r.h);
    this.contain('icon/upgrade-capacity', 42, 260, 31, 31);
    this.text('提升产能', 78, 274, 21, '#075731', 'left', true);
    this.slice('ui/upgrade-badge-level', 249, 261, 98, 29);
    if (offer.maxed) this.text(offer.level + '档 · 已满', 298, 275, 13, '#075731', 'center', true);
    else {
      this.text(offer.level + '档', 271, 275, 14, '#075731', 'center', true);
      this.contain('icon/upgrade-arrow-right-mint', 290, 266, 19, 19);
      this.text((offer.level + 1) + '档', 328, 275, 14, '#075731', 'center', true);
    }
    this.slice('ui/upgrade-inset-cream', 41, 297, 308, 55);
    if (offer.maxed) {
      this.text('每批份数 / 机器周期', 195, 309, 12, '#8f7656', 'center');
      this.text(offer.batchUnits + '份 / ' + displaySeconds(offer.currentCycleSeconds) + '秒', 195, 332, 22, '#075731', 'center', true);
    } else {
      this.text('当前', 116, 309, 12, '#8f7656', 'center');
      this.text('升级后', 278, 309, 12, '#8f7656', 'center');
      this.text(offer.batchUnits + '份 / ' + displaySeconds(offer.currentCycleSeconds) + '秒', 116, 332, 20, '#5f341c', 'center', true);
      this.contain('icon/upgrade-arrow-right', 184, 317, 25, 29);
      this.text(offer.batchUnits + '份 / ' + displaySeconds(offer.nextCycleSeconds) + '秒', 278, 332, 20, '#075731', 'center', true);
    }
    this.slice('ui/upgrade-ribbon-mint', 41, 357, 308, 22);
    this.text(offer.maxed ? (offer.pending ? '下一批启用新产能' : '本线产能已满') :
      '机器周期速度 +' + offer.speedGainPercent + '%', 195, 368, 15, '#075731', 'center', true);
    this.upgradePurchaseButton(offer, 'capacity', this.layout.capacityBuy, coins);
    this.text(offer.maxed ? '供料、缓存与包装等待另计' : '下一批生效 · 供料、缓存与包装等待另计',
      195, 442, 11, '#8f7656', 'center');
  }

  upgradeOutputCard(offer, line, coins) {
    const r = this.layout.outputCard, nextLevel = offer.maxed ? offer.level : offer.level + 1;
    this.slice('ui/upgrade-card-gold', r.x, r.y, r.w, r.h);
    this.contain('icon/upgrade-output-level', 42, 479, 31, 31);
    this.text('出厂升阶', 78, 494, 21, '#5f341c', 'left', true);
    this.slice('ui/upgrade-inset-cream', 41, 516, 308, 201);
    if (offer.maxed) {
      this.contain('product/' + line.product + '/' + offer.level, 151, 517, 88, 68);
      this.text('出厂 Lv.' + offer.level + ' · 本轮已满', 195, 589, 13, '#5f341c', 'center', true);
    } else {
      this.contain('product/' + line.product + '/' + offer.level, 89, 515, 84, 68);
      this.contain('product/' + line.product + '/' + nextLevel, 223, 515, 84, 68);
      this.contain('icon/upgrade-arrow-right', 184, 539, 26, 30);
      this.text('Lv.' + offer.level, 131, 589, 13, '#5f341c', 'center', true);
      this.text('Lv.' + nextLevel, 265, 589, 13, '#5f341c', 'center', true);
    }
    this.text('合成一个 Lv.' + offer.targetLevel + ' 商品', 195, 610, 14, '#5f341c', 'center', true);
    this.slice('ui/upgrade-inset-cream', 45, 622, 300, 47);
    if (offer.maxed) this.text(offer.currentShots + '发 · ' + offer.currentMerges + '次合成', 195, 647, 18, '#075731', 'center', true);
    else {
      this.text('当前', 119, 633, 11, '#8f7656', 'center');
      this.text('升级后', 279, 633, 11, '#8f7656', 'center');
      this.text(offer.currentShots + '发 · ' + offer.currentMerges + '次合成', 119, 654, 15, '#5f341c', 'center', true);
      this.contain('icon/upgrade-arrow-right', 184, 635, 25, 28);
      this.text(offer.nextShots + '发 · ' + offer.nextMerges + '次合成', 279, 654, 15, '#075731', 'center', true);
    }
    this.slice('ui/upgrade-inset-cream', 45, 674, 300, 28);
    this.contain('icon/upgrade-inventory', 49, 679, 20, 20);
    if (offer.maxed) {
      this.text('当前库存 ' + displayStock(offer.inventoryBefore) + '份', 77, 689, 14, '#5f341c', 'left', true);
      this.slice('ui/upgrade-badge-success', 263, 678, 76, 22);
      this.text('Lv.' + offer.level, 301, 689, 12, '#fff8e7', 'center', true);
    } else {
      this.text('库存 ' + displayStock(offer.inventoryBefore) + '份', 76, 689, 13, '#5f341c', 'left', true);
      this.contain('icon/upgrade-arrow-right', 172, 681, 18, 19);
      this.text(displayStock(offer.inventoryAfter) + '份', 202, 689, 16, '#075731', 'left', true);
      if (offer.discardedBaseUnits) {
        this.text('舍弃' + offer.discardedBaseUnits + '份', 305, 689, 12, COLORS.red, 'center', true);
      } else {
        this.slice('ui/upgrade-badge-success', 271, 678, 68, 22);
        this.text('无舍弃', 305, 689, 12, '#fff8e7', 'center', true);
      }
    }
    this.text('新批 Lv.' + nextLevel + ' · ' + offer.nextBatchUnits + '份 / ' + displaySeconds(offer.cycleSeconds) + '秒',
      195, 710, 13, '#8f7656', 'center', true);
    this.upgradePurchaseButton(offer, 'output', this.layout.outputBuy, coins);
    this.text(offer.pending || !offer.maxed ? '旧批全部包装后统一折算入库' : '当前规格已启用 · 正常生产中',
      195, 779, 11, '#8f7656', 'center');
    this.text(offer.discardedBaseUnits && !offer.maxed ? '舍弃量按一级材料计 · 棋盘商品保留原等级' : '棋盘已有商品保留原等级',
      195, 793, 11, '#8f7656', 'center');
  }

  sharedUpgradeDialog(model, shared) {
    const r = this.layout.sharedUpgradePanel, title = this.layout.sharedUpgradeTitle;
    const offers = shared.offers || { supply: model.sharedUpgradeOffer('supply'), packaging: model.sharedUpgradeOffer('packaging') };
    this.sharedUpgradeFocus = shared.focus || null;
    this.ctx.fillStyle = '#3f3028a8';
    this.ctx.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
    this.slice('ui/upgrade-panel-cream', r.x, r.y, r.w, r.h);
    this.slice('ui/upgrade-title-sign', title.x, title.y, title.w, title.h);
    this.text('公共设备升级', 195, 173, 22, '#5f341c', 'center', true);
    const close = this.layout.sharedUpgradeClose;
    this.contain('ui/upgrade-button-close', close.x, close.y, close.w, close.h);
    this.text('金币余额 ' + displayStock(model.state.coins), 195, 204, 12, COLORS.text, 'center');
    this.text('全厂供料与包装，所有已投产线共用', 195, 222, 13, COLORS.muted, 'center');
    for (const service of ['supply', 'packaging']) this.sharedUpgradeCard(service, offers[service], model);
    const bottleneck = shared.bottleneck || model.productionBottleneck();
    this.text('当前：' + bottleneck.text, 195, 702, 12, COLORS.teal, 'center');
    this.text('各线库存与出厂规格不变，入库仍受加工与缓存限制', 195, 722, 11, COLORS.muted, 'center');
  }

  sharedUpgradeCard(service, offer, model) {
    const supply = service === 'supply';
    const r = this.layout[supply ? 'sharedSupplyCard' : 'sharedPackagingCard'];
    const buy = this.layout[supply ? 'sharedSupplyBuy' : 'sharedPackagingBuy'];
    const y = r.y, color = supply ? '#075731' : '#5f341c';
    const enabled = !offer.maxed && offer.affordable;
    this.sharedBuyEnabled[service] = enabled;
    this.sharedUpgradeLevels[service] = offer.level;
    this.slice(supply ? 'ui/upgrade-card-mint' : 'ui/upgrade-card-gold', r.x, r.y, r.w, r.h);
    if (this.sharedUpgradeFocus === service) this.roundRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, 10, null, '#2a9f83');
    this.contain(supply ? 'icon/upgrade-capacity' : 'icon/upgrade-inventory', 55, y + 10, 28, 28);
    this.text(supply ? '公共供料' : '公共包装', 91, y + 25, 19, color, 'left', true);
    this.slice('ui/upgrade-badge-level', 253, y + 12, 80, 27);
    this.text(offer.maxed ? offer.level + '档 · 已满' : offer.level + '→' + offer.nextLevel + '档',
      293, y + 26, 13, color, 'center', true);
    this.text(supply ? '每' + offer.refillBaseUnits + '份基础材料的补料周期' : '每批实际成品的包装耗时',
      195, y + 52, 12, COLORS.muted, 'center');
    this.slice('ui/upgrade-inset-cream', 55, y + 63, 280, 55);
    if (offer.maxed) {
      this.text('已配置 · ' + offer.level + '档', 195, y + 75, 12, COLORS.muted, 'center');
      this.text(sharedSeconds(offer.currentSeconds) + '秒' + (supply ? ' / ' + offer.refillBaseUnits + '份基础材料' : ' / 批'),
        195, y + 99, 19, color, 'center', true);
    } else {
      this.text('当前', 120, y + 75, 12, COLORS.muted, 'center');
      this.text('升级后', 271, y + 75, 12, COLORS.muted, 'center');
      this.text(sharedSeconds(offer.currentSeconds) + '秒', 120, y + 99, 20, COLORS.text, 'center', true);
      this.contain('icon/upgrade-arrow-right', 183, y + 83, 24, 28);
      this.text(sharedSeconds(offer.nextSeconds) + '秒', 271, y + 99, 20, color, 'center', true);
    }
    this.slice(supply ? 'ui/upgrade-ribbon-mint' : 'ui/upgrade-inset-cream', 55, y + 122, 280, 21);
    const effect = supply ? (offer.maxed ? '分料 ' + sharedSeconds(offer.currentServiceSeconds) + '秒 / 次' :
      '备料速度 +' + offer.speedGainPercent + '% · 分料耗时减半') :
      offer.maxed ? '全厂成品按实际批次包装' : '单批包装耗时减半';
    this.text(effect, 195, y + 133, 13, color, 'center', true);
    const label = offer.maxed ? (supply ? '供料' : '包装') + '已满 · ' + offer.level + '档' :
      enabled ? (supply ? '升级供料' : '升级包装') : '还差' + Math.max(0, offer.cost - model.state.coins) + '金币';
    this.slice(supply ? 'ui/upgrade-button-green' : 'ui/upgrade-button-gold', buy.x, buy.y, buy.w, buy.h, enabled ? 1 : .55);
    const buttonColor = supply && enabled ? '#fff8e7' : '#5f341c';
    if (offer.maxed) this.text(label, 195, buy.y + buy.h / 2, 18, buttonColor, 'center', true);
    else {
      this.contain('icon/coin', buy.x + 23, buy.y + 9, 28, 28, enabled ? 1 : .65);
      this.text(offer.cost, buy.x + 57, buy.y + 24, 21, buttonColor, 'left', true);
      this.ctx.fillStyle = supply && enabled ? '#ffffff60' : '#95622460';
      this.ctx.fillRect(buy.x + 112, buy.y + 12, 1, buy.h - 24);
      this.text(label, buy.x + 196, buy.y + 24, enabled ? 18 : 14, buttonColor, 'center', true);
    }
    if (offer.pending) {
      const snapshot = supply ? '本轮补料' + sharedSeconds(offer.activeRefillSeconds) + '秒 · 分料' +
        sharedSeconds(offer.activeServiceSeconds) + '秒' : '本批仍按' + sharedSeconds(offer.activeServiceSeconds) + '秒完成';
      this.text(snapshot, 195, y + 197, 11, COLORS.muted, 'center');
      this.text((supply ? '各自下轮' : '下一批') + '启用' + offer.level + '档 · 全厂共用',
        195, y + 209, 11, COLORS.muted, 'center');
    } else this.text(offer.maxed ? '当前档位已启用 · 所有流水线共用' : '下一轮生效 · 所有流水线共用，不改变规格',
      195, y + 203, 11, COLORS.muted, 'center');
  }

  lineExpansionDialog(model, expansion) {
    const product = expansion.product, offer = model.lineExpansionOffer(product), r = this.layout.lineExpansionPanel;
    this.lineExpansionProduct = product;
    this.lineExpansionBuyEnabled = offer.canBuy;
    this.ctx.fillStyle = '#3f3028a8';
    this.ctx.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
    this.slice('ui/panel-cream', r.x, r.y, r.w, r.h);
    this.text(offer.maxed ? this.productName(product) + '流水线' : '增开' + this.productName(product) + offer.nextLineNumber + '号线',
      195, 222, 23, COLORS.text, 'center', true);
    const close = this.layout.lineExpansionClose;
    this.contain('ui/upgrade-button-close', close.x, close.y, close.w, close.h);
    this.slice('ui/upgrade-well-mint', 48, 252, 294, 112);
    this.contain('factory/' + MACHINE_IDS[product], 54, 263, 103, 87);
    this.text('出厂 Lv.1 · 产能1档', 171, 279, 15, COLORS.teal, 'left', true);
    this.text('独立生产 · 独立库存', 171, 305, 14, COLORS.text);
    this.contain('launcher/' + product + '/1', 174, 322, 34, 34);
    this.text('常驻发射器 ×1', 219, 342, 13, COLORS.text);
    this.text('发射只扣本线库存', 55, 391, 15, COLORS.text);
    this.text('同种同级商品可以跨线合成', 55, 422, 14, COLORS.text);
    this.text('发射器占一格，建线需要一个空格', 55, 453, 13, COLORS.muted);
    this.text('共用供料和包装，增产受公共能力限制', 55, 482, 13, COLORS.muted);
    this.contain('icon/coin', 108, 508, 28, 28);
    this.text('建设费用 ' + offer.cost, 146, 524, 20, COLORS.text, 'left', true);
    this.text('余额 ' + displayStock(model.state.coins) + ' · 已投产 ' + offer.lineCount + '/' + offer.maxLines + ' 条线',
      195, 561, 14, COLORS.muted, 'center');
    const explanation = offer.maxed ? '本轮两条线均已投产' : !offer.hasSpace ? '棋盘已满，先腾出一格再建设' :
      !offer.affordable ? '还差 ' + (offer.cost - model.state.coins) + ' 金币' : '一级起步，现有流水线保留原规格';
    this.text(explanation, 195, 593, 14, offer.canBuy || offer.maxed ? COLORS.teal : COLORS.red, 'center');
    const label = offer.maxed ? '已投产' : !offer.hasSpace ? '先腾出棋盘空格' : !offer.affordable ? '金币不足' : '确认建设';
    this.button('ui/button-teal', label, this.layout.lineExpansionBuy, offer.canBuy);
    this.text('建设后自动生产，库存分别保存', 195, 697, 12, COLORS.muted, 'center');
  }

  navigation(state) {
    ['factory', 'board'].forEach(page => {
      const active = state.page === page;
      const r = this.layout[page + 'Nav'];
      this.slice(active ? 'ui/nav-active' : 'ui/nav-idle', r.x, r.y, r.w, r.h);
      this.contain('icon/' + page + (active ? '-active' : '-idle'), r.x + 35, r.y + 13, 27, 27);
      this.text(page === 'factory' ? '工厂' : '棋盘', r.x + 111, r.y + 27, 20, active ? COLORS.cream : '#9b7c60', 'center', true);
    });
  }

  offlineDialog(summary) {
    const entries = summary.producedByLine || [], extra = Math.max(0, entries.length - 2) * 75;
    const r = { x: 27, y: 246 - extra / 2, w: 336, h: 360 + extra };
    const offset = r.y - 246;
    this.layout.offlinePanel = r;
    this.layout.offlineClose = { x: 61, y: 536 + offset + extra, w: 268, h: 48 };
    this.ctx.fillStyle = '#3f3028a8';
    this.ctx.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
    this.slice('ui/panel-cream', r.x, r.y, r.w, r.h);
    this.text('欢迎回来', 195, 279 + offset, 23, COLORS.text, 'center', true);
    const minutes = Math.floor(summary.seconds / 60);
    const duration = minutes >= 60 ? Math.floor(minutes / 60) + '小时' + (minutes % 60 ? minutes % 60 + '分钟' : '') : minutes + '分钟';
    this.text('工厂自动生产了 ' + duration, 195, 307 + offset, 14, COLORS.muted, 'center');
    entries.forEach((line, index) => {
      const y = 326 + offset + index * 75;
      this.roundRect(48, y, 294, 64, 10, '#eee1c8');
      this.contain('product/' + line.product + '/' + line.level, 56, y + 10, 47, 45);
      this.text(this.productName(line.product) + ' · ' + lineNumber(line.lineId) + '号线', 116, y + 20, 15, COLORS.text, 'left', true);
      this.text('出厂 Lv.' + line.level + ' · 新增库存', 116, y + 44, 12, COLORS.muted);
      this.text('+' + displayStock(line.units) + '份', 326, y + 33, 18, COLORS.teal, 'right', true);
    });
    this.text(summary.capped ? '每次离开最多计2小时' : '商品已入库，取货后继续合成', 195, 491 + offset + extra, 13, COLORS.muted, 'center');
    if (summary.saveFailed) this.text('保存暂未成功，将自动重试', 195, 516 + offset + extra, 12, COLORS.red, 'center');
    this.button('ui/button-teal', '继续经营', this.layout.offlineClose);
  }

  effects(visual, model) {
    const time = visual.time || 0;
    (visual.effects || []).forEach(e => {
      const start = e.startedAt === undefined ? (e.born === undefined ? (e.at || 0) : e.born) : e.startedAt;
      const p = Math.max(0, Math.min(1, (time - start) / (e.duration || 0.55)));
      if (p >= 1) return;
      if (e.index === undefined || e.index < 0) return;
      const r = this.cellRect(e.index);
      if (e.type === 'launch' && e.from !== undefined) {
        const item = { kind: 'product', product: e.product, level: e.level, id: e.itemId };
        if (!Number.isInteger(item.level) || item.level < 1) return;
        const origin = this.cellRect(e.from);
        const travel = 1 - Math.pow(1 - p, 2);
        this.item(item, { x: origin.x + (r.x - origin.x) * travel,
          y: origin.y + (r.y - origin.y) * travel - Math.sin(p * Math.PI) * 14, w: r.w, h: r.h }, 0);
        return;
      }
      const id = e.type === 'invalid' ? 'effect/invalid-target' : e.type === 'merge' ? 'effect/merge-burst' : 'effect/sparkle';
      const size = (e.type === 'merge' ? 65 : 52) + Math.sin(p * Math.PI) * 15;
      this.contain(id, r.x + r.w / 2 - size / 2, r.y + r.h / 2 - size / 2, size, size, 1 - p);
    });
  }

  toast(visual) {
    const toast = visual.toast;
    if (!toast) return;
    const value = typeof toast === 'string' ? toast : (toast.text || toast.message);
    if (!value) return;
    const start = toast.startedAt === undefined ? toast.at : toast.startedAt;
    if (start !== undefined && (visual.time || 0) - start > (toast.duration || 2.3)) return;
    const c = this.ctx;
    c.save(); c.font = '13px "Microsoft YaHei", sans-serif';
    const w = Math.min(344, c.measureText(value).width + 30);
    const y = this.entryOpen ? (this.entrySettingsOpen ? this.entryLayout.panel.y + this.entryLayout.panel.h + 16 : 803) :
      this.upgradeDialogOpen || this.lineExpansionDialogOpen || this.sharedUpgradeDialogOpen ? 52 : 724;
    this.roundRect((390 - w) / 2, y, w, 32, 10, '#493c2de8');
    this.text(value, 195, y + 16, 13, COLORS.cream, 'center');
    c.restore();
  }

  draw(model, visual = {}) {
    if (visual.entry !== undefined) this.entryOpen = !!visual.entry;
    this.entrySettingsOpen = this.entryOpen && !!visual.settingsOpen;
    if (this.entryOpen) {
      this.upgradeDialogOpen = false;
      this.lineExpansionDialogOpen = false;
      this.sharedUpgradeDialogOpen = false;
      this.offlineSummaryOpen = false;
      drawEntry(this, visual);
      return;
    }
    this.page = model.state.page || 'board';
    this.upgradeDialogOpen = !!visual.upgradeDialog;
    this.lineExpansionDialogOpen = !!visual.lineExpansion;
    this.sharedUpgradeDialogOpen = !!visual.sharedUpgrade;
    this.offlineSummaryOpen = !!visual.offlineSummary;
    this.begin();
    this.background(this.page === 'factory');
    this.header(model.state);
    this.order(model, visual);
    if (this.page === 'factory') this.factory(model, visual);
    else { this.board(model, visual); this.effects(visual, model); }
    this.navigation(model.state);
    if (this.upgradeDialogOpen) this.upgradeDialog(model);
    if (this.lineExpansionDialogOpen) this.lineExpansionDialog(model, visual.lineExpansion);
    if (this.sharedUpgradeDialogOpen) this.sharedUpgradeDialog(model, visual.sharedUpgrade);
    this.toast(visual);
    if (this.offlineSummaryOpen) this.offlineDialog(visual.offlineSummary);
  }

  drawLoading(progress = 0) {
    this.begin(); this.background(false);
    this.contain('launcher/original/1', 110, 278, 84, 93);
    this.contain('launcher/caramel/1', 199, 278, 84, 93);
    this.text('爆米花工厂', 195, 411, 23, COLORS.text, 'center', true);
    this.text('正在准备工厂与棋盘…', 195, 449, 14, COLORS.muted, 'center');
    this.roundRect(85, 481, 220, 8, 4, '#dccbad');
    this.roundRect(85, 481, Math.max(3, 220 * Math.max(0, Math.min(1, progress))), 8, 4, COLORS.teal);
  }

  drawError(message) {
    this.begin(); this.background(false);
    this.slice('ui/panel-cream', 25, 329, 340, 144);
    this.text('暂时无法打开工厂', 195, 369, 21, COLORS.text, 'center', true);
    const value = String(message || '请重新启动小游戏');
    this.text(value.length > 25 ? value.slice(0, 25) + '…' : value, 195, 410, 13, COLORS.muted, 'center');
    this.text('重新启动后会恢复已保存的进度', 195, 445, 12, COLORS.muted, 'center');
  }
}

module.exports = { Renderer };
