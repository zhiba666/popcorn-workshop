'use strict';

const TAU = Math.PI * 2;
const { PRODUCTION_CONFIG: CONFIG } = require('./production-config');
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const nativeRigs = new WeakMap();
const hiddenLayers = new Set(['station-base', 'station-cream', 'station-seal', 'cream-dose', 'product-1', 'product-2']);
const SUPPLY_ARRIVAL = 0.5, BASE_RELEASE = 0.56;
const SUPPLY_INLET = [440, 140];
const SUPPLY_APERTURE = [[385, 157], [441, 140], [487, 165], [432, 190]];

// Split the existing feeding phase; this visual handoff never owns materials.
function rotarySupplyVisual(progress, routeLength = 80) {
  const p = clamp(progress), arrival = smooth(p / SUPPLY_ARRIVAL);
  return {
    progress: arrival, visible: p < SUPPLY_ARRIVAL,
    alpha: smooth((1 - arrival) * Math.max(1, routeLength) / 8), materialId: 'factory/loose-popcorn',
    baseProgress: smooth((p - BASE_RELEASE) / (1 - BASE_RELEASE)), baseVisible: p >= BASE_RELEASE,
    receipt: smooth((p - SUPPLY_ARRIVAL) / 0.04) * (1 - smooth((p - BASE_RELEASE) / 0.08))
  };
}

function polygon(ctx, points) {
  ctx.beginPath();
  points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
}

function ellipse(ctx, x, y, rx, ry) {
  ctx.beginPath(); ctx.save(); ctx.translate(x, y); ctx.scale(rx, ry);
  ctx.arc(0, 0, 1, 0, TAU); ctx.restore();
}

function roundedSquare(radius) {
  const points = [];
  for (const [x, y, start] of [[1 - radius, -1 + radius, -Math.PI / 2], [1 - radius, 1 - radius, 0],
    [-1 + radius, 1 - radius, Math.PI / 2], [-1 + radius, -1 + radius, Math.PI]]) {
    for (let index = 0; index <= 5; index++) {
      const angle = start + index / 5 * Math.PI / 2;
      points.push([x + Math.cos(angle) * radius, y + Math.sin(angle) * radius]);
    }
  }
  return points;
}

const FOOD_SHAPE = roundedSquare(0.22), SLOT_SHAPE = roundedSquare(0.15);
const perspective = y => Math.max(0.94, Math.min(1.06, 0.94 + (y - 450) / 240 * 0.12));
function screenDetail(renderer, meta, width = 150, height = 150) {
  const source = meta.draw.sourceRect, k = Math.min(width / source[2], height / source[3]);
  const x = Math.max(0.01, (renderer.scale || 1) * k * meta.scale[0]);
  const y = Math.max(0.01, (renderer.scale || 1) * k * meta.scale[1]);
  return { small: Math.max(x, y) < 0.16, x, y };
}
const creamDepth = (scale, detail) => detail.small ? Math.max(9 * scale, 2 / detail.y) : 9 * scale;
const detailStroke = (size, pixels, detail) => detail.small ? Math.max(size, pixels / Math.min(detail.x, detail.y)) : size;
const BASE_APERTURE = [[300, 412], [680, 272], [760, 700], [300, 700]];
const CAP_APERTURE = [[0, 0], [990, 0], [1060, 565], [1020, 610], [0, 1199]];
const FEEDER_LIPS = [
  [[466, 329], [547, 314], [555, 337], [483, 360]],
  [[450, 347], [469, 341], [541, 433], [541, 451], [525, 454], [477, 394]],
  [[545, 322], [561, 320], [623, 404], [627, 430], [607, 439], [599, 406]],
  [[939, 507], [959, 489], [1001, 486], [1004, 473], [1021, 474], [1098, 491],
    [1128, 509], [1127, 552], [1105, 579], [1058, 579], [994, 560], [958, 548], [936, 530]]
];

