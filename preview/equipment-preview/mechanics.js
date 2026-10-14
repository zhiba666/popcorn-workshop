const TAU = Math.PI * 2;
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };

function path(ctx, polygon) {
  ctx.beginPath();
  polygon.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
}

function stroke(time, duration, hold = 0) {
  const travel = Math.max(.01, (duration - hold) / 2);
  if (time < 0 || time > duration) return 0;
  if (time < travel) return smooth(time / travel);
  if (time < travel + hold) return 1;
  return 1 - smooth((time - travel - hold) / travel);
}

function pressTravel(machine) {
  return machine.inFlight && machine.phase.id === 'processing'
    ? 156 * stroke(machine.phase.elapsed - .3, 1.55, .25) : 0;
}

function runningTime(machine) {
  return Number.isFinite(machine.motionTime) ? machine.motionTime : machine.elapsed;
}

function erase(ctx, polygon) {
  ctx.save(); path(ctx, polygon); ctx.globalCompositeOperation = 'destination-out'; ctx.fill(); ctx.restore();
}

function patchFrom(ctx, image, polygon, source, destination) {
  ctx.save(); path(ctx, polygon); ctx.clip();
  ctx.drawImage(image, ...source, ...destination); ctx.restore();
}

function foodSprite(image, polygon, nativeWidth, nativeHeight) {
  const xs = polygon.map(point => point[0]), ys = polygon.map(point => point[1]);
  const left = Math.floor(Math.min(...xs)), top = Math.floor(Math.min(...ys));
  const width = Math.ceil(Math.max(...xs)) - left, height = Math.ceil(Math.max(...ys)) - top;
  const piece = document.createElement('canvas'); piece.width = width; piece.height = height;
  const ctx = piece.getContext('2d'); ctx.translate(-left, -top); path(ctx, polygon); ctx.clip();
  ctx.drawImage(image, 0, 0, nativeWidth, nativeHeight);
  maskFoodPixels(piece);
  return { piece, width, height };
}

function maskFoodPixels(piece) {
  const ctx = piece.getContext('2d');
  const pixels = ctx.getImageData(0, 0, piece.width, piece.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const r = pixels.data[index], g = pixels.data[index + 1], b = pixels.data[index + 2];
    // Steel/tray pixels are neutral or blue; the kernel outline and highlights remain warm.
    const warmHighlight = g >= 225 && r >= b;
    if (!warmHighlight && b > g * .94 && r < g * 1.13) pixels.data[index + 3] = 0;
  }
  ctx.putImageData(pixels, 0, 0);
}

