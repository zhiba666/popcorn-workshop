'use strict';

const TAU = Math.PI * 2;
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };

function polygon(ctx, points) {
  ctx.beginPath();
  points.forEach((p, index) => index ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
  ctx.closePath();
}

function sprite(renderer, id, x, y, w, h) {
  const image = renderer.assets.get(id), meta = renderer.assets.meta(id) || {};
  if (!image) return null;
  const src = meta.draw && meta.draw.sourceRect || [0, 0, image.width, image.height];
  const scale = Math.min(w / src[2], h / src[3]), ctx = renderer.ctx;
  const width = src[2] * scale, height = src[3] * scale;
  ctx.save();
  ctx.beginPath(); ctx.rect(x + (w - width) / 2, y + h - height, width, height); ctx.clip();
  ctx.translate(x + (w - width) / 2 - src[0] * scale, y + h - height - src[1] * scale);
  ctx.scale(scale, scale);
  return { image, meta, ctx };
}

function bitmap(renderer, id, rect, alpha = 1) {
  const image = renderer.assets.get(id), meta = renderer.assets.meta(id) || {};
  if (!image) return;
  const src = meta.draw && meta.draw.sourceRect || [0, 0, image.width, image.height];
  const ctx = renderer.ctx;
  ctx.save(); ctx.globalAlpha *= alpha;
  ctx.drawImage(image, src[0], src[1], src[2], src[3], rect[0], rect[1], rect[2], rect[3]);
  ctx.restore();
}

function pointAlong(points, progress) {
  const lengths = points.slice(1).map((p, index) => Math.hypot(p[0] - points[index][0], p[1] - points[index][1]));
  let distance = clamp(progress) * lengths.reduce((sum, n) => sum + n, 0);
  for (let index = 0; index < lengths.length; index++) {
    if (distance <= lengths[index] || index === lengths.length - 1) {
      const t = lengths[index] ? distance / lengths[index] : 0;
      return [points[index][0] + (points[index + 1][0] - points[index][0]) * t,
        points[index][1] + (points[index + 1][1] - points[index][1]) * t];
    }
    distance -= lengths[index];
  }
  return points[0];
}

function nativePoint(meta, point) {
  return [(point[0] - meta.sourceCrop[0]) * meta.scale[0], (point[1] - meta.sourceCrop[1]) * meta.scale[1]];
}

function texture(ctx, image, region, destination, width, height, angle, alpha) {
  const xs = region.map(p => p[0]), ys = region.map(p => p[1]);
  const left = Math.min(...xs), top = Math.min(...ys), sourceWidth = Math.max(...xs) - left, sourceHeight = Math.max(...ys) - top;
  ctx.save(); ctx.translate(destination[0], destination[1]); ctx.rotate(angle);
  ctx.scale(width / sourceWidth, height / sourceHeight); ctx.translate(-left - sourceWidth / 2, -top - sourceHeight / 2);
  polygon(ctx, region); ctx.clip(); ctx.globalAlpha *= alpha; ctx.drawImage(image, 0, 0); ctx.restore();
}

// Reuse the authored drum's lift-and-fall motion with kernel crops from the runtime artwork.
function tumble(ctx, image, meta, phase, progress, seconds, speed) {
  const cavity = [[711,344],[775,312],[865,316],[935,363],[979,451],[985,545],[963,614],[916,650],[842,662],[782,642],[733,604],[707,539],[691,459],[695,391]].map(p => nativePoint(meta, p));
  const input = [[325,242],[338,240],[352,244],[363,251],[368,260],[372,267],[368,282],[361,292],[352,297],[346,301],[331,299],[318,293],[309,284],[305,272],[308,258],[315,249]].map(p => nativePoint(meta, p));
  const output = [[1000,1019],[1018,1006],[1037,1005],[1052,1017],[1069,1021],[1083,1034],[1088,1052],[1081,1070],[1065,1078],[1053,1086],[1035,1088],[1021,1076],[1007,1069],[995,1055],[995,1038]].map(p => nativePoint(meta, p));
  const fill = phase === 'feeding' ? smooth(progress * seconds / 0.8) : 1;
  const coating = phase === 'processing' ? smooth(progress * seconds / 1.3) : 0;
  const time = progress * seconds * (phase === 'processing' ? speed : 0.15);
  const particles = Array.from({ length: 9 }, (_, index) => {
    const turn = (time + index * 0.127) % 1, rising = turn < 0.62;
    const t = rising ? turn / 0.62 : (turn - 0.62) / 0.38;
    const x = rising ? 807 + 125 * Math.sin(t * Math.PI * 0.75) : 895 - 106 * smooth(t);
    const y = rising ? 623 - 153 * Math.sin(t * Math.PI / 2) : 470 + 153 * t * t;
    return { index, position: nativePoint(meta, [x + (index % 3 - 1) * 21, y + index % 2 * 17]), turn };
  }).sort((a, b) => a.position[1] - b.position[1]);
  ctx.save(); polygon(ctx, cavity); ctx.clip();
  particles.forEach(particle => {
    if (particle.index / 9 > fill) return;
    const scale = 0.8 + particle.index % 3 * 0.07;
    const width = 83 * meta.scale[0] * scale, height = 77 * meta.scale[1] * scale;
    const angle = Math.sin(particle.turn * TAU + particle.index) * 0.75;
    texture(ctx, image, input, particle.position, width, height, angle, 1);
    if (coating > 0) texture(ctx, image, output, particle.position, width, height, angle, coating);
  });
  ctx.restore();
}

function drawMachine(renderer, id, x, y, w, h, phase, progress, time) {
  const assetId = id.startsWith('factory/') ? id : 'factory/' + id;
  const surface = sprite(renderer, assetId, x, y, w, h);
  if (!surface) return;
  const { image, meta, ctx } = surface, animation = meta.animation;
  const clean = renderer.assets.get(assetId + '-body-clean') || image;
  ctx.drawImage(clean, 0, 0);
  if (!animation) { ctx.restore(); return; }
  const phaseId = phase === 'discharge' ? 'discharging' : phase;
  const currentPhase = animation.phases.find(p => p.id === phaseId);
  const active = !!currentPhase, local = currentPhase ? clamp(progress) * currentPhase.seconds : 0;
  const phaseStart = name => {
    let elapsed = 0;
    for (const entry of animation.phases) { if (entry.id === name) return elapsed; elapsed += entry.seconds; }
    return 0;
  };
  animation.layers.forEach(layer => {
    if (layer.eraseOnly) return;
    const motion = layer.motion || {}, enabled = active && layer.when.includes(phaseId);
    const input = /hopper|input/.test(layer.id), output = layer.id.startsWith('product-');
    if (layer.role === 'material' && !(active && (input || (output ? phaseId === 'discharging' : enabled)))) return;
    if (motion.type === 'tumble') {
      if (enabled) tumble(ctx, image, meta, phaseId, clamp(progress), currentPhase.seconds, motion.speed);
      return;
    }
    let dx = 0, dy = 0, alpha = 1;
    if (motion.type === 'flow') {
      if (!enabled) return;
      const duration = Math.max(0.08, motion.duration || currentPhase.seconds);
      const anchor = motion.startPhase || motion.phase || layer.when[0];
      const age = phaseStart(phaseId) + local - phaseStart(anchor) - (motion.delay || 0);
      if (age < 0 || !motion.repeat && age >= duration) return;
      const travel = motion.repeat ? (age % duration) / duration : age / duration;
      const destination = pointAlong(motion.path, travel);
      dx = destination[0] - layer.pivot[0]; dy = destination[1] - layer.pivot[1];
      alpha = !motion.repeat && travel > 0.94 ? clamp((1 - travel) / 0.06) : 1;
    } else if (enabled && motion.type === 'vibrate') {
      const amplitude = motion.amplitude || [0, 0];
      dx = Math.sin(local * TAU * motion.speed) * amplitude[0];
      dy = Math.sin(local * TAU * motion.speed + 0.6) * amplitude[1];
    }
    ctx.save();
    if (motion.clipPolygon) { polygon(ctx, motion.clipPolygon); ctx.clip(); }
    if (layer.role === 'mechanical' && layer.cleanPatch === false) { polygon(ctx, layer.polygon); ctx.clip(); }
    ctx.translate(dx, dy); polygon(ctx, layer.polygon); ctx.clip(); ctx.globalAlpha *= alpha;
    ctx.drawImage(layer.role === 'foreground' || layer.role === 'mechanical' && !layer.cleanPatch ? clean : image, 0, 0);
    ctx.restore();
  });
  ctx.restore();
}

function drawSupply(renderer, x, y, w, h, running, time, fill = 1) {
  const surface = sprite(renderer, 'factory/supply-body-clean', x, y, w, h);
  if (!surface) return;
  const { ctx, image, meta } = surface, rig = meta.animation;
  if (!rig) { ctx.drawImage(image, 0, 0); ctx.restore(); return; }
  ctx.save(); polygon(ctx, rig.glass); ctx.clip();
  const count = Math.round(clamp(fill) * 42);
  for (let index = 0; index < count; index++) {
    const row = Math.floor(index / 7), col = index % 7;
    const point = nativePoint(meta, [260 + col * 94 + row % 2 * 28 + Math.sin(index * 4.3) * 12,
      621 - row * 55 + col * 17 + Math.cos(index * 3.7) * 11]);
    ctx.save(); ctx.translate(point[0], point[1]); ctx.rotate((index % 5 - 2) * 0.18);
    bitmap(renderer, 'factory/loose-popcorn', [-52 * meta.scale[0], -47 * meta.scale[1], 104 * meta.scale[0], 95 * meta.scale[1]]);
    ctx.restore();
  }
  ctx.restore(); ctx.drawImage(image, 0, 0);
  const motor = rig.motor.rect.slice();
  if (running) motor[0] += Math.sin(time * 22) * 1.6 * meta.scale[0];
  bitmap(renderer, 'factory/supply-motor-cap', motor);
  ctx.restore();
}

function drawPacker(renderer, x, y, w, h, phase, progress, productId = 'original', outputLevel = 1) {
  const surface = sprite(renderer, 'factory/packer-body-clean', x, y, w, h);
  if (!surface) return;
  const { ctx, image, meta } = surface, rig = meta.animation;
  ctx.drawImage(image, 0, 0);
  if (!rig) { ctx.restore(); return; }
  const packaging = phase === 'packaging', p = clamp(progress || 0);
  const stroke = packaging ? Math.pow(Math.sin(Math.PI * p), 2) * rig.head.travel : 0;
  ctx.save(); polygon(ctx, rig.opening); ctx.clip();
  if (packaging) {
    const position = nativePoint(meta, [785, 640]);
    bitmap(renderer, 'product/' + productId + '/' + outputLevel,
      [position[0], position[1], 150 * meta.scale[0], 168 * meta.scale[1]], 0.4 + 0.6 * p);
  }
  const piston = rig.piston, guide = piston.guide;
  ctx.fillStyle = '#b8cfca';
  ctx.fillRect(piston.centerX - piston.rodWidth / 2, guide[1] + guide[3] - 2,
    piston.rodWidth, Math.max(0, piston.attachmentY + stroke - guide[1] - guide[3] + 2));
  ctx.fillStyle = '#f6cc75'; ctx.strokeStyle = '#98692f'; ctx.lineWidth = 0.7;
  ctx.fillRect(guide[0], guide[1], guide[2], guide[3]); ctx.strokeRect(guide[0], guide[1], guide[2], guide[3]);
  ctx.save(); polygon(ctx, piston.topOccluder); ctx.clip(); ctx.drawImage(image, 0, 0); ctx.restore();
  const head = rig.head.rect.slice(); head[1] += stroke;
  bitmap(renderer, 'factory/packer-head', head);
  ctx.restore();
  rig.foreground.forEach(region => { ctx.save(); polygon(ctx, region); ctx.clip(); ctx.drawImage(image, 0, 0); ctx.restore(); });
  ctx.restore();
}

module.exports = { drawMachine, drawSupply, drawPacker };
