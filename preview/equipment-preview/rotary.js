const TAU = Math.PI * 2;
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const modulo = (value, divisor) => ((value % divisor) + divisor) % divisor;

function curve(points, progress) {
  const [a, b, c] = points, t = clamp(progress), inverse = 1 - t;
  return [inverse * inverse * a[0] + 2 * inverse * t * b[0] + t * t * c[0], inverse * inverse * a[1] + 2 * inverse * t * b[1] + t * t * c[1]];
}

function distancePoint(points, progress) {
  const lengths = points.slice(1).map((value, index) => Math.hypot(value[0] - points[index][0], value[1] - points[index][1]));
  let distance = clamp(progress) * lengths.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < lengths.length; index++) {
    if (distance <= lengths[index] || index === lengths.length - 1) {
      const t = lengths[index] ? clamp(distance / lengths[index]) : 0;
      return [points[index][0] + (points[index + 1][0] - points[index][0]) * t, points[index][1] + (points[index + 1][1] - points[index][1]) * t];
    }
    distance -= lengths[index];
  }
  return points[0];
}

function roundedSquare(radius = .18, steps = 5) {
  const points = [];
  for (const [x, y, start] of [[1 - radius, -1 + radius, -Math.PI / 2], [1 - radius, 1 - radius, 0], [-1 + radius, 1 - radius, Math.PI / 2], [-1 + radius, -1 + radius, Math.PI]]) {
    for (let index = 0; index <= steps; index++) {
      const angle = start + index / steps * Math.PI / 2;
      points.push([x + Math.cos(angle) * radius, y + Math.sin(angle) * radius]);
    }
  }
  return points;
}

const FOOD_SHAPE = roundedSquare(.22);
const SLOT_SHAPE = roundedSquare(.15);
const perspective = y => Math.max(.94, Math.min(1.06, .94 + (y - 450) / 240 * .12));
function screenDetail(ctx) {
  const matrix = ctx.getTransform?.(), dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  const x = matrix ? Math.hypot(matrix.a, matrix.b) / dpr : 1;
  const y = matrix ? Math.hypot(matrix.c, matrix.d) / dpr : 1;
  return { small: Math.max(x, y) < .16, x: Math.max(.01, x), y: Math.max(.01, y) };
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
    [1128, 509], [1127, 552], [1105, 579], [1058, 579], [994, 560], [958, 548], [936, 530]],
];

function operationPose(time, dwell = .7) {
  const t = time < 0 ? -1 : time * .7 / dwell;
  return {
    creamProgress: smooth((t - .1) / .3), capProgress: smooth((t - .02) / .26),
    compression: smooth((t - .38) / .16),
    nozzleApproach: smooth(t / .1), nozzleReturn: smooth((t - .47) / .18),
    flow: smooth((t - .1) / .035) * (1 - smooth((t - .4) / .07)),
    pressApproach: smooth((t - .3) / .08), pressReturn: smooth((t - .54) / .14),
  };
}

function creamApex(lower, scale, progress, compression = 0) {
  const p = clamp(progress), size = Math.max(.08, Math.sqrt(p));
  return lower[1] - (4 + 5 * compression + (25 * p + 6 * size) * (1 - compression)) * scale;
}

function nozzleTipY(carrier, pose) {
  const scale = perspective(carrier.position[1]);
  const lower = [carrier.position[0], carrier.position[1] - 5 * scale];
  const target = creamApex(lower, scale, pose.creamProgress) - 9 * scale;
  return 443 + (target - 443) * pose.nozzleApproach * (1 - pose.nozzleReturn);
}

function pressShoeY(pose, detail = { small: false }) {
  const scale = perspective(671), rest = 671 - 84 * scale;
  const contact = 671 - (63 - 26 * pose.compression) * scale -
    (creamDepth(scale, detail) - 9 * scale) * pose.compression;
  return rest + (contact - rest) * pose.pressApproach * (1 - pose.pressReturn);
}

function path(ctx, points) {
  ctx.beginPath();
  points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
}