// These repairs only clear old moving-part footprints. The machine artwork remains the source crop.
export function initializeMechanics(renderer, sourceImage, cleanImage) {
  renderer.mechanics = {};
  const ctx = renderer.base.getContext('2d');
  if (renderer.rig.id === 'caramel-drum') {
    renderer.mechanics.tumbleInput = foodSprite(sourceImage,
      [[325,242],[338,240],[352,244],[363,251],[368,260],[372,267],[368,282],[361,292],[352,297],[346,301],[331,299],[318,293],[309,284],[305,272],[308,258],[315,249]], renderer.rig.width, renderer.rig.height);
    renderer.mechanics.tumbleOutput = foodSprite(sourceImage,
      [[1000,1019],[1018,1006],[1037,1005],[1052,1017],[1069,1021],[1083,1034],[1088,1052],[1081,1070],[1065,1078],[1053,1086],[1035,1088],[1021,1076],[1007,1069],[995,1055],[995,1038]], renderer.rig.width, renderer.rig.height);
    const feed = renderer.layers.find(layer => layer.id === 'feeding-popcorn');
    if (feed?.piece) maskFoodPixels(feed.piece);
  }
  if (renderer.rig.id === 'ball-mold-press') {
    const linkageFootprint = [[612,141],[655,150],[678,165],[653,236],[686,244],[707,267],[716,329],[701,355],[644,362],[574,355],[529,338],[532,299],[540,261],[576,237],[591,239],[599,195]];
    erase(ctx, linkageFootprint);
    // An adjacent intact section of the fixed beam has the same paint and lighting.
    patchFrom(ctx, cleanImage, [[540,177],[704,199],[704,278],[540,257]], [414,161,140,106], [540,180,164,99]);
    erase(ctx, [[518,287],[588,298],[599,354],[523,349]]);
    erase(ctx, [[709,326],[815,338],[829,375],[715,363]]);
    // Clear thin source outlines around the retracted nozzle tips without cutting the lower frame.
    const nozzle = renderer.layers.find(layer => layer.id === 'nozzle-manifold');
    if (nozzle) {
      const footprint = [[519,489],[546,482],[583,489],[617,508],[660,491],[693,518],[695,544],[740,549],[757,518],[793,511],[830,535],[837,563],[879,574],[888,543],[921,539],[957,560],[963,604],[946,631],[942,658],[883,658],[882,630],[818,638],[762,637],[759,610],[745,594],[689,582],[675,617],[619,616],[614,585],[578,567],[565,595],[536,596],[519,586]];
      erase(ctx, footprint);
      ctx.save(); path(ctx, footprint); ctx.clip(); ctx.drawImage(cleanImage, 0, 0, renderer.rig.width, renderer.rig.height); ctx.restore();
    }
  }
  if (renderer.rig.id === 'sheeting-strip-cutter') {
    const cutters = renderer.layers.filter(layer => layer.motion.type === 'projected-spin');
    for (const cutter of cutters) {
      const face = document.createElement('canvas'); face.width = cutter.piece.width; face.height = cutter.piece.height;
      const faceCtx = face.getContext('2d'); faceCtx.drawImage(cutter.piece, 0, 0);
      faceCtx.save(); faceCtx.translate(-cutter.box.x, -cutter.box.y);
      faceCtx.globalCompositeOperation = 'destination-out'; faceCtx.beginPath();
      faceCtx.ellipse(cutter.pivot[0] - 5, cutter.pivot[1], 31, 44, -.16, 0, TAU); faceCtx.fill(); faceCtx.restore();
      cutter.bladeFace = face;
    }
    // Food crops crossing a knife or the cutter frame must not carry those metal parts downstream.
    const obstacles = renderer.layers.filter(layer => layer.id.startsWith('cutter-') || ['crosscut-frame','crosscut-blade'].includes(layer.id));
    for (const material of renderer.layers.filter(layer => ['sheet','cut-strips'].includes(layer.id))) {
      const pieceCtx = material.piece.getContext('2d'); pieceCtx.save();
      pieceCtx.translate(-material.box.x, -material.box.y); pieceCtx.globalCompositeOperation = 'destination-out';
      for (const obstacle of obstacles) { path(pieceCtx, obstacle.polygon); pieceCtx.fill(); }
      pieceCtx.restore();
    }
    const blade = renderer.layers.find(layer => layer.id === 'crosscut-blade');
    if (blade) {
      erase(ctx, blade.polygon);
      patchFrom(ctx, cleanImage, blade.polygon, [881,835,178,78], [832,704,234,121]);
    }
  }
}

export function getMechanicalPose(renderer, layer, machine, pose) {
  if (layer.motion.type === 'linked-rod') {
    pose.linkedTravel = pressTravel(machine);
  }
  if (layer.motion.type === 'crosscut') {
    const motion = layer.motion;
    const active = machine.inFlight && machine.phase.id === motion.phase;
    const time = machine.phase.elapsed - motion.delay;
    // Two complete cutting strokes, with a dwell while the sheet advances between them.
    const cycle = .72;
    const local = time >= 0 ? time % cycle : -1;
    const movement = active && time < cycle * 2 ? stroke(local, motion.duration, .09) : 0;
    pose.x = motion.amplitude[0] * movement;
    pose.y = motion.amplitude[1] * movement;
  }
  if (layer.motion.type === 'projected-spin' || layer.motion.type === 'roller') {
    pose.mechanicalTime = machine.inFlight ? runningTime(machine) : 0;
  }
  return pose;
}

