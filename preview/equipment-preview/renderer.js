import { RotaryAssembler } from './rotary.js';
import { initializeMechanics, getMechanicalPose, drawMechanicalLayer, getMechanicalFlipPose, drawMechanicalFlipAssembly } from './mechanics.js';

const TAU = Math.PI * 2;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const point = (value, fallback = [0, 0]) => Array.isArray(value) ? value : fallback;

function polygonPath(ctx, polygon, offsetX = 0, offsetY = 0, append = false) {
  if (!append) ctx.beginPath();
  polygon.forEach(([x, y], index) => index ? ctx.lineTo(x - offsetX, y - offsetY) : ctx.moveTo(x - offsetX, y - offsetY));
  ctx.closePath();
}
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`缺失图片：${url}`));
    image.src = new URL(url, import.meta.url).href;
  });
}
function bounds(polygon, width, height) {
  const xs = polygon.map(p => p[0]), ys = polygon.map(p => p[1]);
  const x = Math.max(0, Math.floor(Math.min(...xs)) - 1);
  const y = Math.max(0, Math.floor(Math.min(...ys)) - 1);
  return { x, y, width: Math.min(width, Math.ceil(Math.max(...xs)) + 1) - x, height: Math.min(height, Math.ceil(Math.max(...ys)) + 1) - y };
}
function cropLayer(image, polygon, box, nativeWidth, nativeHeight, holes = []) {
  const canvas = document.createElement('canvas');
  canvas.width = box.width; canvas.height = box.height;
  const ctx = canvas.getContext('2d');
  polygonPath(ctx, polygon, box.x, box.y);
  ctx.clip();
  if (holes.length) {
    polygonPath(ctx, polygon, box.x, box.y);
    holes.forEach(hole => polygonPath(ctx, hole, box.x, box.y, true));
    ctx.clip('evenodd');
  }
  ctx.drawImage(image, 0, 0, image.naturalWidth || image.width, image.naturalHeight || image.height, -box.x, -box.y, nativeWidth, nativeHeight);
  return canvas;
}
function interpolatePath(points, progress) {
  if (!points?.length) return [0, 0];
  if (points.length === 1) return points[0];
  const lengths = points.slice(1).map((p, index) => Math.hypot(p[0] - points[index][0], p[1] - points[index][1]));
  let distance = clamp(progress) * lengths.reduce((sum, length) => sum + length, 0);
  for (let index = 0; index < lengths.length; index++) {
    if (distance <= lengths[index] || index === lengths.length - 1) {
      const t = lengths[index] ? clamp(distance / lengths[index]) : 0;
      return [points[index][0] + (points[index + 1][0] - points[index][0]) * t, points[index][1] + (points[index + 1][1] - points[index][1]) * t];
    }
    distance -= lengths[index];
  }
  return points[points.length - 1];
}
function curvePoint(points, progress) {
  if (points.length !== 3) return interpolatePath(points, progress);
  const [a, b, c] = points, inverse = 1 - progress;
  return [inverse * inverse * a[0] + 2 * inverse * progress * b[0] + progress * progress * c[0], inverse * inverse * a[1] + 2 * inverse * progress * b[1] + progress * progress * c[1]];
}
function closingStroke(time, duration, hold = 0) {
  const dwell = Math.max(0, Math.min(hold, duration - .02));
  const travel = Math.max(.01, (duration - dwell) / 2);
  if (time < travel) return smooth(time / travel);
  if (time < travel + dwell) return 1;
  return 1 - smooth((time - travel - dwell) / travel);
}