// Rotation affects the horizontal plane only. Every side wall is extruded in
// screen Y, keeping its thickness and lighting upright throughout a quarter turn.
function planeMatrix(angle, halfWidth, halfHeight, scale = 1) {
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  return [halfWidth * (cosine - sine) * scale, halfHeight * (cosine + sine) * scale, -halfWidth * (cosine + sine) * scale, halfHeight * (cosine - sine) * scale];
}

function project(shape, center, matrix) {
  const [a, b, c, d] = matrix;
  return shape.map(([u, v]) => [center[0] + a * u + c * v, center[1] + b * u + d * v]);
}

function textureFromTop(image, center, halfWidth, halfHeight, width, height) {
  const canvas = document.createElement('canvas'), size = 192;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const inverse = size / 4;
  ctx.setTransform(inverse / halfWidth, -inverse / halfWidth, inverse / halfHeight, inverse / halfHeight,
    size / 2 - inverse * (center[0] / halfWidth + center[1] / halfHeight),
    size / 2 + inverse * (center[0] / halfWidth - center[1] / halfHeight));
  ctx.drawImage(image, 0, 0, image.naturalWidth || image.width, image.naturalHeight || image.height, 0, 0, width, height);
  return canvas;
}

function cropPiece(image, polygon, width, height, sampleOffset = 0) {
  const xs = polygon.map(point => point[0]), ys = polygon.map(point => point[1]);
  const box = { x: Math.floor(Math.min(...xs)), y: Math.floor(Math.min(...ys)), width: Math.ceil(Math.max(...xs)) - Math.floor(Math.min(...xs)), height: Math.ceil(Math.max(...ys)) - Math.floor(Math.min(...ys)) };
  const canvas = document.createElement('canvas'); canvas.width = box.width; canvas.height = box.height;
  const ctx = canvas.getContext('2d');
  path(ctx, polygon.map(([x, y]) => [x - box.x, y - box.y])); ctx.clip();
  ctx.drawImage(image, 0, 0, image.naturalWidth || image.width, image.naturalHeight || image.height, -box.x - sampleOffset, -box.y, width, height);
  return { piece: canvas, box };
}

export class RotaryAssembler {
  constructor(rig) {
    this.rig = rig;
    this.table = rig.indexedTable;
    this.topTexture = null;
    this.capTexture = null;
    this.hiddenLayerIds = new Set(['station-base', 'station-cream', 'station-seal', 'cream-dose', 'product-1', 'product-2']);
    this.outputPath = rig.layers.find(layer => layer.id === 'product-1')?.motion.path || [[468, 680], [382, 806], [230, 947], [152, 1014]];
  }

  async load(sourceImage, cleanImage, blankImage) {
    // Only the original horizontal food faces become textures. The vertical
    // wafer and cream bands are drawn separately rather than rotated bitmaps.
    this.topTexture = textureFromTop(sourceImage, [560, 480], 36.5, 17.5, this.rig.width, this.rig.height);
    this.capTexture = textureFromTop(sourceImage, [898, 652], 38.5, 20.5, this.rig.width, this.rig.height);
    const width = this.rig.width, height = this.rig.height;
    const nozzle = [[840, 438], [860, 438], [861, 451], [857, 461], [851, 465], [845, 462], [840, 453]];
    const nozzleClear = [[837, 437], [864, 437], [865, 453], [860, 466], [850, 469], [839, 463], [837, 451]];
    const press = [[1004, 583], [1034, 583], [1033, 613], [1028, 631], [1019, 636], [1009, 632], [1003, 618]];
    const pressClear = [[1000, 580], [1037, 580], [1038, 615], [1032, 635], [1019, 639], [1005, 634], [998, 620]];
    this.nozzleTip = cropPiece(sourceImage, nozzle, width, height);
    this.pressTip = cropPiece(sourceImage, press, width, height);
    // The blank art still contains the fixed actuator housings. Tiny adjacent
    // table patches remove just the old silver tips before the moving tips are
    // drawn, without duplicating or translating either gold/purple housing.
    const background = blankImage || cleanImage || sourceImage;
    this.nozzleClear = cropPiece(background, nozzleClear, width, height, -32);
    this.pressClear = cropPiece(background, pressClear, width, height, -56);
    this.feederLips = FEEDER_LIPS.map(polygon => cropPiece(background, polygon, width, height));
    this.nozzleSleeve = cropPiece(background, [[826, 411], [872, 411], [872, 438], [826, 438]], width, height);
    return this;
  }

