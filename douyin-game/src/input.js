'use strict';

const SHORT_HOLD_SECONDS = 0.4;
const REPEAT_SECONDS = 0.2;
const DRAG_DISTANCE = 10;
const ORDER_SWIPE_DISTANCE = 42;
const coordinate = (touch, axis) => {
  const client = axis === 'x' ? touch.clientX : touch.clientY;
  const screen = axis === 'x' ? touch.screenX : touch.screenY;
  return client == null ? (screen == null ? touch[axis] : screen) : client;
};

class Input {
  constructor(model, renderer, onAction) {
    this.model = model;
    this.renderer = renderer;
    this.onAction = onAction;
    this.gesture = null;
  }
  dialogBlocksHit(hit) {
    if (this.renderer.recovery) {
      return !(this.renderer.recovery.confirm ? ['entry-recovery-confirm', 'entry-recovery-cancel'] :
        ['entry-recovery-retry', 'entry-recovery-new']).includes(hit.type);
    }
    if (this.renderer.entryOpen) {
      if (this.renderer.entrySettingsOpen) return !['entry-settings-close', 'entry-motion-toggle'].includes(hit.type);
      return !['entry-enter', 'entry-settings-open'].includes(hit.type);
    }
    if (hit.type.startsWith('entry-')) return true;
    if (this.renderer.offlineSummaryOpen) return !['offline-close', 'offline-prev', 'offline-next'].includes(hit.type);
    if (this.renderer.productConstructionDialogOpen) return !['product-construction-close', 'product-construction-buy'].includes(hit.type);
    if (this.renderer.sharedUpgradeDialogOpen) return !['shared-upgrade-close', 'shared-upgrade-buy'].includes(hit.type);
    if (this.renderer.lineExpansionDialogOpen) return !['line-expansion-close', 'line-expansion-buy'].includes(hit.type);
    return this.renderer.upgradeDialogOpen && !['upgrade-close', 'capacity-buy', 'output-buy'].includes(hit.type);
  }
  start(touches) {
    if (this.gesture || !touches || !touches.length) return;
    const touch = touches[0], x = coordinate(touch, 'x'), y = coordinate(touch, 'y');
    const hit = this.renderer.hitTest(x, y);
    if (!hit || this.dialogBlocksHit(hit)) return;
    this.gesture = { id: touch.identifier == null ? touch.id : touch.identifier, hit,
      startX: x, startY: y, x, y, elapsed: 0, nextShot: SHORT_HOLD_SECONDS,
      dragging: false, longPress: false, stopped: false,
      orderArea: ['order-swipe', 'order-prev', 'order-next', 'deliver'].includes(hit.type),
      orderDragging: false, orderDirection: 0,
      scrolling: false, scrollStart: (hit.customerScrollable ? this.renderer.customerScroll : this.renderer.factoryScroll) || 0,
      sourceIndex: hit.type === 'cell' ? hit.index : -1, targetIndex: -1 };
    if (hit.type === 'cell') this.model.select(hit.index);
  }
  move(touches) {
    const g = this.gesture;
    if (!g) return;
    if (this.dialogBlocksHit(g.hit)) { this.cancel(); return; }
    const touch = Array.from(touches || []).find(t => (t.identifier == null ? t.id : t.identifier) === g.id);
    if (!touch) return;
    g.x = coordinate(touch, 'x');
    g.y = coordinate(touch, 'y');
    if (g.orderArea) {
      const dx = g.x - g.startX, dy = g.y - g.startY;
      if (Math.hypot(dx, dy) > DRAG_DISTANCE) g.stopped = true;
      g.orderDragging = Math.abs(dx) > DRAG_DISTANCE && Math.abs(dx) > Math.abs(dy) * 1.2;
      g.orderDirection = g.orderDragging && Math.abs(dx) >= ORDER_SWIPE_DISTANCE ? (dx < 0 ? 1 : -1) : 0;
      return;
    }
    if (g.hit.scrollable || g.hit.customerScrollable) {
      if (Math.hypot(g.x - g.startX, g.y - g.startY) > DRAG_DISTANCE) g.scrolling = true;
      if (g.scrolling) {
        g.stopped = true;
        const scroll = g.scrollStart + (g.startY - g.y) / this.renderer.scale;
        if (g.hit.customerScrollable) this.renderer.setCustomerScroll(scroll);
        else this.renderer.setFactoryScroll(scroll);
      }
      return;
    }
    if (g.hit.type === 'cell' && this.model.state.board[g.sourceIndex] &&
        Math.hypot(g.x - g.startX, g.y - g.startY) > DRAG_DISTANCE) {
      g.dragging = true; g.stopped = true;
    }
    const target = this.renderer.hitTest(g.x, g.y);
    g.targetIndex = target && target.type === 'cell' ? target.index : -1;
  }
  update(seconds) {
    const g = this.gesture;
    if (!g || g.hit.type !== 'cell' || g.dragging || g.stopped) return;
    if (this.dialogBlocksHit(g.hit)) { this.cancel(); return; }
    const item = this.model.state.board[g.sourceIndex];
    if (!item || item.kind !== 'launcher') return;
    g.elapsed += seconds;
    while (g.elapsed + 1e-8 >= g.nextShot && !g.stopped) {
      g.longPress = true;
      const result = this.model.launch(item.lineId);
      this.onAction(result);
      g.nextShot += REPEAT_SECONDS;
      if (!result.ok) g.stopped = true;
    }
  }
  end(touches) {
    const g = this.gesture;
    if (!g) return;
    if (this.dialogBlocksHit(g.hit)) { this.cancel(); return; }
    const touch = Array.from(touches || []).find(t => (t.identifier == null ? t.id : t.identifier) === g.id);
    if (!touch) return;
    this.move([touch]);
    this.gesture = null;
    if (g.orderArea && g.stopped) {
      if (g.orderDirection && this.model.state.focusedOrderId === g.hit.orderId) {
        this.onAction(this.model.cycleOrder(g.orderDirection));
      }
      return;
    }
    if (g.scrolling) return;
    const endHit = this.renderer.hitTest(g.x, g.y);
    if (g.dragging) {
      if (g.targetIndex >= 0 && g.targetIndex !== g.sourceIndex) this.onAction(this.model.drop(g.sourceIndex, g.targetIndex));
      return;
    }
    if (!endHit || endHit.type !== g.hit.type) return;
    if (g.orderArea && g.hit.orderId !== endHit.orderId) return;
    if ((g.hit.type === 'capacity-buy' || g.hit.type === 'output-buy') &&
        (g.hit.lineId !== endHit.lineId || g.hit.lineId !== this.model.state.selectedLineId)) return;
    if (g.hit.type === 'shared-upgrade-buy' && (g.hit.service !== endHit.service ||
        g.hit.level !== endHit.level || this.model.sharedUpgradeOffer(g.hit.service)?.level !== g.hit.level)) return;
    if (g.hit.type.startsWith('entry-')) {
      this.onAction({ ok: true, action: g.hit.type });
    } else if (g.hit.type.startsWith('customer-')) {
      if (g.hit.customerId !== endHit.customerId || g.hit.recordKey !== endHit.recordKey) return;
      if (g.hit.type !== 'customer-scroll') this.onAction({ ok: true, action: g.hit.type,
        customerId: g.hit.customerId, recordKey: g.hit.recordKey, expanded: g.hit.expanded });
    } else if (g.hit.type === 'cell') {
      if (endHit.index !== g.hit.index) return;
      const item = this.model.state.board[g.hit.index];
      if (item && item.kind === 'launcher' && !g.longPress) this.onAction(this.model.launch(item.lineId));
    } else if (g.hit.type === 'page' && g.hit.page === endHit.page) {
      this.model.setPage(g.hit.page); this.onAction({ ok: true, action: 'page' });
    } else if (g.hit.type === 'order-prev' || g.hit.type === 'order-next') {
      if (this.model.state.focusedOrderId === g.hit.orderId) {
        this.onAction(this.model.cycleOrder(g.hit.type === 'order-prev' ? -1 : 1));
      }
    } else if (g.hit.type === 'offline-close') {
      this.onAction({ ok: true, action: 'offline-close' });
    } else if ((g.hit.type === 'offline-prev' || g.hit.type === 'offline-next') && g.hit.page === endHit.page) {
      this.onAction({ ok: true, action: g.hit.type, page: g.hit.page });
    } else if (g.hit.type === 'shared-upgrade-open' && g.hit.service === endHit.service) {
      this.onAction({ ok: true, action: 'shared-upgrade-open', service: g.hit.service });
    } else if (g.hit.type === 'shared-upgrade-close') {
      this.onAction({ ok: true, action: 'shared-upgrade-close' });
    } else if (g.hit.type === 'shared-upgrade-buy') {
      this.onAction(this.model.upgradeShared(g.hit.service));
    } else if (g.hit.type === 'line-expansion-open' && g.hit.product === endHit.product) {
      this.onAction({ ok: true, action: 'line-expansion-open', product: g.hit.product });
    } else if (g.hit.type === 'line-expansion-close') {
      this.onAction({ ok: true, action: 'line-expansion-close' });
    } else if (g.hit.type === 'line-expansion-buy' && g.hit.product === endHit.product) {
      this.onAction(this.model.buyLine(g.hit.product));
    } else if (g.hit.type === 'product-construction-open' && g.hit.product === endHit.product) {
      this.onAction({ ok: true, action: 'product-construction-open', product: g.hit.product });
    } else if (g.hit.type === 'product-construction-close') {
      this.onAction({ ok: true, action: 'product-construction-close' });
    } else if (g.hit.type === 'product-construction-buy' && g.hit.product === endHit.product) {
      this.onAction(this.model.buildProduct(g.hit.product));
    } else if (g.hit.type === 'line' && g.hit.lineId === endHit.lineId) this.onAction(this.model.selectLine(g.hit.lineId));
    else if (g.hit.type === 'accelerate') this.onAction(this.model.accelerate());
    else if (g.hit.type === 'deliver') this.onAction(this.model.deliver(g.hit.orderId));
    else if (g.hit.type === 'discard') this.onAction(this.model.discard(this.model.state.selectedCell));
    else if (g.hit.type === 'upgrade-open') this.onAction({ ok: true, action: 'upgrade-open' });
    else if (g.hit.type === 'upgrade-close') this.onAction({ ok: true, action: 'upgrade-close' });
    else if (g.hit.type === 'capacity-buy') this.onAction(this.model.upgradeCapacity(g.hit.lineId));
    else if (g.hit.type === 'output-buy') this.onAction(this.model.upgradeOutput(g.hit.lineId));
  }
  scroll(distance) {
    if (this.renderer.entryOpen || !['factory', 'customers'].includes(this.renderer.page) || this.renderer.upgradeDialogOpen ||
        this.renderer.sharedUpgradeDialogOpen ||
        this.renderer.productConstructionDialogOpen ||
        this.renderer.lineExpansionDialogOpen || this.renderer.offlineSummaryOpen) return false;
    this.cancel();
    if (this.renderer.page === 'customers') this.renderer.setCustomerScroll((this.renderer.customerScroll || 0) + distance / this.renderer.scale);
    else this.renderer.scrollFactory(distance);
    return true;
  }
  cancel() { this.gesture = null; }
}

module.exports = { Input };
