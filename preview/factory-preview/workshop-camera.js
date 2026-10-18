const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const rectOf = (value = {}) => ({ x: finite(value.x, 0), y: finite(value.y, 0),
  w: Math.max(1, finite(value.w, 1)), h: Math.max(1, finite(value.h, 1)) });
const DRAG_THRESHOLD = 8;
const PINCH_THRESHOLD = 4;
const OVERVIEW_PADDING = 20;
const ZOOM_EPSILON = 1e-6;

// Camera coordinates are unscaled world pixels. Client points are converted
// directly through the viewport's real CSS bounds, including an outer zoom.
export class WorkshopCamera {
  constructor(viewport, world, { onChange, onActivate } = {}) {
    this.viewport = viewport;
    this.world = world;
    this.onChange = onChange;
    this.onActivate = onActivate;
    this.maxZoom = 1.6;
    this._zoom = 1;
    this._mode = 'detail';
    this.bounds = rectOf({ w: world.offsetWidth || 1000, h: world.offsetHeight || 1500 });
    this.x = this.bounds.x + this.bounds.w / 2;
    this.y = this.bounds.y + this.bounds.h / 2;
    this.pointers = new Map();
    this.gesture = null;
    this._fitTarget = null;
    this._suppressClickUntil = 0;
    this._listeners = [];
    viewport.style.touchAction = 'none';
    viewport.style.overflow = 'hidden';
    world.style.transformOrigin = '0 0';
    world.style.zoom = '1';
    world.style.willChange = 'transform';
    this.width = Math.max(1, viewport.clientWidth);
    this.height = Math.max(1, viewport.clientHeight);
    this._updateMinimumZoom();
    this._bind();
    this._apply();
    if (typeof ResizeObserver !== 'undefined') {
      this._observer = new ResizeObserver(() => this.resize());
      this._observer.observe(viewport);
    }
  }

  get mode() { return this._mode; }
  get zoom() { return this._zoom; }

  getState() { return { x: this.x, y: this.y, zoom: this._zoom, mode: this._mode,
    minZoom: this.minZoom, maxZoom: this.maxZoom }; }

  worldToViewport(point) {
    return { x: this.width / 2 + (point.x - this.x) * this._zoom,
      y: this.height / 2 + (point.y - this.y) * this._zoom };
  }

  setState(state = {}) {
    this._cancel();
    this.x = finite(state.x, this.x);
    this.y = finite(state.y, this.y);
    this._zoom = clamp(finite(state.zoom, this._zoom), this.minZoom, this.maxZoom);
    if (state.mode) this._mode = state.mode === 'overview' ? 'overview' : 'detail';
    this._fitTarget = this._mode === 'overview' ? { rect: { ...this.bounds }, padding: 20 } : null;
    this._apply();
    return this;
  }

  setBounds(bounds) {
    const atMinimum = this._zoom <= this.minZoom + ZOOM_EPSILON;
    this._cancel();
    this.bounds = rectOf(bounds);
    this._updateMinimumZoom(atMinimum);
    if (atMinimum && this._fitTarget)
      this._fitTarget = { rect: { ...this.bounds }, padding: OVERVIEW_PADDING };
    this._apply();
    return this;
  }

  resize() {
    const width = Math.max(1, this.viewport.clientWidth), height = Math.max(1, this.viewport.clientHeight);
    if (width === this.width && height === this.height) return this;
    const atMinimum = this._zoom <= this.minZoom + ZOOM_EPSILON;
    this._cancel();
    this.width = width;
    this.height = height;
    this._updateMinimumZoom(atMinimum);
    if (atMinimum) {
      if (this._fitTarget)
        this._fitTarget = { rect: { ...this.bounds }, padding: OVERVIEW_PADDING };
      this._apply();
      return this;
    }
    if (this._fitTarget)
      return this.fit(this._fitTarget.rect, { padding: this._fitTarget.padding, mode: this._mode });
    this._apply();
    return this;
  }

