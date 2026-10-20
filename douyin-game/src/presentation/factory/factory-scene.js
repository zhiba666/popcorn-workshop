'use strict';

const { projectFactoryPoint } = require('./factory-layout');
const P = (u, v, z = 0) => projectFactoryPoint(u, v, z);

function polygon(c, points, fill, stroke, width = 1) {
  c.beginPath();
  points.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]));
  c.closePath();
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = width; c.stroke(); }
}

function corners(area) {
  return [P(area.x, area.y), P(area.x + area.w, area.y),
    P(area.x + area.w, area.y + area.h), P(area.x, area.y + area.h)];
}

function visibleWorld(r, camera) {
  const current = camera && typeof camera.visibleBounds === 'function' ? camera : r.factoryCamera;
  return current && typeof current.visibleBounds === 'function' ? current.visibleBounds() : null;
}

function pointsVisible(points, visible, margin = 26) {
  if (!visible) return true;
  // A polyline may cross the view even when both endpoints are outside. Only
  // reject it when its entire bounds lie beyond the same viewport edge.
  return !points.every(p => p[0] < visible.left - margin) &&
    !points.every(p => p[0] > visible.right + margin) &&
    !points.every(p => p[1] < visible.top - margin) &&
    !points.every(p => p[1] > visible.bottom + margin);
}

function rectVisible(rect, visible, margin = 26) {
  return !visible || rect.x + rect.w >= visible.left - margin && rect.x <= visible.right + margin &&
    rect.y + rect.h >= visible.top - margin && rect.y <= visible.bottom + margin;
}

function groundRect(c, area, fill, stroke, width) { polygon(c, corners(area), fill, stroke, width); }
function inset(area, n) { return { x: area.x + n, y: area.y + n, w: area.w - n * 2, h: area.h - n * 2 }; }

function worldLine(c, points, color, width = 1, dash) {
  if (!points.length) return;
  c.beginPath();
  points.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]));
  c.strokeStyle = color; c.lineWidth = width; c.lineJoin = 'round';
  if (c.setLineDash) c.setLineDash(dash || []);
  c.stroke();
  if (dash && c.setLineDash) c.setLineDash([]);
}

function groundLine(c, points, color, width, dash) {
  worldLine(c, points.map(p => P(Array.isArray(p) ? p[0] : p.u, Array.isArray(p) ? p[1] : p.v)), color, width, dash);
}

function platform(c, area, options = {}) {
  const { depth = 10, fill = '#e6d4ac', side = '#b39d75', front = '#c0a77e', stroke = '#b9a580', width = 2 } = options;
  const [a, b, d, e] = corners(area), lower = p => [p[0], p[1] + depth];
  polygon(c, [a, b, d, e].map(p => [p[0] + 4, p[1] + depth + 5]), '#53644726');
  polygon(c, [b, d, lower(d), lower(b)], side, '#aa946e', 1);
  polygon(c, [e, d, lower(d), lower(e)], front, '#aa946e', 1);
  polygon(c, [a, b, d, e], fill, stroke, width);
  worldLine(c, [e, d], '#f7eacc', 2);
}

function drawWorkArea(c, group, detail) {
  const work = group.workArea;
  if (group.built) {
    groundRect(c, work.aisle, '#cecbb0', '#b7b59c');
    groundRect(c, work.entry, '#d1ceb2');
    if (detail) groundLine(c, [[work.aisle.x + work.aisle.w / 2, work.aisle.y + 10],
      [work.aisle.x + work.aisle.w / 2, work.aisle.y + work.aisle.h - 10]], '#f7eed2bc', 2, [10, 14]);
  }
  for (const bay of work.bays) {
    const area = bay.groundRect;
    if (!group.built && bay.number !== 1) {
      groundRect(c, area, '#d3d2b028', '#b5b99b55', 1.2);
      continue;
    }
    if (c.setLineDash) c.setLineDash(bay.built ? [] : [8, 6]);
    groundRect(c, area, bay.built ? '#f8edcf20' : '#e7d9ac1f', bay.built ? '#b9ad8c' : '#bea15e', 1.3);
    if (c.setLineDash) c.setLineDash([]);
    if (!detail) continue;
    const length = Math.min(18, Math.max(9, Math.min(area.w, area.h) * .16));
    for (const [x, y, dx, dy] of [[area.x, area.y, 1, 1], [area.x + area.w, area.y, -1, 1],
      [area.x + area.w, area.y + area.h, -1, -1], [area.x, area.y + area.h, 1, -1]]) {
      groundLine(c, [[x + dx * length, y], [x, y], [x, y + dy * length]], bay.built ? '#f9efcf' : '#dbc490', bay.built ? 3 : 2.5);
    }
  }
}

