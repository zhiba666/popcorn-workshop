'use strict';

const { projectFactoryPoint, unprojectFactoryPoint, factoryCameraOffset } = require('./factory-layout');

// Every surface uses the same ground basis. Raster scenery already contains
// perspective, so only the original wall basis is corrected when it is placed.
const P = (u, v, z = 0) => projectFactoryPoint(u, v, z);
const SKEW = -0.1333333333;
const SLOPE = 0.138;
const DET = 1 - SKEW * SLOPE;

function polygon(c, points) {
  c.beginPath();
  points.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]));
  c.closePath();
}

function groundRect(c, u, v, w, h) {
  polygon(c, [P(u, v), P(u + w, v), P(u + w, v + h), P(u, v + h)]);
}

function drawBackWall(r, room) {
  const c = r.ctx;
  const length = room.uMax - room.uMin;
  const count = Math.max(1, Math.ceil(length / 400));
  const span = length / count;
  for (let n = 0; n < count; n++) {
    const foot = P(room.uMin + n * span, room.vMin);
    const scale = span / 760;
    c.save();
    c.translate(foot[0], foot[1]);
    // The source bottom edge slopes 0.195; retain its vertical masonry.
    c.transform(scale, (SLOPE - 0.195) * scale, 0, scale, 0, 0);
    r.image('factory/wall-back', -22, -218, 800, 406);
    c.restore();
  }
}

function drawLeftWall(r, room, visible) {
  const c = r.ctx;
  // A vertical wall on the near-vertical ground axis would expose only a
  // 23 px edge. Open this cutaway face outward, as a stage set: its foot
  // stays on the ground, while its upper edge reveals the original windows.
  // A negative opening preserves the source face orientation and keeps all
  // masonry outside the supply lane, which runs inside the wall foot.
  const bay = 208;
  const height = 176;
  const opening = -0.25;
  const wallPoint = (v, z = 0) => {
    const p = P(room.uMin, v, z);
    return [p[0] + opening * z, p[1]];
  };
  for (let v = room.vMin; v < room.vMax; v += bay) {
    const foot = P(room.uMin, v);
    const span = Math.min(bay, room.vMax - v);
    const corners = [wallPoint(v), wallPoint(v + span),
      wallPoint(v, height), wallPoint(v + span, height)];
    if (Math.max(...corners.map(p => p[0])) < visible.left ||
        Math.min(...corners.map(p => p[0])) > visible.right ||
        foot[1] + span < visible.top || foot[1] - height > visible.bottom) continue;
    // Original ground endpoints (150, 543) -> (17, 750) remain attached
    // to P(0, span). The source's upright axis becomes the cutaway rise.
    const d = 0.34;
    const shear = -opening * d;
    const a = (207 * shear - SKEW * span) / 133;
    const b = (207 * d - span) / 133;
    c.save();
    polygon(c, [wallPoint(v, height), wallPoint(v + span, height),
      wallPoint(v + span), wallPoint(v)]);
    c.fillStyle = '#d1bea0';
    c.fill();
    c.clip();
    c.translate(foot[0], foot[1]);
    c.transform(a, b, shear, d, 0, 0);
    r.image('factory/wall-left', -150, -543, 360, 800);
    c.restore();
    const backTop = wallPoint(v, height), frontTop = wallPoint(v + span, height);
    c.save();
    c.strokeStyle = '#b9a382';
    c.lineWidth = 4;
    c.beginPath(); c.moveTo(backTop[0], backTop[1]); c.lineTo(frontTop[0], frontTop[1]); c.stroke();
    c.strokeStyle = '#f3e7ce';
    c.lineWidth = 2;
    c.stroke();
    const backFoot = wallPoint(v), frontFoot = wallPoint(v + span);
    c.strokeStyle = 'rgba(110, 88, 58, 0.35)';
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(backFoot[0], backFoot[1]); c.lineTo(frontFoot[0], frontFoot[1]); c.stroke();
    c.restore();
  }
}

