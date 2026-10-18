'use strict';

const SHORT_HOLD_SECONDS = 0.4;
const HOLD_START_RATE = 5;
const HOLD_MAX_RATE = 15;
const HOLD_ACCEL_SECONDS = 3;
const HOLD_CATCHUP_SECONDS = 0.1;
const holdFireRate = seconds => HOLD_START_RATE + (HOLD_MAX_RATE - HOLD_START_RATE) *
  Math.max(0, Math.min(1, (seconds - SHORT_HOLD_SECONDS) / HOLD_ACCEL_SECONDS));
const DRAG_DISTANCE = 10;
const ORDER_SWIPE_DISTANCE = 42;
const SCROLL_SAMPLE_MS = 100;
const PINCH_DISTANCE = 4;
const touchId = touch => touch.identifier == null ? touch.id : touch.identifier;
const coordinate = (touch, axis) => {
  const client = axis === 'x' ? touch.clientX : touch.clientY;
  const screen = axis === 'x' ? touch.screenX : touch.screenY;
  return client == null ? (screen == null ? touch[axis] : screen) : client;
};

class Input {
  constructor(model, renderer, onAction, now = Date.now) {
    this.model = model;
    this.renderer = renderer;
    this.onAction = onAction;
    this.now = now;
    this.gesture = null;
    this.holdTimer = null;
    this.activeTouches = [];
    this.blockedUntilRelease = false;
  }
  contextKey() {
    const r = this.renderer;
    const board = r.boardFlow, protect = board?.protect;
    return [r.page, this.model.state.page, r.factoryViewMode, r.entryOpen, r.entrySettingsOpen,
      !!r.recovery, r.offlineSummaryOpen, r.productConstructionDialogOpen, r.sharedUpgradeDialogOpen,
      r.lineExpansionDialogOpen, r.upgradeDialogOpen, r.factoryOrderExpanded,
      board?.mode, board?.orderId, board?.product, board?.level, board?.revision,
      protect?.sourceId ?? protect?.preview?.sourceId, protect?.targetId ?? protect?.preview?.targetId].join('|');
  }
  validGesture(g) {
    return g.context === this.contextKey() && !this.dialogBlocksHit(g.hit) &&
      (!g.factoryScene || this.renderer.factoryGestureEnabled());
  }
  cancelUntilRelease(reason = 'context-changed') {
    const active = this.activeTouches;
    this.cancel(reason);
    this.activeTouches = active;
    this.blockedUntilRelease = active.length > 0;
  }
  finishPickup(g, reason = 'released') {
    if (!g?.lineId || g.pickupEnded || (!g.count && !g.stopReason)) return;
    g.pickupEnded = true;
    this.onAction({ ok: true, action: 'board-pickup-end', lineId: g.lineId,
      from: g.sourceIndex, sourceId: g.sourceId, count: g.count, reason: g.stopReason || reason });
  }
  clearHoldTimer() {
    if (this.holdTimer != null) clearTimeout(this.holdTimer);
    this.holdTimer = null;
  }
  scheduleHold(g) {
    this.clearHoldTimer();
    if (this.gesture !== g || !g?.lineId || g.stopped || g.dragging || this.blockedUntilRelease) return;
    const elapsed = Math.max(g.elapsed, (this.now() - g.holdStartedAt) / 1000);
    const delay = Math.max(1, Math.ceil((g.nextShot - elapsed) * 1000));
    // Fire deadlines must not wait for the next rendered frame. The frame loop
    // can also service a deadline; both paths share nextShot to avoid duplicates.
    this.holdTimer = setTimeout(() => {
      this.holdTimer = null;
      if (this.gesture !== g) return;
      this.update(1 / HOLD_MAX_RATE);
      if (this.gesture === g) this.scheduleHold(g);
    }, delay);
  }
  launchShot(g) {
    const item = this.model.state.board[g.sourceIndex];
    const result = item?.kind === 'launcher' && item.id === g.sourceId
      ? this.model.launch(g.lineId) : { ok: false, reason: 'missing-launcher' };
    if (result.ok) {
      g.count++;
      if (!this.model.state.board.some(cell => cell === null)) g.stopReason = 'board-full';
      else if (this.model.getLine(g.lineId)?.inventory < 1) g.stopReason = 'empty-inventory';
    } else g.stopReason = result.reason;
    if (g.stopReason) { g.stopped = true; this.clearHoldTimer(); }
    this.onAction({ ...result, action: 'launch', lineId: g.lineId, from: g.sourceIndex,
      sourceId: g.sourceId, count: g.count, pickupCount: g.count,
      pickupStopped: g.stopped, stopReason: g.stopReason, longPress: g.longPress,
      launchRate: g.longPress ? g.launchRate : null });
  }
  rebaseFactoryPointer(g, touch) {
    g.id = touchId(touch);
    g.x = g.startX = coordinate(touch, 'x');
    g.y = g.startY = coordinate(touch, 'y');
    g.secondaryId = null;
    g.pinch = null;
    g.scrolling = false;
    g.panSamples = [{ at: this.now(), x: g.x, y: g.y }];
  }
  addFactoryPointer(g, touches) {
    g.cancelClick = true;
    g.stopped = true;
    g.dragging = false;
    g.targetIndex = -1;
    if (!g.factoryScene) return;
    const primary = touches.find(touch => touchId(touch) === g.id);
    if (!primary) return;
    if (g.secondaryId == null) {
      const second = touches.find(touch => touchId(touch) !== g.id && !g.ignoredTouchIds.has(touchId(touch)));
      if (second) {
        g.secondaryId = touchId(second);
        const x = coordinate(second, 'x'), y = coordinate(second, 'y');
        if (this.renderer.factoryScenePoint(x, y)) {
          const px = coordinate(primary, 'x'), py = coordinate(primary, 'y');
          const midpoint = { x: (px + x) / 2, y: (py + y) / 2 };
          g.pinch = { distance: Math.hypot(px - x, py - y), midpoint, started: false,
            baseline: this.renderer.beginFactoryPinch(midpoint.x, midpoint.y) };
        }
        g.panSamples = [];
      }
    }
    touches.forEach(touch => {
      const id = touchId(touch);
      if (id !== g.id && id !== g.secondaryId) g.ignoredTouchIds.add(id);
    });
  }
  moveFactoryPointer(g, touches) {
    const primary = touches.find(touch => touchId(touch) === g.id);
    if (!primary) return;
    const previousX = g.x, previousY = g.y;
    g.x = coordinate(primary, 'x'); g.y = coordinate(primary, 'y');
    if (g.secondaryId != null) {
      const secondary = touches.find(touch => touchId(touch) === g.secondaryId);
      if (!secondary || !g.pinch) return;
      const x = coordinate(secondary, 'x'), y = coordinate(secondary, 'y');
      const midpoint = { x: (g.x + x) / 2, y: (g.y + y) / 2 };
      const distance = Math.hypot(g.x - x, g.y - y), pinch = g.pinch;
      if (pinch.distance < PINCH_DISTANCE) {
        if (distance >= PINCH_DISTANCE) {
          pinch.distance = distance; pinch.midpoint = midpoint;
          pinch.baseline = this.renderer.beginFactoryPinch(midpoint.x, midpoint.y);
        }
        return;
      }
      if (Math.abs(distance - pinch.distance) > PINCH_DISTANCE ||
          Math.hypot(midpoint.x - pinch.midpoint.x, midpoint.y - pinch.midpoint.y) > PINCH_DISTANCE) pinch.started = true;
      if (pinch.started) {
        this.renderer.applyFactoryPinch(pinch.baseline, distance / pinch.distance, midpoint.x, midpoint.y);
        // Rebase at the actual clamped camera so reversing after reaching a
        // zoom or pan limit responds immediately instead of undoing overshoot.
        pinch.distance = distance;
        pinch.midpoint = midpoint;
        pinch.baseline = this.renderer.beginFactoryPinch(midpoint.x, midpoint.y);
        g.scrolling = true;
      }
      return;
    }
    const dx = g.x - g.startX, dy = g.y - g.startY, distance = Math.hypot(dx, dy);
    if (!g.scrolling && distance <= DRAG_DISTANCE) return;
    const fraction = g.scrolling ? 1 : (distance - DRAG_DISTANCE) / distance;
    this.renderer.panFactory(g.scrolling ? g.x - previousX : dx * fraction,
      g.scrolling ? g.y - previousY : dy * fraction);
    g.scrolling = true; g.stopped = true;
    const at = this.now(), samples = g.panSamples, last = samples[samples.length - 1];
    if (last && last.at === at) { last.x = g.x; last.y = g.y; }
    else samples.push({ at, x: g.x, y: g.y });
    while (samples.length > 1 && samples[0].at < at - SCROLL_SAMPLE_MS) samples.shift();
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
    if (this.renderer.upgradeDialogOpen) return !['upgrade-close', 'capacity-buy', 'output-buy', 'upgrade-tab', 'upgrade-details'].includes(hit.type);
    if (this.renderer.factoryOrderExpanded) return !['factory-order-close', 'order-swipe', 'order-prev',
      'order-next', 'deliver', 'customer-open'].includes(hit.type);
    if (this.renderer.page === 'board' && this.renderer.boardFlow?.mode) return !hit.type.startsWith('board-');
    return false;
  }
  start(touches) {
    const points = Array.from(touches || []);
    this.activeTouches = points;
    if (!points.length || this.blockedUntilRelease) return;
    if (this.gesture) {
      if (!this.validGesture(this.gesture)) { this.cancelUntilRelease(); return; }
      if (points.length > 1) {
        if (this.renderer.page === 'board') this.cancelUntilRelease('multi-touch');
        else this.addFactoryPointer(this.gesture, points);
      }
      return;
    }
    // A rejected first contact (for example on a HUD gap) cannot become a
    // factory gesture when a later finger lands on a machine.
    this.renderer.stopFactoryScroll();
    this.renderer.factoryFollowCancelled = true;
    this.renderer.pendingFactoryServiceFocus = null;
    const touch = points[0], x = coordinate(touch, 'x'), y = coordinate(touch, 'y');
    const hit = this.renderer.hitTest(x, y);
    if (!hit || this.dialogBlocksHit(hit)) { this.blockedUntilRelease = true; return; }
    const factoryScene = typeof this.renderer.factoryScenePoint === 'function' && this.renderer.factoryScenePoint(x, y);
    this.gesture = { id: touchId(touch), hit, context: this.contextKey(), factoryScene,
      secondaryId: null, pinch: null, cancelClick: false, ignoredTouchIds: new Set(),
      panSamples: [{ at: this.now(), x, y }],
      startX: x, startY: y, x, y, holdStartedAt: this.now(), elapsed: 0, nextShot: SHORT_HOLD_SECONDS,
      dragging: false, longPress: false, stopped: false, count: 0, stopReason: null, pickupEnded: false,
      orderArea: ['order-swipe', 'order-prev', 'order-next', 'deliver'].includes(hit.type),
      orderDragging: false, orderDirection: 0,
      scrolling: false, scrollStart: (hit.boardScrollable ? this.renderer.boardFlow?.scroll :
        hit.customerScrollable ? this.renderer.customerScroll : this.renderer.factoryScroll) || 0,
      scrollSamples: [{ at: this.now(), position: this.renderer.factoryScroll }],
      sourceIndex: hit.type === 'cell' ? hit.index : -1, targetIndex: -1 };
    if (this.renderer.page === 'board' && points.length > 1) { this.cancelUntilRelease('multi-touch'); return; }
    if (hit.type === 'cell') {
      this.model.select(hit.index);
      const item = this.model.state.board[hit.index], g = this.gesture;
      if (item?.kind === 'launcher') {
        g.lineId = item.lineId; g.sourceId = item.id;
        const reason = !this.model.state.board.some(cell => cell === null) ? 'board-full' :
          this.model.getLine(item.lineId)?.inventory < 1 ? 'empty-inventory' : null;
        if (reason) {
          g.stopped = true; g.stopReason = reason;
          this.onAction({ ok: false, action: 'launch', reason, lineId: item.lineId,
            from: hit.index, sourceId: item.id, count: 0, pickupCount: 0, pickupStopped: true, stopReason: reason });
        }
      }
    }
    if (points.length > 1) this.addFactoryPointer(this.gesture, points);
    this.scheduleHold(this.gesture);
  }
  move(touches) {
    const points = Array.from(touches || []);
    this.activeTouches = points;
    const g = this.gesture;
    if (!g) return;
    if (!this.validGesture(g)) { this.cancelUntilRelease(); return; }
    if (this.renderer.page === 'board' && points.length > 1) { this.cancelUntilRelease('multi-touch'); return; }
    if (g.factoryScene) { this.moveFactoryPointer(g, points); return; }
    if (g.cancelClick) return;
    const touch = points.find(t => touchId(t) === g.id);
    if (!touch) return;
    const previousY = g.y;
    g.x = coordinate(touch, 'x');
    g.y = coordinate(touch, 'y');
    if (g.hit.boardScrollable) {
      const wasScrolling = g.scrolling, dx = g.x - g.startX, dy = g.y - g.startY;
      if (Math.hypot(dx, dy) > DRAG_DISTANCE) g.stopped = true;
      if (Math.abs(dy) > DRAG_DISTANCE && Math.abs(dy) > Math.abs(dx)) g.scrolling = true;
      if (g.scrolling) {
        const distance = wasScrolling ? previousY - g.y : -Math.sign(dy) * (Math.abs(dy) - DRAG_DISTANCE);
        this.renderer.setBoardScroll((this.renderer.boardFlow?.scroll || 0) + distance);
      }
      return;
    }
    if (g.orderArea) {
      const dx = g.x - g.startX, dy = g.y - g.startY;
      if (Math.hypot(dx, dy) > DRAG_DISTANCE) g.stopped = true;
      g.orderDragging = Math.abs(dx) > DRAG_DISTANCE && Math.abs(dx) > Math.abs(dy) * 1.2;
      g.orderDirection = g.orderDragging && Math.abs(dx) >= ORDER_SWIPE_DISTANCE ? (dx < 0 ? 1 : -1) : 0;
      return;
    }
    if (g.hit.scrollable || g.hit.customerScrollable) {
      const wasScrolling = g.scrolling;
      const dx = g.x - g.startX, dy = g.y - g.startY;
      if (g.hit.scrollable && Math.hypot(dx, dy) > DRAG_DISTANCE) g.stopped = true;
      if (g.hit.customerScrollable ? Math.hypot(dx, dy) > DRAG_DISTANCE :
          Math.abs(dy) > DRAG_DISTANCE && Math.abs(dy) > Math.abs(dx)) g.scrolling = true;
      if (g.scrolling) {
        g.stopped = true;
        if (g.hit.customerScrollable) {
          this.renderer.setCustomerScroll(g.scrollStart + (g.startY - g.y) / this.renderer.scale);
        } else {
          // Consume the gesture threshold once; subsequent movement is relative
          // to the clamped position, so reversing at either edge responds at once.
          const distance = wasScrolling ? previousY - g.y : -Math.sign(dy) * (Math.abs(dy) - DRAG_DISTANCE);
          const before = this.renderer.factoryScroll;
          this.renderer.setFactoryScroll(before + distance / this.renderer.scale);
          const movement = this.renderer.factoryScroll - before;
          const samples = g.scrollSamples, last = samples[samples.length - 1];
          if (movement && g.scrollDirection && Math.sign(movement) !== g.scrollDirection) {
            samples.splice(0, samples.length - 1);
          }
          if (movement) g.scrollDirection = Math.sign(movement);
          const at = this.now();
          if (last.at === at) last.position = this.renderer.factoryScroll;
          else samples.push({ at, position: this.renderer.factoryScroll });
          while (samples.length > 1 && samples[0].at < at - SCROLL_SAMPLE_MS) samples.shift();
        }
      }
      return;
    }
    if (g.hit.type === 'cell' && this.model.state.board[g.sourceIndex] &&
        Math.hypot(g.x - g.startX, g.y - g.startY) > DRAG_DISTANCE) {
      g.dragging = true; g.stopped = true;
      this.clearHoldTimer();
    }
    const target = this.renderer.hitTest(g.x, g.y);
    g.targetIndex = target && target.type === 'cell' ? target.index : -1;
  }
  update(seconds) {
    const g = this.gesture;
    if (!g) return;
    if (!this.validGesture(g)) { this.cancelUntilRelease(); return; }
    if (g.hit.type !== 'cell' || g.dragging || g.stopped) return;
    const item = this.model.state.board[g.sourceIndex];
    if (!item || item.kind !== 'launcher') return;
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    // Ramp by actual hold time, even when animation frames are throttled.
    const heldSeconds = (this.now() - g.holdStartedAt) / 1000;
    g.elapsed = Number.isFinite(heldSeconds) && heldSeconds >= g.elapsed ? heldSeconds
      : g.elapsed + Math.min(seconds, HOLD_CATCHUP_SECONDS);
    // Drop stale shot deadlines rather than replaying a slow frame's backlog.
    // A 0.1s window and the rate cap allow at most two shots in one frame.
    g.nextShot = Math.max(g.nextShot, g.elapsed - HOLD_CATCHUP_SECONDS);
    while (g.elapsed + 1e-8 >= g.nextShot && !g.stopped) {
      g.longPress = true;
      // Use the scheduled shot time so the ramp is independent of frame size.
      g.launchRate = holdFireRate(g.nextShot);
      this.launchShot(g);
      g.nextShot += 1 / g.launchRate;
      if (this.gesture !== g) return;
      if (!this.validGesture(g)) { this.cancelUntilRelease(); return; }
    }
  }
  end(touches, activeTouches) {
    const ended = Array.from(touches || []), endedIds = new Set(ended.map(touchId));
    const remaining = activeTouches == null ? this.activeTouches.filter(touch => !endedIds.has(touchId(touch))) :
      Array.from(activeTouches);
    this.activeTouches = remaining;
    if (!remaining.length) this.blockedUntilRelease = false;
    const g = this.gesture;
    if (!g) return;
    if (!this.validGesture(g)) { this.cancelUntilRelease(); return; }
    if (g.factoryScene) {
      const primaryEnded = endedIds.has(g.id), secondaryEnded = g.secondaryId != null && endedIds.has(g.secondaryId);
      if (!primaryEnded && !secondaryEnded) return;
      // Consume the last recorded positions before changing the pair. A third
      // touch is never promoted automatically when either tracked finger lifts.
      this.moveFactoryPointer(g, [...remaining, ...ended]);
      if (g.secondaryId != null) {
        const next = remaining.find(touch => touchId(touch) === g.id || touchId(touch) === g.secondaryId);
        if (next) { this.rebaseFactoryPointer(g, next); return; }
        this.gesture = null;
        this.blockedUntilRelease = remaining.length > 0;
        return;
      }
    }
    const touch = ended.find(t => touchId(t) === g.id);
    if (!touch) return;
    this.clearHoldTimer();
    if (!g.factoryScene) this.move([touch]);
    this.activeTouches = remaining;
    this.gesture = null;
    this.blockedUntilRelease = remaining.length > 0;
    if (g.longPress || g.stopped || g.dragging || g.cancelClick) this.finishPickup(g, g.dragging ? 'moved' : 'released');
    if (g.factoryScene && g.scrolling) {
      const samples = g.panSamples, first = samples[0], last = samples[samples.length - 1];
      const seconds = first && last ? (last.at - first.at) / 1000 : 0;
      if (!remaining.length && typeof this.renderer.releaseFactoryPan === 'function')
        this.renderer.releaseFactoryPan(seconds > 0 ? (last.x - first.x) / seconds : 0,
          seconds > 0 ? (last.y - first.y) / seconds : 0);
      return;
    }
    if (g.cancelClick) return;
    if (g.orderArea && g.stopped) {
      if (g.orderDirection && this.model.state.focusedOrderId === g.hit.orderId) {
        if (this.renderer.page === 'board') this.onAction({ ok: true,
          action: g.orderDirection < 0 ? 'board-order-prev' : 'board-order-next', orderId: g.hit.orderId });
        else this.onAction(this.model.cycleOrder(g.orderDirection));
      }
      return;
    }
    if (g.scrolling) {
      if (!g.hit.customerScrollable && !g.hit.boardScrollable) {
        const samples = g.scrollSamples, first = samples[0], last = samples[samples.length - 1];
        const seconds = (last.at - first.at) / 1000;
        this.renderer.releaseFactoryScroll(seconds > 0 ? (last.position - first.position) / seconds : 0);
      }
      return;
    }
    if (g.hit.scrollable && g.stopped) return;
    const endHit = this.renderer.hitTest(g.x, g.y);
    if (g.dragging) {
      if (g.targetIndex >= 0 && g.targetIndex !== g.sourceIndex) {
        const preview = this.model.previewDrop(g.sourceIndex, g.targetIndex);
        if (preview.kind === 'protected') this.onAction({ ok: true, action: 'board-protect',
          preview, from: g.sourceIndex, to: g.targetIndex, operation: 'merge' });
        else this.onAction(this.model.drop(g.sourceIndex, g.targetIndex));
      }
      return;
    }
    if (!endHit || endHit.type !== g.hit.type) return;
    if (g.hit.type.startsWith('board-')) {
      if (g.stopped || g.hit.type === 'board-scroll') return;
      for (const key of ['orderId', 'product', 'level', 'lineId', 'itemId', 'index', 'page', 'customerId', 'requirementIndex']) {
        if (g.hit[key] !== endHit[key]) return;
      }
      this.onAction({ ok: true, action: endHit.type, ...endHit });
      return;
    }
    if (g.hit.type.startsWith('factory-')) {
      for (const key of ['product', 'lineId', 'fromLineId', 'service', 'mode']) {
        if (g.hit[key] !== endHit[key]) return;
      }
      const result = this.renderer.handleFactoryAction(this.model, endHit);
      if (result) this.onAction(result);
      return;
    }
    if (g.hit.type === 'upgrade-tab' || g.hit.type === 'upgrade-details') {
      if (g.hit.tab !== endHit.tab) return;
      this.onAction({ ok: true, action: g.hit.type, tab: g.hit.tab });
      return;
    }
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
      if (item && item.kind === 'launcher' && !g.longPress && !g.stopped) {
        this.launchShot(g);
        this.finishPickup(g);
      }
    } else if (g.hit.type === 'page' && g.hit.page === endHit.page) {
      this.model.setPage(g.hit.page); this.onAction({ ok: true, action: 'page' });
    } else if (g.hit.type === 'order-prev' || g.hit.type === 'order-next') {
      if (this.model.state.focusedOrderId === g.hit.orderId) {
        if (this.renderer.page === 'board') this.onAction({ ok: true,
          action: g.hit.type === 'order-prev' ? 'board-order-prev' : 'board-order-next', orderId: g.hit.orderId });
        else this.onAction(this.model.cycleOrder(g.hit.type === 'order-prev' ? -1 : 1));
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
    else if (g.hit.type === 'deliver') this.onAction(this.renderer.page === 'board'
      ? { ok: true, action: 'board-deliver', orderId: g.hit.orderId } : this.model.deliver(g.hit.orderId));
    else if (g.hit.type === 'discard') this.onAction(this.renderer.page === 'board'
      ? { ok: true, action: 'board-discard', index: this.model.state.selectedCell } : this.model.discard(this.model.state.selectedCell));
    else if (g.hit.type === 'upgrade-open') this.onAction({ ok: true, action: 'upgrade-open' });
    else if (g.hit.type === 'upgrade-close') this.onAction({ ok: true, action: 'upgrade-close' });
    else if (g.hit.type === 'capacity-buy') this.onAction(this.model.upgradeCapacity(g.hit.lineId));
    else if (g.hit.type === 'output-buy') this.onAction(this.model.upgradeOutput(g.hit.lineId));
  }
  scroll(distance, points, modifiers = {}) {
    if (this.renderer.page === 'board') {
      const point = points?.[0];
      if (!point || modifiers.ctrlKey || this.renderer.entryOpen || this.renderer.offlineSummaryOpen ||
          this.renderer.recovery || typeof this.renderer.setBoardScroll !== 'function') return false;
      const hit = this.renderer.hitTest(coordinate(point, 'x'), coordinate(point, 'y'));
      if (!hit?.boardScrollable || this.dialogBlocksHit(hit)) return false;
      this.cancelUntilRelease('scroll');
      this.renderer.setBoardScroll((this.renderer.boardFlow?.scroll || 0) + distance);
      return true;
    }
    if (this.renderer.entryOpen || !['factory', 'customers'].includes(this.renderer.page) || this.renderer.upgradeDialogOpen ||
        this.renderer.sharedUpgradeDialogOpen ||
        this.renderer.productConstructionDialogOpen ||
        this.renderer.lineExpansionDialogOpen || this.renderer.offlineSummaryOpen || this.renderer.factoryOrderExpanded) return false;
    if (modifiers.ctrlKey) {
      const point = points && points[0];
      if (this.renderer.page !== 'factory' || !point || typeof this.renderer.zoomFactory !== 'function' ||
          typeof this.renderer.factoryScenePoint !== 'function') return false;
      const x = coordinate(point, 'x'), y = coordinate(point, 'y');
      if (!this.renderer.factoryScenePoint(x, y)) return false;
      this.gesture = null;
      this.blockedUntilRelease = this.activeTouches.length > 0;
      this.renderer.factoryFollowCancelled = true;
      this.renderer.pendingFactoryServiceFocus = null;
      this.renderer.zoomFactory(Math.exp(-distance * .002), x, y);
      return true;
    }
    if (this.renderer.page === 'factory' && points && points.length) {
      const hit = this.renderer.hitTest(coordinate(points[0], 'x'), coordinate(points[0], 'y'));
      if (!hit || !hit.scrollable) return false;
    }
    this.gesture = null;
    this.blockedUntilRelease = this.activeTouches.length > 0;
    if (this.renderer.page === 'customers') this.renderer.setCustomerScroll((this.renderer.customerScroll || 0) + distance / this.renderer.scale);
    else this.renderer.scrollFactory(distance);
    return true;
  }
  cancel(reason = 'cancelled') {
    this.clearHoldTimer();
    const g = this.gesture;
    this.gesture = null;
    this.activeTouches = [];
    this.blockedUntilRelease = false;
    this.renderer.stopFactoryScroll();
    this.finishPickup(g, reason);
  }
}

module.exports = { Input };
