'use strict';

const TAU = Math.PI * 2;
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const nativeRigs = new WeakMap();
const lineViews = new WeakMap();
const hiddenLayers = new Set(['station-base', 'station-cream', 'station-seal', 'cream-dose', 'product-1', 'product-2']);

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

function stroke(time, down, hold, up) {
  if (time <= 0) return 0;
  if (time < down) return smooth(time / down);
  if (time < down + hold) return 1;
  return 1 - smooth((time - down - hold) / up);
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
  if (!line) return { warm: true, passes: 1, angle: 0 };
  let view = lineViews.get(line);
  const batchId = line.factory.batchId;
  const afterProcessing = ['discharging', 'transport', 'waiting-cache'].includes(phase);
  const passes = line.factory.rotaryPasses || 1;
  if (!view) {
    view = { warm: passes === 1, passes, angle: 0, batchId };
    lineViews.set(line, view);
  } else if (batchId !== view.batchId) {
    if (view.batchId !== null) {
      view.angle = (view.angle + view.passes * Math.PI / 2) % TAU;
      view.warm = true;
    }
    view.passes = passes; view.batchId = batchId;
  }
  if (afterProcessing) view.warm = true;
  return view;
}

// Each real pass reserves a readable dwell before indexing. The model gives
// a cold table three passes; later batches index once and retain the two WIP
// pieces between batches. These drawings never own or credit stock.
function rotaryState(animation, phase, progress, view, duration) {
  const table = animation.indexedTable;
  const feeding = phase === 'feeding', processing = phase === 'processing', discharging = phase === 'discharging';
  const active = feeding || processing || discharging;
  const feedingSeconds = animation.phases.find(entry => entry.id === 'feeding').seconds;
  const passes = view.passes;
  const processSeconds = duration > 0 ? duration / passes : animation.phases.find(entry => entry.id === 'processing').seconds;
  const completedPose = ['discharging', 'transport', 'waiting-cache'].includes(phase);
  const pass = processing ? Math.min(passes - 1, Math.floor(progress * passes)) : completedPose ? passes : 0;
  const operationTime = processing ? (progress * passes - pass) * processSeconds : -1;
  const dwell = Math.min(0.7, processSeconds * 0.7);
  const indexProgress = processing ? smooth((operationTime - dwell) / Math.max(0.01, processSeconds - dwell)) : 0;
  const angle = view.angle + (pass + indexProgress) * Math.PI / 2;
  const creamProgress = smooth((operationTime - 0.08) / 0.38), capProgress = smooth((operationTime - 0.12) / 0.38);
  const carriers = [];
  let outgoing = null;
  for (let id = 0; id < 4; id++) {
    const station = (id + pass) % 4;
    const carrier = { station, position: curve(table.paths[station], indexProgress), angle,
      stage: 'empty', creamProgress: 0, capProgress: 0, feedProgress: 1, feedVisible: true };
    if (active && station === 0 && !discharging) {
      carrier.stage = 'base';
      const enteringTime = feeding ? progress * feedingSeconds : operationTime;
      carrier.feedProgress = processing && pass === 0 ? 1 : smooth((enteringTime - 0.04) / (feeding ? 0.58 : 0.48));
      carrier.feedVisible = processing && pass === 0 || enteringTime >= 0.04;
    } else if (processing && station === 1 && (passes === 1 || pass >= 1)) {
      carrier.stage = 'cream'; carrier.creamProgress = creamProgress;
    } else if (processing && station === 2 && (passes === 1 || pass >= 2)) {
      carrier.stage = 'sandwich'; carrier.creamProgress = 1; carrier.capProgress = capProgress;
    } else if (view.warm && !processing && station === 1) {
      carrier.stage = 'base';
    } else if (view.warm && !processing && station === 2) {
      carrier.stage = 'cream'; carrier.creamProgress = 1;
    } else if (discharging && station === 3) {
      outgoing = { progress, angle, stage: 'sandwich', creamProgress: 1, capProgress: 1 };
    }
    carriers.push(carrier);
  }
  return { carriers, outgoing, operationTime, processing };
}