function drawFactoryRoom(r, layout, scrollOrCamera = 0) {
  const c = r.ctx;
  const room = layout.room || { uMin: -26, uMax: 326, vMin: 0, vMax: layout.groundHeight || layout.height };
  const viewport = r.layout && (r.layout.factorySceneViewport || r.layout.factoryViewport);
  const camera = scrollOrCamera && typeof scrollOrCamera.visibleBounds === 'function' ? scrollOrCamera : null;
  const scroll = Number.isFinite(scrollOrCamera) ? scrollOrCamera : 0;
  const offset = factoryCameraOffset(scroll);
  const world = camera ? camera.visibleBounds() : {
    left: (viewport ? viewport.x : 0) + offset[0], top: scroll,
    right: (viewport ? viewport.x + viewport.w : 390) + offset[0],
    bottom: scroll + (viewport ? viewport.h : 476)
  };
  const visible = { left: world.left - 100, right: world.right + 100,
    top: world.top - 140, bottom: world.bottom + 120 };
  // The viewport is in projected world coordinates. Invert all four corners
  // before selecting ground tiles; its world height grows as the camera zooms
  // out and a horizontal pan also changes the visible ground-axis interval.
  const corners = [[visible.left, visible.top], [visible.right, visible.top],
    [visible.left, visible.bottom], [visible.right, visible.bottom]]
    .map(([x, y]) => unprojectFactoryPoint(x, y));
  const uMin = Math.min(...corners.map(p => p.u)), uMax = Math.max(...corners.map(p => p.u));
  const vMin = Math.min(...corners.map(p => p.v)), vMax = Math.max(...corners.map(p => p.v));
  const width = room.uMax - room.uMin;
  const depth = room.vMax - room.vMin;
  c.save();
  groundRect(c, room.uMin, room.vMin, width, depth);
  c.fillStyle = '#f0dfc1';
  c.fill();
  c.clip();
  // A 160 x 128 ground tile contains four generous stone slabs. Its PNG
  // includes the exact same projection, and is always drawn at design size.
  const vStart = Math.max(room.vMin, room.vMin + Math.floor((vMin - room.vMin - 64) / 128) * 128);
  const vEnd = Math.min(room.vMax + 128, vMax + 128);
  const uStart = Math.max(room.uMin, room.uMin + Math.floor((uMin - room.uMin - 80) / 160) * 160);
  const uEnd = Math.min(room.uMax, uMax + 160);
  for (let v = vStart; v < vEnd; v += 128) {
    for (let u = uStart; u < uEnd; u += 160) {
      const center = P(u + 80, v + 64);
      r.image('factory/floor-stone-tile', center[0] - 96, center[1] - 96, 192, 192);
    }
  }
  groundRect(c, room.uMin, room.vMin, 14, depth);
  c.fillStyle = 'rgba(115,87,51,0.08)';
  c.fill();
  groundRect(c, room.uMin, room.vMin, width, 12);
  c.fillStyle = 'rgba(98,73,43,0.10)';
  c.fill();
  c.restore();
  const walls = Object.assign({}, room, { vMin: room.wallStart === undefined ? room.vMin + 70 : room.wallStart });
  const backLeft = P(walls.uMin, walls.vMin), backRight = P(walls.uMax, walls.vMin);
  if (Math.min(backLeft[1], backRight[1]) - 200 < visible.bottom &&
      Math.max(backLeft[1], backRight[1]) + 120 > visible.top) drawBackWall(r, walls);
  drawLeftWall(r, walls, visible);
}

function point(value) {
  return Array.isArray(value) ? { u: value[0], v: value[1] } : value;
}

function direction(from, to) {
  if (Math.abs(to.u - from.u) > Math.abs(to.v - from.v)) return to.u > from.u ? 'e' : 'w';
  return to.v > from.v ? 's' : 'n';
}

function drawComponent(r, id, u, v, scaleU, scaleV, alpha) {
  const c = r.ctx;
  const center = P(u, v);
  // P * scale * inverse(P) changes a component's ground length without
  // stretching its cross-section, rail thickness, or repeated support spacing.
  const a = (scaleU - SKEW * SLOPE * scaleV) / DET;
  const b = SLOPE * (scaleU - scaleV) / DET;
  const cc = SKEW * (scaleV - scaleU) / DET;
  const d = (scaleV - SKEW * SLOPE * scaleU) / DET;
  c.save();
  c.translate(center[0], center[1]);
  c.transform(a, b, cc, d, 0, 0);
  r.image(id, -48, -48, 96, 96, alpha);
  c.restore();
}