  setMode(mode) {
    this._mode = mode === 'overview' ? 'overview' : 'detail';
    if (this._mode !== 'overview') this._fitTarget = null;
    this._apply();
    return this;
  }

  fit(rect = this.bounds, { padding = 20, mode = 'overview' } = {}) {
    this._cancel();
    rect = rectOf(rect);
    padding = Math.max(0, finite(padding, 20));
    this._zoom = clamp(Math.min(Math.max(1, this.width - padding * 2) / rect.w,
      Math.max(1, this.height - padding * 2) / rect.h), this.minZoom, this.maxZoom);
    this.x = rect.x + rect.w / 2;
    this.y = rect.y + rect.h / 2;
    this._mode = mode === 'overview' ? 'overview' : 'detail';
    this._fitTarget = this._mode === 'overview' ? { rect, padding } : null;
    this._apply();
    return this;
  }

  focus(rect, { zoom, padding = 24, mode = 'detail' } = {}) {
    this._cancel();
    rect = rectOf(rect);
    padding = Math.max(0, finite(padding, 24));
    const fitZoom = Math.min(Math.max(1, this.width - padding * 2) / rect.w,
      Math.max(1, this.height - padding * 2) / rect.h);
    this._zoom = clamp(finite(zoom, Math.max(.65, Math.min(1.05, fitZoom))), this.minZoom, this.maxZoom);
    this.x = rect.x + rect.w / 2;
    this.y = rect.y + rect.h / 2;
    this._mode = mode === 'overview' ? 'overview' : 'detail';
    this._fitTarget = this._mode === 'overview' ? { rect, padding } : null;
    this._apply();
    return this;
  }

  zoomBy(factor, anchor) {
    if (!Number.isFinite(factor) || factor <= 0) return this;
    const point = anchor ? this._local(anchor) : { x: this.width / 2, y: this.height / 2 };
    const world = this._toWorld(point);
    this._activate('zoom');
    this._zoom = clamp(this._zoom * factor, this.minZoom, this.maxZoom);
    this.x = world.x - (point.x - this.width / 2) / this._zoom;
    this.y = world.y - (point.y - this.height / 2) / this._zoom;
    this._apply();
    return this;
  }

  _local(point) {
    const rect = this.viewport.getBoundingClientRect();
    return { x: (finite(point.clientX, point.x) - rect.left) * this.width / Math.max(1, rect.width),
      y: (finite(point.clientY, point.y) - rect.top) * this.height / Math.max(1, rect.height) };
  }

  _toWorld(point) {
    return { x: this.x + (point.x - this.width / 2) / this._zoom,
      y: this.y + (point.y - this.height / 2) / this._zoom };
  }

  _updateMinimumZoom(stickToMinimum = false) {
    // The full site is the furthest useful view, even when the initial view
    // frames only the built lines. Keep its screen-space margin on resize.
    this.minZoom = Math.min(this.maxZoom,
      Math.max(1, this.width - OVERVIEW_PADDING * 2) / this.bounds.w,
      Math.max(1, this.height - OVERVIEW_PADDING * 2) / this.bounds.h);
    this._zoom = stickToMinimum ? this.minZoom : clamp(this._zoom, this.minZoom, this.maxZoom);
  }

  _constrain() {
    const bounds = this.bounds, visibleW = this.width / this._zoom, visibleH = this.height / this._zoom;
    const padding = 24 / this._zoom;
    this.x = bounds.w <= visibleW ? bounds.x + bounds.w / 2 :
      clamp(this.x, bounds.x + visibleW / 2 - padding, bounds.x + bounds.w - visibleW / 2 + padding);
    this.y = bounds.h <= visibleH ? bounds.y + bounds.h / 2 :
      clamp(this.y, bounds.y + visibleH / 2 - padding, bounds.y + bounds.h - visibleH / 2 + padding);
  }

  _apply() {
    this._constrain();
    this.world.style.transform = `translate(${this.width / 2 - this.x * this._zoom}px, ${this.height / 2 - this.y * this._zoom}px) scale(${this._zoom})`;
    this.viewport.dataset.cameraMode = this._mode;
    this.viewport.dataset.cameraZoom = this._zoom.toFixed(4);
    this.onChange?.(this.getState());
  }