function drawWorkshop(c, layout, group, detail, selectedProduct) {
  const area = group.groundRect;
  if (!group.built && !group.next) {
    groundRect(c, inset(area, 7), '#99ac8024');
    groundRect(c, { x: area.x + 38, y: area.y + 58, w: area.w - 83, h: area.h - 112 }, '#b9c69b21');
    return;
  }
  if (group.built) {
    platform(c, area);
    groundRect(c, inset(area, 12), null, group.product === selectedProduct ? '#73a68c' : '#f9edcfbf',
      group.product === selectedProduct ? 3 : 2);
  } else {
    groundRect(c, inset(area, 5), '#c8c39b8f');
    groundLine(c, [[area.x + 18, area.y + 42], [area.x + 18, area.y + area.h - 16],
      [area.x + area.w * .46, area.y + area.h - 16]], '#b8ab83', 5);
    const materialX = group.column === 0 ? area.x + 28 : area.x + area.w - 108;
    groundRect(c, { x: materialX + 2, y: area.y + 45, w: 72, h: 25 }, '#8b8f702e');
    for (let n = 0; n < 3; n++) groundRect(c, { x: materialX + 3, y: area.y + 42 + n * 8,
      w: 66, h: 6 }, '#d5bd8a', '#af986d');
  }
  const entry = group.workArea.entry, spine = layout.spine.groundRect;
  const connector = group.column === 0 ? { x: area.x + area.w, y: entry.y, w: spine.x - area.x - area.w, h: entry.h }
    : { x: spine.x + spine.w, y: entry.y, w: area.x - spine.x - spine.w, h: entry.h };
  groundRect(c, connector, group.built ? '#d1c5a6' : '#c3c2a299', group.built ? '#acaa8d' : null, 1.5);
  drawWorkArea(c, group, detail);
  if (group.built) {
    const insideX = group.column === 0 ? area.x + area.w - 4 : area.x + 4;
    groundLine(c, [[insideX, entry.y + 3], [insideX, entry.y + entry.h - 3]], '#f8edcd', 4);
    groundLine(c, [[area.x + 18, area.y + 34], [area.x + area.w - 18, area.y + 34]], '#b4a4856b', 1.5);
    const accentX = group.column === 0 ? area.x + 18 : area.x + area.w - 31;
    const accents = ['#7eac8b', '#d1ac6e', '#b7a482', '#a3b2ca', '#c4937e', '#94aaa1'];
    groundRect(c, { x: accentX, y: area.y + 16, w: 13, h: 56 }, accents[group.index]);
  }
}

function drawCourtyard(c, layout) {
  const area = layout.courtyard.groundRect, centerX = area.x + area.w / 2;
  platform(c, area, { depth: 18, fill: '#e4d2ad', stroke: '#ad9873', side: '#a68e69', front: '#b99e76', width: 3 });
  groundRect(c, inset(area, 14), null, '#f5e7c8', 4);
  groundLine(c, [[area.x + 22, area.y + 42], [area.x + area.w - 22, area.y + 42]], '#b4a4856b', 1.5);
  groundLine(c, [[area.x + 22, area.y + area.h - 58], [centerX - 102, area.y + area.h - 58]], '#b4a4856b', 1.5);
  groundLine(c, [[centerX + 102, area.y + area.h - 58], [area.x + area.w - 22, area.y + area.h - 58]], '#b4a4856b', 1.5);
  groundRect(c, { x: centerX - 88, y: area.y + area.h - 52, w: 176, h: 52 }, '#cfc8aa');
  for (let i = 0; i < 3; i++) groundRect(c,
    { x: centerX - 68, y: area.y + area.h - 34 + i * 10, w: 136, h: 4 }, '#f6eacb');
  for (const x of [centerX - 102, centerX + 102]) groundRect(c,
    { x: x - 9, y: area.y + area.h - 35, w: 18, h: 26 }, '#ab9875', '#95825f');
}