  getState(machine) {
    const phase = machine.phase;
    const form = machine.form || 'cycle';
    const cycle = Math.max(0, Math.floor(machine.cycleIndex || 0));
    const loops = Math.max(0, Math.floor(machine.loopIndex || 0));
    const rotationEnabled = ['cycle', 'processing', 'index'].includes(form);
    const indexProgress = rotationEnabled ? phase.id === 'discharging' ? 1 : phase.id === 'processing' ? smooth((phase.elapsed - this.table.delay) / this.table.duration) : 0 : 0;
    const operationTime = phase.id === 'processing' ? phase.elapsed : phase.id === 'discharging' ? Infinity : -1;
    const pose = operationPose(operationTime, this.table.delay);
    const { creamProgress, capProgress, compression } = pose;
    const carriers = [];
    let outgoing = null, preparing = null;
    const staticEmpty = form === 'empty' || form === 'open' || !machine.ready || machine.error;

    for (let id = 0; id < 4; id++) {
      const station = modulo(id + cycle, 4);
      const position = curve(this.table.paths[station], indexProgress);
      // Station-local orientation is independent of how many frames were drawn.
      const angle = (station + indexProgress) * Math.PI / 2;
      const carrier = { id, station, destination: modulo(station + 1, 4), position, angle, stage: 'empty', productId: null, creamProgress: 0, capProgress: 0, compression: 0, feedProgress: 1 };
      if (staticEmpty) { carriers.push(carrier); continue; }

      if (form === 'index') {
        carrier.stage = ['base', 'cream', 'sandwich', 'empty'][id];
        carrier.productId = carrier.stage === 'empty' ? null : `index-${id}`;
        carrier.creamProgress = carrier.stage === 'cream' || carrier.stage === 'sandwich' ? 1 : 0;
        carrier.capProgress = carrier.stage === 'sandwich' ? 1 : 0;
        carrier.compression = carrier.stage === 'sandwich' ? 1 : 0;
      } else if (form === 'feeding') {
        carrier.stage = station === 0 ? 'base' : 'empty';
        carrier.productId = station === 0 ? 'feed-0' : null;
        carrier.feedProgress = loops ? 1 : smooth((phase.elapsed - .02) / .58);
        carrier.feedVisible = loops > 0 || phase.elapsed >= .02;
      } else if (form === 'discharging') {
        carrier.stage = ['empty', 'base', 'cream', 'sandwich'][station];
        carrier.productId = carrier.stage === 'empty' ? null : `discharge-${loops}-${id}`;
        carrier.creamProgress = station >= 2 ? 1 : 0;
        carrier.capProgress = station === 3 ? 1 : 0;
        carrier.compression = station === 3 ? 1 : 0;
        if (station === 3) {
          outgoing = { ...carrier, progress: clamp(phase.elapsed / phase.seconds) };
          carrier.stage = 'empty';
        }
      } else if (form === 'press') {
        carrier.stage = ['base', 'cream', capProgress === 1 ? 'sandwich' : 'cream', 'empty'][station];
        carrier.productId = carrier.stage === 'empty' ? null : `press-${id}`;
        carrier.creamProgress = station > 0 ? 1 : 0;
        carrier.capProgress = station === 2 ? capProgress : 0;
        carrier.compression = station === 2 ? compression : 0;
      } else {
        // A carrier at station 0 receives exactly one new base. Its product ID
        // then survives injection, sealing, indexing and the output handoff.
        // Entry, injection, sealing and output work together during the dwell.
        // The full cycle starts empty and first ejects after three indexed
        // passes; the processing inspector starts with a filled pipeline.
        const warm = form === 'processing' ? 2 : 0;
        const fillCycle = cycle + warm;
        if (station === 0) {
          carrier.stage = 'base';
          carrier.productId = `batch-${cycle}`;
          const feeding = phase.id === 'feeding';
          const feedTime = feeding ? phase.elapsed : phase.elapsed * .7 / this.table.delay;
          carrier.feedProgress = feeding ? smooth((feedTime - .02) / .58) : ['cycle', 'processing'].includes(form) ? smooth((feedTime - .02) / .42) : 1;
          const entering = phase.id === 'feeding' || ['cycle', 'processing'].includes(form);
          carrier.feedVisible = !entering || feedTime >= .02;
        } else if (station === 1 && fillCycle >= 1) {
          carrier.stage = creamProgress > 0 ? 'cream' : 'base';
          carrier.productId = `batch-${cycle - 1}`;
          carrier.creamProgress = creamProgress;
        } else if (station === 2 && fillCycle >= 2) {
          carrier.stage = capProgress === 1 ? 'sandwich' : 'cream';
          carrier.productId = `batch-${cycle - 2}`;
          carrier.creamProgress = 1;
          carrier.capProgress = capProgress;
          carrier.compression = compression;
        }
        // A finished item remains on its carrier through the end of indexing.
        // It ejects from that exact station at the start of the following
        // pass, while the other three workstations process their own items.
        if (station === 3 && (form === 'processing' || form === 'cycle' && cycle >= 3)) {
          carrier.productId = `batch-${cycle - 3}`;
          carrier.creamProgress = 1;
          carrier.capProgress = 1;
          carrier.compression = 1;
          outgoing = { ...carrier, stage: 'sandwich', position: this.outputPath[0], angle: Math.PI * 1.5, progress: clamp(phase.elapsed / this.rig.phases.find(item => item.id === 'discharging').seconds) };
          carrier.stage = 'empty';
        }
      }
      if (station === 2 && carrier.capProgress === 1 && indexProgress > 0 && !staticEmpty) {
        // Keep the incoming sandwich above the fixed slide while the previous
        // sandwich can still be moving along the output path in this preview.
        preparing = { ...carrier, preparing: true };
        carrier.foodAtOutput = true;
      }
      carriers.push(carrier);
    }

    return { form, cycle, indexProgress, carriers, outgoing, preparing, creamProgress, capProgress, pose,
      processing: phase.id === 'processing' && machine.inFlight,
      completed: form === 'cycle' ? Math.max(0, cycle - 3) + (outgoing && outgoing.progress >= 1 ? 1 : 0) : 0 };
  }

