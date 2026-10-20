'use strict';

const { drawRotaryMachine } = require('./factory-rotary');
const { PRODUCTION_CONFIG: CONFIG, PRODUCT_DEFINITIONS } = require('../../domain/production/production-config');

const TAU = Math.PI * 2;
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const outputFlows = new WeakMap();

function productionVisual(factory, product) {
  const phase = factory.phase === 'discharge' ? 'discharging' : factory.phase;
  const duration = factory.duration > 0 ? factory.duration : CONFIG.phaseDurations[phase] || 0;
  const progress = duration > 0 ? clamp(factory.elapsed / duration) : 0;
  const state = { renderPhase: phase, renderProgress: progress,
    transferVisible: phase === 'transport' || phase === 'waiting-cache',
    transferProgress: phase === 'waiting-cache' ? 1 : phase === 'transport' ? progress : 0 };
  if (product === 'sandwich-square' || !['discharging', 'transport'].includes(phase)) return state;

  // Normalize by the real current duration before entering this shared clock.
  // Old batches can have different durations without needing the previous
  // phase's duration in a save or a frame-dependent animation accumulator.
  const discharge = CONFIG.phaseDurations.discharging, transport = CONFIG.phaseDurations.transport;
  const inside = discharge + transport / 2, outside = transport / 2;
  const age = phase === 'discharging' ? progress * discharge : discharge + progress * transport;
  if (age < inside) {
    state.renderPhase = 'discharging';
    state.renderProgress = clamp(age / inside);
    state.transferVisible = false;
    state.transferProgress = 0;
  } else {
    state.renderPhase = 'transport';
    state.transferProgress = clamp((age - inside) / outside);
    state.renderProgress = state.transferProgress;
    state.transferVisible = true;
  }
  return state;
}

function closingStroke(time, duration, hold = 0) {
  const travel = Math.max(0.01, (duration - hold) / 2);
  if (time < 0 || time > duration) return 0;
  if (time < travel) return smooth(time / travel);
  if (time < travel + hold) return 1;
  return 1 - smooth((time - travel - hold) / travel);
}

function polygon(ctx, points) {
  ctx.beginPath();
  points.forEach((p, index) => index ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
  ctx.closePath();
}

function excludePolygon(ctx, image, points) {
  const area = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0);
  const hole = area > 0 ? points.slice().reverse() : points;
  ctx.beginPath(); ctx.rect(0, 0, image.width, image.height);
  hole.forEach((point, index) => index ? ctx.lineTo(point[0], point[1]) : ctx.moveTo(point[0], point[1]));
  ctx.closePath(); ctx.clip();
}

function bladeHubPath(ctx, layer, meta, anticlockwise = false) {
  ctx.save(); ctx.translate(layer.pivot[0], layer.pivot[1]); ctx.scale(meta.scale[0], meta.scale[1]);
  ctx.translate(-5, 0); ctx.rotate(-0.16); ctx.scale(31, 44);
  ctx.moveTo(1, 0); ctx.arc(0, 0, 1, 0, TAU, anticlockwise); ctx.closePath(); ctx.restore();
}

function projectedBlade(ctx, image, meta, layer, time) {
  const [rx, ry] = layer.motion.radius, [x, y] = layer.pivot;
  const shear = (layer.motion.shear || 0) * meta.scale[0] / meta.scale[1];
  const angle = time * TAU * layer.motion.speed, c = Math.cos(angle), s = Math.sin(angle);
  ctx.save(); polygon(ctx, layer.polygon); ctx.clip();
  ctx.translate(x, y);
  ctx.transform(c + shear * ry / rx * s, ry / rx * s,
    -(rx / ry + shear * shear * ry / rx) * s, c - shear * ry / rx * s, 0, 0);
  ctx.translate(-x, -y);
  polygon(ctx, layer.polygon); ctx.clip();
  // The source gold axle stays fixed while only the blade face rotates in its projected plane.
  ctx.beginPath(); ctx.rect(0, 0, image.width, image.height); bladeHubPath(ctx, layer, meta, true); ctx.clip();
  ctx.drawImage(image, 0, 0); ctx.restore();
  ctx.save(); polygon(ctx, layer.polygon); ctx.clip();
  ctx.beginPath(); bladeHubPath(ctx, layer, meta); ctx.clip(); ctx.drawImage(image, 0, 0); ctx.restore();
}

