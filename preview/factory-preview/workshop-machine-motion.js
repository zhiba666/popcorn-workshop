import { MACHINE_RIGS } from '../../assets/source/gameplay/machines/animation/v1/rigs.js';
import { EquipmentRenderer } from '../_shared/machine-animation/renderer.js';

const rigs = new Map(MACHINE_RIGS.map(rig => [rig.id, rig]));
// The decoded body and moving pieces are shared by both lines and subsequent
// layout rebuilds. Only the small, visible scene canvases are redrawn.
const renderers = new Map();
const clamp = value => Math.max(0, Math.min(1, value));

function rendererFor(rig) {
  if (!renderers.has(rig.id)) {
    const renderer = new EquipmentRenderer(rig);
    const promise = renderer.load().then(() => renderer).catch(error => {
      renderers.delete(rig.id);
      throw error;
    });
    renderers.set(rig.id, promise);
  }
  return renderers.get(rig.id);
}

function fallbackState(node, time) {
  const offset = (node.index || 0) * 1.37 + ((node.number || 1) - 1) * 2.3;
  const local = ((time + 48 + offset) % 12 + 12) % 12;
  if (local < 2) return { phase: 'feeding', progress: local / 2 };
  if (local < 6) return { phase: 'processing', progress: (local - 2) / 4 };
  if (local < 8) return { phase: 'discharging', progress: (local - 6) / 2 };
  return { phase: 'idle', progress: (local - 8) / 4 };
}

function machinePose(rig, node, state, time) {
  const phaseId = typeof state.phase === 'string' ? state.phase : state.phase?.id;
  const idle = phaseId === 'idle';
  const nativeId = idle ? 'discharging' : phaseId === 'discharge' ? 'discharging' : phaseId;
  const phase = rig.phases.find(item => item.id === nativeId) || rig.phases[0];
  const progress = idle ? 1 : clamp(Number(state.progress ?? state.phase?.progress) || 0);
  const phaseStart = id => {
    let start = 0;
    for (const item of rig.phases) {
      if (item.id === id) return start;
      start += item.seconds;
    }
    return start;
  };
  const seconds = rig.phases.reduce((total, item) => total + item.seconds, 0);
  const elapsed = phaseStart(phase.id) + phase.seconds * progress;
  const offset = (node.index || 0) * 1.37 + ((node.number || 1) - 1) * 2.3;
  const cycle = Math.max(0, Math.floor((time + 48 + offset) / 12));
  return {
    ready: true, error: '', form: 'cycle', hasInput: true, inFlight: true,
    elapsed, motionTime: cycle * seconds + elapsed,
    // A running workshop starts with a populated rotary pipeline rather than
    // three empty demonstration revolutions.
    cycleIndex: cycle + 3, loopIndex: cycle + 3,
    phase: { ...phase, elapsed: phase.seconds * progress, progress }, phaseStart,
  };
}

function paintMachine(ctx, renderer, machine) {
  // EquipmentRenderer.draw() adds its inspector floor and padding. Reuse the
  // same mechanism composition here, in the scene's existing source crop.
  const rig = renderer.rig, flip = renderer.getFlipPose(machine);
  ctx.drawImage(flip ? renderer.frameBase : renderer.base, 0, 0);
  let assemblyDrawn = false, slotsDrawn = false, outputDrawn = false;
  for (const layer of renderer.layers) {
    if (renderer.rotary && !slotsDrawn && layer.order >= rig.indexedTable.order) {
      renderer.rotary.drawCarriers(ctx, machine); slotsDrawn = true;
    }
    if (renderer.rotary && !outputDrawn && layer.order >= 90) {
      renderer.rotary.drawOutput(ctx, machine); outputDrawn = true;
    }
    if (renderer.rotary?.hiddenLayerIds.has(layer.id)) continue;
    if (flip && !assemblyDrawn && layer.order >= (rig.flipAssembly.order || 70)) {
      renderer.drawFlipAssembly(ctx, flip); assemblyDrawn = true;
    }
    if (flip && rig.flipAssembly.layerIds.includes(layer.id)) continue;
    renderer.drawLayer(ctx, layer, machine);
  }
  if (flip && !assemblyDrawn) renderer.drawFlipAssembly(ctx, flip);
  if (renderer.rotary && !slotsDrawn) renderer.rotary.drawCarriers(ctx, machine);
  if (renderer.rotary && !outputDrawn) renderer.rotary.drawOutput(ctx, machine);
}