function operationPose(time, dwell = 0.7) {
  const t = time < 0 ? -1 : time * 0.7 / dwell;
  return {
    creamProgress: smooth((t - 0.1) / 0.3),
    capProgress: smooth((t - 0.02) / 0.26),
    compression: smooth((t - 0.38) / 0.16),
    nozzleApproach: smooth(t / 0.1), nozzleReturn: smooth((t - 0.47) / 0.18),
    flow: smooth((t - 0.1) / 0.035) * (1 - smooth((t - 0.4) / 0.07)),
    pressApproach: smooth((t - 0.3) / 0.08), pressReturn: smooth((t - 0.54) / 0.14)
  };
}

function creamApex(lower, scale, progress, compression = 0) {
  const p = clamp(progress), size = Math.max(0.08, Math.sqrt(p));
  return lower[1] - (4 + 5 * compression + (25 * p + 6 * size) * (1 - compression)) * scale;
}

function nozzleTipY(carrier, pose) {
  const scale = perspective(carrier.position[1]);
  const lower = [carrier.position[0], carrier.position[1] - 5 * scale];
  const target = creamApex(lower, scale, pose.creamProgress) - 9 * scale;
  return 443 + (target - 443) * pose.nozzleApproach * (1 - pose.nozzleReturn);
}

function pressShoeY(pose, detail) {
  const scale = perspective(671);
  const rest = 671 - 84 * scale;
  const contact = 671 - (63 - 26 * pose.compression) * scale -
    (creamDepth(scale, detail) - 9 * scale) * pose.compression;
  return rest + (contact - rest) * pose.pressApproach * (1 - pose.pressReturn);
}

function planeMatrix(angle, halfWidth, halfHeight, scale) {
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  return [halfWidth * (cosine - sine) * scale, halfHeight * (cosine + sine) * scale,
    -halfWidth * (cosine + sine) * scale, halfHeight * (cosine - sine) * scale];
}

function project(shape, center, matrix) {
  const [a, b, c, d] = matrix;
  return shape.map(([u, v]) => [center[0] + a * u + c * v, center[1] + b * u + d * v]);
}

function curve(points, progress) {
  const [a, b, c] = points, t = clamp(progress), inverse = 1 - t;
  return [inverse * inverse * a[0] + 2 * inverse * t * b[0] + t * t * c[0],
    inverse * inverse * a[1] + 2 * inverse * t * b[1] + t * t * c[1]];
}

function alongPath(points, progress) {
  const lengths = points.slice(1).map((point, index) => Math.hypot(point[0] - points[index][0], point[1] - points[index][1]));
  let distance = clamp(progress) * lengths.reduce((sum, length) => sum + length, 0);
  for (let index = 0; index < lengths.length; index++) {
    if (distance <= lengths[index] || index === lengths.length - 1) {
      const t = lengths[index] ? clamp(distance / lengths[index]) : 0;
      return [points[index][0] + (points[index + 1][0] - points[index][0]) * t,
        points[index][1] + (points[index + 1][1] - points[index][1]) * t];
    }
    distance -= lengths[index];
  }
  return points[0];
}

function nativeRig(meta) {
  if (nativeRigs.has(meta)) return nativeRigs.get(meta);
  const [sx, sy] = meta.scale, [cx, cy] = meta.sourceCrop;
  const point = ([x, y]) => [x / sx + cx, y / sy + cy];
  const layers = meta.animation.layers.map(layer => ({ ...layer,
    polygon: layer.polygon.map(point),
    motion: { ...layer.motion,
      amplitude: layer.motion.amplitude ? [layer.motion.amplitude[0] / sx, layer.motion.amplitude[1] / sy] : [0, 0] }
  }));
  nativeRigs.set(meta, layers);
  return layers;
}

function rotaryView(line, phase) {
  if (!line) return { warm: true, passes: 1 };
  const afterProcessing = ['discharging', 'transport', 'waiting-cache'].includes(phase);
  const passes = line.factory.rotaryPasses || 1;
  return { warm: passes === 1 || afterProcessing, passes };
}