function drawMovingSeams(r, a, b, widthScale, time, reverse) {
  const c = r.ctx;
  const horizontal = Math.abs(b.u - a.u) > Math.abs(b.v - a.v);
  const length = horizontal ? Math.abs(b.u - a.u) : Math.abs(b.v - a.v);
  if (length < 1) return;
  const sign = horizontal ? Math.sign(b.u - a.u) : Math.sign(b.v - a.v);
  const spacing = 18 * widthScale;
  const phase = ((time * 14 * (reverse ? -1 : 1)) % spacing + spacing) % spacing;
  c.save();
  c.strokeStyle = 'rgba(165,211,207,0.26)';
  c.lineWidth = 0.7;
  c.beginPath();
  for (let distance = phase; distance < length; distance += spacing) {
    const u = horizontal ? a.u + distance * sign : a.u;
    const v = horizontal ? a.v : a.v + distance * sign;
    const half = 9 * widthScale;
    const p1 = horizontal ? P(u, v - half) : P(u - half, v);
    const p2 = horizontal ? P(u, v + half) : P(u + half, v);
    c.moveTo(p1[0], p1[1]);
    c.lineTo(p2[0], p2[1]);
  }
  c.stroke();
  c.restore();
}

function drawFactoryRoute(r, groundPoints, options = {}) {
  if (!groundPoints || groundPoints.length < 2) return;
  const nodes = groundPoints.map(point).filter((p, i, all) => !i || p.u !== all[i - 1].u || p.v !== all[i - 1].v);
  if (nodes.length < 2) return;
  const widthScale = options.widthScale || 0.6;
  const alpha = options.active === false ? 0.88 : 1;
  const bends = nodes.map((p, i) => {
    if (!i || i === nodes.length - 1) return null;
    const prev = nodes[i - 1], next = nodes[i + 1];
    const arms = [direction(p, prev), direction(p, next)];
    if ((arms.includes('n') || arms.includes('s')) && (arms.includes('e') || arms.includes('w'))) {
      const lengthBefore = Math.abs(prev.u - p.u) + Math.abs(prev.v - p.v);
      const lengthAfter = Math.abs(next.u - p.u) + Math.abs(next.v - p.v);
      const half = Math.min(40 * widthScale, lengthBefore / 2, lengthAfter / 2);
      return { half, asset: 'factory/logistics-corner-' + (arms.includes('n') ? 'n' : 's') + (arms.includes('e') ? 'e' : 'w') };
    }
    return null;
  });
  for (let index = 1; index < nodes.length; index++) {
    const start = nodes[index - 1], end = nodes[index];
    const du = end.u - start.u, dv = end.v - start.v;
    const horizontal = Math.abs(du) > Math.abs(dv);
    const length = Math.abs(horizontal ? du : dv);
    if (!length) continue;
    const sign = Math.sign(horizontal ? du : dv);
    const trimStart = bends[index - 1] ? bends[index - 1].half : 0;
    const trimEnd = bends[index] ? bends[index].half : 0;
    const usable = length - trimStart - trimEnd;
    if (usable <= 0) continue;
    const count = Math.max(1, Math.round(usable / (80 * widthScale)));
    const span = usable / count;
    const id = 'factory/' + (options.foreground ? 'logistics-foreground-rail-' : 'logistics-straight-') + (horizontal ? 'h' : 'v');
    for (let n = 0; n < count; n++) {
      const along = (trimStart + span * (n + 0.5)) * sign;
      const u = start.u + (horizontal ? along : 0);
      const v = start.v + (horizontal ? 0 : along);
      drawComponent(r, id, u, v, horizontal ? span / 80 : widthScale, horizontal ? widthScale : span / 80, alpha);
    }
    if (!options.foreground && options.active && options.time) {
      const a = { u: start.u + (horizontal ? trimStart * sign : 0), v: start.v + (horizontal ? 0 : trimStart * sign) };
      const b = { u: end.u - (horizontal ? trimEnd * sign : 0), v: end.v - (horizontal ? 0 : trimEnd * sign) };
      drawMovingSeams(r, a, b, widthScale, options.time, options.reverse);
    }
  }
  if (!options.foreground) nodes.forEach((p, i) => {
    if (bends[i]) drawComponent(r, bends[i].asset, p.u, p.v, bends[i].half / 40, bends[i].half / 40, alpha);
  });
}

function drawFactoryShadow(r, foot, width, height) {
  const p = Array.isArray(foot) ? foot : [foot.x, foot.y];
  r.image('factory/contact-shadow', p[0] - width / 2, p[1] - height / 2 + 2, width, height, 0.76);
}

function drawFactoryNameplate(r, text, x, y, width, active = false) {
  const height = 24;
  if (r.slice) r.slice('factory/nameplate', x, y, width, height);
  else r.image('factory/nameplate', x, y, width, height);
  r.text(text, x + width / 2, y + height / 2 - 1, width < 80 ? 11 : 13, active ? '#fff0bd' : '#fff6df', 'center', true);
}

module.exports = { drawFactoryRoom, drawFactoryRoute, drawFactoryShadow, drawFactoryNameplate };
