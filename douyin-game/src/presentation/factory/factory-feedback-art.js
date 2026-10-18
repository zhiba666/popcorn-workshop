'use strict';

const { projectFactoryPoint } = require('./factory-layout');
const { drawFactoryNameplate } = require('./factory-scene');

const TAU = Math.PI * 2;
const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const assetId = id => String(id).startsWith('factory/') ? id : 'factory/' + id;

function polygon(c, points) {
  c.beginPath();
  points.forEach((point, index) => index ? c.lineTo(point[0], point[1]) : c.moveTo(point[0], point[1]));
  c.closePath();
}

function ellipse(c, x, y, width, height) {
  c.save(); c.translate(x, y); c.scale(width / 2, height / 2);
  c.beginPath(); c.arc(0, 0, 1, 0, TAU); c.restore();
}

function footOf(rect) {
  return rect.foot || [rect.x + rect.w / 2, rect.y + rect.h];
}

function groundDiamond(rect, width, depth) {
  const foot = footOf(rect), origin = projectFactoryPoint(0, 0);
  return [[-width / 2, -depth / 2], [width / 2, -depth / 2],
    [width / 2, depth / 2], [-width / 2, depth / 2]].map(([u, v]) => {
    const point = projectFactoryPoint(u, v);
    return [foot[0] + point[0] - origin[0], foot[1] + point[1] - origin[1]];
  });
}

// The pile is a coarse visual scale of the real cache, not an extra stock
// counter. A cache emptied by the shared packer loses its sprites immediately.
function drawCacheContents(r, scene, materialId, options = {}) {
  const line = scene.line, slot = scene.binSlot;
  if (!line || !slot) return;
  const units = (line.buffer || []).reduce((sum, batch) => sum + (Number(batch.baseUnits) || 0), 0);
  if (!(units > 0)) return;
  const capacity = Math.max(1, Number(line.cacheCapacityBaseUnits) || units);
  const fullness = clamp(units / capacity);
  const tier = fullness <= .25 ? 1 : fullness <= .5 ? 2 : fullness < .9 ? 3 : 4;
  const positions = [
    [[.50, .58, 0]],
    [[.31, .63, 0], [.65, .60, 0], [.48, .43, 1]],
    [[.27, .67, 0], [.53, .73, 0], [.74, .58, 0], [.40, .44, 1], [.66, .33, 1]],
    [[.24, .69, 0], [.51, .76, 0], [.76, .60, 0], [.30, .47, 1],
      [.57, .51, 1], [.72, .31, 1], [.43, .25, 2], [.59, .12, 2]]
  ][tier - 1];
  const size = Math.max(8, Math.min(slot.w * .47, slot.h * .76));
  const c = r.ctx;
  c.save();
  // Leave the bin's near wall clear, while allowing a full pile above its rim.
  c.beginPath(); c.rect(slot.x - 2, slot.y - slot.h * .32, slot.w + 4, slot.h * 1.22); c.clip();
  positions.forEach(([x, y, layer], index) => {
    const span = size * (layer ? .98 : 1);
    c.save();
    c.translate(slot.x + slot.w * x, slot.y + slot.h * y - layer * size * .13);
    c.rotate((index % 3 - 1) * .13);
    r.contain(assetId(materialId), -span / 2, -span / 2, span, span);
    c.restore();
  });
  c.restore();
}

