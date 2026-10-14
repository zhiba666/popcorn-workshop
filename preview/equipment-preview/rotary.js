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

function stroke(time, down, hold, up) {
  if (time <= 0) return 0;
  if (time < down) return smooth(time / down);
  if (time < down + hold) return 1;
  return 1 - smooth((time - down - hold) / up);
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
    return this;
  }

  getState(machine) {
    const phase = machine.phase;
    const form = machine.form || 'cycle';
    const cycle = Math.max(0, Math.floor(machine.cycleIndex || 0));
    const loops = Math.max(0, Math.floor(machine.loopIndex || 0));
    const rotationEnabled = ['cycle', 'processing', 'index'].includes(form);
    const indexProgress = rotationEnabled ? phase.id === 'discharging' ? 1 : phase.id === 'processing' ? smooth((phase.elapsed - this.table.delay) / this.table.duration) : 0 : 0;
    const angle = (modulo(cycle, 4) + indexProgress) * Math.PI / 2;
    const operationTime = phase.id === 'processing' ? phase.elapsed : phase.id === 'discharging' ? Infinity : -1;
    const creamProgress = smooth((operationTime - .08) / .38);
    const capProgress = smooth((operationTime - .12) / .38);
    const carriers = [];
    let outgoing = null;
    const staticEmpty = form === 'empty' || form === 'open' || !machine.ready || machine.error;

    for (let id = 0; id < 4; id++) {
      const station = modulo(id + cycle, 4);
      const position = curve(this.table.paths[station], indexProgress);
      const carrier = { id, station, destination: modulo(station + 1, 4), position, angle, stage: 'empty', productId: null, creamProgress: 0, capProgress: 0, feedProgress: 1 };
      if (staticEmpty) { carriers.push(carrier); continue; }

      if (form === 'index') {
        carrier.stage = ['base', 'cream', 'sandwich', 'empty'][id];
        carrier.productId = carrier.stage === 'empty' ? null : `index-${id}`;
        carrier.creamProgress = carrier.stage === 'cream' || carrier.stage === 'sandwich' ? 1 : 0;
        carrier.capProgress = carrier.stage === 'sandwich' ? 1 : 0;
      } else if (form === 'feeding') {
        carrier.stage = station === 0 ? 'base' : 'empty';
        carrier.productId = station === 0 ? 'feed-0' : null;
        carrier.feedProgress = loops ? 1 : smooth((phase.elapsed - .04) / .58);
        carrier.feedVisible = loops > 0 || phase.elapsed >= .04;
      } else if (form === 'discharging') {
        carrier.stage = ['empty', 'base', 'cream', 'sandwich'][station];
        carrier.productId = carrier.stage === 'empty' ? null : `discharge-${loops}-${id}`;
        carrier.creamProgress = station >= 2 ? 1 : 0;
        carrier.capProgress = station === 3 ? 1 : 0;
        if (station === 3) {
          outgoing = { ...carrier, progress: clamp(phase.elapsed / phase.seconds) };
          carrier.stage = 'empty';
        }
      } else if (form === 'press') {
        carrier.stage = ['base', 'cream', capProgress === 1 ? 'sandwich' : 'cream', 'empty'][station];
        carrier.productId = carrier.stage === 'empty' ? null : `press-${id}`;
        carrier.creamProgress = station > 0 ? 1 : 0;
        carrier.capProgress = station === 2 ? capProgress : 0;
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
          carrier.feedProgress = phase.id === 'feeding' ? smooth((phase.elapsed - .04) / .58) : ['cycle', 'processing'].includes(form) ? smooth((phase.elapsed - .04) / .48) : 1;
          const entering = phase.id === 'feeding' || ['cycle', 'processing'].includes(form);
          carrier.feedVisible = !entering || phase.elapsed >= .04;
        } else if (station === 1 && fillCycle >= 1) {
          carrier.stage = creamProgress > 0 ? 'cream' : 'base';
          carrier.productId = `batch-${cycle - 1}`;
          carrier.creamProgress = creamProgress;
        } else if (station === 2 && fillCycle >= 2) {
          carrier.stage = capProgress === 1 ? 'sandwich' : 'cream';
          carrier.productId = `batch-${cycle - 2}`;
          carrier.creamProgress = 1;
          carrier.capProgress = capProgress;
        }
        // A finished item remains on its carrier through the end of indexing.
        // It ejects from that exact station at the start of the following
        // pass, while the other three workstations process their own items.
        if (station === 3 && (form === 'processing' || form === 'cycle' && cycle >= 3)) {
          carrier.productId = `batch-${cycle - 3}`;
          carrier.creamProgress = 1;
          carrier.capProgress = 1;
          outgoing = { ...carrier, stage: 'sandwich', position: this.outputPath[0], angle: modulo(cycle, 4) * Math.PI / 2, progress: clamp(phase.elapsed / this.rig.phases.find(item => item.id === 'discharging').seconds) };
          carrier.stage = 'empty';
        }
      }
      carriers.push(carrier);
    }

    return { form, cycle, indexProgress, carriers, outgoing, creamProgress, capProgress,
      completed: form === 'cycle' ? Math.max(0, cycle - 3) + (outgoing && outgoing.progress >= 1 ? 1 : 0) : 0 };
  }

  getMechanicalPose(layer, machine, pose) {
    if (machine.form === 'empty' || machine.form === 'index' || !machine.inFlight) return { ...pose, x: 0, y: 0, angle: 0 };
    const state = this.getState(machine), phase = machine.phase;
    if (layer.id === 'cream-nozzle') {
      const material = state.carriers.find(carrier => carrier.station === 1 && carrier.productId !== null);
      const movement = material && phase.id === 'processing' ? stroke(phase.elapsed, .12, .29, .19) : 0;
      return { ...pose, x: 0, y: movement * 10, angle: 0 };
    }
    if (layer.id === 'sealing-arm') {
      const material = state.carriers.find(carrier => carrier.station === 2 && carrier.productId !== null);
      const movement = material && phase.id === 'processing' ? stroke(phase.elapsed - .12, .14, .18, .18) : 0;
      return { ...pose, x: 0, y: movement * 20, angle: 0 };
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
    const movement = this.getMechanicalPose(layer, machine, pose || { x: 0, y: 0 }).y || 0;
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
    } else {
      // A fixed guide connects the left end of the housing to the single
      // pressure shoe above the sealing station; only the lower stem extends.
      const anchor = [950, 554], elbow = [905, 600], shoeY = 622 + movement;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(...anchor); ctx.lineTo(...elbow); ctx.lineTo(905, shoeY - 8);
      ctx.strokeStyle = '#24242a'; ctx.lineWidth = 19; ctx.stroke();
      const chrome = ctx.createLinearGradient(898, 550, 913, 660);
      chrome.addColorStop(0, '#e0e5e4'); chrome.addColorStop(.45, '#a9aeaf'); chrome.addColorStop(.7, '#f0f1eb'); chrome.addColorStop(1, '#767b7d');
      ctx.strokeStyle = chrome; ctx.lineWidth = 13; ctx.stroke();
      const tip = this.pressTip;
      ctx.drawImage(tip.piece, 891, shoeY - 36, 28, 42);
      ctx.beginPath(); ctx.ellipse(905, shoeY, 29, 12, 0, 0, TAU);
      const plate = ctx.createLinearGradient(0, shoeY - 12, 0, shoeY + 12);
      plate.addColorStop(0, '#e4e8e6'); plate.addColorStop(.5, '#b8bcbb'); plate.addColorStop(1, '#6b6f71');
      ctx.fillStyle = plate; ctx.strokeStyle = '#333237'; ctx.lineWidth = 2.4; ctx.fill(); ctx.stroke();
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
      if (carrier.stage === 'empty' || carrier.feedVisible === false) continue;
      const entering = 1 - carrier.feedProgress;
      const position = [carrier.position[0] - 43 * entering, carrier.position[1] - 78 * entering];
      this.drawFood(ctx, position, carrier.angle, scale, carrier);
    }
  }

  drawOutput(ctx, machine) {
    if (!this.topTexture) return;
    const outgoing = this.getState(machine).outgoing;
    if (!outgoing) return;
    const position = distancePoint(this.outputPath, outgoing.progress);
    const scale = this.perspective(this.outputPath[0][1]) * (1 + .08 * outgoing.progress);
    ctx.save();
    ctx.globalAlpha *= outgoing.progress > .96 ? (1 - outgoing.progress) / .04 : 1;
    this.drawFood(ctx, position, outgoing.angle, scale, { stage: 'sandwich', creamProgress: 1, capProgress: 1 });
    ctx.restore();
  }

  draw(ctx, machine) { this.drawCarriers(ctx, machine); this.drawOutput(ctx, machine); }

  perspective(y) { return Math.max(.94, Math.min(1.06, .94 + (y - 450) / 240 * .12)); }

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
    this.drawWafer(ctx, lower, angle, scale, 12 * scale, this.topTexture);
    if (state.creamProgress > 0 && state.capProgress < 1) this.drawCream(ctx, lower, scale, state.creamProgress);
    if (state.capProgress > 0) {
      const p = state.capProgress;
      this.drawWafer(ctx, [center[0], center[1] - 14 * scale], angle, scale * .93, 9 * scale, null, true, p);
      const entering = 1 - p;
      const cap = [center[0] + 132 * entering, center[1] - 27 * scale - 76 * entering];
      this.drawWafer(ctx, cap, angle, scale, 13 * scale, this.capTexture);
    }
  }

  drawWafer(ctx, center, angle, scale, depth, texture, creamBand = false, opacity = 1) {
    const matrix = planeMatrix(angle, 36.5, 17.5, scale);
    const points = project(FOOD_SHAPE, center, matrix);
    const bottom = Math.max(...points.map(point => point[1]));
    ctx.save(); ctx.globalAlpha *= opacity;
    const side = ctx.createLinearGradient(center[0], bottom - 10 * scale, center[0], bottom + depth);
    if (creamBand) { side.addColorStop(0, '#fff7d0'); side.addColorStop(.5, '#ffe6a0'); side.addColorStop(1, '#e9be64'); }
    else { side.addColorStop(0, '#ffd864'); side.addColorStop(.65, '#fbb731'); side.addColorStop(1, '#d98d18'); }
    ctx.fillStyle = side; ctx.strokeStyle = creamBand ? '#d1a85b' : '#b97a19'; ctx.lineWidth = 1.5;
    for (let index = 0; index < points.length; index++) {
      const current = points[index], next = points[(index + 1) % points.length];
      if (next[0] >= current[0]) continue;
      path(ctx, [current, next, [next[0], next[1] + depth], [current[0], current[1] + depth]]);
      ctx.fill();
    }
    path(ctx, points.map(([x, y]) => [x, y + depth])); ctx.stroke();
    path(ctx, points);
    ctx.fillStyle = creamBand ? '#fff4c3' : '#ffe079'; ctx.fill();
    if (texture) {
      ctx.save(); ctx.clip();
      const [a, b, c, d] = matrix;
      ctx.transform(a, b, c, d, center[0], center[1]);
      ctx.drawImage(texture, -1, -1, 2, 2); ctx.restore();
    }
    ctx.strokeStyle = creamBand ? '#f4d895' : '#f0b434'; ctx.lineWidth = creamBand ? 1 : 2.1; ctx.stroke();
    ctx.restore();
  }

  drawCream(ctx, surface, scale, progress) {
    const p = smooth(progress), size = Math.max(.08, Math.sqrt(p)) * scale;
    const x = surface[0], y = surface[1] - 4 * scale;
    ctx.save(); ctx.globalAlpha *= Math.min(1, progress * 7);
    for (const [radiusX, radiusY, lift] of [[39, 17, 0], [31, 14, 8], [22, 11, 17], [11, 6, 25]]) {
      const centerY = y - lift * p * scale;
      const gradient = ctx.createRadialGradient(x - radiusX * size * .2, centerY - 6 * size, 1, x, centerY, radiusX * size);
      gradient.addColorStop(0, '#fffce7'); gradient.addColorStop(.65, '#fff1bd'); gradient.addColorStop(1, '#e4bf70');
      ctx.beginPath(); ctx.ellipse(x, centerY, radiusX * size, radiusY * size, 0, 0, TAU);
      ctx.fillStyle = gradient; ctx.fill();
      ctx.strokeStyle = '#ead395'; ctx.lineWidth = 1.1; ctx.stroke();
    }
    ctx.restore();
  }
}