export class EquipmentRenderer {
  constructor(rig) { this.rig = rig; this.sourceImage = null; this.base = null; this.frameBase = null; this.flipPiece = null; this.rotary = null; this.layers = []; }
  async load() {
    const rig = this.rig;
    this.sourceImage = await loadImage(rig.source);
    let clean = await loadImage(rig.bodySource);
    const base = document.createElement('canvas');
    base.width = rig.width; base.height = rig.height;
    const ctx = base.getContext('2d');
    ctx.drawImage(this.sourceImage, 0, 0, rig.width, rig.height);
    for (const polygon of rig.eraseRegions || []) {
      const box = bounds(polygon, rig.width, rig.height);
      const patch = cropLayer(clean, polygon, box, rig.width, rig.height);
      ctx.save(); polygonPath(ctx, polygon);
      ctx.globalCompositeOperation = 'destination-out'; ctx.fill();
      ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(patch, box.x, box.y); ctx.restore();
      patch.width = 0; patch.height = 0;
    }
    const layerSpecs = [...rig.layers].sort((a, b) => a.order - b.order).map(layer => {
      const box = bounds(layer.polygon, rig.width, rig.height);
      if (layer.cleanPatch === true || (layer.cleanPatch !== false && layer.role === 'material')) {
        const patch = cropLayer(clean, layer.polygon, box, rig.width, rig.height);
        ctx.save();
        polygonPath(ctx, layer.polygon);
        ctx.globalCompositeOperation = 'destination-out'; ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(patch, box.x, box.y);
        ctx.restore();
        // Patch is baked into the one body canvas, rather than kept at full resolution per layer.
        patch.width = 0; patch.height = 0;
      }
      return { ...layer, box };
    });
    if (rig.indexedTable) {
      const table = rig.indexedTable;
      let blank = await loadImage(table.blankSource);
      // Replace the whole table backdrop so old inset lips and patch seams cannot survive an index.
      ctx.clearRect(0, 0, rig.width, rig.height);
      ctx.drawImage(blank, 0, 0, rig.width, rig.height);
      this.rotary = new RotaryAssembler(rig);
      await this.rotary.load(this.sourceImage, clean, blank);
      this.rotary.cleanBase(ctx);
      blank.onload = null; blank.onerror = null; blank.removeAttribute('src'); blank = null;
    }
    this.layers = layerSpecs.map(layer => ({
      ...layer,
      // A mechanical crop crossing a food region uses the cleaned base, so it cannot reintroduce food.
      piece: layer.eraseOnly ? null : cropLayer(layer.role === 'foreground' || (layer.role === 'mechanical' && layer.cleanPatch === false) ? base : this.sourceImage, layer.polygon, layer.box, rig.width, rig.height),
    }));
    this.base = base;
    initializeMechanics(this, this.sourceImage, clean);
    clean.onload = null; clean.onerror = null; clean.removeAttribute('src');
    clean = null;
    for (const layer of this.layers) {
      if (!layer.closedSource || !layer.closedPolygon) continue;
      let closed = await loadImage(layer.closedSource);
      layer.closedBox = bounds(layer.closedPolygon, rig.width, rig.height);
      layer.closedPiece = cropLayer(closed, layer.closedPolygon, layer.closedBox, rig.width, rig.height);
      closed.onload = null; closed.onerror = null; closed.removeAttribute('src'); closed = null;
    }
    if (rig.flipAssembly) {
      const assembly = rig.flipAssembly;
      let frame = await loadImage(assembly.frameSource);
      const frameBase = document.createElement('canvas'); frameBase.width = rig.width; frameBase.height = rig.height;
      const frameCtx = frameBase.getContext('2d'); frameCtx.drawImage(base, 0, 0);
      const erase = assembly.erasePolygon || assembly.polygon;
      const eraseBox = bounds(erase, rig.width, rig.height);
      const patch = cropLayer(frame, erase, eraseBox, rig.width, rig.height, assembly.fixedCutouts || []);
      frameCtx.save(); polygonPath(frameCtx, erase); frameCtx.clip();
      polygonPath(frameCtx, erase);
      (assembly.fixedCutouts || []).forEach(hole => polygonPath(frameCtx, hole, 0, 0, true));
      frameCtx.globalCompositeOperation = 'destination-out'; frameCtx.fill('evenodd');
      frameCtx.globalCompositeOperation = 'source-over'; frameCtx.drawImage(patch, eraseBox.x, eraseBox.y); frameCtx.restore();
      patch.width = 0; patch.height = 0;
      frame.onload = null; frame.onerror = null; frame.removeAttribute('src'); frame = null;
      let closed = await loadImage(assembly.source);
      this.flipBox = bounds(assembly.polygon, rig.width, rig.height);
      this.flipPiece = cropLayer(closed, assembly.polygon, this.flipBox, rig.width, rig.height, assembly.fixedCutouts || []);
      closed.onload = null; closed.onerror = null; closed.removeAttribute('src'); closed = null;
      this.frameBase = frameBase;
    }
    this.sourceImage.onload = null; this.sourceImage.onerror = null; this.sourceImage.removeAttribute('src');
    this.sourceImage = null;
  }
  getFlipPose(machine) {
    return getMechanicalFlipPose(this, machine);
  }
  getLayerPose(layer, machine) {
    const motion = layer.motion || {};
    const phase = machine.phase;
    const isActive = (!layer.when?.length || layer.when.includes(phase.id)) && (!motion.phase || motion.phase === phase.id) && (!motion.indexOnly || phase.id === 'processing');
    const pose = { x: 0, y: 0, angle: 0, scaleX: 1, scaleY: 1, alpha: 1, visible: true };
    if (layer.role === 'material') {
      const output = layer.id.startsWith('product-');
      const input = /hopper|input|magazine|reservoir|supply/.test(layer.id);
      pose.visible = machine.hasInput && (output ? phase.id === 'discharging' : input || isActive);
    }
    if (motion.activeWindow && (phase.elapsed < motion.activeWindow[0] || phase.elapsed > motion.activeWindow[1])) pose.visible = false;
    if (motion.type === 'flow') {
      const anchor = motion.startPhase || motion.phase || layer.when?.[0] || 'feeding';
      const age = (motion.repeat ? machine.motionTime : machine.elapsed) - machine.phaseStart(anchor) - (motion.delay || 0);
      const duration = Math.max(.08, motion.duration || phase.seconds);
      const repeating = motion.repeat === true;
      pose.visible = machine.hasInput && isActive && age >= 0 && (repeating || age < duration);
      if (!pose.visible) return pose;
      const progress = repeating ? (age % duration) / duration : clamp(age / duration);
      const destination = interpolatePath(motion.path, progress);
      const pivot = point(layer.pivot);
      pose.x = destination[0] - pivot[0]; pose.y = destination[1] - pivot[1];
      pose.alpha = repeating ? 1 : progress > .94 ? clamp((1 - progress) / .06) : 1;
      pose.flowProgress = progress;
      return pose;
    }
    if (!isActive || !machine.inFlight) return getMechanicalPose(this, layer, machine, pose);
    const amplitude = point(motion.amplitude);
    const delay = motion.delay || 0;
    const duration = motion.duration || phase.seconds;
    const local = clamp((phase.elapsed - delay) / duration);
    const speed = motion.speed ?? 1;
    const pivot = point(layer.pivot, [layer.box.x + layer.box.width / 2, layer.box.y + layer.box.height / 2]);
    switch (motion.type) {
      case 'vibrate':
        pose.x = Math.sin(phase.elapsed * TAU * speed) * amplitude[0];
        pose.y = Math.sin(phase.elapsed * TAU * speed + .6) * amplitude[1];
        break;
      case 'translate': {
        const distance = Math.sin(local * Math.PI);
        pose.x = amplitude[0] * distance; pose.y = amplitude[1] * distance;
        break;
      }
      case 'spin': pose.angle = (motion.angle ?? .06) * Math.sin(phase.elapsed * TAU * speed); break;
      case 'rotate': {
        const movement = Math.sin(local * Math.PI);
        pose.angle = (motion.angle || 0) * movement;
        pose.x = amplitude[0] * movement; pose.y = amplitude[1] * movement;
        break;
      }
      case 'press': {
        const movement = closingStroke(phase.elapsed - delay, duration, motion.hold || 0);
        pose.x = amplitude[0] * movement; pose.y = amplitude[1] * movement;
        break;
      }
      case 'nozzle': {
        const time = phase.elapsed - delay;
        const hold = motion.hold ?? Math.max(0, phase.seconds - duration * 2 - delay);
        const movement = time < duration ? smooth(time / duration) : time < duration + hold ? 1 : 1 - smooth((time - duration - hold) / duration);
        pose.x = amplitude[0] * movement; pose.y = amplitude[1] * movement;
        break;
      }
      case 'hinge': {
        const movement = closingStroke(phase.elapsed - delay, duration, motion.hold || 0);
        pose.closure = movement;
        // The open inner face folds to an edge. The closed outer face is a separate state crop.
        pose.scaleY = layer.closedPiece ? Math.max(.025, 1 - movement) : 1 + movement * ((motion.scaleY ?? .12) - 1);
        pose.x = amplitude[0] * movement; pose.y = amplitude[1] * movement;
        break;
      }
      case 'flip': {
        const movement = Math.sin(local * TAU);
        pose.scaleY = 1 - .035 * Math.abs(movement);
        pose.y = amplitude[1] * movement; pose.x = amplitude[0] * movement;
        break;
      }
      case 'ellipse': {
        if (motion.path?.length) {
          const progress = smooth(local);
          const destination = curvePoint(motion.path, progress);
          pose.x = destination[0] - pivot[0]; pose.y = destination[1] - pivot[1];
          break;
        }
        const radius = point(motion.radius, [200, 90]);
        const start = motion.startAngle || 0;
        const end = start + (motion.angle ?? Math.PI / 2) * smooth(local);
        pose.x = (Math.cos(end) - Math.cos(start)) * radius[0];
        pose.y = (Math.sin(end) - Math.sin(start)) * radius[1];
        break;
      }
    }
    return this.rotary ? this.rotary.getMechanicalPose(layer, machine, pose) : getMechanicalPose(this, layer, machine, pose);
  }
  draw(canvas, machine, options = {}) {
    const box = canvas.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(box.width * dpr), height = Math.round(box.height * dpr);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box.width, box.height);
    this.drawFloor(ctx, box.width, box.height, options.focus);
    const rig = this.rig;
    const availableHeight = box.height - (options.focus ? 50 : 17);
    const scale = Math.min((box.width - (options.focus ? 56 : 25)) / rig.width, availableHeight / rig.height);
    const drawWidth = rig.width * scale, drawHeight = rig.height * scale;
    const x = (box.width - drawWidth) / 2, y = (availableHeight - drawHeight) / 2 + 3;
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    if (this.base && machine.ready && !machine.error) {
        const flip = this.getFlipPose(machine);
        ctx.drawImage(flip ? this.frameBase : this.base, 0, 0);
        let assemblyDrawn = false;
        let slotsDrawn = false;
        let outputDrawn = false;
        for (const layer of this.layers) {
          if (this.rotary && !slotsDrawn && layer.order >= rig.indexedTable.order) { this.rotary.drawCarriers(ctx, machine); slotsDrawn = true; }
          if (this.rotary && !outputDrawn && layer.order >= 90) { this.rotary.drawOutput(ctx, machine); outputDrawn = true; }
          if (this.rotary?.hiddenLayerIds.has(layer.id)) continue;
          if (flip && !assemblyDrawn && layer.order >= (rig.flipAssembly.order || 70)) { this.drawFlipAssembly(ctx, flip); assemblyDrawn = true; }
          if (flip && rig.flipAssembly.layerIds.includes(layer.id)) continue;
          this.drawLayer(ctx, layer, machine);
        }
        if (flip && !assemblyDrawn) this.drawFlipAssembly(ctx, flip);
        if (this.rotary && !slotsDrawn) this.rotary.drawCarriers(ctx, machine);
        if (this.rotary && !outputDrawn) this.rotary.drawOutput(ctx, machine);
    }
    ctx.restore();
    if (machine.error || !machine.ready) {
      ctx.fillStyle = '#9b927b'; ctx.font = '12px "Microsoft YaHei", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('动画资源未加载', box.width / 2, box.height / 2);
    }
  }
  drawFlipAssembly(ctx, pose) {
    drawMechanicalFlipAssembly(ctx, this, pose);
  }
  drawLayer(ctx, layer, machine) {
    if (layer.eraseOnly) return;
    const pose = this.getLayerPose(layer, machine);
    if (layer.occludedByClosedLid) {
      const lid = this.layers.find(item => item.closedPiece);
      if (lid) pose.alpha *= 1 - smooth(((this.getLayerPose(lid, machine).closure || 0) - .2) / .4);
    }
    if (!pose.visible || pose.alpha <= 0) return;
    if (this.rotary?.drawMechanicalLayer(ctx, layer, machine, pose)) return;
    if (drawMechanicalLayer(ctx, this, layer, machine, pose)) return;
    if (layer.motion?.type === 'flow' && layer.motion.repeat) {
      this.drawFlowStream(ctx, layer, pose);
      return;
    }
    ctx.save();
    // Mechanical texture movement is constrained to the original footprint unless its clean patch removes it.
    if (layer.cleanPatch === false && layer.role === 'mechanical') { polygonPath(ctx, layer.polygon); ctx.clip(); }
    const pivot = point(layer.pivot, [layer.box.x + layer.box.width / 2, layer.box.y + layer.box.height / 2]);
    ctx.translate(pivot[0] + pose.x, pivot[1] + pose.y);
    if (pose.matrix) ctx.transform(...pose.matrix, 0, 0);
    ctx.rotate(pose.angle); ctx.scale(pose.scaleX, pose.scaleY); ctx.translate(-pivot[0], -pivot[1]);
    const closure = pose.closure || 0;
    const closedMix = layer.closedPiece ? smooth((closure - .25) / .35) : 0;
    ctx.globalAlpha = pose.alpha * (layer.closedPiece ? 1 - smooth((closure - .1) / .35) : 1);
    ctx.drawImage(layer.piece, layer.box.x, layer.box.y);
    ctx.restore();
    if (closedMix > 0) {
      ctx.save();
      // At the dwell, this is an opaque blue outer cover; no mirrored cavity texture is exposed.
      ctx.translate(pivot[0], pivot[1]);
      ctx.scale(1, Math.min(1, Math.max(.025, closure / .8)));
      ctx.translate(-pivot[0], -pivot[1]);
      ctx.globalAlpha = closedMix;
      ctx.drawImage(layer.closedPiece, layer.closedBox.x, layer.closedBox.y);
      ctx.restore();
    }
  }
  drawFlowStream(ctx, layer, pose) {
    const path = layer.motion.path;
    const first = path[0], last = path[path.length - 1];
    const dx = last[0] - first[0], dy = last[1] - first[1];
    const aperture = layer.motion.clipPolygon || layer.polygon;
    const lengthSquared = dx * dx + dy * dy;
    const projection = ([x, y]) => lengthSquared ? (x * dx + y * dy) / lengthSquared : 0;
    const clipExtent = aperture.map(projection);
    const { x, y, width, height } = layer.box;
    const pieceExtent = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]].map(projection);
    const offset = projection([pose.x, pose.y]);
    const firstCopy = Math.ceil(Math.min(...clipExtent) - Math.max(...pieceExtent) - offset);
    const lastCopy = Math.floor(Math.max(...clipExtent) - Math.min(...pieceExtent) - offset);
    ctx.save();
    polygonPath(ctx, aperture); ctx.clip();
    // Neighboring pieces wrap inside a stationary aperture rather than teleporting a whole strip.
    for (let copy = firstCopy; copy <= lastCopy; copy++) {
      ctx.drawImage(layer.piece, layer.box.x + pose.x + copy * dx, layer.box.y + pose.y + copy * dy);
    }
    ctx.restore();
  }
  drawFloor(ctx, width, height, focus) {
    const groundY = height * .77;
    ctx.save();
    ctx.strokeStyle = '#dfe5d230'; ctx.lineWidth = 1;
    const spacing = focus ? 70 : 43;
    for (let x = -height; x < width + height; x += spacing) {
      ctx.beginPath(); ctx.moveTo(x, height); ctx.lineTo(x + height * .65, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + height * .65, height); ctx.stroke();
    }
    const shadow = ctx.createRadialGradient(width / 2, groundY, 2, width / 2, groundY, width * .44);
    shadow.addColorStop(0, '#a6b19532'); shadow.addColorStop(1, '#a6b19500');
    ctx.fillStyle = shadow; ctx.beginPath(); ctx.ellipse(width / 2, groundY, width * .43, height * .105, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