  getMechanicalPose(layer, machine, pose, detail = { small: false }) {
    const state = this.getState(machine);
    const enabled = state.processing && !['empty', 'index'].includes(machine.form);
    if (layer.id === 'cream-nozzle') {
      const carrier = state.carriers.find(item => item.station === 1 && item.productId !== null);
      const movement = enabled && carrier ? nozzleTipY(carrier, state.pose) - 465 : -22;
      return { ...pose, x: 0, y: movement, angle: 0 };
    }
    if (layer.id === 'sealing-arm') {
      const material = state.carriers.find(carrier => carrier.station === 2 && carrier.productId !== null);
      const movement = pressShoeY(enabled && material ? state.pose : operationPose(-1), detail) - 622;
      return { ...pose, x: 0, y: movement, angle: 0 };
    }
    return pose;
  }

  cleanBase(ctx) {
    // Bake removal behind the moving material; a foreground background patch
    // would cut through the dollop when its apex reaches the nozzle footprint.
    for (const clear of [this.nozzleClear, this.pressClear]) {
      if (clear) ctx.drawImage(clear.piece, clear.box.x, clear.box.y);
    }
  }

  drawMechanicalLayer(ctx, layer, machine, pose) {
    if (!['cream-nozzle', 'sealing-arm'].includes(layer.id)) return false;
    if (!this.nozzleTip || !this.pressTip) return true;
    const detail = screenDetail(ctx);
    const movement = this.getMechanicalPose(layer, machine, pose || { x: 0, y: 0 }, detail).y || 0;
    const isNozzle = layer.id === 'cream-nozzle';
    ctx.save();
    if (isNozzle) {
      if (movement > 0) {
        const metal = ctx.createLinearGradient(842, 0, 859, 0);
        metal.addColorStop(0, '#777b7d'); metal.addColorStop(.35, '#e8eceb'); metal.addColorStop(.75, '#bfc5c4'); metal.addColorStop(1, '#696c70');
        ctx.fillStyle = metal; ctx.strokeStyle = '#29292d'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect(842, 437, 17, movement + 13, 3); ctx.fill(); ctx.stroke();
      }
      ctx.drawImage(this.nozzleTip.piece, this.nozzleTip.box.x, this.nozzleTip.box.y + movement);
      ctx.drawImage(this.nozzleSleeve.piece, this.nozzleSleeve.box.x, this.nozzleSleeve.box.y);
    } else {
      // A fixed guide connects the left end of the housing to the single
      // pressure shoe above the sealing station; only the lower stem extends.
      const anchor = [950, 554], elbow = [897, 575], shoeY = 622 + movement, shoeX = 897;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(...anchor); ctx.lineTo(...elbow); ctx.lineTo(shoeX, shoeY - 8);
      ctx.strokeStyle = '#24242a'; ctx.lineWidth = 19; ctx.stroke();
      const chrome = ctx.createLinearGradient(shoeX - 7, 550, shoeX + 8, 660);
      chrome.addColorStop(0, '#e0e5e4'); chrome.addColorStop(.45, '#a9aeaf'); chrome.addColorStop(.7, '#f0f1eb'); chrome.addColorStop(1, '#767b7d');
      ctx.strokeStyle = chrome; ctx.lineWidth = 13; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(shoeX, shoeY, 29, 12, 0, 0, TAU);
      const plate = ctx.createLinearGradient(0, shoeY - 12, 0, shoeY + 12);
      plate.addColorStop(0, '#e4e8e6'); plate.addColorStop(.5, '#b8bcbb'); plate.addColorStop(1, '#6b6f71');
      ctx.fillStyle = plate; ctx.strokeStyle = '#333237'; ctx.lineWidth = detailStroke(2.4, .6, detail); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
    return true;
  }

  drawCarriers(ctx, machine) {
    if (!this.topTexture) return;
    const state = this.getState(machine);
    for (const carrier of [...state.carriers].sort((a, b) => a.position[1] - b.position[1])) {
      const scale = this.perspective(carrier.position[1]);
      this.drawSlot(ctx, carrier.position, carrier.angle, scale);
      if (carrier.stage === 'empty' || carrier.feedVisible === false || carrier.foodAtOutput) continue;
      const feeding = carrier.station === 0 && carrier.feedProgress < 1;
      const position = feeding ? curve([[490, 309], [522, 414], carrier.position], carrier.feedProgress) : carrier.position;
      ctx.save();
      if (feeding) { path(ctx, BASE_APERTURE); ctx.clip(); }
      this.drawFood(ctx, position, carrier.angle, scale, carrier); ctx.restore();
    }
    for (const lip of this.feederLips || []) ctx.drawImage(lip.piece, lip.box.x, lip.box.y);
    this.drawCreamStream(ctx, state);
  }

  drawCreamStream(ctx, state) {
    const carrier = state.carriers.find(item => item.station === 1 && item.productId !== null);
    if (!state.processing || !carrier || state.pose.flow <= 0) return;
    const scale = this.perspective(carrier.position[1]), x = carrier.position[0];
    const lower = [x, carrier.position[1] - 5 * scale];
    const top = nozzleTipY(carrier, state.pose) - 1;
    const bottom = creamApex(lower, scale, carrier.creamProgress) + 3 * scale;
    const detail = screenDetail(ctx);
    // Keep the stream legible at card size without exceeding the nozzle mouth.
    const radius = (detail.small ? Math.min(9 * scale, Math.max(4.2 * scale, .85 / detail.x)) : 4.2 * scale) * state.pose.flow;
    const cream = ctx.createLinearGradient(x - radius, 0, x + radius, 0);
    cream.addColorStop(0, '#e4bf70'); cream.addColorStop(.4, '#fffce7'); cream.addColorStop(1, '#fff1bd');
    ctx.save(); ctx.fillStyle = cream; ctx.strokeStyle = detail.small ? '#956b39' : '#ead395';
    ctx.lineWidth = detailStroke(1, .35, detail);
    ctx.beginPath(); ctx.moveTo(x - radius, top); ctx.lineTo(x + radius, top);
    ctx.quadraticCurveTo(x + radius * .65, (top + bottom) / 2, x + radius * .85, bottom);
    ctx.quadraticCurveTo(x, bottom + radius, x - radius * .85, bottom);
    ctx.quadraticCurveTo(x - radius * .65, (top + bottom) / 2, x - radius, top);
    ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  }

  drawOutput(ctx, machine) {
    if (!this.topTexture) return;
    const state = this.getState(machine);
    for (const outgoing of [state.preparing, state.outgoing]) {
      if (!outgoing) continue;
      const p = outgoing.progress || 0, travel = p * p * (2 - p);
      const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      const lift = !outgoing.preparing && !reducedMotion && p < .24 ? 8 * Math.sin(Math.PI * p / .24) ** 2 : 0;
      const ground = outgoing.preparing ? outgoing.position : distancePoint(this.outputPath, travel);
      const scale = outgoing.preparing ? this.perspective(ground[1]) : this.perspective(this.outputPath[0][1]);
      const position = [ground[0], ground[1] - lift * scale];
      ctx.save();
      ctx.globalAlpha *= !outgoing.preparing && p > .96 ? (1 - p) / .04 : 1;
      this.drawFood(ctx, position, outgoing.angle, scale, { ...outgoing, lift });
      ctx.restore();
    }
  }

  draw(ctx, machine) { this.drawCarriers(ctx, machine); this.drawOutput(ctx, machine); }

  perspective(y) { return perspective(y); }

  drawSlot(ctx, center, angle, scale) {
    const outer = project(SLOT_SHAPE, center, planeMatrix(angle, 52, 23, scale));
    const inner = project(SLOT_SHAPE, center, planeMatrix(angle, 48, 20, scale));
    const minY = Math.min(...outer.map(point => point[1])), maxY = Math.max(...outer.map(point => point[1]));
    ctx.save();
    const lip = ctx.createLinearGradient(center[0], minY, center[0], maxY);
    lip.addColorStop(0, '#6522a2'); lip.addColorStop(.45, '#842ccc'); lip.addColorStop(1, '#bd64ef');
    path(ctx, outer); ctx.fillStyle = lip; ctx.fill();
    ctx.lineWidth = 2.3; ctx.strokeStyle = '#341448'; ctx.stroke();
    path(ctx, inner); ctx.clip();
    const cavity = ctx.createLinearGradient(center[0], minY, center[0], maxY);
    cavity.addColorStop(0, '#130b1e'); cavity.addColorStop(.35, '#302337'); cavity.addColorStop(1, '#67536b');
    ctx.fillStyle = cavity; ctx.fillRect(center[0] - 180, minY - 10, 360, maxY - minY + 20);
    path(ctx, inner.map(([x, y]) => [x, y + 12 * scale]));
    const floor = ctx.createLinearGradient(center[0], minY + 12, center[0], maxY);
    floor.addColorStop(0, '#3d3b43'); floor.addColorStop(.5, '#626167'); floor.addColorStop(1, '#78777c');
    ctx.fillStyle = floor; ctx.fill();
    ctx.lineWidth = 2.2; ctx.strokeStyle = '#9d56bf';
    for (let index = 0; index < inner.length; index++) {
      const current = inner[index], next = inner[(index + 1) % inner.length];
      if (next[0] >= current[0]) continue;
      ctx.beginPath(); ctx.moveTo(...current); ctx.lineTo(...next); ctx.stroke();
    }
    ctx.restore();
  }

  drawFood(ctx, center, angle, scale, state) {
    const lower = [center[0], center[1] - 5 * scale];
    const detail = screenDetail(ctx), band = creamDepth(scale, detail);
    ctx.save();
    path(ctx, project(FOOD_SHAPE, [center[0], center[1] + ((state.lift || 0) + 10) * scale], planeMatrix(angle, 39, 18, scale)));
    ctx.fillStyle = 'rgba(45, 23, 53, 0.20)'; ctx.fill(); ctx.restore();
    this.drawWafer(ctx, lower, angle, scale, 12 * scale, this.topTexture, false, 1, detail);
    const compression = state.compression ?? (state.capProgress === 1 ? 1 : 0);
    if (compression > 0) {
      this.drawWafer(ctx, [center[0], lower[1] - band * compression], angle,
        scale * (.55 + .38 * compression), band * compression, null, true, 1, detail);
    }
    if (state.creamProgress > 0 && compression < 1) this.drawCream(ctx, lower, scale, state.creamProgress, compression, detail.small);
    if (state.capProgress > 0) {
      // The cap and pressure shoe follow the same visible filling thickness.
      const landing = [center[0], center[1] - (53 - 26 * compression) * scale - (band - 9 * scale) * compression];
      const cap = state.capProgress < 1 ? curve([[1138, 520], [1020, 566], landing], state.capProgress) : landing;
      ctx.save();
      if (state.capProgress < 1) { path(ctx, CAP_APERTURE); ctx.clip(); }
      this.drawWafer(ctx, cap, angle, scale, 13 * scale, this.capTexture, false, 1, detail); ctx.restore();
    }
  }

  drawWafer(ctx, center, angle, scale, depth, texture, creamBand = false, opacity = 1, detail = { small: false }) {
    const small = detail.small;
    const matrix = planeMatrix(angle, 36.5, 17.5, scale);
    const points = project(FOOD_SHAPE, center, matrix);
    const bottom = Math.max(...points.map(point => point[1]));
    ctx.save(); ctx.globalAlpha *= opacity;
    const side = ctx.createLinearGradient(center[0], bottom - 10 * scale, center[0], bottom + depth);
    if (creamBand) { side.addColorStop(0, '#fffdf0'); side.addColorStop(.5, small ? '#fff9e7' : '#fff3cf'); side.addColorStop(1, small ? '#bc873d' : '#d3a95e'); }
    else { side.addColorStop(0, '#ffd864'); side.addColorStop(.65, '#fbb731'); side.addColorStop(1, '#d98d18'); }
    ctx.fillStyle = side; ctx.strokeStyle = creamBand ? '#ae8143' : '#b97a19'; ctx.lineWidth = detailStroke(small ? 3.8 : 1.5, .5, detail);
    for (let index = 0; index < points.length; index++) {
      const current = points[index], next = points[(index + 1) % points.length];
      if (next[0] >= current[0]) continue;
      path(ctx, [current, next, [next[0], next[1] + depth], [current[0], current[1] + depth]]);
      ctx.fill();
    }
    path(ctx, points.map(([x, y]) => [x, y + depth])); ctx.stroke();
    path(ctx, points);
    ctx.fillStyle = creamBand ? '#fff8df' : '#ffe079'; ctx.fill();
    if (texture) {
      ctx.save(); ctx.clip();
      const [a, b, c, d] = matrix;
      ctx.transform(a, b, c, d, center[0], center[1]);
      ctx.drawImage(texture, -1, -1, 2, 2); ctx.restore();
    }
    ctx.strokeStyle = creamBand ? (small ? '#a97532' : '#be9958') : '#dfa02c';
    ctx.lineWidth = detailStroke(small ? (creamBand ? 4.2 : 3.4) : (creamBand ? 1 : 2.1), creamBand ? .5 : .4, detail); ctx.stroke();
    ctx.restore();
  }

  drawCream(ctx, surface, scale, progress, compression = 0, small = false) {
    const p = clamp(progress), size = Math.max(.08, Math.sqrt(p)) * scale;
    const x = surface[0], y = surface[1] - (4 + 5 * compression) * scale;
    ctx.save(); ctx.globalAlpha *= Math.min(1, progress * 7);
    for (const [radiusX, radiusY, lift] of [[39, 17, 0], [31, 14, 8], [22, 11, 17], [11, 6, 25]]) {
      const centerY = y - lift * p * scale * (1 - compression);
      const gradient = ctx.createRadialGradient(x - radiusX * size * .2, centerY - 6 * size, 1, x, centerY, radiusX * size);
      gradient.addColorStop(0, '#fffce7'); gradient.addColorStop(.65, '#fff1bd'); gradient.addColorStop(1, '#e4bf70');
      ctx.beginPath(); ctx.ellipse(x, centerY, radiusX * size * (1 + compression * .1), radiusY * size * (1 - compression), 0, 0, TAU);
      ctx.fillStyle = gradient; ctx.fill();
      ctx.strokeStyle = small ? '#caa869' : '#ead395'; ctx.lineWidth = small ? 2.8 : 1.1; ctx.stroke();
    }
    ctx.restore();
  }
}
