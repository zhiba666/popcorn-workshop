'use strict';

const { FactoryCamera } = require('../factory/factory-camera');
const { drawFactoryOrderSummary } = require('../factory/factory-hud');
const { drawFactoryView } = require('../factory/factory-view');
const { hitFactoryNavigation, handleFactoryNavigation } = require('../factory/factory-navigation');
const { hitFactoryOverview, handleFactoryOverview } = require('../factory/factory-overview');
const { drawFactoryUpgrade, getFactoryUpgradeHit } = require('../factory/factory-upgrade-view');
const { createEntryLayout, entryHitTest, drawEntry } = require('../entry/entry-scene');
const { PRODUCTION_CONFIG: CONFIG, PRODUCT_DEFINITIONS } = require('../../domain/production/production-config');
const { drawCustomers, drawCustomerResponse, customerHitTest, setCustomerScroll } = require('../customers/customer-scene');
const { configureBoardViewport, boardCellRect, drawBoardView, hitBoardView } = require('../board/board-view');

const DESIGN_WIDTH = 390;
const DESIGN_HEIGHT = 844;
const DESIGN_TOP_SPACE = 40;
const DESIGN_BOTTOM_SPACE = 13;
const OFFLINE_PAGE_SIZE = 4;
const COLORS = { text: '#4d2d18', muted: '#9b7c60', cream: '#fff6e6', teal: '#237b72', red: '#ba3843' };
const displaySeconds = value => Math.round(value * 100) / 100;
const sharedSeconds = value => Number(Number(value).toFixed(3));
const lineNumber = id => Number(String(id).split('-').pop()) || 1;
const displayStock = value => {
  if (value < 10000) return String(value);
  const [unit, suffix] = value >= 1e11 ? [1e12, '万亿'] : value >= 1e7 ? [1e8, '亿'] : [1e4, '万'];
  const amount = value / unit;
  return (amount < 10 ? amount.toFixed(1) : Math.round(amount)) + suffix;
};
// Canvas-only presentation: the model owns production, stock, orders and saves.
class Renderer {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.assets = assets;
    this.entryOpen = true;
    this.entrySettingsOpen = false;
    this.recovery = null;
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
    this.offlinePageIndex = 0;
    this.offlinePageCount = 1;
    this.lineExpansionDialogOpen = false;
    this.lineExpansionProduct = null;
    this.lineExpansionBuyEnabled = false;
    this.productConstructionDialogOpen = false;
    this.productConstructionProduct = null;
    this.productConstructionBuyEnabled = false;
    this.factoryScroll = 0;
    // Edge workshops need room below the fixed scene controls as well.
    this.factoryCamera = new FactoryCamera({ minZoom: .1, padding: 72 });
    this.factoryPanVelocity = { x: 0, y: 0 };
    this.factoryDockExpanded = false;
    this.factoryOrderExpanded = false;
    this.factoryViewMode = 'detail';
    this.factoryServiceFocus = null;
    this.factorySelectedPart = 'machine';
    this.upgradeTab = 'capacity';
    this.upgradeDetailsOpen = false;
    this.factoryScrollVelocity = 0;
    this.factoryScrollMotion = null;
    this.reducedMotion = false;
    this.factoryLayout = null;
    this.factoryLineKey = '';
    this.lastFactorySelection = null;
    this.pendingFactoryFocus = null;
    this.visibleOrderId = null;
    this.orderPreviousEnabled = false;
    this.orderNextEnabled = false;
    this.orderDeliverEnabled = false;
    this.customerSelectedId = null;
    this.customerScroll = 0;
    this.customerCollectionScroll = 0;
    this.customerBubbleOpen = false;
    this.customerReturnPage = 'customers';
    this.customerRecordExpanded = Object.create(null);
    this.customerLastOrders = Object.create(null);
    this.boardFlow = { mode: null, scroll: 0 };
    this.boardViewportActive = false;
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
      orderCustomer: { x: 51, y: 122, w: 175, h: 36 },
      orderPrev: { x: 21, y: 167, w: 28, h: 44 },
      orderNext: { x: 341, y: 167, w: 28, h: 44 },
      orderPrevHit: { x: 19, y: 164, w: 44, h: 53 },
      orderNextHit: { x: 327, y: 164, w: 44, h: 53 },
      deliver: { x: 232, y: 168, w: 94, h: 43 },
      discard: { x: 287, y: 698, w: 73, h: 45 },
      factoryNav: { x: 19, y: 779, w: 110, h: 52 },
      boardNav: { x: 140, y: 779, w: 110, h: 52 },
      customersNav: { x: 261, y: 779, w: 110, h: 52 },
      accelerate: { x: 103, y: 719, w: 64, h: 48 },
      upgradeOpen: { x: 174, y: 719, w: 108, h: 48 },
      lineExpansionOpen: { x: 289, y: 719, w: 68, h: 48 },
      factoryViewport: { x: 12, y: 291, w: 366, h: 375 },
      factorySceneViewport: { x: 12, y: 335, w: 366, h: 331 },
      factoryMode: { x: 278, y: 292, w: 92, h: 44 },
      factoryService: { x: 16, y: 292, w: 242, h: 44 },
      sharedUpgradeOpen: { x: 181, y: 29, w: 44, h: 44 },
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
      productConstructionPanel: { x: 27, y: 161, w: 336, h: 578 },
      productConstructionClose: { x: 305, y: 170, w: 44, h: 44 },
      productConstructionBuy: { x: 61, y: 660, w: 268, h: 48 },
      upgradePanel: { x: 14, y: 123, w: 362, h: 708 },
      upgradeTitle: { x: 90, y: 102, w: 210, h: 54 },
      upgradeClose: { x: 331, y: 124, w: 44, h: 44 },
      capacityCard: { x: 28, y: 252, w: 334, h: 205 },
      outputCard: { x: 28, y: 469, w: 334, h: 336 },
      capacityBuy: { x: 41, y: 383, w: 308, h: 44 },
      outputBuy: { x: 41, y: 723, w: 308, h: 44 },
      offlinePanel: { x: 27, y: 246, w: 336, h: 360 },
      offlineClose: { x: 61, y: 536, w: 268, h: 48 },
      offlinePrev: { x: 61, y: 481, w: 82, h: 44 },
      offlineNext: { x: 247, y: 481, w: 82, h: 44 },
    };
    const orderArrowWidth = Math.max(44, 44 / this.scale);
    const orderArrowHeight = Math.min(this.layout.orderArea.h, Math.max(53, 44 / this.scale));
    this.layout.orderPrevHit = { x: 19, y: 217 - orderArrowHeight, w: orderArrowWidth, h: orderArrowHeight };
    this.layout.orderNextHit = { x: 371 - orderArrowWidth, y: 217 - orderArrowHeight, w: orderArrowWidth, h: orderArrowHeight };
    this.layout.deliver.w = Math.max(52, Math.min(94, this.layout.orderNextHit.x - this.layout.deliver.x - 2));
    createEntryLayout(this);
    this.configureFactoryViewport();
    configureBoardViewport(this);
  }

  configureFactoryViewport() {
    const expanded = this.factoryDockExpanded;
    Object.assign(this.layout, {
      factoryOrder: { x: 19, y: 80, w: 352, h: 50 },
      factoryProducts: { x: 19, y: 136, w: 352, h: 54 },
      factoryBottleneck: { x: 19, y: 190, w: 352, h: 54 },
      factoryViewport: { x: 12, y: 244, w: 366, h: expanded ? 382 : 460 },
      factorySceneViewport: { x: 12, y: 244, w: 366, h: expanded ? 382 : 460 },
      factoryDock: { x: 19, y: expanded ? 626 : 704, w: 352, h: expanded ? 147 : 69 },
      factoryDockToggle: { x: 74, y: expanded ? 630 : 706, w: 242, h: expanded ? 56 : 62 },
      factoryPrev: { x: 20, y: expanded ? 633 : 711, w: 54, h: 54 },
      factoryNext: { x: 316, y: expanded ? 633 : 711, w: 54, h: 54 },
      factoryMode: { x: 278, y: 252, w: 92, h: 54 },
      factoryHome: { x: 298, y: expanded ? 566 : 644, w: 72, h: 54 },
      factoryService: { x: 20, y: 252, w: 246, h: 54 },
      accelerate: { x: 28, y: 714, w: 90, h: 48 },
      upgradeOpen: { x: 125, y: 714, w: 139, h: 48 },
      lineExpansionOpen: { x: 272, y: 714, w: 84, h: 48 },
      factoryOrderClose: { x: 270, y: 302, w: 101, h: 54 }
    });
    this.factoryCamera.setViewport(this.layout.factorySceneViewport);
    this.factoryPanVelocity = { x: 0, y: 0 };
    if (this.factoryLayout) {
      this.factoryCamera.minZoom = this.factoryOverviewZoom();
      if (this.upgradeDialogOpen) this.frameFactoryUpgrade(this.upgradeLineId);
      else if (this.factoryViewMode === 'overview') this.focusFactoryOverview(true);
      else if (this.factoryFocusKind === 'group') this.focusLine(this.lastFactorySelection, true);
    }
  }

  logicalPoint(x, y) { return { x: (x - this.offsetX) / this.scale, y: (y - this.offsetY) / this.scale }; }
  screenPoint(x, y) { return { x: this.offsetX + x * this.scale, y: this.offsetY + y * this.scale }; }
  setCustomerScroll(value) { setCustomerScroll(this, value); }
  boardPoint(x, y) { return { x, y }; }
  setBoardScroll(value) {
    if (this.boardFlow) this.boardFlow.scroll = Math.max(0, Math.min(this.boardScrollMax || 0, Number(value) || 0));
  }

  hitTest(x, y) {
    if (this.entryOpen) return entryHitTest(this, x, y);
    if (this.page === 'board' && this.boardViewportActive && !this.offlineSummaryOpen &&
        !this.productConstructionDialogOpen && !this.sharedUpgradeDialogOpen &&
        !this.lineExpansionDialogOpen && !this.upgradeDialogOpen) return hitBoardView(this, x, y);
    const p = this.logicalPoint(x, y);
    const within = r => p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h;
    const minimumHitArea = r => {
      const px = Math.max(0, (44 / this.scale - r.w) / 2), py = Math.max(0, (44 / this.scale - r.h) / 2);
      return within({ x: r.x - px, y: r.y - py, w: r.w + px * 2, h: r.h + py * 2 });
    };
    if (this.offlineSummaryOpen) {
      if (minimumHitArea(this.layout.offlineClose)) return { type: 'offline-close' };
      if (this.offlinePageIndex > 0 && minimumHitArea(this.layout.offlinePrev)) return { type: 'offline-prev', page: this.offlinePageIndex };
      if (this.offlinePageIndex + 1 < this.offlinePageCount && minimumHitArea(this.layout.offlineNext)) return { type: 'offline-next', page: this.offlinePageIndex };
      return null;
    }
    if (this.productConstructionDialogOpen) {
      const product = this.productConstructionProduct;
      if (minimumHitArea(this.layout.productConstructionClose)) return { type: 'product-construction-close', product };
      if (minimumHitArea(this.layout.productConstructionBuy)) return this.productConstructionBuyEnabled ?
        { type: 'product-construction-buy', product } : null;
      if (!within(this.layout.productConstructionPanel)) return { type: 'product-construction-close', product };
      return null;
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
      const upgradeHit = getFactoryUpgradeHit(this, p);
      if (upgradeHit) return upgradeHit;
      if (touchTarget(this.layout.capacityBuy)) return this.capacityBuyEnabled ? { type: 'capacity-buy', lineId: this.upgradeLineId } : null;
      if (touchTarget(this.layout.outputBuy)) return this.outputBuyEnabled ? { type: 'output-buy', lineId: this.upgradeLineId } : null;
      if (!within(this.layout.upgradePanel) && !within(this.layout.upgradeTitle)) return { type: 'upgrade-close' };
      return null;
    }
    if (this.page === 'factory' && this.factoryOrderExpanded) {
      const orderWithin = rect => within({ ...rect, y: rect.y + 70 });
      if (within(this.layout.factoryOrderClose)) return { type: 'factory-order-close' };
      if (orderWithin(this.layout.orderArea)) {
        const orderId = this.visibleOrderId;
        if ((orderWithin(this.layout.orderCustomer) || this.visibleCustomerRect && orderWithin(this.visibleCustomerRect)) && this.visibleCustomerId)
          return { type: 'customer-open', customerId: this.visibleCustomerId };
        if (orderWithin(this.layout.orderPrevHit) && this.orderPreviousEnabled) return { type: 'order-prev', orderId };
        if (orderWithin(this.layout.orderNextHit) && this.orderNextEnabled) return { type: 'order-next', orderId };
        if (orderWithin(this.layout.deliver) && this.orderDeliverEnabled) return { type: 'deliver', orderId };
        return { type: 'order-swipe', orderId };
      }
      return { type: 'factory-order-close' };
    }
    if (within(this.layout.factoryNav)) return { type: 'page', page: 'factory' };
    if (within(this.layout.boardNav)) return { type: 'page', page: 'board' };
    if (within(this.layout.customersNav)) return { type: 'page', page: 'customers' };
    if (this.page === 'customers') return customerHitTest(this, p.x, p.y);
    if (this.customerResponseVisible) {
      if (within({ x: 327, y: 670, w: 44, h: 44 })) return { type: 'customer-response-close' };
      if (within({ x: 19, y: 670, w: 352, h: 99 })) return { type: 'customer-open', customerId: this.customerResponseId };
    }
    const orderWithin = r => within(r);
    if (this.page !== 'factory' && orderWithin(this.layout.orderArea)) {
      const orderId = this.visibleOrderId;
      if ((orderWithin(this.layout.orderCustomer) || this.visibleCustomerRect && orderWithin(this.visibleCustomerRect)) && this.visibleCustomerId) return { type: 'customer-open', customerId: this.visibleCustomerId };
      if (orderWithin(this.layout.orderPrevHit) && this.orderPreviousEnabled) return { type: 'order-prev', orderId };
      if (orderWithin(this.layout.orderNextHit) && this.orderNextEnabled) return { type: 'order-next', orderId };
      if (orderWithin(this.layout.deliver) && this.orderDeliverEnabled) return { type: 'deliver', orderId };
      return { type: 'order-swipe', orderId };
    }
    if (this.page === 'factory' && this.factoryDockExpanded && minimumHitArea(this.layout.upgradeOpen)) return { type: 'upgrade-open' };
    if (this.page === 'factory' && this.factoryDockExpanded && minimumHitArea(this.layout.accelerate)) return { type: 'accelerate' };
    if (this.page === 'factory' && this.factoryDockExpanded && minimumHitArea(this.layout.lineExpansionOpen)) {
      return { type: 'line-expansion-open', product: this.factorySelectedProduct, scrollable: false };
    }
    if (this.page === 'factory' && minimumHitArea(this.layout.sharedUpgradeOpen)) {
      return { type: 'shared-upgrade-open' };
    }
    if (this.page === 'factory') {
      if (minimumHitArea(this.layout.factoryOrder)) return { type: 'factory-order-open' };
      const navigationHit = hitFactoryNavigation(this, p);
      if (navigationHit) return navigationHit;
      if (within(this.layout.factoryDockToggle)) return { type: 'factory-dock-toggle' };
      if (within(this.layout.factoryMode)) return { type: 'factory-view-toggle', mode: this.factoryViewMode === 'overview' ? 'detail' : 'overview' };
      if (this.factoryViewMode === 'overview') return hitFactoryOverview(this, p) ||
        (within(this.layout.factorySceneViewport) ? { type: 'factory-scroll', scrollable: true } : null);
      if (within(this.layout.factoryHome)) return { type: 'factory-home' };
      if (this.factoryServiceFocus && within(this.layout.factoryService))
        return ['supply', 'packaging'].includes(this.factoryServiceFocus) ?
          { type: 'factory-service-open', service: this.factoryServiceFocus } : null;
      if (within(this.layout.factorySceneViewport) && this.factoryLayout) {
        const world = this.factoryCamera.designToWorld(p);
        const worldWithin = r => world.x >= r.x && world.x <= r.x + r.w && world.y >= r.y && world.y <= r.y + r.h;
        if (worldWithin({ ...this.factoryLayout.supply, h: this.factoryLayout.supply.h + 30 })) {
          return { type: 'shared-upgrade-open', service: 'supply', scrollable: true };
        }
        if (worldWithin({ ...this.factoryLayout.packaging, x: this.factoryLayout.packaging.x - 3,
          w: this.factoryLayout.packaging.w + 3, h: this.factoryLayout.packaging.h + 24 })) {
          return { type: 'shared-upgrade-open', service: 'packaging', scrollable: true };
        }
        if (worldWithin(this.factoryLayout.warehouse)) return { type: 'factory-overview-service', service: 'warehouse', scrollable: true };
        const cacheHit = rect => {
          const size = 44 / this.scale / this.factoryCamera.zoom;
          return { x: rect.x + rect.w / 2 - Math.max(rect.w, size) / 2,
            y: rect.y + rect.h / 2 - Math.max(rect.h, size) / 2, w: Math.max(rect.w, size), h: Math.max(rect.h, size) };
        };
        const cache = this.factoryLayout.scenes.find(scene => worldWithin(cacheHit(scene.cache)));
        if (cache) return { type: 'line', lineId: cache.lineId, part: 'cache', scrollable: true };
        const scene = [...this.factoryLayout.scenes].reverse().find(scene => worldWithin(scene.hit));
        if (scene) return { type: 'line', lineId: scene.lineId, part: 'machine', scrollable: true };
        const construction = this.factoryLayout.construction;
        if (construction && worldWithin(construction.hit || construction)) {
          return { type: 'product-construction-open', product: construction.product, scrollable: true };
        }
        const slot = this.factoryLayout.slots.find(slot => worldWithin(slot.hit || slot));
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
    if (this.page === 'board' && this.boardViewportActive) return boardCellRect(this, index);
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

  productName(product) { return PRODUCT_DEFINITIONS[product || 'original'].name; }

  workshopName(product) { return PRODUCT_DEFINITIONS[product].workshopName; }

  machineId(product) { return PRODUCT_DEFINITIONS[product].machineId; }

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
    this.image('ui/background-room', 0, factory ? -22 : 0, 390, factory ? 130 : 150);
    if (factory) {
      const view = this.layout.factoryViewport;
      this.roundRect(view.x, view.y, view.w, view.h, 12, '#ead7b5');
    }
  }

  header(state) {
    this.contain('ui/title-sign', 17, 41, 159, 67);
    this.text(state.page === 'factory' ? '工 厂' : state.page === 'customers' ? '顾 客' : '棋 盘', 96.5, 83, 26, COLORS.cream, 'center', true);
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
    this.visibleCustomerRect = { x: 51, y: 124, w: focused.requirements.length === 3 ? 38 : 50,
      h: focused.requirements.length === 3 ? 36 : 83 };
    const orders = model.getOrders(), index = orders.findIndex(order => order.id === focused.id);
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
    const threeProducts = requirements.length === 3;
    const info = model.customerInfo(order.customerId), customer = info.customer;
    const growth = info.progress;
    this.ctx.save(); this.ctx.translate(offset, 0);
    const area = this.layout.orderArea;
    this.slice('ui/panel-cream', area.x, area.y, area.w, area.h);
    this.slice('ui/portrait-well', 51, 126, threeProducts ? 38 : 50, threeProducts ? 33 : 81);
    this.contain('customer/' + customer.id, 51, 124, threeProducts ? 38 : 50, threeProducts ? 36 : 83);
    this.text(customer.name, 109, 133, 13, COLORS.text, 'left', true);
    this.text(growth.stars ? '★'.repeat(growth.stars) + '☆'.repeat(5 - growth.stars) : info.collected ? '已结识 · 零星' : '新面孔 · 未收录', 109, 149, 11, growth.stars ? '#a96c16' : COLORS.teal);
    requirements.forEach((requirement, itemIndex) => {
      const found = requirement.boardUnits === 1;
      const x = threeProducts ? 72 + itemIndex * 51 : requirements.length === 1 ? 136 : 109 + itemIndex * 62;
      this.contain('product/' + requirement.product + '/' + requirement.level, x, threeProducts ? 160 : 155, 47, 45);
      this.badge(requirement.level + '+', x + 26, threeProducts ? 183 : 179, 23, '#765238', 10);
      if (found) this.contain('icon/check', x - 2, threeProducts ? 182 : 178, 17, 17);
      this.text((found ? '1' : '0') + '/1', x + 24, threeProducts ? 210 : 207, 13, found ? COLORS.teal : COLORS.text, 'center', true);
    });
    this.ctx.strokeStyle = '#deccb3'; this.ctx.lineWidth = 1;
    this.ctx.beginPath(); this.ctx.moveTo(228, 128); this.ctx.lineTo(228, 207); this.ctx.stroke();
    this.contain('icon/coin', 236, 130, 24, 24);
    this.text('+' + order.reward, 264, 143, 17, COLORS.text, 'left', true);
    this.roundRect(328, 127, 33, 24, 7, '#e5d8bc');
    this.text((index + 1) + '/' + total, 344.5, 139, 12, COLORS.text, 'center', true);
    const status = progress.ready ? '交付' : progress.status === 'materials-ready' ? '材料够' : '待备料';
    this.button('ui/button-teal', status, this.layout.deliver, progress.ready);
    const forecast = order.kind === 'super' ? (growth.remaining === 1 ?
      '本单升' + growth.nextStar + '星' + (growth.nextGift ? ' +' + growth.nextGift : '') :
      '超级订单 ' + order.sequence + '/16') : info.collected ? '普通订单 · 赚金币' : '普通订单 · 结识';
    this.text(forecast, 279, 158, 11, COLORS.teal, 'center');
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
        if (item && item.kind === 'product' && item.level < CONFIG.maxProductLevel) {
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
        requirement.product === item.product && item.level >= requirement.level)) this.contain('board-state/cell-order-match', r.x - 4, r.y - 4, r.w + 8, r.h + 8);
      if (item && item.kind === 'product' && item.level < CONFIG.maxProductLevel && ((selected && selected.kind === 'product' &&
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
          from.product === target.product && from.level === target.level && from.level < CONFIG.maxProductLevel);
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
    if (isLauncher && line) subtitle = '出厂 Lv.' + line.outputLevel + ' · 库存 ' + displayStock(line.inventory);
    else if (item) {
      const matches = state.order.requirements.some(requirement => requirement.product === item.product && item.level >= requirement.level);
      subtitle = matches ? '棋盘成品可交付' : item.level >= CONFIG.maxProductLevel ? '已达最高 Lv.' + CONFIG.maxProductLevel : '同种同级二合一，可跨线合成';
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

  factoryScrollLimit() {
    const camera = this.factoryCamera;
    return camera.bounds ? Math.max(0, camera.bounds.h - camera.viewport.h / camera.zoom) : 0;
  }

  setFactoryScroll(value) {
    this.factoryCamera.setView({ y: value + this.factoryCamera.viewport.h / this.factoryCamera.zoom / 2 });
    this.factoryScroll = this.factoryCamera.visibleBounds().top;
  }

  stopFactoryScroll() {
    this.factoryScrollVelocity = 0;
    this.factoryScrollMotion = null;
    this.factoryPanVelocity = { x: 0, y: 0 };
    this.factoryCamera.stop();
    this.pendingFactoryFocus = null;
  }

  factoryScrollEnabled() {
    return this.page === 'factory' && !this.entryOpen && !this.upgradeDialogOpen &&
      !this.sharedUpgradeDialogOpen && !this.lineExpansionDialogOpen &&
      !this.productConstructionDialogOpen && !this.offlineSummaryOpen && !this.factoryOrderExpanded;
  }

  factoryGestureEnabled() { return this.factoryScrollEnabled(); }

  factoryScenePoint(x, y) {
    if (!this.factoryGestureEnabled()) return false;
    const hit = this.hitTest(x, y);
    return !!(hit && hit.scrollable);
  }

  panFactory(dx, dy) {
    if (!this.factoryGestureEnabled()) return;
    this.factoryFollowCancelled = true;
    this.factoryFocusKind = 'free';
    this.pendingFactoryServiceFocus = null;
    this.factoryPanVelocity = { x: 0, y: 0 };
    this.factoryCamera.panBy(dx / this.scale, dy / this.scale);
    this.factoryScroll = this.factoryCamera.visibleBounds().top;
  }

  beginFactoryPinch(x, y) {
    this.stopFactoryScroll();
    return { zoom: this.factoryCamera.zoom, world: this.factoryCamera.designToWorld(this.logicalPoint(x, y)) };
  }

  applyFactoryPinch(baseline, ratio, x, y) {
    if (!baseline || !this.factoryGestureEnabled() || !Number.isFinite(ratio) || ratio <= 0) return;
    const camera = this.factoryCamera, point = this.logicalPoint(x, y), view = camera.viewport;
    const zoom = Math.max(camera.minZoom, Math.min(camera.maxZoom, baseline.zoom * ratio));
    camera.setView({ zoom,
      x: baseline.world.x - (point.x - view.x - view.w / 2) / zoom,
      y: baseline.world.y - (point.y - view.y - view.h / 2) / zoom });
    this.factoryFollowCancelled = true;
    this.factoryFocusKind = 'free';
    this.pendingFactoryServiceFocus = null;
    this.factoryScroll = camera.visibleBounds().top;
    this.updateFactoryGestureMode();
  }

  zoomFactory(factor, x, y) {
    if (!this.factoryGestureEnabled()) return;
    this.stopFactoryScroll();
    this.factoryFollowCancelled = true;
    this.factoryFocusKind = 'free';
    this.pendingFactoryServiceFocus = null;
    this.factoryCamera.zoomAt(factor, this.logicalPoint(x, y));
    this.factoryScroll = this.factoryCamera.visibleBounds().top;
    this.updateFactoryGestureMode();
  }

  updateFactoryGestureMode() {
    const enter = Math.min(.34, this.factoryOverviewZoom() * 1.6), leave = enter * 1.25;
    const next = this.factoryViewMode === 'overview' ? this.factoryCamera.zoom >= leave ? 'detail' : 'overview' :
      this.factoryCamera.zoom <= enter ? 'overview' : 'detail';
    if (next === this.factoryViewMode) return;
    this.factoryViewMode = next;
    // A gesture already owns the camera. Only change labels and hit targets.
    this.factoryModeApplied = next;
    this.factoryServiceFocus = null;
  }

  scrollFactory(distance) {
    if (Number.isFinite(distance)) this.panFactory(0, -distance);
  }

  releaseFactoryPan(vx, vy) {
    this.stopFactoryScroll();
    if (!this.factoryGestureEnabled() || this.reducedMotion || !Number.isFinite(vx) || !Number.isFinite(vy) || Math.hypot(vx, vy) < 100) return;
    this.factoryPanVelocity = { x: Math.max(-1800, Math.min(1800, vx / this.scale)),
      y: Math.max(-1800, Math.min(1800, vy / this.scale)) };
  }

  releaseFactoryScroll(velocity) { this.releaseFactoryPan(0, -velocity * this.scale); }

  updateFactoryScroll(seconds) {
    if (!this.factoryGestureEnabled()) {
      this.stopFactoryScroll();
      return;
    }
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const camera = this.factoryCamera;
    camera.update(seconds);
    const velocity = this.factoryPanVelocity;
    if (!this.reducedMotion && (velocity.x || velocity.y)) {
      const decay = Math.exp(-7 * seconds), before = { x: camera.x, y: camera.y };
      camera.panBy(velocity.x * (1 - decay) / 7, velocity.y * (1 - decay) / 7);
      velocity.x = Math.abs(camera.x - before.x) < .0001 || Math.abs(velocity.x) < 12 ? 0 : velocity.x * decay;
      velocity.y = Math.abs(camera.y - before.y) < .0001 || Math.abs(velocity.y) < 12 ? 0 : velocity.y * decay;
    }
    this.factoryScroll = camera.visibleBounds().top;
  }

  focusFactoryRect(rect, immediate = false, zoom) {
    if (!rect) return;
    this.stopFactoryScroll();
    this.factoryFocusKind = 'device';
    this.factoryCamera.focusRect(rect, { duration: immediate || this.reducedMotion ? 0 : .28, zoom });
  }

  factoryOverviewZoom() {
    const bounds = this.factoryLayout && this.factoryLayout.bounds, view = this.layout.factorySceneViewport;
    return bounds ? Math.min((view.w - 24) / bounds.w, Math.max(30, view.h - 116) / bounds.h) : .1;
  }

  focusFactoryOverview(immediate = true) {
    if (!this.factoryLayout) return;
    this.factoryCamera.minZoom = this.factoryOverviewZoom();
    this.focusFactoryRect(this.factoryLayout.bounds, immediate, this.factoryCamera.minZoom);
    this.factoryFocusKind = 'overview';
  }

  focusLine(lineId, immediate = false) {
    this.stopFactoryScroll();
    const scene = this.factoryLayout && this.factoryLayout.scenes.find(scene => scene.lineId === lineId);
    if (!scene) {
      this.pendingFactoryFocus = lineId;
      return;
    }
    const group = this.factoryLayout.groups.find(group => group.product === scene.product);
    const bounds = group && group.bounds || scene.hit, view = this.layout.factorySceneViewport;
    const zoom = Math.min(1.05, (view.w - 36) / bounds.w, Math.max(30, view.h - 92) / bounds.h);
    const topInset = 48 / zoom;
    this.focusFactoryRect({ ...bounds, y: bounds.y - topInset, h: bounds.h + topInset }, immediate, zoom);
    this.factoryFocusKind = 'group';
  }

  captureFactoryView() {
    const c = this.factoryCamera;
    return { x: c.x, y: c.y, zoom: c.zoom, mode: this.factoryViewMode, service: this.factoryServiceFocus,
      part: this.factorySelectedPart, kind: this.factoryFocusKind };
  }

  restoreFactoryView(state) {
    if (!state) return;
    this.factoryViewMode = state.mode; this.factoryServiceFocus = state.service;
    this.factorySelectedPart = state.part; this.factoryFocusKind = state.kind;
    if (state.mode === 'overview') this.focusFactoryOverview(true);
    else if (state.kind === 'group') this.focusLine(this.lastFactorySelection, true);
    else this.factoryCamera.setView(state);
  }

  frameFactoryUpgrade(lineId) {
    const scene = this.factoryLayout && this.factoryLayout.scenes.find(scene => scene.lineId === lineId);
    if (!scene) return;
    const rect = scene.machine, view = this.layout.factorySceneViewport;
    const zoom = Math.min(.72, 90 / rect.h), targetY = view.y + 50;
    this.factoryCamera.setView({ zoom, x: rect.x + rect.w / 2,
      y: rect.y + rect.h / 2 + (view.y + view.h / 2 - targetY) / zoom }, { clamp: false });
  }

  factory(model, visual) { drawFactoryView(this, model, visual); }

  handleFactoryAction(model, hit) {
    if (hit.type === 'factory-dock-toggle' || hit.type === 'factory-order-open' || hit.type === 'factory-order-close' || hit.type === 'factory-home')
      return { ok: true, action: hit.type };
    if (hit.type === 'factory-view-toggle') return { ok: true, action: 'factory-view-toggle', mode: hit.mode };
    if (hit.type === 'factory-service-open') return { ok: true, action: 'shared-upgrade-open', service: hit.service };
    const overview = handleFactoryOverview(this, model, hit);
    if (overview) {
      if (overview.type === 'line') return model.selectLine(overview.lineId);
      if (overview.type === 'factory-focus-service') return { ok: true, action: 'factory-focus', service: overview.service };
      return { ok: true, action: overview.type, product: overview.product };
    }
    return handleFactoryNavigation(this, model, hit);
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

  upgradeDialog(model) { drawFactoryUpgrade(this, model); }

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
    this.contain('factory/' + this.machineId(product), 54, 263, 103, 87);
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
    const explanation = offer.maxed ? '本工坊' + offer.maxLines + '条产线均已投产' : !offer.hasSpace ? '棋盘已满，先腾出一格再建设' :
      !offer.affordable ? '还差 ' + (offer.cost - model.state.coins) + ' 金币' : '一级起步，现有流水线保留原规格';
    this.text(explanation, 195, 593, 14, offer.canBuy || offer.maxed ? COLORS.teal : COLORS.red, 'center');
    const label = offer.maxed ? '已投产' : !offer.hasSpace ? '先腾出棋盘空格' : !offer.affordable ? '金币不足' : '确认建设';
    this.button('ui/button-teal', label, this.layout.lineExpansionBuy, offer.canBuy);
    this.text('建设后自动生产，库存分别保存', 195, 697, 12, COLORS.muted, 'center');
  }

  productConstructionDialog(model, construction) {
    const product = construction.product, offer = construction.offer || model.productConstructionOffer(product);
    if (!offer) return;
    this.productConstructionProduct = product;
    this.productConstructionBuyEnabled = offer.canBuy;
    const r = this.layout.productConstructionPanel, close = this.layout.productConstructionClose;
    this.ctx.fillStyle = '#3f3028a8';
    this.ctx.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
    this.slice('ui/panel-cream', r.x, r.y, r.w, r.h);
    this.text('扩建' + this.workshopName(product), 195, 202, 23, COLORS.text, 'center', true);
    this.contain('ui/upgrade-button-close', close.x, close.y, close.w, close.h);
    this.slice('ui/upgrade-well-mint', 48, 230, 294, 112);
    this.contain('factory/' + this.machineId(product), 54, 240, 103, 88);
    this.text('新产品 · ' + this.productName(product), 171, 254, 16, COLORS.teal, 'left', true);
    this.text('首条产线 · 出厂 Lv.1', 171, 280, 13, COLORS.text);
    this.text('产能1档 · 独立库存', 171, 304, 13, COLORS.text);
    this.text('建好即自动生产，无需再次开机', 55, 367, 14, COLORS.text);
    this.contain('launcher/' + product + '/1', 55, 386, 37, 40);
    this.text('常驻发射器 ×1 · 占一个棋盘格', 102, 408, 13, COLORS.text);
    this.text('含公共供料与包装配套', 55, 449, 15, COLORS.text);
    this.text('保留已购公共升级，下一轮启用新配套', 55, 474, 13, COLORS.muted);
    this.text('库存从0开始，自动加工完成后入库', 55, 500, 13, COLORS.muted);
    this.contain('icon/coin', 103, 520, 28, 28);
    this.text('建设费用 ' + offer.cost, 141, 536, 20, COLORS.text, 'left', true);
    this.text('当前余额 ' + displayStock(model.state.coins), 195, 568, 14, COLORS.muted, 'center');
    const remaining = Math.max(0, offer.cost - model.state.coins);
    const built = offer.built || model.state.lines.some(line => line.product === product);
    const explanation = built ? '工坊已建成，自动生产中' : !offer.hasSpace ? '棋盘已满，先腾出一格再建设' :
      !offer.affordable ? '还差 ' + displayStock(remaining) + ' 金币' : offer.canBuy ? '首条产线与物流同时接入' : '暂时无法建设，请重新进入后重试';
    this.text(explanation, 195, 605, 14, offer.canBuy || built ? COLORS.teal : COLORS.red, 'center');
    if (!built && !offer.hasSpace && !offer.affordable) {
      this.text('还差 ' + displayStock(remaining) + ' 金币', 195, 632, 14, COLORS.red, 'center');
    } else {
      this.text(this.productName(product) + '订单将进入后续补单', 195, 632, 13, COLORS.muted, 'center');
    }
    const label = built ? '已建成' : !offer.hasSpace ? '先腾出棋盘空格' : !offer.affordable ? '金币不足' : '确认建设';
    const buy = this.layout.productConstructionBuy;
    this.slice('ui/upgrade-button-gold', buy.x, buy.y, buy.w, buy.h, offer.canBuy ? 1 : .5);
    this.text(label, buy.x + buy.w / 2, buy.y + buy.h / 2 - 1, 16,
      offer.canBuy ? COLORS.text : COLORS.muted, 'center', true);
  }

  navigation(state) {
    ['factory', 'board', 'customers'].forEach(page => {
      const active = state.page === page;
      const r = this.layout[page + 'Nav'];
      this.slice(active ? 'ui/nav-active' : 'ui/nav-idle', r.x, r.y, r.w, r.h);
      this.text(page === 'factory' ? '工厂' : page === 'board' ? '棋盘' : '顾客', r.x + r.w / 2, r.y + 27, 18, active ? COLORS.cream : '#79634d', 'center', true);
      if (page === 'customers' && this.customerUnreadCount) this.roundRect(r.x + r.w - 19, r.y + 10, 7, 7, 4, '#c17932');
    });
  }

  offlineDialog(summary, page = 0) {
    const entries = summary.producedByLine || [], firstStocked = summary.firstStockedProducts || [];
    const milestones = [];
    this.ctx.font = 'bold 15px "PingFang SC", "Microsoft YaHei", sans-serif';
    let names = '';
    firstStocked.forEach(product => {
      const name = this.productName(product), next = names ? names + '、' + name : name;
      if (names && this.ctx.measureText(next + '首次入库').width > 286) {
        milestones.push(names + '首次入库'); names = name;
      } else names = next;
    });
    if (names) milestones.push(names + '首次入库');
    this.offlinePageCount = Math.max(1, Math.ceil(entries.length / OFFLINE_PAGE_SIZE));
    this.offlinePageIndex = Math.max(0, Math.min(this.offlinePageCount - 1, Number.isFinite(page) ? Math.floor(page) : 0));
    const visibleEntries = entries.slice(this.offlinePageIndex * OFFLINE_PAGE_SIZE, (this.offlinePageIndex + 1) * OFFLINE_PAGE_SIZE);
    const rowExtra = Math.max(0, Math.min(entries.length, OFFLINE_PAGE_SIZE) - 2) * 75;
    const milestoneHeight = milestones.length * 30;
    const paginationHeight = this.offlinePageCount > 1 ? 56 : 0;
    const extra = rowExtra + milestoneHeight + paginationHeight;
    const r = { x: 27, y: 246 - extra / 2, w: 336, h: 360 + extra };
    const offset = r.y - 246;
    this.layout.offlinePanel = r;
    this.layout.offlineClose = { x: 61, y: 536 + offset + extra, w: 268, h: 48 };
    const pagerY = r.y + 235 + rowExtra + milestoneHeight;
    this.layout.offlinePrev = { x: 61, y: pagerY, w: 82, h: 44 };
    this.layout.offlineNext = { x: 247, y: pagerY, w: 82, h: 44 };
    this.ctx.fillStyle = '#3f3028a8';
    this.ctx.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
    this.slice('ui/panel-cream', r.x, r.y, r.w, r.h);
    this.text('欢迎回来', 195, 279 + offset, 23, COLORS.text, 'center', true);
    const minutes = Math.floor(summary.seconds / 60);
    const duration = minutes >= 60 ? Math.floor(minutes / 60) + '小时' + (minutes % 60 ? minutes % 60 + '分钟' : '') : minutes > 0 ? minutes + '分钟' : '不到1分钟';
    this.text('工厂自动生产了 ' + duration, 195, 307 + offset, 14, COLORS.muted, 'center');
    milestones.forEach((message, index) => this.text(message, 195, 333 + offset + index * 30, 15, COLORS.teal, 'center', true));
    visibleEntries.forEach((line, index) => {
      const y = 326 + offset + milestoneHeight + index * 75;
      this.roundRect(48, y, 294, 64, 10, '#eee1c8');
      this.contain('product/' + line.product + '/' + line.level, 56, y + 10, 47, 45);
      this.text(this.productName(line.product) + ' · ' + lineNumber(line.lineId) + '号线', 116, y + 20, 15, COLORS.text, 'left', true);
      this.text('出厂 Lv.' + line.level, 116, y + 44, 13, COLORS.muted);
      this.text('+' + displayStock(line.units) + '份', 326, y + 44, 18, COLORS.teal, 'right', true);
    });
    if (paginationHeight) {
      const previousEnabled = this.offlinePageIndex > 0, nextEnabled = this.offlinePageIndex + 1 < this.offlinePageCount;
      this.button('ui/button-teal', '上一页', this.layout.offlinePrev, previousEnabled);
      this.button('ui/button-teal', '下一页', this.layout.offlineNext, nextEnabled);
      this.text('第' + (this.offlinePageIndex + 1) + '/' + this.offlinePageCount + '页', 195, pagerY + 14, 14, COLORS.text, 'center', true);
      this.text('共' + entries.length + '条线', 195, pagerY + 34, 13, COLORS.muted, 'center');
    }
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
    if (this.customerResponseVisible) return;
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
      this.upgradeDialogOpen || this.lineExpansionDialogOpen || this.sharedUpgradeDialogOpen || this.productConstructionDialogOpen ? 52 : 724;
    this.roundRect((390 - w) / 2, y, w, 32, 10, '#493c2de8');
    this.text(value, 195, y + 16, 13, COLORS.cream, 'center');
    c.restore();
  }

  draw(model, visual = {}) {
    this.recovery = visual.recovery || null;
    if (visual.entry !== undefined) this.entryOpen = !!visual.entry;
    this.reducedMotion = !!visual.reducedMotion;
    this.entrySettingsOpen = this.entryOpen && !!visual.settingsOpen;
    if (this.entryOpen) {
      this.stopFactoryScroll();
      this.upgradeDialogOpen = false;
      this.lineExpansionDialogOpen = false;
      this.productConstructionDialogOpen = false;
      this.sharedUpgradeDialogOpen = false;
      this.offlineSummaryOpen = false;
      drawEntry(this, visual);
      return;
    }
    this.page = model.state.page || 'board';
    if (this.page !== 'factory') this.factoryOrderExpanded = false;
    this.upgradeDialogOpen = !!visual.upgradeDialog;
    this.lineExpansionDialogOpen = !!visual.lineExpansion;
    this.productConstructionDialogOpen = !!visual.productConstruction;
    this.sharedUpgradeDialogOpen = !!visual.sharedUpgrade;
    this.offlineSummaryOpen = !!visual.offlineSummary;
    this.updateFactoryScroll(visual.delta || 0);
    this.boardViewportActive = this.page === 'board' && !this.upgradeDialogOpen && !this.lineExpansionDialogOpen &&
      !this.productConstructionDialogOpen && !this.sharedUpgradeDialogOpen && !this.offlineSummaryOpen;
    if (this.boardViewportActive) {
      this.begin(); drawBoardView(this, model, visual); return;
    }
    this.begin();
    this.background(this.page === 'factory');
    this.ctx.save();
    if (this.page === 'factory') this.ctx.translate(0, -32);
    this.header(model.state);
    this.ctx.restore();
    if (this.page === 'factory') this.button('ui/button-teal', '配套', this.layout.sharedUpgradeOpen);
    this.customerUnreadCount = model.customerCollection().filter(info => info.unread).length;
    this.customerResponseVisible = !!visual.customerResponse && this.page !== 'customers';
    this.customerResponseId = visual.customerResponse == null ? undefined : visual.customerResponse.customerId;
    if (this.page === 'customers') drawCustomers(this, model, visual);
    else {
      if (this.page === 'factory') drawFactoryOrderSummary(this, model);
      else this.order(model, visual);
      const order = model.getOrder();
      this.visibleCustomerId = order == null ? undefined : order.customerId;
      if (this.visibleCustomerId) this.customerLastOrders[this.visibleCustomerId] = this.visibleOrderId;
      if (this.page === 'factory') this.factory(model, visual);
      else { this.board(model, visual); this.effects(visual, model); }
    }
    if (this.customerResponseVisible) drawCustomerResponse(this, visual.customerResponse);
    this.navigation(model.state);
    if (this.page === 'factory' && this.factoryOrderExpanded) {
      this.ctx.fillStyle = '#3f3028a8';
      this.ctx.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
      this.slice('ui/panel-cream', 12, 143, 366, 220);
      this.text('当前订单', 195, 169, 20, COLORS.text, 'center', true);
      this.ctx.save(); this.ctx.translate(0, 70);
      this.order(model, visual);
      this.ctx.restore();
      this.button('ui/button-teal', '收起订单', this.layout.factoryOrderClose);
    }
    if (this.upgradeDialogOpen) this.upgradeDialog(model);
    if (this.lineExpansionDialogOpen) this.lineExpansionDialog(model, visual.lineExpansion);
    if (this.productConstructionDialogOpen) this.productConstructionDialog(model, visual.productConstruction);
    if (this.sharedUpgradeDialogOpen) this.sharedUpgradeDialog(model, visual.sharedUpgrade);
    this.toast(visual);
    if (this.offlineSummaryOpen) this.offlineDialog(visual.offlineSummary, visual.offlinePage);
  }

}

module.exports = { Renderer, OFFLINE_PAGE_SIZE };