function createCanvas(node, renderer) {
  const sprite = node.element.querySelector('.sprite');
  if (!sprite) return null;
  const image = sprite.querySelector('img'), canvas = document.createElement('canvas');
  canvas.className = 'workshop-machine-motion';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', visibility: 'hidden' });
  sprite.append(canvas);
  return { node, renderer, image, canvas, imageVisibility: image?.style.visibility || '', painted: false };
}

function setFallback(item, fallback) {
  item.canvas.style.visibility = fallback ? 'hidden' : 'visible';
  if (item.image) item.image.style.visibility = fallback ? item.imageVisibility : 'hidden';
}

/** Draws existing machine mechanisms; the scene owns its single animation clock. */
export async function createMachineMotion(nodes) {
  const lines = Array.from(nodes.values?.() || nodes).filter(node => node.type === 'line' && rigs.has(node.asset.id));
  const errors = [], items = [];
  const results = await Promise.allSettled([...new Set(lines.map(node => node.asset.id))].map(async id => [id, await rendererFor(rigs.get(id))]));
  const loaded = new Map();
  for (const result of results) {
    if (result.status === 'fulfilled') loaded.set(...result.value);
    else errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
  }
  for (const node of lines) {
    const renderer = loaded.get(node.asset.id);
    if (!renderer || !node.element.isConnected) continue;
    const item = createCanvas(node, renderer);
    if (item) items.push(item);
  }
  let destroyed = false;
  return {
    readyCount: items.length,
    errors,
    draw(time, { lineStates, visible = () => true, reducedMotion = false, zoom = 1 } = {}) {
      if (destroyed) return;
      const pixelRatio = Math.min(2.5, (window.devicePixelRatio || 1) * Math.max(.35, zoom));
      for (const item of items) {
        const { node, canvas, renderer } = item;
        if (reducedMotion) { setFallback(item, true); continue; }
        if (!visible(node)) continue;
        const state = lineStates?.get?.(node.id) || lineStates?.[node.id] || fallbackState(node, time);
        const machine = machinePose(renderer.rig, node, state, time);
        const width = Math.max(1, Math.round(node.width * pixelRatio)), height = Math.max(1, Math.round(node.height * pixelRatio));
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        const ctx = canvas.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, width, height);
        const asset = node.asset, [x0, y0, x1, y1] = asset.bounds;
        const fit = Math.min(node.width / (x1 - x0), node.height / (y1 - y0));
        const crop = asset.sourceCrop || [0, 0, ...asset.originalSize];
        const scale = asset.scale || [asset.size[0] / (crop[2] - crop[0]), asset.size[1] / (crop[3] - crop[1])];
        const sx = fit * scale[0], sy = fit * scale[1];
        const dx = (node.width - (x1 - x0) * fit) / 2 - x0 * fit - crop[0] * sx;
        const dy = (node.height - (y1 - y0) * fit) / 2 - y0 * fit - crop[1] * sy;
        ctx.setTransform(width / node.width * sx, 0, 0, height / node.height * sy, width / node.width * dx, height / node.height * dy);
        paintMachine(ctx, renderer, machine);
        setFallback(item, false); item.painted = true;
        const phase = typeof state.phase === 'string' ? state.phase : state.phase?.id;
        if (node.element.dataset.motionPhase !== phase) node.element.dataset.motionPhase = phase;
      }
    },
    destroy() {
      if (destroyed) return; destroyed = true;
      for (const item of items) {
        if (item.image) item.image.style.visibility = item.imageVisibility;
        item.canvas.remove(); item.canvas.width = 0; item.canvas.height = 0;
        delete item.node.element.dataset.motionPhase;
      }
      items.length = 0;
    },
  };
}