// Each real pass reserves a readable dwell before indexing. The model gives
// a cold table three passes; later batches index once and retain the two WIP
// pieces between batches. These drawings never own or credit stock.
function rotaryState(animation, phase, progress, view, duration) {
  const table = animation.indexedTable;
  const feeding = phase === 'feeding', processing = phase === 'processing', discharging = phase === 'discharging';
  const active = feeding || processing || discharging;
  const supplyVisual = feeding ? rotarySupplyVisual(progress) : null;
  const passes = view.passes;
  const processSeconds = duration > 0 ? duration / passes : animation.phases.find(entry => entry.id === 'processing').seconds;
  const completedPose = ['discharging', 'transport', 'waiting-cache'].includes(phase);
  const pass = processing ? Math.min(passes - 1, Math.floor(progress * passes)) : completedPose ? passes : 0;
  const operationTime = processing ? (progress * passes - pass) * processSeconds : -1;
  const dwell = Math.min(0.7, processSeconds * 0.7);
  const indexProgress = processing ? smooth((operationTime - dwell) / Math.max(0.01, processSeconds - dwell)) : 0;
  const pose = operationPose(operationTime, dwell);
  const { creamProgress, capProgress, compression } = pose;
  const carriers = [];
  let outgoing = null;
  for (let id = 0; id < 4; id++) {
    const station = (id + pass) % 4;
    // A square carrier has a canonical orientation at each workstation.
    // The pose is recoverable even if no frames were drawn for several batches.
    const angle = (station + indexProgress) * Math.PI / 2;
    const carrier = { station, position: curve(table.paths[station], indexProgress), angle,
      stage: 'empty', creamProgress: 0, capProgress: 0, compression: 0, feedProgress: 1, feedVisible: true };
    if (active && station === 0 && !discharging) {
      carrier.stage = 'base';
      carrier.feedProgress = feeding ? supplyVisual.baseProgress : pass === 0 ? 1 : smooth((operationTime - 0.02) / 0.42);
      carrier.feedVisible = feeding ? supplyVisual.baseVisible : pass === 0 || operationTime >= 0.02;
    } else if (processing && station === 1 && (passes === 1 || pass >= 1)) {
      carrier.stage = 'cream'; carrier.creamProgress = creamProgress;
    } else if (processing && station === 2 && (passes === 1 || pass >= 2)) {
      carrier.stage = 'sandwich'; carrier.creamProgress = 1; carrier.capProgress = capProgress;
      carrier.compression = compression;
    } else if (view.warm && !processing && station === 1) {
      carrier.stage = 'base';
    } else if (view.warm && !processing && station === 2) {
      carrier.stage = 'cream'; carrier.creamProgress = 1;
    } else if (discharging && station === 3) {
      outgoing = { progress, angle, stage: 'sandwich', creamProgress: 1, capProgress: 1, compression: 1 };
    }
    if (processing && station === 2 && carrier.capProgress === 1 && indexProgress > 0) {
      // The finished piece stays above the fixed discharge slide as it arrives,
      // rather than changing drawing depth at the phase boundary.
      outgoing = { ...carrier, preparing: true };
      carrier.foodAtOutput = true;
    }
    carriers.push(carrier);
  }
  return { carriers, outgoing, operationTime, processing, pose, supplyVisual };
}