function drawWafer(ctx, center, angle, scale, depth, texture, creamBand = false, opacity = 1) {
  const matrix = planeMatrix(angle, 36.5, 17.5, scale), points = project(FOOD_SHAPE, center, matrix);
  const bottom = Math.max(...points.map(point => point[1]));
  ctx.save(); ctx.globalAlpha *= opacity;
  const side = ctx.createLinearGradient(center[0], bottom - 10 * scale, center[0], bottom + depth);
  if (creamBand) { side.addColorStop(0, '#fff7d0'); side.addColorStop(0.5, '#ffe6a0'); side.addColorStop(1, '#e9be64'); }
  else { side.addColorStop(0, '#ffd864'); side.addColorStop(0.65, '#fbb731'); side.addColorStop(1, '#d98d18'); }
  ctx.fillStyle = side; ctx.strokeStyle = creamBand ? '#d1a85b' : '#b97a19'; ctx.lineWidth = 1.5;
  for (let index = 0; index < points.length; index++) {
    const current = points[index], next = points[(index + 1) % points.length];
    if (next[0] >= current[0]) continue;
    polygon(ctx, [current, next, [next[0], next[1] + depth], [current[0], current[1] + depth]]); ctx.fill();
  }
  polygon(ctx, points.map(([x, y]) => [x, y + depth])); ctx.stroke();
  polygon(ctx, points); ctx.fillStyle = creamBand ? '#fff4c3' : '#ffe079'; ctx.fill();
  if (texture) {
    ctx.save(); ctx.clip(); ctx.transform(...matrix, center[0], center[1]);
    ctx.drawImage(texture, -1, -1, 2, 2); ctx.restore();
  }
  ctx.strokeStyle = creamBand ? '#f4d895' : '#f0b434'; ctx.lineWidth = creamBand ? 1 : 2.1; ctx.stroke(); ctx.restore();
}

function drawCream(ctx, surface, scale, progress) {
  const p = smooth(progress), size = Math.max(0.08, Math.sqrt(p)) * scale;
  const x = surface[0], y = surface[1] - 4 * scale;
  ctx.save(); ctx.globalAlpha *= Math.min(1, progress * 7);
  for (const [rx, ry, lift] of [[39, 17, 0], [31, 14, 8], [22, 11, 17], [11, 6, 25]]) {
    const centerY = y - lift * p * scale;
    const gradient = ctx.createRadialGradient(x - rx * size * 0.2, centerY - 6 * size, 1, x, centerY, rx * size);
    gradient.addColorStop(0, '#fffce7'); gradient.addColorStop(0.65, '#fff1bd'); gradient.addColorStop(1, '#e4bf70');
    ellipse(ctx, x, centerY, rx * size, ry * size); ctx.fillStyle = gradient; ctx.fill();
    ctx.strokeStyle = '#ead395'; ctx.lineWidth = 1.1; ctx.stroke();
  }
  ctx.restore();
}

function drawFood(ctx, center, angle, scale, state, textures) {
  const lower = [center[0], center[1] - 5 * scale];
  drawWafer(ctx, lower, angle, scale, 12 * scale, textures.top);
  if (state.creamProgress > 0 && state.capProgress < 1) drawCream(ctx, lower, scale, state.creamProgress);
  if (state.capProgress > 0) {
    const p = state.capProgress, entering = 1 - p;
    drawWafer(ctx, [center[0], center[1] - 14 * scale], angle, scale * 0.93, 9 * scale, null, true, p);
    drawWafer(ctx, [center[0] + 132 * entering, center[1] - 27 * scale - 76 * entering], angle, scale, 13 * scale, textures.cap);
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
    if (carrier.stage === 'empty' || !carrier.feedVisible) continue;
    const entering = 1 - carrier.feedProgress;
    drawFood(ctx, [carrier.position[0] - 43 * entering, carrier.position[1] - 78 * entering], carrier.angle, scale, carrier, textures);
  }
}

function drawOutput(ctx, state, outputPath, textures) {
  const outgoing = state.outgoing;
  if (!outgoing) return;
  const position = alongPath(outputPath, outgoing.progress);
  const scale = perspective(outputPath[0][1]) * (1 + 0.08 * outgoing.progress);
  ctx.save();
  drawFood(ctx, position, outgoing.angle, scale, outgoing, textures); ctx.restore();
}