function drawInstallation(c, area, state, detail, cache = false, selected = false) {
  c.save();
  if (state === 'locked') c.globalAlpha *= .27;
  platform(c, area, { depth: cache ? 3 : 5, fill: selected ? '#dae5bf' : cache ? '#dccca7' : state === 'next' ? '#e1d7b9' : '#efe6cd',
    stroke: selected ? '#6e9d79' : cache ? '#b5a37e' : '#c3b798', side: cache ? '#b09a73' : '#c1b18b',
    front: cache ? '#bdab82' : '#d3c29c', width: selected ? 2.5 : 1.4 });
  if (detail) groundRect(c, inset(area, cache ? 4 : 5), null, cache ? '#eee0ba' : '#d8cdaf', 1);
  c.restore();
}

function drawFactoryRoom(r, layout, camera) {
  const c = r.ctx, detail = !camera || !Number.isFinite(camera.zoom) || camera.zoom >= .48;
  const visible = visibleWorld(r, camera);
  c.save();
  // Open land around separate workshop slabs leaves the main service aisle
  // and public hub legible even before every workshop is constructed.
  groundRect(c, { x: 8, y: 50, w: 1114, h: 2270 }, '#b4c39b');
  for (const group of layout.groups) if (rectVisible(group.bounds, visible))
    drawWorkshop(c, layout, group, detail, r.factorySelectedProduct);
  const spine = layout.spine.groundRect;
  if (pointsVisible(corners(spine), visible)) {
    platform(c, spine, { depth: 12, fill: '#bbc6b9', stroke: '#91a59c', side: '#869c91', front: '#97aa9a' });
    groundRect(c, inset(spine, 9), null, '#dce2cf', 3);
    for (const f of [.29, .71]) groundLine(c, [[spine.x + spine.w * f, spine.y + 16],
      [spine.x + spine.w * f, spine.y + spine.h - 18]], '#8fa49980', 2);
  }
  if (rectVisible(layout.courtyard.bounds, visible)) drawCourtyard(c, layout);
  for (const slot of layout.allSlots) {
    const group = layout.groups.find(value => value.id === slot.groupId);
    if (!group.built && (!group.next || slot.number !== 1)) continue;
    const state = slot.built ? 'built' : slot.next ? 'next' : 'locked';
    const selected = slot.lineId === r.lastFactorySelection;
    if (group.built && pointsVisible(corners(slot.cachePad), visible))
      drawInstallation(c, slot.cachePad, state, detail, true, selected);
    if (pointsVisible(corners(slot.bayGround), visible)) {
      drawInstallation(c, slot.bayGround, state, detail, false, selected);
      if (detail) groundLine(c, slot.serviceEdge, '#faf1d5', 3, [6, 5]);
    }
  }
  for (const [name, rect] of Object.entries({ supply: layout.supply, packaging: layout.packaging, warehouse: layout.warehouse })) {
    const width = rect.w / .9 * 1.08;
    const area = { x: rect.ground.u - width / 2, y: rect.ground.v - 18, w: width, h: 70 };
    if (pointsVisible(corners(area), visible))
      drawInstallation(c, area, 'built', detail, false, r.factoryServiceFocus === name);
  }
  c.restore();
}

function boundaryEntity(r, from, to, options = {}) {
  const a = P(...from), b = P(...to), length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const offset = [-(b[1] - a[1]) / length * 4, (b[0] - a[0]) / length * 4];
  const d = [a[0] + offset[0], a[1] + offset[1]], e = [b[0] + offset[0], b[1] + offset[1]];
  return { depth: Math.max(a[1], b[1]), draw() {
    const c = r.ctx, depth = options.next ? 3 : 6;
    c.save();
    polygon(c, [a, b, e, d].map(p => [p[0] + 2, p[1] + depth + 2]), '#58654b24');
    polygon(c, [d, e, [e[0], e[1] + depth], [d[0], d[1] + depth]], options.next ? '#ad9f7d' : '#b9aa88', '#a89977', .6);
    polygon(c, [a, b, e, d], options.next ? '#c9bd98' : '#e2d5b4', '#b8aa88', .8);
    if (options.rail) {
      c.lineCap = 'round'; worldLine(c, [[a[0], a[1] - 13], [b[0], b[1] - 13]], '#9cae9f', 5);
      const count = Math.max(1, Math.ceil(length / 100));
      for (let i = 0; i <= count; i++) {
        const t = i / count, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
        worldLine(c, [[x + 2, y + 1], [x + 2, y - 18]], '#6d817348', 5);
        worldLine(c, [[x, y], [x, y - 18]], '#82998a', 5);
        c.beginPath(); c.arc(x, y - 18, 2.6, 0, Math.PI * 2); c.fillStyle = '#d5dec9'; c.fill();
      }
    }
    c.restore();
  } };
}