function drawWafer(ctx, center, angle, scale, depth, texture, creamBand = false, opacity = 1, detail = { small: false }) {
  const small = detail.small;
  const matrix = planeMatrix(angle, 36.5, 17.5, scale), points = project(FOOD_SHAPE, center, matrix);
  const bottom = Math.max(...points.map(point => point[1]));
  ctx.save(); ctx.globalAlpha *= opacity;
  const side = ctx.createLinearGradient(center[0], bottom - 10 * scale, center[0], bottom + depth);
  if (creamBand) { side.addColorStop(0, '#fffdf0'); side.addColorStop(0.5, small ? '#fff9e7' : '#fff3cf'); side.addColorStop(1, small ? '#bc873d' : '#d3a95e'); }
  else { side.addColorStop(0, '#ffd864'); side.addColorStop(0.65, '#fbb731'); side.addColorStop(1, '#d98d18'); }
  ctx.fillStyle = side; ctx.strokeStyle = creamBand ? '#ae8143' : '#b97a19'; ctx.lineWidth = detailStroke(small ? 3.8 : 1.5, 0.5, detail);
  for (let index = 0; index < points.length; index++) {
    const current = points[index], next = points[(index + 1) % points.length];
    if (next[0] >= current[0]) continue;
    polygon(ctx, [current, next, [next[0], next[1] + depth], [current[0], current[1] + depth]]); ctx.fill();
  }
  polygon(ctx, points.map(([x, y]) => [x, y + depth])); ctx.stroke();
  polygon(ctx, points); ctx.fillStyle = creamBand ? '#fff8df' : '#ffe079'; ctx.fill();
  if (texture) {
    ctx.save(); ctx.clip(); ctx.transform(...matrix, center[0], center[1]);
    ctx.drawImage(texture, -1, -1, 2, 2); ctx.restore();
  }
  ctx.strokeStyle = creamBand ? (small ? '#a97532' : '#be9958') : '#dfa02c';
  ctx.lineWidth = detailStroke(small ? (creamBand ? 4.2 : 3.4) : (creamBand ? 1 : 2.1), creamBand ? 0.5 : 0.4, detail); ctx.stroke(); ctx.restore();
}

function drawCream(ctx, surface, scale, progress, compression = 0, small = false) {
  const p = clamp(progress), size = Math.max(0.08, Math.sqrt(p)) * scale;
  const x = surface[0], y = surface[1] - (4 + 5 * compression) * scale;
  ctx.save(); ctx.globalAlpha *= Math.min(1, progress * 7);
  for (const [rx, ry, lift] of [[39, 17, 0], [31, 14, 8], [22, 11, 17], [11, 6, 25]]) {
    const centerY = y - lift * p * scale * (1 - compression);
    const gradient = ctx.createRadialGradient(x - rx * size * 0.2, centerY - 6 * size, 1, x, centerY, rx * size);
    gradient.addColorStop(0, '#fffce7'); gradient.addColorStop(0.65, '#fff1bd'); gradient.addColorStop(1, '#e4bf70');
    ellipse(ctx, x, centerY, rx * size * (1 + compression * 0.1), ry * size * (1 - compression)); ctx.fillStyle = gradient; ctx.fill();
    ctx.strokeStyle = small ? '#caa869' : '#ead395'; ctx.lineWidth = small ? 2.8 : 1.1; ctx.stroke();
  }
  ctx.restore();
}

function drawFood(ctx, center, angle, scale, state, textures) {
  const lower = [center[0], center[1] - 5 * scale];
  const detail = textures.detail, band = creamDepth(scale, detail);
  ctx.save();
  polygon(ctx, project(FOOD_SHAPE, [center[0], center[1] + ((state.lift || 0) + 10) * scale],
    planeMatrix(angle, 39, 18, scale)));
  ctx.fillStyle = 'rgba(45, 23, 53, 0.20)'; ctx.fill(); ctx.restore();
  drawWafer(ctx, lower, angle, scale, 12 * scale, textures.top, false, 1, detail);
  const compression = state.compression ?? (state.capProgress === 1 ? 1 : 0);
  if (compression > 0) {
    drawWafer(ctx, [center[0], lower[1] - band * compression], angle,
      scale * (0.55 + 0.38 * compression), band * compression, null, true, 1, detail);
  }
  if (state.creamProgress > 0 && compression < 1) drawCream(ctx, lower, scale, state.creamProgress, compression, detail.small);
  if (state.capProgress > 0) {
    // Keep the cap and pressure shoe attached to the readable filling band.
    const landing = [center[0], center[1] - (53 - 26 * compression) * scale - (band - 9 * scale) * compression];
    const cap = state.capProgress < 1 ? curve([[1138, 520], [1020, 566], landing], state.capProgress) : landing;
    ctx.save();
    if (state.capProgress < 1) { polygon(ctx, CAP_APERTURE); ctx.clip(); }
    drawWafer(ctx, cap, angle, scale, 13 * scale, textures.cap, false, 1, detail); ctx.restore();
  }
}