function drawActuator(ctx, layer, state, assets, table) {
  const isNozzle = layer.id === 'cream-nozzle', station = isNozzle ? 1 : 2;
  const material = state.carriers.some(carrier => carrier.station === station && carrier.stage !== 'empty');
  const movement = !state.processing || !material ? 0 : isNozzle ?
    stroke(state.operationTime, 0.12, 0.29, 0.19) * 10 : stroke(state.operationTime - 0.12, 0.14, 0.18, 0.18) * 20;
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
    const shoeY = 622 + movement;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(950, 554); ctx.lineTo(905, 600); ctx.lineTo(905, shoeY - 8);
    ctx.strokeStyle = '#24242a'; ctx.lineWidth = 19; ctx.stroke();
    const chrome = ctx.createLinearGradient(898, 550, 913, 660);
    chrome.addColorStop(0, '#e0e5e4'); chrome.addColorStop(0.45, '#a9aeaf'); chrome.addColorStop(0.7, '#f0f1eb'); chrome.addColorStop(1, '#767b7d');
    ctx.strokeStyle = chrome; ctx.lineWidth = 13; ctx.stroke();
    ctx.drawImage(tip, 891, shoeY - 36, 28, 42);
    ellipse(ctx, 905, shoeY, 29, 12);
    const plate = ctx.createLinearGradient(0, shoeY - 12, 0, shoeY + 12);
    plate.addColorStop(0, '#e4e8e6'); plate.addColorStop(0.5, '#b8bcbb'); plate.addColorStop(1, '#6b6f71');
    ctx.fillStyle = plate; ctx.strokeStyle = '#333237'; ctx.lineWidth = 2.4; ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

function drawRotaryMachine(renderer, source, meta, phase, progress, line) {
  const ctx = renderer.ctx, animation = meta.animation, table = animation.indexedTable;
  const clean = renderer.assets.get(table.blankAsset) || source;
  const textures = { top: renderer.assets.get(table.topTextureAsset), cap: renderer.assets.get(table.capTextureAsset) };
  const layers = nativeRig(meta), state = rotaryState(animation, phase, progress, rotaryView(line, phase), line?.factory.duration);
  const active = animation.phases.some(entry => entry.id === phase);
  const local = active ? animation.phases.find(entry => entry.id === phase).seconds * progress : 0;
  const [sx, sy] = meta.scale, [cx, cy] = meta.sourceCrop;
  // End at the same port that starts the scene's transport path.
  const outputPort = [meta.ports.output[0] / sx + cx, meta.ports.output[1] / sy + cy];
  const outputPath = [...table.outputPath.slice(0, -2), outputPort];
  const drawSource = image => ctx.drawImage(image, cx, cy, image.width / sx, image.height / sy);
  ctx.save(); ctx.scale(sx, sy); ctx.translate(-cx, -cy); drawSource(clean);
  let carriersDrawn = false, outputDrawn = false;
  for (const layer of layers) {
    if (!carriersDrawn && layer.order >= table.order) { drawCarriers(ctx, state, textures); carriersDrawn = true; }
    if (!outputDrawn && layer.order >= 90) { drawOutput(ctx, state, outputPath, textures); outputDrawn = true; }
    if (layer.eraseOnly || hiddenLayers.has(layer.id)) continue;
    if (layer.id === 'cream-nozzle' || layer.id === 'sealing-arm') { drawActuator(ctx, layer, state, renderer.assets, table); continue; }
    const motion = layer.motion, enabled = active && layer.when.includes(phase) && (!motion.phase || motion.phase === phase);
    if (layer.role === 'material' && !(/magazine|reservoir/.test(layer.id) || enabled)) continue;
    let dx = 0, dy = 0;
    if (enabled && motion.type === 'translate') {
      const distance = Math.sin(clamp((local - (motion.delay || 0)) / (motion.duration || animation.phases.find(entry => entry.id === phase).seconds)) * Math.PI);
      dx = motion.amplitude[0] * distance; dy = motion.amplitude[1] * distance;
    } else if (enabled && motion.type === 'vibrate') {
      dx = Math.sin(local * TAU * motion.speed) * motion.amplitude[0];
      dy = Math.sin(local * TAU * motion.speed + 0.6) * motion.amplitude[1];
    }
    ctx.save(); ctx.translate(dx, dy); polygon(ctx, layer.polygon); ctx.clip();
    drawSource(layer.role === 'foreground' ? clean : source); ctx.restore();
  }
  if (!carriersDrawn) drawCarriers(ctx, state, textures);
  if (!outputDrawn) drawOutput(ctx, state, outputPath, textures);
  ctx.restore();
}

module.exports = { drawRotaryMachine };