function factoryBoundaryEntities(r, layout) {
  const entities = [], add = (a, b, options) => entities.push(boundaryEntity(r, a, b, options));
  const spine = layout.spine.groundRect, rearY = 76;
  add([40, rearY], [spine.x - 18, rearY]); add([spine.x + spine.w + 18, rearY], [1090, rearY]);
  add([40, rearY], [192, rearY], { rail: true }); add([938, rearY], [1090, rearY], { rail: true });
  for (const group of layout.groups) {
    if (!group.built && !group.next) continue;
    const area = group.groundRect, outerX = group.column === 0 ? area.x - 5 : area.x + area.w + 5;
    add([outerX, area.y + 32], [outerX, area.y + area.h - 20], { next: group.next });
    if (group.built) add([outerX, area.y + 58], [outerX, area.y + 178], { rail: true });
    const u = group.column === 0 ? area.x : area.x + area.w - 134;
    add([u, area.y + area.h], [u + 134, area.y + area.h], { next: group.next });
  }
  const court = layout.courtyard.groundRect, front = court.y + court.h + 3, entry = court.x + court.w / 2;
  add([court.x - 5, court.y + 36], [court.x - 5, court.y + court.h]);
  add([court.x + court.w + 5, court.y + 36], [court.x + court.w + 5, court.y + court.h]);
  add([court.x, front], [entry - 106, front]); add([entry + 106, front], [court.x + court.w, front]);
  add([court.x + 18, front], [court.x + 178, front], { rail: true });
  add([court.x + court.w - 178, front], [court.x + court.w - 18, front], { rail: true });
  return entities;
}

function routePoint(value) { return Array.isArray(value) ? { u: value[0], v: value[1] } : value; }

// Transport packets and route skins share the same raised crossing geometry.
// The shoulders are 42 px apart, with only this short branch lifted above its
// trunk. Ordinary corners stay connected on the original ground plane.
function projectFactoryRoute(groundPoints, bridges = []) {
  if (!groundPoints || !groundPoints.length) return [];
  const nodes = groundPoints.map(routePoint).map(p => P(p.u, p.v));
  const output = [nodes[0]];
  for (let index = 1; index < nodes.length; index++) {
    const a = nodes[index - 1], b = nodes[index], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < .01) continue;
    const unit = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    const crossings = bridges.map(bridge => {
      const p = bridge.point || (bridge.ground && P(bridge.ground.u, bridge.ground.v));
      if (!p) return null;
      const dx = p[0] - a[0], dy = p[1] - a[1], offset = dx * unit[0] + dy * unit[1];
      const across = Math.abs(dx * unit[1] - dy * unit[0]);
      return across < 2 && offset > 8 && offset < length - 8 ? offset : null;
    }).filter(offset => offset != null).sort((x, y) => x - y);
    for (const offset of crossings) {
      const reach = Math.min(21, offset - 2, length - offset - 2), shoulder = reach * .42;
      const at = (distance, lift = 0) => [a[0] + unit[0] * distance, a[1] + unit[1] * distance - lift];
      output.push(at(offset - reach), at(offset - reach + shoulder, 11), at(offset + reach - shoulder, 11), at(offset + reach));
    }
    output.push(b);
  }
  return output;
}

function routeAlong(points, distance) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (distance <= length || i === points.length - 1) {
      const t = length ? Math.min(1, distance / length) : 0;
      return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], direction: [(b[0] - a[0]) / length, (b[1] - a[1]) / length] };
    }
    distance -= length;
  }
  return { point: points[0], direction: [1, 0] };
}