  _activate(type) {
    this._mode = 'detail';
    this._fitTarget = null;
    if (!this.gesture || !this.gesture.activated) {
      if (this.gesture) this.gesture.activated = true;
      this.onActivate?.({ type, ...this.getState() });
    }
  }

  _pan(dx, dy) {
    this._activate('pan');
    this.x -= dx / this._zoom;
    this.y -= dy / this._zoom;
    this._apply();
  }

  _blockClick() { this._suppressClickUntil = Date.now() + 800; }

  _capture(id) {
    try { this.viewport.setPointerCapture(id); } catch { /* Pointer may already have ended. */ }
  }

  _release(id) {
    try {
      if (this.viewport.hasPointerCapture(id)) this.viewport.releasePointerCapture(id);
    } catch { /* A browser cancellation can release capture first. */ }
  }

  _pinchBaseline(gesture) {
    const a = this.pointers.get(gesture.primary), b = this.pointers.get(gesture.secondary);
    if (!a || !b) return null;
    const midpoint = { clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 };
    return { midpoint, distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      world: this._toWorld(this._local(midpoint)), zoom: this._zoom };
  }

  _down(event) {
    if (event.button !== 0 || this.pointers.has(event.pointerId) ||
        event.target.closest?.('input,select,textarea,[contenteditable="true"]')) return;
    if (!this.pointers.size) {
      this._suppressClickUntil = 0;
      this.gesture = { primary: event.pointerId, secondary: null, ignored: new Set(),
        startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY,
        dragging: false, multiple: false, activated: false };
    }
    this.pointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    const gesture = this.gesture;
    if (!gesture || gesture.primary == null) { this._blockClick(); return; }
    if (event.pointerId !== gesture.primary && gesture.secondary == null && !gesture.ignored.has(event.pointerId)) {
      gesture.secondary = event.pointerId;
      gesture.multiple = true;
      gesture.pinchStarted = false;
      gesture.pinch = this._pinchBaseline(gesture);
      this._blockClick();
      this._capture(gesture.primary); this._capture(gesture.secondary);
      if (event.cancelable) event.preventDefault();
    } else if (event.pointerId !== gesture.primary && event.pointerId !== gesture.secondary) {
      gesture.ignored.add(event.pointerId);
      this._blockClick();
      if (event.cancelable) event.preventDefault();
    }
    // A single press deliberately keeps its native focus and click target.
    // Capture is delayed until dragging actually starts.
  }

  _move(event) {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    const gesture = this.gesture;
    if (!gesture || gesture.primary == null || gesture.ignored.has(event.pointerId)) return;
    if (gesture.secondary != null) {
      const current = this._pinchBaseline(gesture), baseline = gesture.pinch;
      if (!current || !baseline) return;
      if (baseline.distance < PINCH_THRESHOLD) { gesture.pinch = current; return; }
      if (Math.abs(current.distance - baseline.distance) > PINCH_THRESHOLD ||
          Math.hypot(current.midpoint.clientX - baseline.midpoint.clientX,
            current.midpoint.clientY - baseline.midpoint.clientY) > PINCH_THRESHOLD) gesture.pinchStarted = true;
      if (gesture.pinchStarted) {
        this._activate('pinch');
        const point = this._local(current.midpoint);
        this._zoom = clamp(baseline.zoom * current.distance / baseline.distance, this.minZoom, this.maxZoom);
        this.x = baseline.world.x - (point.x - this.width / 2) / this._zoom;
        this.y = baseline.world.y - (point.y - this.height / 2) / this._zoom;
        this._apply();
        // A clamped camera becomes the next baseline, so reversal at either
        // zoom limit or map edge responds without an accumulated dead zone.
        gesture.pinch = this._pinchBaseline(gesture);
        this._blockClick();
      }
      if (event.cancelable) event.preventDefault();
      return;
    }
    if (event.pointerId !== gesture.primary) return;
    const dx = event.clientX - gesture.startX, dy = event.clientY - gesture.startY, distance = Math.hypot(dx, dy);
    if (!gesture.dragging && distance <= DRAG_THRESHOLD) return;
    const fraction = gesture.dragging ? 1 : (distance - DRAG_THRESHOLD) / distance;
    const deltaX = gesture.dragging ? event.clientX - gesture.lastX : dx * fraction;
    const deltaY = gesture.dragging ? event.clientY - gesture.lastY : dy * fraction;
    const rect = this.viewport.getBoundingClientRect();
    this._pan(deltaX * this.width / Math.max(1, rect.width), deltaY * this.height / Math.max(1, rect.height));
    gesture.dragging = true;
    gesture.lastX = event.clientX; gesture.lastY = event.clientY;
    this._capture(gesture.primary);
    this._blockClick();
    if (event.cancelable) event.preventDefault();
  }