function drawLinkedRod(ctx, layer, travel) {
  const upper = [639,143], lower = [602,287];
  const dx = lower[0] - upper[0], dy = lower[1] - upper[1];
  const targetDx = dx, targetDy = dy + travel;
  const sourceLength = Math.hypot(dx, dy), targetLength = Math.hypot(targetDx, targetDy);
  const sourceAngle = Math.atan2(dy, dx), targetAngle = Math.atan2(targetDy, targetDx);
  ctx.save(); ctx.translate(...upper); ctx.rotate(targetAngle);
  ctx.scale(targetLength / sourceLength, 1); ctx.rotate(-sourceAngle); ctx.translate(-upper[0], -upper[1]);
  ctx.drawImage(layer.piece, layer.box.x, layer.box.y); ctx.restore();
}

function drawProjectedBlade(ctx, layer, time) {
  const [rx, ry] = layer.motion.radius;
  const shear = layer.motion.shear || 0;
  const angle = time * TAU * layer.motion.speed;
  const c = Math.cos(angle), s = Math.sin(angle);
  // P R P^-1 rotates a circle in the blade plane while retaining its projected ellipse.
  const matrix = [c + shear * ry / rx * s, ry / rx * s,
    -(rx / ry + shear * shear * ry / rx) * s, c - shear * ry / rx * s];
  const [x, y] = layer.pivot;
  ctx.save(); path(ctx, layer.polygon); ctx.clip();
  ctx.translate(x, y); ctx.transform(...matrix, 0, 0); ctx.translate(-x, -y);
  ctx.drawImage(layer.bladeFace || layer.piece, layer.box.x, layer.box.y); ctx.restore();
  // The gold hub and common axle do not rotate in the blade plane.
  ctx.save(); ctx.beginPath(); ctx.ellipse(x - 5, y, 31, 44, -.16, 0, TAU); ctx.clip();
  ctx.drawImage(layer.piece, layer.box.x, layer.box.y); ctx.restore();
}

function drawRoller(ctx, layer, time) {
  ctx.save(); path(ctx, layer.polygon); ctx.clip();
  ctx.drawImage(layer.piece, layer.box.x, layer.box.y);
  if (time > 0) {
    const period = layer.box.height + 48;
    const offset = ((time * layer.motion.speed * 85 * layer.motion.direction) % period + period) % period;
    // Reflective seams travel around the cylinder, across the existing silver texture.
    for (let i = -1; i < 2; i++) {
      const y = layer.box.y + offset + i * period;
      const band = ctx.createLinearGradient(0, y - 15, 0, y + 17);
      band.addColorStop(0, '#ffffff00'); band.addColorStop(.46, '#ffffff45');
      band.addColorStop(.55, '#36344118'); band.addColorStop(1, '#36344100');
      ctx.fillStyle = band; ctx.beginPath();
      ctx.moveTo(layer.box.x - 20, y + 16); ctx.lineTo(layer.box.x + layer.box.width + 20, y - 28);
      ctx.lineTo(layer.box.x + layer.box.width + 20, y + 5); ctx.lineTo(layer.box.x - 20, y + 49); ctx.fill();
    }
  }
  ctx.restore();
}