function roller(ctx, image, meta, layer, time) {
  const sx = meta.scale[0], sy = meta.scale[1];
  const xs = layer.polygon.map(point => point[0]), ys = layer.polygon.map(point => point[1]);
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
  ctx.save(); polygon(ctx, layer.polygon); ctx.clip(); ctx.drawImage(image, 0, 0);
  if (time > 0) {
    const period = bottom - top + 48 * sy;
    const offset = ((time * layer.motion.speed * 85 * sy * layer.motion.direction) % period + period) % period;
    for (let index = -1; index < 2; index++) {
      const y = top + offset + index * period;
      const band = ctx.createLinearGradient(0, y - 15 * sy, 0, y + 17 * sy);
      band.addColorStop(0, '#ffffff00'); band.addColorStop(0.46, '#ffffff45');
      band.addColorStop(0.55, '#36344118'); band.addColorStop(1, '#36344100');
      ctx.fillStyle = band;
      polygon(ctx, [[left - 20 * sx, y + 16 * sy], [right + 20 * sx, y - 28 * sy],
        [right + 20 * sx, y + 5 * sy], [left - 20 * sx, y + 49 * sy]]);
      ctx.fill();
    }
  }
  ctx.restore();
}

function hingedLid(ctx, image, closed, layer, closure) {
  const [x, y] = layer.pivot, amplitude = layer.motion.amplitude || [0, 0];
  ctx.save(); ctx.translate(x + amplitude[0] * closure, y + amplitude[1] * closure);
  ctx.scale(1, Math.max(0.025, 1 - closure)); ctx.translate(-x, -y);
  ctx.globalAlpha *= closed ? 1 - smooth((closure - 0.1) / 0.35) : 1;
  polygon(ctx, layer.polygon); ctx.clip(); ctx.drawImage(image, 0, 0); ctx.restore();
  const closedMix = closed ? smooth((closure - 0.25) / 0.35) : 0;
  if (closedMix > 0) {
    ctx.save(); ctx.translate(x, y); ctx.scale(1, Math.min(1, Math.max(0.025, closure / 0.8))); ctx.translate(-x, -y);
    ctx.globalAlpha *= closedMix;
    polygon(ctx, layer.closedPolygon); ctx.clip(); ctx.drawImage(closed, 0, 0); ctx.restore();
  }
}