// A status beside the actual shared machine keeps the queue and its recovery
// attached to the place where the bottleneck is being resolved.
function drawPackagingSignal(r, packRect, status = {}, time = 0, reducedMotion = false) {
  const count = Math.max(0, Math.floor(Number(status.queuedBatches) || 0));
  if (!count && !status.recovering && !status.cleared && !status.speedOnly) return;
  const recovering = !!status.recovering || !!status.cleared;
  const color = recovering ? '#207c68' : '#a56a26';
  const fill = recovering ? '#e7f5e9' : '#fff0ce';
  const label = status.pending ? '下轮提速' : status.speedOnly ? '包装已提速' :
    status.cleared && !count ? '积压已消除' : status.recovering ? (count ? '疏通 ' + count + ' 批' : '恢复流转') : '排队 ' + count + ' 批';
  const width = status.cleared && !count || status.speedOnly ? 84 : 78;
  const x = packRect.x + packRect.w / 2 - width / 2, y = packRect.y - 18;
  const c = r.ctx;
  c.save();
  const alpha = c.globalAlpha;
  c.lineWidth = .8;
  r.roundRect(x, y, width, 21, 7, fill, recovering ? '#8dbfa8' : '#dcb879');
  if (status.cleared && !count) {
    c.strokeStyle = color; c.lineWidth = 1.8; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x + 7, y + 10); c.lineTo(x + 10, y + 13); c.lineTo(x + 15, y + 7); c.stroke();
  } else {
    for (let index = 0; index < 3; index++) {
      c.globalAlpha = alpha * (reducedMotion ? 1 : .4 + .6 * (.5 + .5 * Math.sin(time * 4 - index * 1.2)));
      r.roundRect(x + 6 + index * 3.7, y + 8, 2.5, 5, 1, color);
    }
    c.globalAlpha = alpha;
  }
  r.text(label, x + width / 2 + 7, y + 10.5, 10, color, 'center', true);
  c.restore();
}

function drawBlueprint(r, rect, machineId, label, options = {}) {
  const c = r.ctx, foot = footOf(rect), wide = rect.w >= 75;
  const width = Math.min(wide ? 84 : 51, rect.w * 1.02), height = wide ? 77 : 53;
  const color = options.affordable === false ? '#8d9585' : '#489c90';
  c.save();
  c.lineWidth = 1;
  polygon(c, groundDiamond(rect, width * .95, width * .39));
  c.fillStyle = '#d9e9d55c'; c.fill();
  c.strokeStyle = color;
  if (c.setLineDash) c.setLineDash([4, 3]);
  c.stroke();
  if (c.setLineDash) c.setLineDash([]);
  c.globalAlpha *= options.alpha === undefined ? .28 : clamp(options.alpha);
  r.factoryAsset(assetId(machineId), foot[0] - width / 2, foot[1] - height + 3, width, height);
  c.restore();
  // The symbol sits on the reserved pad rather than on either transport lane.
  r.image('factory/expansion-plus-sign', foot[0] - 8, foot[1] - 22, 16, 21, .95);
  if (label) {
    const labelWidth = options.labelWidth || (wide ? rect.w + 8 : 58);
    drawFactoryNameplate(r, label, foot[0] - labelWidth / 2, foot[1] + 8, labelWidth);
  }
}

function drawHammer(c, x, y, angle) {
  c.save(); c.translate(x, y); c.rotate(angle);
  c.lineCap = 'round'; c.strokeStyle = '#8b603e'; c.lineWidth = 3;
  c.beginPath(); c.moveTo(0, 3); c.lineTo(0, 15); c.stroke();
  c.strokeStyle = '#fff2ca'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(-.7, 4); c.lineTo(-.7, 14); c.stroke();
  c.fillStyle = '#719394'; c.fillRect(-7, -1, 14, 6);
  c.fillStyle = '#dce9df'; c.fillRect(-6, -1, 12, 2);
  c.restore();
}