function drawTumblingBatch(ctx, renderer, layer, machine, pose) {
  const input = renderer.mechanics.tumbleInput;
  const output = renderer.mechanics.tumbleOutput;
  if (!input?.piece || !output?.piece) return;
  const phase = machine.phase;
  const processing = phase.id === 'processing';
  const fill = phase.id === 'feeding' ? smooth(phase.elapsed / .8) : 1;
  const coating = processing ? smooth(phase.elapsed / 1.3) : 0;
  const time = processing ? phase.elapsed * layer.motion.speed : phase.elapsed * .15;
  const cavity = [[711,344],[775,312],[865,316],[935,363],[979,451],[985,545],[963,614],[916,650],[842,662],[782,642],[733,604],[707,539],[691,459],[695,391]];
  const particles = Array.from({ length: 9 }, (_, index) => {
    const turn = (time + index * .127) % 1;
    // Lift along the wall, then fall through the centre under gravity.
    const rising = turn < .62;
    const progress = rising ? turn / .62 : (turn - .62) / .38;
    const x = rising ? 807 + 125 * Math.sin(progress * Math.PI * .75) : 895 - 106 * smooth(progress);
    const y = rising ? 623 - 153 * Math.sin(progress * Math.PI / 2) : 470 + 153 * progress * progress;
    return { index, x: x + (index % 3 - 1) * 21, y: y + (index % 2) * 17, turn };
  }).sort((a, b) => a.y - b.y);
  ctx.save(); path(ctx, cavity); ctx.clip();
  for (const particle of particles) {
    if (particle.index / 9 > fill) continue;
    const scale = .8 + (particle.index % 3) * .07;
    ctx.save(); ctx.translate(particle.x, particle.y);
    ctx.rotate(Math.sin(particle.turn * TAU + particle.index) * .75);
    ctx.scale(scale, scale);
    ctx.globalAlpha = pose.alpha;
    ctx.drawImage(input.piece, -41.5, -38.5, 83, 77);
    if (coating > 0) {
      ctx.globalAlpha = pose.alpha * coating;
      ctx.drawImage(output.piece, -41.5, -38.5, 83, 77);
    }
    ctx.restore();
  }
  ctx.restore();
}

export function drawMechanicalLayer(ctx, renderer, layer, machine, pose) {
  switch (layer.motion.type) {
    case 'linked-rod': drawLinkedRod(ctx, layer, pose.linkedTravel || 0); return true;
    case 'projected-spin': drawProjectedBlade(ctx, layer, pose.mechanicalTime || 0); return true;
    case 'roller': drawRoller(ctx, layer, pose.mechanicalTime || 0); return true;
    case 'tumble': drawTumblingBatch(ctx, renderer, layer, machine, pose); return true;
    default: return false;
  }
}

export function getMechanicalFlipPose(renderer, machine) {
  const spec = renderer.rig.flipAssembly;
  if (!spec || !renderer.flipPiece || !machine.inFlight || machine.form === 'closed' || machine.phase.id !== spec.phase) return null;
  const local = machine.phase.elapsed - spec.delay;
  if (local < 0 || local > spec.duration) return null;
  const [[x1, y1], [x2, y2]] = spec.axis;
  const length = Math.hypot(x2 - x1, y2 - y1);
  return { mechanicalFlip: true, pivot: [(x1 + x2) / 2, (y1 + y2) / 2],
    ux: (x2 - x1) / length, uy: (y2 - y1) / length,
    angle: smooth(local / spec.duration) * TAU * (spec.turns || 1) };
}