function drawSlot(ctx, center, angle, scale) {
  const outer = project(SLOT_SHAPE, center, planeMatrix(angle, 52, 23, scale));
  const inner = project(SLOT_SHAPE, center, planeMatrix(angle, 48, 20, scale));
  const minY = Math.min(...outer.map(point => point[1])), maxY = Math.max(...outer.map(point => point[1]));
  ctx.save();
  const lip = ctx.createLinearGradient(center[0], minY, center[0], maxY);
  lip.addColorStop(0, '#6522a2'); lip.addColorStop(0.45, '#842ccc'); lip.addColorStop(1, '#bd64ef');
  polygon(ctx, outer); ctx.fillStyle = lip; ctx.fill(); ctx.lineWidth = 2.3; ctx.strokeStyle = '#341448'; ctx.stroke();
  polygon(ctx, inner); ctx.clip();
  const cavity = ctx.createLinearGradient(center[0], minY, center[0], maxY);
  cavity.addColorStop(0, '#130b1e'); cavity.addColorStop(0.35, '#302337'); cavity.addColorStop(1, '#67536b');
  ctx.fillStyle = cavity; ctx.fillRect(center[0] - 180, minY - 10, 360, maxY - minY + 20);
  polygon(ctx, inner.map(([x, y]) => [x, y + 12 * scale]));
  const floor = ctx.createLinearGradient(center[0], minY + 12, center[0], maxY);
  floor.addColorStop(0, '#3d3b43'); floor.addColorStop(0.5, '#626167'); floor.addColorStop(1, '#78777c');
  ctx.fillStyle = floor; ctx.fill(); ctx.lineWidth = 2.2; ctx.strokeStyle = '#9d56bf';
  for (let index = 0; index < inner.length; index++) {
    const current = inner[index], next = inner[(index + 1) % inner.length];
    if (next[0] >= current[0]) continue;
    ctx.beginPath(); ctx.moveTo(...current); ctx.lineTo(...next); ctx.stroke();
  }
  ctx.restore();
}

function drawCarriers(ctx, state, textures) {
  for (const carrier of [...state.carriers].sort((a, b) => a.position[1] - b.position[1])) {
    const scale = perspective(carrier.position[1]);
    drawSlot(ctx, carrier.position, carrier.angle, scale);
    if (carrier.stage === 'empty' || !carrier.feedVisible || carrier.foodAtOutput) continue;
    const feeding = carrier.station === 0 && carrier.feedProgress < 1;
    const position = feeding ? curve([[490, 309], [522, 414], carrier.position], carrier.feedProgress) : carrier.position;
    ctx.save();
    if (feeding) { polygon(ctx, BASE_APERTURE); ctx.clip(); }
    drawFood(ctx, position, carrier.angle, scale, carrier, textures); ctx.restore();
  }
}