function flipMold(ctx, meta, spec, front, rear, progress) {
  const [sx, sy] = meta.scale, [[x1, y1], [x2, y2]] = spec.axis;
  const x = (x1 + x2) / 2, y = (y1 + y2) / 2;
  const dx = (x2 - x1) / sx, dy = (y2 - y1) / sy, length = Math.hypot(dx, dy);
  const ux = dx / length, uy = dy / length, vx = -uy, vy = ux;
  const angle = smooth(progress) * TAU * (spec.turns || 1), cosine = Math.cos(angle), sine = Math.sin(angle);
  const projections = spec.polygon.map(point => (point[0] - x) / sx * ux + (point[1] - y) / sy * uy);
  const left = Math.min(...projections), right = Math.max(...projections);
  const thickness = (spec.thickness || 54) * Math.abs(sine);
  if (thickness > 0.5) {
    ctx.save(); ctx.translate(x, y); ctx.scale(sx, sy); ctx.transform(ux, uy, vx, vy, 0, 0);
    const edgeLeft = left + 9, edgeRight = right - 9, top = -thickness / 2, bottom = thickness / 2;
    const radius = Math.min(10, thickness / 2);
    ctx.beginPath(); ctx.moveTo(edgeLeft + radius, top); ctx.lineTo(edgeRight - radius, top);
    ctx.quadraticCurveTo(edgeRight, top, edgeRight, top + radius); ctx.lineTo(edgeRight, bottom - radius);
    ctx.quadraticCurveTo(edgeRight, bottom, edgeRight - radius, bottom); ctx.lineTo(edgeLeft + radius, bottom);
    ctx.quadraticCurveTo(edgeLeft, bottom, edgeLeft, bottom - radius); ctx.lineTo(edgeLeft, top + radius);
    ctx.quadraticCurveTo(edgeLeft, top, edgeLeft + radius, top); ctx.closePath(); ctx.clip();
    const source = nativePoint(meta, [750, 716]);
    ctx.drawImage(front, source[0], source[1], 102 * sx, 28 * sy, edgeLeft, top, edgeRight - edgeLeft, thickness);
    const shade = ctx.createLinearGradient(0, top, 0, bottom);
    shade.addColorStop(0, '#ffffff45'); shade.addColorStop(0.45, '#ffffff00'); shade.addColorStop(1, '#00234465');
    ctx.fillStyle = shade; ctx.fillRect(left, top, right - left, thickness); ctx.restore();
  }
  if (Math.abs(cosine) > 0.035) {
    ctx.save(); ctx.translate(x + vx * sine * 12 * sx, y + vy * sine * 12 * sy);
    const offDiagonal = ux * uy * (1 - cosine);
    ctx.transform(ux * ux + cosine * uy * uy, offDiagonal * sy / sx,
      offDiagonal * sx / sy, uy * uy + cosine * ux * ux, 0, 0);
    ctx.translate(-x, -y); ctx.drawImage(cosine >= 0 ? front : rear, 0, 0); ctx.restore();
  }
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

function finalOutputFlow(meta) {
  if (outputFlows.has(meta)) return outputFlows.get(meta);
  const animation = meta.animation, starts = {};
  let elapsed = 0, last = null;
  for (const phase of animation.phases) { starts[phase.id] = elapsed; elapsed += phase.seconds; }
  for (const layer of animation.layers) {
    const motion = layer.motion;
    if (layer.eraseOnly || !layer.id.startsWith('product-') || motion.type !== 'flow') continue;
    const path = motion.path;
    if (path == null || !path.length) continue;
    const anchor = motion.startPhase || motion.phase || layer.when[0];
    let phaseSeconds = motion.duration;
    if (!phaseSeconds) {
      const anchorPhase = animation.phases.find(phase => phase.id === anchor);
      phaseSeconds = anchorPhase == null ? undefined : anchorPhase.seconds;
    }
    const duration = Math.max(0.08, phaseSeconds || 0);
    const end = (starts[anchor] || 0) + (motion.delay || 0) + duration;
    if (last && (end < last.end || end === last.end && layer.id <= last.layer.id)) continue;
    const length = path.slice(1).reduce((sum, point, index) =>
      sum + Math.hypot(point[0] - path[index][0], point[1] - path[index][1]), 0);
    const endPoint = path[path.length - 1], previous = path[path.length - 2];
    const dx = previous ? endPoint[0] - previous[0] : 0, dy = previous ? endPoint[1] - previous[1] : 0;
    const lastLength = Math.hypot(dx, dy);
    const dischargePhase = animation.phases.find(phase => phase.id === 'discharging');
    last = { layer, duration, end, length, endpoint: endPoint,
      direction: lastLength > 0 ? [dx / lastLength, dy / lastLength] : null,
      dischargeSeconds: (dischargePhase == null ? undefined : dischargePhase.seconds) || 0 };
  }
  outputFlows.set(meta, last);
  return last;
}

function machineOutputDirection(renderer, machine, product) {
  const definition = PRODUCT_DEFINITIONS[product];
  if (!definition || product === 'sandwich-square' || !((machine == null ? undefined : machine.w) > 0 && machine.h > 0)) return null;
  const id = 'factory/' + definition.machineId, meta = renderer.assets.meta(id);
  if (!renderer.assets.get(id) || meta == null || !meta.animation) return null;
  const output = finalOutputFlow(meta);
  // The machine contain transform is uniform, so source-image directions are
  // also design-screen directions; no ground projection is applied to the art.
  return output != null && output.direction ? output.direction.slice() : null;
}

function machineOutputPort(renderer, machine, product) {
  const definition = PRODUCT_DEFINITIONS[product];
  if (!definition || product === 'sandwich-square' || !((machine == null ? undefined : machine.w) > 0 && machine.h > 0)) return null;
  const id = 'factory/' + definition.machineId, image = renderer.assets.get(id), meta = renderer.assets.meta(id);
  if (!image || meta == null || !meta.animation) return null;
  const output = finalOutputFlow(meta);
  if (!output) return null;
  const draw = meta.draw;
  const source = (draw == null ? undefined : draw.sourceRect) || [0, 0, image.width, image.height];
  const scale = Math.min(machine.w / source[2], machine.h / source[3]);
  return [machine.x + (machine.w - source[2] * scale) / 2 + (output.endpoint[0] - source[0]) * scale,
    machine.y + machine.h - source[3] * scale + (output.endpoint[1] - source[1]) * scale];
}

function drawMachineTransfer(renderer, machine, path, progress, product) {
  const definition = PRODUCT_DEFINITIONS[product];
  if (!definition || product === 'sandwich-square' || path == null || !path.length) return false;
  const id = 'factory/' + definition.machineId, image = renderer.assets.get(id), meta = renderer.assets.meta(id);
  if (!image || meta == null || !meta.animation) return false;
  const output = finalOutputFlow(meta);
  if (!output) return false;
  const draw = meta.draw;
  const source = (draw == null ? undefined : draw.sourceRect) || [0, 0, image.width, image.height];
  const scale = Math.min(machine.w / source[2], machine.h / source[3]);
  const outsideLength = path.slice(1).reduce((sum, point, index) =>
    sum + Math.hypot(point[0] - path[index][0], point[1] - path[index][1]), 0);
  const insideSeconds = CONFIG.phaseDurations.discharging + CONFIG.phaseDurations.transport / 2;
  const outsideSeconds = CONFIG.phaseDurations.transport / 2;
  const exitSpeed = output.length * scale / output.duration * output.dischargeSeconds / insideSeconds;
  // Match the departing crop's speed at the port and settle at the cache.
  // Bounding the initial derivative keeps the cubic monotone on short routes.
  const tangent = outsideLength > 0 ? Math.max(0, Math.min(3, exitSpeed * outsideSeconds / outsideLength)) : 0;
  const p = clamp(progress), travel = -2 * p ** 3 + 3 * p * p + tangent * (p ** 3 - 2 * p * p + p);
  const position = pointAlong(path, travel), ctx = renderer.ctx, layer = output.layer;
  // Use the same bitmap, source-space pivot and contain scale as drawMachine.
  // There is no machine-box clip: the food can travel past the body and rails.
  ctx.save(); ctx.translate(position[0], position[1]); ctx.scale(scale, scale);
  ctx.translate(-layer.pivot[0], -layer.pivot[1]);
  polygon(ctx, layer.polygon); ctx.clip(); ctx.drawImage(image, 0, 0); ctx.restore();
  return true;
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

function flowingStream(ctx, image, layer, dx, dy, fillProgress, drainProgress, obstacles) {
  if (fillProgress <= 0 || drainProgress >= 1) return;
  const points = layer.motion.path, first = points[0], last = points[points.length - 1];
  const vx = last[0] - first[0], vy = last[1] - first[1], lengthSquared = vx * vx + vy * vy;
  const aperture = layer.motion.clipPolygon || layer.polygon;
  const projection = ([x, y]) => lengthSquared ? (x * vx + y * vy) / lengthSquared : 0;
  const clipExtent = aperture.map(projection), pieceExtent = layer.polygon.map(projection);
  const offset = projection([dx, dy]);
  const firstCopy = Math.ceil(Math.min(...clipExtent) - Math.max(...pieceExtent) - offset);
  const lastCopy = Math.floor(Math.max(...clipExtent) - Math.min(...pieceExtent) - offset);
  ctx.save(); polygon(ctx, aperture); ctx.clip();
  for (const [progress, direction] of [[drainProgress, 1], [fillProgress, -1]]) {
    if (!lengthSquared || direction === 1 && !(progress > 0) || direction === -1 && !(progress < 1)) continue;
    const length = Math.sqrt(lengthSquared), ux = vx / length, uy = vy / length;
    const extent = aperture.map(([x, y]) => x * ux + y * uy);
    const cutoff = Math.min(...extent) + (Math.max(...extent) - Math.min(...extent)) * progress;
    const x = ux * cutoff, y = uy * cutoff, span = image.width + image.height;
    polygon(ctx, [[x - uy * span, y + ux * span], [x + uy * span, y - ux * span],
      [x + (direction * ux + uy) * span, y + (direction * uy - ux) * span],
      [x + (direction * ux - uy) * span, y + (direction * uy + ux) * span]]);
    ctx.clip();
  }
  for (let copy = firstCopy; copy <= lastCopy; copy++) {
    ctx.save(); ctx.translate(dx + copy * vx, dy + copy * vy);
    polygon(ctx, layer.polygon); ctx.clip();
    if (layer.id === 'sheet' || layer.id === 'cut-strips') {
      obstacles.forEach(obstacle => excludePolygon(ctx, image, obstacle.polygon));
    }
    ctx.drawImage(image, 0, 0); ctx.restore();
  }
  ctx.restore();
}

function drawMachine(renderer, id, x, y, w, h, phase, progress, time, reducedMotion = false, line = null, firstStocked = false) {
  const assetId = id.startsWith('factory/') ? id : 'factory/' + id;
  const surface = sprite(renderer, assetId, x, y, w, h);
  if (!surface) return;
  const { image, meta, ctx } = surface, animation = meta.animation;
  const clean = renderer.assets.get(assetId + '-body-clean') || image;
  if (!animation) { ctx.drawImage(clean, 0, 0); ctx.restore(); return; }
  const phaseId = phase === 'discharge' ? 'discharging' : phase;
  // Freeze mechanical poses when requested, but keep the essential output
  // handoff tied to real progress so transport starts at the same port.
  const poseProgress = reducedMotion && phaseId !== 'discharging' ?
    (phaseId === 'feeding' ? 1 : 0.5) : clamp(progress);
  if (animation.indexedTable) {
    drawRotaryMachine(renderer, image, meta, phaseId, clamp(progress), line,
      { small: w <= 180, reducedMotion, machineWidth: w, machineHeight: h }); ctx.restore(); return;
  }
  const currentPhase = animation.phases.find(p => p.id === phaseId);
  const active = !!currentPhase, local = currentPhase ? poseProgress * currentPhase.seconds : 0;
  // Material still crosses phase boundaries when mechanical motion is reduced.
  const materialTime = currentPhase ? clamp(progress) * currentPhase.seconds : 0;
  const lid = animation.layers.find(layer => layer.motion.type === 'hinge');
  const lidMotion = lid && lid.motion;
  const closure = lidMotion && phaseId === lidMotion.phase ?
    closingStroke(local - (lidMotion.delay || 0), lidMotion.duration, lidMotion.hold || 0) : 0;
  const flip = animation.flipAssembly;
  const flipAge = flip ? local - flip.delay : -1;
  const flipFront = flip && renderer.assets.get(flip.frontAsset), flipRear = flip && renderer.assets.get(flip.rearAsset);
  const flipFrame = flip && renderer.assets.get(flip.frameAsset);
  const flipping = !reducedMotion && flip && phaseId === flip.phase && flipAge >= 0 && flipAge <= flip.duration && flipFront && flipRear && flipFrame;
  ctx.drawImage(flipping ? flipFrame : clean, 0, 0);
  const pressHead = animation.layers.find(layer => layer.id === 'press-head');
  const pressMotion = pressHead && pressHead.motion;
  const pressMovement = pressMotion && phaseId === pressMotion.phase ?
    closingStroke(local - (pressMotion.delay || 0), pressMotion.duration, pressMotion.hold || 0) : 0;
  const phaseStart = name => {
    let elapsed = 0;
    for (const entry of animation.phases) { if (entry.id === name) return elapsed; elapsed += entry.seconds; }
    return 0;
  };
  const mechanicalTime = active ? phaseStart(phaseId) + local : 0;
  const foodObstacles = animation.layers.filter(layer => layer.id.startsWith('cutter-') ||
    layer.id === 'crosscut-frame' || layer.id === 'crosscut-blade');
  let assemblyDrawn = false;
  animation.layers.forEach(layer => {
    if (flipping && !assemblyDrawn && layer.order >= (flip.order || 70)) {
      flipMold(ctx, meta, flip, flipFront, flipRear, flipAge / flip.duration); assemblyDrawn = true;
    }
    if (flipping && flip.layerIds.includes(layer.id)) return;
    if (layer.eraseOnly) return;
    const motion = layer.motion || {}, enabled = active && layer.when.includes(phaseId);
    const input = /hopper|input/.test(layer.id), output = layer.id.startsWith('product-');
    if (layer.role === 'material' && !(active && (input || enabled))) return;
    if (motion.type === 'tumble') {
      if (enabled) tumble(ctx, image, meta, phaseId, poseProgress, currentPhase.seconds, motion.speed);
      return;
    }
    if (motion.type === 'projected-spin') { projectedBlade(ctx, image, meta, layer, mechanicalTime); return; }
    if (motion.type === 'roller') { roller(ctx, image, meta, layer, mechanicalTime); return; }
    if (motion.type === 'hinge') { hingedLid(ctx, image, renderer.assets.get(layer.closedAsset), layer, closure); return; }
    let dx = 0, dy = 0, alpha = 1;
    if (layer.occludedByClosedLid) alpha *= 1 - smooth((closure - 0.2) / 0.4);
    if (flip && phaseId === 'feeding' && (layer.id === 'wafer-left' || layer.id === 'wafer-right')) {
      alpha *= smooth((poseProgress - (layer.id === 'wafer-right' ? 0.2 : 0)) / 0.65);
    }
    if (motion.type === 'flow') {
      if (!enabled) return;
      const duration = Math.max(0.08, motion.duration || currentPhase.seconds);
      const anchor = motion.startPhase || motion.phase || layer.when[0];
      const age = phaseStart(phaseId) + materialTime - phaseStart(anchor) - (motion.delay || 0);
      if (age < 0 && !motion.holdAtStart || !motion.repeat && age >= duration) return;
      const travel = motion.repeat ? (age % duration) / duration : clamp(age / duration);
      const destination = pointAlong(motion.path, travel);
      dx = destination[0] - layer.pivot[0]; dy = destination[1] - layer.pivot[1];
      alpha = !output && !motion.repeat && travel > 0.94 ? clamp((1 - travel) / 0.06) : 1;
      if (motion.repeat) {
        const drainProgress = phaseId === 'discharging' && motion.drainSeconds
          ? clamp((materialTime - (motion.drainDelay || 0)) / motion.drainSeconds) : 0;
        const fillProgress = motion.fillSeconds
          ? clamp((phaseStart(phaseId) + materialTime - phaseStart('feeding') - (motion.fillDelay || 0)) / motion.fillSeconds) : 1;
        flowingStream(ctx, image, layer, dx, dy, fillProgress, drainProgress, foodObstacles);
        return;
      }
    } else if (enabled && motion.type === 'vibrate') {
      const amplitude = motion.amplitude || [0, 0];
      dx = Math.sin(local * TAU * motion.speed) * amplitude[0];
      dy = Math.sin(local * TAU * motion.speed + 0.6) * amplitude[1];
    } else if (enabled && phaseId === motion.phase && motion.type === 'press') {
      const movement = closingStroke(local - (motion.delay || 0), motion.duration, motion.hold || 0);
      dx = motion.amplitude[0] * movement; dy = motion.amplitude[1] * movement;
    } else if (enabled && phaseId === motion.phase && motion.type === 'crosscut') {
      const age = local - (motion.delay || 0), cycle = 0.72;
      const movement = age >= 0 && age < cycle * 2 ? closingStroke(age % cycle, motion.duration, 0.09) : 0;
      dx = motion.amplitude[0] * movement; dy = motion.amplitude[1] * movement;
    } else if (enabled && phaseId === motion.phase && motion.type === 'nozzle') {
      const age = local - (motion.delay || 0), duration = motion.duration;
      const hold = motion.hold || 0;
      const movement = age < duration ? smooth(age / duration) : age < duration + hold ? 1 :
        1 - smooth((age - duration - hold) / duration);
      dx = motion.amplitude[0] * movement; dy = motion.amplitude[1] * movement;
    }
    ctx.save();
    if (motion.clipPolygon) { polygon(ctx, motion.clipPolygon); ctx.clip(); }
    if (layer.role === 'mechanical' && layer.cleanPatch === false) { polygon(ctx, layer.polygon); ctx.clip(); }
    ctx.translate(dx, dy);
    if (motion.type === 'linked-rod' && pressMotion) {
      const bearing = animation.layers.find(candidate => candidate.id === 'press-linkage-bearing');
      if (bearing) {
        const upper = layer.pivot, lower = bearing.pivot;
        const sourceX = lower[0] - upper[0], sourceY = lower[1] - upper[1];
        const targetX = sourceX + pressMotion.amplitude[0] * pressMovement;
        const targetY = sourceY + pressMotion.amplitude[1] * pressMovement;
        const sourceLength = Math.hypot(sourceX, sourceY);
        if (sourceLength > 0) {
          ctx.translate(upper[0], upper[1]); ctx.rotate(Math.atan2(targetY, targetX));
          ctx.scale(Math.hypot(targetX, targetY) / sourceLength, 1);
          ctx.rotate(-Math.atan2(sourceY, sourceX)); ctx.translate(-upper[0], -upper[1]);
        }
      }
    }
    polygon(ctx, layer.polygon); ctx.clip(); ctx.globalAlpha *= alpha;
    if (layer.id === 'sheet' || layer.id === 'cut-strips') {
      foodObstacles.forEach(obstacle => excludePolygon(ctx, image, obstacle.polygon));
    }
    ctx.drawImage(layer.role === 'foreground' || layer.role === 'mechanical' && !layer.cleanPatch ? clean : image, 0, 0);
    ctx.restore();
  });
  if (flipping && !assemblyDrawn) flipMold(ctx, meta, flip, flipFront, flipRear, flipAge / flip.duration);
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

module.exports = { productionVisual, machineOutputPort, machineOutputDirection, drawMachineTransfer, drawMachine, drawSupply, drawPacker };