function drawFactoryRoute(r, groundPoints, options = {}) {
  if (!groundPoints || groundPoints.length < 2) return;
  const points = projectFactoryRoute(groundPoints, options.bridges || options.crossings || []);
  // Include the lifted bridge, wide selection skin, support feet and shadows
  // in the world-space margin. Visible crossings keep their complete route.
  if (!pointsVisible(points, visibleWorld(r))) return;
  const c = r.ctx, feed = options.role === 'feed', output = options.role === 'output';
  const width = options.width || (feed ? (options.tier === 'trunk' ? 16 : 11) : output ? 12 : options.tier === 'trunk' ? 20 : 15);
  const length = points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]), 0);
  if (!length) return;
  c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
  c.globalAlpha *= options.active === false ? .82 : 1;
  if (options.selected) worldLine(c, points, '#a6c79c80', width + 10);
  if (options.detail !== false) {
    // Short saddles belong to the pipe/trough, so fittings retain their own
    // scale instead of stretching together with a long belt texture.
    for (let distance = 48; distance < length - 26; distance += options.tier === 'trunk' ? 142 : 100) {
      const sample = routeAlong(points, distance), p = sample.point, d = sample.direction, half = width / 2 + 4;
      worldLine(c, [[p[0] - d[1] * half, p[1] + 4 + d[0] * half],
        [p[0] + d[1] * half, p[1] + 4 - d[0] * half]], feed ? '#7c8e80' : '#91866b', 7);
    }
  }
  worldLine(c, points.map(p => [p[0] + 2, p[1] + 5]), '#53644738', width + 5);
  worldLine(c, points, feed ? '#496f78' : '#82775d', width + 4);
  worldLine(c, points, feed ? '#7daab3' : output ? '#b8b897' : '#c6aa70', width);
  if (feed) worldLine(c, points.map(p => [p[0] - 1, p[1] - 2]), '#b8d9d8a3', Math.max(2, width * .24));
  else worldLine(c, points, output ? '#7b9588' : '#9a895e', Math.max(3, width - 5));
  if (options.detail !== false) {
    for (let distance = 12; distance < length; distance += feed ? 62 : 20) {
      const sample = routeAlong(points, distance), p = sample.point, d = sample.direction;
      const half = feed ? width / 2 + 1 : width / 2 - 2;
      worldLine(c, [[p[0] - d[1] * half, p[1] + d[0] * half], [p[0] + d[1] * half, p[1] - d[0] * half]],
        feed ? '#527b83' : '#d3c8a2', feed ? 3 : 1.5);
    }
    if (options.tier !== 'trunk') for (const distance of [Math.min(3, length / 2), Math.max(0, length - 3)]) {
      const sample = routeAlong(points, distance), p = sample.point, d = sample.direction, half = width / 2 + 1.5;
      worldLine(c, [[p[0] - d[1] * half, p[1] + d[0] * half],
        [p[0] + d[1] * half, p[1] - d[0] * half]], feed ? '#64898e' : '#b9a780', 7);
      worldLine(c, [[p[0] - 1 - d[1] * half, p[1] + d[0] * half],
        [p[0] - 1 + d[1] * half, p[1] - d[0] * half]], '#e2e0ba9c', 1);
    }
    if (options.active && options.time) {
      const phase = ((options.time * 20) % 78 + 78) % 78;
      for (let distance = phase + 10; distance < length - 8; distance += 78) {
        const sample = routeAlong(points, options.reverse ? length - distance : distance), p = sample.point, d = sample.direction;
        const sign = options.reverse ? -1 : 1;
        worldLine(c, [[p[0] - d[0] * sign * 4 - d[1] * 3, p[1] - d[1] * sign * 4 + d[0] * 3],
          [p[0], p[1]], [p[0] - d[0] * sign * 4 + d[1] * 3, p[1] - d[1] * sign * 4 - d[0] * 3]], '#ecedd099', 1.7);
      }
    }
  }
  c.restore();
}

function drawFactoryShadow(r, foot, width, height) {
  const p = Array.isArray(foot) ? foot : [foot.x, foot.y];
  r.image('factory/contact-shadow', p[0] - width / 2, p[1] - height / 2 + 2, width, height, .65);
}

function drawFactoryNameplate(r, text, x, y, width, active = false) {
  const height = 24;
  if (r.slice) r.slice('factory/nameplate', x, y, width, height);
  else r.image('factory/nameplate', x, y, width, height);
  r.text(text, x + width / 2, y + height / 2 - 1, width < 80 ? 11 : 13, active ? '#fff0bd' : '#fff6df', 'center', true);
}

module.exports = { drawFactoryRoom, drawFactoryRoute, drawFactoryShadow, drawFactoryNameplate, factoryBoundaryEntities, projectFactoryRoute };