  _up(event) {
    if (!this.pointers.has(event.pointerId)) return;
    this._move(event);
    const gesture = this.gesture;
    this.pointers.delete(event.pointerId);
    this._release(event.pointerId);
    if (gesture && (gesture.dragging || gesture.multiple)) this._blockClick();
    if (gesture && (event.pointerId === gesture.primary || event.pointerId === gesture.secondary)) {
      const remaining = [gesture.primary, gesture.secondary].find(id => id != null && this.pointers.has(id));
      gesture.primary = remaining ?? null;
      gesture.secondary = null;
      gesture.pinch = null;
      // A remaining finger continues the already active multi-touch gesture.
      // Reapplying the initial press threshold here creates a visible pause.
      gesture.dragging = remaining != null && gesture.multiple;
      if (remaining != null) {
        const point = this.pointers.get(remaining);
        gesture.startX = gesture.lastX = point.clientX;
        gesture.startY = gesture.lastY = point.clientY;
      }
    }
    if (!this.pointers.size) this.gesture = null;
  }

  _cancel() {
    if (this.pointers.size) this._blockClick();
    const ids = Array.from(this.pointers.keys());
    this.pointers.clear();
    this.gesture = null;
    ids.forEach(id => this._release(id));
  }

  _bind() {
    const listen = (target, type, callback, options) => {
      target.addEventListener(type, callback, options);
      this._listeners.push(() => target.removeEventListener(type, callback, options));
    };
    listen(this.viewport, 'pointerdown', event => this._down(event));
    listen(window, 'pointermove', event => this._move(event), { passive: false });
    listen(window, 'pointerup', event => this._up(event));
    listen(window, 'pointercancel', event => { if (this.pointers.has(event.pointerId)) this._cancel(); });
    listen(this.viewport, 'lostpointercapture', event => {
      // Touch starts can have implicit capture on a child button. Moving that
      // capture to the viewport is intentional and keeps the gesture alive.
      if (this.pointers.has(event.pointerId) && !this.viewport.hasPointerCapture(event.pointerId)) this._cancel();
    });
    listen(window, 'blur', () => this._cancel());
    listen(window, 'resize', () => this.resize());
    listen(this.viewport, 'dragstart', event => event.preventDefault());
    listen(this.viewport, 'click', event => {
      if (event.detail !== 0 && Date.now() < this._suppressClickUntil) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, true);
    listen(this.viewport, 'wheel', event => {
      if (event.target.closest?.('input,select,textarea,[contenteditable="true"]')) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.height : 1;
      if (event.ctrlKey) this.zoomBy(Math.exp(-event.deltaY * unit * .002), event);
      else {
        const rect = this.viewport.getBoundingClientRect();
        const dx = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
        const dy = event.shiftKey && !event.deltaX ? 0 : event.deltaY;
        this._pan(-dx * unit * this.width / Math.max(1, rect.width),
          -dy * unit * this.height / Math.max(1, rect.height));
      }
      event.preventDefault();
    }, { passive: false });
  }

  destroy() {
    this._cancel();
    this._observer?.disconnect();
    this._listeners.splice(0).forEach(remove => remove());
  }
}
