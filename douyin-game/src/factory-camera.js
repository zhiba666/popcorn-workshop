'use strict';

const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const limit = (value, low, high) => Math.max(low, Math.min(high, value));

function rectangle(value, fallback = { x: 0, y: 0, w: 1, h: 1 }) {
  const source = value || fallback;
  const x = finite(source.x, finite(source.left, fallback.x));
  const y = finite(source.y, finite(source.top, fallback.y));
  return { x, y,
    w: Math.max(0, finite(source.w, finite(source.right, x + fallback.w) - x)),
    h: Math.max(0, finite(source.h, finite(source.bottom, y + fallback.h) - y)) };
}

// Coordinates here are projected scene units and UI design units. Device pixel
// ratio and the whole-page scale belong to Renderer, outside this camera.
class FactoryCamera {
  constructor(options = {}) {
    this.viewport = rectangle(options.viewport);
    this.bounds = options.bounds ? rectangle(options.bounds) : null;
    this.minZoom = Math.max(.01, finite(options.minZoom, .55));
    this.maxZoom = Math.max(this.minZoom, finite(options.maxZoom, 1.6));
    this.padding = Math.max(0, finite(options.padding, 24));
    this.zoom = limit(finite(options.zoom, 1), this.minZoom, this.maxZoom);
    this.x = finite(options.x, this.bounds ? this.bounds.x + this.bounds.w / 2 : 0);
    this.y = finite(options.y, this.bounds ? this.bounds.y + this.bounds.h / 2 : 0);
    this.motion = null;
    this.clamp();
  }

  worldToDesign(point) {
    const view = this.viewport;
    return { x: view.x + view.w / 2 + (point.x - this.x) * this.zoom,
      y: view.y + view.h / 2 + (point.y - this.y) * this.zoom };
  }

  designToWorld(point) {
    const view = this.viewport;
    return { x: this.x + (point.x - view.x - view.w / 2) / this.zoom,
      y: this.y + (point.y - view.y - view.h / 2) / this.zoom };
  }

  setViewport(viewport) {
    this.stop();
    this.viewport = rectangle(viewport, this.viewport);
    return this.clamp();
  }

  setBounds(bounds) {
    this.stop();
    this.bounds = bounds ? rectangle(bounds) : null;
    return this.clamp();
  }

  constrained(x, y, zoom) {
    zoom = limit(finite(zoom, this.zoom), this.minZoom, this.maxZoom);
    x = finite(x, this.x); y = finite(y, this.y);
    if (this.bounds) {
      const bounds = this.bounds, view = this.viewport, padding = this.padding / zoom;
      const width = view.w / zoom, height = view.h / zoom;
      x = bounds.w <= width ? bounds.x + bounds.w / 2 :
        limit(x, bounds.x + width / 2 - padding, bounds.x + bounds.w - width / 2 + padding);
      y = bounds.h <= height ? bounds.y + bounds.h / 2 :
        limit(y, bounds.y + height / 2 - padding, bounds.y + bounds.h - height / 2 + padding);
    }
    return { x, y, zoom };
  }

  clamp() {
    Object.assign(this, this.constrained(this.x, this.y, this.zoom));
    return this;
  }

  setView(view, options = {}) {
    this.stop();
    this.x = finite(view.x, this.x); this.y = finite(view.y, this.y);
    this.zoom = limit(finite(view.zoom, this.zoom), this.minZoom, this.maxZoom);
    return options.clamp === false ? this : this.clamp();
  }

  panBy(dx, dy) {
    this.stop();
    this.x -= finite(dx, 0) / this.zoom;
    this.y -= finite(dy, 0) / this.zoom;
    // Apply each delta to the clamped position, so dragging back from an edge
    // responds immediately instead of consuming an accumulated overshoot.
    return this.clamp();
  }

  zoomAt(factor, anchor) {
    if (!Number.isFinite(factor) || factor <= 0) return this;
    this.stop();
    const view = this.viewport;
    anchor = anchor || { x: view.x + view.w / 2, y: view.y + view.h / 2 };
    const world = this.designToWorld(anchor);
    this.zoom = limit(this.zoom * factor, this.minZoom, this.maxZoom);
    this.x = world.x - (anchor.x - view.x - view.w / 2) / this.zoom;
    this.y = world.y - (anchor.y - view.y - view.h / 2) / this.zoom;
    return this.clamp();
  }

  visibleBounds() {
    const w = this.viewport.w / this.zoom, h = this.viewport.h / this.zoom;
    const x = this.x - w / 2, y = this.y - h / 2;
    return { x, y, w, h, left: x, top: y, right: x + w, bottom: y + h };
  }

  focusRect(rect, options = {}) {
    rect = rectangle(rect);
    const padding = Math.max(0, finite(options.padding, 24)), view = this.viewport;
    const fit = Math.min(rect.w > 0 ? Math.max(1, view.w - padding * 2) / rect.w : Infinity,
      rect.h > 0 ? Math.max(1, view.h - padding * 2) / rect.h : Infinity);
    const desiredZoom = finite(options.zoom, Math.min(this.zoom, fit));
    const target = this.constrained(rect.x + rect.w / 2, rect.y + rect.h / 2, desiredZoom);
    const duration = Math.max(0, finite(options.duration, .25));
    this.stop();
    if (!duration || Math.abs(target.x - this.x) + Math.abs(target.y - this.y) +
        Math.abs(target.zoom - this.zoom) < .001) {
      Object.assign(this, target);
    } else {
      this.motion = { from: { x: this.x, y: this.y, zoom: this.zoom }, to: target,
        elapsed: 0, duration };
    }
    return this;
  }

  stop() {
    this.motion = null;
    return this;
  }

  update(seconds) {
    const motion = this.motion;
    if (!motion || !Number.isFinite(seconds) || seconds <= 0) return false;
    motion.elapsed = Math.min(motion.duration, motion.elapsed + seconds);
    const progress = motion.elapsed / motion.duration, eased = 1 - (1 - progress) ** 3;
    for (const key of ['x', 'y', 'zoom']) this[key] = motion.from[key] + (motion.to[key] - motion.from[key]) * eased;
    this.clamp();
    if (progress >= 1) this.motion = null;
    return true;
  }
}

module.exports = { FactoryCamera };