function drawCreamStream(ctx, state, detail) {
  const carrier = state.carriers.find(item => item.station === 1 && item.stage !== 'empty');
  if (!state.processing || !carrier || state.pose.flow <= 0) return;
  const scale = perspective(carrier.position[1]), x = carrier.position[0];
  const lower = [x, carrier.position[1] - 5 * scale];
  const top = nozzleTipY(carrier, state.pose) - 1;
  const bottom = creamApex(lower, scale, carrier.creamProgress) + 3 * scale;
  // Keep the stream legible at 150 px without exceeding the nozzle mouth.
  const radius = (detail.small ? Math.min(9 * scale, Math.max(4.2 * scale, 0.85 / detail.x)) : 4.2 * scale) * state.pose.flow;
  const cream = ctx.createLinearGradient(x - radius, 0, x + radius, 0);
  cream.addColorStop(0, '#e4bf70'); cream.addColorStop(0.4, '#fffce7'); cream.addColorStop(1, '#fff1bd');
  ctx.save(); ctx.fillStyle = cream; ctx.strokeStyle = detail.small ? '#956b39' : '#ead395';
  ctx.lineWidth = detailStroke(1, 0.35, detail);
  ctx.beginPath(); ctx.moveTo(x - radius, top); ctx.lineTo(x + radius, top);
  ctx.quadraticCurveTo(x + radius * 0.65, (top + bottom) / 2, x + radius * 0.85, bottom);
  ctx.quadraticCurveTo(x, bottom + radius, x - radius * 0.85, bottom);
  ctx.quadraticCurveTo(x - radius * 0.65, (top + bottom) / 2, x - radius, top);
  ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
}

function drawOutput(ctx, state, outputPath, textures) {
  const outgoing = state.outgoing;
  if (!outgoing) return;
  const p = outgoing.progress || 0;
  const travel = p * p * (2 - p);
  const lift = !outgoing.preparing && !textures.reducedMotion && p < 0.24 ?
    8 * Math.sin(Math.PI * p / 0.24) ** 2 : 0;
  const ground = outgoing.preparing ? outgoing.position : alongPath(outputPath, travel);
  const scale = outgoing.preparing ? perspective(ground[1]) : perspective(outputPath[0][1]);
  const position = [ground[0], ground[1] - lift * scale];
  ctx.save();
  drawFood(ctx, position, outgoing.angle, scale, { ...outgoing, lift }, textures); ctx.restore();
}

function rotaryOutputPath(meta) {
  return meta.animation.indexedTable.outputPath;
}

function rotaryNativePort(renderer, machine, native) {
  const meta = renderer.assets.meta('factory/rotary-sandwich-assembler');
  const source = meta.draw.sourceRect, k = Math.min(machine.w / source[2], machine.h / source[3]);
  const point = [(native[0] - meta.sourceCrop[0]) * meta.scale[0],
    (native[1] - meta.sourceCrop[1]) * meta.scale[1]];
  return [machine.x + (machine.w - source[2] * k) / 2 + (point[0] - source[0]) * k,
    machine.y + machine.h - source[3] * k + (point[1] - source[1]) * k];
}

function rotaryInputPort(renderer, machine) {
  return rotaryNativePort(renderer, machine, SUPPLY_INLET);
}

function rotaryOutputPort(renderer, machine) {
  const path = rotaryOutputPath(renderer.assets.meta('factory/rotary-sandwich-assembler'));
  return rotaryNativePort(renderer, machine, path[path.length - 1]);
}

function drawRotaryTransfer(renderer, machine, path, progress, line) {
  const meta = renderer.assets.meta('factory/rotary-sandwich-assembler');
  if (!meta?.animation?.indexedTable || !path?.length) return;
  const source = meta.draw.sourceRect, k = Math.min(machine.w / source[2], machine.h / source[3]);
  const internal = rotaryOutputPath(meta);
  const length = points => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]), 0);
  const speed = length(internal.map(p => [p[0] * meta.scale[0] * k, p[1] * meta.scale[1] * k])) /
    CONFIG.phaseDurations.discharging;
  const startTangent = Math.min(1, speed * line.factory.duration / Math.max(1, length(path)));
  const p = clamp(progress), travel = (-2 * p ** 3 + 3 * p * p) + startTangent * (p ** 3 - 2 * p * p + p);
  const position = alongPath(path, travel), table = meta.animation.indexedTable;
  const textures = { top: renderer.assets.get(table.topTextureAsset), cap: renderer.assets.get(table.capTextureAsset),
    detail: screenDetail(renderer, meta, machine.w, machine.h) };
  const ctx = renderer.ctx;
  ctx.save(); ctx.translate(...position); ctx.scale(k * meta.scale[0], k * meta.scale[1]);
  drawFood(ctx, [0, 0], Math.PI * 1.5, perspective(internal[0][1]),
    { creamProgress: 1, capProgress: 1, compression: 1 }, textures); ctx.restore();
}