function prepareFlip(renderer) {
  if (renderer.mechanics.flipRear) return;
  const { flipPiece: front, flipBox: box } = renderer;
  const filled = document.createElement('canvas'); filled.width = front.width; filled.height = front.height;
  const filledCtx = filled.getContext('2d'); filledCtx.drawImage(front, 0, 0);
  filledCtx.save(); filledCtx.translate(-box.x, -box.y);
  path(filledCtx, renderer.rig.flipAssembly.polygon); filledCtx.clip();
  for (const cutout of renderer.rig.flipAssembly.fixedCutouts || []) {
    filledCtx.save(); path(filledCtx, cutout); filledCtx.clip();
    // The fixed chute hides a continuous blue shell in the source. Rebuild only that hidden shell.
    filledCtx.drawImage(front, 750 - box.x, 716 - box.y, 102, 28, 515, 581, 295, 235);
    filledCtx.restore();
  }
  filledCtx.restore();
  const rear = document.createElement('canvas'); rear.width = front.width; rear.height = front.height;
  const ctx = rear.getContext('2d'); ctx.drawImage(filled, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  // The rear is an uninterrupted shell. Its paint comes from the broad source cover, rather than
  // cover-hinge or fixed-chute fragments; the assembly's rounded source outline is retained.
  ctx.drawImage(front, 656 - box.x, 457 - box.y, 242, 79, 0, 0, rear.width, rear.height);
  ctx.globalCompositeOperation = 'source-atop';
  const shade = ctx.createLinearGradient(0, 0, 0, rear.height);
  shade.addColorStop(0, '#ffffff16'); shade.addColorStop(.5, '#00153900'); shade.addColorStop(1, '#00153945');
  ctx.fillStyle = shade; ctx.fillRect(0, 0, rear.width, rear.height);
  const pixels = ctx.getImageData(0, 0, rear.width, rear.height);
  const alpha = new Uint8ClampedArray(pixels.data);
  const sampleAlpha = (x, y) => x < 0 || x >= rear.width || y < 0 || y >= rear.height ? 0 : alpha[(y * rear.width + x) * 4 + 3];
  for (let y = 0; y < rear.height; y++) for (let x = 0; x < rear.width; x++) {
    const index = (y * rear.width + x) * 4;
    if (alpha[index + 3] <= 20) continue;
    // The opaque shell must not inherit alpha seams from the hidden-chute repair.
    if (alpha[index + 3] >= 128) pixels.data[index + 3] = 255;
    const outer = Math.min(sampleAlpha(x - 6, y), sampleAlpha(x + 6, y), sampleAlpha(x, y - 6), sampleAlpha(x, y + 6)) < 20;
    const rim = Math.min(sampleAlpha(x - 13, y), sampleAlpha(x, y - 13)) < 20;
    if (outer) { pixels.data[index] = 14; pixels.data[index + 1] = 35; pixels.data[index + 2] = 53; }
    else if (rim) {
      pixels.data[index] = Math.round(pixels.data[index] * .55 + 68 * .45);
      pixels.data[index + 1] = Math.round(pixels.data[index + 1] * .55 + 203 * .45);
      pixels.data[index + 2] = Math.round(pixels.data[index + 2] * .55 + 251 * .45);
    }
  }
  ctx.putImageData(pixels, 0, 0);
  renderer.mechanics.flipFront = filled;
  renderer.mechanics.flipRear = rear;
}

export function drawMechanicalFlipAssembly(ctx, renderer, pose) {
  if (!pose.mechanicalFlip) return false;
  prepareFlip(renderer);
  const spec = renderer.rig.flipAssembly;
  const cosine = Math.cos(pose.angle), sine = Math.sin(pose.angle);
  const [x, y] = pose.pivot;
  const { ux, uy } = pose;
  const vx = -uy, vy = ux;
  const thickness = (spec.thickness || 54) * Math.abs(sine);
  const projections = spec.polygon.map(([px, py]) => (px - x) * ux + (py - y) * uy);
  const left = Math.min(...projections), right = Math.max(...projections);
  ctx.save(); ctx.translate(x, y); ctx.transform(ux, uy, vx, vy, 0, 0);
  if (thickness > .5) {
    // An opaque textured edge remains visible while the broad faces turn side-on.
    ctx.save(); ctx.beginPath(); ctx.roundRect(left + 9, -thickness / 2, right - left - 18, thickness, Math.min(10, thickness / 2)); ctx.clip();
    ctx.drawImage(renderer.flipPiece, 750 - renderer.flipBox.x, 716 - renderer.flipBox.y, 102, 28,
      left + 9, -thickness / 2, right - left - 18, thickness);
    const shade = ctx.createLinearGradient(0, -thickness / 2, 0, thickness / 2);
    shade.addColorStop(0, '#ffffff45'); shade.addColorStop(.45, '#ffffff00'); shade.addColorStop(1, '#00234465');
    ctx.fillStyle = shade; ctx.fillRect(left, -thickness / 2, right - left, thickness); ctx.restore();
  }
  ctx.restore();
  if (Math.abs(cosine) > .035) {
    ctx.save(); ctx.translate(x + vx * sine * 12, y + vy * sine * 12);
    ctx.transform(ux * ux + cosine * uy * uy, ux * uy * (1 - cosine),
      ux * uy * (1 - cosine), uy * uy + cosine * ux * ux, 0, 0);
    ctx.translate(-x, -y);
    ctx.drawImage(cosine >= 0 ? renderer.mechanics.flipFront : renderer.mechanics.flipRear, renderer.flipBox.x, renderer.flipBox.y);
    ctx.restore();
  }
  return true;
}