// This overlay is deliberately short and has no authority over construction
// completion, production or input. The caller supplies its presentation clock.
function drawConstruction(r, scene, progress, reducedMotion = false) {
  const rect = scene.machine || scene;
  if (!rect || progress >= 1) return;
  const p = clamp(progress), c = r.ctx, foot = footOf(rect);
  const fade = 1 - smooth((p - .72) / .28);
  const left = foot[0] - rect.w * .35, right = foot[0] + rect.w * .35;
  const bottom = foot[1] - 2, top = bottom - Math.min(73, rect.h * .5);
  c.save(); c.globalAlpha *= fade;
  // Light scaffold posts reveal the real machine through the assembly stage.
  c.strokeStyle = '#b99a6b'; c.lineWidth = 3; c.lineCap = 'round';
  c.beginPath();
  c.moveTo(left, bottom); c.lineTo(left, top); c.lineTo(right, top + 7); c.lineTo(right, bottom + 7);
  c.moveTo(left, bottom - 15); c.lineTo(right, bottom - 8); c.stroke();
  c.strokeStyle = '#fff0cd'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(left - .5, bottom - 2); c.lineTo(left - .5, top + 1);
  c.lineTo(right, top + 8); c.stroke();
  // The front safety rail uses the same rising ground edge as the factory.
  polygon(c, [[left - 3, bottom - 12], [right + 3, bottom + 2], [right + 3, bottom + 9], [left - 3, bottom - 5]]);
  c.fillStyle = '#e1ac54'; c.fill();
  c.save(); c.clip(); c.strokeStyle = '#fff1c8'; c.lineWidth = 5;
  for (let x = left - 10; x < right + 20; x += 13) {
    c.beginPath(); c.moveTo(x, bottom - 16); c.lineTo(x + 13, bottom + 13); c.stroke();
  }
  c.restore();
  const swing = reducedMotion ? -.4 : -.6 + Math.sin(p * TAU * 3) * .4;
  drawHammer(c, right - 5, top - 6, swing);
  if (!reducedMotion) {
    for (let index = 0; index < 5; index++) {
      const age = (p * 2.2 + index * .19) % 1;
      c.save(); c.globalAlpha *= (1 - age) * .36;
      ellipse(c, foot[0] + (index - 2) * 14 + (index % 2 ? 1 : -1) * age * 6,
        bottom - age * 14 + 3, 13 + age * 14, 6 + age * 5);
      c.fillStyle = '#fff4d8'; c.fill(); c.restore();
    }
  }
  r.roundRect(foot[0] - 29, top - 22, 58, 18, 6, '#fff0cd', '#d2b17a');
  r.text('安装中', foot[0], top - 13, 10, '#916535', 'center', true);
  r.roundRect(foot[0] - 23, top - 5, 46, 2, 1, '#d8c5a0');
  if (p > 0) r.roundRect(foot[0] - 23, top - 5, Math.max(2, 46 * p), 2, 1, '#51a58b');
  c.restore();
}

function drawFirstStocked(r, warehouse, progress, reducedMotion = false, options = {}) {
  if (progress >= 1 || progress < 0) return;
  const p = clamp(progress), c = r.ctx;
  const slot = options.stockSlot || r.factorySlot('factory/warehouse', warehouse, 'stock');
  const x = slot.x + slot.w / 2, y = slot.y + slot.h * .61;
  const fade = 1 - smooth((p - .65) / .35);
  const radius = reducedMotion ? 29 : 22 + smooth(p) * 19;
  c.save(); c.globalAlpha *= fade;
  ellipse(c, x, y + 4, radius * 2, radius * .63);
  c.fillStyle = '#bfeccb66'; c.fill();
  c.strokeStyle = '#65b297'; c.lineWidth = 1.5; c.stroke();
  if (options.product) {
    const size = Math.min(40, Math.max(25, slot.w * .8));
    const lift = reducedMotion ? 0 : Math.sin(clamp(p / .45) * Math.PI) * 5;
    r.contain('product/' + options.product + '/' + (options.outputLevel || 1),
      x - size / 2, y - size * .79 - lift, size, size);
  }
  const labelY = Math.min(slot.y - 8, y - 24);
  r.roundRect(x - 40, labelY - 10, 80, 20, 7, '#eaf8e8', '#90bc9c');
  c.strokeStyle = '#287c61'; c.lineWidth = 1.7; c.lineCap = 'round';
  c.beginPath(); c.moveTo(x - 32, labelY); c.lineTo(x - 29, labelY + 3); c.lineTo(x - 24, labelY - 3); c.stroke();
  r.text('首件入库', x + 6, labelY, 11, '#287c61', 'center', true);
  c.restore();
}

module.exports = { drawCacheContents, drawPackagingSignal, drawBlueprint, drawConstruction, drawFirstStocked };