function drawActuator(ctx, layer, state, assets, table, detail) {
  const isNozzle = layer.id === 'cream-nozzle', station = isNozzle ? 1 : 2;
  const carrier = state.carriers.find(item => item.station === station && item.stage !== 'empty');
  const pose = state.processing && carrier ? state.pose : operationPose(-1);
  const movement = isNozzle && carrier ? nozzleTipY(carrier, pose) - 465 : -22;
  const tip = assets.get(isNozzle ? table.nozzleTipAsset : table.pressTipAsset);
  if (!tip) return;
  ctx.save();
  if (isNozzle) {
    if (movement > 0) {
      const metal = ctx.createLinearGradient(842, 0, 859, 0);
      metal.addColorStop(0, '#777b7d'); metal.addColorStop(0.35, '#e8eceb'); metal.addColorStop(0.75, '#bfc5c4'); metal.addColorStop(1, '#696c70');
      ctx.fillStyle = metal; ctx.strokeStyle = '#29292d'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(845, 437); ctx.lineTo(856, 437); ctx.quadraticCurveTo(859, 437, 859, 440);
      ctx.lineTo(859, 447 + movement); ctx.quadraticCurveTo(859, 450 + movement, 856, 450 + movement);
      ctx.lineTo(845, 450 + movement); ctx.quadraticCurveTo(842, 450 + movement, 842, 447 + movement);
      ctx.lineTo(842, 440); ctx.quadraticCurveTo(842, 437, 845, 437); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    const rect = table.nozzleTipRect;
    ctx.drawImage(tip, rect[0], rect[1] + movement, rect[2], rect[3]);
  } else {
    const shoeY = pressShoeY(pose, detail);
    const shoeX = 897;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(950, 554); ctx.lineTo(shoeX, 575); ctx.lineTo(shoeX, shoeY - 8);
    ctx.strokeStyle = '#24242a'; ctx.lineWidth = 19; ctx.stroke();
    const chrome = ctx.createLinearGradient(shoeX - 7, 550, shoeX + 8, 660);
    chrome.addColorStop(0, '#e0e5e4'); chrome.addColorStop(0.45, '#a9aeaf'); chrome.addColorStop(0.7, '#f0f1eb'); chrome.addColorStop(1, '#767b7d');
    ctx.strokeStyle = chrome; ctx.lineWidth = 13; ctx.stroke();
    ellipse(ctx, shoeX, shoeY, 29, 12);
    const plate = ctx.createLinearGradient(0, shoeY - 12, 0, shoeY + 12);
    plate.addColorStop(0, '#e4e8e6'); plate.addColorStop(0.5, '#b8bcbb'); plate.addColorStop(1, '#6b6f71');
    ctx.fillStyle = plate; ctx.strokeStyle = '#333237'; ctx.lineWidth = detailStroke(2.4, 0.6, detail); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

function drawRotaryMachine(renderer, source, meta, phase, progress, line, options = {}) {
  const ctx = renderer.ctx, animation = meta.animation, table = animation.indexedTable;
  const clean = renderer.assets.get(table.blankAsset) || source;
  const textures = { top: renderer.assets.get(table.topTextureAsset), cap: renderer.assets.get(table.capTextureAsset),
    detail: screenDetail(renderer, meta, options.machineWidth, options.machineHeight), reducedMotion: options.reducedMotion === true };
  const layers = nativeRig(meta), state = rotaryState(animation, phase, progress, rotaryView(line, phase), line?.factory.duration);
  const active = animation.phases.some(entry => entry.id === phase);
  const local = active ? animation.phases.find(entry => entry.id === phase).seconds * progress : 0;
  const [sx, sy] = meta.scale, [cx, cy] = meta.sourceCrop;
  // End at the same port that starts the scene's transport path.
  const outputPath = rotaryOutputPath(meta);
  const drawSource = image => ctx.drawImage(image, cx, cy, image.width / sx, image.height / sy);
  const drawWork = () => {
    drawCarriers(ctx, state, textures);
    for (const lip of FEEDER_LIPS) { ctx.save(); polygon(ctx, lip); ctx.clip(); drawSource(clean); ctx.restore(); }
    drawCreamStream(ctx, state, textures.detail);
  };
  ctx.save(); ctx.scale(sx, sy); ctx.translate(-cx, -cy); drawSource(clean);
  let carriersDrawn = false, outputDrawn = false;
  for (const layer of layers) {
    if (!carriersDrawn && layer.order >= table.order) { drawWork(); carriersDrawn = true; }
    if (!outputDrawn && layer.order >= 90) { drawOutput(ctx, state, outputPath, textures); outputDrawn = true; }
    if (layer.eraseOnly || hiddenLayers.has(layer.id)) continue;
    if (layer.id === 'cream-nozzle' || layer.id === 'sealing-arm') {
      drawActuator(ctx, layer, state, renderer.assets, table, textures.detail);
      if (layer.id === 'cream-nozzle') {
        ctx.save(); polygon(ctx, [[826, 411], [872, 411], [872, 438], [826, 438]]);
        ctx.clip(); drawSource(clean); ctx.restore();
      }
      continue;
    }
    const motion = layer.motion, enabled = active && layer.when.includes(phase) && (!motion.phase || motion.phase === phase);
    if (layer.role === 'material' && !(/magazine|reservoir/.test(layer.id) || enabled)) continue;
    let dx = 0, dy = 0;
    const calm = options.reducedMotion ? 0 : textures.detail.small ? 0.35 : 1;
    if (layer.id === 'left-magazine-fill' && state.supplyVisual) {
      // Refill feedback starts only after the external material has entered.
      dy = motion.amplitude[1] * state.supplyVisual.receipt * calm;
    } else if (enabled && motion.type === 'translate') {
      const distance = Math.sin(clamp((local - (motion.delay || 0)) / (motion.duration || animation.phases.find(entry => entry.id === phase).seconds)) * Math.PI);
      dx = motion.amplitude[0] * distance * calm; dy = motion.amplitude[1] * distance * calm;
    } else if (enabled && motion.type === 'vibrate') {
      dx = Math.sin(local * TAU * motion.speed) * motion.amplitude[0] * calm;
      dy = Math.sin(local * TAU * motion.speed + 0.6) * motion.amplitude[1] * calm;
    }
    ctx.save(); ctx.translate(dx, dy); polygon(ctx, layer.polygon); ctx.clip();
    drawSource(layer.role === 'foreground' ? clean : source); ctx.restore();
    if (layer.id === 'left-magazine-fill' && state.supplyVisual?.receipt > 0) {
      ctx.save(); polygon(ctx, SUPPLY_APERTURE); ctx.clip();
      ctx.globalAlpha *= 0.3 * state.supplyVisual.receipt;
      ctx.fillStyle = '#fff5c6'; ctx.fillRect(380, 135, 112, 60); ctx.restore();
    }
  }
  if (!carriersDrawn) drawWork();
  if (!outputDrawn) drawOutput(ctx, state, outputPath, textures);
  ctx.restore();
}

module.exports = { drawRotaryMachine, drawRotaryTransfer, rotaryOutputPort, rotaryInputPort, rotarySupplyVisual };
